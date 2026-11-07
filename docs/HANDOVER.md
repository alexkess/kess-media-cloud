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

## Status on 07/11/2026 (first session on Alex's Mac)

- **Server:** all Ubuntu updates installed (kernel 6.8.0-149), rebooted, app on `main` 8fb3245 and healthy. The Mac's `~/.ssh/id_ed25519` key is in root's `authorized_keys`, so `ssh root@103.100.37.83` needs no password. Root password login is still on; turn it off once nobody needs it. Ubuntu 26.04 is offered; leave it for the Sydney move.
- **Email:** done. Resend is live for `kess.media` (DNS uses CNAMEs `send` and `rsend` plus TXT `resend._domainkey`), `MAIL_FROM=Kess Media <alex@kess.media>`, test email sent.
- **Socials:** comparison phase. First Supabase import done (2142 items, 445 suggestions and posts, 2791 variants, 0 skipped). Anthropic, Publer and Shopify keys are on the server; `SOCIALS_SEND=0`, `SOCIALS_JOBS=0`. Vercel is still the only app posting.
  - `scripts/` is not in the Docker image. Re-import on the server with:
    `docker compose -f deploy/docker-compose.yml run --rm --no-deps -T -v /opt/kess-cloud/scripts:/app/scripts:ro app node --no-warnings=ExperimentalWarning scripts/import-socials-from-supabase.mjs --db /data/kess-cloud.db` (add `--dry` to only report).
  - `kess-socials/.env.local` (from `vercel env pull`) holds `[SENSITIVE]` placeholders, not the real keys. Get keys from each service instead.
  - After switch day: delete `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from the server `.env`, revoke Vercel's Anthropic key, and keep the Supabase project (imported image URLs still point at its storage).
- **Backups from this session:** `/data/backups/pre-socials-import-2026-11-07.db` (in the `kess-data` volume) and `/opt/kess-cloud/.env.bak-2026-11-07`.
- DNS checks from Alex's Mac can be wrong (port 53 is cached or intercepted). Check with Cloudflare DNS over HTTPS or `dig` on the server.

## Open items (in priority order)

1. **First-run on the live server** (Alex): change the setup password, turn on 2FA, fill Settings > Agency (ABN, bank details, invoice prefix that doesn't clash with Xero/Studio Ninja, Public URL `https://cloud.kess.media`), Back up now.
2. ~~**Email via Resend**~~ Done 07/11/2026, see Status above.
3. Invite Georgia (Settings > Team, role Staff); she sets "Sending emails as you".
4. Real prices: care plans, studio packages; lawyer review of the starter agreement (Studio setup > Agreements).
5. Stripe, Xero, Dropbox, Vimeo, R2 backups (docs/INTEGRATIONS.md). Test each with a real account; the code was only tested against stand-ins (see `test/integrations.test.js`), so watch the first real runs:
   - Xero: first invoice push, contact matching, GST totals equal (rounding note is stored on the invoice if they differ), payment recording to the chosen bank account, "paid in Xero" pull.
   - Dropbox: team space path root (`Dropbox-API-Path-Root`), folder template against the real Team Folder layout, file request creation (needs `file_requests.write`).
   - Vimeo: token scopes, unlisted video hash links play in the embed.
6. **Studio Ninja import**: export clients/upcoming shoots as CSV from Studio Ninja and write an importer into `clients`, `jobs`, `job_lines`, and future `invoices` (keep paid history out or mark as paid).
7. **Socials switch-over** (in progress since 07/11/2026: imported, comparing; see Status above and the socials checklist): import from Supabase with the script on the Mac (needs `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from kess-socials `.env.local`), compare side by side with sending off, then switch Publer sending on in Kess Cloud and turn the Vercel crons off. Never both live.
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
