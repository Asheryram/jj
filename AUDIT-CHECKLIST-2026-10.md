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

- [x] **A1** Three customers are owed refunds now: JDC-845365490 (GHS 5.77, waiting since Sep 22),
      JDC-165355727 (GHS 10.73, since Sep 24), JDC-438822858 (GHS 97.82, since Oct 5).
      Send them by hand and record each with "Paid another way".
- [x] **A2** Check the 51 order payments closed as unpaid (GHS 812.93) against the Paystack
      dashboard for any that were actually paid later. Each one found needs delivering or
      refunding by hand; from now on M1 handles it automatically.
- [x] **A3** Two delivered orders still show a refund note "On hold, reordering by hand"
      (JDC-104614453, JDC-377814297). Cosmetic; can be reworded with one SQL update.
- [x] **A4** The two payouts you sent by hand (GHS 85.00 and GHS 40.00) were recorded as advances without the GHS 1 sending fee each. Once deployed, the new rule applies to new payouts; to make these two match, raise each advance by 100 pesewas (one SQL update on the two capital_in rows tied to those withdrawals) before reimbursing them.
      **Done (owner, 2026-10-06):** both were paid from the MoMo linked to Paystack, so business
      money, not personal. Advances raised by GHS 1 each, then marked Reimbursed on the
      Withdrawals screen, so they leave the expected Paystack balance and nothing shows as owed.
      Going forward, a payout sent from that MoMo is "Paid another way" then "Reimbursed" at once.

## P1: wrong figures on admin screens

- [x] **D1** After logging capital, totals disagree with the per-provider rows for up to
      2 minutes. `solvency.service.ts` caches `position()` parts for 2 minutes and
      `float-monitor.service.ts` `logCapital` fills that cache just before writing. Fix:
      clear the cache whenever capital is logged, reversed or reimbursed. (Also fix the
      `ReservePanel.tsx` comment that says nothing is cached.)
      **Done:** SolvencyService.invalidate() clears both memos after any capital entry, reversal, reclassify or advance repayment, and the over-move check reads fresh figures.
- [x] **D2** "Free to spend" goes up when a manual refund or payout advance is reimbursed.
      `solvency.service.ts` `expectedBalance` never subtracts the reimbursement (`capital_out`
      tied to an order or withdrawal), while the debt leaves the liabilities. Same in
      `etl.service.ts`. Over by GHS 5.10 today, GHS 125.00 more once the two fronted payouts
      are reimbursed. It also caps float reimbursements, so it can allow moving money that is
      owed to people.
      **Done:** expectedBalance now subtracts advance repayments (capital_out tied to an order or withdrawal), and so does the ETL. Free to spend falls by exactly the GHS 5.10 repaid so far.
- [x] **D3** GMPL's "Live reading" never moves with orders (frozen at the last manual check).
      Only DataHub's dispatch calls `float.record`. The GMPL shortfall check therefore never
      fires. Fix: refresh GMPL's real wallet balance after an accepted GMPL order (throttled),
      and fix the ETL comment that says GMPL's reading is always null.
      **Done:** after every accepted GMPL order the real wallet balance is fetched in the background (at most once a minute) and recorded, so the reading moves with orders and the shortfall check can fire. Still open: the warehouse float history is DataHub-only until its table gets a provider column.
- [x] **D4** "Projected profit" counts the supplier cost of accepted, still-open orders twice
      (booked at acceptance, then subtracted again from the split). `ledger.service.ts`.
      **Done:** only open orders with no supplier cost booked yet subtract the estimate.
- [x] **D5** "Margin, last 7 days" mixes revenue by sale date with agent margin by completion
      date, and uses a rolling 168 hours where the revenue tile uses calendar days.
      `ledger.service.ts` window, `Overview.tsx`, Finance ranges.
      **Done:** order-linked ledger lines count in the window the order was sold in; others by their own date. Last 7 days on real data: margin GHS 220.96 (was 194.58) on the same GHS 1,139.31 revenue. The rolling-vs-calendar window mismatch with the revenue tile is still open.
