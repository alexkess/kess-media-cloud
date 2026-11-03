# Putting Kess Cloud online

The plan: one small server in Sydney runs Kess Cloud plus **Caddy**, which handles HTTPS. Caddy gets certificates automatically for Kess Cloud itself and for every client domain you point at the server. Kess Cloud confirms each domain is one of your sites first.

```
client's browser ──https──> Caddy (ports 80/443) ──> Kess Cloud app (SQLite + files on a disk volume)
```

## 1. Get a server

What you need: **Ubuntu 24.04, 1 vCPU, 1–2 GB RAM, 25 GB+ disk, Sydney.** Around A$10–20 a month. Any of these work:

| Provider | Why | Notes |
|---|---|---|
| **BinaryLane** (recommended) | Australian company, Sydney data centre (NextDC S1), billed in AUD | Turn on their backup add-on too |
| DigitalOcean (SYD1) | Well documented, polished dashboard | Billed in USD; backups add-on available |
| Vultr / Linode (Sydney) | Similar to DigitalOcean | Billed in USD |

Check current prices on the provider's site at checkout. When you create the server, add your SSH key if you have one; otherwise use the root password they email you.

## 2. Point a domain at it

In the DNS for kess.media (wherever it's managed, e.g. Cloudflare or your registrar), add:

| Type | Name | Value |
|---|---|---|
| A | `cloud` | the server's IP address |

If kess.media's DNS is on Cloudflare, set this record to **DNS only (grey cloud)** so Caddy can get its certificate.

## 3. Install Kess Cloud

Connect to the server (Mac Terminal or Windows PowerShell):

```bash
ssh root@YOUR.SERVER.IP
```

Then download the setup script, read it, and run it:

```bash
curl -fsSL https://raw.githubusercontent.com/alexkess/kess-media-cloud/main/deploy/setup.sh -o setup.sh
```
```bash
bash setup.sh
```

It installs Docker and a firewall, turns on automatic security updates, asks for your address (e.g. `cloud.kess.media`) and email, then starts everything. **It prints your owner password once. Save it.** Open `https://cloud.kess.media` a few minutes later and sign in.

## 4. Switch on email, card payments and off-site backups

Edit the settings file on the server:

```bash
nano /opt/kess-cloud/.env
```

Fill in what you want, as described in `.env.example`: `MAIL_*` for Resend or Postmark, `STRIPE_*`, and `BACKUP_S3_*` for Cloudflare R2. Then restart:

```bash
bash /opt/kess-cloud/deploy/update.sh
```

Settings > Integrations in Kess Cloud shows what's connected and has a "Send me a test email" button.

## Hosting a client's website on their own domain

1. In Kess Cloud, open the site > Settings and enter their domain (e.g. `harbourphysio.com.au`).
2. In the client's DNS:

   | Type | Name | Value |
   |---|---|---|
   | A | `@` | your server's IP |
   | CNAME | `www` | `cloud.kess.media` |

3. Visit the domain. The first visit takes a few seconds while the certificate is issued, then it's instant.

Publish the site first, or visitors see "not published yet".

## Updating

When new code is pushed to GitHub:

```bash
bash /opt/kess-cloud/deploy/update.sh
```

Your data, uploads and certificates live in Docker volumes and are kept.

## Backups and restore

- Kess Cloud makes a backup every night (database + uploaded files), keeps 14, and can copy each one to R2/S3. Settings > Backups has "Back up now" and downloads.
- To restore: stop the app (`docker compose -f deploy/docker-compose.yml stop app`), copy `kess-cloud.db` and the `assets` folder from the backup into the `kess-data` volume, then start it again. `RESTORE.txt` inside each backup says the same.
- Also turn on the server provider's own snapshot backups as a second safety net.

## Useful commands (on the server, in /opt/kess-cloud)

```bash
docker compose -f deploy/docker-compose.yml ps
```
```bash
docker compose -f deploy/docker-compose.yml logs -f app
```
```bash
docker compose -f deploy/docker-compose.yml restart
```

## Why not a "serverless" host?

Kess Cloud keeps its database and uploads on disk and runs background jobs (uptime checks, nightly backups, reminders). That needs an always-on machine with a persistent disk. Cloudflare Pages/Workers or Vercel don't offer that. Fly.io and Railway can work, but they need extra steps for every client domain's certificate. A plain Sydney server with Caddy is simpler, cheaper and keeps client data in Australia.
