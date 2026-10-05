# Money flow, multi-provider and role audit: checklist

Started 2026-10-05. Findings come from a read of `backend/src` and `frontend/src`, checked
against a fresh snapshot of production data pulled into the local `staging_test` database
the same day. Each line says where the problem is, what goes wrong, and what the fix is.

Severity:
- **P0**: a customer's money or delivery is at risk, live now
- **P1**: a figure on an admin screen is wrong, live now
- **P2**: the books go wrong in an edge case, or a race between two people
- **P3**: dormant until automated Paystack transfers are switched on (`paystackBusinessAccount`)

Tick a line only once the fix is built, type-checked, and verified against the snapshot data.

---

## P0: customer money and delivery

- [x] **R1** Receipt page shows "We could not find that bundle" after a provider switch.
      `frontend/src/pages/Buy.tsx`: the receipt at `/buy/:productId?order=` needed the bundle to
      be in the shop, and the shop only lists the provider routed now. Fixed: the receipt is now
      its own `OrderReceipt`, built from the order alone; "You earned" uses the order's own split
      frozen at sale time instead of a fresh price preview.
- [x] **M1** A MoMo payment approved after our sweep gave up is silently dropped.
      `payments.service.ts` `applyPaid` only claims `status: 'pending'`; the sweep
      (`reconciler.service.ts` 5 minute cutoff) has already set payment and order to failed.
      The late `charge.success` updates 0 rows with no log, and `confirm()` still tells the
      browser "paid". Fix: revive a failed payment whose order never collected money (no
      refund exists) when a verified success arrives: payment to paid, order back to
      processing, dispatch, and alert admin. Snapshot had 51 such failed payments (GHS 812.93)
      worth checking on the Paystack dashboard.
      **Done:** `applyPaid` now also claims a `failed` payment; its order is reopened only if it
      was never sent to a provider (true of all 58 payment-failed orders today), otherwise a
      refund is queued. `confirm()` only answers "paid" once the payment really is.
- [x] **M2** An order released from an approval hold is never sent to the provider.
      `approvals.service.ts` `releaseOrdersFor` sets `processing` and schedules dispatch, but
      `fulfilment.service.ts` `run()` only claims an order with no `dispatchClaimedAt` (or a stale
      one with no dispatch rows). A held order has both, so the claim fails silently and the
      paid order sits in processing forever. Fix: clear the claim on release and dispatch as the
      next attempt number.
      **Done:** new `FulfilmentService.dispatchReleased`, claimed compare-and-set, sent as the next
      attempt (a fresh GMPL idempotency key); `releaseOrdersFor` calls it.
- [x] **M3** Reordering parks the original refund as `rejected`; if the new attempt later fails,
      the refund is never reopened and the customer is never paid back.
      `fulfilment.service.ts` `reorder()` and `settle()` (`refundRequest.upsert(..., update: {})`).
      **Done:** a failed settle puts a reorder-parked refund back to pending; a delivered settle
      rewords it to "Reordered and delivered". Matched on the parking note, never on a refund an
      admin rejected themselves.
- [x] **M4** Starter-account refunds can be left "approved, refunded" with nothing sent.
      `refunds.service.ts` `approve()` always calls Paystack (unlike withdrawals, which check
      `paystackBusinessAccount`); a timeout, OTP or missing key leaves the refund `approved` with
      a green badge, and `settleManually` only accepts `pending`, so there is no way out.
      Fix: route refunds the manual way on a Starter account, and let "paid another way"
      settle an approved refund whose transfer never succeeded.
      **Done:** `sendRefund` checks `paystackBusinessAccount` first, exactly like payouts, and parks
      the refund as "send by hand"; "Paid another way" now settles an approved refund parked
      that way (never one with a real Paystack transfer). The Refunds screen badge now reads
      "send by hand" / "sending" / "refunded" instead of green "refunded" for all of them.
- [x] **M5** Two admins pressing Retry at once can buy the same bundle twice at DataHub.
      `fulfilment.service.ts` `retryDispatch`: the "last attempt was unknown" check is a plain
      read. **Done:** the retry claim is compare-and-set on the `dispatchClaimedAt` it read.

## Action needed from the owner (data, not code)

- [ ] **A1** Three customers are owed refunds now: JDC-845365490 (GHS 5.77, waiting since Sep 22),
      JDC-165355727 (GHS 10.73, since Sep 24), JDC-438822858 (GHS 97.82, since Oct 5).
      Send them by hand and record each with "Paid another way".
