# Sprint 2: Cross-Functional Backlog

Follow-up to `ISSUES.md` (money/collision correctness audit). This backlog covers four
more lenses, product UX, frontend engineering, backend query practice, and data
(split into DBA + data engineering), each written as the senior owning that area
would hand it off: prioritized, file-anchored, ready to pick up.

Priority key: **P0** ship this sprint (broken promise, silent data loss, or a
scaling time-bomb) · **P1** next up (real cost, not on fire) · **P2** backlog/polish.

---

## 1. UI/UX: Product Design

*Owner's framing: every extra click here is either an admin's afternoon or a
customer's decision to abandon a purchase. Fix the ones that are silently losing
money or trust first; throughput conveniences second.*

### P0: broken promises and silent failure risk

- [ ] **A declined Mobile Money payment dead-ends instead of resuming.**
  `frontend/src/pages/PaymentReturn.tsx:73-97,135-148`. The `'failed'` branch never
  calls `finish()`, so it never reads the `jdc.pendingOrder` sessionStorage value
  that's sitting right there, it just renders a bare "Back to shop" link. The
  resume-to-checkout flow (`Buy.tsx:108-114,759-768`) already exists and already
  works for other cases; this is the single most common failure mode (wrong PIN,
  insufficient funds) in a MoMo checkout, and it forces a full re-browse + re-typed
  phone number every time. **Fix:** route to `/buy/{productId}?order={orderId}` in
  the failed branch, same as the working paths.

- [ ] **The "payment pending" screen has no exit after ~60 seconds.**
  `PaymentReturn.tsx:68-133`. The poll loop stops re-arming after ~20 attempts and
  the `'pending'` state renders static text only, no link, no button, reference
  isn't even copyable (contrast with `CopyField` used everywhere else). Ghanaian MoMo
  confirmations routinely take longer than 60s. **Fix:** on poll exhaustion, fall
  back to `/track?ref=...`, and use `CopyField` for the reference from the start.

- [ ] **Four separate modals close before their async action is confirmed, with no
  loading state, silent failure + double-submit risk:**
  - `AdminWithdrawals.tsx:256-277` (Approve/Reject call `decideWithdrawal` without
    `await`, immediately close the modal)
  - `Refunds.tsx:254-261` (`SendRefundModal`, same shape, partially masked by a
    row-level fallback spinner)
  - `Pricing.tsx:203-211,325-332` (price-edit Save button, no `loading`/`disabled`)
  - `Pricing.tsx:214-225,338-392` (bulk markup "Apply to all", worse, nothing stops
    re-opening and re-triggering a second full concurrent sweep over every product
    before the first finishes)
  **Fix:** `await` the call, pass `loading={busy}`/`disabled={busy}` to the action
  buttons (the `Button` component already supports both), and don't dismiss until
  the promise settles. This is the same pattern already used correctly in
  `AgentApplications.tsx`, `BrandingReview.tsx`, and `DomainRequests.tsx`, bring the
  outliers in line.

- [ ] **Rejected/failed withdrawals show no reason, even though the field exists.**
  `Withdrawals.tsx:115-137` never reads `WithdrawalRequest.transferNote`
  (`data/types.ts:313`), which is explicitly documented as "why it hasn't gone."
  Agent sees "Rejected," has no idea why, contacts support. **Fix:** render
  `transferNote` under the status badge, one paragraph, zero new clicks.

- [ ] **The MoMo network selector on checkout is dead UI.** `Buy.tsx:78,460-478`,
  tapping MTN/Telecel/AirtelTigo sets local state that is never sent to the backend
  (`PlaceOrderInput`/`PlaceOrderBody` have no such field). A convincing, seemingly
  mandatory decision on the highest-stakes screen in the product has zero effect.
  **Fix:** remove it, or wire it through to the Paystack channel selection if that's
  the intent.

### P1: throughput and conversion

