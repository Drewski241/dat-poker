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

Sage WalletConnect needs **HTTPS**. HTTP on the Elastic IP is enough for
dev buy-in. After the site loads, add TLS + a WalletConnect project to pair
Sage (see [HTTPS + Sage](#https--sage-walletconnect)).

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

This pins a public IPv4 address so `http://…` does not change if you stop and
start the instance. Do this in the AWS Console, not on your laptop.

1. Confirm `dat-poker-beta` is **Running** (EC2 → **Instances**).
2. In the left sidebar, under **Network & Security**, click **Elastic IPs**.
3. Click **Allocate Elastic IP address**.
4. Leave the defaults: IPv4, Amazon’s pool of IPv4 addresses. Click **Allocate**.
5. Tick the checkbox on the new row. Click **Actions** → **Associate Elastic IP address**.
6. Resource type: **Instance**. Instance: choose **dat-poker-beta**. Private IP: leave the default. Click **Associate**.
7. The **Allocated IPv4 address** column is `THAT_IP` (four numbers with dots, like `54.12.34.56`).
8. On your laptop browser, bookmark `http://THAT_IP/` (plain `http`, no `https`, no port number). The site may be a landing page until bootstrap finishes.

An Elastic IP is free while it is attached to a **running** instance. It starts
billing if you stop the instance and leave the address allocated — disassociate
or release it if you stop for a long time.

The instance also shows a **Public IPv4 address** on the instance list. After
you associate the Elastic IP, those two values should match. Use the Elastic IP
for the bookmark.

### 4. Watch bootstrap, then play (Session Manager)

Session Manager is a **terminal in your web browser** on the EC2 machine (same
idea as the Apache tutorial). The `tail` and `curl` commands run **there**, not
in your IdeaPad terminal.

1. EC2 → **Instances** → click the row **dat-poker-beta** (checkbox).
2. Click **Connect** (top right of the instances page).
3. Open the **Session Manager** tab → **Connect**. A black terminal tab opens.
4. Confirm you are on the VM:

   ```bash
   whoami
   ```

   You want `ec2-user` or `ssm-user`, and a hostname like `ip-172-31-…`.
   That is the VM. If Connect is greyed out, wait for 2/2 status checks
   and confirm the instance profile is `dat-poker-beta-ssm`.
5. Watch the install log (several minutes; Node + `pnpm`):

   ```bash
   sudo tail -f /var/log/dat-poker-bootstrap.log
   ```

   If you see `No such file or directory`, wait 30 seconds and try again (the
   first-boot script has not created the log yet). Leave this running until you
   see a line about the API being healthy, or `DAT POKER API is healthy`, or
   the script finishes. Press **Ctrl+C** to stop following the log.
6. Still in Session Manager, check the API:

   ```bash
   curl -s http://127.0.0.1/health
   ```

   You want `{"status":"ok","service":"dat-poker-api"}`. If you get `Connection
   refused` or HTML with 502, wait a minute and run `curl` again — the web page
   can be up before the API has finished building.

   If the bootstrap log ends with `curl: (7) Failed to connect to 127.0.0.1:4000`
   and `dat-poker-bootstrap.web-only`, that is usually a **timing race**, not a
   failed build. Node was spawned (`systemctl enable --now`) and curl ran
   before Fastify bound `:4000`. Stay in Session Manager and check whether the
   API came up a few seconds later:

   ```bash
   sudo systemctl status dat-poker-api --no-pager
   sudo journalctl -u dat-poker-api -n 50 --no-pager
   curl -sS http://127.0.0.1:4000/health
   curl -sS http://127.0.0.1/health
   ```

   You want `active (running)` and `{"status":"ok","service":"dat-poker-api"}`.
   If `:4000` is healthy, do **not** re-run the full bootstrap. Open
   `http://THAT_IP/` on the laptop. If the service is `failed`, restart it:

   ```bash
   sudo systemctl restart dat-poker-api
   sleep 3
   curl -sS http://127.0.0.1:4000/health
   ```
7. On your **laptop** browser (not inside Session Manager), open the bookmark
   `http://THAT_IP/`. You should see **DAT Poker beta** and the yellow banner.
   Buy in vs house with **dev buy-in** (no DAT CAT required).

If the laptop browser times out but `curl` in Session Manager works, the
security group is missing inbound **HTTP (80)** from `0.0.0.0/0`.

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

## HTTPS + Sage (WalletConnect)

Player Sage stays on **your phone or PC**. Do not install Sage or paste
treasury keys on the EC2 box. Buy-in is still a **signed message + DAT
balance check** — DAT does not leave Sage until on-chain escrow is wired.
Default table minimum is **1000 DAT** (1000000 CAT mojos). If you funded
less, set `DAT_MIN_BUY_IN_MOJOS=1000` (1 DAT) when you run `enable-sage.sh`.

### 1. Pull the new scripts onto the box

In Session Manager (or the `ec2-user@ip-172-31-…` shell):

```bash
sudo DAT_POKER_REPO_REF=cursor/aws-ec2-first-server-6971 bash /opt/dat-poker/deploy/aws-ec2/redeploy.sh
```

Wait until it prints `beta redeploy ok`. In-memory tables reset.

### 2. Turn on HTTPS (no domain purchase)

The security group already allows **443**. Caddy gets a Let’s Encrypt cert
for `YOUR-ELASTIC-IP-WITH-DASHES.sslip.io` (example: `54-12-34-56.sslip.io`).

```bash
sudo bash /opt/dat-poker/deploy/aws-ec2/enable-https.sh
```

The script prints `Open https://….sslip.io/`. Bookmark **that** URL (plain
`https`, no port). The old `http://THAT_IP/` bookmark will stop working
because nginx is stopped so Caddy can bind port 80.

If it waits two minutes and fails, EC2 → instance → **Security** tab →
inbound must include **HTTPS TCP 443** from `0.0.0.0/0` (and HTTP 80 still,
for the certificate challenge). Then:

```bash
sudo journalctl -u caddy -n 80 --no-pager
```

To use a real domain instead: point a DNS **A** record at the Elastic IP,
wait for DNS, then:

```bash
sudo DAT_POKER_DOMAIN=poker.example.com bash /opt/dat-poker/deploy/aws-ec2/enable-https.sh
```

### 3. WalletConnect Cloud project

1. Open [Reown Cloud](https://cloud.reown.com/) (WalletConnect) in the laptop
   browser. Sign in or create a free account.
2. **Create** a project. Name: `DAT Poker beta`.
3. Copy the **Project ID** (a long hex string).
4. If the project has a website / domain field, paste
   `https://YOUR-DASHES.sslip.io` (the same hostname Caddy printed).

### 4. Copy the DAT CAT asset ID from Sage

1. Open **Sage** on the device that holds DAT (not the EC2 box).
2. Open the **DAT** token details.
3. Copy **Asset ID** (`asset_id`) — **64 hex characters**, no spaces.

### 5. Put those values on the game host

Still in Session Manager. Paste your own values (do not commit them):

```bash
sudo WALLETCONNECT_PROJECT_ID='paste_project_id' \
  DAT_GOVERNANCE_TOKEN_ASSET_ID='paste_64_char_asset_id' \
  bash /opt/dat-poker/deploy/aws-ec2/enable-sage.sh
```

If you have fewer than 1000 DAT, add `DAT_MIN_BUY_IN_MOJOS=1000` to that
command (1 DAT). Leave `DAT_ALLOW_DEV_BUYIN=true` so the table still works
if pairing fails.

Confirm:

```bash
curl -sS http://127.0.0.1:4000/v1/wallet/status
```

You want `"walletConnectConfigured": true` and a non-null `assetId`.

### 6. Pair Sage in the laptop browser

1. Open **`https://YOUR-DASHES.sslip.io/`** (not `http://IP`).
2. Click **Connect Sage (WalletConnect)**.
3. Scan the QR with Sage (or paste the URI in Sage desktop).
4. Approve the session in Sage.
5. Click **Load DAT balance**. You should see your spendable DAT.
6. **Buy in & join table** — approve the message in Sage if asked.

If the page is still `http://` you will see a note that Sage needs HTTPS.

Withdraw to Sage needs a **separate treasury host** later
([docs/TREASURY.md](./TREASURY.md)). Do not enable Sage RPC on this EC2 box.

## Stop spending credits

Instance → **Stop** (keeps the disk; Elastic IP may charge if associated with
a stopped instance — disassociate or release it). **Terminate** + release the
Elastic IP + delete `dat-poker-beta-ssm` when you are done with this beta host.
