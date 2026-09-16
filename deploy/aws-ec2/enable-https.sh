#!/bin/bash
# Put TLS in front of the beta host so Sage WalletConnect can pair.
# Run as root after the HTTP site already works:
#   sudo bash /opt/dat-poker/deploy/aws-ec2/enable-https.sh
#
# Branded site:
#   sudo DAT_POKER_DOMAIN=datspiritpoker.com bash /opt/dat-poker/deploy/aws-ec2/enable-https.sh
#
# Optional:
#   DAT_POKER_DOMAIN=datspiritpoker.com  # DNS A record at the Elastic IP
#   DAT_POKER_WWW=0                  # skip www.<domain> cert
#   DAT_POKER_PUBLIC_IPV4=54.12.34.56
#   CADDY_VERSION=2.9.1
set -euo pipefail
echo "=== DAT POKER enable-https.sh (Caddy + Let's Encrypt for ${DAT_POKER_DOMAIN:-sslip.io}) ==="

if [[ "$(id -u)" -ne 0 ]]; then
  echo "run as root: sudo bash $0" >&2
  exit 1
fi

INSTALL_ROOT="${INSTALL_ROOT:-/opt/dat-poker}"
CADDY_VERSION="${CADDY_VERSION:-2.9.1}"
WEB_ROOT="${WEB_ROOT:-/usr/share/nginx/html}"

ip_to_sslip() {
  local ip="$1"
  echo "${ip//./-}.sslip.io"
}

is_sslip() {
  [[ "$1" == *.sslip.io ]]
}

public_ipv4() {
  if [[ -n "${DAT_POKER_PUBLIC_IPV4:-}" ]]; then
    echo "$DAT_POKER_PUBLIC_IPV4"
    return 0
  fi
  local token ip
  token="$(curl -fsS -X PUT "http://169.254.169.254/latest/api/token" \
    -H "X-aws-ec2-metadata-token-ttl-seconds: 60" 2>/dev/null || true)"
  if [[ -n "$token" ]]; then
    ip="$(curl -fsS -H "X-aws-ec2-metadata-token: $token" \
      http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || true)"
    if [[ -n "$ip" ]]; then
      echo "$ip"
      return 0
    fi
  fi
  curl -fsS https://checkip.amazonaws.com | tr -d '[:space:]'
}

dns_a() {
  getent ahostsv4 "$1" 2>/dev/null | awk '{print $1; exit}'
}

explain_dns_fail() {
  local host="$1" got="$2"
  cat >&2 <<EOF
DNS $host is '${got:-none}', want $PUB_IP.

The certificate step cannot succeed until $DOMAIN has an A record pointing
at this Elastic IP.

In Cloudflare → Websites → $DOMAIN → DNS → Records:
  A  @    $PUB_IP   Proxy status DNS only (grey cloud, not orange)
  A  www  $PUB_IP   Proxy status DNS only (grey cloud)

On the laptop, wait until this prints $PUB_IP:

  dig +short $DOMAIN

Then re-run:

  sudo DAT_POKER_DOMAIN=$DOMAIN bash $0

If www is not ready: DAT_POKER_WWW=0 on that command.
EOF
}

wait_for_dns_a() {
  local host="$1" want="$2" tries="${3:-90}"
  local got i
  got="$(dns_a "$host")"
  if [[ -z "$got" ]]; then
    explain_dns_fail "$host" "$got"
    return 1
  fi
  for i in $(seq 1 "$tries"); do
    got="$(dns_a "$host")"
    if [[ "$got" == "$want" ]]; then
      echo "DNS $host -> $want after ${i}s"
      return 0
    fi
    sleep 2
  done
  explain_dns_fail "$host" "$got"
  return 1
}