- [ ] **No bulk/select-all action on 6 of 7 admin approval queues**
  (`NeedsAttention`, `Refunds`, `AdminWithdrawals`, `AgentApplications`,
  `BrandingReview`, `DomainRequests`, only `NumberApprovals` has a batch action, and
  it's a clipboard copy, not a decision). At 20+ items/session this is 20-40+ clicks
  that could be 2. Start with the two highest-volume money queues: Refunds and
  Withdrawals.
- [ ] **`AdminWithdrawals` costs 2 clicks + a modal hop; every sibling queue does the
  same decision in 1 inline click.** `AdminWithdrawals.tsx:192-195,257-276` vs.
  `Refunds.tsx:208-223`, `AgentApplications.tsx:115-122`, `BrandingReview.tsx:398-410`,
  `DomainRequests.tsx:233-267`. Make Approve/Reject inline row actions.
- [ ] **Recipient number is never prefilled for a signed-in buyer.** `Buy.tsx:73`,
  unconditional blank state even for a returning agent/customer. Offer a one-tap
  "Use my number" from `session.phone`.
- [ ] **"Order again" on a failed order loses the recipient number the app already
  has.** `Orders.tsx:305-308` links to `/buy/{productId}` with no `?recipient=`
  param, even though the modal is rendering that exact number two lines above.
- [ ] **No repeat-order / favorite-bundle shortcut** for an agent serving the same
  walk-up customer weekly, no file currently implements this at all.
- [ ] **"Withdraw" buttons on Dashboard/Earnings force an extra click.**
  `Dashboard.tsx:142-146`, `Earnings.tsx:73-77` link to `/app/withdrawals`, which
  never auto-opens the request modal (`Withdrawals.tsx:37`), pass `?open=1` and
  open on mount.
- [ ] **Filter/search state resets on every navigation away and back**, `Orders.tsx`,
  `Wallet.tsx`, `Earnings.tsx`, `Pricing.tsx` all use plain `useState` with no URL
  persistence. Lift into `useSearchParams`.
- [ ] **Forgot-password doesn't carry over the email already typed on Login.**
  `Login.tsx:116` → `ForgotPassword.tsx:22` (blank `useState`). Pass it via route
  state/query, same pattern already used for `?ref=` into `Track.tsx`.
- [ ] **`Track.tsx` re-asks a signed-in user for their own phone number**, never
  reads `session.phone` to prefill (the reference remains the real lookup key, this
  is just a prefill).
- [ ] **No "reset to default markup" action in Pricing** once a product has an
  individual override, the only way back is manually recomputing the value by hand.
- [ ] **Referrals downline table has no search**, unlike every other list page in the
  app (`Referrals.tsx:157-231` vs. the search box pattern on `Orders.tsx:99-108`).
- [ ] **Switching category tabs in the shop can leave a stale network filter active**,
  producing a confusing empty grid with no visibly active filter to explain it.
  `components/Catalogue.tsx:41-63,92`, clear `network` on category change.

### P2: polish

- [ ] `ShopBranding.tsx:39-66`, edited shop name/logo/colors are pure local state,
  silently lost on navigation with no dirty-check warning or draft persistence.
- [ ] `Wallet.tsx:212-233`, top-up "redirecting" stage leaves close/backdrop/Escape
  controls visibly clickable but inert, reads as a frozen app.
- [ ] `BrandingReview.tsx:363-373`, the logo thumbnail admins are meant to scrutinize
  for impersonation risk is a fixed 56×56px with no zoom/lightbox.
- [ ] Five separate refusal modals (`Refunds`, `AgentApplications`, `BrandingReview`,
  `DomainRequests`, `NeedsAttention`) require a hand-typed ≥5-character reason with
  no canned/quick-select options and no Enter-to-submit (not wrapped in a `<form>`).
- [ ] `Checkers.tsx:84-98`, "How it works" copy still promises a wallet-payment step
  that no current account type can reach (`Register.tsx` no longer creates wallet
  accounts; `Buy.tsx:166` hardcodes `canUseWallet = false`). Update the copy.
- [ ] `Catalogue.tsx:203-209`, long product names aren't clamped/truncated in the
  shop grid, inconsistent with the truncation convention used everywhere else in the
  app (flagged independently by the frontend audit, filed here since it's a
  content/UX call as much as a CSS one).

---

## 2. Frontend Engineering: Responsive & Cross-Device

*Owner's framing: this codebase is unusually disciplined about responsive design
already (`TableWrap`, `Modal`, the chart components all carry explicit mobile-first
comments). The gaps are narrow and mostly about consistency with patterns the app
already uses correctly elsewhere.*

### P1

- [ ] **Date-range filter overflows on a 360px phone.**
  `pages/admin/AdminOrders.tsx:303-333`, two `w-40` inputs + a label sum to ~356px
  against ~336px of available width, with no `flex-wrap`. `Reports.tsx:107-137` uses
  the identical control shape but wraps it correctly, bring `AdminOrders` in line
  with that existing pattern (add `flex-wrap`, or `w-full sm:w-40`).

### P2

- [ ] **Icon-only buttons under the ~40-44px touch-target minimum the app's own
  `Button` component enforces (`BUTTON_SIZES`, `ui.tsx:64-68`, "thumb-sized, per
  NFR-4.1"):**
  - `CopyIconButton`, `AdminOrders.tsx:548-557`, 20×20px hit area
  - Modal close button, `ui.tsx:604-611`, ~32×32px
  - Toast dismiss, `layout.tsx:773-780`, ~24×24px
  - Header logout/theme-toggle, `layout.tsx:441-448,551-562`, ~36×36px
  All primary purchase-flow controls (`Buy.tsx`) already correctly use the shared
  `Button` component at full size, this is only the ad-hoc icon buttons.
- [ ] `AdminOrders.tsx:359-373`, the 11-column order table has no mobile card
  fallback; it scrolls correctly (via `TableWrap`) but reading one order's financials
  on a phone means horizontal column-by-column scrolling. Admin-only, lower priority.
- [ ] `Catalogue.tsx:203-209`, long product names wrap instead of truncating (see
  UI/UX P2 above; same fix, filed once).

### Verified already correct (no action: noted so it isn't re-audited)

Tables via `TableWrap`'s `overflow-x-auto` + `min-w-0` pattern · `Modal`'s bottom-sheet
mobile layout with `max-h-[70vh]` internal scroll · `charts.tsx`'s SVG/`viewBox`-based
scaling (no fixed pixel dimensions) · nav sidebar/bottom-nav breakpoint parity
(`lg:` on both sides, no dead zone) · viewport meta has no `user-scalable=no` ·
truncation is applied consistently everywhere except the one Catalogue case above ·
the Buy/checkout flow has no fixed-pixel-width containers.

---

## 3. Backend Engineering: Query Practice & Pagination

*Owner's framing: prioritized by which table will actually be large in this
business, Order and its satellites first, catalogue/settings-scale tables last.*

### P0

- [ ] **`AdminService.users()` runs four unbounded, all-time, unfiltered queries on
  every load of the admin Users/Team page.** `backend/src/admin/admin.service.ts:32-83`,
  wired with zero params at `admin.controller.ts:248-250`. Worst offender: the
  `user.findMany` has no `where`, `take`, or `select`, pulls every user, every
  column, **including `passwordHash`**, plus three separate all-time `groupBy`s over
  Order/Earning. **Fix:** real pagination + search/role/status filter param, `select`
  only what's rendered, window or incrementally maintain the aggregates.
- [ ] **`Branding.logoBytes` (a Bytes blob, up to 100KB) is over-fetched on the
  highest-traffic endpoint in the app.** `branding.service.ts`: `forShop()` (called
  on every public storefront render, for both platform and agent branding),
  `mine()`, and `queue()` (up to 100 rows) all skip `select` and load the full blob
  just to evaluate `Boolean(logoBytes)`. **Fix:** `select` everything except
  `logoBytes` on all but the two endpoints whose actual job is serving the image;
  test `logoMime !== null` instead.

### P1

- [ ] **`Order.buyerUserId` has no index**, despite being filtered on in
  `orders.service.ts:542,583`, `admin.service.ts:912`, and the `boughtCounts`
  groupBy, every customer's order-history load and the admin Users page hit an
  unindexed column as Orders scale. Add `@@index([buyerUserId])`.
- [ ] **`Order.refunded` has no index**, queried all-time (deliberately, per its own
  comment) on every Overview page load. Add `@@index([refunded])` or a Postgres
  partial index `WHERE refunded = true` (refunded orders are a small minority).
  *(Independently flagged by the data-engineering audit below, same fix serves
  both.)*
- [ ] **Missing compound index for the pervasive `status` + `createdAt` query
  shape**, repeated across `admin.service.ts`, `orders.service.ts`, and
  `reconciler.service.ts`. Single-column indexes exist on each side separately;
  Postgres can't use one index to satisfy both the filter and the sort. Add
  `@@index([status, createdAt])` on `Order`.
- [ ] **`Withdrawal` has no index on `requestedAt` or `agentPhone`, and its admin
  list has no pagination past the first 200 rows.** `withdrawals.service.ts:33-41`
  sorts the whole table by an unindexed column; `sendPayout`'s recipient-code reuse
  lookup (`:363-367`) scans by unindexed `agentPhone` on every payout. Add both
  indexes and a cursor/offset param.
- [ ] **`LedgerService.entries()` has no filter params** (`kind`, date range,
  `orderRef`, `userId`) and no cursor, bounded to 500 rows server-side (safe from a
  memory standpoint) but once `LedgerEntry` (the fastest-growing table in the
  schema) exceeds a few hundred rows, an admin can only ever see the newest slice.

### P2

- [ ] `ApprovalsService.releaseOrdersFor()`, N+1 per-row `update` loop
  (`orders/approvals.service.ts:186-204`); replace with one `updateMany` + a loop
  that only handles the `scheduleFor` side effect.
- [ ] `ApprovalsService.pending()`, unbounded `findMany` on `awaiting_approval`
  orders and unapproved beneficiary requests, currently safe only because a
  *different* service's 6-hour sweep keeps volume low. Add a defensive `take`.
- [ ] `AgentsService.downline()`, unbounded referral list, no `take`. Minor at
  today's scale.

### Verified already correct (no action)

`OrdersService.list()`, caller-supplied `limit` clamped to 500, admin follow-up
lookups correctly batched via `in:` + `Map` joins, no N+1 · `Transaction`/`Earning`
indexes exactly match their query shape · BFS downline resolution bounded to 10
levels, batched per level · `FulfilmentService.settle()` transaction scope bounded
by the order's own small shares list, not table size · `LedgerService.record()`
uses a real batched `createMany` · `AdminService.catalogueAccuracy()` is N+1 but
correctly bounded by catalogue size (SKU count), not order volume.

---

## 4a. Data: Database Administration (schema for business operations)

*Owner's framing: this schema deliberately denormalizes for history in specific,
well-reasoned places. The findings below are where that reasoning is applied
inconsistently, or where an invariant the schema's own header comment claims to
enforce isn't actually there.*

### P0

- [ ] **The schema header (`schema.prisma:8-10`) claims the "split-balances
  invariant" is enforced in `scripts/constraints.sql`, it isn't.** No constraint
  touches `Order.split` or checks `sale_price = supplier_cost + Σ margins`; it's
  application-code-only (`domain/pricing.ts`), and every downstream margin/ledger
  figure trusts it. Either add a `jsonb`-arithmetic CHECK, or correct the comment
  and add a periodic reconciliation query so the gap is at least monitored.
- [ ] **`LedgerEntry`, "the one place that answers what this business actually
  made", has no FK on any of its four reference columns** (`orderRef`, `paymentRef`,
  `withdrawalId`, `userId`; `schema.prisma:843-847`). An orphaned or typo'd reference
  is indistinguishable from a valid one, with zero DB enforcement. Add real nullable
  FKs on all four.
- [ ] **`onDelete: Cascade` from `User` silently destroys financial-audit history**
  (`AgentPrice`, `Transaction`, `Earning`, `Withdrawal` all cascade). No production
  code path deletes a user today, but nothing prevents it, and `UserStatus.suspended`
  already exists as the correct non-destructive alternative. Change these FKs to
  `RESTRICT`.
- [ ] **`RefundRequest` cascades on `Order` deletion, destroying proof that a real
  payout was authorized and sent**, inconsistent with `Payment.orderId`, which
  correctly uses `SET NULL` on the same event. Change `RefundRequest.order` to
  `RESTRICT` (or at minimum mirror `Payment`'s `SET NULL`).

### P1

- [ ] **`Order.soldByCode` isn't frozen the way the buyer side is**, every
  agent-attribution report (`admin.service.ts` ×2, `agents.service.ts`,
  `assistant.service.ts`) re-joins live against `User.referralCode`/`name`. If an
  agent row is ever deleted or renamed, historical commission/attribution reports
  lose or misrender the seller, the exact failure mode `Order.buyer`/`productName`
  were frozen to prevent, just on the other side of the same row. Add
  `soldByAgentName`, frozen at order creation.
- [ ] **No DB-level check that `Payment.amount` matches `Order.salePrice`**, and
  **no check preventing `Order.status = 'completed'` from coexisting with an
  unresolved `RefundRequest`** on the same order (a real "delivered and refunded
  simultaneously" double-spend shape, the same class of bug that produced the
  earlier "8 customers credited GHS 196" incident referenced in the schema's own
  comments). Add a trigger for the amount match; add a scheduled reconciliation
  query for the status/refund overlap.
- [ ] **Index gaps for finance/support queries**: `payments(paidAt)`,
  `withdrawals(requestedAt)`/`(paidAt)`, `refund_requests(createdAt)`,
  `ledger_entries(paymentRef)`/`(withdrawalId)`, "reconcile everything settled last
  week" currently means a full scan on each of these as they grow.

### P2

- [ ] **`SupplierDispatch` grows multiplicatively with retries**, no `createdAt`
  index, no archival plan, it's an attempt log (lower audit value than
  `LedgerEntry`) and the fastest-growing table in the schema; good first candidate
  for a retention/cold-storage policy once orders are old and settled.
- [ ] **Phone-history gap**: `User.phone` is mutable (`auth.service.ts:174-198`) but
  `Order.buyerPhone` is correctly frozen at purchase time, so a customer who
  changes their number leaves guest-checkout orders under the old number that
  nothing links back to their account. Not a flaw in the freezing; a missing
  capability. Consider a lightweight phone-history log.
- [ ] **`User.balance` as a single mutable column will be the throughput ceiling for
  a popular agent's transaction volume** (every purchase/withdrawal/refund/credit
  takes a row lock on it). Correct and necessary for the `balance >= 0` CHECK to
  work, not a defect, just the thing to watch (lock-wait stats) as volume grows.
  No schema change recommended today.

