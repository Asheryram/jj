import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { SettingsService } from '../settings/settings.service'
import { MailerService } from '../mail/mailer.service'
import { LedgerService } from '../finance/ledger.service'
import { ValidationError } from '../common/domain-errors'
import { escape, wrap } from '../mail/templates'

/** One deliberate movement of James's own money into or out of the float. */
export interface CapitalSummary {
  /** Pesewas James has logged putting in, all time. */
  totalIn: number
  /** Pesewas James has logged taking out, all time. */
  totalOut: number
  /** totalIn - totalOut. */
  net: number
  /** When the first entry was logged, or null before anything has been. */
  since: string | null
}

/**
 * Whether the float holds what the logged capital and known spending say it
 * should. Null wherever there isn't enough to check yet — no capital logged,
 * or no observation to compare against.
 */
export interface FloatReconciliation {
  /** Pesewas the float should hold: the baseline, plus capital moved, minus cost, since tracking began. */
  expected: number
  /** Pesewas DataHub actually reports right now. */
  observed: number
  /** expected - observed. Positive means the float holds less than it should. */
  shortfall: number
  /** shortfall exceeds the rounding tolerance, AND the live reading is fresh enough to trust — worth telling someone about. */
  flagged: boolean
  /**
   * The live reading predates the most recent logged capital move, so it
   * cannot possibly reflect it yet — only the next order will. Not a
   * discrepancy, just not confirmed.
   */
  pending: boolean
}

/** Where the balance sits relative to the two thresholds. */
export type FloatLevel = 'ok' | 'watch' | 'risk'

/** One manual refund still owed back to whoever paid it out of their own pocket. */
export interface ManualRefundAdvance {
  orderRef: string
  amount: number
  description: string
  occurredAt: string
}

export interface FloatObservation {
  /** Pesewas left in the provider float. */
  balance: number
  /** When the provider reported it — always the moment of a purchase. */
  observedAt: string
  /** The order whose reply revealed it, for tracing. */
  orderRef: string | null
  level: FloatLevel
  /**
   * What actually decided `level` — the lower of `balance` and what tracked
   * capital says the float should hold. Equal to `balance` unless tracked
   * capital is the more pessimistic of the two, so the screen can explain
   * when the level disagrees with the number shown.
   */
  reference: number
}

const OBSERVATION_KEY = 'supplierFloat'
const ALERT_LEVEL_KEY = 'supplierFloatAlertLevel'
const CAPITAL_BASELINE_KEY = 'supplierFloatCapitalBaseline'
const DISCREPANCY_ALERTED_KEY = 'supplierFloatDiscrepancyAlerted'

/**
 * Pesewas of slack before a shortfall is worth mentioning. DataHub's balance
 * only ever arrives rounded to whole cedis, so a gap under this is rounding
 * noise, not a missing top-up.
 */
const DISCREPANCY_TOLERANCE = 100

const SEVERITY: Record<FloatLevel, number> = { ok: 0, watch: 1, risk: 2 }

/**
 * Which band a balance falls in. A threshold of zero is switched off.
 *
 * At-or-below rather than strictly below, so a threshold set to exactly the
 * remaining balance still counts as reached — the point is to be told before it
 * matters, not after.
 */
function levelFor(balance: number, watchAt: number, riskAt: number): FloatLevel {
  if (riskAt > 0 && balance <= riskAt) return 'risk'
  if (watchAt > 0 && balance <= watchAt) return 'watch'
  return 'ok'
}

/**
 * Watches what is left in the DataHub float and says so before it runs out.
 *
 * The float is prepaid: DataHub deducts the cost of every bundle from a balance
 * James tops up himself, so an empty float does not slow the platform down, it
 * fails every order outright — after the customer has paid. The money then has to
 * come back through the refund queue by hand.
 *
 * Two things make this awkward. There is no balance endpoint, so the figure is
 * knowable exactly once per purchase, from the reply; and it was being parsed and
 * thrown away, so nobody could see it at all until an order failed. Hence: record
 * it whenever it arrives, and email when it crosses a line.
 */
@Injectable()
export class FloatMonitorService {
  private readonly log = new Logger(FloatMonitorService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly mailer: MailerService,
    private readonly ledger: LedgerService,
  ) {}

