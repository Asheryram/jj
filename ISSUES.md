# Issues — Payment/Order/Wallet Race-Condition & Account-Tier Audit

Audited 2026-09-13. Scope: Paystack payment collection, DataHub GH fulfilment, customer
wallet, agent withdrawals/refunds, and auth/session handling, with specific attention to
collisions (double-processing), worst-case concurrency, and behavior across a Paystack
"Starter" vs verified "Business" account tier.

Severity: 🔴 Critical (real money duplicated/lost, or full session bypass) · 🟠 High ·
🟡 Medium · ⚪ Low/hygiene. Each entry lists the file(s), the concrete trigger sequence,
and the actual impact — no theoretical-only findings are included.

---

## 🔴 Critical

### 1. `applyPaid` double-credits a wallet / double-dispatches an order under concurrency
**File:** `backend/src/payments/payments.service.ts:294-435` (`applyPaid`)

The webhook (`charge.success`) and the browser's return-trip call
(`POST /payments/confirm`) both funnel into `applyPaid`. It reads `Payment.status`,
branches on it in JS, then issues an **unconditional** `tx.payment.update` — not a
conditional `WHERE status = 'pending'` update. Two overlapping calls for the same
reference (webhook + browser return commonly arrive within the same second) can both
read `status: 'pending'` before either commits.

`LedgerService.record()` uses `createMany({ skipDuplicates: true })`, so the second
caller's ledger write is silently dropped **without throwing** — meaning nothing stops
the second caller from continuing on to `tx.user.update({ balance: { increment } })`
a second time.

- **Top-up:** wallet is credited twice for one Paystack charge; ledger shows only one
  entry (deduped), so the books understate a real liability while the customer has
  free money.
- **Order payment:** the order is scheduled for DataHub dispatch twice. The only guard
  is an in-process `Map` in `FulfilmentService.schedule` — safe on one Node process,
  not safe across horizontally-scaled instances or a webhook landing on a different
  instance than the browser return. Result: a second real purchase from DataHub for
  one paid order.

Compare with `applyTransfer`/`applyRefundTransfer` in the same file, which correctly
use an atomic `updateMany({ where: { status: {...} } })` claim — `applyPaid`, handling
the highest-value case, never got the equivalent fix.

**Fix direction:** `tx.payment.updateMany({ where: { reference, status: 'pending' },
data: {...} })`, proceed only if `count === 1`.

---

### 2. Refund/withdrawal *approval* is a read-then-write race, despite comments claiming it's guarded
**Files:** `backend/src/orders/refunds.service.ts:87-215` (`approve`), `:233-322`
(`settleManually`); `backend/src/withdrawals/withdrawals.service.ts:183-313` (`decide`)

The code comments explicitly claim: *"Guarded on the row's own state inside the
transaction, so a double-click or two admins at once cannot pay the same refund
twice."* This is false for the `transfer` method (the only method used going
forward — wallet refunds are legacy). The guard is a plain `findUnique` read followed
by an unconditional `update` — no `WHERE status = 'pending'` clause, no row lock.

Two concurrent `approve()` calls for the same refund/withdrawal both pass the check,
both commit, and both independently call `sendRefund`/`sendPayout`, each reading
`transferCode: null` (itself an unlocked read) and each calling
`paystack.transfer()`. The only remaining backstop is Paystack rejecting a duplicate
**reference** — an external system's behavior the code trusts but never verifies
locally. Two admins approving the same pending transfer within the same window is a
live double-payout risk on the exact control that was added specifically to prevent
repeating the earlier "8 customers credited GHS 196 they were never owed" incident.

(For the legacy `wallet` refund method, a double-credit is *accidentally* prevented —
the second `Transaction` insert collides with the `@@unique([userId, reference,
type])` index and rolls back — but that produces an unhandled 500, not the intended
clean `ConflictError`.)

**Fix direction:** replace with `updateMany({ where: { id, status: 'pending' }, data:
{...} })` and branch on `count === 0`, mirroring the pattern already used correctly in
`FulfilmentService.settle()`.

