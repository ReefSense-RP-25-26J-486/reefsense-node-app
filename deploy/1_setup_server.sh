#!/bin/bash
# =============================================================
# ReefSense — Oracle Cloud VM Initial Setup
# Run this ONCE after first SSH into the server as ubuntu user
# Usage: bash 1_setup_server.sh
# =============================================================
set -e

echo ""
echo "============================================"
echo "  ReefSense Server Setup"
echo "============================================"
echo ""

# ── System update ─────────────────────────────────────────────
echo "[1/7] Updating system packages..."
sudo apt-get update -y && sudo apt-get upgrade -y

# ── Node.js 20 LTS ────────────────────────────────────────────
echo "[2/7] Installing Node.js 20 LTS..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

echo "      Node: $(node -v)"
echo "      NPM:  $(npm -v)"

# ── PM2 (process manager) ─────────────────────────────────────
echo "[3/7] Installing PM2..."
sudo npm install -g pm2

# ── Nginx ─────────────────────────────────────────────────────
echo "[4/7] Installing Nginx..."
sudo apt-get install -y nginx

# ── Certbot (Let's Encrypt SSL — only needed if you have a domain) ──
echo "[5/7] Installing Certbot..."
sudo apt-get install -y certbot python3-certbot-nginx

# ── Git ───────────────────────────────────────────────────────
echo "[6/7] Installing Git..."
sudo apt-get install -y git

# ── Firewall rules ────────────────────────────────────────────
echo "[7/7] Configuring firewall (UFW)..."
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'   # opens ports 80 (HTTP) and 443 (HTTPS)
sudo ufw --force enable

echo ""
echo "============================================"
echo "  Setup complete!"
echo "  Next: run bash 2_deploy.sh"
echo "============================================"
echo ""
