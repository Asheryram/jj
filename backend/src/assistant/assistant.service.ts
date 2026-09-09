import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Groq, { RateLimitError } from 'groq-sdk'
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'groq-sdk/resources/chat/completions'
import { isAdminRole, type AuthUser } from '../common/auth'
import { PrismaService } from '../prisma/prisma.service'
import { AgentsService } from '../agents/agents.service'
import { DomainsService } from '../domains/domains.service'
import { FloatMonitorService } from '../supplier/float-monitor.service'
import { RefundsService } from '../orders/refunds.service'
import { ApprovalsService } from '../orders/approvals.service'
import { ReconcilerService } from '../supplier/reconciler.service'
import { PricingService } from '../pricing/pricing.service'
import { resalePriceFor } from '../domain/pricing'
import { AdminService } from '../admin/admin.service'
import { ApplicationsService } from '../admin/applications.service'
import { BrandingService } from '../branding/branding.service'
import { WithdrawalsService } from '../withdrawals/withdrawals.service'
import { LedgerService } from '../finance/ledger.service'
import { SettingsService } from '../settings/settings.service'
import { OrdersService } from '../orders/orders.service'

/**
 * Free-tier friendly, and deliberately so: this answers plain questions about
 * an agent's own account from a handful of small read-only lookups, not hard
 * reasoning — the kind of workload where a bigger model buys nothing but cost.
 */
const MODEL = 'openai/gpt-oss-20b'

const MAX_TOOL_ROUNDS = 4

const AGENT_TOOLS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_my_earnings',
      description: "The agent's current wallet balance and recent earnings history.",
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_my_prices',
      description:
        "The agent's actual current selling price, their own cost, and their own profit for every bundle, whether they've set their own price or it's still the standard one, each tagged with its real network (MTN, Telecel or AirtelTigo). Use this for any question about how much a bundle costs, or how much profit/margin the agent makes per sale. When asked about one network, filter using the network field this returns — never guess a product's network from its name, since names like \"1GB Data\" or \"iShare\" don't reliably say which network they're on.",
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_my_downline',
      description:
        'The agents this agent has personally referred (their "downline") and how much each has sold — for the agent\'s own visibility only. Referring someone pays no bonus of any kind, so never imply there is money to earn from this list.',
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_my_domain',
      description: "The status of the agent's own custom domain request, if they have one.",
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_my_top_products',
      description:
        "Which products the agent has sold the most of, ranked by number of completed sales. Use this for any question about what's popular, best-selling, or most bought — never try to work it out yourself from the earnings list.",
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_my_withdrawals',
      description:
        "The agent's own recent withdrawal (payout) requests and where each one stands — pending, paid, rejected, and so on.",
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_my_recent_orders',
      description:
        "The agent's most recent sales (their own and their downline's), each with its reference, product, status, amount and date — use this for any question about a specific order or sale, or whether one went through.",
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_my_summary',
      description:
        "How the agent's shop is doing right now: earned today, earned all time, orders today vs completed vs total, how many of their downline are active, and this week's earnings against last week's — use this for any \"how am I doing\" or \"how's business\" style question.",
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_my_branding_status',
      description:
        "The status of the agent's own shop-look (branding) request — their live shop name/colour/logo, anything still waiting on an admin's decision, and the most recent decision if one was made.",
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_my_markup',
      description:
        "The agent's own default markup percentage — the extra they charge above cost on any product they haven't set a specific price for.",
    },
  },
]

