# Handover: Kess Cloud (for Claude Code on Alex's Mac)

Written at the end of the cloud session that built Kess Cloud (Nov 2026). Read `CLAUDE.md` first for the project rules.

## Where things are

| Thing | Where |
|---|---|
| Code | github.com/alexkess/kess-media-cloud (public; consider making private, then the server needs a deploy key for `update.sh`) |
| Live app | https://cloud.kess.media on BinaryLane **Singapore** VPS `103.100.37.83` (Ubuntu 24.04, Docker + Caddy, `/opt/kess-cloud`) |
| DNS | Cloudflare, `cloud` A record, DNS only, low TTL |
| Server settings | `/opt/kess-cloud/.env` on the server (never commit it) |
| Data | Docker volume `kess-data` (SQLite + uploads + nightly backups + `secret.key`) |

## Branches

- `main` (7 Nov 2026) contains everything: websites/portal, care plans, billing, email, Stripe, 2FA, backups, reports, site feedback, photo + video studio, deploy kit, CI, **Xero/Dropbox/Vimeo integrations** and the **Socials** port. 96 tests. `deploy/update.sh` on the server pulls `main`.
- The live server only picks this up after `bash /opt/kess-cloud/deploy/update.sh` (new tables are created automatically).
- Socials ships switched off: nothing reaches Publer unless `SOCIALS_SEND=1`, and the daily jobs need `SOCIALS_JOBS=1`. Follow the switch-over checklist in the README's Socials section; never have Vercel and Kess Cloud both live.
- Xero/Dropbox/Vimeo were tested only against stand-in APIs; watch the first real runs (see Open items).
- `claude/integrations`, `claude/socials` and the older `claude/*` branches are fully merged and can be deleted.

## Open items (in priority order)

1. **First-run on the live server** (Alex): change the setup password, turn on 2FA, fill Settings > Agency (ABN, bank details, invoice prefix that doesn't clash with Xero/Studio Ninja, Public URL `https://cloud.kess.media`), Back up now.
2. **Email via Resend** (docs/INTEGRATIONS.md §1). Until done, nothing is emailed: quotes/invoices only land in the outbox. Blocker for Georgia using the studio with real clients.
3. Invite Georgia (Settings > Team, role Staff); she sets "Sending emails as you".
4. Real prices: care plans, studio packages; lawyer review of the starter agreement (Studio setup > Agreements).
5. Stripe, Xero, Dropbox, Vimeo, R2 backups (docs/INTEGRATIONS.md). Test each with a real account; the code was only tested against stand-ins (see `test/integrations.test.js`), so watch the first real runs:
   - Xero: first invoice push, contact matching, GST totals equal (rounding note is stored on the invoice if they differ), payment recording to the chosen bank account, "paid in Xero" pull.
   - Dropbox: team space path root (`Dropbox-API-Path-Root`), folder template against the real Team Folder layout, file request creation (needs `file_requests.write`).
   - Vimeo: token scopes, unlisted video hash links play in the embed.
6. **Studio Ninja import**: export clients/upcoming shoots as CSV from Studio Ninja and write an importer into `clients`, `jobs`, `job_lines`, and future `invoices` (keep paid history out or mark as paid).
7. **Socials switch-over** (see the socials checklist): import from Supabase with the script on the Mac (needs `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from kess-socials `.env.local`), compare side by side with sending off, then switch Publer sending on in Kess Cloud and turn the Vercel crons off. Never both live.
8. The Mac-side Dropbox photo importer for socials (`kess-socials/scripts/import-dropbox.mts`) still writes to Supabase; point it at Kess Cloud after switch-over (local Claude Code is the right place: it can read the synced Dropbox folder).
9. Move to Sydney when BinaryLane has capacity: `deploy/MOVE-TO-SYDNEY.md`. Only then point client websites at the server.
10. Nice to have: one-click Cloudflare Pages deploy for client sites; Studio Ninja-style mini sessions/booking calendar; contract PDF download.

## Working locally

```bash
git clone https://github.com/alexkess/kess-media-cloud && cd kess-media-cloud
npm run dev        # http://localhost:8787, demo data
npm test           # must stay green
```
Demo logins: `alex@kess.media` / `kessmedia-demo-2026`, `sam@harbourphysio.example` / `client-demo-2026`, `georgia@kess.media` / `georgia-demo-2026`.

To try integrations locally with real accounts, put the keys in your shell env and register `http://localhost:8787/oauth/<provider>/callback` as an extra redirect URI in the Xero/Dropbox app (both allow several).

## Server cheatsheet

```bash
ssh root@103.100.37.83
cd /opt/kess-cloud
docker compose -f deploy/docker-compose.yml ps            # status
docker compose -f deploy/docker-compose.yml logs -f app   # app logs
bash deploy/update.sh                                     # pull main + rebuild + restart
```
