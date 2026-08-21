# Deploying the API

## Why this cannot go on Vercel

The front end can. This cannot, and it is worth being precise about why, because
the failure is silent and it costs money.

Two pieces of this platform run on timers:

- `src/orders/fulfilment.service.ts` dispatches an order through a `setTimeout`
  after the payment confirms.
- `src/supplier/reconciler.service.ts` sweeps every 60 seconds for orders whose
  DataHub callback never arrived, payments abandoned at the checkout, and number
  approvals that have been held too long and should be refunded.

A serverless function is frozen the moment it returns its response. On that
model the checkout would take a customer's money, answer "processing", and then
be killed before the dispatch timer fires — **the bundle is never ordered, and
nothing sweeps up afterwards to notice.** The reconciler would never run at all,
so a single dropped webhook would strand a paid order forever.

Vercel Cron does not close the gap: on the Hobby plan it fires once a day, and
the reconciler's whole purpose is to catch a lost webhook within a minute or two.

So the API wants a host that keeps a process alive. Render, Railway and Fly.io
all do. `Dockerfile` and `../render.yaml` are set up for that.

## The database

Any managed Postgres works — the app needs one `DATABASE_URL` and nothing else.
Neon, Supabase, Railway and Render Postgres are all fine. Two things matter:

- **Postgres 17**, matching `docker-compose.yml`. This schema uses enums heavily
  and has had values added to live enums repeatedly.
- **Automated backups.** This database holds the ledger, every agent's balance
  and every payment reference. Do not put it on a free tier that has no backups.

Append `?sslmode=require` to the connection string. Managed providers expect it
and most reject a plain connection anyway.

## First deploy, in order

```
1  prisma migrate deploy      # 20 migrations
2  npm run constraints:prod   # the 13 CHECK constraints — see below
3  npm run seed               # settings only; creates no people
4  start the API              # SUPERADMIN_EMAIL gets a one-time setup link
5  follow the link, set a password
6  Platform team → Add an admin   (their link goes to their own inbox)
7  Admin → Supplier → Sync from DataHub
8  Admin → Prices → set the agent and walk-up markup
```

Steps 1 and 2 are what `npm run release` does, and `npm run start:prod` runs
`release` before serving. The Dockerfile's `CMD` is `start:prod`, so a container
migrates and applies constraints on every boot and refuses to serve if either
fails. That is deliberate: an API answering requests against a half-migrated
money database is worse than one that is down and says so.

### Do not skip step 2

`scripts/constraints.sql` holds 13 CHECK constraints that Prisma's schema
language cannot express — a balance that can never go negative, a ledger entry
whose sign has to match its type, a product that cannot be priced below what it
costs. Its own header calls them the last line of defence, and they are: the
application already refuses to overdraw a wallet, and these turn a bug in that
code into a failed statement instead of lost money.

Until now they were only reachable through `npm run constraints`, which shells
into the local Docker container — so on a managed database they would simply
never have been applied. `constraints:prod` applies the same file over
`DATABASE_URL`, which works anywhere. The file is idempotent, so running it on
every deploy is safe and is what `release` does.

## Environment

The app refuses to boot in production without these — see the `validate` block
in `src/app.module.ts`:

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | with `?sslmode=require` |
| `JWT_SECRET` | 32+ characters in production |
| `CORS_ORIGINS` | the Vercel domain, exactly |
| `PUBLIC_APP_URL` | the Vercel domain — Paystack returns customers here, and password links are built from it |
| `SUPERADMIN_EMAIL` | who receives the first setup link |

`PAYSTACK_SECRET_KEY` starting `sk_test` is also refused in production, because
no real money would be collected.

`ALLOW_TUNNEL_ORIGINS=true` re-enables ngrok and trycloudflare origins in
production. It exists for the window before the real domain is pointed. Turn it
off afterwards: with it on, any site hosted on those services can call this API
from a browser. The API logs a warning at boot while it is set.

## After the API is live

**Register both webhooks.** Neither is registered yet, and until they are the
platform only settles when the reconciler polls — which works, but slowly.

- Paystack → `https://your-api-host/api/payments/paystack/webhook`
- DataHub → `https://your-api-host/api/webhooks/datahub/<DATAHUB_WEBHOOK_SECRET>`

**Check the Paystack transfer OTP setting.** If OTP is on, every payout and every
refund stops and waits for a code. The code handles this and says so in the
admin UI, but it means no automatic withdrawals.

**Top up both floats.** DataHub's balance is what buys the bundles; Paystack's
balance is what pays agent withdrawals and customer refunds. Both were empty at
the time of writing, and an empty float fails every order.

## Known gaps

- **No SMS.** Several customer-facing messages promise a text on delivery. There
  is no gateway wired up, so those promises are not kept. Needs Hubtel, mNotify
  or Arkesel.
- **DataHub `/beneficiaries` returns 502.** MTN numbers have to be pre-approved
  and their submission endpoint is down, which is why the approval-hold and
  refund path exists.
- **`npm audit` reports 3 high advisories** in `deepmerge-ts`, reached only
  through the Prisma CLI's config loader. It runs at migrate time, not per
  request, and the fix is a Prisma major downgrade. Reassess when Prisma ships a
  patched `@prisma/config`.
