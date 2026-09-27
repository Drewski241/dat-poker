# Deploy DAT POKER on AWS (beta host)

This kit deploys the **web client + REST API** on one Amazon Linux 2023 EC2
instance (nginx on `:80`, API on `:4000`). Treasury Sage and
`pnpm dev:treasury` stay on a **separate** machine ([docs/TREASURY.md](../../docs/TREASURY.md)).

**Branch with 9/16-player SNG, prize-pool fix, and NFT lobby promo:**
`cursor/fix-sng-prize-pool-d148` (switch `RepoRef` to `main` after that PR merges).

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
    RepoRef=cursor/fix-sng-prize-pool-d148

aws cloudformation describe-stacks --stack-name dat-poker-beta \
  --query 'Stacks[0].Outputs'
```

Use the **ElasticIp** output as your public URL.

## After the box is up

| Step | Command / doc |
|------|----------------|
| HTTPS (WalletConnect) | [enable-https.sh](./enable-https.sh) — [BETA.md § HTTPS](../../docs/BETA.md) |
| Sage project + DAT asset | [enable-sage.sh](./enable-sage.sh) |
| Redeploy latest code | `sudo DAT_POKER_REPO_REF=cursor/fix-sng-prize-pool-d148 bash /opt/dat-poker/deploy/aws-ec2/redeploy.sh` |
| NFT payouts (5× 16-player wins) | Treasury host: `pnpm dev:treasury`, NFT in treasury wallet; game `.env`: `DAT_TREASURY_PAYOUT_URL` → treasury `:4200/payout` (NFT uses `:4200/nft-payout`) |

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
