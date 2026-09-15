# AWS EC2 first server

The **$20** email maps to AWS Builder Center
[Deploy a web server to the cloud](https://builder.aws.com/content/3BfvbBpwbonTDicuPTMLZBTt4Br/deploy-a-web-server-to-the-cloud)
(Apache `httpd` + Session Manager). Click-through:
[docs/AWS_EC2.md](../../docs/AWS_EC2.md).

**You must launch from your AWS account.** Do not paste `user-data.sh` during
that tutorial.

| File | Purpose |
|------|---------|
| `apache-commands.sh` | Verbatim Apache commands from the Builder Center article |
| `httpd-dat-poker.conf` | Optional Apache reverse proxy after the tutorial page works |
| `user-data.sh` | Optional nginx + DAT POKER bootstrap (not the email path) |
| `landing.html` | Static DAT POKER page used by the nginx kit |
| `nginx.conf` | Port 80 → static UI + `/health` and `/v1` to the API |
| `dat-poker-api.service` | systemd unit for the REST API |
| `cloudformation.yaml` | Optional one-stack DAT POKER launch (`CAPABILITY_IAM`) |
| `validate.sh` | Local checks (no AWS keys) |
