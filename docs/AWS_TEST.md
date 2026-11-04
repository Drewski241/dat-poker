# AWS test deploy

Heads-up play for testers needs one public URL and a house buy-in lock against the DAT treasury. This repository is ready to build that image. A live stack was not created from the development environment: it has no AWS credentials, no AWS CLI, and no Docker daemon.

## What testers run

One container, from `docker/Dockerfile.api`. It builds the API and the web client. When `WEB_DIST` is set, the API serves the site on the same origin, so the browser can call `/v1` without a separate host.

- Region: `us-west-2`
- Compute: one Fargate task, 0.5 vCPU and 1 GB
- Network: public application load balancer, task in a private subnet, NAT gateway, one availability zone
- Storage: no database. Tables and the house lock live in process memory, so run **one** API task
- Encryption: SSE-S3 for any logs bucket, TLS on the load balancer

Sage cannot run inside that task. Keep the treasury wallet on a machine you control. For the test, set `DAT_TREASURY_BANKROLL_MOJOS` to the treasury DAT balance in CAT mojos (1000 mojos = 1 DAT). Leave `DAT_TREASURY_PAYOUT_URL` unset unless the treasury payout service is reachable from the task; when it is set, that service owns the lock book (`POST /locks`).

`DAT_ALLOW_DEV_BUYIN=true` lets the closed tester group sit without a wallet signature. Turn it off before anyone outside that group can reach the URL.

Restarting the API clears tables and, when the lock book is local, the reservations. Restart only while nobody is seated.

## Cost if the stack is left running

Public list prices in `us-west-2`, approximate:

| Piece | Monthly |
| --- | --- |
| NAT gateway | $33 |
| Application load balancer | $16 |
| Fargate 0.5 vCPU / 1 GB | $18 |
| Public IPv4 | $3.65 |
| **Left running** | **about $70** |

Destroy the stack after the test and the bill is the hours it was up, a few dollars for a short session.

## Before a stack can be created

The deploy needs AWS account access in `us-west-2` (credentials or an OIDC role) and a yes to the cost above. Do not start a push-triggered workflow until that access exists; it would fail on every push.
