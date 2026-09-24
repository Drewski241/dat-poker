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

if grep -q 'wait_for_api()' "$DIR/user-data.sh" \
  && grep -q 'dump_api_logs()' "$DIR/user-data.sh" \
  && grep -q 'journalctl -u dat-poker-api' "$DIR/user-data.sh"; then
  ok "user-data.sh retries API health and dumps systemd logs on failure"
else
  bad "user-data.sh API health retry"
fi

if grep -q 'wait_for_treasury()' "$DIR/user-data.sh" \
  && grep -q 'write_treasury_unit()' "$DIR/user-data.sh" \
  && grep -q 'systemctl enable --now dat-poker-treasury' "$DIR/user-data.sh" \
  && grep -q 'DAT_TREASURY_PAYOUT_URL' "$DIR/user-data.sh" \
  && grep -q '@dat-poker/treasury-payout' "$DIR/user-data.sh"; then
  ok "user-data.sh enables always-on treasury with the website"
else
  bad "user-data.sh always-on treasury"
fi

python3 - <<'PY' && ok "wait_for_api succeeds after a delayed /health listener" || bad "wait_for_api delayed listener"
import http.server
import os
import socket
import subprocess
import threading
import time
from pathlib import Path

sock = socket.socket()
sock.bind(("127.0.0.1", 0))
port = sock.getsockname()[1]
sock.close()
body = b'{"status":"ok","service":"dat-poker-api"}'

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_error(404)
    def log_message(self, *args):
        pass

httpd_holder = {}

def start():
    time.sleep(2)
    httpd_holder["s"] = http.server.HTTPServer(("127.0.0.1", port), Handler)
    httpd_holder["s"].serve_forever()

thread = threading.Thread(target=start, daemon=True)
thread.start()
script = Path(os.environ["DAT_POKER_EC2_DIR"], "user-data.sh").read_text()
fn_start = script.index("wait_for_api() {")
fn_end = script.index("\n}", fn_start) + 2
fn = script[fn_start:fn_end]
proc = subprocess.run(
    ["bash", "-c", fn + f'\nwait_for_api http://127.0.0.1:{port}/health 10\n'],
    check=False,
    capture_output=True,
    text=True,
)
if "s" in httpd_holder:
    httpd_holder["s"].shutdown()
assert proc.returncode == 0, proc.stderr + proc.stdout
assert "API healthy after" in proc.stdout
# Port is closed for 2s, so the first curl must be connection-refused.
assert "after 1s" not in proc.stdout
print(proc.stdout.strip())
PY

if grep -q 'seq 1 30' "$DIR/redeploy.sh" \
  && grep -q 'http://127.0.0.1:4000/health' "$DIR/redeploy.sh" \
  && grep -q 'DAT_POKER_REDEPLOY_REEXEC' "$DIR/redeploy.sh"; then
  ok "redeploy.sh re-execs after git checkout and retries :4000/health"
else
  bad "redeploy.sh API health retry"
fi

if grep -q 'systemctl enable dat-poker-treasury' "$DIR/redeploy.sh" \
  && grep -q 'systemctl restart dat-poker-treasury' "$DIR/redeploy.sh" \
  && grep -q 'http://127.0.0.1:4200/health' "$DIR/redeploy.sh" \
  && grep -q 'DAT_TREASURY_PAYOUT_URL' "$DIR/redeploy.sh" \
  && ! grep -q 'is-enabled --quiet dat-poker-treasury' "$DIR/redeploy.sh"; then
  ok "redeploy.sh always enables and waits for treasury :4200/health"
else
  bad "redeploy.sh always-on treasury"
fi

if grep -q 'Restart=always' "$DIR/dat-poker-treasury.service" \
  && grep -q 'ExecStart=/usr/local/bin/node /opt/dat-poker/services/treasury-payout/dist/index.js' "$DIR/dat-poker-treasury.service" \
  && grep -q 'WantedBy=multi-user.target' "$DIR/dat-poker-treasury.service"; then
  ok "dat-poker-treasury.service restarts always and starts on boot"
else
  bad "dat-poker-treasury.service always-on"
fi

if grep -q 'DAT_TREASURY_PAYOUT_URL=http://127.0.0.1:4200/payout' "$ROOT/.env.beta.example" \
  && grep -q 'DAT_ENABLE_ONCHAIN_WITHDRAW=true' "$ROOT/.env.beta.example"; then
  ok ".env.beta.example points the API at local treasury"
