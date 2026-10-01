# Tournament formats (SNG + MTT)

DAT POKER seats tournament fields on top of the same NLHE table engine used for cash games.

## Formats

| Format | Tables | Typical field |
|--------|--------|-----------------|
| `sng` | 1 | Up to `maxSeats` (default 8) |
| `mtt` | Many | Thousands; tables created as `ceil(n / maxSeats)` |

Default MTT/SNG table size is **8-max**.

## Lifecycle

1. `POST /v1/tournaments` — create (`format`, `maxSeats`, `maxEntries`, buy-in, starting stack)
2. `POST /v1/tournaments/:id/register` or `register-batch` — enroll players
3. `POST /v1/tournaments/:id/start` — even seating across tables + open `NlheTableEngine` per table
4. Play hands on each table (same commit-reveal flow as cash)
5. `POST /v1/tournaments/:id/eliminate` — bust a player; engine **rebalances**, breaks short tables, and collapses to a **final table** when ≤ `maxSeats` remain
6. Last player standing → `completed`

## Seating & reseating rules

- Initial seat: distribute so every table has the same count ±1, none over `maxSeats`
- After each elimination: if remaining players fit on fewer tables, **break** the shortest table and move survivors into open seats
- While multiple tables remain, keep counts balanced (max − min ≤ 1)
- When remaining ≤ `maxSeats`, merge onto one **final table**

Package: `@dat-poker/tournament-engine` (`TournamentEngine`, `rebalanceTables`, seating helpers).

## Smoke (API)

```bash
# Create 24-runner MTT
T=$(curl -s -X POST http://localhost:4000/v1/tournaments \
  -H 'content-type: application/json' \
  -d '{"name":"Demo MTT","format":"mtt","maxSeats":8,"maxEntries":24,"minEntries":24}')
TID=$(echo "$T" | jq -r .tournamentId)

# Register p0..p23
curl -s -X POST http://localhost:4000/v1/tournaments/$TID/register-batch \
  -H 'content-type: application/json' \
  -d '{"playerIds":["p0","p1","p2","p3","p4","p5","p6","p7","p8","p9","p10","p11","p12","p13","p14","p15","p16","p17","p18","p19","p20","p21","p22","p23"]}'

curl -s -X POST http://localhost:4000/v1/tournaments/$TID/start | jq '{status, tableCount, activeCount}'

# Bust down toward final table
for i in $(seq 0 15); do
  curl -s -X POST http://localhost:4000/v1/tournaments/$TID/eliminate \
    -H 'content-type: application/json' \
    -d "{\"playerId\":\"p$i\"}" | jq '{finishPosition, status: .snapshot.status, tables: .snapshot.tableCount}'
done
```