- [x] **D6** Warehouse solvency history disagrees with the live screen: past days force
      "not yet delivered" to 0, and bundle spend is blended across providers differently.
      `etl.service.ts`.
      **Done:** not yet delivered is reconstructed per day (paid by then, not delivered or refunded by then); bundle spend is per provider then added, like the live screen. End of Sep 30 now shows 13 orders (GHS 259.21) in flight instead of 0.
- [x] **D7** Finance "Where the money goes" bars add up to more than revenue (payout fee shown
      outside the margin). `Finance.tsx`, `ledger.service.ts`.
      **Done:** the payout fee withheld from agents is no longer drawn as a cost band.
- [x] **D8** DataHub "float is short" alert (GHS 23.85) has been on since Sep 26, unexplained.
      Investigate charges on failed or estimated dispatches that were never booked.
      **Done:** investigated on the Oct 5 snapshot. No DataHub charge is missing from the books and none was booked at the wrong amount. Expected now: 6.02 baseline + 3,845.00 capital - 3,825.15 bundle cost = GHS 25.87; real reading GHS 28.02, so the float holds GHS 2.15 more, not less (roughly the 3 estimate-booked orders). The Sep 26 gap has since been covered by logged top-ups; the alert flag is latched from then and clears on the next comparison.
- [x] **D9** Manual refund and payout advances count as DataHub float movements in the
      "pending reading" check. `float-monitor.service.ts` `lastMovement` query.
      **Done:** the pending check ignores capital rows tied to an order or withdrawal.

## P2: books wrong in edge cases, races

- [x] **L1** Supplier cost is keyed per order, not per attempt: a reorder that is charged again
      is never booked, and a reorder to the other provider books the cost against the wrong
      float (`supplierCodeAtSale` is overwritten). `fulfilment.service.ts`.
      **Done:** supplier cost is booked per attempt (attempt 1 keeps the old key, so nothing booked before can double) and stamped with the provider that charged it; per-provider totals and the order list prefer the stamp and add up every attempt.
- [x] **L2** Supplier cost stays booked when the provider fails and refunds the order.
      **Done:** a failed GMPL order reverses its booked cost (GMPL refunds to the wallet); DataHub unchanged (its charge on a failed order is real money gone). The live GMPL reading now shows it if that ever stops being true.
- [x] **L3** Payouts sent by hand still charge the agent the GHS 1 "Paystack transfer fee" and
      book it as a cost, though Paystack never sent anything. Needs a decision: keep charging
      it (then book it as income, not a cost) or stop charging it on manual payouts.
      **Needs your decision**, then a small change either way.
      **Done:** decision: keep the GHS 1 (sending by hand costs about the same as Paystack). The manual advance now includes the fee, so whoever sent it is repaid in full.
- [x] **L4** Agent cancelling a withdrawal, and an admin rejecting a refund, are read-then-write;
      racing an approval can leave the wrong state. Fix: status-guarded claims.
      **Done:** agent cancel and refund reject now claim on pending; a lost race says "just decided, refresh".
- [x] **L5** Putting an order on hold can overwrite an order that was just settled, and the hold's
      expiry clock starts at the order's creation, not the hold. `fulfilment.service.ts`,
      `reconciler.service.ts`.
      **Done:** a hold no longer overwrites a settled order; hold expiry is timed from the latest needs-approval attempt (orders with none fall back to their age).
- [x] **L6** An underpaid or wrong-currency charge leaves the order hanging forever and can fill
      the sweep's 25-row batch. `payments.service.ts`, `reconciler.service.ts`.
      **Needs your decision:** when a charge arrives short, refund what arrived, or hold the order and ask the buyer to pay the difference? None in production today.
      **Done:** decision: refund what arrived. The payment is closed, the order fails, a refund is queued for the amount actually received, booked as income so the refund nets profit to zero; no longer hangs or clogs the sweep.