  /**
   * Record what the provider just said is left, and alert if it crossed a mark.
   *
   * Takes cedis because that is what they send. Never throws: this runs inside
   * the dispatch path, and failing to record a balance must not turn a successful
   * purchase into a failed one.
   */
  async record(balanceCedis: number | null, orderRef: string | null): Promise<void> {
    if (balanceCedis === null || !Number.isFinite(balanceCedis)) return

    try {
      const balance = Math.round(balanceCedis * 100)

      await this.write(OBSERVATION_KEY, {
        balance,
        observedAt: new Date().toISOString(),
        orderRef,
      })

      await this.checkFloat(balance)
    } catch (error) {
      // Deliberately swallowed — see the doc comment above.
      this.log.error(`could not record the provider float: ${String(error)}`)
    }
  }

  /**
   * Re-check the watch/risk level and the capital-vs-float shortfall against
   * a balance, and alert on either one crossing a line since the last check.
   *
   * Called after anything that could move either side of the comparison — a
   * fresh order (via `record`), or James logging capital (via `logCapital`) —
   * so a risk that tracked capital reveals never has to sit unnoticed until
   * the next sale happens to confirm it.
   */
  private async checkFloat(balance: number): Promise<void> {
    const { floatWatchAt, floatRiskAt } = await this.settings.all()
    const reference = await this.referenceBalance(balance)
    const level = levelFor(reference, floatWatchAt, floatRiskAt)
    const previous = await this.alertLevel()

    /**
     * Only on a change, and only email downwards.
     *
     * Every order reports the balance, so alerting on the level itself would
     * send one email per order for as long as the float stayed low — dozens on
     * a busy afternoon, which trains you to ignore them. A recovery is recorded
     * silently: seeing the balance climb is not news, and it re-arms the alert
     * for the next time it falls.
     */
    if (level !== previous) {
      await this.write(ALERT_LEVEL_KEY, level)
      if (SEVERITY[level] > SEVERITY[previous]) {
        await this.alert(level, balance, reference, floatWatchAt, floatRiskAt)
      } else {
        this.log.log(`float recovered to ${level} (GHS ${(reference / 100).toFixed(2)})`)
      }
    }

    const reconciliation = await this.reconcile()
    if (reconciliation) await this.checkDiscrepancy(reconciliation)
  }

  /** The last reading, for the admin screens. Null before any purchase. */
  async latest(): Promise<FloatObservation | null> {
    const row = await this.prisma.setting.findUnique({ where: { key: OBSERVATION_KEY } })
    if (!row) return null

    const stored = row.value as { balance?: unknown; observedAt?: unknown; orderRef?: unknown }
    const balance = Number(stored.balance)
    if (!Number.isFinite(balance)) return null

    const { floatWatchAt, floatRiskAt } = await this.settings.all()
    const reference = await this.referenceBalance(balance)
    return {
      balance,
      observedAt:
        typeof stored.observedAt === 'string' ? stored.observedAt : row.updatedAt.toISOString(),
      orderRef: typeof stored.orderRef === 'string' ? stored.orderRef : null,
      level: levelFor(reference, floatWatchAt, floatRiskAt),
      reference,
    }
  }

