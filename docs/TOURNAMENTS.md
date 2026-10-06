# Tournament formats (SNG + MTT)

DAT POKER seats tournament fields on top of the same NLHE table engine used for cash games.

## Formats

| Format | Tables | Field size |
|--------|--------|------------|
| `sng` | 1 | Up to `maxSeats` (default 8) |
| `mtt` | Many | **Unlimited by default** — `ceil(n / maxSeats)` tables |

Default table size is **8-max**. A 100,000-player MTT → **12,500** tables.

## Testing without beta testers

Use the **bot simulator** — it registers N bots, plays real NLHE hands (commit-reveal + actions), eliminates, rebalances, and pays the prize pool:

```bash
# 16-bot MTT end-to-end
pnpm sim:tournament -- --players 16 --seed 1 --style random

# Quiet unit coverage (CI)
pnpm --filter @dat-poker/tournament-engine test
```

Bots support `passive` | `loose` | `random` styles. This is the primary way to validate seating, hand-for-hand, payouts, and late-reg before any human soft launch.

## Prize pools & ICM

- Each entry contributes `buyIn − fee` (`feeBps`, default 5%) to the prize pool
- Paid places scale with field size; ladder percentages sum to 100%
- `GET /v1/tournaments/:id/icm` returns live Malmuth–Harville equity for active stacks
- Finish positions lock cash prizes from the ladder

## Late registration & re-entries

| Option | Default (MTT) | Meaning |
|--------|---------------|---------|
| `lateRegThroughLevel` | `3` | Late reg open through this blind level (`-1` = closed at start) |
| `reentryAllowed` | `true` | Busts may buy back in while late reg is open |
| `maxReentries` | `1` | Cap per player |

`POST /v1/tournaments/:id/register` works pre-start and during late reg.  
`POST /v1/tournaments/:id/reenter` buys back an eliminated player.

## Hand-for-hand

When the field hits the **bubble** (`active == paidPlaces + 1`) or **final table**, tables must finish the current hand before any deals the next.  
`POST .../tables/:tableId/hand-complete` reports in; `canDeal` on the table GET reflects the barrier.

## Persistence

| Mode | When |
|------|------|
| **Memory** | Default (no `DATABASE_URL`, or Postgres unreachable) |
| **Postgres** | `DATABASE_URL` set — auto-migrates `tournaments` JSONB snapshots |

```bash
# Optional local Postgres
docker compose -f docker/docker-compose.yml up -d postgres
# DATABASE_URL=postgres://dat_poker:dat_poker@localhost:5432/dat_poker
```

## Unlimited registration

MTT `maxEntries` defaults to `null` (uncapped). Optional hard cap: `"maxEntries": 50000`.

## Lifecycle API

1. `POST /v1/tournaments` — create (fees, late reg, re-entries, seats…)
2. `POST .../register` or `register-batch`
3. `POST .../fill-house` — optional house bots to pad the field
4. `POST .../start` — seat + build prize pool
5. Play hands on tournament `tableId` via `/v1/tables/:tableId/hands/*` (house auto-acts)
6. Hand end auto-syncs eliminations + hand-for-hand; `.../hand-complete` still available
7. `POST .../eliminate` / `.../reenter` while late reg open
8. `POST .../blind-up` — may close late reg and enable bubble sync
9. Last player → `completed` with payouts (house finishers get `prizeMojos: 0`)

### Playable SNG (human + house)

One-shot start for a single human against house-filled seats:

```bash
curl -s -X POST http://localhost:4000/v1/tournaments/playable-sng \
  -H 'content-type: application/json' \
  -d '{"playerId":"alice","maxSeats":8}'
# → { tournamentId, tableId, seats, … }

# Then the usual hand flow on that tableId:
# POST /v1/tables/:tableId/hands/start
# POST /v1/tables/:tableId/hands/seed  {"playerId":"alice"}  # house seeds + auto-deal
# POST /v1/tables/:tableId/hands/action {"playerId":"alice","action":"fold"}
```

Package: `@dat-poker/tournament-engine`.
