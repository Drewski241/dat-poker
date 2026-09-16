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
| `redeploy.sh` | `git fetch` + rebuild + restart API on an existing beta host |
| `enable-https.sh` | Caddy + Let’s Encrypt (`sslip.io` or your domain) so Sage can pair |
| `enable-sage.sh` | Write WalletConnect project ID + DAT asset id, restart API |
| `Caddyfile` / `caddy.service` | TLS reverse proxy in front of the API + static UI |
| `landing.html` | Static DAT POKER page used by the nginx kit **before** the SPA build is copied |
| `public-url.sh` | Print the HTTPS Home / Play URLs to share with testers |
| `nginx.conf` | Port 80 → static UI + `/health` and `/v1` to the API |
| `dat-poker-api.service` | systemd unit for the REST API |
| `cloudformation.yaml` | Optional first-server stack |
| `beta-cloudformation.yaml` | Beta stack with Elastic IP (`CAPABILITY_IAM`) |
| `validate.sh` | Local checks (no AWS keys) |