  /**
   * Record James putting his own money into the float, or taking it back out.
   *
   * DataHub sends no notice when a top-up happens, so this only exists because
   * James says so. Written as `capital_in`/`capital_out` with `affectsProfit:
   * false` — it is a balance-sheet movement, not income or cost, and must
   * never shift the P&L in `money-audit.ts`.
   *
   * `source` only matters for a top-up (`direction: 'in'`), and only changes
   * the `LedgerKind` it is written under:
   *
   *  - `'external'` (the default) — fresh money from outside the business.
   *  - `'reimbursement'` — money already collected from customers to cover
   *    what DataHub charges for their bundles, sitting in Paystack rather
   *    than the float, now moved across to where it was always meant to end
   *    up. Written as `capital_in_reimbursement` instead of `capital_in` so
   *    `SolvencyService` can tell the two apart — only this kind reduces
   *    "already spent on bundles" there, because only this kind is actually
   *    settling that specific amount, not adding new capital on top of it.
   */
  async logCapital(input: {
    direction: 'in' | 'out'
    amount: number
    note?: string
    idempotencyKey: string
    source?: 'external' | 'reimbursement'
  }): Promise<void> {
    if (!Number.isInteger(input.amount) || input.amount <= 0) {
      throw new ValidationError('Enter an amount greater than zero.')
    }

    /**
     * The anchor for `reconcile()`, captured once — the first time James logs
     * anything — from whatever the float last read. Everything before this
     * moment is out of scope: DataHub gave no notice of any earlier top-up or
     * spend, so there is nothing honest to reconstruct that far back.
     *
     * Falls back to zero when there is no reading yet at all — a shop that has
     * never dispatched an order has, by definition, never spent from the
     * float, so zero is the only honest place for tracking to start. Leaving
     * the baseline uncaptured here would only defer it to some later log,
     * which then double-counts whatever was logged in between.
     */
    /**
     * Captured atomically, not just read-then-write.
     *
     * Two first-ever `logCapital` calls landing close together would both see
     * no baseline yet. `write()` is an `upsert`, which updates rather than
     * skips on a conflict — so whichever call's write happened to land last
     * would silently overwrite the other's baseline with a value observed at
     * the wrong moment, permanently. `createMany` with `skipDuplicates` is a
     * real `INSERT ... ON CONFLICT DO NOTHING` at the database level: only the
     * genuinely first call's value can ever land, no matter how close behind
     * it the second one runs.
     */
    const hasBaseline = await this.prisma.setting.findUnique({ where: { key: CAPITAL_BASELINE_KEY } })
    if (!hasBaseline) {
      const observation = await this.latest()
      await this.prisma.setting.createMany({
        data: [
          {
            key: CAPITAL_BASELINE_KEY,
            value: { balance: observation?.balance ?? 0, capturedAt: new Date().toISOString() },
          },
        ],
        skipDuplicates: true,
      })
    }

    const reimbursement = input.direction === 'in' && input.source === 'reimbursement'
    const ghs = (input.amount / 100).toFixed(2)
    const description = input.note
      ? input.note
      : input.direction === 'in'
        ? reimbursement
          ? `Moved to DataHub from Paystack: GHS ${ghs}`
          : `Capital added: GHS ${ghs}`
        : `Capital withdrawn: GHS ${ghs}`

    await this.ledger.record([
      {
        kind: input.direction === 'in' ? (reimbursement ? 'capital_in_reimbursement' : 'capital_in') : 'capital_out',
        amount: input.direction === 'in' ? input.amount : -input.amount,
        description,
        occurredAt: new Date(),
        affectsProfit: false,
        idempotencyKey: input.idempotencyKey,
      },
    ])

    /**
     * A logged withdrawal can push tracked capital into risk on its own,
     * without any order to trigger a re-check — waiting for the next sale to
     * notice would leave that risk silent for however long it takes to sell
     * again. Skipped only when there is truly no live reading yet to check
     * against (a shop that has never dispatched an order).
     */
    const observation = await this.latest()
    if (observation) await this.checkFloat(observation.balance)
  }

  /**
   * Cumulative capital James has logged putting in and taking out, all time.
   *
   * `capital_in_reimbursement` counts as capital in here alongside plain
   * `capital_in` — from the float's own point of view both are money landing
   * in it, and the float does not care where a top-up's money came from.
   * That distinction only matters one place: `SolvencyService.spentOnBundles`,
   * which is the only reader that cares whether a top-up settled money
   * already owed to DataHub rather than adding fresh capital on top of it.
   *
   * `orderRef: null` (and, identically, `withdrawalId: null`) is deliberate,
   * not incidental. `capital_in`/`capital_out` are also written by
   * `RefundsService.settleManually`/`reimburseManualRefund` (keyed by
   * `orderRef`) and `WithdrawalsService.settleManually`/`reimburseManualAdvance`
   * (keyed by `withdrawalId`) — a completely different thing that happens to
   * share this kind: money someone personally sent a *customer* or an *agent*
   * back, unrelated to the DataHub float. Those always carry one of the two;
   * a real top-up logged through `logCapital` never carries either. Without
   * this filter, an outstanding manual refund or payout advance was being
   * counted as float capital, inflating "should hold" by exactly that amount
   * — the float and a refund or payout advance are different money and must
   * never be added together.
   */
  async capitalSummary(): Promise<CapitalSummary> {
    const capitalInKinds = ['capital_in', 'capital_in_reimbursement'] as const
    const [totals, first] = await Promise.all([
      this.prisma.ledgerEntry.groupBy({
        by: ['kind'],
        where: { kind: { in: [...capitalInKinds, 'capital_out'] }, orderRef: null, withdrawalId: null },
        _sum: { amount: true },
      }),
      this.prisma.ledgerEntry.findFirst({
        where: { kind: { in: [...capitalInKinds, 'capital_out'] }, orderRef: null, withdrawalId: null },
        orderBy: { occurredAt: 'asc' },
        select: { occurredAt: true },
      }),
    ])

    const totalIn = totals
      .filter((t) => (capitalInKinds as readonly string[]).includes(t.kind))
      .reduce((sum, t) => sum + (t._sum.amount ?? 0), 0)
    const totalOut = -(totals.find((t) => t.kind === 'capital_out')?._sum.amount ?? 0)

    return {
      totalIn,
      totalOut,
      net: totalIn - totalOut,
      since: first?.occurredAt.toISOString() ?? null,
    }
  }