const ADMIN_TOOLS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_float_status',
      description:
        "The DataHub float: what it should hold going by logged capital and spending, and what DataHub's last reply actually reported.",
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_pending_refunds',
      description: 'Refund requests still waiting on a decision, oldest first.',
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_pending_number_approvals',
      description:
        'Phone numbers still waiting on DataHub to approve them for delivery, and how much paid business is held up by each.',
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_needs_attention',
      description:
        'Orders nothing automatic has resolved — stuck in progress too long, or flagged because two different sources disagreed on the outcome.',
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_pending_withdrawals',
      description: 'Agent withdrawal (payout) requests still waiting on a decision, oldest first.',
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_pending_domain_requests',
      description: "Custom domain requests still waiting on a decision, oldest first.",
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_business_overview',
      description:
        "The last 30 days of the whole business: orders, revenue, payment fees, delivery success rate, average order value, active agents, customers, pending withdrawals, unclaimed refund credits, this week vs last week's revenue, the refund rate, this week's checkout funnel, and agents who used to sell but have gone quiet. Use this for any general \"how's the business doing\" question.",
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_profit_statement',
      description:
        "The real profit and loss for the last 30 days — revenue minus every actual cost (supplier cost, payment fees, agent margins, referral bonuses, refunds, payout fees), not just revenue. Use this for any question about actual profit or how much the business has made, not just sold.",
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_agent_stats',
      description:
        'How many agents the platform has in total, how much they have earned and sold all-time, and any new agent applications still waiting for a decision.',
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_catalogue_accuracy',
      description:
        "Whether the catalogue's believed cost for each product still matches what the supplier actually charged on its most recent sale — flags a product whose real cost has drifted from what the books assume.",
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_pending_branding_requests',
      description: "Agent shop-look (branding) requests still waiting for an approval decision, oldest first.",
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_platform_settings',
      description:
        'The platform\'s current configuration: whether new agent signups are open, whether agents are auto-approved, the minimum withdrawal amount, the float watch/risk thresholds, the Paystack processing fee, and the current site notice banner if one is set.',
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_outstanding_manual_advances',
      description:
        "Payouts or refunds an admin covered out of their own pocket (because Paystack couldn't send it) that the business still owes back to them.",
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_float_risk_products',
      description:
        'Which specific products cost more than the float can currently cover right now — the detail behind a plain "is the float okay" answer. This also lists every product that is not on sale at all, for any reason (a fresh import with no price set yet, a product James discontinued, or genuine float risk) — never assume a product is inactive because of the float unless it also appears in the at-risk list.',
    },
  },
]

/**
 * The in-app help assistant — " Assistant " rather than a static page.
 * Read-only by design: it can look up real account or platform data to answer
 * plainly, but it can never change a price, approve a refund, resolve an
 * order, or anything else — those stay a deliberate click in the app, not
 * something a typed sentence can trigger by accident.
 *
 * Shared by every role, with a completely different tool set and voice
 * depending on who's asking: an agent's questions are about their own shop
 * and earnings; an admin or superadmin's are about running the platform
 * itself. The read-only boundary and the plain-language rule are the same
 * for both — see `systemPrompt` and `AGENT_TOOLS`/`ADMIN_TOOLS` below.
 *
 * The people asking are not developers. Every answer has to read the way
 * `AdminOrders.tsx`'s `explain()` already talks to James — plain words, no
 * jargon, a short answer first — which is why that voice is spelled out in
 * the system prompt below rather than left to the model to guess at.
 *
 * Runs on Groq rather than Claude or Gemini — a second deliberate swap.
 * Anthropic usage hit a billing wall; Gemini's free tier turned out to cap
 * at 20 requests/day, shared across everyone testing it, and emptied twice
 * within about fifteen minutes of light use. Groq needs no card on file,
 * but is not actually wall-free either: this account's on-demand tier has a
 * hard 200,000-tokens/day ceiling, confirmed live by hitting it (a 429 with
 * `error.type: "tokens"`) — see the `RateLimitError` branch in `ask()` below
 * for what a caller actually sees when that happens. Real, low-volume usage
 * is unlikely to hit this in a normal day; heavy testing does. Nothing about
 * the app's own tone or the read-only boundary changed; only the provider did.
 */
