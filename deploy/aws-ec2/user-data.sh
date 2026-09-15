#!/bin/bash
# DAT POKER nginx bootstrap for Amazon Linux 2023 (public beta / Path C).
# Do NOT paste this into User data while following the $20 Builder Center
# Apache + Session Manager tutorial (docs/AWS_EC2.md Path A).
# For the poker website after that credit: docs/BETA.md
set -euxo pipefail
exec > >(tee /var/log/dat-poker-bootstrap.log) 2>&1

REPO_URL="${DAT_POKER_REPO_URL:-https://github.com/Drewski241/dat-poker.git}"
REPO_REF="${DAT_POKER_REPO_REF:-main}"
DAT_POKER_STAGE="${DAT_POKER_STAGE:-beta}"
INSTALL_ROOT="/opt/dat-poker"
WEB_ROOT="/usr/share/nginx/html"

install_swap() {
  if swapon --show | grep -q .; then
    return 0
  fi
  dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
}

write_landing_page() {
  mkdir -p "$WEB_ROOT"
  cat > "$WEB_ROOT/index.html" <<'HTML'
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>DAT POKER on AWS</title>
    <style>
      :root { color-scheme: dark; }
      body {
        margin: 0; min-height: 100vh;
        font-family: ui-sans-serif, system-ui, sans-serif;
        background: radial-gradient(circle at top, #1f6b46 0%, #0b1f16 45%, #070d0a 100%);
        color: #e8f5ee; display: grid; place-items: center; padding: 2rem;
      }
      main {
        max-width: 40rem; background: rgba(7, 18, 13, 0.78);
        border: 1px solid rgba(120, 200, 160, 0.25); border-radius: 1rem;
        padding: 2rem; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
      }
      h1 { margin: 0 0 0.5rem; letter-spacing: 0.08em; }
      p { line-height: 1.5; color: #c5ddcf; }
      .status {
        margin-top: 1.25rem; padding: 0.85rem 1rem; border-radius: 0.75rem;
        background: #10261c; font-family: ui-monospace, monospace; font-size: 0.9rem;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>DAT POKER</h1>
      <p>
        This Amazon EC2 instance is serving DAT POKER. nginx is up — that is the
        AWS Free Tier “install a web server and serve a simple web page” step.
      </p>
      <p>
        The Node API and table UI keep installing in the background. This page
        is replaced when the web client build finishes.
      </p>
      <div class="status" id="status">Checking API health…</div>
    </main>
    <script>
      async function ping() {
        const el = document.getElementById("status");
        try {
          const res = await fetch("/health", { cache: "no-store" });
          const body = await res.json();
          el.textContent = "API " + (res.ok ? "ok" : "error") + " — " + JSON.stringify(body);
        } catch (err) {
          el.textContent = "API not up yet. Bootstrap log: /var/log/dat-poker-bootstrap.log";
        }
      }
      ping();
      setInterval(ping, 5000);
    </script>
  </body>
</html>
HTML
}

write_nginx_conf() {
  cat > /etc/nginx/nginx.conf <<'NGINX'
user nginx;
worker_processes auto;
error_log /var/log/nginx/error.log;
pid /run/nginx.pid;

events {
  worker_connections 1024;
}

http {
  include /etc/nginx/mime.types;
  default_type application/octet-stream;
  sendfile on;
  keepalive_timeout 65;
  access_log /var/log/nginx/access.log;

  server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    location /health {
      proxy_pass http://127.0.0.1:4000;
      proxy_http_version 1.1;
      proxy_set_header Host $host;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /v1/ {
      proxy_pass http://127.0.0.1:4000;
      proxy_http_version 1.1;
      proxy_set_header Host $host;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
      try_files $uri $uri/ /index.html;
    }
  }
}
NGINX
}

install_node() {
  if command -v node >/dev/null 2>&1; then
    local major
    major="$(node -p 'process.versions.node.split(".")[0]')"
    if [[ "$major" -ge 20 ]]; then
      return 0
    fi
  fi
  local arch node_arch
  arch="$(uname -m)"
  case "$arch" in
    x86_64) node_arch=linux-x64 ;;
    aarch64) node_arch=linux-arm64 ;;
    *) echo "unsupported arch: $arch"; return 1 ;;
  esac
  curl -fsSL "https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-${node_arch}.tar.xz" \
    -o /tmp/node.tar.xz
  tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1
  rm -f /tmp/node.tar.xz
  node -v
  corepack enable
  corepack prepare pnpm@9.15.0 --activate
}

