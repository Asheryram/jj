# Deploying to the AmaliTech infra server

This repository deploys as **two independent services**: the Vite frontend (`web`) and the NestJS API (`api`), built from
`frontend/` and `backend/`. Everything the platform needs to know is in **`.infradeploy/infra.yml`** (the older
`.deploy/manifest.env` and `.deploy/compose.extra.yml` are gone). The frontend uses runtime configuration to call the matching
environment's API, so the same image works for production, staging, develop and pull-request previews.

## One-time setup

1. **Register the repository** (the name must equal `name:` in `infra.yml`; a token is recommended, a private repo needs one):

   ```bash
   sudo -u deploy infra project add jkbk --repo Asheryram/jj --gh-token <token>
   ```

   In the console (Access) assign the project to its organization. For deploys from GitHub Actions (instead of the
   server-side watcher) store the printed `INFRA_WEBHOOK_URL` and `INFRA_WEBHOOK_SECRET` as repository Actions secrets,
   and allow reusable workflows from `Asheryram/jj` in the infra repository (Settings → Actions → General → Access).
2. **Create the two databases** for each environment: console → open the environment → **Databases → Create database**
   (`DATABASE_URL` and `ANALYTICS_DATABASE_URL`). They are separate databases on the platform's Postgres, created on
   demand per environment (this replaces the old `analytics-db` sidecar container). The API entrypoint applies the Prisma
   migrations and SQL constraints before it serves traffic, so there is no `migrate:` step. `DIRECT_URL` (Prisma's direct
   connection) defaults to `DATABASE_URL`; set it explicitly only for a database behind a connection pooler.
3. **Set these variables per environment** in the console (Variables → jkbk). A deploy is held ("blocked", with the
   missing names shown) until they exist:
   - `JWT_SECRET`: unique random secret, at least 32 characters.
   - `SUPERADMIN_EMAIL`: the operator who receives the first setup link.
   - `PAYSTACK_SECRET_KEY`: a live key in production. The API deliberately refuses to start there with a test key.
4. For real fulfillment configure the production DataHub/GMPL provider credentials and live-mode flags, and either Resend or
   SMTP for setup, password-reset and invitation emails.

`PUBLIC_APP_URL` and `CORS_ORIGINS` default to the frontend's URL for the current environment, and the frontend's `/env.js`
derives the matching API URL, from the injected app/environment/domain values. Set `API_URL`, `PUBLIC_APP_URL` or
`CORS_ORIGINS` explicitly where the platform is reached on a non-standard port (local testing) or with custom domains.

## Deploy

Push to `develop`, `staging` or `main` to deploy to the matching environment. Open or update a pull request to create its
`pr-<number>` preview; closing it destroys the preview and its databases (at most 3 previews at once). Previews require a
sign-in; the API's previews stay open because the preview page calls the API directly from the browser. Production deploys
from `main`: add required reviewers on the "prod" GitHub Environment if it needs approval.

| Environment | Frontend | API |
| --- | --- | --- |
| Production | `https://jkbk.<domain>` | `https://api-jkbk.<domain>` |
| Develop | `https://jkbk-develop.<domain>` | `https://api-jkbk-develop.<domain>` |
| Staging | `https://jkbk-staging.<domain>` | `https://api-jkbk-staging.<domain>` |
| Preview | `https://jkbk-pr-<number>.<domain>` | `https://api-jkbk-pr-<number>.<domain>` |

Never point preview or staging at production data. Back up the production databases (`infra db dump`) before accepting live
payments.

## Images

`infra.yml` uses local image names (`local/jkbk-web`, `local/jkbk-api`) so a server builds them itself from
the commit. For a server that pulls from GitHub's registry, change them to `ghcr.io/asheryram/jj-web` and
`ghcr.io/asheryram/jj-api` (and make sure Actions may publish those packages and the host can pull them).