---

### 3. `settleManually` + a later genuine Paystack webhook causes real double-payment
**Files:** `backend/src/withdrawals/withdrawals.service.ts:330-460` (`sendPayout`),
`:481-531` (`settleManually`); `backend/src/orders/refunds.service.ts:233-322`;
`backend/src/payments/payments.service.ts:597-701` (`applyTransfer`)

When a transfer attempt times out or 5xxs, Paystack's own state is genuinely
ambiguous (`kind: 'unknown'`) — the transfer may or may not have actually been
created server-side. The withdrawal/refund is left `status: 'approved'`,
`transferStatus: 'unknown'`, **`transferCode: null`**.

An admin who sees it stuck calls `settleManually` — its only guards are
`status === 'approved'` and `!transferCode`, both true for `'unknown'` — so it marks
the row `paid`, books a `capital_in` (the admin's own pocket), and the admin also
manually pays the agent/customer by hand.

Days later, Paystack's real webhook for that reference arrives (the original transfer
actually did land):
- If it's `transfer.success`: `applyTransfer` sees `status === 'paid'` and treats it
  as already-applied, **silently dropping it** — no log distinguishes "manually
  settled" from "duplicate webhook." Net effect: **the agent/customer is paid twice**
  (once by hand, once by the real transfer), with nothing anywhere flagging it.
- If it's `transfer.failed`/`reversed`: the exclusion check in `applyTransfer` only
  excludes `status: 'failed'`, and status here is `'paid'` — so the handler proceeds,
  flips status to `'failed'`, and **increments the agent's balance a second time**,
  even though the balance was never re-debited by the manual settlement. The agent
  keeps free money equal to the withdrawal amount **on top of** whatever was paid by
  hand.

The refund path (`refunds.service.ts`) is partially protected in one direction
(`settleManually` sets `transferStatus: 'success'`, which does block a later
duplicate `transfer.success`) but **not** the other: a later `transfer.failed` still
isn't excluded, so it flips the refund back to `pending` and deletes its ledger entry
— even though the customer was already paid by hand — inviting a genuine second
payout if an admin approves it again from the queue.

**This is the concrete mechanism through which a Paystack Starter-tier limitation (or
any transfer timeout) turns into duplicated real money** — see also #7 below.

**Fix direction:** have `settleManually` write a sentinel (e.g. keep `transferCode`
set to a manual marker, or a dedicated `resolvedManually` flag as already exists on
`Order`) that a later webhook checks before acting, not just `status`.

---

### 4. No compare-and-swap before the actual DataHub purchase call — real double-dispatch risk
**File:** `backend/src/orders/fulfilment.service.ts:111-181` (`run`)

`run()` does a plain read (`order.status !== 'completed'/'failed'`) and then calls
`this.supplier.dispatch(order)` — the one HTTP call the code's own comments say "has
no idempotency key, so a retry can deliver twice." Nothing claims the order into a
"dispatching" state first. The only de-dup is an in-process `Map` in `schedule()` —
useless across horizontally-scaled instances (webhook lands on instance A, the
restart-recovery sweep runs on instance B; both dispatch the same order for real).

Compounding this: the restart-recovery sweep's exclusion filter
(`fulfilment.service.ts:71-77`) only skips an order if a prior `SupplierDispatch` row
recorded a real `providerReference` or `providerCharged`. When DataHub returns an
ambiguous `unknown` outcome (timeout/5xx), the dispatch row is written with **both
fields null** — so the sweep treats the order as never attempted and **re-dispatches
it** on every subsequent restart/deploy. This directly answers the "DataHub timeout"
scenario: every order whose dispatch outcome was ambiguous gets a second live
purchase attempt the next time the process restarts.

