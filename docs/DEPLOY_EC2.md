# Deploy / redeploy on EC2

Production deploys use the kit under **`deploy/aws-ec2/`** (Caddy/nginx, systemd, bootstrap).

Full runbook: **[deploy/aws-ec2/DEPLOY.md](../deploy/aws-ec2/DEPLOY.md)** and **[docs/BETA.md](./BETA.md)**.

## Redeploy (Spirit Slots — required ref)

Spirit Slots **only exist on** `cursor/spirit-slots-game-4501`. Redeploying
`cursor/trust-rails-fairness-7c36` (or the old MTT branch) replaces the UI with
the lobby/MTT client and **removes** the slot machine.

On the beta host (Session Manager or SSH):

```bash
sudo bash /opt/dat-poker/deploy/aws-ec2/pull-spirit-slots.sh
```

Or explicitly:

```bash
sudo bash -c 'export DAT_POKER_REPO_REF=cursor/spirit-slots-game-4501; bash /opt/dat-poker/deploy/aws-ec2/up.sh'
```

Wait for **`beta redeploy ok`** and the line **`Spirit Slots UI: open /slots`**.

Then open **https://datspiritpoker.com/slots** (or **/play** → click **✨ Spirit Slots** in the top nav).

Verify the build on the box:

```bash
grep -l 'Spirit Slots' /usr/share/nginx/html/assets/*.js
curl -s http://127.0.0.1:4000/v1/play/config
```

## Spirit Slots env (appended on redeploy if missing)

- `DAT_DAILY_REDEEM_MOJOS=5000000` — 5000 DAT play chips / UTC day
- `DAT_SPIN_COST_MOJOS=1000` — 1 DAT per spin

See root `.env.example` for WalletConnect, DAT asset id, and treasury URL.