clone_repo() {
  if [[ -d "$INSTALL_ROOT/.git" ]]; then
    git -C "$INSTALL_ROOT" fetch --depth 1 origin "$REPO_REF"
    git -C "$INSTALL_ROOT" checkout -f FETCH_HEAD
    return 0
  fi
  rm -rf "$INSTALL_ROOT"
  git clone --depth 1 --branch "$REPO_REF" "$REPO_URL" "$INSTALL_ROOT" \
    || git clone --depth 1 "$REPO_URL" "$INSTALL_ROOT"
}

write_env() {
  if [[ ! -f "$INSTALL_ROOT/.env" ]]; then
    if [[ -f "$INSTALL_ROOT/.env.beta.example" ]]; then
      cp "$INSTALL_ROOT/.env.beta.example" "$INSTALL_ROOT/.env"
    else
      cp "$INSTALL_ROOT/.env.example" "$INSTALL_ROOT/.env"
    fi
  fi
  sed -i 's/^DAT_ALLOW_DEV_BUYIN=.*/DAT_ALLOW_DEV_BUYIN=true/' "$INSTALL_ROOT/.env"
  grep -q '^DAT_ALLOW_DEV_BUYIN=' "$INSTALL_ROOT/.env" \
    || echo 'DAT_ALLOW_DEV_BUYIN=true' >> "$INSTALL_ROOT/.env"
}

install_app() {
  cd "$INSTALL_ROOT"
  export CI=true
  export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=512}"
  export VITE_APP_STAGE="${DAT_POKER_STAGE:-beta}"
  corepack enable
  corepack prepare pnpm@9.15.0 --activate
  pnpm install --frozen-lockfile
  pnpm --filter @dat-poker/api^... build
  pnpm --filter @dat-poker/api build
  pnpm --filter @dat-poker/web build
  rm -rf "${WEB_ROOT:?}/"*
  cp -a "$INSTALL_ROOT/apps/web/dist/." "$WEB_ROOT/"
}

write_api_unit() {
  cat > /etc/systemd/system/dat-poker-api.service <<'UNIT'
[Unit]
Description=DAT POKER REST API
After=network.target

[Service]
Type=simple
User=ec2-user
Group=ec2-user
WorkingDirectory=/opt/dat-poker
EnvironmentFile=-/opt/dat-poker/.env
ExecStart=/usr/local/bin/node /opt/dat-poker/services/api/dist/index.js
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
}

install_swap
dnf install -y nginx git tar xz
write_landing_page
write_nginx_conf
systemctl enable --now nginx
nginx -s reload || systemctl restart nginx

# The instance is now a live web server (Free Tier tutorial requirement).
# Continue with DAT POKER; failures after this point must not undo nginx.
set +e
install_node
clone_repo
write_env
install_app
write_api_unit
chown -R ec2-user:ec2-user "$INSTALL_ROOT"
systemctl daemon-reload
systemctl enable --now dat-poker-api
nginx -s reload
set -e

if systemctl is-active --quiet dat-poker-api && curl -fsS http://127.0.0.1:4000/health >/dev/null; then
  echo "DAT POKER API is healthy"
  touch /var/lib/dat-poker-bootstrap.ok
else
  echo "nginx is serving the landing page; API still starting or build failed. See /var/log/dat-poker-bootstrap.log" >&2
  touch /var/lib/dat-poker-bootstrap.web-only
fi