**Fix direction:** claim the order atomically (`updateMany({ where: { id, status:
{notIn: [...]} }, data: { status: 'dispatching' } })`) before calling
`supplier.dispatch`, and have the recovery sweep also exclude orders whose most recent
dispatch outcome was `unknown` (park those for a human, as the code's own
`DispatchResult` doc comment already says they should be).

---

### 5. Refund OTP outcome is mislabeled as `failed`, silently stranding it in a no-op loop forever
**File:** `backend/src/orders/refunds.service.ts:415-423` (`sendRefund`'s `otp`
branch), `:455-480` (`holdRefund`)

`sendRefund`'s `otp` branch calls `holdRefund(refundId, reason, transferCode)` with
only 3 args, so `status` defaults to `'failed'` inside `holdRefund`. That resets
`RefundRequest.status` to `'pending'` (not `'approved'`) and `transferStatus` to
`'failed'` (not `'otp'`) — mislabeling an OTP-blocked transfer as an outright failure,
and deleting the refund's ledger cost entry.

Because `status` resets to `'pending'`, the refund reappears in the normal queue as if
nothing had happened. An admin who clicks "approve" again re-transitions it to
`'approved'` and calls `sendRefund` again — which immediately no-ops because
`transferCode` is already set. **The refund is now stuck forever**, alternating
`pending` → `approved` on every click with zero forward progress and no correct
signal that the real fix is clearing an OTP requirement in Paystack's own dashboard.

Withdrawals handle the identical `otp` case correctly (`transferStatus: 'otp'`,
`status` stays `'approved'`) — this is a refund-specific regression from the
withdrawal pattern, not a design limitation.

---

## 🟠 High

### 6. Suspended/rejected users keep full transaction access for up to 12 hours
**Files:** `backend/src/common/auth.ts:96-133` (`AuthGuard`);
`backend/src/withdrawals/withdrawals.service.ts:50` (`request`)

`AuthGuard` only verifies the JWT's signature/expiry and reads role/sub from the token
payload — it never re-queries the DB for the user's *current* `status`. JWTs are
issued with a 12-hour expiry and there is no refresh-token rotation or revocation
list. `status` is checked at `login()` and at `switchProfile()` — nowhere else.

Concretely: an admin suspends an agent mid-session. The agent's existing JWT is
untouched and keeps passing role checks. `WithdrawalsService.request()` — the
endpoint that immediately debits the agent's held balance into a pending payout — does
**no** status check at all. A suspended agent can keep filing withdrawal requests
until their token naturally expires, up to 12 hours later.

**Fix direction:** re-check `user.status === 'active'` in the auth guard (cache it
briefly if a DB round-trip per request is a concern), or maintain a short
suspended-user denylist checked per request.

---

### 7. Login throttle is per-IP only, in-memory, and resets on every deploy
**File:** `backend/src/auth/login-throttle.guard.ts`; `backend/src/auth/auth.module.ts:12-24`

Built on `@nestjs/throttler`'s default IP-keyed tracker with no per-account
dimension. Two consequences:
- **Bypassable by an attacker rotating IPs** — cumulative credential-stuffing against
  one target account faces no limit at all, since every new IP gets its own fresh
  bucket.
- **Collateral lockout of shared-IP users** — everyone behind one NAT/campus wifi
  (e.g. a group of agents at one location) shares a single bucket and can be locked
  out by ordinary concurrent logins.

The module's own comment already flags the in-memory store as "worth revisiting
behind more than one [instance]" — a redeploy wipes all counters (a brief unprotected
window after every deploy), and horizontal scaling multiplies the effective limit by
the instance count since each instance counts independently.

**Fix direction:** add a per-account counter (keyed on the submitted email, not just
IP) backed by a shared store (Redis, or the existing Postgres) rather than in-memory
per-instance state.

---

## 🟡 Medium

### 8. Concurrent agent-margin reversals can abort an entire order settlement, stranding the order
**File:** `backend/src/orders/fulfilment.service.ts:666-753` (`reverseAgent`)

