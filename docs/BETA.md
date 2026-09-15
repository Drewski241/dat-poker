# DAT POKER public beta on AWS

Use this after the $20 **Launch an instance using EC2** credit is in **Billing
→ Credits** and the tutorial `my-web-server` instance is gone.

The beta is a small always-on Amazon Linux box that serves the DAT POKER web
client and REST API so you can develop the poker software against a public
URL. Tables are **in memory** — a restart wipes games. Dev buy-in is on.
Keep treasury Sage off this machine ([docs/TREASURY.md](./TREASURY.md)).

This Cloud Agent cannot click Launch in your account.

## What you get

| Piece | Role |
|-------|------|
| `t3.small` (2 GiB) | Room for Node + `pnpm` (prefer this over `t3.micro`) |
| Elastic IP | Stable `http://EIP/` bookmark |
| nginx `:80` | Static web UI + `/health` and `/v1` to the API |
| systemd `dat-poker-api` | NLHE vs house |
| `VITE_APP_STAGE=beta` | Yellow beta banner in the UI |
| Session Manager | Same browser shell you used for the tutorial (recreate the IAM role) |

Sage WalletConnect needs **HTTPS** and a domain. HTTP on the Elastic IP is
enough to iterate on tables, hands, and the UI with dev buy-in.

Credits: a `t3.small` in us-east-1 is on the order of **$0.02/hour** (~$15/month)
plus a few cents of EBS. Set a [cost budget](https://console.aws.amazon.com/billing/home#/budgets) so the $20 is not a surprise bill after it runs out.

## Console launch (no AWS CLI)

### 1. IAM role again

You deleted `ec2-ssm-role`. Create a new one named `dat-poker-beta-ssm`:

1. [IAM → Roles → Create role](https://console.aws.amazon.com/iam/home#/roles)
2. AWS service → EC2 → **EC2 Role for AWS Systems Manager**
3. Name: `dat-poker-beta-ssm` → Create role

### 2. Launch the beta instance

1. [EC2 → Launch instance](https://console.aws.amazon.com/ec2/)
2. Name: `dat-poker-beta`
3. AMI: **Amazon Linux 2023**
4. Type: **t3.small** (or `t3.micro` if you want it cheaper)
5. Key pair: **Proceed without a key pair**
6. Network: **Allow HTTP** and **Allow HTTPS** from the internet
7. Storage: **20 GiB** gp3
8. Advanced details → IAM instance profile: `dat-poker-beta-ssm`
9. **User data** (this is the confusing one — see [User data walkthrough](#user-data-walkthrough) below). Paste the **five-line** script in `deploy/aws-ec2/console-user-data.sh`, not the whole `user-data.sh` file.
10. Launch. Wait until **Running** and 2/2 status checks.

### User data walkthrough

User data is a script AWS runs **once**, on first boot. It is not a setting on your laptop.

1. Stay on the **Launch instance** page. Scroll to the **bottom**.
2. Find **Advanced details** and click the row to expand it (it is collapsed by default).
3. Scroll inside that section. You already set **IAM instance profile** here. Keep going.
4. Find the **User data** box (a large empty text area). Directly under it, leave **User data already base64 encoded** **unchecked**.
5. Open [console-user-data.sh on GitHub](https://raw.githubusercontent.com/Drewski241/dat-poker/cursor/aws-ec2-first-server-6971/deploy/aws-ec2/console-user-data.sh), Select All, Copy.
6. Click in the AWS **User data** box and Paste. You should see something like:

   ```bash
   #!/bin/bash
   # Paste this entire box into EC2 Launch instance → Advanced details → User data.
   # Leave “User data already base64 encoded” unchecked.
   set -euxo pipefail
   export DAT_POKER_REPO_REF="${DAT_POKER_REPO_REF:-cursor/aws-ec2-first-server-6971}"
   export DAT_POKER_STAGE="${DAT_POKER_STAGE:-beta}"
   curl -fsSL "https://raw.githubusercontent.com/Drewski241/dat-poker/${DAT_POKER_REPO_REF}/deploy/aws-ec2/user-data.sh" | bash
   ```

7. Do not add extra spaces before `#!/bin/bash`. Then scroll up and click **Launch instance**.

If you already launched without this box filled, User data will not run. Terminate that instance and launch a new one, **or** in Session Manager run:

```bash
sudo bash -c 'export DAT_POKER_REPO_REF=cursor/aws-ec2-first-server-6971 DAT_POKER_STAGE=beta
curl -fsSL https://raw.githubusercontent.com/Drewski241/dat-poker/cursor/aws-ec2-first-server-6971/deploy/aws-ec2/user-data.sh | bash'
```

### 3. Elastic IP

1. EC2 → **Elastic IPs** → Allocate (VPC)
2. Actions → Associate → instance `dat-poker-beta`
3. Bookmark `http://THE_ELASTIC_IP/`

An Elastic IP is free while it is attached to a running instance. It starts
billing if you stop the instance and leave the address allocated.

### 4. Watch bootstrap, then play

Session Manager (instance → Connect → Session Manager):

```bash
whoami
# ssm-user

sudo tail -f /var/log/dat-poker-bootstrap.log
```

First boot can take several minutes (`pnpm` + swap). Then:

```bash
curl -s http://127.0.0.1/health
# {"status":"ok","service":"dat-poker-api"}
```

Open `http://ELASTIC_IP/` — you should see **DAT Poker beta** and the yellow
banner. Buy in vs house with **dev buy-in** (no DAT CAT required).

## Redeploy after you push code

In Session Manager:

```bash
sudo DAT_POKER_REPO_REF=main bash /opt/dat-poker/deploy/aws-ec2/redeploy.sh
```

Use this feature branch name instead of `main` until it is merged. Restarting
the API clears in-memory tables.

## CloudFormation (optional)

Needs AWS CLI and `CAPABILITY_IAM`:

```bash
aws cloudformation deploy \
  --stack-name dat-poker-beta \
  --template-file deploy/aws-ec2/beta-cloudformation.yaml \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides RepoRef=main InstanceType=t3.small

aws cloudformation describe-stacks \
  --stack-name dat-poker-beta \
  --query 'Stacks[0].Outputs'
```

Delete the stack to terminate the instance and release the Elastic IP:

```bash
aws cloudformation delete-stack --stack-name dat-poker-beta
```

## Later: HTTPS + Sage

1. Point a DNS A record at the Elastic IP.
2. Put `WALLETCONNECT_PROJECT_ID` in `/opt/dat-poker/.env` and redeploy.
3. Terminate HTTP-only nginx TLS by installing Caddy or an ACM certificate on
   port 443 (security group already allows 443).

Until then, leave WalletConnect unset; the UI falls back to dev buy-in.

## Stop spending credits

Instance → **Stop** (keeps the disk; Elastic IP may charge if associated with
a stopped instance — disassociate or release it). **Terminate** + release the
Elastic IP + delete `dat-poker-beta-ssm` when you are done with this beta host.