else
  bad ".env.beta.example treasury URL"
fi

if grep -q 'dat-poker-treasury' "$ROOT/docs/BETA.md" \
  && grep -q '127.0.0.1:4200' "$ROOT/docs/BETA.md" \
  && grep -q 'always-on treasury' "$ROOT/docs/BETA.md"; then
  ok "docs/BETA.md covers always-on AWS treasury"
else
  bad "docs/BETA.md always-on treasury"
fi

python3 - <<'PY' && ok "wait_for_treasury succeeds after a delayed /health listener" || bad "wait_for_treasury delayed listener"
import http.server
import os
import socket
import subprocess
import threading
import time
from pathlib import Path

sock = socket.socket()
sock.bind(("127.0.0.1", 0))
port = sock.getsockname()[1]
sock.close()
body = b'{"status":"ok","offerMode":"mock","walletRpcReachable":false}'

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_error(404)
    def log_message(self, *args):
        pass

httpd_holder = {}

def start():
    time.sleep(2)
    httpd_holder["s"] = http.server.HTTPServer(("127.0.0.1", port), Handler)
    httpd_holder["s"].serve_forever()

thread = threading.Thread(target=start, daemon=True)
thread.start()
script = Path(os.environ["DAT_POKER_EC2_DIR"], "user-data.sh").read_text()
fn_start = script.index("wait_for_treasury() {")
fn_end = script.index("\n}", fn_start) + 2
fn = script[fn_start:fn_end]
proc = subprocess.run(
    ["bash", "-c", fn + f'\nwait_for_treasury http://127.0.0.1:{port}/health 10\n'],
    check=False,
    capture_output=True,
    text=True,
)
if "s" in httpd_holder:
    httpd_holder["s"].shutdown()
assert proc.returncode == 0, proc.stderr + proc.stdout
assert "Treasury healthy after" in proc.stdout
assert "after 1s" not in proc.stdout
print(proc.stdout.strip())
PY

if grep -q 'dat-poker-bootstrap.web-only' "$ROOT/docs/BETA.md" \
  && grep -q 'systemctl status dat-poker-api' "$ROOT/docs/BETA.md"; then
  ok "docs/BETA.md covers the systemd vs curl race"
else
  bad "docs/BETA.md health-check race"
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

for f in landing.html nginx.conf dat-poker-api.service dat-poker-treasury.service dat-poker-sage-rpc.service user-data.sh cloudformation.yaml apache-commands.sh httpd-dat-poker.conf redeploy.sh beta-cloudformation.yaml console-user-data.sh Caddyfile caddy.service enable-https.sh enable-sage.sh enable-onchain-withdraw.sh start-treasury.sh start-sage-rpc.sh enable-treasury-sage.sh public-url.sh; do
  [[ -s "$DIR/$f" ]] && ok "$f exists" || bad "$f missing"
done

bash -n "$DIR/console-user-data.sh" && ok "console-user-data.sh bash syntax" || bad "console-user-data.sh bash syntax"
bash -n "$DIR/redeploy.sh" && ok "redeploy.sh bash syntax" || bad "redeploy.sh bash syntax"
bash -n "$DIR/enable-https.sh" && ok "enable-https.sh bash syntax" || bad "enable-https.sh bash syntax"
bash -n "$DIR/enable-sage.sh" && ok "enable-sage.sh bash syntax" || bad "enable-sage.sh bash syntax"
bash -n "$DIR/enable-onchain-withdraw.sh" && ok "enable-onchain-withdraw.sh bash syntax" || bad "enable-onchain-withdraw.sh bash syntax"
bash -n "$DIR/start-treasury.sh" && ok "start-treasury.sh bash syntax" || bad "start-treasury.sh bash syntax"
bash -n "$DIR/start-sage-rpc.sh" && ok "start-sage-rpc.sh bash syntax" || bad "start-sage-rpc.sh bash syntax"
bash -n "$DIR/enable-treasury-sage.sh" && ok "enable-treasury-sage.sh bash syntax" || bad "enable-treasury-sage.sh bash syntax"
bash -n "$DIR/public-url.sh" && ok "public-url.sh bash syntax" || bad "public-url.sh bash syntax"

