#!/bin/bash
# Start Sage RPC in the foreground for systemd (localhost :9257).
set -euo pipefail
export HOME="${HOME:-/home/ec2-user}"
export XDG_DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"

for bin in \
  "${SAGE_BIN:-}" \
  /usr/local/bin/sage \
  /usr/bin/sage \
  /opt/dat-poker/deploy/aws-ec2/bin/sage-linux-x86_64 \
  /home/ec2-user/.cargo/bin/sage \
  "$HOME/.cargo/bin/sage"
do
  if [[ -n "$bin" && -x "$bin" ]]; then
    exec "$bin" rpc start
  fi
done

echo "sage-cli not installed. Run: sudo bash /opt/dat-poker/deploy/aws-ec2/enable-treasury-sage.sh" >&2
exit 1