`reverseAgent` reads the agent's balance, computes a "recoverable" claw-back amount
from that (potentially stale) snapshot, then issues a relative `decrement`. If two
orders for the *same* agent fail at nearly the same time (e.g. webhook + reconciler
sweep landing close together), both transactions can compute their `recoverable`
figure from the same pre-reversal balance. The second to commit can drive the
decrement below zero, tripping the `CHECK (balance >= 0)` constraint — which rolls
back **the entire enclosing transaction**, including the order's status flip to
`failed` and its `RefundRequest` creation.

Net effect: no money is lost or duplicated (the CHECK constraint does its job), but a
customer whose order genuinely failed can be left with no bundle and no refund
request at all, with nothing auto-retrying — only a human noticing the error log and
manually re-triggering settlement recovers it.

---

### 9. Idempotency-key race doesn't double-charge, but does break the "never leave an order stranded" contract it exists for
**File:** `backend/src/orders/orders.service.ts:73-87` (`place`), `:386-396`
(`freshReference`)

The `idempotencyKey` existence check (`findUnique`) happens *before* the transaction
that later creates the order with that key — a genuine TOCTOU gap. Under a true race
(the exact double-tap scenario the key exists to protect against), Postgres correctly
prevents a double debit (the loser's whole transaction rolls back on the unique
violation), but the loser then receives a raw, unhandled `P2002` — surfaced by the
generic exception filter as `409 ALREADY_EXISTS: "That value is already registered."`
— instead of the original order/payment URL. This is precisely the outcome the code's
own comment says was deliberately designed against ("a 409 would leave a real order
stranded"). The same check-then-act pattern exists in `freshReference()` for order
reference generation (far lower collision odds, same shape of bug).

**Fix direction:** on a unique-constraint collision for `idempotencyKey`, catch it and
return the existing order/payment rather than propagating the raw conflict.

---

### 10. Overpayment is silently absorbed with no ledger entry or audit trail
**File:** `backend/src/payments/payments.service.ts:319-324`

Underpayment is explicitly checked and left `pending` for a human to review.
Overpayment (Paystack reports an amount greater than requested — plausible on some
Mobile Money authorization flows where the amount can be edited on the phone prompt)
has no corresponding check. The payment proceeds as a normal success, but every
downstream credit uses the originally-requested `payment.amount` — the surplus is
never recorded anywhere (no ledger entry, no transaction row, no log line).

---

### 11. Concurrent use of the same still-valid password setup/reset token can both succeed
**File:** `backend/src/auth/setup-tokens.service.ts:212-247` (`consume`)

The single-use guard is a plain `findUnique` read (`usedAt` null, not expired, user
active) with no row lock, followed by unconditional writes to both `User.passwordHash`
and `SetupToken.usedAt` — neither guarded by `WHERE used_at IS NULL`. Two genuinely
concurrent uses of the same token (both requests reading `usedAt: null` before either
commits) can both pass the guard; Postgres only serializes them at the `UPDATE` step,
and the second one proceeds anyway since it never re-checks the guard post-lock.
Result: both calls return success, and the final password is whichever committed
last — silently overwriting the other with no error to either caller. This
contradicts the schema's own comment claiming replay is impossible; that claim only
holds for *sequential* reuse, not concurrent reuse. Impact is bounded (requires
already possessing the valid token), but is a real, demonstrable gap.

**Fix direction:** `updateMany({ where: { id, usedAt: null }, data: { usedAt: now } })`
and branch on `count === 0` before touching the password.

---

### 12. Fulfilment SKU is re-resolved live at dispatch time, not pinned at order time
**File:** `backend/src/supplier/supplier.service.ts:145-165, 203-205`

`Order.salePrice`/`split` are frozen at purchase time from `Product`, but the actual
`supplierCode`/`networkKey`/`capacityGb` used to place the DataHub purchase are
re-read live from `Product`/`SupplierProduct` at dispatch time — which can be minutes
later, or up to the multi-hour approval-hold window, or arbitrarily later via the
restart-recovery sweep. If an admin remaps a product's supplier code between order
placement and dispatch (a real, documented workflow for catalogue corrections), an
in-flight order can be fulfilled against a different SKU than what its frozen sale
price/split represents, with no re-validation. Not attacker-exploitable (requires an
admin catalogue edit mid-flight), but a real internal-consistency gap.

---

## ⚪ Low / Hygiene

### 13. Small, non-cryptographic reference space + unauthenticated existence oracle
**Files:** `backend/src/orders/orders.service.ts:386-396` (`freshReference`);
`backend/src/payments/payments.controller.ts:78-81` (`confirm`)

References are `JDC-` + a 6-digit `Math.random()` value (~900k possibilities).
`POST /payments/confirm` is unauthenticated, takes only `{ reference }`, and responds
differently for a nonexistent reference (immediate `failed`) vs. a real one (triggers
a live outbound call to Paystack `/transaction/verify`) — a timing/existence oracle
with no visible rate limit. Doesn't enable fund theft (Payment.userId/orderId are
fixed at creation, never attacker-influenced), but allows enumerating real order
references and burning API calls against the merchant's Paystack account.

