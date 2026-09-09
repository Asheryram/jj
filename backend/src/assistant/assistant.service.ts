import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { GoogleGenAI, createPartFromFunctionResponse, type Content, type Tool } from '@google/genai'
import { isAdminRole, type AuthUser } from '../common/auth'
import { AgentsService } from '../agents/agents.service'
import { DomainsService } from '../domains/domains.service'
import { FloatMonitorService } from '../supplier/float-monitor.service'
import { RefundsService } from '../orders/refunds.service'
import { ApprovalsService } from '../orders/approvals.service'
import { ReconcilerService } from '../supplier/reconciler.service'

/**
 * Free-tier friendly, and deliberately so: this answers plain questions about
 * an agent's own account from a handful of small read-only lookups, not hard
 * reasoning — the kind of workload where a bigger model buys nothing but cost.
 */
const MODEL = 'gemini-3.6-flash'

const MAX_TOOL_ROUNDS = 4

const AGENT_TOOLS: Tool[] = [
  {
    functionDeclarations: [
      {
        name: 'get_my_earnings',
        description: "The agent's current wallet balance and recent earnings history.",
      },
      {
        name: 'get_my_prices',
        description: 'The custom prices the agent has set for specific products, if any.',
      },
      {
        name: 'get_my_downline',
        description:
          'The agents this agent has personally referred (their "downline"), and how much each has sold.',
      },
      {
        name: 'get_my_domain',
        description: "The status of the agent's own custom domain request, if they have one.",
      },
    ],
  },
]

const ADMIN_TOOLS: Tool[] = [
  {
    functionDeclarations: [
      {
        name: 'get_float_status',
        description:
          "The DataHub float: what it should hold going by logged capital and spending, and what DataHub's last reply actually reported.",
      },
      {
        name: 'get_pending_refunds',
        description: 'Refund requests still waiting on a decision, oldest first.',
      },
      {
        name: 'get_pending_number_approvals',
        description:
          'Phone numbers still waiting on DataHub to approve them for delivery, and how much paid business is held up by each.',
      },
      {
        name: 'get_needs_attention',
        description:
          'Orders nothing automatic has resolved — stuck in progress too long, or flagged because two different sources disagreed on the outcome.',
      },
    ],
  },
]

/**
 * The in-app help assistant — "ask for help" rather than a static page.
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
 * Runs on Gemini rather than Claude — a deliberate swap once real Anthropic
 * usage hit a billing wall and Gemini's free tier was the lower-friction
 * path. Nothing about the app's own tone or the read-only boundary changed;
 * only the provider underneath did.
 */
@Injectable()
export class AssistantService {
  private readonly log = new Logger(AssistantService.name)
  private readonly client: GoogleGenAI | null

  constructor(
    private readonly config: ConfigService,
    private readonly agents: AgentsService,
    private readonly domains: DomainsService,
    private readonly float: FloatMonitorService,
    private readonly refunds: RefundsService,
    private readonly approvals: ApprovalsService,
    private readonly reconciler: ReconcilerService,
  ) {
    const apiKey = this.config.get<string>('GEMINI_API_KEY')
    this.client = apiKey ? new GoogleGenAI({ apiKey }) : null
  }

