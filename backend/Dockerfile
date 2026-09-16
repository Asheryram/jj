# The API needs a process that stays alive.
#
# Not a preference, the platform schedules work on timers. Orders are dispatched
# by a `setTimeout` in fulfilment.service.ts, and reconciler.service.ts sweeps
# every 60 seconds for payments whose webhook never arrived and approval holds
# that have expired. A serverless function is frozen the moment it returns a
# response, so on that model a customer would be charged and the bundle never
# ordered. Hence a long-running container.

# ── build ───────────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app

# openssl is Prisma's runtime requirement on musl; without it the query engine
# cannot load and every request fails at the database.
RUN apk add --no-cache openssl

# Dependencies first, so a source-only change does not reinstall the world.
COPY package.json package-lock.json ./
RUN npm ci

# The schema has to be in place before `prisma generate`, and the generated
# client is what the TypeScript build type-checks against. Two schemas, two
# databases: the analytics warehouse is never the same database as the main
# one, see prisma-analytics/schema.prisma's own comment for why.
COPY prisma ./prisma
COPY prisma-analytics ./prisma-analytics
RUN npx prisma generate
RUN npx prisma generate --schema prisma-analytics/schema.prisma

COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npm run build

# Drop the build-only packages from the tree we are about to copy forward.
# `prisma` survives this because it is a real dependency: `migrate deploy` and
# `db execute` both run at container start.
RUN npm prune --omit=dev

# `npm prune` just deleted `node_modules/@prisma-analytics/client` along with
# the dev dependencies: unlike `node_modules/@prisma/client`, it has no entry
# of its own in package.json/package-lock.json, prisma's generator is the
# only thing that ever wrote it, so npm's dependency tree has no idea it's
# supposed to survive and drops it as extraneous. It has to exist before
# `npm run build` above (for `tsc` to type-check against), and it has to
# still exist after `npm prune` (for the runtime copy below), so it is
# regenerated a second time here, after pruning, to satisfy both.
RUN npx prisma generate --schema prisma-analytics/schema.prisma

# ── runtime ─────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache openssl

ENV NODE_ENV=production
# 3001 to match backend/.env and the Vite dev proxy. Managed hosts override PORT.
ENV PORT=3001

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
# Both are read at container start, not at build time: the migrations by
# `migrate deploy`, the SQL by `constraints:prod`.
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma-analytics ./prisma-analytics
COPY scripts/constraints.sql ./scripts/constraints.sql
COPY scripts/analytics-migrate-deploy.mjs ./scripts/analytics-migrate-deploy.mjs

# Not root. A container that only ever needs to read its own code has no reason
# to be able to write to it.
USER node

EXPOSE 3001

# `start:prod` is migrate → constraints → serve, in that order and failing
# closed. If a migration fails the container does not start, which is the
# behaviour you want: an API serving requests against a half-migrated money
# database is worse than an API that is down and says so.
CMD ["npm", "run", "start:prod"]
