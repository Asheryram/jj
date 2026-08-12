# JamesDataConsult — Frontend Prototype

A working, clickable prototype of the JamesDataConsult platform, built to show
what the product will look like **before** any integration work starts.

- **Stack:** React 19 + TypeScript + Vite + Tailwind CSS 4 + React Router
- **Data:** entirely mocked in [`src/data/mock.ts`](src/data/mock.ts). No live Paystack,
  no DataHub GH, no SMS gateway, no database.
- **Requirements traced:** see [`../functional-nonfunctional-requirements.md`](../functional-nonfunctional-requirements.md).
  Nearly every component carries the FR/NFR ID that justifies it.

---

## Running it

```bash
cd frontend
npm install
npm run dev      # http://localhost:5173
```

```bash
npm run build    # type-check + production build
npm run preview  # serve the production build
```

### Showing it to someone remotely

Tunnel it with ngrok (or Cloudflare Tunnel, localtunnel, serveo) and share the
URL:

```bash
npm run demo     # build + serve on :5173, no HMR socket to break
ngrok http 5173
```

`vite.config.ts` already allows `.ngrok-free.app`, `.ngrok.app`, `.ngrok.io`,
`.trycloudflare.com`, `.loca.lt` and `.serveo.net` **by wildcard**, so the link
keeps working when ngrok hands you a different subdomain next session. Any other
host is still refused, which is Vite's DNS-rebinding protection doing its job —
don't replace it with `allowedHosts: true`. For a provider not on that list:

```bash
DEMO_HOST=my-tunnel.example.com npm run demo     # PowerShell: $env:DEMO_HOST='…'
```

**Use `npm run demo`, not `npm run dev`, for a presentation.** Over an HTTPS
tunnel the dev server's hot-reload websocket tries to reach port 5173 and fails,
which throws console errors and can flash an error overlay mid-demo. `demo`
serves the real production bundle, which has no such socket and is a lot lighter
over a phone connection. If you do want hot reload through a tunnel:

```bash
$env:DEMO_TUNNEL='1'; npm run dev    # routes the HMR socket over wss:443
```

---

## Presenting it

A dark **DEMO** bar sits at the top of every screen. It is not part of the
product — it exists so the whole platform can be walked through in one sitting.

| Control | What it does |
|---|---|
| **View as: customer / agent / admin** | Switches role instantly. Changes the menus, the prices shown, and which pages are reachable (FR-1.5, NFR-2.5). Choose **guest** by logging out. |
| **Simulate upstream failure** | The next order fails at the provider and the money is returned — to the wallet if one was used, or held as a claimable credit for a Mobile Money payer. The FR-2.7 / FR-2.12 / NFR-3.3 path, and the reassurance James will be asked about most. |

### The money model

Four price tiers per product, and everyone's margin is the gap between what they
pay and what they charge. Nothing is a commission.

```
DataHub GH ──18.00──▶ James ──19.40──▶ Kwame ──23.00──▶ Abena ──24.61──▶ Naa ──26.09──▶ Customer
                        │                 │               │               │
                      +1.40             +3.60           +1.61           +1.48
```

The customer pays **26.09**, and that is exactly `18.00 + 1.40 + 3.60 + 1.61 +
1.48`. Every order stores this split, so it can never drift from what was
actually charged.

Note the cost of depth: three agents deep prices a BECE checker at **26.09**
against James's own standard price of **20.90** — 25% more. The per-product
**retail cap** (FR-3.3, FR-5.9) is the control for that, and James has to set it
deliberately.

### A twelve-minute walkthrough

1. **Landing page** — categories, the four-step promise, the agent margin pitch
   (driven by real catalogue data), the WAEC disclaimer.
2. **Open an agent's sell link:** `/s/KWAME77`. The header names Kwame, and
   every price on the page is his (FR-5.7).
3. **Buy → MTN 5GB as a guest** — no login. On the number screen type a
   **Telecel** number (`0201889340`) to show the network mismatch caught in plain
   language, then correct it to `0244118820`.
4. **Confirm screen.** The number is repeated back large with its detected
   network, and there is no wallet option because a guest has no wallet — just
   Mobile Money (FR-4.8).
5. **Confirm and pay.** Watch the pending state, then delivery. The guest is
   told to keep their reference.
6. **`/track`** — paste that reference plus `0244118820` and the order comes
   back, voucher included (FR-4.9).
7. **Turn on "Simulate upstream failure"** and buy again — the money is held as a
   claimable credit against the buyer's number, with no wallet involved.
8. **Switch to agent.** The dashboard leads with **earnings**, not a balance to
   spend, and the sell link is right there. There is no top-up anywhere.