- [x] **L7** An approved manual payout cannot be undone if the admin decides not to send it.
      **Done:** "Not sending it?" on an approved payout with no Paystack transfer returns amount + fee to the agent (reason required); failPayout now claims atomically so it cannot race "Paid another way".
- [x] **L8** A late "delivered" signal on a refunded order is only flagged; refund approval does
      not check that flag.
      **Done:** refund approval and "Paid another way" stop on a flagged order until the flag is acknowledged on Needs attention.
- [x] **L9** Settlement ledger writes are unchecked: `LedgerService.record` swallows errors, and
      an agent margin row is written even when the agent no longer exists.
      **Done:** ledger writes inside a transaction now roll back with the money movement instead of being swallowed; no margin cost is booked for an agent that no longer exists.
- [x] **L10** Withdrawal failure note says "top up and approve it again", but a failed withdrawal
      cannot be approved again.
      **Done:** the note now says the money went back to the agent and they can request again.
- [x] **L11** A missing Paystack fee is booked as 0 (the comment says it must not be).
      **Done:** a fee Paystack did not report is booked at the checkout rate, labelled as an estimate.
- [x] **L12** The agent's payout earning shows their profile phone, not the number actually paid.
      **Done:** the payout line shows the Mobile Money number actually paid.

## P3: before switching on automated Paystack transfers

- [x] **T1** `transfer.failed` / `transfer.reversed` on a withdrawal returns the amount but not
      the held fee, and leaves the `payout_fee` ledger row.
      **Done:** a failed or reversed payout returns amount plus fee and removes both ledger rows, matching the in-app failure path.
- [x] **T2** A refund retried after a webhook failure is stranded (`transferCode` not cleared,
      the same `RFD-` reference reused).
      **Done:** a failed refund clears its transfer code, and each approval gets its own reference (RFD-<id>_<approval>), so a retry actually sends instead of looping as a duplicate.
- [x] **T3** OTP and unknown transfers have no admin way out; "unknown" plus "paid another way"
      can pay an agent twice with nothing flagging it.
      **Done:** "Paid another way" and "Not sending it?" on an unknown or OTP transfer require ticking "I checked Paystack and it did not go out"; refunds stuck in those states can now be settled that way (there was no way out before).
- [x] **T4** A late `transfer.success` after a failure flips the row to paid.
      **Done:** a late transfer.success only applies to a payout or refund still approved and in flight; after a failure it is logged for a human, never applied.
- [x] **T5** Paystack's own transfer fee is never subtracted from "Should be at Paystack".
      **Done:** "Should be at Paystack" (live and warehouse) subtracts each real transfer's fee: the payout's own fee, the configured transfer fee per refund.
- [x] **T6** Wallet refunds reduce profit for revenue that was never booked (wallet is off).
      **Done:** a refund only reduces profit if the sale's revenue was booked (MoMo sales); a failed wallet sale's refund does not.

---

## Role walkthroughs

Every situation a buyer, agent, admin and superadmin can reach, checked end to end.
Findings are added below as they come in.

### Superadmin, access and security

- [x] **S1** (P0) Production can deliver without taking payment, or take payment without
      delivering. A missing `PAYSTACK_SECRET_KEY` makes orders skip payment and go straight to
      a live provider; a provider whose `*_LIVE` isn't exactly `true` "delivers" paid orders as a
      simulation (agent margin still booked); routing a network to a provider that isn't live
      does the same. `orders.service.ts:122`, `supplier.service.ts`, `app.module.ts`,
      `admin.service.ts:974`. Fix: in production refuse to boot without a Paystack key, refuse to
      place or dispatch for a provider that isn't live, and reject routing to one.
      **Done:** production refuses to boot without a Paystack key; a dispatch to a provider that is not live is left unresolved (Needs attention, Retry) instead of simulated as delivered; routing to a non-live provider is refused.
- [x] **S2** (P0) Suspending an admin, or resetting their password, does not end their session:
      the role in the 12-hour token is trusted and admin routes never re-check status.
      `common/auth.ts`, `team.service.ts`. Fix: a token version on the user, checked by the guard
      for admin roles and bumped on suspend and password set.
      **Done:** new token_version column (migration 20261006090000): carried in the token, checked with account status on every admin request; bumped on suspension and on any new password (every profile of that email).
