# User Flows — End to End
## JamesDataConsult — Data Bundle & Reseller Platform

Prepared by: Asher Yram Tetteh-Abotsi
Date: August 2026
Version: 1.0 — matches requirements v1.1 and the frontend prototype in `frontend/`

---

## 1. How to read this

Every flow in this document is written from the actor's point of view, names the
route it happens on, and states what the system does in response — including the
paths where things go wrong, which are usually the ones that get skipped.

**Status column, used throughout:**

| Mark | Meaning |
|---|---|
| **Built** | Works end to end in the prototype today, verified in a browser |
| **Simulated** | The screens and states are built; the external call is faked (a timer stands in for the DataHub GH webhook, a pause for the Paystack popup) |
| **Backend** | Screens exist but the behaviour needs the NestJS API to be real |
| **Not built** | Specified, deliberately not in the prototype |

A flow marked **Simulated** is complete as an *interface*. What is missing is the
network call, not the design.

---

## 2. Actors

| Actor | Account? | How they arrive | What they can do |
|---|---|---|---|
| **Buyer** | None | Direct, search, WhatsApp link | Browse, buy at standard prices, pay Mobile Money, track an order |
| **Buyer on a sell link** | None | An agent's `/s/<code>` | The same, but at that agent's prices |
| **Wallet holder** | Optional | Registers as a buyer | Everything a buyer can, plus a topped-up balance and saved history |
| **Agent** | Required | Registers directly or via a referral link | Sells at their own prices, earns margin, recruits sub-agents, withdraws |
| **Admin (James)** | Required | Login | Sets all four price tiers, approves withdrawals, suspends users, toggles referral depth |
| **System** | — | Webhooks, cron | Confirms payment, fulfils orders, splits money, refunds, notifies |

**A buyer is not a role.** There is no "Customer" account required to purchase —
that was the single biggest change from requirements v1.0, and it is what makes
agent sell links work at all (FR-4.8).

---

## 3. Route map

| Route | Who reaches it | Purpose |
|---|---|---|
| `/` | Everyone | **The shop itself.** Catalogue first, marketing below |
| `/shop` | Everyone | Catalogue with no marketing wrapper |
| `/s/:code` | Everyone | An agent's storefront, priced at their prices |
| `/checkers` | Everyone | BECE/WASSCE landing with the WAEC disclaimer |
| `/buy/:productId` | Everyone | Checkout. Deliberately public so one path serves guests and account holders |
| `/track` | Everyone | Order lookup by reference + phone |
| `/register` | Everyone | Agent signup, or optional wallet account |
| `/login` | Everyone | Agents and admin only |
| `/app` | Signed in | Dashboard |
| `/app/orders` | Signed in | Orders (buyer) / Sales (agent) |
| `/app/reports` | Signed in | Spending (buyer) / Sales summary (agent) |
| `/app/wallet` | **Wallet holders only** | Balance, top-up, transaction ledger |
| `/app/earnings` | **Agents only** | Earnings ledger. No top-up exists here by design |
| `/app/pricing` | **Agents only** | Set resale prices |
| `/app/referrals` | **Agents only** | Sell link + referral link + downline |
| `/app/withdrawals` | **Agents only** | Request and track payouts |
| `/admin/*` | **Admin only** | Overview, orders, users, prices, withdrawals, settings |
| `*` | Everyone | Not-found, with a route back to the shop |

Guards are enforced on the route (NFR-2.5). An agent hitting `/admin/users` is
redirected to `/app`; an agent hitting `/app/wallet` is redirected to `/app`.
**Status: Built.**

---

## 4. Flow index

### Buying

| ID | Flow | Actor | Status |
|---|---|---|---|
| B-01 | Buy a data bundle with no account | Buyer | Simulated |
| B-02 | Buy through an agent's sell link | Buyer | Simulated |
| B-03 | Buy a result checker and receive the voucher | Buyer | Simulated |
| B-04 | Buy airtime, voice, SMS or AFA registration | Buyer | Simulated |
| B-05 | Buy from a wallet balance | Wallet holder | Simulated |
| B-06 | Top up a wallet | Wallet holder | Simulated |
| B-07 | Track an order / recover a voucher | Buyer | Built |
| B-08 | Leave a sell link and buy at standard prices | Buyer | Built |
| B-09 | Convert from buyer to account holder | Buyer | Built |

