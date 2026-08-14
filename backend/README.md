# JamesDataConsult API

NestJS + Prisma + PostgreSQL. Serves the React SPA in `../frontend`.

The frontend has **no mock mode** — every price, balance and order on screen came
out of Postgres. If this API is not running, the app says so instead of inventing
data.

---

## Start it

Docker Desktop must be running first.

```bash
cd backend
npm install
npm run setup     # container + migrate + constraints + seed
npm run dev       # http://localhost:3001/api
```

Then the frontend, in a second terminal:

```bash
cd frontend
cp .env.example .env.local     # points at http://localhost:3001/api
npm install
npm run dev                    # http://localhost:5173
```

| What | Where |
| --- | --- |
| App | http://localhost:5173 |
| API | http://localhost:3001/api |
| Swagger | http://localhost:3001/api/docs |
| Health | http://localhost:3001/api/health |
| Database browser | http://localhost:8081 — server `db`, user `jdc`, password `jdc_dev_password` |

Postgres is published on **5433**, not 5432, so it cannot collide with a
Postgres already installed on the machine. A silent connection to the wrong
database is a worse failure than a refused one.

### Scripts

| Command | Does |
| --- | --- |
| `npm run setup` | Everything below, in order. Run this first. |
| `npm run db:up` / `db:down` | Start / stop the containers |
| `npm run db:reset` | Destroy the volume and start clean |
| `npm run migrate` | Apply Prisma migrations |
| `npm run constraints` | Apply the CHECK constraints Prisma cannot express |
| `npm run seed` | Wipe and re-seed to a clean slate. Safe to re-run any time. |
| `npm run seed:history` | Same, but with a month of trading behind it |
| `npm run dev` | API with reload |

---

## Test accounts

**Login is by email address**, not phone number. A number changes hands in Ghana
— SIMs get swapped and recycled — and an identifier that can end up belonging to
someone else is the wrong thing to hang an account on. The phone number stays on
the account for delivery and MoMo payout; it is just not the credential.

Every seeded account uses the password **`demo1234`** (`SEED_PASSWORD` in `.env`).

There are **two seeded accounts**, and that is on purpose:

| Role | Email | Notes |
| --- | --- | --- |
| Admin | `james@jamesdataconsult.com` | James Owusu. Provider catalogue, price tiers, users, withdrawals, reports. |
| Agent | `kwame.boateng@example.com` | Kwame Boateng, `KWAME77`. Registered directly, so he has no referrer. Sell link: `/s/KWAME77`. |