- [ ] **A2** Check the 51 order payments closed as unpaid (GHS 812.93) against the Paystack
      dashboard for any that were actually paid later. Each one found needs delivering or
      refunding by hand; from now on M1 handles it automatically.
- [ ] **A3** Two delivered orders still show a refund note "On hold, reordering by hand"
      (JDC-104614453, JDC-377814297). Cosmetic; can be reworded with one SQL update.

## P1: wrong figures on admin screens

- [ ] **D1** After logging capital, totals disagree with the per-provider rows for up to
      2 minutes. `solvency.service.ts` caches `position()` parts for 2 minutes and
      `float-monitor.service.ts` `logCapital` fills that cache just before writing. Fix:
      clear the cache whenever capital is logged, reversed or reimbursed. (Also fix the
      `ReservePanel.tsx` comment that says nothing is cached.)
- [ ] **D2** "Free to spend" goes up when a manual refund or payout advance is reimbursed.
      `solvency.service.ts` `expectedBalance` never subtracts the reimbursement (`capital_out`
      tied to an order or withdrawal), while the debt leaves the liabilities. Same in
      `etl.service.ts`. Over by GHS 5.10 today, GHS 125.00 more once the two fronted payouts
      are reimbursed. It also caps float reimbursements, so it can allow moving money that is
      owed to people.
- [ ] **D3** GMPL's "Live reading" never moves with orders (frozen at the last manual check).
      Only DataHub's dispatch calls `float.record`. The GMPL shortfall check therefore never
      fires. Fix: refresh GMPL's real wallet balance after an accepted GMPL order (throttled),
      and fix the ETL comment that says GMPL's reading is always null.
- [ ] **D4** "Projected profit" counts the supplier cost of accepted, still-open orders twice
      (booked at acceptance, then subtracted again from the split). `ledger.service.ts`.
- [ ] **D5** "Margin, last 7 days" mixes revenue by sale date with agent margin by completion
      date, and uses a rolling 168 hours where the revenue tile uses calendar days.
      `ledger.service.ts` window, `Overview.tsx`, Finance ranges.
- [ ] **D6** Warehouse solvency history disagrees with the live screen: past days force
      "not yet delivered" to 0, and bundle spend is blended across providers differently.
      `etl.service.ts`.
- [ ] **D7** Finance "Where the money goes" bars add up to more than revenue (payout fee shown
      outside the margin). `Finance.tsx`, `ledger.service.ts`.
- [ ] **D8** DataHub "float is short" alert (GHS 23.85) has been on since Sep 26, unexplained.
      Investigate charges on failed or estimated dispatches that were never booked.
- [ ] **D9** Manual refund and payout advances count as DataHub float movements in the
      "pending reading" check. `float-monitor.service.ts` `lastMovement` query.

## P2: books wrong in edge cases, races

- [ ] **L1** Supplier cost is keyed per order, not per attempt: a reorder that is charged again
      is never booked, and a reorder to the other provider books the cost against the wrong
      float (`supplierCodeAtSale` is overwritten). `fulfilment.service.ts`.
- [ ] **L2** Supplier cost stays booked when the provider fails and refunds the order.
- [ ] **L3** Payouts sent by hand still charge the agent the GHS 1 "Paystack transfer fee" and
      book it as a cost, though Paystack never sent anything. Needs a decision: keep charging
      it (then book it as income, not a cost) or stop charging it on manual payouts.
- [ ] **L4** Agent cancelling a withdrawal, and an admin rejecting a refund, are read-then-write;
      racing an approval can leave the wrong state. Fix: status-guarded claims.
- [ ] **L5** Putting an order on hold can overwrite an order that was just settled, and the hold's
      expiry clock starts at the order's creation, not the hold. `fulfilment.service.ts`,
      `reconciler.service.ts`.
- [ ] **L6** An underpaid or wrong-currency charge leaves the order hanging forever and can fill
      the sweep's 25-row batch. `payments.service.ts`, `reconciler.service.ts`.
- [ ] **L7** An approved manual payout cannot be undone if the admin decides not to send it.
- [ ] **L8** A late "delivered" signal on a refunded order is only flagged; refund approval does
      not check that flag.
- [ ] **L9** Settlement ledger writes are unchecked: `LedgerService.record` swallows errors, and
      an agent margin row is written even when the agent no longer exists.
- [ ] **L10** Withdrawal failure note says "top up and approve it again", but a failed withdrawal
      cannot be approved again.
