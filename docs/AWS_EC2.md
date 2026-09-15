# Launch DAT POKER on Amazon EC2 ($20 Free Tier credit)

AWS cannot be launched from this repo’s CI or from a Cursor Cloud Agent: the
instance has to be created **in your AWS account**. Completing
**Launch an instance using EC2** in that account is what credits the extra
**$20**.

This guide matches the email tutorial (launch, browser shell, nginx web page,
clean up) and leaves DAT POKER running on the same instance.

Official activity list: [Earning additional credits](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans-activities.html).

## What actually qualifies

| Requirement | How this guide covers it |
|-------------|--------------------------|
| Launch a virtual server | EC2 **Launch instance** wizard (or the CloudFormation stack below) |
| Connect with a browser-based shell | Console **Connect** → **EC2 Instance Connect** |
| Install a web server and serve a page | nginx + DAT POKER landing page (user data does this on first boot) |
| Clean up | Terminate the instance after the credit posts unless you want to keep the game online |
| Extra $20 | Billing console → **Credits**, usually within about 10 minutes of the instance reaching **Running** |

Start from the **Explore AWS** widget on [Console Home](https://console.aws.amazon.com/console/home)
and choose **Launch an instance using Amazon EC2**, then follow the wizard so
AWS records the activity. A `RunInstances` API call from CloudFormation often
counts as well; the widget path is the one AWS documents.

The credit is **not** paid to GitHub or this repo. It lands on the AWS account
that launches the instance.

## Cost

New accounts on the credit-based Free Tier (accounts created on/after 15 Jul 2025)
pay for EC2 out of promotional credits. A `t3.micro` left running will consume
those credits. Terminate when you are done (step 6).

Do **not** attach a key pair unless you want SSH from your laptop. Instance
Connect does not need one.

## Path A — Console (recommended for the $20 email)

Takes a few minutes of clicking. User data then installs nginx immediately and
builds DAT POKER in the background.

1. Sign in at [https://console.aws.amazon.com](https://console.aws.amazon.com)
   with the account that received the email.
2. Open **Explore AWS** on the home dashboard → **Launch an instance using Amazon EC2**
   (or go to [EC2](https://console.aws.amazon.com/ec2/) → **Launch instance**).
3. Fill in:

   | Field | Value |
   |-------|--------|
   | **Name** | `dat-poker-first-server` |
   | **AMI** | Amazon Linux 2023, **Free Tier eligible** |
   | **Instance type** | `t3.micro` or `t2.micro` (Free Tier eligible) |
   | **Key pair** | **Proceed without a key pair** |
   | **Firewall (security group)** | Allow **SSH** (22) and **HTTP** (80) from Anywhere (`0.0.0.0/0`) |
   | **Storage** | **20 GiB** gp3 (8 GiB is tight for Node + pnpm) |

4. Open **Advanced details** → **User data**. Paste the full contents of
   [`deploy/aws-ec2/user-data.sh`](../deploy/aws-ec2/user-data.sh).
5. **Launch instance**. Wait until **Instance state** is **Running**. That is
   the event the $20 activity looks for.
6. Select the instance → **Connect** → **EC2 Instance Connect** → **Connect**.
   In the browser shell:

   ```bash
   curl -s http://127.0.0.1/
   sudo tail -n 50 /var/log/dat-poker-bootstrap.log
   curl -s http://127.0.0.1/health || true
   ```

   The first `curl` should return HTML titled **DAT POKER** (nginx). `/health`
   returns JSON once the API build finishes (often several minutes on
   `t3.micro` because of swap + `pnpm`).
7. In a browser, open `http://PUBLIC_IPV4/` (Public IPv4 address on the
   instance summary). You should see the DAT POKER landing page, then the table
   UI after the web build copies `apps/web/dist` into nginx.
8. Credits: **Billing and Cost Management** → **Credits**. Give it up to
   10 minutes after the instance is **Running**.
9. **Clean up** (tutorial last step, also how you stop spending credits):

   Instance → **Instance state** → **Terminate instance**.

   Keep it running only if you still want the public demo. Dev buy-in is
   enabled (`DAT_ALLOW_DEV_BUYIN=true`) on this image — do not point real
   treasury keys at it.

### Manual nginx (if you skipped user data)

The email tutorial still works without DAT POKER. After Instance Connect:

```bash
sudo dnf install -y nginx
echo '<h1>DAT POKER</h1><p>First web server on Amazon EC2.</p>' | sudo tee /usr/share/nginx/html/index.html
sudo systemctl enable --now nginx
curl -s http://127.0.0.1/
```

Then terminate when the credit appears.

## Path B — CloudFormation (same account)

Requires the AWS CLI on your machine, configured for **this** AWS account
(`aws sts get-caller-identity`).

After this file exists on the branch you deploy (`main` once merged):

```bash
aws cloudformation deploy \
  --stack-name dat-poker-first-server \
  --template-file deploy/aws-ec2/cloudformation.yaml \
  --parameter-overrides RepoRef=main

aws cloudformation describe-stacks \
  --stack-name dat-poker-first-server \
  --query 'Stacks[0].Outputs'
```

Before merge, set `RepoRef` to this feature branch so User data can download
`user-data.sh`. Delete the stack to terminate the instance:

```bash
aws cloudformation delete-stack --stack-name dat-poker-first-server
```

## What the instance runs

```
Internet :80
  nginx
    /           static web client (landing page, then apps/web dist)
    /health     DAT POKER API
    /v1/*       DAT POKER API
127.0.0.1:4000  systemd unit dat-poker-api (in-memory tables)
```

Postgres, Redis, chia-gaming, and the treasury host are **not** started. That
matches local REST play: API + web, `DAT_ALLOW_DEV_BUYIN=true`. Gateway
WebSocket (`:4100`) is omitted on this 1 GB box.

Buy-ins stay in **CAT mojos** (default min `1000000` = 1000 DAT).

## Troubleshooting

| Symptom | Check |
|---------|--------|
| Credit missing | Instance reached **Running** in the account from the email; wait 10 minutes; confirm you are not on a paid plan that AWS marked ineligible |
| Browser timeout on port 80 | Security group inbound **HTTP 80**; wait 1–2 minutes for nginx; public IPv4 not empty |
| `/health` 502 | `sudo systemctl status dat-poker-api`; `sudo journalctl -u dat-poker-api -n 80`; bootstrap log |
| Build OOM | Swap file `/swapfile` (2 GiB); 20 GiB root volume; try `t3.small` if you keep the box |
| Landing page never replaced | `ls /opt/dat-poker/apps/web/dist`; re-run `sudo bash /var/lib/...` is not used — re-run by copying `user-data.sh` onto the box |

Bootstrap log: `/var/log/dat-poker-bootstrap.log`.

## This environment cannot click Launch for you

A Cursor Cloud Agent has no AWS access keys and must not use yours. Launch
from **your** console (Path A) or from **your** CLI (Path B). After **Running**,
the $20 activity is between you and AWS Billing.