if grep -q 'wallet.crt' "$DIR/enable-treasury-sage.sh" \
  && grep -q 'TREASURY_WALLET_CERT_PATH' "$DIR/enable-treasury-sage.sh" \
  && grep -q 'dat-poker-sage-rpc' "$DIR/enable-treasury-sage.sh" \
  && grep -q 'install_prebuilt_sage_cli' "$DIR/enable-treasury-sage.sh" \
  && grep -q 'free_sage_build_space' "$DIR/enable-treasury-sage.sh" \
  && grep -q 'sage_runs' "$DIR/enable-treasury-sage.sh" \
  && grep -q 'SAGE_CREATE_KEY' "$DIR/enable-treasury-sage.sh" \
  && grep -q 'import_treasury_key' "$DIR/enable-treasury-sage.sh" \
  && grep -q 'TREASURY_SAGE_PRIVATE_KEY' "$DIR/enable-treasury-sage.sh" \
  && grep -q 'describe_env_secret' "$DIR/enable-treasury-sage.sh" \
  && grep -q 'paste_treasury_secret' "$DIR/enable-treasury-sage.sh"; then
  ok "enable-treasury-sage.sh writes Sage RPC cert paths and uses prebuilt sage-cli"
else
  bad "enable-treasury-sage.sh cert paths"
fi

if grep -q 'StartLimitBurst=5' "$DIR/dat-poker-sage-rpc.service"; then
  ok "dat-poker-sage-rpc.service stops crash-looping after 5 failures"
else
  bad "dat-poker-sage-rpc.service StartLimitBurst"
fi

if [[ -x "$DIR/bin/sage-linux-x86_64" ]]; then
  if objdump -T "$DIR/bin/sage-linux-x86_64" 2>/dev/null | grep -q 'GLIBC_2.38'; then
    bad "prebuilt sage-cli requires GLIBC_2.38 (Amazon Linux 2023 is 2.34)"
  else
    ok "prebuilt sage-cli binary is present and does not need glibc 2.38"
  fi
else
  bad "prebuilt sage-cli binary missing at deploy/aws-ec2/bin/sage-linux-x86_64"
fi

python3 - <<'PY' && ok "public-url.sh prints HTTPS home and /play" || bad "public-url.sh output"
import os
import subprocess
from pathlib import Path

script = Path(os.environ["DAT_POKER_EC2_DIR"], "public-url.sh")
proc = subprocess.run(
    ["bash", str(script)],
    check=True,
    capture_output=True,
    text=True,
    env={**os.environ, "DAT_POKER_DOMAIN": "54-12-34-56.sslip.io"},
)
out = proc.stdout
assert "https://54-12-34-56.sslip.io/" in out, out
assert "https://54-12-34-56.sslip.io/play" in out, out
assert "DAT_POKER_DOMAIN=datspiritpoker.com" in out, out
print(out.strip())
PY

python3 - <<'PY' && ok "public-url.sh prints https://datspiritpoker.com/" || bad "public-url.sh datspiritpoker.com"
import os
import subprocess
from pathlib import Path

script = Path(os.environ["DAT_POKER_EC2_DIR"], "public-url.sh")
proc = subprocess.run(
    ["bash", str(script)],
    check=True,
    capture_output=True,
    text=True,
    env={**os.environ, "DAT_POKER_DOMAIN": "datspiritpoker.com"},
)
out = proc.stdout
assert "https://datspiritpoker.com/" in out, out
assert "https://datspiritpoker.com/play" in out, out
assert "sslip.io" not in out, out
print(out.strip())
PY

python3 - <<'PY' && ok "enable-https.sh maps Elastic IP to sslip.io" || bad "sslip.io domain helper"
import os
import subprocess
from pathlib import Path

script = Path(os.environ["DAT_POKER_EC2_DIR"], "enable-https.sh").read_text()
start = script.index("ip_to_sslip() {")
end = script.index("\n}", start) + 2
fn = script[start:end]
proc = subprocess.run(
    ["bash", "-c", fn + '\nip_to_sslip 54.12.34.56\n'],
    check=True,
    capture_output=True,
    text=True,
)
assert proc.stdout.strip() == "54-12-34-56.sslip.io", proc.stdout
print(proc.stdout.strip())
PY

python3 - <<'PY' && ok "enable-https.sh wait_for_dns_a resolves localhost" || bad "wait_for_dns_a"
import os
import subprocess
from pathlib import Path