@Injectable()
export class AssistantService {
  private readonly log = new Logger(AssistantService.name)
  private readonly client: Groq | null

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly agents: AgentsService,
    private readonly domains: DomainsService,
    private readonly float: FloatMonitorService,
    private readonly refunds: RefundsService,
    private readonly approvals: ApprovalsService,
    private readonly reconciler: ReconcilerService,
    private readonly pricing: PricingService,
    private readonly admin: AdminService,
    private readonly applications: ApplicationsService,
    private readonly branding: BrandingService,
    private readonly withdrawals: WithdrawalsService,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
    private readonly orders: OrdersService,
  ) {
    const apiKey = this.config.get<string>('GROQ_API_KEY')
    this.client = apiKey ? new Groq({ apiKey }) : null
  }

  async ask(
    user: AuthUser,
    message: string,
    history: { role: 'user' | 'assistant'; content: string }[] = [],
  ): Promise<{ reply: string }> {
    if (!this.client) {
      return {
        reply: "The help assistant isn't set up yet — ask an admin to add the Groq API key.",
      }
    }

    const admin = isAdminRole(user.role)
    const tools = admin ? ADMIN_TOOLS : AGENT_TOOLS

    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: this.systemPrompt(user, admin) },
      ...history.map((turn) => ({ role: turn.role, content: turn.content }) as ChatCompletionMessageParam),
      { role: 'user', content: message },
    ]

    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const response = await this.client.chat.completions.create({
          model: MODEL,
          messages,
          tools,
        })

        const reply = response.choices[0]?.message
        if (!reply) break
        messages.push(reply)

        const calls = reply.tool_calls
        if (!calls || calls.length === 0) {
          return { reply: (reply.content ?? '').trim() }
        }

        for (const call of calls) {
          const result = await this.runTool(call.function.name, user, admin)
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) })
        }
      }

      // Ran out of rounds without a final answer — say so plainly rather
      // than silently returning nothing.
      return {
        reply: "Sorry, I couldn't work that out. Try asking it a different way, or check the app directly.",
      }
    } catch (error) {
      // Confirmed live: this is a real, distinct failure mode, not a rare
      // edge case — Groq's on-demand tier has a hard 200,000-tokens/day
      // ceiling, and heavy use of this feature (or just a busy day) can hit
      // it. Told to a user as "under maintenance" on purpose — a free-tier
      // quota is an internal cost detail, not something worth explaining to
      // an agent or admin — but it's logged here in full so whoever reads
      // the server log knows exactly why, and that retrying in the next few
      // minutes won't help; the real wait is until the daily quota resets.
      if (error instanceof RateLimitError) {
        const kind = (error.error as { error?: { type?: string } } | null)?.error?.type
        this.log.error(`assistant rate limited (${kind ?? 'unknown'}): ${String(error)}`)
        return {
          reply:
            kind === 'tokens'
              ? "The help assistant is under maintenance right now — please try again a bit later."
              : "The help assistant is getting a lot of questions right now — please wait a minute and try again.",
        }
      }
      // A broken assistant reply must never look like a broken app — this
      // is a help feature, not the checkout or the ledger.
      this.log.error(`assistant request failed: ${String(error)}`)
      return { reply: 'Something went wrong answering that — please try again in a moment.' }
    }
  }

  /**
   * Every money field this app holds is an integer in pesewas — the model has
   * no way to know that on its own, and handing it a raw `325` reads as
   * "GHS 325" rather than the GHS 3.25 it actually is (confirmed live: that
   * exact misreading is what a raw `earnings.balance` produced here before
   * this existed). So every tool result is reshaped into plain cedis before
   * it ever reaches the model, the same way `cedis()` does for the UI —
   * nothing pesewas-denominated is ever handed over as-is.
   */
  private toCedis(pesewas: number): number {
    return Math.round(pesewas) / 100
  }

  private async runTool(name: string, user: AuthUser, admin: boolean): Promise<unknown> {
    if (admin) return this.runAdminTool(name)
    return this.runAgentTool(name, user)
  }

  private async runAgentTool(name: string, user: AuthUser): Promise<unknown> {
    switch (name) {
      case 'get_my_earnings': {
        const { balance, earnings } = await this.agents.earnings(user.id)
        return {
          balanceGhs: this.toCedis(balance),
          recentEarnings: earnings.slice(0, 20).map((e) => ({
            amountGhs: this.toCedis(e.amount),
            description: e.description,
            date: e.createdAt,
          })),
        }
      }
      case 'get_my_prices': {
        // Deliberately every active product's actual current price, not just
        // the ones the agent has personally overridden — "what's my price for
        // 1GB?" has a real answer even when it's still the standard one, and
        // the old version (just the override table) left the assistant with
        // nothing to say for any product an agent hadn't touched.
        const [agents, products] = await Promise.all([
          this.pricing.agents(),
          this.prisma.product.findMany({ where: { active: true } }),
        ])
        const agent = agents.find((a) => a.userId === user.id)
        if (!agent) return []
        return products.map((p) => {
          const salePesewas = resalePriceFor(agent, {
            id: p.id,
            supplierCost: p.supplierCost,
            adminPrice: p.adminPrice,
            standardPrice: p.standardPrice,
          })
          return {
            product: p.name,
            // A product's own name never says which network it's on — "1GB
            // Data" exists on both MTN and Telecel with the same name, and
            // "iShare" (AirtelTigo's own bundle brand) doesn't say
            // "AirtelTigo" either. Confirmed live: without this field the
            // model guessed at network from the name and got it wrong
            // (called AirtelTigo's iShare bundles "MTN"). Always filter by
            // this field, never by reading the network out of the name.
            network: p.network,
            priceGhs: this.toCedis(salePesewas),
            // What the agent themselves pays James for this bundle — their
            // own real floor, same number the pricing band on the actual
            // Pricing screen shows them. Not `supplierCost` (James's own
            // wholesale cost): that stays admin-only, on purpose — see
            // `toProduct`'s stripping comment in mappers.ts.
            costGhs: this.toCedis(p.adminPrice),
            profitGhs: this.toCedis(salePesewas - p.adminPrice),
            isCustomPrice: agent.prices?.some((pr) => pr.productId === p.id) ?? false,
          }
        })
      }
      case 'get_my_downline': {
        // No earnings figure here, on purpose — referring someone pays no
        // bonus (see `pricing.ts`'s "Referring earns nothing"), so there is
        // no honest non-zero number to report. `AgentsService.downline`'s own
        // `earnedForUpline` can only ever be a leftover from before that rule
        // took effect; surfacing it here previously led the model to invent
        // an explanation for why it was zero, which was worse than the
        // original gap. Same information Referrals.tsx shows: visibility
        // only, never earnings.
        const downline = await this.agents.downline(user.referralCode)
        return downline.map((a) => ({
          name: a.name,
          joinedAt: a.joinedAt,
          ordersSold: a.orders,
          salesVolumeGhs: this.toCedis(a.volume),
        }))
      }
      case 'get_my_domain': {
        const domain = await this.domains.mine(user.id)
        return domain ?? { requested: false, note: "This agent has never requested a custom domain." }
      }
      case 'get_my_top_products': {
        // Computed here rather than left for the model to work out by
        // eyeballing the earnings list — confirmed live that this model
        // family won't reliably do that arithmetic itself and would rather
        // claim it doesn't have the information at all. A ranked count is a
        // fact, not a judgement call, so it's cheaper and more reliable to
        // just hand over the answer.
        const rows = await this.prisma.order.groupBy({
          by: ['productName'],
          where: { soldByCode: user.referralCode, status: 'completed' },
          _count: { _all: true },
          orderBy: { _count: { productName: 'desc' } },
          take: 5,
        })
        return rows.map((r) => ({ product: r.productName, completedSales: r._count._all }))
      }
      case 'get_my_withdrawals': {
        const rows = await this.prisma.withdrawal.findMany({
          where: { userId: user.id },
          orderBy: { requestedAt: 'desc' },
          take: 10,
        })
        return rows.map((w) => ({
          amountGhs: this.toCedis(w.amount),
          status: w.status,
          network: w.momoNetwork,
          requestedAt: w.requestedAt,
          paidAt: w.paidAt,
        }))
      }
      case 'get_my_recent_orders': {
        const rows = await this.orders.list(user, 20)
        return rows.map((o) => ({
          reference: o.reference,
          product: o.productName,
          status: o.status,
          amountGhs: this.toCedis(o.salePrice),
          date: o.createdAt,
          refunded: 'refunded' in o ? o.refunded : false,
        }))
      }
      case 'get_my_summary': {
        const summary = await this.admin.mySummary(user)
        if (summary.role !== 'agent') return { error: 'Not an agent.' }
        return {
          earnedTodayGhs: this.toCedis(summary.earnedToday),
          earnedAllTimeGhs: this.toCedis(summary.earnedAllTime),
          ordersToday: summary.ordersToday,
          ordersCompleted: summary.ordersCompleted,
          ordersTotal: summary.ordersTotal,
          activeDownlineAgents: summary.activeSubAgents,
          earnedThisWeekGhs: this.toCedis(summary.earnedTrend.thisWeek),
          earnedLastWeekGhs: this.toCedis(summary.earnedTrend.lastWeek),
        }
      }
      case 'get_my_branding_status': {
        const status = await this.branding.mine(user.id)
        return status
      }
      case 'get_my_markup': {
        const row = await this.prisma.user.findUnique({ where: { id: user.id }, select: { markupPercent: true } })
        return { markupPercent: row?.markupPercent ?? 0 }
      }
      default:
        return { error: `Unknown tool: ${name}` }
    }
  }

  private async runAdminTool(name: string): Promise<unknown> {
    switch (name) {
      case 'get_float_status': {
        const [expected, observed] = await Promise.all([this.float.expectedBalance(), this.float.latest()])
        return {
          shouldHoldGhs: expected ? this.toCedis(expected.balance) : null,
          dataHubLastReportedGhs: observed ? this.toCedis(observed.balance) : null,
          lastReportedAt: observed?.observedAt ?? null,
        }
      }
      case 'get_pending_refunds': {
        const rows = await this.refunds.list('pending')
        return rows.slice(0, 20).map((r) => ({
          orderRef: r.orderRef,
          buyerName: r.buyerName,
          amountGhs: this.toCedis(r.amount),
          reason: r.reason,
        }))
      }
      case 'get_pending_number_approvals': {
        const rows = await this.approvals.pending()
        return rows.slice(0, 20).map((r) => ({
          phone: r.phone,
          ordersHeld: r.ordersHeld,
          valueHeldGhs: this.toCedis(r.valueHeld),
          attempts: r.attempts,
        }))
      }
      case 'get_needs_attention': {
        const rows = await this.reconciler.needsAttention()
        return rows.slice(0, 20).map((r) => ({
          reference: r.reference,
          productName: r.productName,
          amountGhs: this.toCedis(r.salePrice),
          conflict: r.conflict,
          reason: r.reason,
        }))
      }
      case 'get_pending_withdrawals': {
        const rows = await this.prisma.withdrawal.findMany({
          where: { status: 'pending' },
          orderBy: { requestedAt: 'asc' },
          take: 20,
        })
        return rows.map((w) => ({
          agentName: w.agentName,
          amountGhs: this.toCedis(w.amount),
          network: w.momoNetwork,
          requestedAt: w.requestedAt,
        }))
      }
      case 'get_pending_domain_requests': {
        const rows = await this.domains.list(true)
        return rows.slice(0, 20).map((r) => ({
          agentName: r.agentName,
          domain: r.domain,
          requestedAt: r.requestedAt,
        }))
      }
      case 'get_business_overview': {
        const o = await this.admin.overview()
        return {
          windowDays: o.windowDays,
          orders: o.orders,
          revenueGhs: this.toCedis(o.revenue),
          paymentFeesGhs: this.toCedis(o.paymentFees),
          failedOrders: o.failedOrders,
          successRatePercent: Math.round(o.successRate * 100),
          averageOrderValueGhs: this.toCedis(o.averageOrderValue),
          activeAgents: o.activeAgents,
          customers: o.customers,
          pendingWithdrawals: { count: o.pendingWithdrawals.count, amountGhs: this.toCedis(o.pendingWithdrawals.amount) },
          unclaimedRefundCredits: { count: o.unclaimedCredits.count, amountGhs: this.toCedis(o.unclaimedCredits.amount) },
          revenueThisWeekGhs: this.toCedis(o.revenueTrend.thisWeek),
          revenueLastWeekGhs: this.toCedis(o.revenueTrend.lastWeek),
          refundRatePercent: Math.round(o.refundRate * 100),
          checkoutFunnelThisWeek: o.checkoutFunnel,
          agentsGoneQuiet: o.goingQuietAgents,
        }
      }
      case 'get_profit_statement': {
        const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        const s = await this.ledger.statement(since)
        return {
          sinceDate: s.since,
          revenueGhs: this.toCedis(s.revenue),
          costsGhs: {
            supplier: this.toCedis(s.costs.supplier),
            paymentFees: this.toCedis(s.costs.paymentFees),
            agentMargins: this.toCedis(s.costs.agentMargins),
            referralBonuses: this.toCedis(s.costs.referralBonuses),
            refunds: this.toCedis(s.costs.refunds),
            payoutFees: this.toCedis(s.costs.payoutFees),
          },
          profitGhs: this.toCedis(s.profit),
        }
      }
      case 'get_agent_stats': {
        const [pending, pendingCount, summary] = await Promise.all([
          this.applications.pending(),
          this.applications.pendingCount(),
          this.admin.agentSummary(),
        ])
        return {
          totalAgents: summary.agentCount,
          allTimeEarnedGhs: this.toCedis(summary.totalEarned),
          allTimeSalesVolumeGhs: this.toCedis(summary.totalVolume),
          pendingApplicationsCount: pendingCount,
          pendingApplications: pending.slice(0, 20),
        }
      }
      case 'get_catalogue_accuracy': {
        const rows = await this.admin.catalogueAccuracy()
        return rows.slice(0, 20).map((r) => ({
          product: r.name,
          network: r.network,
          believedCostGhs: this.toCedis(r.believed),
          actualChargedGhs: this.toCedis(r.charged),
          differenceGhs: this.toCedis(r.diff),
          lastSoldAt: r.lastSoldAt,
        }))
      }
      case 'get_pending_branding_requests': {
        const rows = await this.branding.queue('pending')
        return rows.slice(0, 20).map((r) => ({
          agentName: r.agentName,
          shopName: r.shopName,
          requestedAt: r.createdAt,
        }))
      }
      case 'get_platform_settings': {
        const s = await this.settings.all()
        return {
          registrationOpen: s.registrationOpen,
          agentsAutoApprove: s.agentsAutoApprove,
          minWithdrawalGhs: this.toCedis(s.minWithdrawal),
          floatWatchAtGhs: this.toCedis(s.floatWatchAt),
          floatRiskAtGhs: this.toCedis(s.floatRiskAt),
          paystackFeePercent: s.paystackFeeBp / 100,
          siteNotice: s.siteNotice,
        }
      }
      case 'get_outstanding_manual_advances': {
        const rows = await this.withdrawals.outstandingManualAdvances()
        return rows.map((a) => ({
          amountGhs: this.toCedis(a.amount),
          description: a.description,
          occurredAt: a.occurredAt,
        }))
      }
      case 'get_float_risk_products': {
        const risk = await this.admin.floatRisk()
        return {
          floatReferenceGhs: risk.floatReference != null ? this.toCedis(risk.floatReference) : null,
          trackedSince: risk.trackedSince,
          atRiskProducts: risk.atRisk.map((p) => ({ product: p.name, network: p.network, costGhs: this.toCedis(p.supplierCost) })),
          inactiveProducts: risk.inactive.map((p) => ({ product: p.name, network: p.network })),
        }
      }
      default:
        return { error: `Unknown tool: ${name}` }
    }
  }

  private systemPrompt(user: AuthUser, admin: boolean): string {
    const who = admin
      ? "You're talking to " +
        user.name +
        ", who runs the platform (an admin or the platform owner)."
      : "You're talking to " +
        user.name +
        ', one of the agents (resellers) who sells bundles through their own shop link.'

    const boundary = admin
      ? 'You cannot approve or refuse a refund, resolve an order, top up the float, or change anything on the agent\'s or a customer\'s behalf. If asked to do one of these, explain in plain steps how to do it themselves in the app — never claim to have done it.'
      : 'You cannot change a price, request a withdrawal, refer anyone, or resolve anything on the agent\'s behalf. If asked to do one of these, explain in plain steps how they can do it themselves in the app — never claim to have done it.'

    const menu = admin
      ? `Where things are in the menu — use these exact names, never a paraphrase:
- Overview (/admin),  Assistant  (/admin/assistant), All orders (/admin/orders), Refunds (/admin/refunds) — always visible at the bottom of the screen on a phone; the first four items in the sidebar on a computer.
- Withdrawals (/admin/withdrawals), Needs attention (/admin/needs-attention), Number approvals (/admin/approvals), Users (/admin/users), Cost prices (/admin/prices), Catalogue accuracy (/admin/catalogue-accuracy), Float risk (/admin/float-risk), Branding (/admin/branding), Settings (/admin/settings) — on a phone these are one tap further: tap "More" at the bottom first, then the name above. On a computer they're just in the left-hand sidebar, no extra tap.
- Platform team (/admin/team) and Custom domains (/admin/domains) only exist for the platform owner (superadmin), not a regular admin — don't send a regular admin looking for either. Both are behind "More" on a phone for a superadmin too.
- Whenever you send someone to one of the second group on a phone, say the "More" step out loud — don't assume they can see the full menu.`
      : `Where things are in the menu — use these exact names, never a paraphrase (an agent who taps "Prices" and finds nothing loses trust fast):
- Dashboard (/app),  Assistant  (/app/assistant), Sell & refer (/app/referrals), Earnings (/app/earnings) — always visible at the bottom of the screen on a phone; the first four items in the sidebar on a computer.
- Sales (/app/orders), My prices (/app/pricing), Shop look (/app/shop-look), Browse shop (/shop), Reports (/app/reports), Withdraw (/app/withdrawals) — on a phone these are one tap further: tap "More" at the bottom first, then the name above. On a computer they're just in the left-hand sidebar, no extra tap.
- Whenever you send someone to one of the second group on a phone, say the "More" step out loud — don't assume they can see the full menu, most agents here are on a phone, and a step that skips it sends them looking for something that isn't on screen yet.`

    const domainKnowledge = admin
      ? `How the platform works, in plain terms:
- The float is a prepaid balance held with DataHub, the delivery partner — every bundle sold draws from it. "Should hold" is what the books say it ought to be; DataHub's own last report is what they actually say — a gap between the two almost always means a top-up or withdrawal that was never logged.
- A refund is never automatic — a failed order only queues the debt, a person still decides whether to pay it or refuse it.
- MTN numbers need DataHub's own approval before a bundle can reach them; a number waiting here means real paid sales are stuck until it's approved.
- "Needs attention" is the small number of orders nothing automatic could settle — either stuck too long, or two different sources disagreed about what happened to it. Almost everything else resolves on its own.
- An agent's downline is who they've referred; an agent's own withdrawal moves money out of their earnings balance into Mobile Money, reviewed by an admin before it pays out.`
      : `How the platform works, in plain terms:
- Every agent gets their own shop link to share with customers. When someone buys through it, the agent earns the difference between what they charged and what the platform itself charges for that bundle — that difference is their margin.
- An agent can set their own price for a product, within a band the platform allows — that is what decides their margin on that sale.
- An agent can build a "downline" by referring other agents, and see them listed for their own visibility — but this pays no bonus of any kind, now or ever. Every agent earns from their own sales only, at the same price from James no matter who is above them in the chain. If asked, say this plainly rather than implying there's a bonus to wait for.
- A withdrawal moves money out of an agent's earnings balance into their Mobile Money account. It is reviewed by an admin before it pays out — it is not instant.
- A custom domain (like sageshop.example.com) is optional. An agent requests one from the [Shop look](/app/shop-look) screen — that's the only place to do it — so their shop has its own web address instead of a shared link; it needs an admin's approval before it goes live.
- An order can be "processing" (still being delivered, usually seconds to a few minutes), "completed" (delivered), or "failed" (something went wrong — the money is either already back with the customer or being sorted out, never simply lost).`

    return `You are the in-app help assistant for JamesDataConsult (JKB Data Hub), a data bundle, airtime and result-checker reselling platform in Ghana. ${who}

How to talk:
- Plain words only — never say "API", "webhook", "database", "endpoint", "provider reference", "tool", "function", "null", "undefined", or any other technical term, and never describe what a lookup "returned" — just say the plain fact itself (e.g. no domain requested yet, not "the tool returned null"). Explain things the way you would to someone who has never used a computer for work before.
- Keep answers short: a sentence or two first, then offer to say more if they want it. Do not front-load a long explanation nobody asked for.
- If a question needs real, current information, use the tools available to you rather than guessing or giving a generic answer. This includes questions that need you to work something out from the data, not just look it up directly — always call the tool that matches first, even then. Never tell someone you don't have information without having actually tried a relevant tool.
- Never state a fact a tool didn't actually give you — a network, a status, a date, anything specific — by guessing it from a product or person's name instead. If a tool's data doesn't say it, say what the tool actually told you, or that you're not sure, rather than filling the gap with a guess that sounds plausible.
- Any field ending in "Ghs" from a tool is already in Ghana cedis, ready to say as-is (e.g. "GHS 3.25") — never multiply, divide, or otherwise convert it.
- Use **double asterisks** around a word or phrase only to genuinely emphasise it (a warning, a key number) — not on every heading or label, and never around a link (the next rule) since it already stands out on its own.
- Whenever you tell someone to go to a specific screen, write it as a markdown link using its exact path from the menu below, e.g. "check [My prices](/app/pricing)" or "go to [Refunds](/admin/refunds)" — plain like that, not bolded — never say a screen name without also linking it this way, and never invent a path that isn't listed below.
- A markdown table (a header row of "|"-separated cells, a "|---|---|" row under it, then more rows the same way) renders as a real table here — use one when someone asks for "a table", or when you're listing several items that each have more than one number attached (like a product with both a price and a cost). For a simple one-value-per-item list, plain "- " lines are still the better fit.

What you can never do:
- ${boundary}

${menu}

${domainKnowledge}`
  }
}
