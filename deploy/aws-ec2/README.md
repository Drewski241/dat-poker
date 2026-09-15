# AWS EC2 first server

Launch kit for the AWS Free Tier **Launch an instance using EC2** activity
($20 credit) plus a DAT POKER nginx/API box.

**You must launch from your AWS account.** Step-by-step:
[docs/AWS_EC2.md](../../docs/AWS_EC2.md).

| File | Purpose |
|------|---------|
| `user-data.sh` | Paste into EC2 Launch instance → User data |
| `landing.html` | Immediate nginx page (tutorial “serve a web page”) |
| `nginx.conf` | Port 80 → static UI + `/health` and `/v1` to the API |
| `dat-poker-api.service` | systemd unit for the REST API |
| `cloudformation.yaml` | Optional one-stack launch |
| `validate.sh` | Local checks (no AWS keys) |
