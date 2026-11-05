# Moving Kess Cloud from Singapore to Sydney (BinaryLane)

BinaryLane can't move a server between Singapore and Australia, so the move is a **clone**: copy the Singapore server onto a new Sydney server, point DNS at it, then cancel Singapore. Kess Cloud only uses the IP address in **one place: the `cloud` DNS record**. Everything else (Stripe, email, certificates, app settings) uses the domain name.

Plan for **30 to 60 minutes of downtime** in a quiet window. Tell Georgia not to send quotes or invoices during it.

## Before the day
- [ ] Sydney shows capacity at https://home.binarylane.com.au/add-server for the same plan (Standard, 2 VCPUs, 4 GB, 60 GB or larger disk).
- [ ] In Cloudflare, the `cloud` A record's TTL is the lowest option (it should be from setup).
- [ ] No client domains point at the Singapore IP (keep it that way until after the move).
- [ ] An off-site backup exists (Settings > Integrations > Back up now, and download it).

## On the day
1. **Create the Sydney server**: same OS (Ubuntu 24.04 LTS), same plan or bigger disk, hostname `cloud.kess.media`. Note its new IP.
2. **Stop Kess Cloud on Singapore** so nothing changes after the backup:
   ```bash
   ssh root@<SINGAPORE-IP>
   ```
   ```bash
   cd /opt/kess-cloud && docker compose -f deploy/docker-compose.yml stop
   ```
3. **BinaryLane, Singapore server > Backups > Create**: "Create a new Temporary image", label it `move-to-sydney`, **Create Backup Now**. Wait until it finishes (temporary images are deleted after 48 hours).
4. **Manage > select that backup > Clone…**, destination: the new Sydney server. This replaces the Sydney server's disk with the Singapore copy.
5. **Start it on Sydney**:
   ```bash
   ssh root@<SYDNEY-IP>
   ```
   ```bash
   cd /opt/kess-cloud && docker compose -f deploy/docker-compose.yml up -d
   ```
6. **Cloudflare**: edit the `cloud` A record to the **Sydney IP** (DNS only, grey cloud). Check from your Mac until it shows the new IP:
   ```bash
   dig +short cloud.kess.media
   ```
7. **Test**: open https://cloud.kess.media, sign in, open a client, an invoice and a shoot, check Settings > Connected apps still shows Xero/Dropbox connected. (If you set `KESS_SECRET` in `.env`, connections carry over. If not, the key file in the data volume is cloned with the disk, so they carry over too.)
8. **Keep Singapore stopped (not cancelled) for a day or two** in case anything was missed, then cancel it in BinaryLane.

## If something goes wrong
- Point the `cloud` record back to the Singapore IP and start Kess Cloud there again (step 2 in reverse: `docker compose ... up -d`). Nothing was deleted.

## After the move
- Client websites can now be pointed at the server: `www` CNAME to `cloud.kess.media` (or a `sites.kess.media` name you control), apex A record to the Sydney IP.
- Government / privacy-sensitive clients can now be onboarded (data is in Australia).