  async ask(
    user: AuthUser,
    message: string,
    history: { role: 'user' | 'assistant'; content: string }[] = [],
  ): Promise<{ reply: string }> {
    if (!this.client) {
      return {
        reply: "The help assistant isn't set up yet — ask an admin to add the Gemini API key.",
      }
    }

    const admin = isAdminRole(user.role)
    const tools = admin ? ADMIN_TOOLS : AGENT_TOOLS

    const contents: Content[] = [
      ...history.map((turn) => ({
        role: turn.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: turn.content }],
      })),
      { role: 'user', parts: [{ text: message }] },
    ]

    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const response = await this.client.models.generateContent({
          model: MODEL,
          contents,
          config: {
            systemInstruction: this.systemPrompt(user, admin),
            tools,
          },
        })

        const modelContent = response.candidates?.[0]?.content
        if (modelContent) contents.push(modelContent)

        const calls = response.functionCalls
        if (!calls || calls.length === 0) {
          return { reply: (response.text ?? '').trim() }
        }

        const responseParts = []
        for (const call of calls) {
          if (!call.name) continue
          const result = await this.runTool(call.name, user, admin)
          responseParts.push(
            createPartFromFunctionResponse(call.id ?? call.name, call.name, { result }),
          )
        }
        contents.push({ role: 'user', parts: responseParts })
      }

      // Ran out of rounds without a final answer — say so plainly rather
      // than silently returning nothing.
      return {
        reply: "Sorry, I couldn't work that out. Try asking it a different way, or check the app directly.",
      }
    } catch (error) {
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
        const prices = await this.agents.prices(user.id)
        return prices.map((p) => ({ productId: p.productId, priceGhs: this.toCedis(p.resalePrice) }))
      }
      case 'get_my_downline': {
        const downline = await this.agents.downline(user.referralCode)
        return downline.map((a) => ({
          name: a.name,
          joinedAt: a.joinedAt,
          ordersSold: a.orders,
          salesVolumeGhs: this.toCedis(a.volume),
          earnedFromThemGhs: this.toCedis(a.earnedForUpline),
        }))
      }
      case 'get_my_domain':
        return this.domains.mine(user.id)
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
- Overview, Ask for help, All orders, Refunds — always visible at the bottom of the screen on a phone; the first four items in the sidebar on a computer.
- Withdrawals, Needs attention, Number approvals, Users, Cost prices, Catalogue accuracy, Float risk, Branding, Settings — on a phone these are one tap further: tap "More" at the bottom first, then the name above. On a computer they're just in the left-hand sidebar, no extra tap.
- Platform team and Custom domains only exist for the platform owner (superadmin), not a regular admin — don't send a regular admin looking for either. Both are behind "More" on a phone for a superadmin too.
- Whenever you send someone to one of the second group on a phone, say the "More" step out loud — don't assume they can see the full menu.`
      : `Where things are in the menu — use these exact names, never a paraphrase (an agent who taps "Prices" and finds nothing loses trust fast):
- Dashboard, Ask for help, Sell & refer, Earnings — always visible at the bottom of the screen on a phone; the first four items in the sidebar on a computer.
- Sales, My prices, Shop look, Browse shop, Reports, Withdraw — on a phone these are one tap further: tap "More" at the bottom first, then the name above. On a computer they're just in the left-hand sidebar, no extra tap.
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
- An agent can build a "downline" by referring other agents; they earn a bonus on their downline's sales too, on top of their own.
- A withdrawal moves money out of an agent's earnings balance into their Mobile Money account. It is reviewed by an admin before it pays out — it is not instant.
- A custom domain (like sageshop.example.com) is optional. An agent can request one so their shop has its own web address instead of a shared link; it needs an admin's approval before it goes live.
- An order can be "processing" (still being delivered, usually seconds to a few minutes), "completed" (delivered), or "failed" (something went wrong — the money is either already back with the customer or being sorted out, never simply lost).`

    return `You are the in-app help assistant for JamesDataConsult (JKB Data Hub), a data bundle, airtime and result-checker reselling platform in Ghana. ${who}

How to talk:
- Plain words only — never say "API", "webhook", "database", "endpoint", "provider reference", or any other technical term. Explain things the way you would to someone who has never used a computer for work before.
- Keep answers short: a sentence or two first, then offer to say more if they want it. Do not front-load a long explanation nobody asked for.
- If a question needs real, current information, use the tools available to you rather than guessing or giving a generic answer.
- Any field ending in "Ghs" from a tool is already in Ghana cedis, ready to say as-is (e.g. "GHS 3.25") — never multiply, divide, or otherwise convert it.

What you can never do:
- ${boundary}

${menu}

${domainKnowledge}`
  }
}
