#!/bin/bash
# Verbatim commands from AWS Builder Center:
# https://builder.aws.com/content/3BfvbBpwbonTDicuPTMLZBTt4Br/deploy-a-web-server-to-the-cloud
# Run ONLY in EC2 Session Manager on Amazon Linux 2023 (user ssm-user).
# Do not run this on your laptop (Ubuntu has apt, not yum).
set -euo pipefail

if ! command -v yum >/dev/null 2>&1; then
  echo "yum not found — this is not Amazon Linux." >&2
  echo "In AWS Console: EC2 → instance my-web-server → Connect → Session Manager." >&2
  echo "whoami should print ssm-user. Then run these commands in that browser shell." >&2
  exit 1
fi

set -x
sudo yum install -y httpd
sudo systemctl start httpd
sudo systemctl enable httpd
sudo systemctl status httpd --no-pager

sudo tee /var/www/html/index.html >/dev/null <<'HTML'
<pre>
  __( )< (woof)
  \___)
</pre>
HTML

curl -fsS http://127.0.0.1/ | head
