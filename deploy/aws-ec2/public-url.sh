#!/usr/bin/env bash
# Print the public website URL testers should open.
# On the EC2 box (no sudo required):
#   bash /opt/dat-poker/deploy/aws-ec2/public-url.sh
#
# Optional:
#   DAT_POKER_DOMAIN=dat-poker.com
#   DAT_POKER_PUBLIC_IPV4=54.12.34.56
set -euo pipefail

ip_to_sslip() {
  local ip="$1"
  echo "${ip//./-}.sslip.io"
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

if [[ -z "${DAT_POKER_DOMAIN:-}" && -f /etc/caddy/caddy.env ]]; then
  # shellcheck disable=SC1091
  DAT_POKER_DOMAIN="$(sed -n 's/^DAT_POKER_DOMAIN=//p' /etc/caddy/caddy.env | tail -n1)"
fi

if [[ -z "${DAT_POKER_DOMAIN:-}" ]]; then
  PUB_IP="$(public_ipv4)"
  DAT_POKER_DOMAIN="$(ip_to_sslip "$PUB_IP")"
fi

HOME_URL="https://${DAT_POKER_DOMAIN}/"
PLAY_URL="https://${DAT_POKER_DOMAIN}/play"

cat <<EOF
Share this website with invited testers (HTTPS, not the Elastic IP):

  ${HOME_URL}

They click Play the game (or open ${PLAY_URL}).

Add ${HOME_URL%/} to the Reown (WalletConnect) domain allowlist if Sage pairing fails.
EOF

if [[ "$DAT_POKER_DOMAIN" == *.sslip.io ]]; then
  cat <<'EOF'

That sslip.io name works until you buy a domain such as dat-poker.com
and point Cloudflare A records at this Elastic IP (DNS only / grey cloud). Then:

  sudo DAT_POKER_DOMAIN=dat-poker.com bash /opt/dat-poker/deploy/aws-ec2/enable-https.sh
EOF
fi
