#!/usr/bin/env bash
# Phone-friendly ops glance for Session Manager.
# Usage:
#   sudo bash /opt/dat-poker/deploy/aws-ec2/ops-status.sh
# Requires DAT_OPS_TOKEN in /opt/dat-poker/.env (min 8 chars).
set -euo pipefail

ENV_FILE="${DAT_POKER_ENV_FILE:-/opt/dat-poker/.env}"
API="${DAT_POKER_API_URL:-http://127.0.0.1:4000}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "missing env: $ENV_FILE" >&2
  exit 1
fi

TOKEN="$(sed -n 's/^DAT_OPS_TOKEN=//p' "$ENV_FILE" | head -n1 | tr -d '"' | tr -d "'")"
TOKEN="${TOKEN//$'\r'/}"
if [[ ${#TOKEN} -lt 8 ]]; then
  echo "DAT_OPS_TOKEN unset or shorter than 8 chars in $ENV_FILE" >&2
  echo "Add DAT_OPS_TOKEN=... then: sudo systemctl restart dat-poker-api" >&2
  exit 1
fi

echo "== ops status =="
curl -fsS -H "x-dat-ops-token: ${TOKEN}" "${API}/v1/ops/status" | python3 -m json.tool
echo
echo "== metrics (today) =="
curl -fsS -H "x-dat-ops-token: ${TOKEN}" "${API}/v1/ops/metrics" | python3 -m json.tool
echo
echo "UI: open https://datspiritpoker.com/ops and paste the same token"
