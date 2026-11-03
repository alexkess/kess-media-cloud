# Kess Cloud

The Kess Media platform for building, hosting and caring for client websites, with a portal for clients.

One Node app, no external services. SQLite holds the data, and the app itself hosts the client sites.

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
- **SEO check:** per-page score for titles, meta descriptions, H1s, image alt text, unsafe links and thin content.
- **Requests:** a kanban board of change requests, bugs and questions. Each one has internal notes, time logging, hour estimates (internal), and quotes (ex GST) the client can approve or decline.
- **Billing:** tax invoices with GST, a printable branded PDF view, draft → sent → paid/void, and one-click monthly care-plan invoices. Approved, billable request quotes are added to those invoices automatically.
- **Care plans:** plan pricing and features, plus included hours used this month per site.
- **Estimates:** ballpark builder for proposals. Hours × internal rate are rounded outward into ranges ex GST. "Copy for proposal" gives client-safe text with no hourly rate, and the "pricing is negotiable" line is built in, following the kess-proposal rules.
- **Uptime and SSL monitoring** every 5 minutes, with alerts when a site goes down or comes back.
- **Notifications** in the app, plus an optional Slack/Make/Zapier webhook.

### For clients (portal)
- See their websites, live status, uptime and SSL.
- **Approve new versions** or request changes in plain words.
- **Edit their own content** (text and images only; the structure stays locked) and send edits to Kess Media for review.
- **Enquiries inbox:** contact-form messages from their site, with reply, archive, spam and CSV export.
- **Analytics** without cookies: page views, top pages, referrers and enquiry rate. No consent banner needed.
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

14 API tests cover: auth and the CSRF guard; client data isolation (no internal notes, hour estimates, draft invoices or other clients' sites); the client edit lock; the approve and request-changes flows; quotes; the public form, honeypot and analytics; custom-domain hosting with HTML escaping; tarball validity of the Astro export; estimate rounding and rate secrecy; care-invoice de-duplication and GST maths; the asset type allowlist and sandbox headers.

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

## Not built yet (good next steps)
- **Email:** notifications are in-app and webhook only. Add SMTP/Postmark to email clients about approvals, invoices and enquiries.
- **Online payments:** invoices show bank details. A Stripe payment link per invoice would be the next step.
- **One-click deploys** to Cloudflare Pages or Netlify (today: built-in hosting or download the Astro export).
- **Two-factor sign-in and password reset by email** (today: the agency issues a one-time link).
- **Automatic off-site backups** of the SQLite file (e.g. Litestream to R2/S3).
