# Team Skills Breakdown
## JamesDataConsult — Data Bundle & Reseller Platform

Derived from: `functional-nonfunctional-requirements.md` v1.0
Target stack: **React + TypeScript (SPA) · NestJS REST API structured with Clean Architecture · PostgreSQL**
Prepared: August 2026

---

## 1. How to read this document

Four disciplines are needed: **Frontend**, **Backend**, **Database Administrator**, **UI/UX**. Every skill below is tied to the requirement ID that creates the need for it, so nothing here is generic advice — if a requirement is cut, the matching skill can be cut with it.

Each skill carries a level:

| Level | Meaning |
|---|---|
| **Essential** | v1 cannot ship correctly without it. Non-negotiable. |
| **Important** | v1 ships, but something is fragile, slow, or manual without it. |
| **Growth** | Needed as usage scales past launch, or for v2 features. |

One important framing point up front: **this is a fintech application wearing an e-commerce coat.** The wallet (FR-2.1 → FR-2.7) and the immutable transaction log (NFR-2.6) mean money correctness outranks features. Skills that protect money are marked Essential even where they look advanced.

---

## 2. Cross-cutting skills — everyone on the project

These are not owned by one role. A gap here shows up as bugs in all four areas.

| Skill | Why this project needs it | Level |
|---|---|---|
| Git & GitHub — branching, meaningful commits, PR review | NFR-5.3 explicitly requires version control with a clear history that a future developer can maintain | Essential |
| Reading and writing API contracts — OpenAPI generated from NestJS DTOs via `@nestjs/swagger`, ideally with a generated client for the React app | Frontend and backend are separate deployables; the contract is the only thing keeping them in sync | Essential |
| Respecting an architectural boundary even under deadline pressure | Clean Architecture is only worth its cost if the dependency rule holds. One "temporary" ORM call in a controller is how these codebases decay, and NFR-5.3 is a maintainability requirement with a real reader at the other end | Essential |
| Secrets handling — `.env`, never committing keys, separate dev/prod credentials | NFR-2.4 (DataHub GH + Paystack keys) | Essential |
| Money as integers (pesewas), never floating point | Every wallet, pricing, and profit requirement. `0.1 + 0.2 ≠ 0.3` will silently corrupt balances | Essential |
| Ghana telecom & MoMo domain knowledge — MTN/Telecel/AirtelTigo, MSISDN formats, MoMo user behaviour | FR-3.2, FR-4.2, NFR-6.2 | Essential |
| Mobile-first, low-bandwidth thinking | NFR-1.1 (3s on 4G), NFR-4.1 (mobile first) | Essential |
| Basic threat modelling — "what if the user forges this request?" | NFR-2.5, and the fact that agents have a financial incentive to tamper with prices | Important |
| Writing clear error copy, not error codes | NFR-4.3 | Important |

---

## 3. Frontend skills — React + TypeScript

**Owns:** the customer storefront, the agent dashboard, the admin dashboard, and every purchase flow the user touches.

### 3.1 Core

