# EC2 update

The beta host already has DAT POKER at `/opt/dat-poker`. From Session Manager:

```bash
sudo bash -c 'export DAT_POKER_REPO_REF=cursor/hybrid-dat-chia-gaming-3c03; curl -fsSL "https://raw.githubusercontent.com/Drewski241/dat-poker/cursor/hybrid-dat-chia-gaming-3c03/deploy/aws-ec2/up.sh" | bash'
```

Wait until the log prints `beta redeploy ok`. The site stays on the existing hostname. Tables are in memory, so this restart clears seats and house reservations.

To set the treasury ceiling on that same command, add `export DAT_TREASURY_BANKROLL_MOJOS=<mojos>` before the curl. 1000 mojos = 1 DAT. Each heads-up tester locks one house buy-in from that balance until they leave. If `/opt/dat-poker/.env` already has `DAT_TREASURY_PAYOUT_URL`, the lock book stays on that treasury service, which must be this build.