Everyone else is created by **using the product**. To test the referral bonus,
register a second agent through `/s/KWAME77` → "Become an agent" (the form arrives
pre-filled with Kwame's code), then sell through the new agent's link and watch
Kwame's bonus land. That exercises the path for real instead of trusting a
pre-baked seed.

To test the customer wallet, register a buyer account and top it up on the Wallet
page. Guest order tracking uses **reference + phone number** — a guest has no
account to log in to.

Buying needs **no account at all** (FR-4.8) — that is the main path through the
site, and the one to put in front of testers first.

### Seeded state

`npm run seed` gives a **clean slate** — the price list and the accounts, nothing
else. Every balance is zero, there are no orders, and no money has moved. That is
what you want when the question is "does this actually work": a first sale you can
watch land against numbers you know started at nothing.

- 38 products across data, airtime, voice, SMS, AFA and result checkers
- 2 accounts — James and Kwame. Nothing else.

`npm run seed:history` instead loads ~270 orders over 31 days, with balances,
a withdrawal request, and unclaimed refund credits — for when the question is
about charts, pagination, or a payout queue with something in it. It builds the
history from whoever is in `USERS`, so trimming that list does not break it.

Either way, every balance is **earned, not asserted**: the seed starts everyone at
zero and moves money only through orders, top-ups and withdrawals, in
chronological order. So `users.balance` always equals the sum of that user's
ledger rows, and the seed refuses to finish if it does not. A tester who adds up
the rows on screen gets the number in the corner.

---

## What is simulated, and what is not

There are no DataHub GH or Paystack credentials yet, so two things stand in.
Everything else — auth, pricing, the ledger, the referral split, order state,
refunds, withdrawals — is the real implementation running against real Postgres.

### Fulfilment: the `supplier_products` table

`supplier_products` is the DataHub GH catalogue: their SKU code, their cost
price, and whether they have stock. Our `products.supplier_cost` is copied from
it, never typed in by hand. When the real API keys arrive, that table becomes a
cache of the price-list response and nothing downstream of `supplier_code`
changes.

Every fulfilment attempt is written to `supplier_dispatches` — what we asked for
and what came back, with `simulated = true`. When a tester says "my bundle never
arrived", that table answers it without anyone reading application logs.

**Fulfilment is deterministic on purpose.** A random failure rate would have
testers filing bugs against dice rolls. An order fails only when there is a
reason:

- the provider SKU is marked out of stock, or
- the `simulateFailure` platform setting is on.

### Making an order fail on demand

To exercise the refund path (FR-2.7) — money back to a wallet, or held as a
claimable credit for a Mobile Money payer:

**In the UI:** sign in as admin → **Settings → Provider catalogue** → switch a SKU
out of stock. Buy it, watch it fail and refund, switch it back. The page also
shows what each SKU costs and lets you change it.

**Or over HTTP:**

```bash
# Log in as admin and grab the token
TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"james@jamesdataconsult.com","password":"demo1234"}' | jq -r .accessToken)

# Take MTN 2GB out of stock
curl -X PATCH http://localhost:3001/api/admin/supplier/DH-MTN-DATA-2GB/availability \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"available":false}'

# ...buy it in the UI, watch it fail and refund, then put it back
curl -X PATCH http://localhost:3001/api/admin/supplier/DH-MTN-DATA-2GB/availability \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"available":true}'
```

`GET /api/admin/supplier` lists every SKU and its code.

### Payments: direct credit

`POST /api/wallet/topup` credits the wallet directly. That is **not** the
production flow. Live, the client initialises a Paystack transaction, the user
pays, and the wallet is credited only from the verified webhook — the browser
saying "it worked" is never proof of payment. The seam is `WalletService.topUp`.

Safety valve: if `PAYSTACK_SECRET_KEY` is ever set, direct crediting refuses
rather than handing out free money.

`/api/health` reports `providers.datahub` and `providers.paystack` as `simulated`
or `live`, so you can always check which world you are in.

---

## Where prices come from

Four numbers per product, and only three of them are James's to set.

| Number | Who sets it | Where |
| --- | --- | --- |
| **What James pays** | The provider | `supplier_products.cost_price` → Settings → Provider catalogue |
| What agents pay | James | Prices page |
| James's own walk-up price | James | Prices page |
| Retail cap | James | Prices page |

`supplier_cost` is **read-only on the Prices page**, and `PATCH /admin/products/:id/tier`
refuses that tier outright. It is what James is invoiced, and it is the baseline
every margin in the platform is measured from — if it could be typed on a pricing
screen it would drift from the invoice, and every margin shown to every agent
would quietly be wrong.

Changing it on the provider catalogue flows down: the mapped products' costs
follow, and any tier the new cost has overtaken is lifted with it so the ordering
constraint still holds. Orders already placed keep the cost they were sold at,
because each one carries its own split snapshot.

### The rules, and the one that is deliberately absent

Only two orderings are enforced:

- **Neither selling price may be below cost.** Selling under cost destroys money
  on every order; that is never a preference.
- **The retail cap must clear what agents pay**, or no agent could legally sell.

There is deliberately **no rule that the walk-up price sits above the agent
price.** James wholesales *and* retails, so where his own counter price sits
relative to what he charges agents is a commercial choice per product:

| He sets walk-up… | Effect |
| --- | --- |
| below the agent price | he earns more from agent volume than from his own counter |
| level with it | he is indifferent to which channel a sale comes through |
| above it | his own sales are the more profitable ones |

The price dialog states which of the three he has picked, and both margins are
shown against the provider cost. A cost rise lifts the walk-up price only as far
as cost — never up to the agent price, which would silently overwrite his choice.

Below James, **every agent pays the same price** — `admin_price` — no matter who
referred them. There is no cascade. Being three referrals deep does not make your
stock more expensive, and a customer never pays for the length of a chain.

## Referral

An agent either registered directly or was referred by exactly one other agent.
That is the whole structure: **one level, no chains.** A referred agent can refer
others, but each sale pays exactly one referrer — the seller's own.

When referral is on, a referred agent's sales pay their referrer a bonus: an
admin-set percentage of **James's** margin on that sale, not the seller's.

| | |
| --- | --- |
| The seller | keeps their whole margin, exactly like an agent who joined directly |
| The referrer | is paid a share of James's margin |
| James | keeps the rest of his own margin |
| The customer | pays the same price either way |

Funding it from James is the part that matters. Take it from the seller and a
referred agent earns less than a directly-registered one on an identical sale — so
nobody would ever use a referral link, and the feature would suppress the growth
it exists to create. It also cannot overdraw: a share of James's own margin, at a
rate capped at 100%, is always payable, where a share of the *seller's* margin can
easily exceed the spread James has to pay it from.

Worked example at 25% on 1GB Data:

```
James pays the provider   5.50
James charges agents      5.90   → his margin is 0.40
Naa (referred by Abena) sells at 6.25

  supplier                5.50
  Naa      (seller)      +0.35   her full margin, 6.25 − 5.90
  Abena    (referrer)    +0.10   25% of James's 0.40
  James    (platform)    +0.30   the remaining 75%
  ─────────────────────────────
  customer paid           6.25
```

Both controls are on **Settings → Referral bonus**: the on/off switch and the
rate. The page prices the rate against a real product, so what James is giving
away is on screen rather than inferred.

`SplitShare.depth` is a fixed slot, not a chain position: `0` the seller, `1` the
referrer, `2` the platform. Fixed because a stored split has to read the same
forever — if the platform collapsed to `1` whenever there was no referrer, then
`depth === 1` would mean different things on different orders.

## How the money works

Split-at-sale. Nobody pre-funds anything.

DataHub GH sells to James at `supplier_cost`. James sells to his agents at
`admin_price`. Each agent sells to the agent below them at their own resale
price. The bottom agent sells to the customer. Everyone's margin is the gap
between what they paid and what they charged — there is no commission to
calculate, because every upline's markup is already inside the price the seller
paid.

The invariant, asserted before any order commits:

```
salePrice === supplierCost + sum(shares.margin)
```

If it does not hold the transaction rolls back rather than committing a
plausible-looking wrong number.

`src/domain/pricing.ts` holds this as pure functions — no NestJS, no Prisma, no
HTTP. `frontend/src/lib/pricing.ts` is a matching copy so the browser can render
40 prices without a request each. **The browser's price is only ever a quote.**
Every order is priced again here, server-side, from rows read inside the placing
transaction.

### Things that are actually enforced

- **The debit race.** A wallet debit is one conditional `UPDATE … WHERE balance >= amount`,
  not read-check-write. Twelve simultaneous purchases against GHS 45.00 at
  GHS 6.40 accept exactly 7 and refuse 5. `CHECK (balance >= 0)` backs it up.
- **Idempotency.** Orders carry a client-generated key. Replaying it returns the
  original order rather than charging twice — a double-tapped Confirm on a flaky
  connection cannot produce two debits or two deliveries.
- **Ledger idempotency.** `UNIQUE (user_id, reference, type)` on both ledgers, so
  a replayed provider callback cannot credit an agent twice.
- **Row-level scoping.** An agent sees their own sales and their downline's, not
  by role alone but by referral-code scoping in the query (NFR-2.5).
- **Constraint discipline.** `scripts/constraints.sql` holds non-negative
  balances, ordered price tiers, sign-matches-type on both ledgers, and
  all-or-nothing vouchers. The database is the last place a bug can be stopped.
- **Restart recovery.** Orders left in `processing` by a restart are picked up on
  boot. Without it, an API restart mid-test strands paid orders forever.

---

## Known trade-offs

Worth knowing before this goes in front of anyone.

1. **`/catalogue` ships the referral chain to the browser.** That is what lets a
   storefront render instantly on a slow connection, and it is how an agent sees
   the split they are part of (FR-5.8). The cost: an agent can read other agents'
   markup percentages from that payload. James's `supplier_cost` — the one number
   that reveals his own margin — is stripped for everyone but admin. Tightening
   the rest means resolving prices per-request server-side and losing the instant
   render. Revisit before public launch.

2. **Downline `earnedForUpline` is apportioned, not attributed.** Each
   sub-agent's contribution is split by share of volume. The total is exact; the
   per-agent figure is an estimate. Exact attribution needs the seller's id on
   every earnings row.

3. **Fulfilment is an in-process timer, not a queue.** Production wants BullMQ
   with retry and backoff (NFR-3.2, FR-4.6). `FulfilmentService.settle()` is
   already the seam — only the transport changes.

4. **No rate limiting.** `@nestjs/throttler` belongs on login and top-up before
   this is public.

5. **A sell link owns its session.** Once a buyer arrives through `/s/CODE`, every
   public page keeps that agent's prices and the wordmark returns to their
   storefront — otherwise the platform would quietly poach customers the agent
   brought, and agents would stop sharing links. There is no "use standard prices"
   escape; the buyer's protection is `max_retail_price`, which caps what any agent
   can charge. A fresh browser session is the platform shop again.

6. **Withdrawal payout is manual.** Approving a withdrawal is bookkeeping; the
   MoMo transfer happens outside the system. Rejection is the branch that moves
   money, and it does put the held amount back.

7. **Password reset is not implemented.** The "Forgot password?" link is inert.

---

## Layout

```
src/
  domain/pricing.ts        Pure money rules. No framework, no ORM.
  prisma/                  Client + module
  common/                  Auth guard, error envelope, row → response mappers
  auth/                    JWT login, register, /me
  catalogue/               Products + referral chain in one call
  pricing/                 Loads the chain from Postgres, hands it to domain/
  orders/                  Place, list, track + the fulfilment worker
  supplier/                DataHub GH adapter (simulated)
  wallet/                  Customer balance and top-ups
  agents/                  Earnings, own prices, downline
  withdrawals/             Request and approve
  admin/                   Users, price tiers, supplier catalogue, reports
  settings/                Runtime platform switches
  health/                  DB round trip + which providers are live
prisma/
  schema.prisma            The model, with money as integer pesewas throughout
  seed.ts                  Reconciling seed data
scripts/
  constraints.sql          CHECK constraints Prisma cannot express
  wait-for-db.mjs          Polls Postgres so migrate does not race the container
```

Money is **always** an integer number of pesewas. GHS 12.50 is `1250`. Never a
float, anywhere.