### Selling

| ID | Flow | Actor | Status |
|---|---|---|---|
| A-01 | Register as an agent | Agent | Backend |
| A-02 | Register as an agent via someone's referral link | Agent | Backend |
| A-03 | Set a resale price on one product | Agent | Built |
| A-04 | Apply a markup across the whole catalogue | Agent | Built |
| A-05 | Share the sell link | Agent | Built |
| A-06 | Earn from a customer's purchase | Agent | Simulated |
| A-07 | Earn from a downline agent's sale | Agent | Simulated |
| A-08 | Recruit a sub-agent | Agent | Backend |
| A-09 | Review the earnings ledger | Agent | Built |
| A-10 | Request a withdrawal | Agent | Built |
| A-11 | Buy through their own sell link | Agent | Simulated |
| A-12 | Export a sales report | Agent | Built |

### Administering

| ID | Flow | Actor | Status |
|---|---|---|---|
| J-01 | Review the platform | Admin | Built |
| J-02 | Change a product's price tiers | Admin | Built |
| J-03 | Approve or reject a withdrawal | Admin | Built |
| J-04 | Suspend or reactivate an account | Admin | Built |
| J-05 | Turn multi-level referral on | Admin | Built |
| J-06 | Inspect one order's money split | Admin | Built |
| J-07 | Export all orders | Admin | Built |
| J-08 | Change retry and top-up settings | Admin | Backend |
| J-09 | Add a new network prefix | Admin | Backend |

### System

| ID | Flow | Trigger | Status |
|---|---|---|---|
| S-01 | Confirm a Paystack payment | Webhook | Backend |
| S-02 | Fulfil an order through DataHub GH | Order created | Backend |
| S-03 | Retry once, then fail | Provider error | Simulated |
| S-04 | Refund a failed order | Order failed | Simulated |
| S-05 | Split a completed sale across the chain | Order completed | Built |
| S-06 | Reconcile stuck orders | Cron | Not built |
| S-07 | Send SMS notifications | Order events | Not built |
| S-08 | Queue orders through provider downtime | Provider down | Not built |

---

## 5. Buying flows in detail

### B-01 · Buy a data bundle with no account
**Actor:** Buyer · **Status: Simulated** · FR-3.1, FR-3.2, FR-4.1, FR-4.2, FR-4.8, NFR-4.2

**Precondition:** none. No account, no wallet, no login.

```
/  →  /buy/:id  ─ step 2 ─→  ─ step 3 ─→  ─ step 4 ─→  delivered
   pick bundle    number      confirm      pay
```

1. Buyer lands on `/`. The catalogue is the first thing on the page — first
   product is 470px down on desktop, 521px on mobile, so prices are visible
   without scrolling.
2. Picks a category tab (Data / Airtime / Voice / SMS / AFA / Checkers) and
   optionally filters by network. Prices shown are James's standard prices.
3. Taps a product → `/buy/:productId`. **Step 1 of 4 is already satisfied** by
   arriving with a bundle chosen.
4. **Step 2 — Number.** Enters the recipient number. The network is detected
   live from the prefix and shown as a chip. Copy states "No account needed".
5. **Step 3 — Confirm.** The number is repeated back large and prettified
   (`024 411 8820`) with its detected network, above an explicit warning that a
   bundle sent to a wrong number cannot be recovered. A checkbox — ticked by
   default — sends the receipt to the same number, so most buyers never touch it.
   Payment options show Mobile Money only, because a guest has no wallet.
6. Chooses their MoMo network and presses **Confirm and pay** (the yellow CTA —
   the single highest-emphasis action in the product).
7. **Step 4 — Done.** Pending state while the network confirms, then a receipt
   with reference, amount, time, and a prompt to keep the reference for `/track`.

**Success:** bundle delivered, receipt on screen, SMS confirmation promised.
**Money:** see S-05. A no-sell-link purchase pays James's standard price and
James keeps the whole spread above supplier cost.

**Alternate paths**

| Condition | Behaviour |
|---|---|
| Number is 9 digits | *"A Ghana number needs 10 digits."* |
| Number is 11+ digits | *"That's more than 10 digits — check it again."* |
| Unknown prefix | *"073 isn't a network we recognise."* |
| Telecel number, MTN bundle | *"That's a Telecel number, but you selected a MTN bundle."* |
| Blank | *"Enter the number that should receive this bundle."* |
| Provider fails | → **S-04**, money returned as a claimable credit |
| Back pressed on step 2 | Returns to `/shop` |
| Back pressed on step 3 | Returns to step 2 with the number intact |