9. **My prices** — note "You pay GHS 25.90" for MTN 5GB: that is *James's price
   to Kwame*, not DataHub's 24.00. Try 1.00 to see the floor, and 999.00 to see
   the cap (FR-3.4).
10. **Sales → open the BECE order** — the full split, four participants deep,
    with "you" marked (FR-5.8).
11. **Sell & refer** — two links doing two different jobs, and what each agent in
    the chain has earned you.
12. **Switch to admin** — pending withdrawals first, then **Where the money
    goes** (turnover split three ways from the recorded splits, not estimated),
    all orders with the chain per order, **Prices** with all four tiers and
    out-of-order rejection, and **Settings → multi-level referral** as a toggle
    rather than a rebuild (FR-5.5, NFR-5.2).

---

## What is real and what is not

**Real:** every screen, every flow, every state (loading, empty, error,
pending, refunded), all validation and error copy, role-based navigation and
route guards, network detection from the phone prefix, money as integer pesewas
throughout, CSV export, mobile layout — and **all of the chain arithmetic**. The
price bands, the split, the cap and the reversal on failure are computed by
[`src/lib/pricing.ts`](src/lib/pricing.ts), which is the real domain logic and has no
dependency on React, HTTP or a database.

**Mocked:** authentication accepts anything; balances live in memory and reset on
page reload; order fulfilment is a 2.6-second timer standing in for the DataHub
GH webhook; the Paystack step is a 1.6-second pause; no SMS is sent.

---

## How this becomes the production frontend

The prototype was structured so it is not thrown away.

[`src/state/store.tsx`](src/state/store.tsx) is a single in-memory store whose functions map
one-to-one onto the planned NestJS use cases:

| Store function | Backend use case |
|---|---|
| `topUpWallet` | `TopUpWallet` (+ the Paystack webhook that actually credits) |
| `placeOrder` | `PlaceOrder` — including the split and every participant's credit |
| `findOrder` | `LookUpOrderByReference` |
| `setAgentPrice` | `SetAgentPrice` |
| `updateProductTier` | `UpdateProductPricing` |
| `requestWithdrawal` | `RequestWithdrawal` |
| `decideWithdrawal` | `ApproveWithdrawal` / `RejectWithdrawal` |
| `toggleUserStatus` | `SuspendUser` / `ReactivateUser` |
| `setMultiLevelReferral` | `UpdateSetting` |

Integration replaces the **body** of each function with an HTTP call. No
component changes. The type definitions in [`src/data/types.ts`](src/data/types.ts) are
deliberately the shapes the API should return, so they become the shared
contract (generated from `@nestjs/swagger`).

[`src/lib/pricing.ts`](src/lib/pricing.ts) is meant to move to the NestJS **domain**
layer essentially as-is. It already has the right shape for it: pure functions,
no framework, no I/O.

Three things to keep honest when the API arrives:

1. **Server-side validation is not optional.** The price band (FR-3.4) and the
   balance check (FR-2.5) are enforced here for UX only. An agent can bypass
   both from the browser console, and they have a direct financial incentive to
   try (NFR-2.7).
2. **Payment truth is the webhook, never the client.** The top-up flow already
   models this — the UI says so out loud — and the real implementation must keep
   it that way.
3. **The split must be atomic.** Crediting four participants and marking the
   order complete has to happen in one transaction, or you get a partially-paid
   chain (NFR-3.4). `splitDiscrepancy()` in `pricing.ts` is the invariant to
   assert before committing.

---

## Layout

```
src/
  data/         types + all mock data
  lib/          pricing.ts (the chain, tiers, split, caps — pure domain logic)
                format.ts (money as integer pesewas), networks.ts (MSISDN + prefixes)
  state/        the in-memory store that becomes the API client
  components/   ui primitives, icons, hand-rolled SVG charts, app shell
  pages/
    Landing · Login · Register · Shop · Storefront (/s/:code) · Buy · Checkers · Track
    app/      Dashboard · Wallet (customers) · Earnings (agents) · Orders
              Pricing · Referrals · Reports · Withdrawals
    admin/    Overview · AdminOrders · Users · CostPrices · AdminWithdrawals · Settings
```

Note the asymmetry: `Wallet` is guarded to customers and `Earnings` to agents,
because agents never pre-fund anything. `/buy/:productId` deliberately sits on
the public shell so one checkout path serves guests and account holders alike.

Charts and icons are hand-rolled SVG on purpose: a charting library plus an icon
package would be the two heaviest assets on the storefront, and NFR-1.1 gives
the whole page a three-second budget on 4G. Current production bundle is about
**108 KB gzipped JS + 8 KB CSS**.
