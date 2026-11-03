#!/usr/bin/env bash
# One-time setup of Kess Cloud on a fresh Ubuntu 24.04 server (run as root).
#   curl -fsSL https://raw.githubusercontent.com/alexkess/kess-media-cloud/main/deploy/setup.sh -o setup.sh
#   less setup.sh        # read it first
#   bash setup.sh
# Safe to run again: it skips steps that are already done.
set -euo pipefail

REPO="${REPO:-https://github.com/alexkess/kess-media-cloud.git}"
DIR="${DIR:-/opt/kess-cloud}"

if [ "$(id -u)" -ne 0 ]; then echo "Run this as root (or with sudo)." >&2; exit 1; fi
if ! grep -qiE 'ubuntu|debian' /etc/os-release; then echo "This script expects Ubuntu or Debian." >&2; exit 1; fi

echo "==> Installing system packages (Docker, firewall, automatic security updates)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y git curl ufw unattended-upgrades docker.io docker-compose-v2 openssl
systemctl enable --now docker
dpkg-reconfigure -f noninteractive unattended-upgrades || true

echo "==> Firewall: allow SSH, HTTP, HTTPS only"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

# Small servers (1 GB RAM) need swap to build the image comfortably.
if ! swapon --show | grep -q .; then
  echo "==> Adding 1 GB swap"
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> Getting the code into $DIR"
if [ -d "$DIR/.git" ]; then git -C "$DIR" pull --ff-only; else git clone "$REPO" "$DIR"; fi
cd "$DIR"

if [ ! -f .env ]; then
  echo "==> First-time settings"
  read -rp "Address for Kess Cloud (e.g. cloud.kess.media): " KESS_DOMAIN
  read -rp "Your email (owner login + certificate notices): " OWNER_EMAIL
  OWNER_PASSWORD="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)"
  umask 077
  cat > .env <<ENV
KESS_DOMAIN=${KESS_DOMAIN}
ACME_EMAIL=${OWNER_EMAIL}
PUBLIC_URL=https://${KESS_DOMAIN}
KESS_OWNER_EMAIL=${OWNER_EMAIL}
KESS_OWNER_PASSWORD=${OWNER_PASSWORD}
MONITOR=1
JOBS=1
BACKUPS=1
BACKUP_KEEP=14
# Fill these in later to switch on email, card payments and off-site backups (see .env.example)
MAIL_PROVIDER=
MAIL_API_KEY=
MAIL_FROM=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
BACKUP_S3_ENDPOINT=
BACKUP_S3_BUCKET=
BACKUP_S3_KEY_ID=
BACKUP_S3_SECRET=
BACKUP_S3_REGION=auto
ENV
  echo
  echo "    Owner login: ${OWNER_EMAIL}"
  echo "    Password:    ${OWNER_PASSWORD}"
  echo "    (also saved in $DIR/.env; change it under Settings after signing in)"
  echo
fi

echo "==> Building and starting Kess Cloud"
docker compose -f deploy/docker-compose.yml up -d --build

KESS_DOMAIN="$(grep -E '^KESS_DOMAIN=' .env | cut -d= -f2-)"
echo
echo "Done. Next:"
echo "  1. In your DNS, add an A record: ${KESS_DOMAIN} -> $(curl -fsS -4 https://api.ipify.org || echo 'this server IP')"
echo "  2. Wait a few minutes, then open https://${KESS_DOMAIN}"
echo "  Update later with:  bash $DIR/deploy/update.sh"