Every message above is the literal on-screen text. There are no error codes
anywhere in the buyer flow (NFR-4.3).

---

### B-02 · Buy through an agent's sell link
**Actor:** Buyer · **Status: Simulated** · FR-5.7, FR-3.5, FR-4.8

1. Agent shares `https://jamesdataconsult.com/s/KWAME77`, usually on WhatsApp.
2. Buyer opens it. A branded header names the agent — "Authorised
   JamesDataConsult agent · Kwame Boateng" — with their code and a note that
   Paystack handles payment.
3. The catalogue below is priced at **that agent's** prices. A banner states
   "You are buying from Kwame Boateng — the prices here are theirs", with an
   escape hatch to standard prices (**B-08**).
4. The rest is identical to **B-01**. The confirm screen adds "Sold by Kwame
   Boateng, an authorised agent."
5. The sell link is remembered for the session, so the agent's prices survive
   navigation to checkout.

**Verified:** MTN 5GB is **GHS 27.80** at standard price and **GHS 29.00** through
Kwame's link. The buyer never sees the agent's cost or margin (FR-3.7).

**Alternate:** unknown code → *"We do not recognise that link"* with the agent's
code quoted back and a button to the standard shop. No dead end.

---

### B-03 · Buy a result checker and receive the voucher
**Actor:** Buyer · **Status: Simulated** · FR-4.7, NFR-7.1

1. Buyer reaches `/checkers` (nav, footer, or the Checkers category tab).
2. Two products — BECE and WASSCE — each listing what it includes. **Two
   disclaimers appear before the buy button:** that JamesDataConsult is an
   independent reseller not affiliated with WAEC, and that a revealed voucher
   cannot be refunded.
3. Buys as in **B-01**. On the number step the label changes to "Phone number for
   the voucher SMS".
4. On success the receipt carries the **serial number** and **PIN**, each with a
   copy button, plus a note that they have also been sent by SMS.

**Critical:** the voucher is a bearer secret. If the SMS fails and the buyer
closes the page, **B-07** is the only way back to it — which is exactly why that
flow exists.

---

### B-04 · Buy airtime, voice, SMS or AFA registration
**Actor:** Buyer · **Status: Simulated** · FR-3.1

Identical to **B-01**; only the catalogue filter differs. Worth noting per
category:

| Category | Note |
|---|---|
| Airtime | Thin margins by nature — face value is a fixed reference point, so the tier spread is deliberately narrow |
| Voice / SMS | Validity is stated on the card (7 or 30 days) |
| AFA registration | MTN only, one-time, no recurring state |
| Checkers | Not network-specific; the network chip reads "All networks" |

---

### B-05 · Buy from a wallet balance
**Actor:** Wallet holder · **Status: Simulated** · FR-2.1, FR-2.3, FR-2.5, NFR-4.2

This is the flow that justifies the wallet existing: **no Mobile Money prompt.**

1. Signed-in wallet holder picks a bundle and enters the number as in **B-01**.
2. The confirm screen now offers two payment methods, with **"From my wallet"**
   pre-selected whenever the balance can cover the order. It shows the balance
   and the balance after.
3. Confirm → the wallet is debited as the order is created, in one step, and a
   `purchase` entry is written to the ledger with the running balance after it.

**Result: four steps, no MoMo prompt** — the NFR-4.2 promise, and the only reason
a buyer would bother registering.

