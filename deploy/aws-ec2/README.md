# AWS EC2 first server

The **$20** email maps to AWS Builder Center
[Deploy a web server to the cloud](https://builder.aws.com/content/3BfvbBpwbonTDicuPTMLZBTt4Br/deploy-a-web-server-to-the-cloud)
(Apache `httpd` + Session Manager). Click-through:
[docs/AWS_EC2.md](../../docs/AWS_EC2.md).

After that credit posts, run the poker **beta** with
[docs/BETA.md](../../docs/BETA.md).

**You must launch from your AWS account.** Do not paste `user-data.sh` during
the Apache tutorial.

| File | Purpose |
|------|---------|
| `apache-commands.sh` | Verbatim Apache commands from the Builder Center article |
| `httpd-dat-poker.conf` | Optional Apache reverse proxy after the tutorial page works |
| `console-user-data.sh` | **Paste this** into Launch instance → User data |
| `user-data.sh` | Full bootstrap (pulled by the paste snippet) |
| `redeploy.sh` | `git fetch` + rebuild + restart API and always-on treasury on an existing beta host |
| `enable-https.sh` | Caddy + Let’s Encrypt (`datspiritpoker.com` or `sslip.io`) so Sage can pair. Writes quoted `DAT_POKER_SITE` in `/etc/caddy/caddy.env` so `host, www.host` is not parsed as a command |
| `enable-sage.sh` | Write WalletConnect project ID + DAT asset id, restart API |
| `enable-onchain-withdraw.sh` | Persist `DAT_TREASURY_PAYOUT_URL` (defaults to `127.0.0.1:4200`) so testers can import a DAT offer in player Sage |
| `start-treasury.sh` | Repair path to start `dat-poker-treasury` (`127.0.0.1:4200`); bootstrap and redeploy already enable it |
| `enable-treasury-sage.sh` | Find or start Sage RPC on this host, write `wallet.crt` paths, restart treasury |
| `load-treasury-key.sh` | Load or replace the dedicated treasury spend key (file or silent TTY). Does not print the secret |
| `dat-poker-sage-rpc.service` / `start-sage-rpc.sh` | systemd Sage RPC (`:9257`, localhost) so offers work while the site is up |
| `Caddyfile` / `caddy.service` | TLS reverse proxy in front of the API + static UI |
| `landing.html` | Static DAT POKER page used by the nginx kit **before** the SPA build is copied |
| `public-url.sh` | Print the HTTPS Home / Play URLs to share with testers |
| `nginx.conf` | Port 80 → static UI + `/health` and `/v1` to the API |
| `dat-poker-api.service` | systemd unit for the REST API |
| `dat-poker-treasury.service` | systemd unit for treasury payout (`Restart=always`, boot-enabled with the website) |
| `cloudformation.yaml` | Optional first-server stack |
| `beta-cloudformation.yaml` | Beta stack with Elastic IP (`CAPABILITY_IAM`) |
| `validate.sh` | Local checks (no AWS keys) |
