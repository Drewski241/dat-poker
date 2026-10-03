# Tournament formats (SNG + MTT)

DAT POKER seats tournament fields on top of the same NLHE table engine used for cash games.

## Formats

| Format | Tables | Field size |
|--------|--------|------------|
| `sng` | 1 | Up to `maxSeats` (default 8) |
| `mtt` | Many | **Unlimited by default** — `ceil(n / maxSeats)` tables |

Default table size is **8-max**. A 100,000-player MTT → **12,500** tables.

## Unlimited registration

MTT `maxEntries` defaults to `null` (uncapped). Everyone who registers gets a seat when the tournament starts.

```json
{ "name": "Sunday Million", "format": "mtt", "maxSeats": 8 }
```

Optional hard cap: `"maxEntries": 50000`. SNGs always use a finite cap ≤ `maxSeats`.

## Lifecycle

1. `POST /v1/tournaments` — create (`format`, `maxSeats`, optional `maxEntries`, buy-in, starting stack)
2. `POST /v1/tournaments/:id/register` or `register-batch` — enroll players (no upper bound when uncapped)
3. `POST /v1/tournaments/:id/start` — even seating across tables (engines created **lazily** per table)
4. Play hands via `GET/POST .../tables/:tableId` (same commit-reveal flow as cash once an engine is materialized)
5. `POST /v1/tournaments/:id/eliminate` — bust a player; **rebalances**, breaks short tables, collapses to a **final table** when ≤ `maxSeats` remain
6. Last player standing → `completed`

Large fields return **summaries** by default (`GET /v1/tournaments/:id`). Pass `?detail=1` only when you need full seat lists.

## Seating & reseating rules

- Initial seat: distribute so every table has the same count ±1, none over `maxSeats`
- After each elimination: if remaining players fit on fewer tables, **break** the shortest table and move survivors into open seats
- While multiple tables remain, keep counts balanced (max − min ≤ 1)
- When remaining ≤ `maxSeats`, merge onto one **final table**

## Scale notes (100k+)

| Concern | Current behavior |
|---------|------------------|
| Registration + seating maps | Single process; validated at 100k players / 12.5k tables |
| Live hand engines | **Lazy** — only tables that are playing hold an `NlheTableEngine` |
| Concurrent play at 100k | Needs game **shards** + Redis/Postgres (see [SCALING.md](./SCALING.md)); seating control plane is ready |

Package: `@dat-poker/tournament-engine` (`TournamentEngine`, `rebalanceTables`, seating helpers).

## Smoke (API)

```bash
# Unlimited MTT (omit maxEntries)
T=$(curl -s -X POST http://localhost:4000/v1/tournaments \
  -H 'content-type: application/json' \
  -d '{"name":"Demo MTT","format":"mtt","maxSeats":8,"minEntries":24}')
TID=$(echo "$T" | jq -r .tournamentId)

# Register p0..p23
curl -s -X POST http://localhost:4000/v1/tournaments/$TID/register-batch \
  -H 'content-type: application/json' \
  -d '{"playerIds":["p0","p1","p2","p3","p4","p5","p6","p7","p8","p9","p10","p11","p12","p13","p14","p15","p16","p17","p18","p19","p20","p21","p22","p23"]}'

curl -s -X POST http://localhost:4000/v1/tournaments/$TID/start | jq '{status, tableCount, summary}'

# Bust down toward final table
for i in $(seq 0 15); do
  curl -s -X POST http://localhost:4000/v1/tournaments/$TID/eliminate \
    -H 'content-type: application/json' \
    -d "{\"playerId\":\"p$i\"}" | jq '{finishPosition, status: .snapshot.status, tables: .snapshot.tableCount}'
done
```
