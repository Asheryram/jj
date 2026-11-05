import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common'
import type { Network, PaystackTopupSource, TreasuryPurpose } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { PaystackClient, transferEventFor } from '../payments/paystack.client'
import { momoCodeFor } from '../payments/momo'
import { LedgerService } from '../finance/ledger.service'
import { SolvencyService } from '../finance/solvency.service'
import { SettingsService, KNOWN_PROVIDERS, type SupplierProviderCode } from '../settings/settings.service'
import { FloatMonitorService, providerLabel } from '../supplier/float-monitor.service'
import { ConflictError, NotFoundError, ValidationError } from '../common/domain-errors'
import type { AuthUser } from '../common/auth'
import type { LedgerDraft } from '../finance/ledger.service'
import { bundleCostByProvider } from '../supplier/provider-resolution'

/** Paystack Ghana's own floor and ceiling on a single transfer. */
export const MIN_TRANSFER = 1000
export const MAX_TRANSFER = 5_000_000

/** A transfer that may still move money: counted against what is free to take. */
const IN_FLIGHT = ['sending', 'pending', 'otp', 'unknown'] as const

const SYNC_INTERVAL_MS = 15 * 60_000
const SYNC_CURSOR_KEY = 'paystackLedgerSyncedAt'

const ghs = (p: number) => `GHS ${(p / 100).toFixed(2)}`

/**
 * The Paystack balance, run as a treasury.
 *
 * With a registered business account and Manual Payouts on, customer money
 * stays in the Paystack balance instead of being settled out to the MoMo
 * number. That makes the balance the place money is moved from on purpose:
 * to refill a supplier float, or for the owner to take profit out. This is
 * where both happen, through real Paystack transfers, so each one is booked
 * the moment Paystack confirms it instead of being remembered and logged by
 * hand afterwards.
 *
 * Three rules hold it together:
 *
 *  · **Only to approved numbers.** A superadmin keeps the list
 *    (`TreasuryDestination`); an admin can only choose from it.
 *  · **Never other people's money.** Every withdrawal is capped by what is
 *    actually free, after everything owed to agents, customers, pending
 *    orders and transfers already on their way, and by what Paystack holds.
 *  · **Booked on confirmation, not on request.** A transfer can still fail or
 *    be reversed; nothing reaches the ledger until Paystack says it landed.
 *
 * Top-ups go the other way and Paystack has no API for them, they are made on
 * its dashboard. `syncTopups` reads the balance history and finds them, and a
 * person says whether each was the owner's own new money or settled money
 * coming back from the MoMo number.
 */
