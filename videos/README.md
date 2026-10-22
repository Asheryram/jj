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
