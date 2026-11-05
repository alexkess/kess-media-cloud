# Connecting outside services

Kess Cloud works on its own; each of these adds something. All keys live in the server's settings file, never in the code or the database in plain text.

**How to change a setting on the live server** (from your Mac):
```bash
ssh root@103.100.37.83
```
```bash
nano /opt/kess-cloud/.env
```
Edit or add the lines, save (Ctrl+O, Enter, Ctrl+X), then apply:
```bash
bash /opt/kess-cloud/deploy/update.sh
```
Settings > Connected apps / Integrations shows what's connected. The callback addresses below assume `https://cloud.kess.media`.

---

## 1. Email (Resend) — do this first
Without it, emails are only saved in Settings > Email outbox, not sent.
1. Sign up at resend.com, **Domains > Add domain** `kess.media`, region closest to Australia offered.
2. Add the DNS records Resend shows in **Cloudflare > kess.media > DNS** (they're for sending only; your normal email keeps working). Wait until Resend says *Verified*.
3. **API Keys > Create** (Sending access). Then in `.env`:
   ```
   MAIL_PROVIDER=resend
   MAIL_API_KEY=re_...
   MAIL_FROM=Kess Media <hello@kess.media>
   MAIL_VERIFIED_DOMAINS=kess.media
   ```
4. Apply, then Settings > **Send me a test email**. With `MAIL_VERIFIED_DOMAINS=kess.media`, Georgia's quotes and invoices come from georgia@kess.media.

## 2. Card payments (Stripe)
1. Stripe dashboard > Developers > API keys: copy the **secret key**.
2. Developers > Webhooks > **Add endpoint**: `https://cloud.kess.media/api/public/stripe/webhook`, event `checkout.session.completed`. Copy the **signing secret**.
3. `.env`: `STRIPE_SECRET_KEY=sk_live_...` and `STRIPE_WEBHOOK_SECRET=whsec_...`, apply.
4. Test with a $1 invoice to yourself, then refund it in Stripe.

## 3. Xero
1. developer.xero.com > My Apps > **New app**: type *Web app*, company URL `https://kess.media`, redirect URI **`https://cloud.kess.media/oauth/xero/callback`**.
2. Copy the Client ID and generate a Client secret. `.env`:
   ```
   XERO_CLIENT_ID=...
   XERO_CLIENT_SECRET=...
   ```
   New Xero apps (from March 2026) use granular scopes, which is the default. If your app is older and connecting fails with a scope error, add:
   `XERO_SCOPES=openid profile email offline_access accounting.transactions accounting.contacts accounting.settings.read`
3. Apply, then Settings > Connected apps > **Connect Xero**, pick the Kess Media organisation.
4. Check the options: **Only invoices issued from** (defaults to the day you connect, so old invoices aren't duplicated), sales account (200 = Sales), tax type (OUTPUT = GST on income), and **Record payments in** (choose your bank account if you want card payments recorded; leave "reconcile in Xero" if your bank feed already handles it).
5. Invoice numbers: make sure Kess Cloud's prefix (Settings > Agency) doesn't collide with Xero's own numbering (e.g. Xero uses `INV-`, Kess Cloud uses `KC-`).

What happens: issued invoices appear in Xero as Approved with the same number and GST; voided invoices are voided; when you reconcile a payment in Xero, Kess Cloud marks it paid within the hour and stops reminders.

## 4. Dropbox
1. dropbox.com/developers > **Create app**: *Scoped access*, *Full Dropbox*, name e.g. "Kess Cloud".
2. Settings tab: redirect URI **`https://cloud.kess.media/oauth/dropbox/callback`**. Permissions tab, tick: `account_info.read files.metadata.read files.content.write sharing.read sharing.write file_requests.read file_requests.write`, **Submit**.
3. `.env`: `DROPBOX_APP_KEY=...` and `DROPBOX_APP_SECRET=...`, apply.
4. Settings > Connected apps > **Connect Dropbox** (sign in with the account that sees the Kess Media Team Folder).
5. Set the **Shoot folder** template to match how you file shoots, e.g. `/Kess Media Team Folder/0 - Clients/{client}/{year}-{month}-{day} {job}`.

On each shoot: **Create shoot folders**, **Client upload link** (appears on the client's booking page; no Dropbox account needed), **Share from Dropbox** (any folder or file becomes a delivery link).

## 5. Vimeo
1. developer.vimeo.com > **Create an app**, then on the app page **Generate an access token**: *Authenticated (you)*, scopes `public private video_files`.
2. `.env`: `VIMEO_TOKEN=...`, apply.

On each shoot: **Add from Vimeo** picks a video; it plays on the client's booking page, and "Also add the review page" gives the client Vimeo's timecoded comments.

## 6. Off-site backups (Cloudflare R2)
1. Cloudflare > R2 > Create bucket `kess-cloud-backups` (location hint: Oceania).
2. R2 > Manage API tokens > Create token with *Object Read & Write* on that bucket. Note the Access Key ID, Secret, and the S3 endpoint `https://<account-id>.r2.cloudflarestorage.com`.
3. `.env`:
   ```
   BACKUP_S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
   BACKUP_S3_BUCKET=kess-cloud-backups
   BACKUP_S3_KEY_ID=...
   BACKUP_S3_SECRET=...
   BACKUP_S3_REGION=auto
   BACKUP_KEEP=5
   ```
4. Apply, then Settings > **Back up now** and check the file appears in the bucket.

## Security notes
- Connection tokens (Xero, Dropbox) are encrypted. The key is `KESS_SECRET` in `.env` if set, otherwise a key file in the data volume that is never included in backups. Restoring a backup onto a fresh server keeps all data; you only reconnect Xero and Dropbox.
- Only the owner account can connect or disconnect apps.