script = Path(os.environ["DAT_POKER_EC2_DIR"], "enable-https.sh").read_text()
start = script.index("dns_a() {")
end = script.index("\ninstall_caddy() {")
fn = script[start:end]
proc = subprocess.run(
    ["bash", "-c", fn + "\nwait_for_dns_a localhost 127.0.0.1 5\n"],
    check=False,
    capture_output=True,
    text=True,
)
assert proc.returncode == 0, proc.stderr + proc.stdout
assert "DNS localhost -> 127.0.0.1" in proc.stdout, proc.stdout
print(proc.stdout.strip())
PY

if grep -q 'reverse_proxy 127.0.0.1:4000' "$DIR/Caddyfile" \
  && grep -q 'handle /v1/' "$DIR/Caddyfile" \
  && grep -q 'DAT_POKER_SITE' "$DIR/Caddyfile" \
  && grep -q 'Content-Security-Policy' "$DIR/Caddyfile" \
  && grep -q 'max_size 8MB' "$DIR/Caddyfile"; then
  ok "Caddyfile proxies /health and /v1 to the API with CSP"
else
  bad "Caddyfile reverse-proxy"
fi

python3 - <<'PY' && ok "enable-https.sh bakes hostnames into Caddyfile" || bad "Caddyfile hostname bake"
import os, re, subprocess, tempfile
from pathlib import Path

root = Path(os.environ["DAT_POKER_EC2_DIR"])
src = (root / "Caddyfile").read_text()
assert "{$DAT_POKER_SITE}" in src
site = "datspiritpoker.com, www.datspiritpoker.com"
out = src.replace("{$DAT_POKER_SITE}", site)
assert "datspiritpoker.com, www.datspiritpoker.com {" in out
assert "{$DAT_POKER_SITE}" not in out
script = (root / "enable-https.sh").read_text()
assert r"s|{\$DAT_POKER_SITE}|" in script
assert "systemctl reset-failed caddy" in script
assert 'DAT_POKER_SITE="%s"' in script, script[script.index("DAT_POKER_SITE"):script.index("DAT_POKER_SITE")+80]
print("baked", site)
PY

python3 - <<'PY' && ok "caddy.env SITE quoting survives bash source; redeploy parses unquoted" || bad "caddy.env SITE quoting"
import os
import subprocess
import tempfile
from pathlib import Path

root = Path(os.environ["DAT_POKER_EC2_DIR"])
redeploy = (root / "redeploy.sh").read_text()
assert "source /etc/caddy/caddy.env" not in redeploy
assert "s/^DAT_POKER_SITE=//" in redeploy

unquoted = (
    "DAT_POKER_DOMAIN=datspiritpoker.com\n"
    "DAT_POKER_SITE=datspiritpoker.com, www.datspiritpoker.com\n"
)
quoted = (
    "DAT_POKER_DOMAIN=datspiritpoker.com\n"
    'DAT_POKER_SITE="datspiritpoker.com, www.datspiritpoker.com"\n'
)

def source_env(text: str):
    with tempfile.NamedTemporaryFile("w", delete=False) as fh:
        fh.write(text)
        path = fh.name
    try:
        return subprocess.run(
            [
                "bash",
                "-c",
                f'set -euo pipefail; set -a; source "{path}"; set +a; printf "%s" "$DAT_POKER_SITE"',
            ],
            capture_output=True,
            text=True,
        )
    finally:
        os.unlink(path)

bad_proc = source_env(unquoted)
assert bad_proc.returncode != 0, "unquoted SITE must fail under set -e"
assert "command not found" in (bad_proc.stderr + bad_proc.stdout)

good_proc = source_env(quoted)
assert good_proc.returncode == 0, good_proc.stderr + good_proc.stdout
assert good_proc.stdout == "datspiritpoker.com, www.datspiritpoker.com", good_proc.stdout

with tempfile.NamedTemporaryFile("w", delete=False) as fh:
    fh.write(unquoted)
    path = fh.name
try:
    parse = subprocess.run(
        [
            "bash",
            "-c",
            rf"""
set -euo pipefail
raw="$(sed -n 's/^DAT_POKER_SITE=//p' "{path}" | tail -n1 || true)"
raw="${{raw#\"}}"
raw="${{raw%\"}}"
printf '%s' "$raw"
""",
        ],
        capture_output=True,
        text=True,
    )
