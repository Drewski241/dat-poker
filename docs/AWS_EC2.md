# Launch DAT POKER on Amazon EC2 ($20 Free Tier credit)

Use the official tutorial in the email — not nginx user data — to earn the
**$20**. That article is [Deploy a web server to the cloud](https://builder.aws.com/content/3BfvbBpwbonTDicuPTMLZBTt4Br/deploy-a-web-server-to-the-cloud)
(Free Tier Tutorial Series #5). Completing it also finishes the
**Launch an instance using EC2** activity.

This Cloud Agent cannot sign into your AWS account. Click the steps in
**your** Console.

Do **not** paste `deploy/aws-ec2/user-data.sh` while you are on this tutorial.
User data would skip the Apache + Session Manager path the article (and the
credit email) walk through.

## What the article asks you to do

| Tutorial step | What to use |
|---------------|-------------|
| IAM role for Session Manager | Role name `ec2-ssm-role`, use case **EC2 Role for AWS Systems Manager** (`AmazonSSMManagedInstanceCore`) |
| Launch a VM | Name `my-web-server`, **Amazon Linux 2023**, **t2.micro**, **Proceed without a key pair**, check **Allow HTTP traffic from the internet**, IAM instance profile `ec2-ssm-role` |
| Browser shell | Instance → **Connect** → **Session Manager** (user `ssm-user`) |
| Web server | Apache: `httpd`, files in `/var/www/html/` |
| Custom page | `sudo nano /var/www/html/index.html` |
| Clean up | **Terminate** `my-web-server` (the article says to do this so you earn the credit and do not keep paying) |

Source: Sean Boult, AWS Builder Center, published 1 Apr 2026.

## Path A — follow the tutorial (this is the $20)

Stay on the Builder Center tab and click its console links, or use the
checklist below.

### 1. IAM role

1. Open [IAM → Roles](https://console.aws.amazon.com/iam/home#/roles) → **Create role**.
2. Trusted entity: **AWS service** → **EC2**.
3. Use case: **EC2 Role for AWS Systems Manager**.
4. **Next** (policy `AmazonSSMManagedInstanceCore` is already attached).
5. Role name: `ec2-ssm-role` → **Create role**.

### 2. Launch the instance

1. Open the [EC2 console](https://console.aws.amazon.com/ec2/) → **Launch instance**.
2. Name: `my-web-server`.
3. AMI: **Amazon Linux 2023**.
4. Instance type: **t2.micro** (Free Tier eligible). If your region only lists
   `t3.micro`, that is fine.
5. Key pair: **Proceed without a key pair**.
6. Network: check **Allow HTTP traffic from the internet**.
7. **Advanced details** → IAM instance profile: `ec2-ssm-role`.
8. Leave **User data** empty.
9. **Launch instance**. Wait until **Running** and status checks are complete.

That **Running** instance is the **Launch an instance using EC2** activity.
Credits usually show under **Billing → Credits** within about 10 minutes.

### 3. Connect with Session Manager

1. Select `my-web-server` → **Connect** → **Session Manager** → **Connect**.
2. You should be `ssm-user`. Confirm with `whoami`.

If the Session Manager tab is greyed out, wait a minute for the IAM profile
and SSM agent. Amazon Linux 2023 already includes the agent. You do not need
port 22.

### 4. Install Apache (verbatim from the article)

Run these **in the Session Manager browser tab**, not in a terminal on your
laptop. Amazon Linux has `yum` and `httpd`. Ubuntu laptops do not, and
installing Apache locally does not earn the $20.

If the prompt looks like `you@your-laptop` instead of `ssm-user@ip-...`, go
back to step 3. `whoami` should print `ssm-user`.

```bash
sudo yum install -y httpd
sudo systemctl start httpd
sudo systemctl enable httpd
sudo systemctl status httpd
```

You want `active (running)`.

### 5. See it live

Copy the instance **Public IPv4 address** and open `http://<your-public-ip>`.
You should see Apache’s **It works!** page.

### 6. Serve your own page

```bash
sudo nano /var/www/html/index.html
```

Example from the article:

```html
<pre>
  __( )< (woof)
  \___)
</pre>
```

Save: **Ctrl+O**, Enter. Exit: **Ctrl+X**. Refresh the public URL.

You can put DAT POKER in that file instead of the dog ASCII if you want the
public page to say DAT POKER. That still counts as “your own web page.”

### 7. Clean up (tutorial last step)

The article: follow Clean up to earn the credits and to avoid leftover charges.

1. EC2 → select `my-web-server` → **Instance state** → **Terminate instance**.
2. Optional: delete the instance security group and IAM role `ec2-ssm-role`
   (they do not bill, but they leave the account tidy).

Stopping keeps the EBS disk (small storage fee). Terminating deletes the
instance and disk.

## Path B — DAT POKER on the same box (optional, after Apache is live)

Only after Path A steps 1–6. Port 80 is already Apache; do not install nginx
alongside it.

In Session Manager:

```bash
# still Apache; install Node and the API
curl -fsSL https://raw.githubusercontent.com/Drewski241/dat-poker/main/deploy/aws-ec2/user-data.sh -o /tmp/dat-poker-user-data.sh
# user-data.sh also installs nginx — skip it on this host.
# Instead build the API, then copy the web dist over Apache's docroot:
```

Safer sequence (copy-paste):

```bash
sudo yum install -y git tar xz
sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
curl -fsSL https://nodejs.org/dist/v22.14.0/node-v22.14.0-linux-x64.tar.xz -o /tmp/node.tar.xz
sudo tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1
corepack enable && corepack prepare pnpm@9.15.0 --activate
sudo git clone --depth 1 https://github.com/Drewski241/dat-poker.git /opt/dat-poker
cd /opt/dat-poker
sudo cp .env.example .env
sudo sed -i 's/^DAT_ALLOW_DEV_BUYIN=.*/DAT_ALLOW_DEV_BUYIN=true/' .env
pnpm install --frozen-lockfile
pnpm --filter @dat-poker/api^... build
pnpm --filter @dat-poker/api build
pnpm --filter @dat-poker/web build
sudo cp -a apps/web/dist/. /var/www/html/
sudo tee /etc/httpd/conf.d/dat-poker-proxy.conf >/dev/null <<'CONF'
ProxyPass /health http://127.0.0.1:4000/health
ProxyPassReverse /health http://127.0.0.1:4000/health
ProxyPass /v1/ http://127.0.0.1:4000/v1/
ProxyPassReverse /v1/ http://127.0.0.1:4000/v1/
CONF
sudo systemctl restart httpd
sudo cp deploy/aws-ec2/dat-poker-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now dat-poker-api
```

`t2.micro` is 1 GB RAM; the Node build needs the 2 GiB swap file. If you only
wanted the $20, skip Path B and terminate.

Dev buy-in is on (`DAT_ALLOW_DEV_BUYIN=true`). Do not point real treasury keys
at this instance.

## Path C — CloudFormation DAT POKER kit (not the email tutorial)

[`deploy/aws-ec2/cloudformation.yaml`](../deploy/aws-ec2/cloudformation.yaml)
launches Amazon Linux + nginx + DAT POKER. Use it **after** you already have
the credit, or if you do not care about matching the Apache article.

```bash
aws cloudformation deploy \
  --stack-name dat-poker-first-server \
  --template-file deploy/aws-ec2/cloudformation.yaml \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides RepoRef=main InstanceType=t2.micro

aws cloudformation delete-stack --stack-name dat-poker-first-server
```

`--capabilities CAPABILITY_IAM` is required because the stack creates the SSM
instance profile.

## Troubleshooting

| Symptom | Check |
|---------|--------|
| Credit missing | Instance reached **Running** in the account from the email; wait ~10 minutes; finish **Terminate** as the article asks |
| Session Manager greyed out | IAM profile `ec2-ssm-role` attached; 2/2 status checks; wait 1–2 minutes |
| Browser timeout on port 80 | **Allow HTTP traffic from the internet** was checked; Apache `active (running)` |
| `sudo: yum: command not found` | You ran the commands on a laptop (Ubuntu, etc.). Open Session Manager on `my-web-server` and run them there. |
| `httpd` not found | You are on Amazon Linux 2023; `yum` is a `dnf` wrapper — keep the article’s `sudo yum install -y httpd` |

Same-account billing: [AWS Billing console](https://console.aws.amazon.com/billing/).
