# EC2 test deploy

One `t3.small` in `us-west-2` is enough. The app is in memory, so run a single container. Open TCP 80 on the instance security group to the testers. Leave the host up and the bill is about $21 a month (`t3.small` ~$15, public IPv4 ~$3.65, 20 GB gp3 ~$1.60). Stop the instance when the test is over.

SSH to the instance and run:

```bash
sudo dnf install -y git || sudo apt-get update && sudo apt-get install -y git
git clone --branch cursor/hybrid-dat-chia-gaming-3c03 --depth 1 https://github.com/Drewski241/dat-poker.git
cd dat-poker
DAT_GOVERNANCE_TOKEN_ASSET_ID=<64-hex-asset-id> \
DAT_TREASURY_BANKROLL_MOJOS=<treasury DAT balance in mojos> \
  ./scripts/deploy-ec2.sh
```

`DAT_TREASURY_BANKROLL_MOJOS` is CAT mojos (1000 mojos = 1 DAT). That balance is what concurrent heads-up games lock against. `DAT_ALLOW_DEV_BUYIN` defaults to true for this test box. Sage stays on a machine you control; this container does not run a wallet.

The site is `http://<instance-public-ip>/`. Check `curl -s localhost/health` on the box.