finally:
    os.unlink(path)
assert parse.returncode == 0, parse.stderr + parse.stdout
assert parse.stdout == "datspiritpoker.com, www.datspiritpoker.com", parse.stdout
print("quoted source ok; sed recovers unquoted SITE")
PY

if grep -q 'WALLETCONNECT_PROJECT_ID' "$DIR/enable-sage.sh" \
  && grep -q 'DAT_GOVERNANCE_TOKEN_ASSET_ID' "$DIR/enable-sage.sh" \
  && grep -q '64' "$DIR/enable-sage.sh"; then
  ok "enable-sage.sh writes WalletConnect + 64-char CAT asset id"
else
  bad "enable-sage.sh env keys"
fi

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

if grep -q 'enable-https.sh' "$ROOT/docs/BETA.md" \
  && grep -q 'cloud.reown.com' "$ROOT/docs/BETA.md" \
  && grep -q 'DAT_GOVERNANCE_TOKEN_ASSET_ID' "$ROOT/docs/BETA.md"; then
  ok "docs/BETA.md covers HTTPS + Sage WalletConnect"
else
  bad "docs/BETA.md Sage HTTPS"
fi

if grep -q 'try_files $uri $uri/ /index.html' "$DIR/nginx.conf" \
  && grep -q 'try_files {path} /index.html' "$DIR/Caddyfile"; then
  ok "nginx and Caddy fall back to the SPA for /play"
else
  bad "SPA try_files for /play"
fi

if grep -q 'Play poker now!' "$ROOT/apps/web/src/Landing.tsx" \
  && grep -q 'pathToPage' "$ROOT/apps/web/src/Root.tsx" \
  && grep -q '/play' "$ROOT/apps/web/src/site-route.ts" \
  && grep -q '/feedback' "$ROOT/apps/web/src/site-route.ts"; then
  ok "web client has a public landing site, /play table, and /feedback"
else
  bad "web landing /play"
fi

if grep -q 'Invite testers' "$ROOT/docs/BETA.md" \
  && grep -q 'public-url.sh' "$ROOT/docs/BETA.md" \
  && grep -q 'https://datspiritpoker.com/' "$ROOT/docs/BETA.md"; then
  ok "docs/BETA.md tells you which website URL to share"
else
  bad "docs/BETA.md invite testers"
fi

if grep -q 'name="description"' "$ROOT/apps/web/index.html" \
  && grep -q 'noindex' "$ROOT/apps/web/index.html"; then
  ok "index.html has share meta tags and noindex for closed beta"
else
  bad "index.html meta"
fi

if grep -q 'pageIsHttp' "$ROOT/apps/web/src/App.tsx" \
  && grep -q 'datspiritpoker.com' "$ROOT/apps/web/src/App.tsx"; then
  ok "web client warns when Sage is opened over HTTP"
else
  bad "web HTTP Sage warning"
fi

if grep -q 'Website address' "$ROOT/docs/BETA.md" \
  && grep -q 'dash.cloudflare.com' "$ROOT/docs/BETA.md" \
  && grep -q 'DAT_POKER_DOMAIN=datspiritpoker.com' "$ROOT/docs/BETA.md"; then
  ok "docs/BETA.md points testers at datspiritpoker.com"
else
  bad "docs/BETA.md website address"
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

if grep -q 'registerFeedbackRoutes' "$ROOT/services/api/src/index.ts" \
  && grep -q 'pathToPage("/feedback")' "$ROOT/apps/web/src/site-route.test.ts"; then
  ok "tester feedback API and /feedback page"
else
  bad "tester feedback"
fi

if grep -q 'SAGE_SPEND_METHODS' "$ROOT/apps/web/src/wallet/constants.ts" \
  && ROOT="$ROOT" python3 - <<'PY'
from pathlib import Path
import os
text = Path(os.environ["ROOT"], "apps/web/src/wallet/constants.ts").read_text()
start = text.index("export const SAGE_WC_METHODS")
end = text.index("] as const", start)
block = text[start:end]
assert "chia_send" not in block, block
assert "chia_takeOffer" not in block, block
PY
then
  ok "WalletConnect namespaces omit Sage spend RPCs"
else
  bad "WalletConnect spend methods"
fi

echo
echo "$PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
