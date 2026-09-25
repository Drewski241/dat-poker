# DAT POKER public beta on AWS

Use this after the $20 **Launch an instance using EC2** credit is in **Billing
→ Credits** and the tutorial `my-web-server` instance is gone.

The beta is a small always-on Amazon Linux box that serves the DAT POKER web
client, REST API, and treasury payout service so you can develop the poker
software against a public URL. Open tables are **in memory** and reset on
restart; account DAT (redeem and cash-out) and play-through progress (hands
that already unlocked DAT) are kept in `data/ledger.json`. Dev buy-in is on.
`dat-poker-treasury` stays enabled for the life of the website
([docs/TREASURY.md](./TREASURY.md)). Player Sage stays on the tester's
phone or PC.

This Cloud Agent cannot click Launch in your account.

## What you get

| Piece | Role |
|-------|------|
| `t3.small` (2 GiB) | Room for Node + `pnpm` (prefer this over `t3.micro`) |
| Elastic IP | Stable public IPv4 (point `datspiritpoker.com` here) |
| nginx `:80` / Caddy `:443` | Public website (`https://datspiritpoker.com/` and `/play`) + API |
| systemd `dat-poker-api` | NLHE 6-max; house bot (bets/folds) or humans |
| systemd `dat-poker-treasury` | Always-on payout offers on `127.0.0.1:4200` (starts with the site) |
| Daily redeem | 5000 DAT / UTC day into the in-game table account |
| `VITE_APP_STAGE=beta` | Yellow beta banner on Home and Play |
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
   `http://THAT_IP/`. You should see the **DAT Poker** website (Home) with
   **Play poker now!**. Click that to sit at a table. Buy in vs house with
   **dev buy-in** (no DAT CAT required) until HTTPS + Sage is on.

If the laptop browser times out but `curl` in Session Manager works, the
security group is missing inbound **HTTP (80)** from `0.0.0.0/0`.

## Redeploy after you push code

In Session Manager:

```bash
sudo DAT_POKER_REPO_REF=cursor/sng-sage-unlock-3440 bash /opt/dat-poker/deploy/aws-ec2/redeploy.sh
```

Use this feature branch name instead of `main` until it is merged. Restarting
the API clears open tables; account DAT and play-through unlocks stay in `data/ledger.json`.
Redeploy also enables and restarts `dat-poker-treasury` and waits for
`:4200/health`.

Wait until it prints `beta redeploy ok`. If it dies on
`www.datspiritpoker.com: command not found`, the API already restarted —
`/etc/caddy/caddy.env` had an unquoted `DAT_POKER_SITE=host, www.host` and
bash treated `www.…` as a command. Quote it once, then re-run redeploy:

```bash
sudo tee /etc/caddy/caddy.env >/dev/null <<'EOF'
DAT_POKER_DOMAIN=datspiritpoker.com
DAT_POKER_SITE="datspiritpoker.com, www.datspiritpoker.com"
EOF
sudo chown root:caddy /etc/caddy/caddy.env
sudo chmod 0640 /etc/caddy/caddy.env
```

Newer `redeploy.sh` parses that file with `sed` instead of `source`, so the
next pull finishes even if the env file is still unquoted. `curl -sS
https://datspiritpoker.com/health` is enough to confirm the API; a failed
Caddy `source` after `systemctl restart` does not mean Play is offline.

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

Player Sage stays on **your phone or PC**. Treasury HTTP (`dat-poker-treasury`)
runs on this EC2 box for the life of the website. Real DAT offers also need
treasury Sage RPC on the same host (`:9257`, `TREASURY_SAGE_FINGERPRINT`).
Buy-in is still a **signed message + DAT
balance check** — DAT does not leave Sage until on-chain escrow is wired.
Default table minimum is **1000 DAT** (1000000 CAT mojos). If you funded
less, set `DAT_MIN_BUY_IN_MOJOS=1000` (1 DAT) when you run `enable-sage.sh`.

### 1. Pull the new scripts onto the box

In Session Manager (or the `ec2-user@ip-172-31-…` shell):

```bash
sudo DAT_POKER_REPO_REF=cursor/aws-ec2-first-server-6971 bash /opt/dat-poker/deploy/aws-ec2/redeploy.sh
```

Wait until it prints `beta redeploy ok`. In-memory tables reset.

If the log shows `curl: (22) ... 502` and stops, that is the **previous**
`redeploy.sh` (bash keeps running the file it started with). The build and
`systemctl restart` usually already finished. Check the API, then continue
— do not re-run the full rebuild unless `:4000/health` is down:

