# Scaling to 100k+ Concurrent Players

## Capacity model (rough)

Assume average **80 hands/hour/table**, **8-handed** MTT tables, **6s/action** budget:

| Metric | Target |
|--------|--------|
| Concurrent players | 100,000+ (registration uncapped) |
| Avg players per table | ~7–8 |
| Active tables @ 100k / 8-max | 12,500 |
| Actions/sec (global) | ~3,000–8,000 peak |

Off-chain authoritative servers handle this; Chia handles **session boundaries** and **settlements**, not per-action writes.

### Tournament seating (control plane)

`@dat-poker/tournament-engine` seats **unlimited** MTT registrants: maps only at start, NLHE engines **lazy per table**. Unit-tested at **100,000 players → 12,500 tables**.

Hosting 100k players *playing at once* still requires the sharded topology below — one Node process should not run every hand engine hot.

## Topology

1. **Edge gateways** — Stateless WebSocket terminators (10–50 regions).
2. **Session router** — Consistent hash on `tableId` → game shard.
3. **Game shards** — 500–2,000 tables each; in-memory state + Redis checkpoint.
4. **Event bus** — All hand events to Kafka for analytics, fraud, settlement.
5. **Settlement workers** — Batch Chia transactions per table/tournament window.
6. **Tournament coordinator** — Registration, seating, elimination, rebalance (can stay centralized while table play is sharded).

## Data tiers

| Tier | Store | Use |
|------|-------|-----|
| Hot | Redis | Active hand state, presence, pub/sub |
| Warm | Postgres shard | Hand history, player stats, registrations |
| Cold | S3 + Parquet | ML training, regulatory export |

## Failure domains

- Shard loss → restore hand from Redis snapshot + event replay
- Gateway loss → clients reconnect; router reassigns
- Chia congestion → queue settlements with retry + fee bump policy

## Load testing gates

Before production scale:

- 5k synthetic tables on one shard (soak 1h)
- 50k WS connections across 5 gateway pods
- p99 action latency < 150ms within region
- Zero data loss on chaos kill of game pod mid-hand
- 100k tournament register + seat (control plane) under latency SLO
