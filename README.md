# Kess Cloud

The Kess Media platform for building, hosting and caring for client websites, with a portal for clients.

One Node app, no external services. SQLite holds the data, and the app itself hosts the client sites.

## Try it in your browser (nothing to install)

1. Open https://codespaces.new/alexkess/kess-media-cloud while signed in to GitHub (pick the branch if asked).
2. Click **Create codespace**. It takes a minute or two to start.
3. Kess Cloud starts by itself and opens in a new tab. If the tab doesn't open, go to the **Ports** tab at the bottom and click the globe icon next to port 8787.
4. Sign in with `alex@kess.media` / `kessmedia-demo-2026` (agency) or `sam@harbourphysio.example` / `client-demo-2026` (client).

Codespaces is free up to a monthly allowance on personal GitHub accounts. Stop it from github.com/codespaces when you're done; it also stops by itself after 30 minutes idle.

## Quick start on your computer

1. Install **Node.js 22 LTS or newer** from https://nodejs.org. Check it with `node -v` (it should print v22.13 or higher).
2. Unzip `kess-cloud.zip` somewhere, e.g. your Documents folder.
3. Open Terminal (Mac) or PowerShell (Windows) in that folder:
   ```bash
   cd ~/Documents/kess-cloud
   ```
   ```bash
   npm run dev
   ```
4. Open http://localhost:8787 and sign in with the demo logins under "Run it" below.

There's nothing to `npm install`. Data is saved in the `data/` folder; delete that folder to start fresh.

## What it does

