# Deploying the front end to Vercel

A static build. Vercel serves it; the API runs on a host that keeps a process
alive — see `../backend/DEPLOY.md` for why it cannot be serverless.

## Environment variables

Set these in the Vercel project (Settings → Environment Variables). Nothing about
the API lives in `vercel.json`.

| Variable | Value |
| --- | --- |
| `VITE_API_URL` | `https://your-api-host/api` |

**The `/api` on the end is required.** Request paths in `src/lib/api.ts` are
written as `/auth/login`, `/catalogue`, `/orders` — with no prefix — because the
API mounts everything under `api` via `setGlobalPrefix('api')`. Leave it off and
every single request 404s while the site itself loads perfectly, which is a
confusing hour to spend. A trailing slash is stripped for you, so
`https://host/api/` is also fine.

These are **build-time** variables. Vite inlines `import.meta.env` values when it
compiles, so changing one has no effect until you redeploy — it is not read at
runtime.

## Settings in the Vercel dashboard

| Setting | Value |
| --- | --- |
| Root directory | `frontend` |
| Framework preset | Vite |
| Build command | `npm run build` |
| Output directory | `dist` |
| Install command | `npm ci` |

## The API has to allow this origin

Because the browser now calls the API directly rather than through a proxy, every
request is cross-origin and the API decides whether to answer. Set `CORS_ORIGINS`
on the API to the Vercel domain, exactly — scheme included, no trailing slash:

```
CORS_ORIGINS=https://jamesdataconsult.vercel.app
```

Get this wrong and the symptom is not an error page. The site loads, then every
panel sits empty, and the only clue is a CORS message in the browser console.

### Preview deployments

Vercel gives every branch and pull request its own hostname
(`jdc-git-somebranch-you.vercel.app`), and none of those match `CORS_ORIGINS`, so
previews cannot talk to production's API. That is a reasonable default — a
half-finished branch pointed at live money is not something to enable by
accident. If you want working previews, point them at a separate API instance
rather than widening production's CORS.

## What `vercel.json` does

Only two things now: the SPA fallback and response headers.

The `/(.*)` → `/index.html` rewrite is what makes a refresh on `/admin/prices`
work. Without it Vercel looks for a file at that path, finds none, and serves its
own 404 — the classic single-page-app deploy failure.

The headers set `nosniff`, deny framing, trim the referrer, and give hashed
assets a one-year immutable cache. `index.html` is deliberately not cached, so a
deploy takes effect immediately.

## After the first deploy

Set `PUBLIC_APP_URL` on the API to this Vercel domain. Paystack returns every
paying customer to that address and password links are built from it, so while it
still says `localhost` those journeys end nowhere.