  /**
   * Manual refunds still owed back to whoever paid them.
   *
   * A `capital_in` entry with an order attached is not a deliberate top-up —
   * it is `RefundsService.settleManually` recording that a Mobile Money
   * refund was paid from someone's own pocket because Paystack refused the
   * transfer outright. That money is owed back until a matching `capital_out`
   * on the same order says it was taken back out; this lists every one that
   * is not yet matched, so it is never just a bare "owed" total nobody can
   * trace back to a specific refund.
   */
  async outstandingManualRefunds(): Promise<ManualRefundAdvance[]> {
    const [advances, reimbursed] = await Promise.all([
      this.prisma.ledgerEntry.findMany({
        where: { kind: 'capital_in', orderRef: { not: null } },
        orderBy: { occurredAt: 'asc' },
      }),
      this.prisma.ledgerEntry.findMany({
        where: { kind: 'capital_out', orderRef: { not: null } },
        select: { orderRef: true },
      }),
    ])

    const settled = new Set(reimbursed.map((r) => r.orderRef))
    return advances
      .filter((a) => !settled.has(a.orderRef))
      .map((a) => ({
        orderRef: a.orderRef as string,
        amount: a.amount,
        description: a.description,
        occurredAt: a.occurredAt.toISOString(),
      }))
  }

  /**
   * Settle one manual advance: whoever fronted it has taken the exact amount
   * back out of the business.
   *
   * Locked to what was actually advanced rather than an amount typed in here —
   * a partial or unrelated withdrawal belongs in `logCapital` instead, not
   * this one. This is specifically for closing out a single traced refund.
   */
  async reimburseManualRefund(orderRef: string, adminId: string): Promise<void> {
    const advance = await this.prisma.ledgerEntry.findFirst({
      where: { kind: 'capital_in', orderRef },
    })
    if (!advance) {
      throw new ValidationError('No outstanding manual refund found for that order.')
    }

    await this.ledger.record([
      {
        kind: 'capital_out',
        amount: -advance.amount,
        description: `Reimbursed — refund ${orderRef}`,
        orderRef,
        occurredAt: new Date(),
        affectsProfit: false,
        idempotencyKey: LedgerService.key('order', orderRef, 'capital_out'),
      },
    ])

    this.log.log(`manual refund advance for ${orderRef} reimbursed by ${adminId}`)
  }

