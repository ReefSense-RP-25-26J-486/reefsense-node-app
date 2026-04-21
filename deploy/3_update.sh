#!/bin/bash
# =============================================================
# ReefSense — Quick Update (pull + restart)
# Run this whenever you push new code to GitHub
# Usage: bash 3_update.sh
# =============================================================
set -e

APP_DIR="$HOME/reefsense-node-app"

echo ""
echo "[1/3] Pulling latest code..."
cd "$APP_DIR"
git pull origin main

echo "[2/3] Installing any new dependencies..."
npm install --production

echo "[3/3] Reloading app (zero-downtime)..."
pm2 reload reefsense-api

echo ""
echo "Done! App updated."
pm2 status
echo ""
