# Issues: Payment/Order/Wallet Race-Condition & Account-Tier Audit

Audited 2026-09-13. Scope: Paystack payment collection, DataHub GH fulfilment, customer
wallet, agent withdrawals/refunds, and auth/session handling, with specific attention to
collisions (double-processing), worst-case concurrency, and behavior across a Paystack
"Starter" vs verified "Business" account tier.

All 15 issues originally found here have been fixed, see git history for the commits.
The section below (verified separately from the issues, so it isn't re-litigated later)
is kept as a reference for what was already confirmed sound.

---

## What's already correct (verified, so it isn't re-litigated later)

- **Concurrent wallet debits** (`OrdersService.debitWallet`,
  `WithdrawalsService.request`) use a real atomic conditional `UPDATE ... WHERE
  balance >= amount`, backed by a `CHECK (balance >= 0)` constraint, genuinely safe
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
  reverses the agent's balance debit and records why. The real danger only appeared
  when a rejection surfaced as `unknown` (timeout/5xx) and was then settled by hand,
  now closed by `resolvedManually` (see git history).
- **DataHub webhook settlement** never short-circuits on an order already being
  terminal, a late "SUCCESSFUL" webhook for an order already resolved by hand is
  correctly flagged via `conflictNote` for a human, not silently ignored or
  double-credited.
