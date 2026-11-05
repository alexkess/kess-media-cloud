# Kess Cloud: notes for Claude

Kess Media's platform for building, hosting and caring for client websites, with a client portal. Owner: Alex Kess (alex@kess.media), Sydney.

## Ground rules
- **No runtime dependencies.** Node 22.13+ built-ins only (`node:sqlite`, `node:http`, `node:crypto`). Don't add npm packages; if a third-party library is unavoidable in the browser, vendor it into `public/vendor/` with its licence noted.
- **No build step.** The front end is plain ES modules served as-is.
- **One source of truth for sections:** `shared/sections.js` drives the editor, the hosted renderer and the Astro + Sanity export. Add a section type there and all three pick it up.
- **Clients never see internal data:** hourly rates, hour estimates, time logs, internal comments, draft invoices, agency notes. API handlers strip these for `role = 'client'`; add a test whenever you add a field like this.
- **Mutating API calls need the `X-Kess: 1` header** (CSRF guard); `/api/public/*` is the exception and must stay unauthenticated and rate limited.
- Schema changes: new tables go in `SCHEMA` in `server/db.js`; new columns on existing tables go in `COLUMNS` there so older databases migrate.

## Writing (UI copy, emails, docs)
- Australian English, DD/MM/YYYY, prices ex GST unless shown as "inc GST".
- Plain words, short sentences. No em dashes in client-facing copy.
- Never show the hourly rate in anything a client sees. Estimates show rounded ranges and say pricing is negotiable.

## Brand
Charcoal #1a1a1a, ivory #F2EDE6, sage #E8EDE6, forest #1E5C34, mint #7BBF9A. Inter for text; Playfair Display italic only for heading accents (`<em>` in headings). Forest on light backgrounds, mint on dark.

## Commands
```bash
npm run dev    # http://localhost:8787 with demo data (alex@kess.media / kessmedia-demo-2026)
npm test       # node:test suite, must stay green
```

## Layout
- `server/app.js` HTTP server, site hosting (`/s/<slug>/` and custom domains), previews
- `server/api/*.js` REST API by area; `server/lib/*.js` auth, services, mail, stripe, backups, jobs, reports, monitor, export
- `public/js/views/*.js` one module per screen; `public/js/lib.js` shared helpers (`html` tagged template escapes by default)
- `server/lib/studio.js` + `server/api/studio*.js` + `server/lib/studio-pages.js` photo/video studio (jobs, quotes, contracts, payment plans, workflows, client booking pages)
- `server/lib/socials/*` + `server/api/socials.js` + `public/js/views/socials.js` social posts ported from kess-socials (rotation, posting windows, captions via the Anthropic API, Publer, Shopify and Sanity sources, `scripts/import-socials-from-supabase.mjs`). Agency only. Nothing reaches Publer unless `SOCIALS_SEND=1`, and the daily jobs need `SOCIALS_JOBS=1`; keep it that way and keep the tests that prove it
- `test/*.test.js` API and unit tests
