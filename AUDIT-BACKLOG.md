# JamesDataConsult — Full Code Audit: Bugs, Gaps, Edge Cases, Features

Compiled 2026-09-21. Everything below is derived from reading `backend/src`, `frontend/src`,
and `prisma/schema.prisma` directly — no project docs (ISSUES.md, SPRINT2.md, user-flows.md,
functional-nonfunctional-requirements.md) were used as a source of truth. Every finding below
carries file:line evidence found in the current code. Severity is my judgment: **Money** (real
funds at risk), **Data-integrity** (state becomes wrong/inconsistent but no direct loss),
**Security/Trust**, **Operational**, or **Feature gap**.

---

## 0. Master backlog — everything to do, flattened into one checklist

Full detail for every line is in the numbered section it references. This is the execution list.

### Bug fixes
- [x] 1.1 Fix `applyFailed()` unguarded update → atomic `updateMany` claim (payments.service.ts)
- [ ] 1.2 Add Paystack `charge.dispute.*` webhook handling (log + admin alert minimum)
- [x] 1.3 Guard `releaseOrdersFor()`'s update with a status-checked `updateMany` (approvals.service.ts)
- [ ] 2.1 Add optimistic lock (version/`updatedAt` check) to `applyMarkup()`/`setTier()` (admin.service.ts)
- [ ] 2.2 Add advisory lock/`FOR UPDATE` to the withdrawal pending-count check (withdrawals.service.ts)
- [ ] 2.3 Guard `upsertProduct()`'s final write against a concurrent manual edit (catalogue-import.service.ts)
- [x] 2.4 Catch P2002 on domain upsert, map to `ConflictError('DOMAIN_TAKEN')` (domains.service.ts)
- [ ] 2.5 Guard branding `submit()`'s delete with a status-checked `deleteMany` (branding.service.ts)
- [x] ~~3.1 Block registration under a suspended/rejected upline~~ — **rejected by product owner.**
      A new agent is a separate business from their referrer; the referrer's status is not theirs
      to be penalised for, and since the commission model is flat (no money flows through
      `uplineCode`), there is no actual harm in the attribution. Registration is intentionally
      left unblocked (auth.service.ts:122-145's comment now records this explicitly).
- [x] 3.4 Feature-flag-gate wallet endpoints server-side, not just hide in UI (wallet.controller.ts, orders.service.ts) —
      shipped as a new `walletEnabled` platform setting, default off
- [ ] 3.5 If/when a role-conversion path is ever built, force balance-zeroing + explicit ledger entry at the boundary; add an audit query for role/balance mismatches in the meantime
- [ ] 3.6 Add `AdminAuditLog` model + hook into setTier/setActive/markup/sync/toggleStatus
- [ ] 3.7 Add self-referral guard (block a referral code resolving to the registrant's own account) — required before shipping 6.2
- [ ] 3.8 Catch P2002 on referral-code creation and retry generation
- [ ] 3.9 Add a `storage` event listener to re-sync session state across tabs after `switchProfile`
- [ ] 3.10 Cascade-suspend `CustomDomain.allowed` when the owning user is suspended; require re-review on reactivation
- [ ] 4.1 Add a circuit breaker around Paystack calls for faster-fail during an incident
- [ ] 4.2 Add a queue/leaky-bucket in front of DataHub `purchase()` to smooth bursts above 30/min
- [ ] 4.5 Add an aging alert for refunds stuck pending &gt;N days

### Domain feature (see 6.1 for full detail)
- [x] Phase 0: fix 2.4 (TOCTOU), add self-service domain removal, show DNS instructions in the request UI
- [ ] Phase 1: wildcard `*.jamesdataconsult.com` on Vercel + `mode: 'subdomain'` support — free instant subdomains
- [ ] Phase 2: Vercel Domains API integration — auto-add domain on approval, auto-verify, auto-flip `active`
- [ ] Phase 3 (blocked on registrar decision): `DomainPurchase` model, agent-balance debit/refund, renewal job

### Other feature proposals
- [ ] 6.2 Recruiter bonus via `Earning.type: 'recruit_bonus'` (after 3.7 ships)
- [ ] 6.3 Client-side product search filter in the catalogue
- [ ] 6.4 Promo/coupon system (`PromoCode` model, discount line in the pricing split)
- [ ] 6.5 Server-side monthly agent statement/export (fixes the client-side truncation in current CSV export)
- [ ] 6.6 Wire `SolvencyService.position()`/`freeToSpend` into the existing alert-debounce pattern
- [ ] 6.7 2FA (TOTP) for admin/superadmin accounts
- [ ] 6.8 Paystack recipient-resolution at withdrawal request time (catch typos before admin's queue)
- [ ] 6.9 Tiered agent badges from existing order/earnings aggregates
- [ ] 4.3 Aggregated repeat-customer/order-continuity view for admin and agents
- [ ] 4.4 In-app path to promote a second superadmin (reduce bus-factor)

### Branding: curated catalogue-tile layouts, button style and network indicator (2026-09-21)
- [x] Three independent, composable tile axes, none reviewed (none carry impersonation risk):
      **layout** (`classic`/`bold`/`minimal`/`compact`), **"Buy" button** (`accent`/`solid`/
      `outline`/`text`), **network indicator** (`chip`/`dot`/`pulse`). New `Branding.tileStyle`,
      `tileButtonStyle`, `tileNetworkIndicator` columns (migrations `20260921175942_...` and
      `20260921183527_add_branding_tile_button_and_network_style`, applied to the local
      docker-compose Postgres only, per instruction — never run against the live Neon DB
      directly; both land there automatically on the next deploy via `prisma migrate deploy`).
      Applied together in one call, `PATCH /branding/mine/tile-style` → `setTileOptions()`.
- [x] The network name is always shown regardless of indicator style (`dot`/`pulse` only change
      how it's marked — a small coloured dot, animated or not — never whether the name is there),
      corrected after an initial version dropped the label entirely.
- [x] **Preview-before-apply, not instant-on-click.** Originally each layout applied the moment
      it was clicked; changed so picking any option only updates a live preview, and a separate
      "Apply this style" button (disabled until something actually changed) commits it. Shared
      `components/TileStylePicker.tsx` (`TileStylePicker`, `TileBuyButton`, `TileNetworkBadge`,
      `TileStyleFullPreview`) is the single source of truth for both the picker's preview and
      `Catalogue.tsx`'s real `ProductCard` rendering, so the two can never quietly disagree.
- [x] **Admin has full parity with agents**, not just the tile-style field wired through
      `setPlatform()` — `BrandingReview.tsx`'s `PlatformBranding` gained the same curated colour
      template gallery (with a "pick your own" fallback) and the same `TileStylePicker`, bundled
      into its existing single "Save platform branding" action rather than instant-apply (admin's
      whole form was already one bundled save, unlike the agent's per-field instant endpoints).
- [x] **Agent branding requests moved to their own page** (`pages/admin/BrandingRequests.tsx`,
      route `/admin/branding-requests`, nav entry under Catalogue next to "Branding"), split out
      of `BrandingReview.tsx`: "what does my own platform look like" and "what is this specific
      agent asking to look like" are different jobs that only shared a page because both touched
      the word "branding".

### Branding: split colour out of admin review, add curated templates (2026-09-21)
Raised directly in a design discussion about how agents customize their shop look.

- [x] **Colour no longer goes through admin review.** `BrandingService.submit()` (the
      `BrandingRequest` queue) now only accepts `shopName`/`logo` — the two fields with real
      impersonation risk (a shop badged as a bank or a network). Colour carries none of that risk,
      but used to be bundled into the same submission, so picking a new accent colour cost an
      agent the same wait as proposing a new identity. New `BrandingService.setColor()` /
      `PATCH /branding/mine/color` applies a colour straight to the live `Branding` row, mirroring
      the exact pattern `setPlatform()` already used for the platform owner's own instant-apply
      branding. `SubmitBrandingDto` (still used by `setPlatform`) is untouched; the agent-facing
      endpoint now takes a leaner `SubmitShopIdentityDto`.
- [x] **Curated colour templates.** `frontend/src/lib/brandTemplates.ts` — 8 pre-picked hues
      (Ocean Blue, Emerald, Royal Purple, Sunset Orange, Berry, Teal, Crimson, Charcoal), chosen
      for visual distinctness from each other and from the networks/banks a shop must not be
      mistaken for. `ShopBranding.tsx`'s colour card leads with this gallery (tap a swatch, it's
      live immediately) with "pick your own" as a secondary disclosure for the existing hex-picker
      + dark-mode-toggle flow, also now instant instead of bundled into the review submission.
- [x] `ShopBranding.tsx` restructured: the top-level component now only manages shop
      name/logo + the review submit button; colour lives in its own `ShopColorCard`
      component with its own instant-apply state, decoupled from the `isDirty`/beforeunload
      tracking (which now only guards the name/logo form, correctly, since colour has no
      "unsaved" state anymore — every colour action is already saved the moment it's clicked).
- [ ] **Not done this pass** (raised as further angles, not yet scoped): Open Graph/link-preview
      branding for `/s/<code>` shares (WhatsApp is the actual distribution channel, and the shared
      link preview is probably still generic/platform-branded); a real full-page shop preview
      before submitting a name/logo change (today's preview is just a small mock bundle card, not
      the actual storefront); a WhatsApp contact CTA on the shop itself; volume-based trust signals
      ("127 orders delivered") sourced from data already tracked.

### Dashboard/nav restructuring (senior UI/UX review, 2026-09-21)
- [x] **Admin sidebar/More-menu grouping.** Was a flat 17-item list (13 for `admin`) with no
      visual grouping, on both desktop sidebar and the mobile "More" modal. Added `NavItem.section`
      and a `sectioned()` grouping helper in `layout.tsx`: Money (Refunds, Withdrawals, Finance,
      Float risk, Subscriptions), Orders (All orders, Needs attention, Number approvals), Catalogue
      (Cost prices, Catalogue accuracy, Branding), People (Users, Feedback, Announcements),
      Platform (Settings, + superadmin-only Platform team/Custom domains). Overview/Analytics/
      Assistant stay pinned above the groups. Agent nav lightly grouped the same way (Sell/Money/
      Activity).
- [x] **Fixed mobile-primary-tab drift.** `NavItem.primary` replaces "first four items in the
      array" for deciding the 4 mobile bottom-bar tabs. The array position and the primary-tab
      decision used to be the same thing, so adding Analytics and Assistant (both later additions)
      had silently bumped Refunds and Withdrawals out of thumb reach, contradicting the file's own
      doc comment about which four "carry the weight". Now explicit: Overview/All orders/Refunds/
      Withdrawals for admin, Dashboard/Sell & refer/Earnings/Sales for agent.
- [x] **Split `Overview.tsx` into Overview + a new `/admin/finance` page.** Overview was a
      12-section, single-scroll "kitchen sink": 3 separately-styled callouts in an awkward 2-col
      grid, 6 stat tiles in a 4-col grid, then three separate money-breakdown panels (`ReservePanel`,
      `FloatPanel`, and an inline "Where the money goes" card) sandwiched between charts and lists.
      `ReservePanel`/`FloatPanel`/"Where the money goes" moved to `pages/admin/Finance.tsx`
      (new route + nav entry under Money); Overview keeps a compact `FinanceSummaryCard` (just
      "Actually free to spend") linking there.
- [x] **Fixed a real bug found while splitting it**: Overview's "Your margin, last 7 days" stat
      tile and the "Where the money goes" panel used to share one `statement` fetch keyed to the
      money-goes panel's own 7/30/all-time range selector — switching that selector silently
      changed what the "last 7 days" tile showed too, while its label never changed. Overview now
      fetches its own fixed 7-day statement (`weekStatement`), independent of Finance's selector.
- [x] **Consolidated the 3 scattered callouts** (stuck orders, withdrawals waiting, failed orders)
      into one `AttentionCard` with one row each, replacing three independently-styled `Callout`s
      competing for cells in a `sm:grid-cols-2` grid.
- [ ] **Not done this pass**: Agent `Dashboard.tsx` can stack up to 4 full-width notice cards
      (sell link, WhatsApp join, pending withdrawal, domain status) above the stat tiles the page's
      own header promises ("here's how your business is doing today"). Sell-link card should stay;
      WhatsApp-join and domain-status read more like notifications than dashboard content and are
      candidates for a smaller affordance (bell/badge) instead of full-width real estate.
- [ ] **Not done this pass**: `Overview.tsx`'s "Where the money goes" category breakdown
      (`byCategory`) and the "Latest orders" 6-row table still read from the capped 100-row
      `orders` store — acceptable for "latest 6" but the category totals can undercount past 100
      orders, same class of bug as the "Orders in flight"/"Failed orders" fix earlier in this file.

### Manual payout approval for a non-business Paystack account (2026-09-26)
Raised directly: the live Paystack account isn't registered/upgraded as a business account, so
every real Transfer API call is refused outright. Before this, `WithdrawalsService.sendPayout`
tried the transfer anyway on every approval; Paystack's refusal was read as a plain failure,
which reversed the approval back to `failed` and returned the agent's held balance, so the
existing `settle-manually` path (which needs `status: 'approved'` to still be true) could never
actually be reached for this account.

- **Reused the existing `paystackBusinessAccount` setting** (off by default, previously only
  gated live-balance-mismatch emailing) rather than adding a new flag — it already represents
  the same real-world fact ("is this a real, live, upgraded business account"), so it now also
  gates automatic transfers: off, `sendPayout` never calls Paystack's Transfer API at all, an
  approval goes straight to `transferStatus: 'manual'` and waits for `settleManually`, the same
  treatment already given to a server with no Paystack key configured. Flip on once the account
  is confirmed able to send transfers. Settings → "Is this a live Paystack business account?".
- **New `payoutTransferFee` setting** (pesewas, defaults to GHS 1.00, Paystack's published flat
  Ghana Mobile Money transfer fee — confirm the real number on your dashboard), and a new
  `Withdrawal.transferFee` column freezing it per request, the same reasoning as
  `agentName`/`agentPhone` freezing what they were at request time.
  - **Reserved at request time, not charged at approval.** `WithdrawalsService.request()` now
    holds `amount + transferFee` from the agent's balance up front (was `amount` alone), the same
    conditional-update discipline as the original debit. First shipped as a best-effort debit
    *at approval*, which had a real gap surfaced by testing: requesting the full balance left
    nothing behind to charge the fee against once approved, so it was silently skipped, or if the
    max-withdrawable amount wasn't capped client-side, the agent could enter more than they could
    actually afford to cover the fee at all. Reserving both together at request time makes that
    state unreachable, `RequestModal`'s "Available to withdraw" and "Withdraw the max" now cap at
    `balance - transferFee`, not the raw balance, both client-side and server-side.
  - `cancel()`, the rejected branch of `decide()`, and `failPayout()` all now return
    `amount + transferFee` (the full hold), not `amount` alone.
  - `decide()`'s approved branch no longer touches the agent's balance for the fee at all, it was
    already held; it only records the `payout_fee` ledger entry (`affectsProfit: false`, this
    settles between what the agent keeps and what the business keeps, not a new cost) against the
    row's own frozen `transferFee`.
  - `SolvencyService.canPayout(amount, fee)` takes the frozen fee as a parameter now rather than
    reading the live setting itself, so a fee changed after a request was made doesn't
    retroactively change what that request needs.
  - Agents are warned about the fee up front on the withdrawal request page and modal
    (`CatalogueService.snapshot` sends `payoutTransferFee` to agent/admin sessions, same audience
    as `whatsappChannelUrl`); the admin queue shows each request's own frozen fee next to its amount.

### Unread-announcements modal (2026-09-26)
Raised directly: the nav badge alone wasn't enough, agents/admins rarely clicked through to the
Announcements page to actually read one. New `UnreadAnnouncementsModal`
(`frontend/src/components/UnreadAnnouncementsModal.tsx`), mounted once in `AppShell` so it applies
to every `/app` and `/admin` page. Fetches `mine()` once per fresh sign-in (not per navigation),
filters to unread, and steps through the whole unread queue inside **one** dialog (Back/Next,
"2 of 3") rather than opening a fresh popup per announcement, which reads as spam and trains
people to dismiss without reading. Acknowledging one marks only that one read via the existing
`POST /announcements/:id/read` and advances; closing early just hides it for this sign-in (nothing
gets marked read by being dismissed), it reappears next login, and the nav badge/Announcements
page remain as the persistent, non-modal fallback. No backend changes, the read-receipt model
(`AnnouncementRecipient.readAt`) already existed and already supported everything this needed.
- Admin's Withdrawals queue and Settings page both updated to say so explicitly.

### Added during implementation (raised directly, not from the original audit)
- [x] Real server-side pagination, date range, status filter and search for `/admin/orders`
      (new `GET /admin/orders`, `OrdersService.adminList()`), replacing the client-side filter
      over a 500-row cap. Defaults to today's date range. See "Admin orders pagination" below.
- [x] Overview's "Failed orders" callout now links to `/admin/orders?status=failed`
- [x] Overview's "Failed orders" count and "Orders in flight" stat tile were both silently
      pinned near/at 100 on a busy platform (derived from the same capped 100-row `orders` store
      the "Latest orders" table uses). Fixed: both now call `GET /admin/orders?status=...&pageSize=1`
      and read the real `total`, matching the pattern `myMargin`/`trackedRevenue` already used
      (ledger-derived, not store-derived) for exactly this reason.
- [ ] `Overview.tsx`'s "Where the money goes" category breakdown (`byCategory`) still sums over
      the capped `orders` store and will undercount past 100 total orders. Not fixed this pass —
      needs a real revenue-by-category backend aggregate, a bigger lift than the two stat tiles
      above (which were one-count-each). The "Latest orders" table itself (only ever shows 6
      rows) is fine left as-is.
- [x] `AdminOrders.tsx` default date range changed from "today only" to the last 7 days
      (`dateStr(6)` to `dateStr(0)`), so an order from yesterday doesn't already need a manual
      date change to find; still bypassed entirely for a `?ref=`/`?status=` deep link.
- [x] Added an "Unresolved" filter tab to `AdminOrders.tsx`, alongside All/Completed/Processing/
      Failed — the same "stuck, no reply from the delivery partner at all" definition Needs
      Attention uses, now reachable without leaving the orders table. Backed by a new
      `unresolvedOnly` param on `GET /admin/orders` or (`OrdersService.adminList`'s
      `where.dispatches = { some: { outcome: 'unknown', providerReference: null } }`, paired
      with the open-status filter, safe because a retried order that later resolved has already
      moved off `pending`/`processing` by the time that happens).
- [x] `NeedsAttention.tsx`'s "Resolve by hand" action used a thin form (outcome + note only),
      while the exact same decision from `AdminOrders.tsx` (open an order → `DispatchModal`) shows
      the full per-attempt technical history, "Retry dispatch", and "Check now" — strictly more
      information for the same call. Extracted `DispatchModal` (+ its `explain()` helper) out of
      `AdminOrders.tsx` into `frontend/src/components/DispatchModal.tsx`, and `NeedsAttention.tsx`
      now fetches the full order (`api.order(id)`) and opens the same shared modal, so a stuck
      order gets the same resolve experience regardless of which page it's found from.

---

## 1. Money-safety bugs (payment & fulfilment)

### 1.1 `applyFailed()` can overwrite a paid payment back to `failed` — Data-integrity
`backend/src/payments/payments.service.ts:484-491`. Every sibling terminal-state writer
(`applyPaid`, `applyTransfer`, `applyRefundTransfer`) was hardened to an atomic
`updateMany({ where: { status: 'pending' } })` claim. `applyFailed` was missed — still
`findUnique` → check → unconditional `update`. If a `success` verify and a `failed`/`abandoned`
verify for the same reference race, `applyPaid` can commit `paid` first and `applyFailed` can
still stomp it back to `failed`. The `Order` itself is protected by its own guarded update, but
the `Payment` row ends up lying, corrupting reconciliation and refund-eligibility logic that
trusts `payment.status`.
**Fix:** change to `updateMany({ where: { reference, status: 'pending' } })`, check count, same as siblings.

### 1.2 No Paystack chargeback/dispute handling at all — Money
`backend/src/payments/payments.service.ts` webhook switch only branches on `charge.success` /
`transfer.success` / `transfer.failed` / `transfer.reversed`. Zero references to `dispute` or
`chargeback` anywhere in `backend/src` (verified by grep). Card payments are an enabled channel
(`paystack.client.ts`). A disputed card charge has no handler — wallet credit or order revenue
already booked is never reversed, no admin alert fires. Real exposure on the card channel (MoMo
has no chargeback rail).
**Fix:** add `charge.dispute.create`/`.resolve` handlers — minimum viable is log + admin email alert.

### 1.3 An order can be resurrected from a terminal state — Data-integrity
`backend/src/orders/approvals.service.ts:187-205` (`releaseOrdersFor`). Every other status
transition in the codebase uses a status-guarded `updateMany`; this one does a plain
`prisma.order.update()` with no guard. Scenario: order sits `awaiting_approval`, the 10-min
reconciler sweep times it out to `failed` + refund, and in the same window an admin-triggered
DataHub recheck sees the number as approved and unconditionally flips the same order back to
`processing`. Confirmed this can't cause a double charge or double refund (dispatch/refund claims
elsewhere block that), but the order gets stuck showing `processing` forever after already being
refunded, and triggers a recurring "no reply from delivery partner" admin alert email every 10
minutes, indefinitely.
**Fix:** guard with `updateMany({ where: { id, status: 'awaiting_approval' } })`.

---

## 2. New concurrency / race-condition bugs

### 2.1 Bulk markup apply vs. individual price edit — VULNERABLE — Money/Data-integrity
`backend/src/admin/admin.service.ts` `applyMarkup()` (~581-621) and `setTier()` (~336-436) each
read-then-write a product's price fields in their own independent transaction, no `SELECT FOR
UPDATE`, no version column, no guard on the previously-read value. Whichever transaction commits
last wins outright. A bulk "apply markup to all" running while an admin individually edits one
product's tiers silently discards the loser's price — no error, no notification.
**Fix:** version column (`updatedAt` optimistic-lock check) on `Product`, or serialize via a
per-product advisory lock during bulk operations.

### 2.2 "Max 3 pending withdrawals" guard has the same TOCTOU shape as the domain bug — VULNERABLE — Data-integrity
`backend/src/withdrawals/withdrawals.service.ts:64-90`. `tx.withdrawal.count({status:'pending'})`
then create, inside one `$transaction`, but under Postgres READ COMMITTED with no `FOR UPDATE`/
advisory lock. N concurrent requests from the same agent (multi-tab, script) can all read
`count: 2` before any commits, all pass, producing more than 3 pending withdrawals. (The balance
debit right below it *is* correctly atomic via conditional `UPDATE ... WHERE balance >= amount`
— only the pending-count check lacks this discipline.)
**Fix:** `SELECT ... FOR UPDATE` on the agent's row, or a Postgres advisory lock keyed by userId,
before the count check.

### 2.3 Catalogue sync vs. manual price-tier edit — VULNERABLE — Money
`backend/src/supplier/catalogue-import.service.ts` `upsertProduct()` (~202-251): plain
`findUnique` then, after supplier-fetch network latency, an unconditional `update` that
recomputes `adminPrice`/`standardPrice` from the markup it read at step 1. If `setTier()` runs in
that window, the sync overwrites the admin's just-set price with a value derived from the stale
pre-edit markup. No transaction spans the read-to-write gap, no version/timestamp guard.
**Fix:** re-read markup immediately before the final write inside a transaction, or compare
`updatedAt` and skip the overwrite if it changed since the read.

### 2.4 Domain-request duplicate-submission race — VULNERABLE — Data-integrity (confirmed earlier, restated here for completeness)
`backend/src/domains/domains.service.ts:53-80` (`request()`). Checks "is this domain taken" then
upserts — TOCTOU. Two agents submitting the identical domain simultaneously can both pass the
check; the second hits a raw Postgres unique-violation (`domain @unique`,
`schema.prisma:1239`) that isn't caught or mapped to the existing `ConflictError('DOMAIN_TAKEN')`
— surfaces as an unhandled 500 instead of a friendly message.
**Fix:** catch P2002 on the upsert and re-throw as `ConflictError('DOMAIN_TAKEN', ...)`.

### 2.5 Branding re-upload can destroy an approval's audit trail — Data-integrity (minor)
`backend/src/branding/branding.service.ts` `submit()` (~263-268) does an unguarded, non-
transactional `findFirst` → `delete(existing.id)` → `create`. If an admin's `approve()`
transaction fully commits between the agent's read and delete, the agent's stale
`delete({id: X})` still fires (delete doesn't filter on status) and destroys the just-approved
row's `decidedAt`/`decidedBy` audit trail, even though the live `Branding` row already has the
correct (old) bytes.
**Fix:** guard the delete with a `deleteMany({ where: { id, status: 'pending' } })`.

---

## 3. Account, session, and trust-boundary gaps

### 3.1 Registering under a suspended/rejected upline — REJECTED, not a bug
`backend/src/auth/auth.service.ts:127-139` checks the referral code exists and its owner isn't a
customer, never checks `status`. Originally flagged as a gap and briefly fixed with a hard block,
then reverted on product-owner feedback: **the new agent signing up is a separate business from
their referrer, and the referrer's status is not theirs to be penalised for.** Since the
commission model is flat (seller + platform only — see `domain/pricing.ts`), `uplineCode` carries
no money or permission either way, so there is no actual harm in letting the attribution happen.
Registration is intentionally left unblocked; `auth.service.ts`'s comment at this spot now records
the reasoning so it isn't "fixed" again by a future pass that doesn't have this context.

### 3.2 Suspension doesn't invalidate the JWT — up to 12h window — Security/Trust
No session-revocation model exists anywhere (`schema.prisma` has no session/tokenVersion/
blacklist table). JWTs default to 12h (`auth.module.ts:40`). `@RequireActive()` — the only
decorator that re-checks DB status per-request — is used on exactly **one** route in the entire
app: `POST /withdrawals` (`withdrawals.controller.ts:71`). Everywhere else, a suspended user's
existing token keeps working until natural expiry.

### 3.3 A deactivated team member's open tab can still approve withdrawals/domains — Security/Trust (direct consequence of 3.2)
`withdrawals.controller.ts:83-101` (`decide`, `settle-manually`) and `domains.controller.ts:79-98`
(review) check only `@Roles(...)` from the JWT payload — no `@RequireActive()`.
`team.service.ts:211-240` (`setStatus`) suspends the DB row and revokes outstanding *setup*
tokens, but does nothing to an already-issued JWT. Scenario: superadmin suspends a sub-admin
mid-review; that sub-admin's already-open tab can still approve a withdrawal or a domain for up
to 12 hours after being removed.
**Fix for 3.2/3.3 together:** add a `sessionVersion` column on `User`, embed it in the JWT
payload, check it in `AuthGuard.canActivate`, bump it on suspend/team-removal. Cheap, no new table.

### 3.4 Customer wallet endpoints are live and unguarded server-side despite being hidden in the UI — Security/Trust
`WalletController` (`wallet.controller.ts:11`) is `@Roles('customer')` with no other gate;
`WalletService.topUp()` will credit a balance directly (no-Paystack-key path) or start a real
Paystack charge. `OrdersService.place()` still has a full wallet-debit branch guarded only by
`user.role !== 'customer'`. `RegisterDto` blocks *new* customer accounts (`auth.dto.ts:76-79`),
but that's registration-time only — any pre-existing or manually-role-flipped `customer` row can
still transact through wallet top-up and wallet-paid checkout in full.
**Fix:** add an explicit feature-flag check (reusing the `SettingsService` pattern already used
for `paystackBusinessAccount`) in `WalletController` and the wallet branch of `OrdersService.place()`.

### 3.5 Customer→agent role flip carries wallet balance over as unaudited "agent earnings" — Money/Security
`User.balance` (`schema.prisma:208-210`) is one shared column serving as spendable wallet *and*
withdrawable agent earnings — role is the only thing that decides its meaning
(`wallet.service.ts:32-41` vs. `agents.service.ts`/`withdrawals.service.ts` all read the bare
`balance` field, no role-specific accounting or ledger reconciliation). No in-app path converts
`customer` → `agent` today, but `bootstrap.service.ts:49-60` promotes *whatever role a row
currently has* to `superadmin` if its email matches `SUPERADMIN_EMAIL` — establishing that
in-place role mutation on a `User` row is a pattern this codebase already uses. If any future
path (or a manual DB edit) ever flips a customer to agent, their leftover wallet balance
instantly becomes MoMo-withdrawable "agent earnings" with **no `Earning` ledger row explaining
it** — money silently changes category with zero audit trail.
**Fix:** if role conversion is ever built, force a balance-zeroing + explicit `Earning`/refund
entry at the conversion boundary; in the meantime, add a periodic audit query flagging any
`role != previous` mismatch with nonzero balance.

### 3.6 No admin audit log for the highest-frequency money-moving actions — Security/Trust
`setTier`, `setActive`, `markup`, `sync`, `toggleStatus` (`admin.controller.ts:254-257,276-284,
336-355`) never record which admin performed the action — no `@CurrentUser()` even captured in
several of them. Any `admin` profile satisfies every `@Roles('admin')` check
(`common/auth.ts:79-82`), so a sub-admin has full operational control (price tiers, product
activation, bulk markup, catalogue sync, refund/withdrawal approval, user suspension) with zero
per-admin accountability on most of it. Individual approval queues (withdrawals, refunds, domains,
branding) do record `decidedBy`/`escalatedBy` — this gap is specifically the pricing/catalogue/
suspension actions.
**Fix:** a single `AdminAuditLog` model (actorId, action, targetType/Id, before/after JSON,
createdAt) hooked into the five listed endpoints.

### 3.7 Self-referral loophole, currently inert but latent — Security/Trust
`auth.service.ts:150-161` keys registration uniqueness on email+phone, not on the human, and the
referral-code check (`127-139`) never verifies the code doesn't belong to the registrant
themself. Nothing stops one person registering a second identity (spare SIM/email) with their
own referral code as the upline. Harmless today because the flat two-party split model pays no
upline commission (verified in `domain/pricing.ts` — only `SELLER_DEPTH`/`ADMIN_DEPTH` shares
exist), but it becomes directly exploitable the moment any recruitment-based bonus is
reintroduced (see feature proposal 5.3).
**Fix:** if a recruiter bonus ships, add a check rejecting self-referral before that; not urgent otherwise.

### 3.8 Referral-code generation has an unhandled collision race — Data-integrity (narrow)
`auth.service.ts:407-425`: stem = first name + 2 random digits, checked via `findUnique` in a
loop, no transaction/lock. Two near-simultaneous registrations with the same first name and the
same random draw can both pass the check before either commits; the DB's real unique constraint
(`schema.prisma:193`) then throws an unhandled Prisma P2002 on the second `create()` —
`register()` has no catch/retry, so that registration fails with a raw error instead of quietly retrying.
**Fix:** catch P2002 around the create and retry code generation once or twice.

### 3.9 Stale-tab silently executes as the wrong profile after "switch profile" — Security/UX
`api.ts:78-80`: JWT lives in one shared `localStorage` key, no `storage` event listener anywhere.
`store.tsx:549-556` (`switchProfile`) overwrites that key. A second open tab keeps *rendering*
the old profile's screen, but its next API call reads the token fresh — it silently executes
against the new profile while displaying the old one's data, no warning to the user. Someone
could approve a withdrawal or view earnings believing they're looking at one profile while
actually acting as another.
**Fix:** a `storage` event listener that reloads/re-syncs session state across tabs on token change.

### 3.10 Domain silently reactivates on agent reactivation with no re-review — Security/Data-integrity
`resolve()` does a live join on `user.status === 'active'` (`domains.service.ts:168-182`), so a
suspended agent's domain stops resolving immediately (mod the documented 60s origin-cache
staleness). But suspend/restore (`admin.service.ts` ~292) never touches
`CustomDomain.allowed`/`active` — no cascade either direction. On reactivation, the domain starts
serving again automatically with whatever flags it had before, with zero re-review — even if the
original suspension was for a reason connected to that exact domain (fraud/impersonation).
**Fix:** either cascade-suspend the domain alongside the user, or force `allowed: false` on any
domain belonging to a user whose status transitions through `suspended`, requiring fresh review on reactivation.

---

## 4. Operational / Ghana-market gaps

### 4.1 No circuit breaker on Paystack — Operational
`paystack.client.ts` has no health check anywhere; `initialise`/`verify` use a flat 20s
`AbortSignal.timeout`. During a Paystack-wide incident, every checkout individually eats up to a
20-second hang before failing — no faster-fail banner, no pre-flight check.
**Fix:** a simple rolling-failure-rate circuit breaker that short-circuits to an immediate
"payments are delayed, try again shortly" message once a threshold trips.

### 4.2 No rate limiting on order placement — Operational
`app.module.ts` only wires `AuthGuard`; `LoginThrottleGuard` is scoped to sign-in routes only.
DataHub's own cap is 30 purchases/min, and `purchase()` is explicitly excluded from the
retry-with-backoff wrapper (single-shot, no idempotency key at that layer) — a 429 from DataHub
is read as a hard rejection (`kind: 'rejected'`), not retryable. A WhatsApp promo spike above
30/min produces real customer-facing order rejections and refund-queue churn instead of graceful queueing.
**Fix:** a request queue/leaky-bucket in front of `purchase()` that holds excess orders briefly
rather than passing straight through to a provider-side 429.

### 4.3 No aggregated multi-agent/repeat-customer view — Feature gap
No dedicated customer-recognition feature exists anywhere. Admin's order list caps at 500 recent
rows with a client-side substring filter that happens to match phone numbers — not a real
customer profile, order count, or lifetime-value view. Agents have no equivalent at all. A walk-up
customer buying weekly from the same agent (or different agents) leaves no continuity trail.

### 4.4 Superadmin bus-factor — Operational (narrow)
Self-service password reset works for admins/superadmins, so it's not zero-recovery. But there is
exactly one path to becoming superadmin: matching `SUPERADMIN_EMAIL` via env var + app restart
(`bootstrap.service.ts:47-66`). `team.service.ts` can only create `role: 'admin'`, never a second
superadmin. If the sole superadmin's inbox becomes inaccessible (or mail is misconfigured) while
locked out of the account, there is no in-app recovery path — only infra-level intervention
(changing the env var and restarting).

### 4.5 Guest MoMo refunds can get stranded indefinitely — Money (edge case, not by design)
`refunds.service.ts` triggers a real Paystack transfer on approval; failure modes (`otp`,
`insufficientBalance`, bad number, `unknown`) correctly park the refund back as pending with a
`transferNote` explaining why, rather than losing it silently. But nothing forces follow-up — a
refund can sit in the queue indefinitely if no admin revisits it. Money isn't lost or hidden, but
it can be stranded in practice.
**Fix:** an aging alert (e.g., reuse the existing stuck-order alert pattern) for refunds pending &gt;N days.

### 4.6 Extended DataHub outage — partially handled
The 10-minute reconciler sweep correctly emails admins an aggregate "no reply from provider"
count with a link, and repeats every sweep for as long as the problem persists — this is real,
not per-order silence. Gap: orders that *were* accepted (have a `providerReference`) before an
outage began, and then can't be status-checked during it, only surface passively on the Needs
Attention page — no push alert for that specific subset.

---

## 5. Already verified SAFE (worth knowing — ruled out, not re-litigate)

- **Withdrawal approve/reject double-decision** — atomic `updateMany` claim, can't double-debit or double-refund.
- **Stale checkout price vs. live agent-price edit** — always re-priced server-side at write time inside the order transaction; client price is never trusted.
- **Refund vs. reconciler sweep on the same order** — can't double-refund; refund row is unique per order, reconciler only touches non-terminal orders.
- **Phone number / MNP handling** — the network-prefix table was deliberately deleted after a real incident; validation is shape-only, network is never inferred server-side, so a ported number can't misroute a payout.
- **Money amount bounds** — top-up min/max and order pricing are all enforced server-side, not just in the frontend form (withdrawal has no hardcoded max, but is capped by actual balance + manual approval).
- **Timezone handling** — Ghana is UTC+0 with no DST; all date-bucketing code explicitly uses UTC methods, zero locale-dependent date calls found anywhere.
- **Idempotency on checkout** — a real client-generated key, mandatory for wallet payments, DB-unique-constraint-backed; a genuine double-submit race resolves to one order, not two.
- **Text field escaping** — server-side length limits are real (not just frontend maxlength); email templates escape every interpolated user string; no `dangerouslySetInnerHTML` anywhere in the frontend.
- **NCA prefix reallocation** — handled by design: no prefix table exists to go stale in the first place.
- **Paystack fee vs. admin margin** — the fee is an explicit additive line charged to the buyer, never subtracted from a share's margin; a negative admin margin from fees is structurally impossible.
- **Self-referral for upline earning** — impossible in the current flat two-party split; only seller and admin shares are ever produced.
- **Admin/superadmin also holding an agent role** — supported by design via `@@unique([email, role])`, always separate rows, never one row with dual roles.
- **Discontinued supplier SKUs** — automatically deactivated on catalogue sync, never silently left purchasable; price changes re-derive from markup rather than leaving stale or silently bumped prices.
- **Deleted/deactivated product mid-checkout** — order placement always re-validates the product server-side inside the transaction; a stale tab fails cleanly with no money moved.

---

## 6. Feature proposals

### 6.1 Domain flexibility (your original example) — phased plan

Infra check: frontend is a static Vercel deployment, backend is on Render, DNS/TLS is currently
100% manual (no ACME/Let's Encrypt/Cloudflare code anywhere). Vercel has a Domains API that
handles cert issuance and verification automatically — the plan below leans on that instead of
building certificate handling from scratch.

**Phase 1 — free subdomain (`kwame.jamesdataconsult.com`). Build this first, no registrar needed.**
One-time infra: add `*.jamesdataconsult.com` as a wildcard domain in the Vercel project settings
— one wildcard cert, issued once, covers every future agent. Code: add `mode: 'subdomain'` to
`CustomDomain`, agent picks a label, backend composes the full hostname, checks
uniqueness/reserved-words, sets `allowed`/`active` true immediately (no admin review needed, it's
the platform's own domain). `resolve()` (`domains.service.ts:168-182`) needs no change at all —
it's still a plain hostname lookup. Frontend: a "get a free subdomain" option next to the
existing "bring your own domain" form in `ShopBranding.tsx`.

**Phase 2 — automate the existing BYO-domain flow.**
Today, even after admin sets `allowed: true`, something (presumably the admin, by hand) still has
to add the domain in the Vercel dashboard for it to get a cert and serve traffic — that's almost
certainly why `active` is a separate manual flag (`domains.service.ts:108-117`'s own comment says
"DNS still has to be confirmed"). Wire `review()` to call Vercel's Domains API
(`POST /v10/projects/{id}/domains`) when `allowed` flips true, poll or webhook
(`GET /v9/projects/{id}/domains/{domain}`) for verification, and auto-flip `active` once Vercel
confirms it — email the agent the exact CNAME/TXT records Vercel's API returns instead of an
admin typing them by hand. Needs `VERCEL_API_TOKEN` + project ID as new env vars (same pattern as
every other secret in `render.yaml`).

**Phase 3 — superadmin purchases and manages a domain for the agent. Needs a registrar decision
first (deferred — see below), build after 1 and 2.**
New `DomainPurchase` model (registrar, externalOrderId, costMinor, `expiresAt`, `autoRenew`).
Debit the agent's balance at purchase/renewal using the same conditional-update pattern
`withdrawals.service.ts` already uses (`UPDATE ... WHERE balance >= amount`), refund on purchase
failure the same way a rejected withdrawal reverses. A successfully purchased domain then feeds
into Phase 2's automation to go live the same way a BYO domain does. Needs a new scheduled job for
renewal/expiry tracking — nothing like that exists for domains today. **Registrar choice (Namecheap
vs. Porkbun vs. other) intentionally deferred** — it's a pricing/markup/who-fronts-the-cost
decision, not just a code decision; don't let it block Phases 1–2.

**Do regardless of the above, cheap and independent of any phase:** self-service domain
removal/deactivation (currently only "submit a new one" exists), DNS instructions (CNAME/TXT)
shown in the request UI (currently blank), and fix the TOCTOU bug in `request()` (2.4) before
adding more traffic through this path.

### 6.2 Recruiter bonus, replacing dead downline-commission code
`AgentsService.downline()` still computes an always-zero `earnedForUpline` field, and
`Earnings.tsx` still keeps a `downline` filter that will never match a row — dead but harmless.
A one-time flat bonus on a sub-agent's first completed sale, written as a new `Earning.type:
'recruit_bonus'` row using the exact ledger pattern already in place, is a cheap, concrete
replacement incentive. **Must close the self-referral gap (3.7) first**, or this becomes farmable.

### 6.3 Product search
Category/network tabs only today. Cheap to add: the full catalogue is already shipped to the
client for instant local filtering — a client-side name/network substring filter needs no backend change.

### 6.4 Promo/coupon system
Zero code for it currently. Would plug into `domain/pricing.ts`'s split as a new discount line
funded from the admin's margin (not the agent's), to preserve the
"sale price = supplier cost + Σ margins" invariant. Needs a new `PromoCode` model and validation
in `PlaceOrderDto`.

### 6.5 Monthly agent statement / real export
The current CSV export reads from a client-side capped order list and silently truncates for
high-volume agents. `LedgerService` already has the server-side query shape needed
(date-windowed, paginated, per-user); nothing surfaces it as a downloadable monthly statement
with a running balance.

### 6.6 Proactive solvency alerting
Three of four solvency checks page admins by email; the actual "is the float going negative"
number (`position()`/`freeToSpend`) is dashboard-only. Extending the existing alert-debounce
pattern to this fourth check needs no new infrastructure.

### 6.7 2FA for admin/superadmin
These accounts approve real Paystack payouts and refunds with limited audit trail today (see
3.6). A TOTP secret column plus a check in the admin/superadmin login branch would meaningfully
raise the bar on the accounts that move money.

### 6.8 Self-service MoMo re-verification at withdrawal request
The payout number is already per-request (not frozen from profile), but nothing verifies it
belongs to the agent before it lands in admin's queue. Calling Paystack's recipient-resolution
API at request time (reusing the pattern already in `withdrawals.service.ts`'s recipient-creation
code) and showing the resolved account name back to the agent would catch typos before an admin
ever sees them.

### 6.9 Tiered agent badges from existing data
`AgentsService.downline()` and `admin.service.ts` already group orders/earnings by agent for
daily/weekly stats. A trailing-30-day volume tier (Bronze/Silver/Gold) is a derived read-only
field off data already being aggregated — no new tables.

### 6.10 Admin orders pagination — DONE (2026-09-21)
Raised directly during implementation: `AdminOrders.tsx` was fetching every order visible to
admin once via the shared store (`api.orders()`, capped at 500 rows server-side,
`orders.controller.ts`'s existing `limit` param) and doing all status/date/text filtering in the
browser over that fixed batch. On a busy day, 500 most-recent-of-everything can already be hours
old, silently excluding older `failed` orders from view before anyone searches for them, and
there was no page specifically surfacing DataHub purchase failures beyond a client-side "Failed"
tab scoped to that same capped batch.

**Shipped:**
- `OrdersService.enrichForAdmin()` — the admin-only field enrichment (actual supplier cost,
  Paystack fee, DataHub routing, refund status) extracted out of `list()` into a shared helper.
- `OrdersService.adminList(filter)` — real DB-side `where` (status/date range/text search) plus
  `count()` + `skip`/`take` pagination, capped at 2000 rows/page.
- `GET /admin/orders` (`admin.controller.ts`, `AdminOrdersQueryDto`) — the endpoint backing it,
  admin-only, params: `status`, `from`, `to` (inclusive of the whole day), `q`, `page`, `pageSize`.
- `AdminOrders.tsx` rewritten to call this endpoint directly instead of reading the shared store:
  defaults to **today's date range** on cold load (the "should show daily ones" ask), debounces
  search input, shows a real "Page X of Y · N orders match" control, and the CSV export now pulls
  every matching row from the server (up to 2000, with an explicit toast if the true count is
  higher) instead of exporting only whatever was already loaded client-side.
- `?ref=` and the new `?status=` deep link (used by Overview's failed-orders callout) both clear
  the default date range, so a specific order or an entire status isn't hidden by "today only".
- Search columns: reference, recipient, buyer name/phone, sell-link code, the agent name frozen at
  sale (`soldByAgentName`, confirmed to actually be a real frozen column, not a live join), and
  product name. Deliberately does not reach into `split`'s JSON to match an upline agent's name
  several levels up a chain — that was only ever useful under multi-level referral, which is off.

**Known follow-up, not done this pass:** `Overview.tsx`'s "Failed orders" callout count is still
derived from the same capped client store, so the *number* shown there can undercount even though
the "View them" link now goes to the real, complete, paginated list.

## Suggested priority if picking a next batch of fixes

**Done (2026-09-21):**
`applyFailed()` atomic claim (1.1) · `releaseOrdersFor` status guard (1.3) · domain-request P2002
handling (2.4) · wallet endpoint feature-flag guard (3.4) · Domain Phase 0 (self-service removal +
DNS instructions). 3.1 investigated and explicitly rejected — see its section above.

**Do next (real races, slightly more work):**
Bulk-markup-vs-edit optimistic lock (2.1) · withdrawal pending-count advisory lock (2.2) ·
catalogue-sync-vs-edit guard (2.3) · session invalidation via `sessionVersion` (3.2/3.3)

**Backlog (lower frequency / narrower windows):**
Chargeback handling (1.2) · admin audit log (3.6) · self-referral guard (3.7, only urgent if 6.2 ships) ·
branding re-upload race (2.5) · domain reactivation re-review (3.10) · referral-code collision retry (3.8)

**Features, roughly in order of leverage:**
Domain flexibility (6.1) → recruiter bonus (6.2, after 3.7) → product search (6.3, cheapest) →
monthly statement (6.5) → promo codes (6.4) → 2FA (6.7)
