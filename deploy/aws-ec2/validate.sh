#!/usr/bin/env bash
# Local checks for the AWS EC2 first-server kit (no AWS credentials required).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DIR="$ROOT/deploy/aws-ec2"
export DAT_POKER_EC2_DIR="$DIR"
PASS=0
FAIL=0

ok() { echo "PASS  $*"; PASS=$((PASS + 1)); }
bad() { echo "FAIL  $*" >&2; FAIL=$((FAIL + 1)); }

bash -n "$DIR/user-data.sh" && ok "user-data.sh bash syntax" || bad "user-data.sh bash syntax"

if grep -q 'NODE_VERSION=' "$DIR/user-data.sh" \
  && grep -q 'node_ver=' "$DIR/user-data.sh"; then
  ok "user-data.sh defines NODE_VERSION for Node tarball download"
else
  bad "user-data.sh NODE_VERSION"
fi

if grep -q 'AWSTemplateFormatVersion' "$DIR/cloudformation.yaml" \
  && grep -q 'AWS::EC2::Instance' "$DIR/cloudformation.yaml" \
  && grep -q 'UserData' "$DIR/cloudformation.yaml"; then
  ok "cloudformation.yaml declares an EC2 instance with UserData"
else
  bad "cloudformation.yaml missing EC2/UserData"
fi

python3 - <<'PY' && ok "cloudformation.yaml is parseable YAML" || bad "cloudformation.yaml YAML parse"
from pathlib import Path
import os
import yaml

text = Path(os.environ["DAT_POKER_EC2_DIR"], "cloudformation.yaml").read_text()

class CfnLoader(yaml.SafeLoader):
    pass

def _cfn_tag(loader, suffix, node):
    if isinstance(node, yaml.ScalarNode):
        return loader.construct_scalar(node)
    if isinstance(node, yaml.SequenceNode):
        return loader.construct_sequence(node)
    if isinstance(node, yaml.MappingNode):
        return loader.construct_mapping(node)
    return None

CfnLoader.add_multi_constructor("!", _cfn_tag)
data = yaml.load(text, Loader=CfnLoader)
assert data["AWSTemplateFormatVersion"] == "2010-09-09"
assert data["Resources"]["DatPokerInstance"]["Type"] == "AWS::EC2::Instance"
assert "UserData" in data["Resources"]["DatPokerInstance"]["Properties"]
PY

for f in landing.html nginx.conf dat-poker-api.service user-data.sh cloudformation.yaml apache-commands.sh httpd-dat-poker.conf redeploy.sh beta-cloudformation.yaml console-user-data.sh; do
  [[ -s "$DIR/$f" ]] && ok "$f exists" || bad "$f missing"
done

bash -n "$DIR/console-user-data.sh" && ok "console-user-data.sh bash syntax" || bad "console-user-data.sh bash syntax"
bash -n "$DIR/redeploy.sh" && ok "redeploy.sh bash syntax" || bad "redeploy.sh bash syntax"

if grep -q 'raw.githubusercontent.com/Drewski241/dat-poker' "$DIR/console-user-data.sh"; then
  ok "console-user-data.sh fetches user-data.sh from GitHub"
else
  bad "console-user-data.sh GitHub curl"
fi

if grep -q 'AWS::EC2::EIP' "$DIR/beta-cloudformation.yaml" \
  && grep -q 'dat-poker-beta' "$DIR/beta-cloudformation.yaml"; then
  ok "beta-cloudformation.yaml declares an Elastic IP beta host"
else
  bad "beta-cloudformation.yaml"
fi

bash -n "$DIR/apache-commands.sh" && ok "apache-commands.sh bash syntax" || bad "apache-commands.sh bash syntax"

if grep -q 'sudo yum install -y httpd' "$DIR/apache-commands.sh" \
  && grep -q '/var/www/html/index.html' "$DIR/apache-commands.sh"; then
  ok "apache-commands.sh matches the Builder Center httpd tutorial"
else
  bad "apache-commands.sh tutorial commands"
fi

if grep -q 'AmazonSSMManagedInstanceCore' "$DIR/cloudformation.yaml"; then
  ok "cloudformation.yaml attaches the SSM instance role"
else
  bad "cloudformation.yaml missing SSM role"
fi

if grep -q 'DAT POKER' "$DIR/landing.html" && grep -q '/health' "$DIR/landing.html"; then
  ok "landing.html identifies DAT POKER and probes /health"
else
  bad "landing.html content"
fi

if grep -q 'proxy_pass http://127.0.0.1:4000' "$DIR/nginx.conf" \
  && grep -q 'listen 80' "$DIR/nginx.conf"; then
  ok "nginx.conf proxies API and listens on 80"
else
  bad "nginx.conf reverse-proxy"
fi

if grep -q 'ExecStart=/usr/local/bin/node /opt/dat-poker/services/api/dist/index.js' "$DIR/dat-poker-api.service"; then
  ok "systemd unit starts the built API"
else
  bad "systemd unit ExecStart"
fi

python3 - <<'PY' && ok "landing.html served over HTTP" || bad "landing.html HTTP serve"
import http.server
import os
import socket
import threading
from pathlib import Path
from urllib.request import urlopen

root = Path(os.environ["DAT_POKER_EC2_DIR"])
html = (root / "landing.html").read_bytes()

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path in ("/", "/index.html"):
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(html)))
            self.end_headers()
            self.wfile.write(html)
        else:
            self.send_error(404)
    def log_message(self, *args):
        pass

sock = socket.socket()
sock.bind(("127.0.0.1", 0))
port = sock.getsockname()[1]
sock.close()
httpd = http.server.HTTPServer(("127.0.0.1", port), Handler)
thread = threading.Thread(target=httpd.serve_forever, daemon=True)
thread.start()
body = urlopen(f"http://127.0.0.1:{port}/", timeout=5).read().decode()
httpd.shutdown()
assert "DAT POKER" in body
assert "nginx" in body.lower() or "EC2" in body
print(f"served {len(body)} bytes on 127.0.0.1:{port}")
PY

if [[ -f "$ROOT/docs/AWS_EC2.md" ]] \
  && grep -q 'Launch an instance using EC2' "$ROOT/docs/AWS_EC2.md" \
  && grep -q 'Session Manager' "$ROOT/docs/AWS_EC2.md" \
  && grep -q 'sudo yum install -y httpd' "$ROOT/docs/AWS_EC2.md"; then
  ok "docs/AWS_EC2.md covers the Builder Center Apache tutorial"
else
  bad "docs/AWS_EC2.md"
fi

if [[ -f "$ROOT/docs/BETA.md" ]] && grep -q 'Elastic IP' "$ROOT/docs/BETA.md"; then
  ok "docs/BETA.md covers the public beta host"
else
  bad "docs/BETA.md"
fi

if grep -q 'VITE_APP_STAGE' "$ROOT/apps/web/src/App.tsx" \
  && grep -q 'beta-banner' "$ROOT/apps/web/src/App.tsx"; then
  ok "web client shows a beta banner when VITE_APP_STAGE=beta"
else
  bad "web beta banner"
fi

if [[ -f "$ROOT/.env.beta.example" ]] && grep -q 'DAT_ALLOW_DEV_BUYIN=true' "$ROOT/.env.beta.example"; then
  ok ".env.beta.example enables dev buy-in"
else
  bad ".env.beta.example"
fi

echo
echo "$PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