### For Kess Media (agency console)
- **Dashboard:** recurring revenue from care plans, outstanding and overdue invoices, open requests, pipeline by stage, versions waiting on approval, sites that are down, recent activity.
- **Clients:** a light CRM with contacts, ABN, internal notes (never shown to clients), sites, invoices and activity, plus portal invites by one-time link.
- **Sites:** start a new client site from a template (Service business, Portfolio, Not-for-profit, Landing page). Track it through the stages lead → proposal → design → build → review → live → care.
- **Page editor:** section-based editing (hero, text, features, stats, gallery, testimonials, FAQ, call to action, contact form). It has a live desktop/mobile preview, autosave, page settings, reordering, and an image picker that uploads to Files.
- **Design:** theme presets (Kess, Ocean, Clay, Mono), colours, fonts and corner radius.
- **Versions and approvals:** "Send for approval" snapshots the draft and notifies the client. The client approves it (which publishes) or requests changes (which opens a feedback ticket). You can publish directly, roll back to any version, or restore a version into the draft.
- **Hosting:** published sites are served at `/s/<slug>/` and on the client's own domain (point DNS at the server). `sitemap.xml`, `robots.txt`, canonical tags, Open Graph tags and schema.org JSON-LD are generated automatically.
- **Astro + Sanity export:** download any version as an Astro project with a Sanity Studio schema and an import script. It uses the same renderer as the platform, so what the client approved is what Astro builds, and forms keep posting back to Kess Cloud.
- **Live site feedback:** open any draft, version or live page in comment mode. Pin a comment to anything, highlight text, or circle and draw on the page. Pins and highlights stay attached to the right content on desktop and mobile. Threads have replies and resolve. Turn any comment into a request with one click. **Review links** let people without an account (a client's manager or board) view the draft or live site and comment by name; links expire or can be turned off.
- **SEO check:** per-page score for titles, meta descriptions, H1s, image alt text, unsafe links and thin content.
- **Requests:** a kanban board of change requests, bugs and questions. Each one has internal notes, time logging, hour estimates (internal), and quotes (ex GST) the client can approve or decline.
- **Billing:** tax invoices with GST, a printable branded PDF view, draft → sent → paid/void, and one-click monthly care-plan invoices. Approved, billable request quotes are added to those invoices automatically.
- **Care plans:** plan pricing and features, plus included hours used this month per site.
- **Estimates:** ballpark builder for proposals. Hours × internal rate are rounded outward into ranges ex GST. "Copy for proposal" gives client-safe text with no hourly rate, and the "pricing is negotiable" line is built in, following the kess-proposal rules.
- **Uptime and SSL monitoring** every 5 minutes, with alerts when a site goes down or comes back.
- **Notifications** in the app, by email (Resend or Postmark), and to an optional Slack/Make/Zapier webhook. Without an email provider, every email is kept in an outbox you can read under Settings.
- **Card payments:** "Pay by card" on sent invoices through Stripe Checkout. A signed webhook marks the invoice paid and alerts the team; the amount is checked against the invoice.
- **Backups:** every night, a consistent database snapshot plus all uploaded files, with the newest 14 kept. Optional off-site copy to Cloudflare R2 / S3 / Backblaze. "Back up now" and downloads are under Settings.
- **Overdue reminders:** clients get a friendly reminder once a week while an invoice is overdue.
- **Two-factor sign-in** (authenticator app) for anyone, plus "Forgot password" by email. A reset link signs out every session and can't be used to skip two-factor.

### Photo + video studio (replaces Studio Ninja)
- **Enquiries:** a hosted enquiry form (`/enquiry`, embeddable on kess.media) creates the client and a shoot, notifies the team and sends a friendly reply.
- **Quotes from packages**, plus custom lines and optional add-ons the client can tick.
- **Agreements with e-signature:** templates with merge fields; the client signs with a finger or mouse on their booking page. The record keeps their name, time, IP address, browser and a fingerprint of the exact text. Signed agreements never change.
- **Payment plans:** e.g. 50% deposit on booking and the balance 14 days before the shoot. Invoices are created on booking, emailed on their date with a "pay by card" link (Stripe) or bank details, reminded 3 days before due and weekly when overdue. Moving the shoot date moves them.
- **Workflows:** automatic client emails and team tasks relative to the booking or shoot date (questionnaire, confirm details, back up cards, deliver, ask for a review).
- **Questionnaires** the client fills in on their booking page, with save-for-later.
- **Calendar** with holds and bookings, plus a private subscription link for Google, Apple or Outlook Calendar.
- **Delivery** via your existing providers: paste a Dropbox, Google Drive, Picflow, Vimeo, Frame.io, Pic-Time, Pixieset, WeTransfer or YouTube link; Vimeo and YouTube play right on the client's page.
- **Each team member sends as themselves:** quotes, agreements and invoices for Georgia's shoots come from Georgia and replies go to her inbox (Settings > Sending emails as you).
- **Clients need no account:** everything happens on a private booking page (`/j/<link>`) and invoice page (`/i/<link>`).

### Socials (moved over from kess-socials)
The daily social posts for Kess Gallery, Kess Media and Alex Kess, ported from the Vercel app (kess-socials, the Posts tab of its Studio). Agency users only, under **Socials** in the menu.
- **Cards:** three a day per brand at 07:00 Sydney. New items first, then never posted, then least posted. A posted image rests 90 days; Later and Draft rest it 14 days. One card per project a day, and for Kess Media one per client. Cards stay in a 7 day roster (`#/socials?date=YYYY-MM-DD`, Previous day and Next day); while a card waits it cannot be suggested again, and a card nobody posted returns to the pile after 7 days, ranked a little lower.
- **Later, Never, Open.** Never retires that image (Restore on the Ledger). Kess Gallery products always lead with their first image, so Later and Never act on the whole print.
- **Open a card:** a brief with Regenerate (Claude writes one caption per account in the brand's voice, keeps your edits unless "overwrite my edits" is ticked, and never lets an em dash through), carousel options (other photos of the product or project, map posters and Studio mockups) with Make primary, one editable caption per account, "Use for the other N accounts" (your words copied as written; only hashtags, @handles and length change per platform), and tag chips from the curated mention list only.
- **Links:** the plain link goes in the caption on Facebook, Threads, Bluesky, Mastodon, Google Business and Pinterest; never on Instagram; as the first comment on LinkedIn and X.
- **Posting windows:** Schedule offers morning, midday and night. Each platform goes out at its own minute, never on a quarter hour, with the brands offset (Gallery +0, Alex Kess +11, Kess Media +23 minutes) and a second account on one platform 6 minutes after the first. LinkedIn is unticked for weekend windows. A window that already holds one of the brand's scheduled posts is greyed with the title holding it, and the server checks again at send time. "Other time" sends every platform at one moment.
- **Draft, Schedule, Post now** go to Publer: a lock, images uploaded one at a time, the Publer job id stored before waiting, never submitted twice on a retry. If Publer cannot confirm, the card says a post may already exist, with "I checked Publer, clear and retry". A send stuck for 10 minutes can be retried. Schedule and Post now count every image as posted; Draft rests them 14 days.
- **Post something else:** search any print, image or essay of a brand and add it to today. Rest rules do not apply; a card already waiting is never doubled.
- **Ledger** (`#/socials/ledger`): the last 30 days per brand, the dry runs, and the retired list with Restore. The owner can also run the sync, suggest or caption top-up by hand there.
- **Sources:** the nightly sync (20:00 Sydney) reads Kess Gallery from Shopify (client credentials, with map posters from Shopify Files) and kess.media and alexkess.com from their public Sanity datasets. Items gone from a source are retired and come back if they reappear; Never stays retired; Studio mockups and Dropbox photos are never touched.

**Safety switches.** Both default to off, so Kess Cloud can run beside the Vercel app without posting twice:
- `SOCIALS_SEND=1` is the only way anything reaches Publer. Without it every Draft, Schedule and Post now is a **dry run**: the same checks run and the exact Publer requests are built and kept on the card ("Dry run: sending is off"), but nothing is uploaded or submitted, and the card, its rotation and its decision stay as they were.
- `SOCIALS_JOBS=1` turns on the nightly sync (20:00), the daily suggest (07:00) and the caption top-up (07:20), Sydney time. When the daily cards are made, the owner gets an in-app "Today's socials are ready" notice (by email too with `SOCIALS_NOTIFY_EMAIL=1`). There is no digest email.

Code: `server/lib/socials/` (one file per area, ported from `kess-socials/src/lib`), `server/api/socials.js`, `public/js/views/socials.js`, `scripts/import-socials-from-supabase.mjs`.

#### Switching socials over from Vercel
Never have both apps live: only one may send to Publer and only one may run the daily jobs.
1. **Import the data.** On a machine that can reach the Kess Cloud database file (the server over ssh, or your Mac for a local copy), from the Kess Cloud folder:
   ```bash
   node --env-file=../kess-socials/.env.local scripts/import-socials-from-supabase.mjs --db ./data/kess-cloud.db --dry
   node --env-file=../kess-socials/.env.local scripts/import-socials-from-supabase.mjs --db ./data/kess-cloud.db
   ```
   It needs `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` and only reads from Supabase. It copies brand accounts and voice cards, mentions, every content item (including Dropbox photos and Studio mockups; their images stay in Supabase storage), suggestion history, posts and captions. Safe to re-run.
2. **Set the keys** on the Kess Cloud server: `ANTHROPIC_API_KEY`, `PUBLER_API_KEY`, `PUBLER_WORKSPACE_ID`, `SHOPIFY_STORE`, `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET` (same values as on Vercel). Keep `SOCIALS_SEND=0` and `SOCIALS_JOBS=0`. Restart.
3. **Compare for a few days.** Keep posting from Vercel. Each morning, re-run the import, open Socials in Kess Cloud and check the cards match, then press Draft or Schedule on a card in Kess Cloud: the dry run shows the exact Publer request, to compare with what Vercel sent (Ledger, Dry runs). Do not press "Suggest today" in Kess Cloud during this time; the import brings Vercel's cards.
4. **Switch,** in one sitting, after the day's posts are done:
   - In Vercel, turn off the three crons (Settings, Cron Jobs, or remove them from `vercel.json` and redeploy) so kess-socials stops syncing, suggesting and emailing.
   - Run the import one last time.
   - On Kess Cloud set `SOCIALS_SEND=1` and `SOCIALS_JOBS=1` and restart.
   - From now on post only from Kess Cloud. Leave the Vercel app up for a while to look things up, but do not post from it.
5. **To roll back,** set `SOCIALS_SEND=0` and `SOCIALS_JOBS=0` on Kess Cloud first, then turn the Vercel crons back on.

**Dropbox photos (Kess Media), later.** The Vercel app's `scripts/import-dropbox.mts` runs on Alex's Mac and writes Dropbox photos into Supabase (source `dropbox`); the import above copies those rows. It is not ported yet. To point it at Kess Cloud, keep its folder walk, hashing, client lookup and resize, and swap its two outputs: upload each JPEG to Kess Cloud (for example a small owner-only `POST /api/socials/dropbox` that stores the file under `data/` and returns its URL, or keep using the Supabase `studio` bucket) and send the rows as `SourceItem`s (source `dropbox`, `sourceId` `dropbox:<sha1>`) to that endpoint, which upserts them with the store's `upsertItems` and retires `dropbox` rows that left the folder. The sync already leaves `dropbox` rows alone, and the roster shows their client and folder.

### For clients (portal)
- See their websites, live status, uptime and SSL.
- **Approve new versions** or request changes in plain words.
- **Mark up the site:** pin comments, highlight text and draw on pages, and share review links with colleagues.
- **Edit their own content** (text and images only; the structure stays locked) and send edits to Kess Media for review.
- **Enquiries inbox:** contact-form messages from their site, with reply, archive, spam and CSV export.
- **Analytics** without cookies: page views, top pages, referrers and enquiry rate. No consent banner needed.
- **Monthly report** on the 1st: visitors, enquiries, uptime, care hours and work done, as a branded page they can print or save as PDF.
- **Pay invoices by card**, or see the bank details.
- **Requests:** ask for changes, chat with the team, approve quotes.
- **Invoices:** view and print/download, with bank details.
- **Files:** upload photos, logos and documents for their site.

## Run it

Needs Node 22.13 or newer. There are no npm dependencies to install.

```bash
npm run dev
```

Opens on http://localhost:8787 with demo data:
- Agency: `alex@kess.media` / `kessmedia-demo-2026`
- Client: `sam@harbourphysio.example` / `client-demo-2026`
- Staff (studio): `georgia@kess.media` / `georgia-demo-2026`

For production:

```bash
cp .env.example .env   # set PUBLIC_URL, KESS_OWNER_PASSWORD
npm start
```

On first start, if there is no owner account, it creates one from `KESS_OWNER_EMAIL` / `KESS_OWNER_PASSWORD`, or prints a temporary password.

### Putting it online

See **[deploy/README.md](deploy/README.md)**. One Sydney server, a setup script, and Caddy for automatic HTTPS on Kess Cloud and every client domain.

### Docker

```bash
docker build -t kess-cloud .
```

```bash
docker run -p 8787:8787 -v kess-data:/data -e PUBLIC_URL=https://cloud.kess.media -e TRUST_PROXY=1 -e KESS_OWNER_PASSWORD=change-me-please kess-cloud
```

It runs on any host that gives you a persistent volume: Fly.io, Railway, Render, a VPS. Put it behind Cloudflare or Caddy for HTTPS. For client domains, add each domain in the site's Settings and point a CNAME at the server. Your proxy must issue certificates for those domains (Caddy on-demand TLS or Cloudflare for SaaS).

## Tests

```bash
npm test
```

96 tests. They cover: auth and the CSRF guard; client data isolation (no internal notes, hour estimates, draft invoices or other clients' sites); the client edit lock; the approve and request-changes flows; quotes; the public form, honeypot and analytics; custom-domain hosting with HTML escaping; tarball validity of the Astro export; estimate rounding and rate secrecy; care-invoice de-duplication and GST maths; the asset type allowlist and sandbox headers; TOTP against the RFC 4226/6238 test vectors and the full two-factor login; password reset not bypassing two-factor; forgot-password privacy; email opt-out; Stripe signature checks (wrong secret, replay, amount mismatch, duplicate delivery); backup restore round-trip; S3 signing against the AWS documented example; weekly reminders; once-a-month reports; report access control; the TLS check that stops certificates being issued for domains that aren't yours; feedback permissions, input cleaning, review link expiry and revocation, guest privacy; studio payment plan maths, sending as staff, the full quote → sign → book → invoice flow, scheduled invoices and reminders, workflow emails, calendar feed, enquiries; socials rotation, posting windows, captions (em dash check and retry), conform, links, mentions, Publer payloads, send safety (lock, stored job id, no double submit, stuck sends), the dry run and the proof that nothing reaches Publer without `SOCIALS_SEND=1`, the daily jobs only with `SOCIALS_JOBS=1`, the Shopify and Sanity sources, and the Supabase import.

## Layout

```
shared/sections.js    section schema + renderer + SEO audit (used by server, editor and Astro export)
shared/templates.js   starter sites
server/app.js         HTTP server, hosting, previews
server/api/*.js       REST API (auth, clients, sites, requests, billing, misc, public)
server/lib/*.js       auth, services (publishing, invoices, estimates), monitor, Astro export, tar
server/lib/socials/   social posts (rotation, windows, captions, Publer, sources, import)
scripts/              import-socials-from-supabase.mjs
public/               the console + portal (vanilla JS modules, no build step)
test/                 node:test suite
```

## Connecting services

All optional, set as environment variables (see `.env.example`). Settings > Integrations shows what is connected.

| Feature | Variables | Where to get them |
|---|---|---|
| Email | `MAIL_PROVIDER` (`resend` or `postmark`), `MAIL_API_KEY`, `MAIL_FROM` | resend.com or postmarkapp.com, after verifying your sending domain |
| Staff send from their own address | `MAIL_VERIFIED_DOMAINS` (e.g. `kess.media`) | Verify the domain with the email provider; then georgia@kess.media sends as herself |
| Card payments | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Stripe dashboard > Developers. Add the webhook URL shown in Settings |
| Off-site backups | `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_KEY_ID`, `BACKUP_S3_SECRET` | Cloudflare R2 > Manage API tokens (S3 compatible) |
| Socials captions | `ANTHROPIC_API_KEY` (optional `SOCIALS_CAPTION_MODEL`, `ANTHROPIC_WORKSPACE_ID`) | console.anthropic.com > API keys |
| Socials posting | `PUBLER_API_KEY`, `PUBLER_WORKSPACE_ID`, and `SOCIALS_SEND=1` to really send | Publer > Settings > API (same values as the Vercel app) |
| Socials sources | `SHOPIFY_STORE`, `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, and `SOCIALS_JOBS=1` for the daily jobs | Shopify Dev Dashboard app (same values as the Vercel app) |

## Not built yet (good next steps)
- **One-click deploys** to Cloudflare Pages or Netlify (today: built-in hosting, or download the Astro export).
- **Automatic HTTPS for client domains** inside the app (today: handled by your proxy, e.g. Caddy on-demand TLS).
- **Accounting sync** of invoices and payments to Xero.