- [x] **S3** (P1) No record of who did what for withdrawals, capital entries, settings, routing,
      or hand-resolved orders (39 capital rows in production, none with an actor). Fix: an admin
      action audit table written by every admin and superadmin write.
      **Done:** new admin_actions table (migration 20261006091000) written by a global interceptor for every non-GET admin or superadmin request: who, what, redacted body, result. Shown to a superadmin as "Recent admin actions" on the Team screen.
- [x] **S4** (P2) An admin can be kept locked out forever (10 wrong passwords lock 15 minutes,
      repeatable within the IP throttle), and a reset link doesn't clear the lockout.
      `auth.service.ts`. Fix: clear on reset link, superadmin "clear lockout".
      **Done:** a reset or setup link now clears that email's lockout; a superadmin can unlock anyone by issuing a reset link.
- [x] **S5** (P2) Platform-level switches are open to any admin: `simulateFailure`,
      `paystackBusinessAccount`, `walletEnabled`, provider routing, analytics recompute/prune.
      Fix: superadmin only, or confirm plus audit.
      **Done:** simulateFailure, paystackBusinessAccount and walletEnabled are superadmin-only (shown read-only to admins); analytics recompute and prune are superadmin-only. Routing stays with admins (S1 guards it).
- [x] **S6** (P2) Registering with someone else's phone number shows all their guest orders
      (recipients, vouchers): phone numbers are never verified. 170 guest orders across 46
      phones today. `orders.service.ts:943`. Fix: verify the phone (OTP) before matching on it.
      **Done:** customers see only orders placed signed in to their account (no phone match); guest orders stay reachable on Track with reference plus phone. Same rule in their reports.
- [x] **S7** (P2) "Add admin" with an email that already exists silently makes that account an
      admin. `team.service.ts:70-132`. Fix: show whose account it is and require confirmation.
      **Done:** an email that already has an account is refused with whose it is and their roles; the Team screen asks for confirmation before adding the admin profile.
- [x] **S8** (P2) An admin can approve their own agent profile's withdrawal (both admins have
      agent profiles). Fix: refuse when the withdrawal's owner shares the approver's email.
      **Done:** approving, or marking as sent, a payout to the approver's own agent profile is refused; a superadmin approves those.
- [x] **S9** (P2) Public endpoints have no rate limit; `verify-recipient` calls GMPL with
      `record: true`, so a script can flood MTN's approval queue and the approvals table.
      Fix: throttle verify-recipient, track, credits and place.
      **Done:** order placement, verify-recipient, track and credits are rate-limited per IP.
- [x] **S10** (P3) Superadmin "restore" can activate an agent application nobody decided.
      **Done:** restore/suspend on the Team screen only applies to admin and superadmin accounts.
- [x] **S11** (P3) "Promote somebody else first" points at an action that doesn't exist; the
      only way to make a superadmin is `SUPERADMIN_EMAIL` plus a redeploy.
      **Done:** the message now says how to make another superadmin (SUPERADMIN_EMAIL plus redeploy).
- [x] **S12** (P3) Changing `SUPERADMIN_EMAIL` promotes whatever account has that address, even a
      self-registered stranger's. Fix: only promote an existing admin.
      **Done:** boot only promotes an account already on the platform team; an agent or customer account with that email is refused with a loud log line. Checked: the real superadmin's password row is the superadmin row, unaffected.
- [x] **S13** (P3) Upline agents see downline orders' buyer phones and margins although referral
      is off (6 agents have an upline).
      **Done:** agents see their own sales only, in orders and in their reports; the downline lookup is gone.
- [x] **S14** (P3) Superadmin can still escalate feedback (harmless, comment says admin only).
      **Done:** escalation is refused for a superadmin.

### Buyer, agent and admin walkthroughs

_In progress._

## Admin playbook

What to do in every situation, written once the fixes above settle the procedures.

_To be written._
