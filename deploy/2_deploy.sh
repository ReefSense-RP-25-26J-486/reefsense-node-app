#!/bin/bash
# =============================================================
# ReefSense — Deploy / Update Backend
# Run this to first deploy, or anytime you push new code
# Usage: bash 2_deploy.sh
# =============================================================
set -e

APP_DIR="$HOME/reefsense-node-app"
REPO_URL="https://github.com/ReefSense-RP-25-26J-486/reefsense-node-app.git"
BRANCH="gis-nursery-placement"

echo ""
echo "============================================"
echo "  ReefSense Backend Deploy"
echo "============================================"
echo ""

# ── Clone or pull latest code ────────────────────────────────
if [ -d "$APP_DIR" ]; then
  echo "[1/4] Pulling latest code..."
  cd "$APP_DIR"
  git pull origin "$BRANCH"
else
  echo "[1/4] Cloning repository..."
  git clone -b "$BRANCH" "$REPO_URL" "$APP_DIR"
  cd "$APP_DIR"
else
  cd "$APP_DIR"
  git pull origin "$BRANCH"
fi

# ── Install dependencies ──────────────────────────────────────
echo "[2/4] Installing npm dependencies..."
npm install --production

# ── Copy .env if it doesn't exist ────────────────────────────
if [ ! -f "$APP_DIR/.env" ]; then
  echo ""
  echo "  ⚠️  No .env file found at $APP_DIR/.env"
  echo "  Please create it using .env.example as a template:"
  echo "  cp $APP_DIR/.env.example $APP_DIR/.env"
  echo "  nano $APP_DIR/.env"
  echo ""
  exit 1
fi

# ── Start / reload with PM2 ───────────────────────────────────
echo "[3/4] Starting app with PM2..."
cd "$APP_DIR"
pm2 delete reefsense-api 2>/dev/null || true
pm2 start ecosystem.config.js

# ── Save PM2 list + enable startup on reboot ──────────────────
echo "[4/4] Saving PM2 startup config..."
pm2 save
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u ubuntu --hp /home/ubuntu

echo ""
echo "============================================"
echo "  Deployed! App is running."
echo "  Check status: pm2 status"
echo "  View logs:    pm2 logs reefsense-api"
echo "============================================"
echo ""
