# Deploy DAT POKER on AWS (beta host)

This kit deploys the **web client + REST API** on one Amazon Linux 2023 EC2
instance (nginx on `:80`, API on `:4000`). Treasury Sage and
`pnpm dev:treasury` stay on a **separate** machine ([docs/TREASURY.md](../../docs/TREASURY.md)).

**Current beta branch (500 MTT + 16-player Sit-n-Go lobby, final-table deal fix):**
`cursor/lobby-sng16-mtt500-labels-ebbc` (PR #39; includes #38 final-table auto-deal).

## Option A — EC2 console (recommended)

Follow [docs/BETA.md](../../docs/BETA.md). Summary:

1. IAM role `dat-poker-beta-ssm` (SSM core policy).
2. Launch **Amazon Linux 2023**, **t3.small**, HTTP + HTTPS open, **20 GiB** disk.
3. Paste [console-user-data.sh](./console-user-data.sh) into **User data** (not base64).
4. Allocate and **associate an Elastic IP**.
5. Session Manager → `tail -f /var/log/dat-poker-bootstrap.log` until bootstrap finishes.
6. Open `http://<Elastic-IP>/` → Play; check `http://<Elastic-IP>/health`.

## Option B — CloudFormation

From a machine with AWS CLI configured:

```bash
git clone https://github.com/Drewski241/dat-poker.git
cd dat-poker
aws cloudformation deploy \
  --stack-name dat-poker-beta \
  --template-file deploy/aws-ec2/beta-cloudformation.yaml \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
    InstanceType=t3.small \
    RepoRef=cursor/lobby-sng16-mtt500-labels-ebbc

aws cloudformation describe-stacks --stack-name dat-poker-beta \
  --query 'Stacks[0].Outputs'
```

Use the **ElasticIp** output as your public URL.

## After the box is up

| Step | Command / doc |
|------|----------------|
| HTTPS (WalletConnect) | [enable-https.sh](./enable-https.sh) — [BETA.md § HTTPS](../../docs/BETA.md) |
| Sage project + DAT asset | [enable-sage.sh](./enable-sage.sh) |
| Redeploy latest code | `sudo bash /opt/dat-poker/deploy/aws-ec2/up.sh` (see [BETA.md § phone update](../../docs/BETA.md) if `redeploy.sh` was missing) |
| NFT payouts (20× 16-player wins) | Treasury host: `pnpm dev:treasury`, NFT in treasury wallet; game `.env`: `DAT_TREASURY_PAYOUT_URL` → treasury `:4200/payout` (NFT uses `:4200/nft-payout`) |

## Verify SNG + NFT promo

```bash
curl -s "http://127.0.0.1/v1/lobby/mtt16-nft-promo" | jq .
curl -s "http://127.0.0.1/health" | jq .
```

## Tear down

```bash
aws cloudformation delete-stack --stack-name dat-poker-beta
```

Or EC2 → terminate instance and release the Elastic IP if you are done.