@Injectable()
export class TreasuryService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(TreasuryService.name)
  private timer: NodeJS.Timeout | null = null
  private syncing: Promise<{ found: number }> | null = null

  constructor(
    private readonly prisma: PrismaService,
    private readonly paystack: PaystackClient,
    private readonly ledger: LedgerService,
    private readonly solvency: SolvencyService,
    private readonly settings: SettingsService,
    private readonly floatMonitor: FloatMonitorService,
  ) {}

  onApplicationBootstrap(): void {
    const tick = () => {
      this.timer = setTimeout(() => {
        void this.syncTopups()
          .catch((error) => this.log.error(`top-up sync failed: ${String(error)}`))
          .finally(tick)
      }, SYNC_INTERVAL_MS)
      this.timer.unref?.()
    }
    tick()
  }

  onModuleDestroy(): void {
    if (this.timer) clearTimeout(this.timer)
  }

  private async enabled(): Promise<boolean> {
    return this.paystack.configured && (await this.settings.get('paystackBusinessAccount'))
  }

  private async requireEnabled(): Promise<void> {
    if (!this.paystack.configured) {
      throw new ConflictError('PAYSTACK_NOT_CONFIGURED', 'There is no Paystack key on this server.')
    }
    if (!(await this.settings.get('paystackBusinessAccount'))) {
      throw new ConflictError(
        'TRANSFERS_DISABLED',
        'Turn on "Paystack business account" in Settings first. Transfers only work on a registered business account.',
      )
    }
  }

  // ── Approved numbers ────────────────────────────────────────────────────

  async destinations() {
    return this.prisma.treasuryDestination.findMany({
      orderBy: [{ active: 'desc' }, { createdAt: 'asc' }],
      select: { id: true, label: true, phone: true, network: true, active: true, createdAt: true },
    })
  }

  async addDestination(input: { label: string; phone: string; network: Network }, user: AuthUser) {
    const label = input.label.trim()
    if (label.length < 2) throw new ValidationError('Give this number a name, like "James MTN".')
    if (!/^0\d{9}$/.test(input.phone)) throw new ValidationError('A Ghana number needs 10 digits, like 0209876543.')
    if (!momoCodeFor(input.network)) throw new ValidationError('Choose the Mobile Money network.')

    const existing = await this.prisma.treasuryDestination.findUnique({
      where: { phone_network: { phone: input.phone, network: input.network } },
    })
    if (existing) {
      // Re-adding a removed number brings it back rather than failing on the unique key.
      const row = await this.prisma.treasuryDestination.update({
        where: { id: existing.id },
        data: { active: true, label },
      })
      this.log.warn(`treasury destination ${row.phone} (${row.network}) re-enabled by ${user.id}`)
      return row
    }

    const row = await this.prisma.treasuryDestination.create({
      data: { label, phone: input.phone, network: input.network, createdBy: user.id },
    })
    this.log.warn(`treasury destination ${row.phone} (${row.network}) added by ${user.id}`)
    return row
  }

  async setDestinationActive(id: string, active: boolean, user: AuthUser) {
    const row = await this.prisma.treasuryDestination.update({ where: { id }, data: { active } }).catch(() => null)
    if (!row) throw new NotFoundError('We could not find that number.')
    this.log.warn(`treasury destination ${row.phone} ${active ? 'enabled' : 'disabled'} by ${user.id}`)
    return row
  }

  // ── The page ────────────────────────────────────────────────────────────

  /**
   * How much can be moved right now, for each purpose. Never past what is
   * free after every obligation, and never past what Paystack actually holds.
   */
  async limits() {
    this.solvency.invalidate()
    const [position, inFlight, fee, live, summaries] = await Promise.all([
      this.solvency.position(),
      this.inFlightTotal(),
      this.settings.get('payoutTransferFee'),
      this.paystack.configured ? this.paystack.balance() : Promise.resolve(null),
      Promise.all(KNOWN_PROVIDERS.map(async (p) => [p, await this.floatMonitor.capitalSummary(p)] as const)),
    ])

    const free = position.freeToSpend - inFlight
    /**
     * A refill is held back only by money owed out in cash: agents, customer
     * wallets and refunds, payouts. Orders still being delivered are not held
     * against it, the float is what delivers them, and holding their price
     * back left a float that could not be refilled while orders waited on it.
     */
    const freeForRefill = free + position.liabilities.undeliveredOrders
    const liveBalance = live?.ok ? live.balance : null
    // What Paystack itself can actually send, after its own fee.
    const sendable = liveBalance === null ? null : Math.max(liveBalance - fee, 0)
    const capped = (n: number) => Math.max(Math.min(n, sendable ?? n, MAX_TRANSFER), 0)

    return {
      fee,
      liveBalance,
      freeToSpend: free,
      inFlight,
      liabilities: position.liabilities.total,
      ownerDrawingMax: capped(free - fee),
      refillMax: Object.fromEntries(
        summaries.map(([provider, summary]) => [
          provider,
          // What this float is owed, plus what is free once orders still being
          // delivered stop counting against it, see `freeForRefill`.
          capped(summary.owedToProvider + Math.max(freeForRefill - fee, 0)),
        ]),
      ) as Record<SupplierProviderCode, number>,
      owedToProvider: Object.fromEntries(summaries.map(([p, s]) => [p, s.owedToProvider])) as Record<
        SupplierProviderCode,
        number
      >,
    }
  }

  async overview() {
    const [enabled, limits, live, flows, position, destinations, transfers, topups] = await Promise.all([
      this.enabled(),
      this.limits(),
      this.solvency.expectedLiveBalance().catch(() => null),
      this.solvency.heldFlows(),
      this.solvency.position(),
      this.destinations(),
      this.prisma.treasuryTransfer.findMany({
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: { destination: { select: { label: true, phone: true, network: true } } },
      }),
      this.prisma.paystackTopup.findMany({ orderBy: { occurredAt: 'desc' }, take: 50 }),
    ])
    return {
      enabled,
      minTransfer: MIN_TRANSFER,
      ...limits,
      expectedLiveBalance: live?.expected ?? null,
      /** Everything the business should hold, by its own records, see `SolvencyService.expectedLiveBalance`. */
      heldByRecords: live?.heldByRecords ?? null,
      /** Paid by customers since the last settlement, not in the balance yet. */
      inTransit: live?.inTransit ?? null,
      lastSettlementAt: live?.lastSettlementAt?.toISOString() ?? null,
      /** How `heldByRecords` is reached, flow by flow, see `SolvencyService.heldFlows`. */
      flows,
      /** What the money that should be held is for. */
      heldFor: {
        owedToOthers: position.liabilities.total,
        owedToFloats: position.spentOnBundles,
        free: position.freeToSpend,
        /** Manual refunds/payouts someone covered and has not been repaid for, part of `owedToOthers`. */
        unrepaidAdvances: position.liabilities.manualRefundAdvances + position.liabilities.manualPayoutAdvances,
      },
      destinations,
      transfers: transfers.map((t) => ({
        id: t.id,
        reference: `TRS-${t.id.slice(0, 8).toUpperCase()}`,
        /** Paystack's own code for it, what their dashboard search finds. */
        transferCode: t.transferCode,
        purpose: t.purpose,
        provider: t.provider,
        amount: t.amount,
        fee: t.fee,
        destination: t.destination,
        note: t.note,
        status: t.status,
        statusNote: t.statusNote,
        createdAt: t.createdAt.toISOString(),
        paidAt: t.paidAt?.toISOString() ?? null,
      })),
      topups: topups.map((t) => ({
        id: t.id,
        amount: t.amount,
        reason: t.reason,
        source: t.source,
        occurredAt: t.occurredAt.toISOString(),
        classifiedAt: t.classifiedAt?.toISOString() ?? null,
      })),
    }
  }

  private async inFlightTotal(): Promise<number> {
    const sum = await this.prisma.treasuryTransfer.aggregate({
      where: { status: { in: [...IN_FLIGHT] } },
      _sum: { amount: true, fee: true },
    })
    return (sum._sum.amount ?? 0) + (sum._sum.fee ?? 0)
  }

  // ── Withdrawals ─────────────────────────────────────────────────────────

  async withdraw(
    input: {
      purpose: TreasuryPurpose
      provider?: SupplierProviderCode
      amount: number
      destinationId: string
      note?: string
    },
    user: AuthUser,
  ) {
    await this.requireEnabled()

    const amount = input.amount
    if (!Number.isInteger(amount) || amount < MIN_TRANSFER) {
      throw new ValidationError(`Paystack's smallest transfer is ${ghs(MIN_TRANSFER)}.`)
    }
    if (amount > MAX_TRANSFER) throw new ValidationError(`Paystack's largest single transfer is ${ghs(MAX_TRANSFER)}.`)

    const provider = input.purpose === 'provider_refill' ? input.provider : undefined
    if (input.purpose === 'provider_refill' && (!provider || !KNOWN_PROVIDERS.includes(provider))) {
      throw new ValidationError('Choose which provider float this refills.')
    }

    const destination = await this.prisma.treasuryDestination.findUnique({ where: { id: input.destinationId } })
    if (!destination || !destination.active) {
      throw new ValidationError('Choose one of the approved numbers. Only a superadmin can add new ones.')
    }

    // Read before the lock: it calls Paystack, and a transaction is never held
    // open across an outbound HTTP call.
    const limits = await this.limits()

    /**
     * One withdrawal decided at a time, platform-wide. Two at once would both
     * check against the same free money and together take more than exists.
     * The lock is held for the check and the claim only, never across the
     * Paystack call itself.
     */
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('treasury-withdraw'))`

      const inFlightNow = (
        await tx.treasuryTransfer.aggregate({
          where: { status: { in: [...IN_FLIGHT] } },
          _sum: { amount: true, fee: true },
        })
      )._sum
      // `limits()` read in-flight outside this lock; re-read it inside so a
      // withdrawal claimed a moment ago is always counted.
      const extra = (inFlightNow.amount ?? 0) + (inFlightNow.fee ?? 0) - limits.inFlight
      const max =
        (input.purpose === 'owner_drawing' ? limits.ownerDrawingMax : limits.refillMax[provider!]) - Math.max(extra, 0)

      if (limits.liveBalance !== null && limits.liveBalance < amount + limits.fee) {
        throw new ConflictError(
          'INSUFFICIENT_PAYSTACK_BALANCE',
          `Paystack is holding ${ghs(limits.liveBalance)}, and this needs ${ghs(amount)} plus its ` +
            `${ghs(limits.fee)} transfer fee. Top up first.`,
        )
      }
      if (amount > max) {
        throw new ConflictError(
          'MORE_THAN_FREE',
          input.purpose === 'owner_drawing'
            ? `At most ${ghs(Math.max(max, 0))} can be taken out right now. The rest is owed to agents, ` +
                'customers, pending orders, or the provider floats, or is already on its way somewhere.'
            : `At most ${ghs(Math.max(max, 0))} can go to ${providerLabel(provider!)} right now: what it is owed, ` +
                'plus what is genuinely free. The rest belongs to agents, customers or pending orders.',
        )
      }

      return tx.treasuryTransfer.create({
        data: {
          purpose: input.purpose,
          provider: provider ?? null,
          amount,
          fee: limits.fee,
          destinationId: destination.id,
          note: input.note?.trim() || null,
          requestedBy: user.id,
          status: 'sending',
        },
      })
    })

    this.log.warn(
      `treasury ${row.id}: ${ghs(amount)} ${input.purpose}${provider ? ` (${provider})` : ''} to ` +
        `${destination.phone} requested by ${user.id}`,
    )
    await this.send(row.id).catch((error) => this.log.error(`treasury transfer ${row.id} threw: ${String(error)}`))
    return this.prisma.treasuryTransfer.findUniqueOrThrow({ where: { id: row.id } })
  }

  /** Hand the transfer to Paystack. Same outcomes and the same care as an agent payout. */
  private async send(id: string): Promise<void> {
    const row = await this.prisma.treasuryTransfer.findUniqueOrThrow({ where: { id }, include: { destination: true } })
    if (row.status !== 'sending' || row.transferCode) return

    let recipientCode = row.destination.recipientCode
    if (!recipientCode) {
      const created = await this.paystack.createRecipient({
        name: row.destination.label,
        phone: row.destination.phone,
        networkCode: momoCodeFor(row.destination.network) ?? '',
      })
      if (!created.ok) {
        await this.mark(id, 'failed', `Paystack would not accept the number: ${created.reason}`)
        return
      }
      recipientCode = created.recipientCode
      await this.prisma.treasuryDestination.update({ where: { id: row.destinationId }, data: { recipientCode } })
    }

    const result = await this.paystack.transfer({
      recipientCode,
      amount: row.amount,
      reference: `TRS-${row.id}`,
      reason:
        row.purpose === 'provider_refill'
          ? `Float refill, ${providerLabel(row.provider as SupplierProviderCode)}`
          : 'Owner withdrawal',
    })

    if (result.kind === 'sent') {
      // Guarded: the webhook can arrive while `transfer()` is still waiting.
      await this.prisma.treasuryTransfer.updateMany({
        where: { id, status: 'sending' },
        data: { transferCode: result.transferCode, status: 'pending' },
      })
      if (result.status === 'success') await this.applySuccess(id)
      return
    }
    if (result.kind === 'otp') {
      await this.mark(
        id,
        'otp',
        'Paystack wants an OTP for every transfer. Approve it in the Paystack dashboard, or turn ' +
          '"Confirm transfers before sending" off in Settings → Preferences.',
        result.transferCode,
      )
      return
    }
    if (result.kind === 'failed') {
      await this.mark(
        id,
        'failed',
        result.insufficientBalance ? 'Paystack balance could not cover it. Top up and try again.' : result.reason,
      )
      return
    }
    await this.mark(
      id,
      'unknown',
      `No answer from Paystack: ${result.reason} It may still go through, check the Paystack dashboard before trying again.`,
    )
  }

  private async mark(id: string, status: string, statusNote: string, transferCode: string | null = null) {
    await this.prisma.treasuryTransfer.updateMany({
      where: { id, status: { in: ['sending', 'pending', 'otp', 'unknown'] } },
      data: { status, statusNote, ...(transferCode ? { transferCode } : {}) },
    })
    this.log.warn(`treasury ${id}: ${status}, ${statusNote}`)
  }

  /**
   * Paystack's webhook for a `TRS-` reference. Success books the money;
   * a failure releases it; a reversal after success un-books it.
   */
  async applyTransferEvent(event: string, id: string, transferCode?: string | null): Promise<{ applied: boolean }> {
    const row = await this.prisma.treasuryTransfer.findUnique({ where: { id } })
    if (!row) {
      this.log.warn(`transfer webhook for unknown treasury transfer ${id}`)
      return { applied: false }
    }
    if (event === 'transfer.success') return { applied: await this.applySuccess(id, transferCode) }

    if (row.status === 'success') {
      if (event !== 'transfer.reversed') return { applied: false }
      // It landed, then came back. Un-book it; the money is in Paystack again.
      await this.prisma.$transaction([
        this.prisma.ledgerEntry.deleteMany({ where: { idempotencyKey: { startsWith: `treasury:${id}:` } } }),
        this.prisma.treasuryTransfer.update({
          where: { id },
          data: { status: 'reversed', statusNote: 'Paystack reversed this transfer after it landed.' },
        }),
      ])
      this.solvency.invalidate()
      this.log.warn(`treasury ${id}: reversed after success, un-booked`)
      return { applied: true }
    }

    const claimed = await this.prisma.treasuryTransfer.updateMany({
      where: { id, status: { in: [...IN_FLIGHT] } },
      data: {
        status: event === 'transfer.reversed' ? 'reversed' : 'failed',
        statusNote: `Paystack reported ${event.replace('transfer.', '')}. Nothing left the balance.`,
      },
    })
    return { applied: claimed.count > 0 }
  }

  /** Book a confirmed transfer, once. */
  /** Ask Paystack what became of one transfer, same rules as `PaymentsService.checkTransfer`. */
  async check(id: string): Promise<{ outcome: 'settled' | 'in_progress' | 'not_found' | 'unreachable'; status?: string; message?: string }> {
    const row = await this.prisma.treasuryTransfer.findUnique({ where: { id } })
    if (!row) throw new NotFoundError('We could not find that transfer.')

    const result = await this.paystack.verifyTransfer(`TRS-${id}`)
    if (result.kind === 'error') return { outcome: 'unreachable', message: result.reason }

    if (result.kind === 'not_found') {
      if (row.status === 'unknown') {
        await this.prisma.treasuryTransfer.updateMany({
          where: { id, status: 'unknown' },
          data: { statusNote: 'Checked with Paystack: it has no such transfer, so this did not go out.' },
        })
      }
      return { outcome: 'not_found' }
    }

    const event = transferEventFor(result.status)
    if (event) {
      await this.applyTransferEvent(event, id, result.transferCode)
      return { outcome: 'settled', status: result.status }
    }

    await this.prisma.treasuryTransfer.updateMany({
      where: { id, status: { in: [...IN_FLIGHT] } },
      data: {
        status: result.status === 'otp' ? 'otp' : 'pending',
        ...(result.status === 'otp' ? {} : { statusNote: null }),
        ...(result.transferCode ? { transferCode: result.transferCode } : {}),
      },
    })
    return { outcome: 'in_progress', status: result.status }
  }

  /** Everything still in flight from before `before`, see `PaymentsService.checkOpenTransfers`. */
  async checkOpen(before: Date): Promise<void> {
    const rows = await this.prisma.treasuryTransfer.findMany({
      where: { status: { in: [...IN_FLIGHT] }, createdAt: { lt: before } },
      select: { id: true },
      take: 50,
    })
    for (const { id } of rows) await this.check(id)
  }

  private async applySuccess(id: string, transferCode?: string | null): Promise<boolean> {
    const claim = await this.prisma.treasuryTransfer.updateMany({
      // `failed` included: a person may have marked it not sent, and Paystack
      // is now saying otherwise. Paystack's word on real money wins.
      where: { id, status: { in: [...IN_FLIGHT, 'failed'] } },
      data: { status: 'success', paidAt: new Date(), statusNote: null, ...(transferCode ? { transferCode } : {}) },
    })
    if (claim.count === 0) return false

    const row = await this.prisma.treasuryTransfer.findUniqueOrThrow({ where: { id }, include: { destination: true } })
    const to = `${row.destination.label} (${row.destination.phone})`

    if (row.purpose === 'provider_refill') {
      await this.floatMonitor.logCapital({
        provider: row.provider as SupplierProviderCode,
        direction: 'in',
        source: 'reimbursement',
        amount: row.amount,
        idempotencyKey: `treasury:${id}:capital_in_reimbursement`,
        note: `Paystack → ${to} to refill ${providerLabel(row.provider as SupplierProviderCode)}: ${ghs(row.amount)}`,
        alreadyMoved: true,
      })
    } else {
      await this.ledger.record([
        {
          idempotencyKey: `treasury:${id}:owner_drawing`,
          kind: 'owner_drawing',
          amount: -row.amount,
          affectsProfit: false,
          description: `Taken out of Paystack to ${to}${row.note ? `, ${row.note}` : ''}`,
          occurredAt: new Date(),
        },
      ])
    }
    if (row.fee > 0) {
      await this.ledger.record([
        {
          idempotencyKey: `treasury:${id}:payout_fee`,
          kind: 'payout_fee',
          amount: -row.fee,
          description: `Paystack transfer fee, treasury transfer to ${to}`,
          occurredAt: new Date(),
        },
      ])
    }
    this.solvency.invalidate()
    this.log.log(`treasury ${id}: ${ghs(row.amount)} confirmed sent to ${to}, booked`)
    return true
  }

  /**
   * A transfer Paystack never answered about, or one stuck on an OTP, that a
   * superadmin has checked on the Paystack dashboard and confirmed did not
   * go. Releases the money for other use. If Paystack later says it did go
   * after all, `applySuccess` still books it.
   */
  // ── Balancing the books ─────────────────────────────────────────────────

  /**
   * Draw a line: make the records agree with the real balances as of now,
   * with the difference recorded once, openly, instead of history rewritten.
   *
   * For when movements went unlogged and cannot be reconstructed. Nothing
   * that is owed to anyone else is touched: agent earnings, customer money,
   * refunds and pending orders stay exactly as they are. Only the business's
   * own money is adjusted, in three parts:
   *
   *  · **Capital repaid** (optional, `capitalRepaid`): the owner's own capital
   *    that paid for bundles and was never reimbursed is treated as having
   *    been paid back to him from the settlement MoMo. Recorded per provider
   *    as a reimbursement and an equal capital withdrawal, so the float's own
   *    balance does not move, only the claim is closed.
   *  · **Paystack + settlement MoMo**: whatever is still different is money
   *    out (or in) that was never logged, recorded as an owner withdrawal (or
   *    top-up). Never profit, balance sheet only.
   *  · **Each float**: its own difference, as capital in or out.
   *
   * `preview` computes the plan without writing anything.
   */
  async balanceBooks(
    input: {
      paystackAndMomo: number
      datahub: number
      gmpl: number
      capitalRepaid: boolean
      note: string
      preview: boolean
      readJustNow?: boolean
    },
    user: AuthUser,
  ) {
    const note = input.note.trim()
    if (!input.preview && note.length < 10) {
      throw new ValidationError('Say what was agreed and with whom. It is kept on the record.')
    }
    // The records move with every order, so balances read days ago set them
    // to a moment that has passed, which is how this first went wrong.
    if (!input.preview && !input.readJustNow) {
      throw new ValidationError('Confirm these balances were read just now. Older figures would put the books out again.')
    }
    for (const v of [input.paystackAndMomo, input.datahub, input.gmpl]) {
      if (!Number.isInteger(v) || v < 0) throw new ValidationError('Enter each real balance as an amount like 250.00.')
    }

    this.solvency.invalidate()
    const live = await this.solvency.expectedLiveBalance()
    if (!live) {
      throw new ConflictError('PAYSTACK_UNREACHABLE', 'Paystack did not answer, so today\'s payments still on their way cannot be counted. Try again.')
    }

    const actual: Record<SupplierProviderCode, number> = { 'datahub-gh': input.datahub, gmpl: input.gmpl }
    const floats = await Promise.all(
      KNOWN_PROVIDERS.map(async (provider) => {
        const [summary, cost, expected] = await Promise.all([
          this.floatMonitor.capitalSummary(provider),
          bundleCostByProvider(this.prisma, provider),
          this.floatMonitor.expectedBalance(provider),
        ])
        const expectedBalance = expected?.balance ?? summary.net - cost
        const capitalRepaid = input.capitalRepaid ? summary.owedToProvider : 0
        return {
          provider,
          label: providerLabel(provider),
          expected: expectedBalance,
          actual: actual[provider],
          capitalRepaid,
          adjustment: actual[provider] - expectedBalance,
        }
      }),
    )

    const capitalRepaidTotal = floats.reduce((sum, f) => sum + f.capitalRepaid, 0)
    const paystack = {
      expected: live.expected,
      inTransit: live.inTransit,
      actual: input.paystackAndMomo,
      capitalRepaid: capitalRepaidTotal,
      // What is left once the capital repayment is accounted for.
      adjustment: input.paystackAndMomo - (live.expected - capitalRepaidTotal),
    }
    const plan = { paystack, floats, at: new Date().toISOString() }
    if (input.preview) return { ...plan, saved: false }

    const run = Date.now().toString(36)
    const day = new Date().toISOString().slice(0, 10)
    const why = `Books balanced ${day} by ${user.id}: ${note}`
    const entries: (LedgerDraft & { idempotencyKey: string })[] = []

    for (const f of floats) {
      if (f.capitalRepaid > 0) {
        entries.push(
          {
            idempotencyKey: `balance:${run}:${f.provider}:capital_in_reimbursement`,
            kind: 'capital_in_reimbursement',
            provider: f.provider,
            amount: f.capitalRepaid,
            affectsProfit: false,
            description: `Own capital spent on ${f.label} bundles, repaid from the settlement MoMo. ${why}`,
            occurredAt: new Date(),
          },
          {
            idempotencyKey: `balance:${run}:${f.provider}:capital_repaid`,
            kind: 'capital_out',
            provider: f.provider,
            amount: -f.capitalRepaid,
            affectsProfit: false,
            description: `Own capital taken back (${f.label}). ${why}`,
            occurredAt: new Date(),
          },
        )
      }
      if (f.adjustment !== 0) {
        entries.push({
          idempotencyKey: `balance:${run}:${f.provider}:adjustment`,
          kind: f.adjustment > 0 ? 'capital_in' : 'capital_out',
          provider: f.provider,
          amount: f.adjustment,
          affectsProfit: false,
          description: `${f.label} float set to its real balance (${ghs(f.actual)}), unlogged movements before this date. ${why}`,
          occurredAt: new Date(),
        })
      }
    }
    if (paystack.adjustment !== 0) {
      entries.push({
        idempotencyKey: `balance:${run}:paystack:adjustment`,
        kind: paystack.adjustment < 0 ? 'owner_drawing' : 'owner_topup',
        amount: paystack.adjustment,
        affectsProfit: false,
        description:
          `Paystack and settlement MoMo set to their real balance (${ghs(paystack.actual)}): ` +
          `${paystack.adjustment < 0 ? 'money taken out' : 'money put in'} that was never logged, before this date. ${why}`,
        occurredAt: new Date(),
      })
    }

    await this.prisma.$transaction(async (tx) => {
      await this.ledger.record(entries, tx)
    })
    this.solvency.invalidate()
    this.log.warn(
      `books balanced by ${user.id}: Paystack+MoMo ${ghs(paystack.adjustment)}, capital repaid ${ghs(capitalRepaidTotal)}, ` +
        floats.map((f) => `${f.label} ${ghs(f.adjustment)}`).join(', ') + `. ${note}`,
    )
    return { ...plan, saved: true }
  }

  async markNotSent(id: string, user: AuthUser, note: string) {
    const reason = note.trim()
    if (reason.length < 5) throw new ValidationError('Say what you checked on Paystack. It is kept on the record.')
    const claim = await this.prisma.treasuryTransfer.updateMany({
      where: { id, status: { in: ['otp', 'unknown'] } },
      data: { status: 'failed', statusNote: `Marked not sent: ${reason}` },
    })
    if (claim.count === 0) {
      throw new ConflictError('NOT_STUCK', 'Only a transfer stuck on an OTP or with no answer can be marked not sent.')
    }
    this.log.warn(`treasury ${id}: marked not sent by ${user.id}, ${reason}`)
  }

  // ── Top-ups ─────────────────────────────────────────────────────────────

  /**
   * Find top-ups in Paystack's balance history.
   *
   * A dashboard top-up is recorded there as a `Transaction`, the same as a
   * customer paying, so the only way to tell one apart is that it is not one
   * of ours: no payment on file carries its Paystack transaction id or its
   * reference. Anything left over is saved for a person to classify, a
   * customer payment we failed to match can be marked "not a top-up".
   */
  async syncTopups(): Promise<{ found: number }> {
    if (!this.syncing) {
      this.syncing = this.runSync().finally(() => {
        this.syncing = null
      })
    }
    return this.syncing
  }

  private async runSync(): Promise<{ found: number }> {
    if (!(await this.enabled())) return { found: 0 }

    const cursor = await this.prisma.setting.findUnique({ where: { key: SYNC_CURSOR_KEY } })
    const startedAt = new Date()
    // A day of overlap: entries are matched by their own id, so re-reading is free.
    // First run looks back one day, top-ups before this existed are not this
    // feature's to guess at.
    const last = (cursor?.value as { at?: string } | null)?.at
    const from = new Date((last ? new Date(last).getTime() : startedAt.getTime()) - 24 * 60 * 60_000)

    let found = 0
    for (let page = 1; page <= 20; page++) {
      const result = await this.paystack.balanceLedger({ from, page })
      if (!result.ok) {
        this.log.warn(`could not read the Paystack balance history: ${result.reason}`)
        return { found }
      }

      const credits = result.entries.filter(
        (e) =>
          e.difference > 0 &&
          (/transaction/i.test(e.model ?? '') || /top.?up/i.test(`${e.model ?? ''} ${e.reason ?? ''}`)),
      )
      if (credits.length > 0) {
        const txnIds = credits.map((e) => e.transactionId).filter((v): v is string => Boolean(v))
        const ours = await this.prisma.payment.findMany({
          where: {
            OR: [
              { providerId: { in: txnIds } },
              { reference: { in: credits.map((e) => e.reason ?? '').filter(Boolean) } },
            ],
          },
          select: { providerId: true, reference: true },
        })
        const ourIds = new Set(ours.map((p) => p.providerId))
        const ourRefs = new Set(ours.map((p) => p.reference))

        for (const entry of credits) {
          const isOurs =
            (entry.transactionId && ourIds.has(entry.transactionId)) ||
            [...ourRefs].some((ref) => entry.reason?.includes(ref))
          if (isOurs) continue
          const created = await this.prisma.paystackTopup.createMany({
            data: [
              {
                ledgerId: entry.id,
                transactionId: entry.transactionId,
                reason: entry.reason,
                amount: entry.difference,
                occurredAt: entry.createdAt,
              },
            ],
            skipDuplicates: true,
          })
          if (created.count > 0) {
            found++
            this.log.warn(`Paystack top-up found: ${ghs(entry.difference)} (${entry.reason ?? 'no reason'})`)
          }
        }
      }
      if (result.entries.length < 100) break
    }

    await this.prisma.setting.upsert({
      where: { key: SYNC_CURSOR_KEY },
      create: { key: SYNC_CURSOR_KEY, value: { at: startedAt.toISOString() } },
      update: { value: { at: startedAt.toISOString() } },
    })
    if (found > 0) this.solvency.invalidate()
    return { found }
  }

  /** Say where a top-up came from. Only `own_money` touches the books. */
  async classifyTopup(id: string, source: Exclude<PaystackTopupSource, 'unclassified'>, user: AuthUser) {
    const topup = await this.prisma.paystackTopup.findUnique({ where: { id } })
    if (!topup) throw new NotFoundError('We could not find that top-up.')
    if (topup.source !== 'unclassified' && user.role !== 'superadmin') {
      throw new ConflictError('ALREADY_CLASSIFIED', 'This top-up was already classified. A superadmin can change it.')
    }

    const key = `paystack-topup:${topup.ledgerId}:owner_topup`
    await this.prisma.$transaction(async (tx) => {
      await tx.paystackTopup.update({
        where: { id },
        data: { source, classifiedBy: user.id, classifiedAt: new Date() },
      })
      await tx.ledgerEntry.deleteMany({ where: { idempotencyKey: key } })
      if (source === 'own_money') {
        await this.ledger.record(
          [
            {
              idempotencyKey: key,
              kind: 'owner_topup',
              amount: topup.amount,
              affectsProfit: false,
              description: `Own money topped up into Paystack: ${ghs(topup.amount)}`,
              occurredAt: topup.occurredAt,
            },
          ],
          tx,
        )
      }
    })
    this.solvency.invalidate()
    this.log.warn(`Paystack top-up ${topup.ledgerId} (${ghs(topup.amount)}) classified ${source} by ${user.id}`)
  }
}