  /**
   * What the float should hold right now, going only by tracked capital —
   * independent of any live reading. Forward-only from the baseline captured
   * at the first logged top-up: the baseline plus every capital move since,
   * minus every bundle paid for since. It deliberately does not reach further
   * back: sales from before capital tracking began have no matching top-up on
   * record, so pulling in their cost would make the float look short for no
   * real reason.
   *
   * Null until James has logged at least one capital move.
   */
  private async expectedBalance(): Promise<{ balance: number; capturedAt: Date } | null> {
    const baselineRow = await this.prisma.setting.findUnique({ where: { key: CAPITAL_BASELINE_KEY } })
    if (!baselineRow) return null

    const stored = baselineRow.value as { balance?: unknown; capturedAt?: unknown }
    const baselineBalance = Number(stored.balance)
    const capturedAt = typeof stored.capturedAt === 'string' ? new Date(stored.capturedAt) : null
    if (!Number.isFinite(baselineBalance) || !capturedAt) return null

    const [capital, cost] = await Promise.all([
      this.capitalSummary(),
      this.prisma.ledgerEntry.aggregate({
        where: { kind: 'supplier_cost', occurredAt: { gte: capturedAt } },
        _sum: { amount: true },
      }),
    ])

    // supplier_cost entries are already negative (money leaving the float).
    return { balance: baselineBalance + capital.net + (cost._sum.amount ?? 0), capturedAt }
  }

  /**
   * The number that actually gates risk: the lower of the live reading and
   * what tracked capital says the float should hold.
   *
   * Neither number alone is safe to rely on. The live reading only refreshes
   * per order, so it can sit stale-high for a while right after an unlogged
   * withdrawal — and tracked capital can sit stale-low right after a real
   * top-up the live reading hasn't caught up to yet. Taking the lower of the
   * two means a bigger number on either side can never mask a real risk the
   * other one is already showing.
   */
  private async referenceBalance(observedBalance: number): Promise<number> {
    const expected = await this.expectedBalance()
    return expected ? Math.min(observedBalance, expected.balance) : observedBalance
  }

  /**
   * Does the float hold what it should? Null until there is a baseline and a
   * live reading to compare it to.
   */
  async reconcile(): Promise<FloatReconciliation | null> {
    const expected = await this.expectedBalance()
    if (!expected) return null

    const observation = await this.latest()
    if (!observation) return null

    const lastMovement = await this.prisma.ledgerEntry.findFirst({
      where: { kind: { in: ['capital_in', 'capital_out'] } },
      orderBy: { occurredAt: 'desc' },
      select: { occurredAt: true },
    })

    const observed = observation.balance
    const shortfall = expected.balance - observed

    /**
     * A reading older than the last logged move cannot possibly reflect it —
     * DataHub only ever reports the balance in the reply to an order, so
     * nothing short of a new order can confirm a top-up or withdrawal just
     * logged. Flagging against a stale reading would call every log a
     * shortfall the moment it's saved.
     */
    const pending = Boolean(
      lastMovement && new Date(observation.observedAt) < lastMovement.occurredAt,
    )

    return {
      expected: expected.balance,
      observed,
      shortfall,
      pending,
      flagged: !pending && shortfall > DISCREPANCY_TOLERANCE,
    }
  }

  private async alertLevel(): Promise<FloatLevel> {
    const row = await this.prisma.setting.findUnique({ where: { key: ALERT_LEVEL_KEY } })
    const value = row?.value
    return value === 'watch' || value === 'risk' ? value : 'ok'
  }

  /**
   * Email only on the shortfall's edges — appearing and clearing — the same
   * debounce as the watch/risk alert above. A float holding *more* than
   * expected is never flagged: that just means a top-up hasn't been logged
   * yet, or there is simply headroom, neither of which is a problem.
   */
  private async checkDiscrepancy(r: FloatReconciliation): Promise<void> {
    const wasAlerted = await this.discrepancyAlerted()
    if (r.flagged && !wasAlerted) {
      await this.write(DISCREPANCY_ALERTED_KEY, true)
      await this.alertDiscrepancy(r)
    } else if (!r.flagged && wasAlerted) {
      await this.write(DISCREPANCY_ALERTED_KEY, false)
      this.log.log(
        `float discrepancy cleared (expected GHS ${(r.expected / 100).toFixed(2)}, ` +
          `observed GHS ${(r.observed / 100).toFixed(2)})`,
      )
    }
  }

  private async discrepancyAlerted(): Promise<boolean> {
    const row = await this.prisma.setting.findUnique({ where: { key: DISCREPANCY_ALERTED_KEY } })
    return row?.value === true
  }

  private async write(key: string, value: unknown): Promise<void> {
    await this.prisma.setting.upsert({
      where: { key },
      create: { key, value: value as never },
      update: { value: value as never },
    })
  }

  private async platformName(): Promise<string> {
    const branding = await this.prisma.branding.findFirst({ where: { userId: null } })
    return branding?.shopName ?? 'JamesDataConsult'
  }