### Verified already correct (no action)

`Order.buyerUserId`'s `SET NULL` (nothing does a live join through it for rendering,
calibrated exactly right) · `Payment.userId`'s `SET NULL` (same reasoning) ·
`Product`/`SupplierProduct` correctly `RESTRICT` deletion, forcing soft-delete
instead · idempotency discipline throughout (`Order.idempotencyKey`,
`Transaction`/`Earning`'s composite unique, `LedgerEntry.idempotencyKey`), no gaps
found · every other "snapshot for history" field verified as actually frozen and not
depending on a live join.

---

## 4b. Data: Data Engineering (analytics/reporting at scale)

*Owner's framing: ranked by what breaks first as order/ledger volume grows into
the millions. Nothing here is on fire at today's scale, these are the queries that
get slower every single month, forever, with no ceiling, unless something changes
their shape now.*

### P0

- [ ] **`SolvencyService.position()` runs 14 parallel queries, several with no date
  bound at all**, on every Reserve-panel page load, plus a 30-minute background
  poll that never stops running it, forever, if `paystackBusinessAccount` is on.
  `collectedSince()`, `transfersSince()`, and two `LedgerEntry` all-time aggregates
  (`solvency.service.ts:204-342,466-506,544-550`) all sum every matching row ever
  written; cost grows with the table, unbounded, permanently. No cache exists
  anywhere in the backend (confirmed by grep). **Fix:** this is the textbook case
  for a running-total cache row (not a nightly rollup), increment a small
  `Setting`-style running total atomically inside `LedgerService.record()`'s single
  choke point, and have `position()` read that instead of re-summing history on
  every call. Turns O(n)-forever into O(1).
- [ ] **`AdminService.revenueByDay()` builds an `IN (...)` clause sized to however
  many orders matched the date window, with no upper bound on the `days` param at
  all.** `admin.service.ts:754-799`, route at `admin.controller.ts:562-565`. This
  isn't linear degradation, it's a parameter-count-scales-with-data-volume shape.
  At a mature ~5k orders/day, a 30-day window already approaches Postgres's
  practical bind-parameter ceiling; an unclamped `?days=365+` on a large table is
  the single most likely candidate in this codebase for an outright request timeout
  or hard error, not just slowness. **Fix:** do the bucketing and cost-join
  server-side in one query (raw SQL `groupBy`/`date_trunc`), and clamp `days` the
  same way `finance/statement` already correctly does.

### P1

- [ ] **Missing composite indexes for the actual report query shapes**:
  `LedgerEntry(kind, occurredAt)` (used by `ledger.service.ts.statement()`),
  `Order(status, createdAt)` (used by `overview()`/`revenueByDay()`, same gap
  independently flagged by the backend audit above), `Order(soldByCode, createdAt)`
  (used by the "going quiet" agent check, `admin.service.ts:1025-1029`).
- [ ] **`Order.refunded` has no index and is queried all-time on every Overview
  load**, same finding as the backend audit; filed here too since it's the
  reporting surface that triggers it. One fix serves both.
- [ ] **Overview.tsx's "All time" ledger toggle bypasses the 365-day cap that every
  other value respects, and does three full passes over the same rows** (one
  `groupBy` + two independent `aggregate` calls that could be derived from the
  `groupBy` result already in hand). Reachable by any admin with one click.
  `Overview.tsx:84-109,393-401`, `ledger.service.ts:107-158`.

### P2

- [ ] **`Reports.tsx`'s date-range picker is fake and will start silently
  undercounting as agent order volume grows.** It filters whatever ≤100
  most-recent orders are already in the client store (`OrdersService.list`, capped
  at 500) rather than asking the backend for the selected window, once an agent
  exceeds ~100 orders within a chosen range, totals shown are wrong with no error.
  `AdminService.mySummary()` already has the correct DB-side-aggregated pattern;
  give `Reports.tsx` an equivalent real endpoint. Also: its range cutoffs are
  hardcoded literal dates instead of computed relative to today, fix alongside.

### Verified already correct (no action)

No dashboard polling found anywhere in the frontend (`FloatRisk`, `ReservePanel`,
`CatalogueAccuracy`, `Overview` all fetch once on mount or on manual refresh), the
only interval-driven jobs are backend-side and already bounded (`ReconcilerService`'s
60s sweep is `take: 25`) · chart payloads are always pre-bucketed server-side, never
raw per-order rows shipped to the browser · `catalogueAccuracy()`/`floatRisk()`
correctly scale with catalogue size, not order volume · `mySummary()`/
`agentEarningsByDay()` correctly use DB-side aggregation (the pattern `Reports.tsx`
is missing, per P2 above).

---

## Suggested sequencing

1. **This sprint (P0 across all five lenses):** the four modal-closes-before-confirm
   UX bugs, the PaymentReturn resume/dead-end fixes, `AdminService.users()` and the
   branding-blob over-fetch, the `LedgerEntry` FK gaps and the two destructive
   cascades, and `SolvencyService.position()`'s running-total cache. These are the
   items where something is silently wrong *today*, not just slow later.
2. **Next sprint (P1):** index additions (cheap, high-leverage, several serve two
   teams' findings at once, `Order.refunded` and `(status, createdAt)` are shared
   wins), the admin queue bulk-actions and inline-approval consistency pass, and the
   `revenueByDay`/Reports.tsx real-date-range fixes before the time-bomb ones go off.
3. **Backlog (P2):** polish items, touch targets, canned refusal reasons, draft
   persistence, archival planning for `SupplierDispatch`.
