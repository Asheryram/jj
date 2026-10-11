# Deploying to the AmaliTech infra server

This repository deploys as an app-kit `split` project: the Vite frontend and
NestJS API are built as separate images from `frontend/` and `backend/`. The
frontend uses runtime configuration to call the matching environment's API,
so the same image tag works for production, staging, develop, and pull-request
previews.

## One-time server and GitHub setup

1. Ask the infra operator to register the repository:

   ```bash
   sudo -u deploy infra project add jkbk-datahub --repo Asheryram/jj --envs preview,develop,staging,prod
   ```

   Store the resulting `INFRA_WEBHOOK_URL` and `INFRA_WEBHOOK_SECRET` as
   repository Actions secrets. Do not put the webhook secret in Git.
2. In the infra repository's GitHub settings, allow reusable workflows from
   `Asheryram/jj` (Actions → General → Access).
3. Ensure GitHub Actions can publish the repository's `ghcr.io/asheryram/jj`
   package and that the infra host can pull it.
4. Configure these required `api` runtime variables separately for each
   environment in the Infra Console:
   - `DATABASE_URL`: that environment's primary PostgreSQL connection.
   - `DIRECT_URL`: direct, un-pooled connection to the same primary database;
     Prisma uses this for safe migrations.
   - `ANALYTICS_DATABASE_URL`: a different PostgreSQL database for analytics.
   - `JWT_SECRET`: unique random secret, at least 32 characters.
   - `SUPERADMIN_EMAIL`: the operator who receives the first setup link.
   - `PAYSTACK_SECRET_KEY`: a live Paystack secret key for production. The API
     deliberately refuses to start in production with a test key.

   The backend image applies Prisma migrations and SQL constraints before it
   serves traffic. `MIGRATE_CMD` is intentionally empty to avoid running those
   migrations a second time in the app-kit deploy job.
5. For real fulfillment, configure the production DataHub/GMPL provider
   credentials and live-mode flags. Configure either Resend or SMTP for setup,
   password-reset, and admin invitation emails.

`PUBLIC_APP_URL` and `CORS_ORIGINS` default to the frontend URL for the current
infra environment. The frontend's `/env.js` derives its matching API URL from
the injected app/environment/domain values. Explicit per-environment settings
can override these defaults where custom domains are used.

## Deploy

Push to `develop`, `staging`, or `main` to deploy to the matching environment.
Open or update a pull request to create its `pr-<number>` preview; closing that
pull request destroys the preview. Production deploys from `main`, so configure
GitHub Environment protection/reviewers if production approval is required.

The application hostnames follow the infra app-kit convention:

| Environment | Frontend | API |
| --- | --- | --- |
| Production | `https://jkbk-datahub.<infra-domain>` | `https://api-jkbk-datahub.<infra-domain>` |
| Develop | `https://jkbk-datahub-develop.<infra-domain>` | `https://api-jkbk-datahub-develop.<infra-domain>` |
| Staging | `https://jkbk-datahub-staging.<infra-domain>` | `https://api-jkbk-datahub-staging.<infra-domain>` |
| Preview | `https://jkbk-datahub-pr-<number>.<infra-domain>` | `https://api-jkbk-datahub-pr-<number>.<infra-domain>` |

The infra profile provides a local per-environment Postgres database if desired;
keep the analytics database separate. Do not point preview/staging at production
data. Configure backups before accepting live payments.