  /** Tell whoever funds the float — see the doc comment on the query below. */
  private async alert(
    level: FloatLevel,
    balance: number,
    reference: number,
    watchAt: number,
    riskAt: number,
  ): Promise<void> {
    /**
     * Every active admin, because it is everyone's business when the float
     * runs out — an order fails for a customer no matter which admin happens
     * to be looking. Falls back to every active superadmin only when no admin
     * exists yet, so a platform mid-setup is not silent either.
     */
    const admins = await this.prisma.user.findMany({
      where: { role: 'admin', status: 'active' },
      select: { name: true, email: true },
    })
    const recipients =
      admins.length > 0
        ? admins
        : await this.prisma.user.findMany({
            where: { role: 'superadmin', status: 'active' },
            select: { name: true, email: true },
          })

    const ghs = (p: number) => `GHS ${(p / 100).toFixed(2)}`

    if (recipients.length === 0) {
      this.log.warn(`float is ${level} at ${ghs(reference)} — nobody to tell`)
      return
    }

    const threshold = level === 'risk' ? riskAt : watchAt
    const urgent = level === 'risk'
    const shopName = await this.platformName()

    /**
     * The live reading and tracked capital can disagree — see `referenceBalance`.
     * When tracked capital is the more pessimistic of the two, say so plainly:
     * otherwise this email shows a number lower than what DataHub itself
     * reports, which reads as a mistake rather than the point of the check.
     */
    const trackedIsLower = reference < balance

    const consequence = urgent
      ? 'This is urgent: once it runs out, every paid order fails after the customer has already been charged, and each one then has to be refunded by hand. Top up your DataHub float now to avoid that.'
      : 'There is still time to top up before anything fails — no order has been affected yet.'

    const subject = urgent
      ? `Float critically low — ${ghs(reference)} left`
      : `Float getting low — ${ghs(reference)} left`

    const pillBg = urgent ? '#fee2e2' : '#fef3c7'
    const pillFg = urgent ? '#b3261e' : '#92400e'
    const statBg = urgent ? '#fef2f2' : '#fffbeb'
    const statBorder = urgent ? '#fecaca' : '#fde68a'

    const footer =
      `You are getting this because you are an active admin on ${escape(shopName)}. ` +
      "It is sent only when the float's status gets worse, never on every order."

    // Sent one at a time rather than in parallel — this is a handful of admins
    // at most, and one slow send should not race a second SMTP connection for
    // no benefit.
    for (const recipient of recipients) {
      const html = wrap(
        shopName,
        urgent ? 'Your float is critically low' : 'Your float is running low',
        `<div style="text-align:center;margin:0 0 20px">
           <span style="display:inline-block;padding:4px 14px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.4px;background:${pillBg};color:${pillFg}">
             ${urgent ? 'ACTION NEEDED' : 'HEADS UP'}
           </span>
         </div>
         <p style="margin:0 0 18px;font-size:15px;line-height:1.6">Hello ${escape(recipient.name)}, your DataHub GH
           float ${urgent ? 'is critically low' : 'is getting low'}.</p>
         <div style="text-align:center;background:${statBg};border:1px solid ${statBorder};border-radius:12px;padding:20px;margin:0 0 20px">
           <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:0.4px;color:${pillFg};text-transform:uppercase">Float remaining</p>
           <p style="margin:0;font-size:34px;font-weight:800;color:${pillFg}">${ghs(reference)}</p>
           <p style="margin:8px 0 0;font-size:12.5px;color:${pillFg}">below your ${ghs(threshold)} alert line</p>
         </div>
         <p style="margin:0 0 20px;font-size:14.5px;line-height:1.6;font-weight:${urgent ? '700' : '400'};color:${urgent ? '#b3261e' : '#1e293b'}">${escape(consequence)}</p>
         ${
           trackedIsLower
             ? `<p style="margin:0 0 8px;font-size:12.5px;line-height:1.6;color:#64748b">DataHub itself still reports ${escape(ghs(balance))} —
           this is based on the capital you've logged instead, which is lower and hasn't been confirmed by a fresh
           order yet.</p>`
             : ''
         }
         <p style="margin:0 0 8px;font-size:12.5px;line-height:1.6;color:#64748b">This figure comes from the reply to
           your most recent order — DataHub has no balance endpoint to ask directly, so it is only ever as current
           as your last sale.</p>
         <p style="margin:0;font-size:12.5px;line-height:1.6;color:#64748b">You will not get this again until the
           float recovers and falls past the same point, so it will not repeat on every order.</p>`,
        footer,
      )

      const text = [
        `Hello ${recipient.name},`,
        '',
        urgent ? '*** ACTION NEEDED ***' : '*** HEADS UP ***',
        `Your DataHub GH float ${urgent ? 'is critically low' : 'is getting low'}.`,
        '',
        `FLOAT REMAINING: ${ghs(reference)} (below your ${ghs(threshold)} alert line)`,
        '',
        consequence,
        '',
        ...(trackedIsLower
          ? [
              `DataHub itself still reports ${ghs(balance)} — this is based on the capital you've logged instead, which is lower and hasn't been confirmed by a fresh order yet.`,
              '',
            ]
          : []),
        'This figure comes from the reply to your most recent order — DataHub has no balance endpoint to ask directly, so it is only ever as current as your last sale.',
        '',
        'You will not get this again until the float recovers and falls past the same point, so it will not repeat on every order.',
      ].join('\n')

      await this.mailer.send({ to: recipient.email, subject, html, text }).catch((error) => {
        // One admin's mail server having a bad day must not stop the rest
        // from being warned.
        this.log.error(`could not tell ${recipient.email} about the float: ${String(error)}`)
      })
    }

    this.log.warn(
      `float ${level}: ${ghs(reference)} (threshold ${ghs(threshold)}${trackedIsLower ? `, live is ${ghs(balance)}` : ''}) — told ` +
        recipients.map((r) => r.email).join(', '),
    )
  }