### 14. Dead code implies protection that isn't actually wired up
**File:** `backend/src/orders/orders.service.ts:730-739` (`stuckOrderIds`)

Comment claims this is "used by the fulfilment worker on boot," but nothing calls it —
`FulfilmentService.onApplicationBootstrap` implements its own independent recovery
query instead. Low risk on its own, but a stale comment like this is exactly what
causes a future change to assume a safety net exists where it doesn't. Recommend
removing it or wiring it in.

### 15. No dedicated "needs attention" queue for stuck `otp`/`unknown` transfers
**File:** `backend/src/finance/solvency.service.ts:204-434` (`position`)

Withdrawals/refunds stuck on `transferStatus: 'otp'` or `'unknown'` are correctly
counted in the Reserve panel's aggregate liability totals, but there is no
operational worklist surfacing "these N requests need a human to check Paystack's
dashboard" — comparable to the `conflictNote`/Needs-Attention mechanism that already
exists for orders. This absence is the operational gap that leads an admin straight
into issue #3 above (using `settleManually` on a row that may have already resolved
itself at Paystack).

---

## What's already correct (verified, so it isn't re-litigated later)

- **Concurrent wallet debits** (`OrdersService.debitWallet`,
  `WithdrawalsService.request`) use a real atomic conditional `UPDATE ... WHERE
  balance >= amount`, backed by a `CHECK (balance >= 0)` constraint — genuinely safe
  against overdraft under concurrency.
- **`FulfilmentService.settle()`**'s atomic claim
  (`updateMany({ where: { status: { notIn: ['completed','failed'] } } })`) correctly
  prevents two settlement sources (webhook, reconciler, manual resolution) from both
  completing an order or racing completion against failure.
- **Webhook signature verification** is sound: raw body is wired correctly, HMAC
  comparison is constant-time, and there's no fallback path that trusts an unsigned or
  browser-reported "success."
- **Registration/profile-creation races** (`AuthService.register`/`createProfile`)
  have a real TOCTOU gap against the DB unique constraints, but it's handled
  gracefully (clean 409, no leaked internals, no way for a stranger to attach an
  unverified profile to someone else's identity).
- **Password comparisons** are timing-safe and enumeration-resistant (bcrypt compare
  against a dummy hash even when the user doesn't exist).
- **`canPayout()`'s "unknown, not no" advisory check** is safe in the common case:
  when a transfer is cleanly refused (`kind: 'failed'`), `failPayout()` correctly
  reverses the agent's balance debit and records why. The real danger only appears
  when a rejection surfaces as `unknown` (timeout/5xx) rather than a clean `failed` —
  see issue #3.
- **DataHub webhook settlement** never short-circuits on an order already being
  terminal — a late "SUCCESSFUL" webhook for an order already resolved by hand is
  correctly flagged via `conflictNote` for a human, not silently ignored or
  double-credited.
