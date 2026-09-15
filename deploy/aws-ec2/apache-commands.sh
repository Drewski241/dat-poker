#!/bin/bash
# Verbatim commands from AWS Builder Center:
# https://builder.aws.com/content/3BfvbBpwbonTDicuPTMLZBTt4Br/deploy-a-web-server-to-the-cloud
# Run these in Session Manager on Amazon Linux 2023 (user ssm-user).
set -euxo pipefail

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
