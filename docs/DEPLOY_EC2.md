# Deploy / redeploy on EC2

Production deploys use the kit under **`deploy/aws-ec2/`** (Caddy/nginx, systemd, bootstrap).

Full runbook: **[deploy/aws-ec2/DEPLOY.md](../deploy/aws-ec2/DEPLOY.md)** and **[docs/BETA.md](./BETA.md)**.

## Redeploy (your usual pattern)

On the beta host (Session Manager or SSH), set the git ref and run `up.sh`:

```bash
sudo bash -c 'export DAT_POKER_REPO_REF=cursor/spirit-slots-game-4501; bash /opt/dat-poker/deploy/aws-ec2/up.sh'
```

Wait for **`beta redeploy ok`**.

- `DAT_POKER_REPO_REF` — branch or tag to fetch (shallow `git fetch --depth 1`)
- `INSTALL_ROOT` — defaults to `/opt/dat-poker`
- `up.sh` checks out the ref, then runs `redeploy.sh` (build API + web, copy dist to nginx/html, restart `dat-poker-api`)

Other branches (example):

```bash
sudo bash -c 'export DAT_POKER_REPO_REF=cursor/trust-rails-fairness-7c36; bash /opt/dat-poker/deploy/aws-ec2/up.sh'
```

## Spirit Slots env (appended on redeploy if missing)

- `DAT_DAILY_REDEEM_MOJOS=5000000` — 5000 DAT play chips / UTC day
- `DAT_SPIN_COST_MOJOS=1000` — 1 DAT per spin

See root `.env.example` for WalletConnect, DAT asset id, and treasury URL.