| Skill | Requirement driver | Level |
|---|---|---|
| React fundamentals — components, props, state, effects, lists/keys | All UI requirements | Essential |
| TypeScript — interfaces, unions, generics, typing API responses | Order status is a union (`Pending / Processing / Completed / Failed`, FR-4.4); roles are a union (FR-1.5). Types prevent whole bug classes here | Essential |
| Client-side routing with route guards (React Router) | Three distinct role-based areas: storefront, agent dashboard (FR-6.1), admin dashboard (FR-6.3). Guards enforce NFR-2.5 in the UI layer | Essential |
| Forms + validation (React Hook Form + Zod, or equivalent) | FR-1.1 registration, FR-4.1 purchase, FR-4.2 recipient number validation, FR-3.4 price editing with a floor at cost price | Essential |
| Server-state management (TanStack Query or RTK Query) — caching, refetching, invalidation, polling | Wallet balance and order status change from outside the browser (webhooks, FR-4.4). Naive `useEffect` fetching will show users stale balances | Essential |
| Auth in the browser — token storage, refresh, expiry, logout, protected routes | FR-1.3, FR-1.4 | Essential |
| CSS with Tailwind (or CSS Modules) — responsive, mobile-first | NFR-4.1, NFR-6.1 | Essential |
| Accessible, semantic HTML — labels, focus management, touch target sizing | NFR-4.1 (thumb-driven use), NFR-6.1 | Important |
| Loading, empty, error, and optimistic states as first-class UI | NFR-4.3; an order that takes seconds to fulfil (FR-4.3) must never look frozen | Essential |
| Data tables with pagination, sort, filter, date range | FR-6.1 order history, FR-6.3 all orders/users, FR-8.2 agent sales summary by date range | Essential |
| Charts for dashboards (Recharts or similar) | FR-6.3 system-wide statistics, FR-8.1 sales summaries | Important |
| CSV download from an API response (Blob + object URL) | FR-8.3 | Important |
| Performance budgeting — code splitting, lazy routes, bundle analysis, image optimisation | NFR-1.1 hard 3-second budget on 4G. A default unsplit React bundle will miss this | Essential |
| Vite build tooling, env var handling, production builds | Deployment of the SPA | Essential |
| Paystack Inline / Popup JS integration on the client | FR-2.2 top-up | Essential |
| Testing — Vitest + React Testing Library; Playwright for the purchase flow | NFR-4.2 (the 4-step flow is the product's core path and must not regress) | Important |
| PWA basics — installability, offline shell, "add to home screen" | Strong fit for the Ghanaian mobile market; not required by any FR | Growth |
| Real-time updates via WebSocket/SSE instead of polling | Improves FR-4.4 status feedback; polling is acceptable for v1 | Growth |

### 3.2 Frontend traps specific to this app

- **Never trust the Paystack client callback as proof of payment.** The client callback only means the popup closed. The wallet must credit from the verified server-side webhook (see §4.4). A frontend developer who wires "on success → show new balance" without server confirmation creates a free-money bug.
- **The price floor (FR-3.4) must be validated on the server too.** Client-side validation is UX, not enforcement — an agent can bypass it with the browser console.
- **Result checker vouchers (FR-4.7) must not be cached in client state or logged.** They are one-time secrets. Render once, do not retain in Redux/localStorage, and be careful with error reporting tools that capture state snapshots.
- **Ghana 4G is inconsistent.** Assume slow, lossy connections: retry-friendly requests, no double-submit on the buy button (paired with backend idempotency, §4.4), and visible progress.

---

## 4. Backend skills — NestJS + Clean Architecture

**Owns:** the REST API, auth, the wallet ledger, Paystack and DataHub GH integrations, order state machine, referral logic, RBAC, notifications, reporting endpoints.

This is the highest-risk role on the project. Most of what can go badly wrong — lost money, double-spends, unfulfilled paid orders — lives here.

The stack choice matters to the skill list: **NestJS is opinionated**, and Clean Architecture adds a second set of rules on top of it. A developer who knows Express well is not automatically productive here — the dependency injection model, the module system, and the layer boundaries all have to be learned deliberately. That cost is worth paying on this project for two specific reasons tied to the requirements: NFR-5.1 demands that new products and networks be addable without touching core ordering logic, and NFR-5.3 demands a codebase a future developer can maintain. Both are architecture requirements, not coding requirements.

### 4.1 NestJS platform skills

| Skill | Requirement driver | Level |
|---|---|---|
| **Dependency injection and the provider model** — constructor injection, `@Injectable()`, provider scopes, injection tokens, `useClass` / `useFactory` / `useValue` | The whole Clean Architecture approach depends on it: use cases receive interfaces, and NestJS decides at wiring time which implementation is supplied. Without solid DI understanding, the layer boundaries collapse | Essential |
| Module system — feature modules, `imports`/`providers`/`exports`, `forwardRef`, dynamic modules | Keeps wallet, orders, catalog, referrals, and admin as separable features. Directly serves NFR-5.1 and NFR-5.3 | Essential |
| Controllers, routing decorators, DTO classes, and response shaping | The REST surface consumed by the React SPA | Essential |
| **Guards** — `CanActivate`, `@UseGuards`, role guards, custom `@Roles()` decorators with `Reflector`, ownership guards | FR-1.5, NFR-2.5. Guards are where RBAC lives in NestJS; they must cover both role checks and row-level ownership so agent A cannot read agent B's data by changing an ID | Essential |
| Pipes and `ValidationPipe` with `class-validator` + `class-transformer` (or a Zod pipe), `whitelist` and `forbidNonWhitelisted` enabled globally | FR-1.1, FR-4.1, FR-4.2, FR-3.4. Never trust a client payload — and without `whitelist`, extra fields ride through into your DTOs | Essential |
| Exception filters and a custom exception hierarchy mapped to stable error codes | NFR-4.3. Domain errors (`InsufficientBalanceError`) must surface as structured codes the frontend turns into friendly copy — never leaked stack traces | Essential |
| Interceptors — logging, correlation IDs, response envelopes, timeouts | NFR-2.6 auditability, NFR-1.2 | Important |
| **`@nestjs/config` with schema validation of env vars at boot** | NFR-2.4. The app should refuse to start if a Paystack or DataHub key is missing, rather than failing at the first payment | Essential |
| Passport integration — `@nestjs/passport`, `passport-jwt`, local strategy, refresh token handling | FR-1.3, FR-1.4 | Essential |
| **Raw body access for webhook signature verification** — `NestFactory.create(AppModule, { rawBody: true })` or a per-route body parser exclusion | Paystack signs an HMAC SHA512 over the *raw* request body. NestJS parses JSON by default, and a parsed-then-restringified body will not match the signature. This is the single most common NestJS payment-integration bug | Essential |
| `@nestjs/bullmq` (or `@nestjs/bull`) — queues, processors, retry/backoff options, dead-letter handling | NFR-3.2 queue orders through provider downtime, FR-4.6 delayed retry, FR-7.x async SMS | Essential |
| `@nestjs/schedule` — cron jobs for reconciliation and report rollups | NFR-3.2, NFR-3.3 reconciliation; FR-8.1 summaries | Important |
| `@nestjs/throttler` — rate limiting on auth, OTP, and top-up routes | Brute-force and OTP abuse protection | Essential |
| `@nestjs/terminus` — health and readiness endpoints including a DB check | NFR-3.1 uptime measurement and deployment health | Important |
| `@nestjs/swagger` — generated OpenAPI from DTOs and decorators | The contract with the separate React SPA; removes hand-maintained API docs | Important |
| `HttpModule`/`axios` or native fetch wrapped in an injectable client, with timeouts and interceptors | FR-4.3 DataHub GH, FR-2.2 Paystack | Essential |
| **`@nestjs/testing`** — `Test.createTestingModule`, overriding providers with fakes, e2e tests with `supertest` | The payoff of Clean Architecture is testability; this is how you collect it | Essential |
| Persistence integration — Prisma via a custom module, or TypeORM/MikroORM with repositories | All data access | Essential |
| CQRS module (`@nestjs/cqrs`) — commands, queries, events | Optional. Useful for separating write use cases from the read-heavy reporting side (FR-8.x), but adds ceremony a small team may not want in v1 | Growth |
| Microservices / transport layers | Explicitly not needed. NFR-1.3 targets 100 concurrent users; a modular monolith is the correct shape | — |

### 4.2 Clean Architecture skills

Clean Architecture on this project means four layers with dependencies pointing inward only: **Domain ← Application ← Infrastructure / Presentation**. The domain knows nothing about NestJS, Postgres, Paystack, or DataHub GH.

| Skill | Requirement driver | Level |
|---|---|---|
| **The dependency rule** — inner layers never import outer ones; enforcing it (ESLint import boundaries, or `dependency-cruiser`) rather than trusting discipline | NFR-5.1, NFR-5.3. An unenforced rule decays within weeks | Essential |
| **Ports and adapters** — defining `PaymentGatewayPort`, `BundleProviderPort`, `SmsSenderPort`, `WalletRepositoryPort` as domain/application interfaces, with infrastructure adapters implementing them | FR-2.2, FR-4.3, FR-7.x. This is what makes DataHub GH replaceable and lets the whole order flow be tested without a live provider | Essential |
| **Use cases (application services)** — one class per business operation: `TopUpWallet`, `PlaceOrder`, `RetryFailedOrder`, `RefundOrder`, `SetAgentPrice`, `RequestWithdrawal`, `ApproveWithdrawal`, `RegisterAgentViaReferral` | Maps almost one-to-one onto the FR list, which makes requirement traceability trivial | Essential |
| **Rich domain entities and value objects** — `Money`, `Msisdn`, `ReferralCode`, `WalletBalance`, `OrderStatus`; invariants enforced in constructors | Money as integer pesewas and MSISDN normalisation stop being scattered helper functions and become types that cannot hold an invalid value. Serves FR-4.2 and every money requirement | Essential |
| Domain-level business rules kept out of controllers and repositories — e.g. "resale price may not fall below cost price" lives in the pricing entity | FR-3.4. Enforced in the domain, mirrored by a DB `CHECK` (§5) and surfaced by frontend validation — three layers, one rule | Essential |
| Mapping between layers — persistence models ↔ domain entities ↔ response DTOs, with explicit mappers | Prevents ORM entities and database column names leaking into the API contract and freezing the schema | Essential |
| **Transaction management across layers (Unit of Work)** — a transaction boundary owned by the use case and propagated to repositories without leaking the ORM into the domain | The hardest part of combining Clean Architecture with the wallet requirements. `PlaceOrder` must lock the wallet, insert a ledger row, and create the order in one atomic transaction (FR-2.3, NFR-3.3) while the use case stays persistence-agnostic. Usually solved with a `UnitOfWork`/`TransactionManager` port plus async context propagation | Essential |
| Repository pattern done correctly — collection-like interfaces returning domain objects, not leaked query builders | Keeps use cases testable with in-memory fakes | Essential |
| Domain events — `OrderCompleted`, `WalletToppedUp`, `WithdrawalRequested` — dispatched after commit | FR-7.1, FR-7.2, FR-7.3. Notifications become subscribers instead of code wedged into the payment path | Important |
| Result/Either-style error returns or a typed domain exception hierarchy | NFR-4.3, and keeping HTTP status codes out of the domain | Important |
| Knowing when *not* to apply the full pattern — thin pass-through for simple reads | FR-6.3, FR-8.x reporting queries. Forcing an admin list endpoint through entities and mappers costs performance and clarity for nothing | Important |

**Practical layout** — the shape a developer on this project should be able to produce and defend:

```
src/
  domain/                  ← no NestJS, no ORM, no HTTP. Pure TypeScript.
    wallet/               Wallet entity, Money & Msisdn value objects, domain errors
    order/                Order entity, OrderStatus + legal transitions
    pricing/              cost-price floor rule (FR-3.4)
    referral/             referral rules, single vs multi-level policy (FR-5.4/5.5)
    ports/                BundleProviderPort, PaymentGatewayPort, SmsSenderPort,
                          repository ports, UnitOfWorkPort
  application/             ← orchestration. Depends on domain only.
    use-cases/            PlaceOrder, TopUpWallet, RefundOrder, SetAgentPrice, …
    dto/
  infrastructure/          ← every outside-world detail lives here
    persistence/          Prisma/TypeORM repositories implementing the ports
    payments/             PaystackAdapter
    providers/            DataHubGhAdapter
    messaging/            SmsAdapter (Hubtel / Arkesel / mNotify)
    queue/                BullMQ processors
  presentation/            ← NestJS controllers, guards, pipes, filters, Swagger
  config/                  ← validated env schema
```

**Clean Architecture traps on this project**

- **Anemic domain.** Entities that are only data bags, with all logic in use cases, gives you the folder structure without the benefit. The wallet's overdraw rule and the price floor belong in the domain objects.
- **The transaction leak.** The most common failure when combining this pattern with financial correctness: developers either give up and put SQL in the use case, or scatter transactions so widely that the atomic debit-and-ledger guarantee (NFR-3.3) is lost. Design the `UnitOfWork` port before writing `PlaceOrder`.
- **Over-layering v1.** Four layers, mappers, and ports for a settings toggle (FR-6.4) is waste. Apply the full pattern to money, orders, pricing, and referrals; keep reporting and admin reads pragmatic.
- **Mapper fatigue.** Three representations of every object is real overhead. Budget for it, and generate or colocate mappers so they stay in sync.

### 4.3 Domain, data & integration skills

| Skill | Requirement driver | Level |
|---|---|---|
| TypeScript at a high level — discriminated unions, generics, `readonly`, branded types, strict mode | Order/role/transaction-type unions, money as a branded type, and the interfaces the whole ports-and-adapters approach rests on | Essential |
| REST API design — resources, status codes, consistent error envelopes, versioning | Contract with a separate SPA; NFR-4.3 needs structured error codes mapped to friendly copy | Essential |
| Password hashing with bcrypt or Argon2, correct cost factor | NFR-2.1 | Essential |
| JWT (access + refresh) or server sessions; secure cookie flags | FR-1.3 | Essential |
| Password reset flows — single-use, expiring, hashed tokens via email or SMS OTP | FR-1.4 | Essential |
| **Designing the authorisation model itself** — role hierarchy, resource-ownership rules, and a deny-by-default posture | FR-1.5, NFR-2.5. The guard mechanics are in §4.1; the skill here is deciding *what* each role may touch and making ownership checks systematic rather than remembered endpoint by endpoint | Essential |
| SQL and query building with a typed client (Prisma, Drizzle, or TypeORM), used *inside repository adapters only* | All data access. The ORM is an infrastructure detail; if it appears in a use case, the architecture has been breached | Essential |
| **Database transactions and row-level locking (`BEGIN` … `SELECT … FOR UPDATE`)** | FR-2.3, FR-2.5, NFR-3.3. Two concurrent orders on one wallet will both pass a naive balance check and overdraw it. This single skill is the difference between a working wallet and a broken one | Essential |
| **Idempotency keys** on order placement and webhook handling | FR-4.3, FR-4.6, FR-2.7. Paystack and DataHub GH will retry webhooks; double-clicks happen on flaky networks. Without idempotency you get double debits and double fulfilment | Essential |
| **Ledger-style accounting** — append-only transaction rows, balance derived or reconciled against them, no in-place balance edits without a matching entry | FR-2.4, NFR-2.6, NFR-3.3 | Essential |
| Webhook verification logic — HMAC comparison in constant time, amount/currency/intent matching, replay protection via a unique reference | Paystack top-ups (FR-2.2) and DataHub GH status callbacks (FR-4.4). Pairs with the NestJS `rawBody` requirement in §4.1 — signature verification fails silently if the body was parsed first | Essential |
| Outbound HTTP integration — timeouts, retries with backoff, distinguishing retryable from terminal failures, all behind a port | FR-4.3, FR-4.6 ("retry exactly once"), NFR-3.2. Lives in the `DataHubGhAdapter`, never in a use case | Essential |
| **Designing the order state machine** with explicit legal transitions | FR-4.4. Statuses must only move in permitted directions; a late webhook must not resurrect a refunded order | Essential |
| Designing idempotent, retry-safe job payloads — a job that runs twice must not fulfil or refund twice | NFR-3.2 (queue orders through provider downtime), FR-4.6 (delayed retry), FR-7.x (async SMS). The BullMQ wiring is in §4.1; the correctness thinking is here | Essential |
| Scheduled reconciliation job — poll pending orders and Paystack transactions to close gaps webhooks missed | NFR-3.2, NFR-3.3. Webhooks get lost; without reconciliation, money silently strands | Important |
| Feature flags / settings table read at runtime | FR-5.5, FR-6.4, NFR-5.2 — the multi-level referral toggle must be data, not a deploy | Essential |
| Recursive queries or closure-table handling for referral chains | FR-5.4 single-level now, FR-5.6 full chain when toggled on | Important |
| Data-driven product catalog — new products/networks added as rows, not code | NFR-5.1 | Essential |
| MSISDN normalisation and network detection from prefix, prefix list in config | FR-3.2, FR-4.2 | Essential |
| SMS gateway integration (Hubtel, Arkesel, mNotify, or Twilio) | FR-4.5, FR-4.7, FR-7.1, FR-7.2 | Essential |
| Email sending (transactional provider) | FR-1.4 | Important |
| Structured logging with correlation IDs, and redaction of secrets/vouchers/PII | NFR-2.6 auditability, NFR-7.2. Vouchers and phone numbers must never land in plaintext logs | Essential |
| Aggregation endpoints for reporting, plus CSV streaming export | FR-8.1, FR-8.2, FR-8.3 | Important |
| Testing — fast unit tests on domain entities and use cases using **in-memory fakes swapped in at the ports**, integration tests against a real Postgres, and **concurrency tests that fire simultaneous debits** | NFR-3.3. The wallet needs a test that actually races two orders. Being able to test `PlaceOrder` with a fake provider and fake repository — no Docker, no HTTP — is the main return on the Clean Architecture investment | Essential |
| Deployment — process manager, HTTPS/TLS termination, reverse proxy, env config, health checks | NFR-2.2, NFR-3.1 | Essential |
| Error tracking + uptime monitoring and alerting (Sentry, healthchecks) | NFR-3.1 99% uptime is unmeasurable without monitoring | Important |
| Circuit breaker pattern around DataHub GH | NFR-3.2 — stop hammering a dead provider and fail fast into the queue | Growth |
| Horizontal scaling — statelessness, shared session/queue store, connection pooling | NFR-1.3 (100 concurrent at launch, scalable after) | Growth |

### 4.4 The five backend problems that decide whether this project succeeds

These deserve explicit design attention before any code is written. Each one is named with the layer that owns it, so the architecture does not become an excuse to spread the logic around.

1. **The debit race (FR-2.5, NFR-3.3).** Read-check-write on a balance is wrong under concurrency. Correct approach: single transaction, `SELECT … FOR UPDATE` on the wallet row (or a conditional `UPDATE … WHERE balance >= amount` and check the affected row count), insert the ledger entry, commit. Backed by a database `CHECK (balance >= 0)` as a last line of defence.
   *Layers:* the rule ("a wallet may not go negative") lives in the `Wallet` domain entity; the atomicity lives in the `WalletRepository` adapter and the `UnitOfWork`; `PlaceOrder` orchestrates and knows about neither locks nor SQL.

2. **Payment truth lives server-side (FR-2.2).** Flow: client asks the API to initialise a Paystack transaction → API stores a pending top-up keyed by reference → user pays → **Paystack webhook** arrives → verify HMAC signature over the raw body → verify the amount and currency match the stored intent → credit the wallet idempotently by reference. A `verify` API call to Paystack is the fallback for missed webhooks. The browser is never the source of truth.
   *Layers:* signature verification belongs in the `PaystackAdapter` (it is a Paystack detail); the `ConfirmTopUp` use case receives an already-verified, provider-agnostic payment event. Remember `rawBody: true` — see §4.1.

3. **Paid-but-not-delivered (FR-4.6, FR-2.7, NFR-3.3).** The gap between "wallet debited" and "DataHub GH confirmed" is where funds get lost. Needs: order row committed *before* the provider call, one automatic retry, a terminal-failure path that refunds via a *new* ledger entry (never by reversing the old one), and a reconciliation job for orders stuck in `Processing`.
   *Layers:* never hold a database transaction open across an outbound HTTP call. Commit the debit, then dispatch the provider call as a queued job. This is the point where the transaction boundary and the port boundary must be reasoned about together.

4. **Duplicate webhooks and double-clicks.** Both Paystack and DataHub GH may deliver the same event more than once, and BullMQ will re-run a job after a crash. Every mutating handler must be safe to run twice — enforced with a unique constraint on the provider reference plus an idempotency key on order creation, checked inside the same transaction that does the work.

5. **Referral toggle without a rebuild (FR-5.5, NFR-5.2).** Store `referred_by` on every user from day one regardless of the toggle. The toggle only controls whether a sub-agent's referral link *works* and how deep the chain is displayed (FR-5.6) — it never changes the schema.
   *Layers:* express it as a `ReferralPolicy` in the domain, with the flag injected as configuration. That way FR-5.5 is satisfied by swapping a policy value, not by editing conditionals scattered through the signup flow.

---

## 5. Database administrator skills — PostgreSQL

**Owns:** schema, constraints, migrations, indexes, transaction integrity, backups, the audit trail, and reporting performance.

On a project this size the DBA is often the same person as the backend developer — but the skills are distinct, and the money requirements (NFR-2.6, NFR-3.3) make them non-optional rather than a luxury.

### 5.1 Core

| Skill | Requirement driver | Level |
|---|---|---|
| Relational modelling — normalisation, keys, cardinality | Whole system: users, wallets, transactions, products, prices, orders, referrals, vouchers, withdrawals, settings | Essential |
| **Constraints as correctness, not decoration** — `NOT NULL`, `UNIQUE`, `FOREIGN KEY`, `CHECK` | `UNIQUE` on referral code (FR-1.7) and provider reference (idempotency); `CHECK (balance >= 0)` (FR-2.5); `CHECK (resale_price >= cost_price)` (FR-3.4). The database is the last place a bug can be stopped | Essential |
| `NUMERIC`/`DECIMAL` or `BIGINT` minor units for money — never `FLOAT`/`REAL` | Every wallet and pricing requirement | Essential |
| Transactions, ACID, isolation levels, and what each one does and does not prevent | FR-2.3, NFR-3.3 | Essential |
| Row-level locking (`FOR UPDATE`, `FOR NO KEY UPDATE`) and deadlock avoidance through consistent lock ordering | The debit race, §4.4 | Essential |
| **Append-only / immutable table design** — no `UPDATE` or `DELETE` grants on the ledger, revoked at the role level; corrections made by compensating entries | NFR-2.6 requires a log regular users cannot edit or delete. This is a *privilege* design problem, not just an application rule | Essential |
| Postgres roles and `GRANT`/`REVOKE` — an app role with least privilege, separate from the migration/owner role | NFR-2.5, NFR-2.6 | Essential |
| Versioned, reviewable migrations that run forward in CI and production | NFR-5.3, NFR-5.1 | Essential |
| Indexing — B-tree, composite, partial indexes; reading `EXPLAIN ANALYZE` | FR-6.3 all-orders views, FR-8.1/8.2 date-range reports, order lookup by reference. Unindexed date-range scans are the first thing to slow down | Essential |
| Audit trail design — trigger-based history tables or an event table with `created_at`, actor, before/after | NFR-2.6 | Important |
| Soft delete / status flags rather than row deletion | FR-6.5 suspend or deactivate a user — must not orphan their orders or ledger | Essential |
| Recursive CTEs (`WITH RECURSIVE`) for referral trees; adjacency list now, closure table or `ltree` if depth grows | FR-5.4, FR-5.6 | Important |
| Encryption of sensitive columns at rest — voucher serial/PIN (pgcrypto or application-level envelope encryption) | FR-4.7 vouchers are bearer secrets; NFR-7.2 | Important |
| PII minimisation and retention thinking | NFR-7.2 Ghana Data Protection Act | Important |
| **Backups and tested restores** — automated `pg_dump` or managed snapshots, point-in-time recovery, and a restore actually rehearsed | NFR-3.1, NFR-3.3. An untested backup is not a backup, and this database holds people's money | Essential |
| Connection pooling (PgBouncer or pool config) and `max_connections` awareness | NFR-1.3 | Important |
| Materialised views or rollup tables for sales summaries, with a refresh strategy | FR-8.1, FR-8.2 — aggregating raw orders live will not stay fast | Growth |
| Table partitioning for orders/transactions by month | Growth path once volume builds | Growth |
| Read replicas to keep admin reporting off the transactional path | NFR-1.3 at scale | Growth |
| Monitoring — `pg_stat_statements`, slow query log, bloat and vacuum awareness | NFR-1.3, NFR-3.1 | Important |

### 5.2 Minimum schema the requirements imply

A DBA on this project should be able to produce and defend this shape before development starts:

| Table | Exists because | Notes that matter |
|---|---|---|
| `users` | FR-1.1, FR-1.5, FR-1.6 | Role column; `referral_code` unique (FR-1.7); `referred_by` self-FK present from day one (FR-5.5); status for suspension (FR-6.5) |
| `wallets` | FR-2.1 | One per user; `CHECK (balance >= 0)`; the row that gets locked on debit |
| `wallet_transactions` | FR-2.4, NFR-2.6 | Append-only. Type, amount, balance-after, reference, order FK, timestamp. No update/delete grant |
| `products` | FR-3.1, FR-3.2, NFR-5.1 | Category + network as data; provider product code; active flag |
| `product_prices` | FR-3.3, FR-3.5, FR-3.6 | Cost price and admin default price, with effective-dated history so old orders keep their true margin |
| `agent_prices` | FR-3.4, FR-6.2 | Per-agent override; `CHECK` against cost price |
| `orders` | FR-4.1 → FR-4.6 | Recipient MSISDN, status enum, provider reference unique, idempotency key, cost/sale price snapshot, profit derivable (FR-5.3) |
| `order_events` | FR-4.4 | Every status transition, for support and dispute resolution |
| `vouchers` | FR-4.7 | Encrypted serial + PIN, assigned-to and assigned-at, one-time issuance |
| `withdrawal_requests` | FR-2.6, FR-6.4, FR-7.3 | Status, requested/decided timestamps, admin actor |
| `settings` | FR-5.5, FR-6.4, NFR-5.2 | Key/value; holds the multi-level referral toggle |
| `notifications` | FR-7.1 → FR-7.3 | Delivery attempts and status, so a failed SMS is visible not silent |

Snapshotting cost and sale price onto the order row is the detail most often missed. Without it, an admin updating cost prices (FR-3.6) retroactively rewrites historical agent profit (FR-5.3) and every past report (FR-8.1).

---

## 6. UI/UX skills

**Owns:** information architecture, the purchase flow, the three dashboards, error and empty states, trust, and the copy that carries all of it.

### 6.1 Core

| Skill | Requirement driver | Level |
|---|---|---|
| Mobile-first design — designing at ~360px first and scaling up, not the reverse | NFR-4.1 | Essential |
| **Flow design under a hard step budget** | NFR-4.2 caps a returning user's purchase at 4 steps. This is a measurable design constraint: select product → enter number → confirm → done, with payment absorbed by the wallet | Essential |
| Information architecture for three distinct audiences — walk-up customer, agent running a business, admin overseeing everything | FR-6.1, FR-6.3 | Essential |
| Form design — input types that trigger the numeric keypad, autofill, inline validation, forgiving phone number entry | FR-1.1, FR-4.1, FR-4.2 | Essential |
| **Error state and microcopy writing** — plain language, says what happened and what to do next | NFR-4.3 explicitly requires this. "Insufficient balance — top up GHS 5.00 to complete this order" beats `ERR_WALLET_402` | Essential |
| Designing loading, pending, empty, partial, and failure states for every screen | FR-4.4 orders genuinely sit in Pending/Processing; NFR-3.2 downtime must look handled, not broken | Essential |
| Trust and credibility design — visible pricing, receipts, confirmation before irreversible sends, clear branding | Users are sending real money to a small platform; a recipient number typo is unrecoverable (FR-4.1) | Essential |
| Wireframing and prototyping in Figma; component-based design files | Handoff to the frontend developer | Essential |
| Design system thinking — tokens for colour/spacing/type, a small documented component set | Consistency across storefront + two dashboards without redesigning each screen | Important |
| Accessibility — WCAG AA contrast, 44px+ touch targets, focus order, screen reader labels, no colour-only status | NFR-4.1, NFR-6.1 | Important |
| Dashboard and data-display design — hierarchy, chart choice, table density on small screens | FR-6.1, FR-6.3, FR-8.1, FR-8.2 | Important |
| Onboarding and empty-state design for a brand-new agent (no orders, no referrals, zero balance) | FR-6.1 — the first-run dashboard is the agent's first impression | Important |
| Referral sharing UX — one-tap copy, WhatsApp share, visible sub-agent list | FR-1.7, FR-5.1, FR-5.2. WhatsApp is the primary sharing channel in this market | Essential |
| Legal and disclosure placement — WAEC disclaimer, ToS/Privacy acceptance at signup | NFR-7.1, NFR-7.3. Must be present and honest without derailing the signup flow | Essential |
| Performance-aware design — restrained imagery, system/subset fonts, no heavy hero media | NFR-1.1's 3-second budget is spent by design decisions as much as by code | Essential |
| Usability testing with 3–5 real target users on real phones | NFR-4.2, NFR-4.3 — the step count and the clarity of errors are only provable with real users | Important |
| Localisation and tone for a Ghanaian audience — GHS formatting, familiar MoMo language, network naming (Telecel, not Vodafone) | NFR-6.2 and general adoption | Important |
| Designing the price-setting experience for agents — margin made visible, floor at cost price explained | FR-3.4, FR-6.2. Agents are non-technical business owners setting their own prices; this screen decides whether they use the platform | Essential |

### 6.2 UX judgements this product hinges on

- **The wallet is the reason the flow can be 4 steps.** Its purpose (FR-2.1) is to remove a MoMo prompt from every purchase. If top-up feels heavy or untrustworthy, users skip it and NFR-4.2 becomes unreachable. Top-up deserves the most design care of any screen.
- **Recipient number confirmation is the highest-stakes moment in the product.** Data sent to a wrong number is gone. Design an explicit confirmation showing the number and detected network before submission — grounded in FR-4.2.
- **Agents and customers need different pricing surfaces.** Customers see one price (FR-3.5). Agents see cost, their price, and their margin (FR-3.4, FR-5.3). Mixing these views leaks wholesale pricing to retail customers.
- **Pending is a normal state, not an error.** Upstream fulfilment is asynchronous (FR-4.3, FR-4.4). Design "we're on it" states with a clear expectation of timing and a route to support.

---

## 7. Requirement → role ownership matrix

`●` primary owner · `○` contributes

| Requirement area | Frontend | Backend | DBA | UI/UX |
|---|:--:|:--:|:--:|:--:|
| 2.1 Accounts & auth (FR-1.x) | ● | ● | ○ | ● |
| 2.2 Wallet & payments (FR-2.x) | ○ | ● | ● | ● |
| 2.3 Catalog & pricing (FR-3.x) | ● | ● | ● | ● |
| 2.4 Ordering & fulfilment (FR-4.x) | ○ | ● | ○ | ● |
| 2.5 Agent & referral (FR-5.x) | ○ | ● | ● | ○ |
| 2.6 Dashboards (FR-6.x) | ● | ○ | ○ | ● |
| 2.7 Notifications (FR-7.x) | ○ | ● | ○ | ○ |
| 2.8 Reporting & export (FR-8.x) | ● | ● | ● | ○ |
| 3.1 Performance (NFR-1.x) | ● | ● | ● | ○ |
| 3.2 Security (NFR-2.x) | ○ | ● | ● | — |
| 3.3 Reliability (NFR-3.x) | — | ● | ● | ○ |
| 3.4 Usability (NFR-4.x) | ● | ○ | — | ● |
| 3.5 Scalability & maintainability (NFR-5.x) | ○ | ● | ● | — |
| 3.6 Compatibility (NFR-6.x) | ● | ○ | — | ○ |
| 3.7 Legal & compliance (NFR-7.x) | ○ | ○ | ● | ● |

Two rows to notice: **NFR-3.3 (no silent loss of funds)** has no frontend owner at all — it is purely a backend and database guarantee. And **NFR-1.1 (3-second load)** is shared by all four, which means no single person can be held to it alone.

---

## 8. If one person is building this

Realistically, this is a small-team or solo build. Learning everything at once is not viable, so this is the order in which the skills pay off — each stage produces something demonstrable to James.

| Stage | Skills to have working | Outcome |
|---|---|---|
| 0 | NestJS fundamentals — modules, DI, controllers, pipes, guards; the four-layer folder skeleton with an enforced import boundary; validated env config | An empty but correctly shaped project. Doing this *after* features exist means retrofitting, which rarely finishes (NFR-5.1, NFR-5.3) |
| 1 | Postgres modelling + constraints + migrations; DTO validation; bcrypt + JWT via Passport; RBAC guards; first use case written end-to-end through all four layers | Users can register, log in, and be told apart by role (FR-1.x, NFR-2.1, NFR-2.5) — and the team has one worked example to copy |
| 2 | React + routing + forms + server-state; Tailwind mobile-first | A working storefront and login against the real API |
| 3 | **Transactions + row locking + ledger design + idempotency + the `UnitOfWork` port** | A wallet that cannot be overdrawn or double-debited (FR-2.x, NFR-3.3) — do not move past this stage until concurrency tests pass |
| 4 | Paystack init + webhook signature verification + reconciliation | Real money can enter the wallet safely (FR-2.2) |
| 5 | Data-driven catalog + per-agent pricing with a cost-price floor | Agents can set prices and see margin (FR-3.x, FR-5.3) |
| 6 | Outbound API integration + order state machine + retry + queue + refund path | Orders actually get fulfilled, and failures refund (FR-4.x, NFR-3.2) |
| 7 | SMS gateway; referral codes and single-level linking behind a settings flag | Notifications and the referral system (FR-5.x, FR-7.x) |
| 8 | Aggregation queries + indexes + charts + CSV export | Dashboards and reporting (FR-6.x, FR-8.x) |
| 9 | Deployment, HTTPS, monitoring, backups with a rehearsed restore | Production-ready against NFR-2.2, NFR-3.1 |

**The one non-negotiable:** stage 3 before stage 4. Do not accept real payments into a wallet whose concurrency behaviour has not been tested. Every other skill gap on this list is recoverable; a corrupted money ledger with live customer balances is not.

---

## 9. Hiring or assessment shortlist

If you are bringing people in rather than building solo, these questions separate people who can do this specific job from people with a matching CV.

**Backend candidate (NestJS + Clean Architecture)**
- "Two purchase requests hit the same wallet at the same moment and the balance covers only one. Walk me through the SQL that guarantees exactly one succeeds."
- "Paystack delivers the same webhook three times. What in your code makes that safe?"
- "You debited the wallet, called the provider, and the request timed out. You do not know whether it succeeded. What happens next?"
- "Your `PlaceOrder` use case must debit a wallet and write a ledger row atomically, but it is not allowed to know about Prisma or TypeORM. How do you manage the transaction?" *(This is the question that separates people who have actually shipped Clean Architecture from people who have read about it.)*
- "Paystack signs its webhook over the raw request body. What do you have to change in a default NestJS app for verification to work?"
- "Where does the DataHub GH HTTP client live, and how do you test the order flow without it?"

**DBA candidate**
- "NFR-2.6 says regular users must not be able to edit or delete financial records. How do you enforce that in Postgres itself, not in application code?"
- "The admin updates a cost price today. Why must yesterday's reports not change, and how does your schema guarantee that?"

**Frontend candidate**
- "The Paystack popup reports success. Do you update the displayed balance? Why or why not?"
- "How do you get a React dashboard to load in under 3 seconds on 4G?"

**UI/UX candidate**
- "Design the returning-customer purchase flow in four steps. Which step would you cut first if it were five?"
- "Write the error message for a failed order where the wallet has already been refunded."

---

## 10. Open items to confirm before development

These come from §4 of the requirements document and are unresolved dependencies rather than skill gaps — but they change who is needed and when.

1. **DataHub GH API documentation** — auth method, product coverage, and whether status arrives by webhook or requires polling. This determines a meaningful slice of the backend workload (FR-4.3, FR-4.4).
2. **Result checker voucher supply** — whether DataHub GH provides BECE/WASSCE vouchers or a second supplier is needed, and whether vouchers are pre-purchased into inventory or fetched on demand. Pre-purchased inventory adds stock management to the schema (FR-4.7).
3. **SMS gateway choice and cost per message** — affects FR-4.5, FR-4.7 and FR-7.x, and whether SMS or on-screen is the primary channel.
4. **Paystack account status** — a live Ghanaian business account with MoMo enabled is a prerequisite for FR-2.2 and NFR-6.2.
5. **Withdrawal payout mechanism for v1** — FR-2.6 says manual approval, but the actual money movement (admin sends MoMo by hand?) needs defining before FR-6.4 can be built.

---

*Companion to `functional-nonfunctional-requirements.md`. Update both together if requirements change.*
