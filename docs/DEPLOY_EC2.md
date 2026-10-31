# Deploy DAT Spirit Poker to EC2

This guide covers a simple production layout for **datspiritpoker.com**:

- **Nginx** — TLS, static web (`apps/web/dist`), SPA fallback for `/slots`
- **Node** — `@dat-poker/api` on port 4000 (systemd)
- **Optional** — treasury payout on a separate host ([TREASURY.md](./TREASURY.md))

## 1. EC2 instance

- Ubuntu 22.04+ or Amazon Linux 2023
- Security group: `443`, `80` from the world; `4000` only from localhost (or VPC if split)
- Elastic IP recommended

## 2. One-time server setup

```bash
sudo apt update && sudo apt install -y nginx git
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo corepack enable
```

Clone the repo (or pull from your deploy user):

```bash
git clone https://github.com/Drewski241/dat-poker.git /opt/dat-poker
cd /opt/dat-poker
cp .env.example .env
# Edit .env: WALLETCONNECT_PROJECT_ID, DAT_GOVERNANCE_TOKEN_ASSET_ID,
# DAT_TREASURY_PAYOUT_URL, DAT_DAILY_REDEEM_MOJOS, DAT_SPIN_COST_MOJOS, etc.
pnpm install
pnpm build
```

Build the web client with your public API URL:

```bash
VITE_API_URL=https://datspiritpoker.com pnpm --filter @dat-poker/web build
sudo mkdir -p /var/www/datspiritpoker
sudo rsync -a apps/web/dist/ /var/www/datspiritpoker/
```

## 3. systemd (API)

Create `/etc/systemd/system/dat-poker-api.service`:

```ini
[Unit]
Description=DAT Poker API
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/dat-poker
Environment=NODE_ENV=production
ExecStart=/usr/bin/node services/api/dist/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now dat-poker-api
```

## 4. Nginx

Example `/etc/nginx/sites-available/datspiritpoker`:

```nginx
server {
    listen 443 ssl http2;
    server_name datspiritpoker.com;

    root /var/www/datspiritpoker;
    index index.html;

    location /v1/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /health {
        proxy_pass http://127.0.0.1:4000;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Enable the site and reload nginx after obtaining TLS certificates (e.g. certbot).

## 5. Redeploy (routine)

From the repo root on the server:

```bash
./scripts/deploy-ec2.sh
```

Or manually:

```bash
git pull
pnpm install
pnpm build
VITE_API_URL=https://datspiritpoker.com pnpm --filter @dat-poker/web build
sudo rsync -a apps/web/dist/ /var/www/datspiritpoker/
sudo systemctl restart dat-poker-api
```

## Notes

- In-memory tables, jackpots, and sessions reset when the API restarts.
- Set `DAT_ALLOW_DEV_BUYIN=false` in production.
- Progressive jackpot and daily redeem amounts come from `DAT_DAILY_REDEEM_MOJOS` and spin cost from `DAT_SPIN_COST_MOJOS` (default **1 DAT** per spin).