  /** Tell whoever funds the float that it holds less than the logged capital says it should. */
  private async alertDiscrepancy(r: FloatReconciliation): Promise<void> {
    const admins = await this.prisma.user.findMany({
      where: { role: 'admin', status: 'active' },
      select: { name: true, email: true },
    })
    const recipients =
      admins.length > 0
        ? admins
        : await this.prisma.user.findMany({
            where: { role: 'superadmin', status: 'active' },
            select: { name: true, email: true },
          })

    const ghs = (p: number) => `GHS ${(p / 100).toFixed(2)}`
    const shopName = await this.platformName()

    if (recipients.length === 0) {
      this.log.warn(`float short by ${ghs(r.shortfall)} — nobody to tell`)
      return
    }

    const subject = `Float is short by ${ghs(r.shortfall)}`
    const body =
      `<p style="margin:0 0 18px;font-size:15px;line-height:1.6">The DataHub GH float should hold ` +
      `${escape(ghs(r.expected))}, going by the capital you've logged and what orders have spent since. ` +
      `It actually holds ${escape(ghs(r.observed))} — ${escape(ghs(r.shortfall))} short.</p>` +
      `<p style="margin:0 0 20px;font-size:14.5px;line-height:1.6;color:#1e293b">This usually means a top-up or ` +
      `withdrawal happened without being logged. Check the float panel and log it if so — this note will not ` +
      `repeat until the gap changes.</p>`

    const html = wrap(shopName, 'Your float is short', body, `You are getting this because you are an active admin on ${escape(shopName)}.`)
    const text =
      `The DataHub GH float should hold ${ghs(r.expected)}, going by the capital you've logged and what orders ` +
      `have spent since. It actually holds ${ghs(r.observed)} — ${ghs(r.shortfall)} short.\n\n` +
      `This usually means a top-up or withdrawal happened without being logged. Check the float panel and log it ` +
      `if so — this note will not repeat until the gap changes.`

    for (const recipient of recipients) {
      await this.mailer
        .send({ to: recipient.email, subject, html, text })
        .catch((error) => this.log.error(`could not tell ${recipient.email} about the float shortfall: ${String(error)}`))
    }

    this.log.warn(
      `float short by ${ghs(r.shortfall)} (expected ${ghs(r.expected)}, observed ${ghs(r.observed)}) — told ` +
        recipients.map((rec) => rec.email).join(', '),
    )
  }
}