- [ ] **L11** A missing Paystack fee is booked as 0 (the comment says it must not be).
- [ ] **L12** The agent's payout earning shows their profile phone, not the number actually paid.

## P3: before switching on automated Paystack transfers

- [ ] **T1** `transfer.failed` / `transfer.reversed` on a withdrawal returns the amount but not
      the held fee, and leaves the `payout_fee` ledger row.
- [ ] **T2** A refund retried after a webhook failure is stranded (`transferCode` not cleared,
      the same `RFD-` reference reused).
- [ ] **T3** OTP and unknown transfers have no admin way out; "unknown" plus "paid another way"
      can pay an agent twice with nothing flagging it.
- [ ] **T4** A late `transfer.success` after a failure flips the row to paid.
- [ ] **T5** Paystack's own transfer fee is never subtracted from "Should be at Paystack".
- [ ] **T6** Wallet refunds reduce profit for revenue that was never booked (wallet is off).

---

## Role walkthroughs

Every situation a buyer, agent, admin and superadmin can reach, checked end to end.
Findings are added below as they come in.

### Superadmin, access and security

- [ ] **S1** (P0) Production can deliver without taking payment, or take payment without
      delivering. A missing `PAYSTACK_SECRET_KEY` makes orders skip payment and go straight to
      a live provider; a provider whose `*_LIVE` isn't exactly `true` "delivers" paid orders as a
      simulation (agent margin still booked); routing a network to a provider that isn't live
      does the same. `orders.service.ts:122`, `supplier.service.ts`, `app.module.ts`,
      `admin.service.ts:974`. Fix: in production refuse to boot without a Paystack key, refuse to
      place or dispatch for a provider that isn't live, and reject routing to one.
- [ ] **S2** (P0) Suspending an admin, or resetting their password, does not end their session:
      the role in the 12-hour token is trusted and admin routes never re-check status.
      `common/auth.ts`, `team.service.ts`. Fix: a token version on the user, checked by the guard
      for admin roles and bumped on suspend and password set.
- [ ] **S3** (P1) No record of who did what for withdrawals, capital entries, settings, routing,
      or hand-resolved orders (39 capital rows in production, none with an actor). Fix: an admin
      action audit table written by every admin and superadmin write.
- [ ] **S4** (P2) An admin can be kept locked out forever (10 wrong passwords lock 15 minutes,
      repeatable within the IP throttle), and a reset link doesn't clear the lockout.
      `auth.service.ts`. Fix: clear on reset link, superadmin "clear lockout".
- [ ] **S5** (P2) Platform-level switches are open to any admin: `simulateFailure`,
      `paystackBusinessAccount`, `walletEnabled`, provider routing, analytics recompute/prune.
      Fix: superadmin only, or confirm plus audit.
- [ ] **S6** (P2) Registering with someone else's phone number shows all their guest orders
      (recipients, vouchers): phone numbers are never verified. 170 guest orders across 46
      phones today. `orders.service.ts:943`. Fix: verify the phone (OTP) before matching on it.
- [ ] **S7** (P2) "Add admin" with an email that already exists silently makes that account an
      admin. `team.service.ts:70-132`. Fix: show whose account it is and require confirmation.
- [ ] **S8** (P2) An admin can approve their own agent profile's withdrawal (both admins have
      agent profiles). Fix: refuse when the withdrawal's owner shares the approver's email.
- [ ] **S9** (P2) Public endpoints have no rate limit; `verify-recipient` calls GMPL with
      `record: true`, so a script can flood MTN's approval queue and the approvals table.
      Fix: throttle verify-recipient, track, credits and place.
- [ ] **S10** (P3) Superadmin "restore" can activate an agent application nobody decided.
- [ ] **S11** (P3) "Promote somebody else first" points at an action that doesn't exist; the
      only way to make a superadmin is `SUPERADMIN_EMAIL` plus a redeploy.
- [ ] **S12** (P3) Changing `SUPERADMIN_EMAIL` promotes whatever account has that address, even a
      self-registered stranger's. Fix: only promote an existing admin.
- [ ] **S13** (P3) Upline agents see downline orders' buyer phones and margins although referral
      is off (6 agents have an upline).
- [ ] **S14** (P3) Superadmin can still escalate feedback (harmless, comment says admin only).

### Buyer, agent and admin walkthroughs

_In progress._

## Admin playbook

What to do in every situation, written once the fixes above settle the procedures.

_To be written._
