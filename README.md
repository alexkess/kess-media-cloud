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

30 tests. They cover: auth and the CSRF guard; client data isolation (no internal notes, hour estimates, draft invoices or other clients' sites); the client edit lock; the approve and request-changes flows; quotes; the public form, honeypot and analytics; custom-domain hosting with HTML escaping; tarball validity of the Astro export; estimate rounding and rate secrecy; care-invoice de-duplication and GST maths; the asset type allowlist and sandbox headers; TOTP against the RFC 4226/6238 test vectors and the full two-factor login; password reset not bypassing two-factor; forgot-password privacy; email opt-out; Stripe signature checks (wrong secret, replay, amount mismatch, duplicate delivery); backup restore round-trip; S3 signing against the AWS documented example; weekly reminders; once-a-month reports; report access control; the TLS check that stops certificates being issued for domains that aren't yours; feedback permissions, input cleaning, review link expiry and revocation, guest privacy.

## Layout

```
shared/sections.js    section schema + renderer + SEO audit (used by server, editor and Astro export)
shared/templates.js   starter sites
server/app.js         HTTP server, hosting, previews
server/api/*.js       REST API (auth, clients, sites, requests, billing, misc, public)
server/lib/*.js       auth, services (publishing, invoices, estimates), monitor, Astro export, tar
public/               the console + portal (vanilla JS modules, no build step)
test/                 node:test suite
```

## Connecting services

All optional, set as environment variables (see `.env.example`). Settings > Integrations shows what is connected.

| Feature | Variables | Where to get them |
|---|---|---|
| Email | `MAIL_PROVIDER` (`resend` or `postmark`), `MAIL_API_KEY`, `MAIL_FROM` | resend.com or postmarkapp.com, after verifying your sending domain |
| Card payments | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Stripe dashboard > Developers. Add the webhook URL shown in Settings |
| Off-site backups | `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_KEY_ID`, `BACKUP_S3_SECRET` | Cloudflare R2 > Manage API tokens (S3 compatible) |

## Not built yet (good next steps)
- **One-click deploys** to Cloudflare Pages or Netlify (today: built-in hosting, or download the Astro export).
- **Automatic HTTPS for client domains** inside the app (today: handled by your proxy, e.g. Caddy on-demand TLS).
- **Accounting sync** of invoices and payments to Xero.
