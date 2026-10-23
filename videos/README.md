# Walkthrough videos

One scripted screen recording per role, narrated by a free neural voice.

    npm install
    python -m pip install edge-tts
    npm run agent        # writes out/agent.mp4 and out/agent.script.txt

The app (http://localhost:5173) and its API must be running, against a database
that holds only demo data, never real customers. Log in details come from
DEMO_EMAIL and DEMO_PASSWORD (defaults: the seeded demo agent). Set VOICE to
change the voice, for example `VOICE=en-US-AriaNeural`.

To change what a video says or shows, edit `scenes/<role>.mjs` and rebuild.

## The admin series

Eight chapters, `npm run admin-1-start` to `npm run admin-8-settings` (or `npm run admin:all` for all of them). `npm run admin:combine` joins whatever is in out/ into one video, out/admin-complete.mp4, with fades and chapter markers. The chapters are only read, never changed.

The chapters need the demo database (see scenes/_admin.mjs for the two logins). The platform owner chapters, 5 to 8, sign in as the superadmin.

## The invoicing app series

Five chapters on running the invoicing (billing) app for any app that uses it. Only the
invoicing app is shown; what a connected app does is described in general terms.

    npm run billing-1-end-to-end   # the whole loop: client, project, connect, subscription, invoices, payment
    npm run billing-2-stages       # every stage of an unpaid bill
    npm run billing-3-money        # one-time items, part and over payments, credit, waive, refund, upfront, discounts
    npm run billing-4-changes      # installments, cancel, reactivate, pause, courtesy, exempt, trial, moving a project
    npm run billing-5-safety       # billing down, report only, project settings, roles, two-factor, audit, health, exports
    npm run billing:all            # all five, one after another
    npm run billing:combine        # joins them into out/billing-complete.mp4 with chapters

They record against a LOCAL copy only: the invoicing app on http://localhost:3100 started with
`npm run dev:local` (its local file database, never Turso), and the shop API on :3001 for the
licence checks. Shared setup is in `scenes/_billing.mjs`: it resets the sample project
("Example App") before each chapter, clears the local sign-in limit and any leftover two-factor
setting, and expects the invoicing app checked out at the path in `DIAG` there. Run one chapter
at a time; two recordings at once would fight over the same local data.