install_caddy() {
  if command -v caddy >/dev/null 2>&1; then
    return 0
  fi
  local arch caddy_arch
  arch="$(uname -m)"
  case "$arch" in
    x86_64) caddy_arch=amd64 ;;
    aarch64) caddy_arch=arm64 ;;
    *) echo "unsupported arch: $arch" >&2; return 1 ;;
  esac
  curl -fsSL "https://github.com/caddyserver/caddy/releases/download/v${CADDY_VERSION}/caddy_${CADDY_VERSION}_linux_${caddy_arch}.tar.gz" \
    -o /tmp/caddy.tgz
  tar -xzf /tmp/caddy.tgz -C /tmp caddy
  install -m 0755 /tmp/caddy /usr/local/bin/caddy
  rm -f /tmp/caddy /tmp/caddy.tgz
  caddy version
}

ensure_caddy_user() {
  if ! id caddy >/dev/null 2>&1; then
    useradd --system --home /var/lib/caddy --shell /usr/sbin/nologin caddy
  fi
  mkdir -p /var/lib/caddy /etc/caddy
  chown -R caddy:caddy /var/lib/caddy
}

if [[ -z "${DAT_POKER_DOMAIN:-}" && -f /etc/caddy/caddy.env ]]; then
  DAT_POKER_DOMAIN="$(sed -n 's/^DAT_POKER_DOMAIN=//p' /etc/caddy/caddy.env | tail -n1)"
  if [[ -n "${DAT_POKER_DOMAIN}" ]] && ! is_sslip "$DAT_POKER_DOMAIN"; then
    echo "Keeping existing domain $DAT_POKER_DOMAIN from /etc/caddy/caddy.env"
  else
    DAT_POKER_DOMAIN=""
  fi
fi

PUB_IP="$(public_ipv4)"
DOMAIN="${DAT_POKER_DOMAIN:-}"
if [[ -z "$DOMAIN" ]]; then
  DOMAIN="$(ip_to_sslip "$PUB_IP")"
  echo "No DAT_POKER_DOMAIN set; using $DOMAIN (Elastic IP $PUB_IP)"
  echo "For https://datspiritpoker.com/ point Cloudflare A records at $PUB_IP, then re-run:"
  echo "  sudo DAT_POKER_DOMAIN=datspiritpoker.com bash $0"
fi

SITE="$DOMAIN"
if ! is_sslip "$DOMAIN"; then
  wait_for_dns_a "$DOMAIN" "$PUB_IP"
  if [[ "${DAT_POKER_WWW:-1}" != "0" ]]; then
    wait_for_dns_a "www.$DOMAIN" "$PUB_IP"
    SITE="$DOMAIN,www.$DOMAIN"
  fi
fi

install_caddy
ensure_caddy_user

cp "$INSTALL_ROOT/deploy/aws-ec2/Caddyfile" /etc/caddy/Caddyfile
cp "$INSTALL_ROOT/deploy/aws-ec2/caddy.service" /etc/systemd/system/caddy.service
cat > /etc/caddy/caddy.env <<EOF
DAT_POKER_DOMAIN=${DOMAIN}
DAT_POKER_SITE=${SITE}
EOF
chown root:caddy /etc/caddy/Caddyfile /etc/caddy/caddy.env
chmod 0644 /etc/caddy/Caddyfile
chmod 0640 /etc/caddy/caddy.env

# Caddy needs :80 for Let's Encrypt. nginx keeps the files in WEB_ROOT.
if systemctl is-active --quiet nginx; then
  systemctl disable --now nginx
fi

systemctl daemon-reload
systemctl enable --now caddy
systemctl reload caddy || true

ok=0
for i in $(seq 1 60); do
  if curl -fsS "https://${DOMAIN}/health" >/dev/null 2>&1; then
    echo "HTTPS healthy after ${i}s at https://${DOMAIN}/health"
    ok=1
    break
  fi
  sleep 2
done
if [[ "$ok" -ne 1 ]]; then
  echo "Caddy did not serve https://${DOMAIN}/health within 120s" >&2
  echo "Check security group inbound 80 and 443, then: journalctl -u caddy -n 80 --no-pager" >&2
  systemctl status caddy --no-pager >&2 || true
  journalctl -u caddy -n 80 --no-pager >&2 || true
  exit 1
fi

echo "Open https://${DOMAIN}/ in the laptop browser (not http://IP)."
echo "Testers land on the website; Play is https://${DOMAIN}/play"
echo "Static files remain in ${WEB_ROOT}."