```bash
curl -sS http://127.0.0.1:4000/health
curl -sS http://127.0.0.1/health
```

You want `{"status":"ok","service":"dat-poker-api"}`. Then go to step 2.

### 2. Turn on HTTPS (no domain purchase)

The security group already allows **443**. Caddy gets a Let’s Encrypt cert
for `YOUR-ELASTIC-IP-WITH-DASHES.sslip.io` (example: `54-12-34-56.sslip.io`).

```bash
sudo bash /opt/dat-poker/deploy/aws-ec2/enable-https.sh
```

The script prints `Open https://….sslip.io/`. Bookmark **that** URL for now
(plain `https`, no port). The old `http://THAT_IP/` bookmark will stop working
because nginx is stopped so Caddy can bind port 80. Testers should get
**https://datspiritpoker.com/** once you [point that domain here](#website-address).

If it waits two minutes and fails, EC2 → instance → **Security** tab →
inbound must include **HTTPS TCP 443** from `0.0.0.0/0` (and HTTP 80 still,
for the certificate challenge). Then:

```bash
sudo journalctl -u caddy -n 80 --no-pager
```

### 3. WalletConnect Cloud project

1. Open [Reown Cloud](https://cloud.reown.com/) (WalletConnect) in the laptop
   browser. Sign in or create a free account.
2. **Create** a project. Name: `DAT Poker beta`.
3. Copy the **Project ID** (a long hex string).
4. If the project has a website / domain field, paste
   `https://datspiritpoker.com` (and `https://www.datspiritpoker.com`). Keep
   the sslip.io origin until DNS is switched.

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

### 6. Play in the laptop browser

1. Open **`https://datspiritpoker.com/`** after you [point DNS here](#website-address)
   (or the `https://YOUR-DASHES.sslip.io/` bookmark until then). Click **Play poker now!**.
2. **Create account** (username + password + email). The platform emails a **verification code**; entering it on **Verify email** proves they own that inbox. Testers are **not** pre-registered in AWS — that is only an SES sandbox quirk (see below). Sage is not required to play.
3. Click **Redeem 5000 DAT today** (once per UTC day; in-game table credits we fund).
4. **Buy in & join 6-max** — you sit vs house, or next to another human if they are waiting.
5. **Deal hand** when at least two seats are filled.
6. **Cash out to account** anytime between hands — progress is kept. Each completed
   hand unlocks 1 DAT; after 50 hands you can withdraw 50 DAT even if 950 remain locked.
7. **Connect Sage to withdraw DAT** only if you want those credits in a wallet. Approve a
   sign-only pairing (it cannot send coins).
8. Send notes and screenshots from **https://datspiritpoker.com/feedback**.

### Email delivery (one-time operator setup)

The game already works the way you expect: **any** address the player types → code by email → they paste the code → account verified. You do **not** add testers in AWS one by one unless SES is still in **sandbox**.

| Problem | Fix (do once) |
|--------|------------------|
| No mail at all | Set `DAT_EMAIL_MODE=smtp` and `DAT_SMTP_*` in `/opt/dat-poker/.env`, then `sudo systemctl restart dat-poker-api`. Without SMTP, codes only appear in `journalctl` (`grep 'dat-poker mail'`). |
| SMTP works but mail only reaches *some* addresses | **SES sandbox** — request **production access** (below) or use **Resend** with domain DNS only. |
| Resend on site does nothing | Username + email must **exactly** match `accounts.json` (`jq '.users[] | {username, email}' /opt/dat-poker/data/accounts.json`). |

**Recommended — Amazon SES production (send to any inbox):**

1. SES (same region as EC2) → verify **domain** `datspiritpoker.com` (DKIM DNS in Cloudflare).
2. **Account dashboard** → **Request production access** — use case: transactional verification and password-reset email for datspiritpoker.com poker accounts; no marketing.
3. Create **SMTP credentials**, put them in `/opt/dat-poker/.env` (`DAT_EMAIL_MODE=smtp`, `DAT_EMAIL_FROM=DAT Poker <noreply@datspiritpoker.com>`, host/port/user/pass).
4. Restart `dat-poker-api`.

**Alternative — Resend (often faster for beta):** verify `datspiritpoker.com` in Resend (DNS in Cloudflare), SMTP host `smtp.resend.com`, user `resend`, password = API key. Same `.env` shape; restart API.

**Dev-only:** `DAT_EMAIL_BETA_REVEAL_CODE=true` shows the code in the API/UI when SMTP is not ready — not for production.

Sage pairing **only signs messages**. If Sage asks to send coins or take an
offer during this beta, reject it and file feedback. Details:
[docs/SECURITY.md](./SECURITY.md).

If the page is still `http://` you will see a note that Sage needs HTTPS.

If **Connect Sage** stays on “Connecting…” and never shows a QR, or the
page shows `Failed to publish custom payload` / `tag:undefined`, the
browser never reached the Reown relay. Fix:

1. [Reown Cloud](https://cloud.reown.com/) → DAT Poker project → **Allowed
   domains**. Add `https://datspiritpoker.com` and
   `https://www.datspiritpoker.com` (exact origins, including `https://`).
2. Reload `/play` and click **Connect Sage** again. The modal should show
   a spinner, then the QR.
3. Redeploy the web client so it waits for the relay before publishing:

```bash
sudo DAT_POKER_REPO_REF=cursor/walletconnect-qr-pairing-6971 bash /opt/dat-poker/deploy/aws-ec2/redeploy.sh
```

chia-gaming’s GitHub WalletConnect path is for the official Chia light
wallet + Calpoker state channels (`chia_selectCoins`,
`chia_createOfferForIds`). Sage pairing follows
[xch-dev/sage-dapp-example](https://github.com/xch-dev/sage-dapp-example)
(CHIP-0002 methods + `wss://relay.walletconnect.com`) and **does not**
request `chia_send`. After a treasury withdraw it may request
`chia_takeOffer` so Sage shows Accept. Sage Accept has no fee box — treasury
pays the XCH fee on `make_offer` and on-chain `cancel_offer`
(`TREASURY_PAYOUT_FEE_MOJOS`). See
[docs/WALLETCONNECT.md](./WALLETCONNECT.md) and [docs/SECURITY.md](./SECURITY.md).

Withdraw to Sage uses the always-on treasury on this website host
([docs/TREASURY.md](./TREASURY.md)). After redeploy, confirm both:

```bash
curl -sS http://127.0.0.1:4000/health
curl -sS http://127.0.0.1:4200/health
```

You want API `status: ok` and treasury listening. If withdraw says Sage RPC
certs are missing, treasury HTTP is up but Sage is not installed on this box:

```bash
sudo SAGE_INSTALL=1 bash /opt/dat-poker/deploy/aws-ec2/enable-treasury-sage.sh
```

That copies the prebuilt `sage-cli` from this repo. Do not `cargo install`
sage-cli on the 20 GB beta volume — the compile fills the disk.

`walletRpcReachable: false` and `sageFingerprint: null` means Sage RPC TLS
certs are present (`wallet.key` is not the Chia spend key). Put the dedicated
treasury private key in `/opt/dat-poker/.env`:

```bash
# The secret must not be pasted into chat. Silent prompt (does not echo):
sudo bash /opt/dat-poker/deploy/aws-ec2/load-treasury-key.sh
# or from a root-only file:
sudo TREASURY_SAGE_PRIVATE_KEY_FILE=/root/treasury.hex bash /opt/dat-poker/deploy/aws-ec2/load-treasury-key.sh
```

Use the same `load-treasury-key.sh` later to **replace** the treasury key
(after this withdraw works, or if the current key was exposed). It imports
the new secret, updates the fingerprint, and removes the previous Sage key
unless you set `SAGE_KEEP_OLD_KEY=1`. Fund the new address before the next
withdraw.

If withdraw says `no spendable coins` while 50000 DAT is on that key, Sage
RPC is up but has not indexed the CAT yet (or XCH for fees is missing).
`curl -sS http://127.0.0.1:4200/health` should show `datSelectableMojos`
as `50000000` after sync. Confirm `DAT_GOVERNANCE_TOKEN_ASSET_ID` and send
a little XCH to the printed treasury address.

If `/health` shows `datBalanceMojos` still at `50000000` but
`datSelectableMojos` is `0` and `pendingOfferCount` is greater than 0, the
last unused withdraw offer is still reserving those coins. If you already
tapped Accept, wait 1–2 minutes and do not Accept the old offer again. Then
withdraw once — payout cancels leftover offers on-chain and does not remake
in the same request. Or:

```bash
sudo bash /opt/dat-poker/deploy/aws-ec2/release-treasury-offers.sh
```

Wait after that cancel before the next withdraw. A mempool conflict means
the same DAT coin is already being spent.

## Website address

Testers should open **https://datspiritpoker.com/** — not the Elastic IP and
not `sslip.io`. That name is already on this Cloudflare account (registered
16 Sep 2026). It has **no A records yet**, which is why the certificate
step fails.

This Cloud Agent cannot click Cloudflare or AWS for you.

### 1. Copy the Elastic IP

1. [EC2 → Elastic IPs](https://console.aws.amazon.com/ec2/home#Addresses:)
2. The **Allocated IPv4 address** on the row associated with `dat-poker-beta`
   is four numbers with dots. Copy it.

### 2. Point Cloudflare DNS at that address

1. [Cloudflare Dashboard](https://dash.cloudflare.com/) → click
   **datspiritpoker.com** (Websites).
2. Left sidebar: **DNS** → **Records**.
3. **Add record** (or edit if `@` already exists):
   - Type: **A**
   - Name: `@`
   - IPv4 address: paste the Elastic IP
   - Proxy status: **DNS only** (grey cloud, not orange)
   - Save
4. **Add record** again:
   - Type: **A**
   - Name: `www`
   - IPv4 address: the same Elastic IP
   - Proxy status: **DNS only**
   - Save

Wait a minute. On your laptop:

```bash
dig +short datspiritpoker.com
dig +short www.datspiritpoker.com
```

Both should print the Elastic IP.

### 3. Get a certificate

Do this only after `dig +short datspiritpoker.com` prints the Elastic IP.

In Session Manager:

```bash
sudo DAT_POKER_REPO_REF=cursor/aws-ec2-first-server-6971 bash /opt/dat-poker/deploy/aws-ec2/redeploy.sh
sudo DAT_POKER_DOMAIN=datspiritpoker.com bash /opt/dat-poker/deploy/aws-ec2/enable-https.sh
```

The script waits until DNS matches the Elastic IP, then asks Let’s Encrypt
for `datspiritpoker.com` and `www.datspiritpoker.com`. It prints
`Open https://datspiritpoker.com/`.

If www is not ready yet:

```bash
sudo DAT_POKER_DOMAIN=datspiritpoker.com DAT_POKER_WWW=0 bash /opt/dat-poker/deploy/aws-ec2/enable-https.sh
```

If Caddy prints `Job for caddy.service failed`, the script now dumps the
Caddyfile and `journalctl -u caddy`. Pull the fix without a full rebuild:

```bash
sudo git -C /opt/dat-poker fetch --depth 1 origin cursor/aws-ec2-first-server-6971
sudo git -C /opt/dat-poker -c advice.detachedHead=false checkout -f FETCH_HEAD
sudo DAT_POKER_DOMAIN=datspiritpoker.com bash /opt/dat-poker/deploy/aws-ec2/enable-https.sh
```

Add `https://datspiritpoker.com` (and www) to the Reown domain allowlist.

## Invite testers

Share **https://datspiritpoker.com/** (or `https://www.datspiritpoker.com/`).
They click **Play poker now!**.

On the box, confirm what Caddy is serving:

```bash
bash /opt/dat-poker/deploy/aws-ec2/public-url.sh
```

You want `https://datspiritpoker.com/`. If it still prints `sslip.io`, finish
[Website address](#website-address) first.

Message you can paste:

> You’re invited to the DAT Poker closed beta. Open https://datspiritpoker.com/ —
> click Play poker now!, create an account, redeem 5000 DAT for today, then buy in
> at the 6-max table. Sage is only needed if you want DAT in a wallet. Send notes
> and screenshots at https://datspiritpoker.com/feedback . Pairing only signs
> messages — Sage should never send DAT from this site. This is software testing,
> not a real-money casino. Open tables reset if the server restarts; your account
> DAT is kept.

Keep the group small and trusted. The host is a single `t3.small`, tables are
in memory, there is no KYC, and DAT does not leave Sage until on-chain escrow
exists. Do not post the URL on public forums.

If you associate a **new** Elastic IP, update the Cloudflare A records to the
new address, then re-run `enable-https.sh` with
`DAT_POKER_DOMAIN=datspiritpoker.com`.

Load this landing page onto the box after you push:

```bash
sudo DAT_POKER_REPO_REF=cursor/aws-ec2-first-server-6971 bash /opt/dat-poker/deploy/aws-ec2/redeploy.sh
```

## Stop spending credits

Instance → **Stop** (keeps the disk; Elastic IP may charge if associated with
a stopped instance — disassociate or release it). **Terminate** + release the
Elastic IP + delete `dat-poker-beta-ssm` when you are done with this beta host.