**Alternate — insufficient balance (FR-2.5):**
The wallet option is disabled and labelled with the shortfall ("Balance GHS 12.50
— you need GHS 16.50 more"), and a callout offers both ways forward: pay Mobile
Money now, or top up first. **The sale is never blocked outright** — that was a
deliberate change from a literal reading of FR-2.5, which would have dead-ended
the buyer.

---

### B-06 · Top up a wallet
**Actor:** Wallet holder · **Status: Simulated** · FR-2.2, FR-7.1, NFR-2.3, NFR-6.2

1. `/app/wallet` → **Top up**.
2. Quick amounts (10 / 20 / 50 / 100 / 200) or a custom amount. Minimum GHS 1.00.
3. Chooses MTN MoMo, Telecel Cash or AirtelTigo Money.
4. Sees exactly what will be charged, then **Continue to Paystack**.
5. A note states plainly: *"Your balance updates only after Paystack confirms the
   payment — not when the prompt closes."*
6. On confirmation the balance updates and a `topup` ledger entry is written.

**This is the flow most likely to be built wrong.** The browser must never be the
source of truth — see **S-01**. The UI already says so out loud, and the real
implementation has to keep that true.

---

### B-07 · Track an order / recover a voucher
**Actor:** Buyer · **Status: Built** · FR-4.9

1. `/track` (header, footer, or the link on a guest receipt).
2. Enters the order reference (`JDC-884120`) and the phone number used.
3. On a match: product, status, amount, recipient, time, payment method — and if
   it was a checker, **the serial and PIN again**.
4. On no match: *"We could not find that order"*, with a prompt to check both
   fields and a phone number to call.

A guest has no order history, so reference + phone is their only handle on a
purchase. Without this page a checker voucher whose SMS did not arrive is simply
gone.

---

### B-08 · Leave a sell link and buy at standard prices
**Actor:** Buyer · **Status: Built** · FR-3.5

The sell-link banner carries "Use standard prices instead". One tap clears the
seller for the session and reprices the catalogue to James's standard prices.

Included on purpose: a buyer who arrives through an agent link must not be
silently locked into a higher price with no way out.

---

### B-09 · Convert from buyer to account holder
**Actor:** Buyer · **Status: Built** · FR-1.1, FR-1.6, NFR-7.3

From `/register`, two options with the framing reversed from v1.0:

- **"An agent — I want to sell"** (default): own shop link, own prices, keeps margin.
- **"A buyer — wallet only"**: explicitly optional. Keeps a balance to skip the
  MoMo prompt and saves order history.

Both require name, phone (validated and network-detected live), email, an
8-character minimum password, and an explicit tick accepting Terms and the
Privacy Policy. Referral code is optional and pre-filled from `?ref=`.

---

## 6. Selling flows in detail

### A-01 / A-02 · Register as an agent
**Status: Backend** · FR-1.1, FR-1.2, FR-1.6, FR-1.7, FR-5.1

1. Arrives at `/register` directly, or via `/register?ref=KWAME77`.
2. With a referral code present, a confirmation appears before the form:
   *"You are signing up under referral code KWAME77. They will see you in their
   agent list."*
3. Completes the form, accepts terms, submits.
4. On success a unique referral code and both links are generated automatically
   (FR-1.7).

**The upline is stored on every account from registration onwards, regardless of
whether multi-level referral is switched on** (FR-5.5). This is what lets J-05 be
a toggle rather than a migration.

---

### A-03 · Set a resale price on one product
**Actor:** Agent · **Status: Built** · FR-3.4, FR-6.2, FR-3.7

1. `/app/pricing`, filtered by category.
2. Each row shows **You pay · Your price · Your margin · Cap**.
3. **Edit** opens a dialog stating the floor and the ceiling, with live profit
   feedback as they type.

**The floor is what *they* pay — their upline's price, not the supplier's cost.**
For MTN 5GB an agent directly under James sees **You pay GHS 25.90**, not
DataHub's GHS 24.00. That one number is the entire commercial model: because
their floor already contains James's markup, James is paid on every sale
automatically.

**Rejections (verified):**

| Attempt | Message |
|---|---|
| Below their cost | *"You pay GHS 25.90 for this, so you cannot charge less than that."* |
| Above the retail cap | *"James caps this product at GHS 34.80 so it stays competitive."* |
| Non-numeric | *"Enter a price like 7.50."* |

Agents never see `supplierCost` (FR-3.7). **These limits are UX only — the API
must re-enforce both (NFR-2.7).** An agent has a direct financial incentive to
bypass them from the browser console.

---

### A-04 · Apply a markup across the whole catalogue
**Actor:** Agent · **Status: Built** · FR-3.4, FR-3.8

**Apply markup to all** → pick +5% to +30% → every product is set to their own
cost plus that percentage, clamped to the retail cap. A worked example updates
live. Individual products can still be edited afterwards.

Products with no explicit price fall back to the agent's default markup and are
labelled "default" in the table (FR-3.8).

---

### A-05 · Share the sell link
**Actor:** Agent · **Status: Built** · FR-5.7, FR-1.7

`/app/referrals` presents **two links doing two different jobs** — the single
most confusable thing in the product, so they are visually separated:

| | Sell link | Referral link |
|---|---|---|
| URL | `/s/KWAME77` | `/register?ref=KWAME77` |
| Audience | Someone who wants to **buy** | Someone who wants to **sell** |
| Result | An order at your prices | A new agent beneath you |
| Presentation | Filled blue card, top of page | Standard card below it |

Each has copy-to-clipboard and a pre-filled WhatsApp share. The sell link also
appears on the agent dashboard, since that is where they will look for it.

---

### A-06 · Earn from a customer's purchase
**Actor:** Agent (passive) · **Status: Simulated** · FR-2.8, FR-5.3

1. A buyer completes **B-02** through the agent's sell link.
2. On completion the agent's earnings account is credited their margin, with a
   `sale` ledger entry naming the product and recipient.
3. A toast confirms the amount earned.

**The agent handles no money and holds no stock.** They never pre-fund anything —
this is why `/app/earnings` has no top-up button anywhere on it.

---

### A-07 · Earn from a downline agent's sale
**Actor:** Agent (passive) · **Status: Simulated** · FR-5.3, FR-5.6, FR-2.8

When an agent below them sells, they earn too, because the downline agent's cost
*is* their price. The ledger entry is typed `downline` and records how many
levels down it came from.

**Verified on a real 3-deep order** — a BECE checker sold by Naa Adjei, under
Abena Nyarko, under Kwame Boateng:

```
Customer pays                GHS 26.09
  DataHub GH (supplier)      GHS 18.00
  Naa Adjei    (seller)          +1.48
  Abena Nyarko (1 level up)      +1.61
  Kwame Boateng(2 levels up)     +3.60
  James Owusu  (platform)        +1.40
                             ─────────
                             GHS 26.09  ✓ balances exactly
```

---

### A-08 · Recruit a sub-agent
**Actor:** Agent · **Status: Backend** · FR-5.1, FR-5.2, FR-5.4

Share the referral link → the new agent registers → they appear in "Agents in
your chain" with orders, volume, and **what they have earned you**. Direct
recruits are badged "You"; deeper ones are indented under their own recruiter.

While multi-level is off, the page says so plainly: *"You can invite agents
directly, and you earn on their sales. They cannot recruit their own agents yet —
James can switch that on later without anything changing for you."*

---

### A-09 · Review the earnings ledger
**Actor:** Agent · **Status: Built** · FR-2.4, NFR-2.6

`/app/earnings` shows available balance, split between own sales and downline,
withdrawn to date, a 7-day chart, and every entry: `sale`, `downline`,
`reversal`, `withdrawal` — each with amount, running balance and reference.

Footer states: *"This ledger is append-only. Entries cannot be edited or deleted,
by you or by us — a correction is always a new entry."* That is a trust signal
and a real constraint on the backend (NFR-2.6).

---

### A-10 · Request a withdrawal
**Actor:** Agent · **Status: Built** · FR-2.6, FR-7.3

1. `/app/withdrawals` → **Request withdrawal**.
2. Amount (minimum GHS 10.00, capped at the available balance, with a "withdraw
   everything" shortcut), MoMo network, and the registered number shown read-only.
3. Submit → status **Awaiting review**, and a note that James reviews within 24
   hours.

Copy is careful to promise *review*, not payment, because v1 approval is manual.

**Rejections:** below minimum → *"The smallest withdrawal is GHS 10.00."*;
above balance → *"You only have GHS 314.80 available."*

---

### A-11 · Agent buys through their own sell link
**Actor:** Agent · **Status: Simulated** · FR-5.10

An agent buying for themselves pays their own price and is credited their own
margin, so their **net cost is their cost price**. The confirm screen shows this
explicitly:

```
You pay                        GHS 29.00
Comes back to you as earnings     +3.10
Your net cost                  GHS 25.90
```

Also shown to agents and admin on the confirm screen: the full split breakdown,
with "you" marked. Buyers never see it (FR-3.7).

---

### A-12 · Export a sales report
**Actor:** Agent · **Status: Built** · FR-8.2, FR-8.3

`/app/reports` → date range (7 days / 30 days / custom) → volume, earnings,
average order, failures, a daily chart and a category breakdown. **Export CSV**
downloads reference, date, product, network, recipient, customer paid, you
earned, levels below you, and status.

Scoped to their own chain only (NFR-2.5).

---

## 7. Administering flows in detail

### J-01 · Review the platform
**Actor:** Admin · **Status: Built** · FR-6.3, FR-6.6, FR-6.7

`/admin` deliberately leads with **things needing action** before any vanity
number: pending withdrawals with a total and a review link, then failed orders
reassuring that refunds were automatic.

Then: 7-day revenue, James's own margin computed from recorded splits, active
users, orders in flight. Then a daily revenue chart, revenue by category, top
agents, latest orders, and **Where the money goes** — turnover divided between
supplier, James and the agent network, drawn from the splits rather than
estimated.

**Verified to balance:** GHS 529.26 = 435.50 supplier + 33.50 James + 60.26 agents.

Wallet float is labelled a liability, not revenue (FR-6.7).

---

### J-02 · Change a product's price tiers
**Actor:** Admin · **Status: Built** · FR-3.3, FR-3.6, FR-6.4

`/admin/prices` shows all four tiers per product with James's margin on agent
sales and on direct sales, and flags any product whose tiers are out of order.

Editing presents all four with plain-language help, live margin preview for both
sale types, and validation:

| Attempt | Message |
|---|---|
| Agent price < supplier cost | *"Your price to agents cannot be below what the supplier charges you."* |
| Walk-up price < supplier cost | *"The walk-up price cannot be below what the supplier charges you."* |
| Cap < agent price | *"The retail cap cannot be below the price your agents pay."* |

**A price change never rewrites history** (FR-2.11). Every order stores its own
split, so past reports, agent earnings and James's margin stay exactly as they
were. The page states this before he edits anything.

**Knock-on (FR-3.9):** if a new cost lands above an agent's existing price, that
product sells at cost for them until they set a new one, and their pricing page
tells them.

---

### J-03 · Approve or reject a withdrawal
**Actor:** Admin · **Status: Built** · FR-2.6, FR-6.4, FR-7.3

1. `/admin/withdrawals`, defaulting to pending.
2. **Review** opens the request: agent, amount, MoMo network, and the destination
   number and amount as **separate copy fields**, because paying it is a manual
   step outside the platform.
3. Guidance: *"Send the Mobile Money first, then approve here so the ledger
   matches what actually happened."*
4. Approve → recorded and the agent's balance debited. Reject → recorded.

The page is blunt that James sends the money himself in v1.

---

### J-04 · Suspend or reactivate an account
**Actor:** Admin · **Status: Built** · FR-6.5

`/admin/users` → filter or search → **Suspend**. A confirmation dialog spells out
the consequences: no new orders, top-ups or withdrawals; **wallet balance
untouched; order history and ledger intact.** Nothing is ever deleted.

---

### J-05 · Turn multi-level referral on
**Actor:** Admin · **Status: Built** · FR-5.5, FR-5.6, NFR-5.2

`/admin/settings` → a toggle, with a confirmation explaining that sub-agents will
be able to recruit, that every agent will see their full downline, and that
existing links keep working.

The page states why this is safe: *"This is a setting, not a code change. Every
account already stores who referred it, so switching this on immediately reveals
the chains that were being recorded all along — nothing needs rebuilding or
backfilling."*

**⚠ Commercial warning, measured:** each level adds its own markup, so retail
prices inflate with depth. A BECE checker three agents deep costs **GHS 26.09**
against James's standard **GHS 20.90** — **25% more for the identical product**.
The per-product retail cap is the only brake, and James must set it deliberately.
This is the strongest argument for launching with the toggle off.

---

### J-06 · Inspect one order's money split
**Actor:** Admin · **Status: Built** · FR-5.8, FR-2.9

`/admin/orders` lists every order with the chain it sold through
(`Naa Adjei ← Abena Nyarko ← Kwame Boateng`), what the customer paid, supplier
cost, James's margin and total agent margins. Searchable by number, reference,
buyer, sell-link code or any agent name in the chain.

---

### J-07 · Export all orders
**Actor:** Admin · **Status: Built** · FR-8.3

CSV with reference, date, sold-by code, buyer, product, network, recipient,
customer paid, supplier cost, James's margin, agent margins, the full chain,
payment method, status and refund flag.

---

### J-08 / J-09 · Settings and network prefixes
**Status: Backend** · FR-4.6, NFR-5.1

Retry count (0 / 1 / 2, default 1) and minimum top-up are editable. Integration
credentials are shown masked with the note that keys live as server secrets and
can only be replaced, never revealed (NFR-2.4).

Network prefixes are editable **data**, not code (NFR-5.1) — a newly allocated
prefix can be added without a deployment. Flagged on screen: confirm current
allocations with the NCA before launch.

---

## 8. System flows

### S-01 · Confirm a Paystack payment
**Status: Backend** · FR-2.2, NFR-2.3

```
Client asks API to initialise  →  API stores a pending top-up keyed by reference
       ↓
User pays on their phone
       ↓
Paystack webhook  →  verify HMAC-SHA512 over the RAW body
                  →  verify amount + currency match the stored intent
                  →  credit the wallet idempotently by reference
```

**The browser is never the source of truth.** A `verify` call to Paystack is the
fallback for a missed webhook. Two implementation notes that will bite:

- NestJS parses JSON by default; signature verification fails silently unless the
  raw body is preserved (`rawBody: true`).
- Both Paystack and DataHub GH may deliver the same event more than once. Every
  handler must be safe to run twice.

---

### S-02 · Fulfil an order through DataHub GH
**Status: Backend** · FR-4.3, FR-4.4

Order committed → queued job calls the provider → status moves on the provider's
callback. **Never hold a database transaction open across an outbound HTTP call.**
Commit the debit, then dispatch.

**Order state machine (FR-4.4):**

```
pending ──→ processing ──→ completed
                │
                └────────→ failed ──→ (refunded)
```

Transitions are one-way. A late callback must not resurrect a refunded order.

---

### S-03 · Retry once, then fail
**Status: Simulated** · FR-4.6

One automatic retry on a retryable error, then terminal failure → **S-04**.
Configurable in J-08; default 1.

---

### S-04 · Refund a failed order
**Status: Simulated** · FR-2.7, FR-2.12, NFR-3.3

The refund path depends on how the buyer paid — and the guest case is the one the
requirements originally had no answer for:

| Paid with | Refund |
|---|---|
| Wallet | Credited straight back, with a `refund` ledger entry. Balance shown updated on screen |
| Mobile Money (guest) | Held as a **claimable credit against their phone number**, with an SMS claim link to take it as a wallet balance or back to MoMo |

Reversing a MoMo collection through Paystack is neither instant nor guaranteed,
which is why the guest case holds credit rather than attempting a reversal.
**⚠ This approach needs James's confirmation** — the alternative is that he
returns the money by hand, which is simpler to build but makes NFR-3.3 depend on
him remembering.

Either way **earnings are reversed** for every participant in the chain, with a
`reversal` ledger entry. Nobody profits from an undelivered bundle.

The failure screen leads with the refund, not the failure: *"Your money is being
returned."*

---

### S-05 · Split a completed sale across the chain
**Status: Built** (arithmetic) · FR-2.8, FR-2.9, FR-2.10, NFR-3.4

```
supplierCost  +  Σ(every participant's margin)  ===  what the buyer paid
```

Each participant's margin is the gap between what they paid and what they
charged. James's margin is `adminPrice − supplierCost` on an agent sale, or
`standardPrice − supplierCost` on a direct sale where he keeps the whole spread.

Implemented as pure functions in `frontend/src/lib/pricing.ts`, which is written
to move into the NestJS domain layer as-is: no framework, no I/O.
`splitDiscrepancy()` is the invariant to assert **before committing**.

**NFR-3.4:** crediting all participants and marking the order complete must be
atomic. A partial split — some credited, some not — must be impossible.

---

### S-06 / S-07 / S-08 · Reconciliation, SMS, downtime queueing
**Status: Not built** · NFR-3.2, NFR-3.3, FR-4.5, FR-7.x

- **S-06 Reconciliation.** A scheduled job polling orders stuck in `processing`
  and Paystack transactions with no matching top-up. Webhooks get lost; without
  this, money strands silently. **This is the most commonly skipped requirement
  on the list and the most expensive to skip.**
- **S-07 SMS.** Order completion, voucher delivery, top-up confirmation,
  withdrawal notification, guest refund claim link. Needs a gateway decision
  (Hubtel / Arkesel / mNotify) and a per-message cost.
- **S-08 Downtime queueing.** Orders queue and retry rather than being lost when
  DataHub GH is unavailable.

---

## 9. Error and edge-case matrix

| Condition | Behaviour | Status |
|---|---|---|
| Wrong network for bundle | Named in plain language, blocks continue | Built |
| Malformed phone number | Specific message per failure mode | Built |
| Insufficient wallet | Wallet option disabled with shortfall; MoMo offered; never a dead end | Built |
| Provider failure | Retry once → refund → visible on screen | Simulated |
| Guest failure, no wallet | Claimable credit + SMS link | Simulated |
| Unknown sell-link code | Named, with a route to the standard shop | Built |
| Agent prices below cost | Rejected with their actual cost quoted | Built |
| Agent prices above cap | Rejected with the cap quoted | Built |
| Admin sets tiers out of order | Rejected, naming which tier | Built |
| Agent opens `/admin/*` | Redirected to `/app` | Built |
| Agent opens `/app/wallet` | Redirected to `/app` | Built |
| Buyer opens `/app/*` | Redirected to `/login` | Built |
| Unknown route | Not-found with a route to the shop | Built |
| Cost rises above agent's price | Sells at cost; agent told on their pricing page | Built |
| Suspended account | Blocked from orders, top-ups, withdrawals; data intact | Backend |
| Session expires | Re-authenticate and return | Backend |
| Double-click on pay | Idempotency key; one debit, one fulfilment | Backend |
| Connection drops mid-purchase | Order already committed; status resolves via S-02/S-06 | Backend |
| Voucher SMS never arrives | Recoverable via `/track` | Built |

---

## 10. State machines

**Order** — FR-4.4

| From | To | Trigger |
|---|---|---|
| — | `pending` | Order created, payment not yet confirmed |
| `pending` | `processing` | Payment confirmed, submitted to provider |
| `processing` | `completed` | Provider confirms delivery |
| `processing` | `failed` | Provider rejects after the configured retries |
| `failed` | `failed` + refunded | Refund written (a new entry, never a reversal of the old) |

**Withdrawal** — FR-2.6

| From | To | Trigger |
|---|---|---|
| — | `pending` | Agent requests |
| `pending` | `approved` | James approves after sending MoMo |
| `pending` | `rejected` | James rejects |

Both are one-way. Corrections are new entries, never edits (NFR-2.6).

---

## 11. What the prototype proves, and what it does not

**Proven end to end, verified in a browser:** every screen and state; the
four-step purchase; guest checkout with no account; sell-link repricing; the full
chain split balancing to the pesewa; price floors and caps; RBAC redirects;
network detection from prefixes; order tracking; CSV export; the mobile layout;
and WCAG AA contrast across every route.

**Faked:** authentication accepts anything; balances live in memory and reset on
reload; fulfilment is a 2.6-second timer standing in for the DataHub GH webhook;
Paystack is a 1.6-second pause; no SMS is sent.

**The three that must not be got wrong in the backend:**

1. **Server-side enforcement.** Price bands and balance checks are UX only here.
   An agent can bypass both from the console (NFR-2.7).
2. **Payment truth is the webhook.** Never the client (S-01).
3. **The split must be atomic.** Four participants credited and the order
   completed, in one transaction, or you get a partially-paid chain (NFR-3.4).

---

## 12. Open decisions blocking flows

| # | Decision | Blocks |
|---|---|---|
| 1 | Guest refund method — claimable credit (built) or James refunds by hand | S-04 |
| 2 | Who absorbs Paystack fees. On a GHS 26.09 sale where James's cut is GHS 1.40, a ~1.95% fee is ~GHS 0.51 — over a third of his margin on deep-chain sales | S-05 economics |
| 3 | Retail caps per product. Defaults are ~45% over supplier cost; J-05 is unsafe until James sets these deliberately | J-02, J-05 |
| 4 | SMS gateway and per-message cost | S-07 |
| 5 | Whether the optional wallet account survives at all, or Mobile Money becomes the only way anyone pays | B-05, B-06 |
| 6 | DataHub GH API docs — webhook or polling for status | S-02 |
| 7 | Voucher supply: DataHub GH or a second supplier; pre-purchased inventory or on-demand | B-03 |
| 8 | Multi-level referral on or off at launch | J-05, A-07 |

---

*Companion to `functional-nonfunctional-requirements.md` (v1.1) and
`skills-breakdown.md`. Update all three together when the model changes.*
