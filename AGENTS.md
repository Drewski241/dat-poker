# AGENTS.md

Guidance for AI agents working in this repository.

## Cursor Cloud specific instructions

### Product overview

DAT POKER is a **pnpm monorepo** (Node.js ≥ 20, pnpm 9.15 via `packageManager` in root `package.json`). Runnable services:

| Service | Dev command | Default URL |
|---------|-------------|-------------|
| REST API (`@dat-poker/api`) | `pnpm dev:api` | `http://localhost:4000` |
| WebSocket gateway (`@dat-poker/gateway`) | `pnpm dev:gateway` | `ws://localhost:4100/ws` |

Libraries under `packages/*` are built/tested via workspace filters; there is no web client in-repo yet.

### Environment

- Copy `.env.example` → `.env` before running services (root `.env` is loaded by API/gateway via `dotenv` where configured).
- **Postgres/Redis** in `docker/docker-compose.yml` are **not wired** in application code yet; do not start Docker solely for REST poker flows.
- **chia-gaming** (lobby `:3001`, game `:3000`) is optional unless testing `/health/chia-gaming` or Chia head-to-head flows. See `docs/CHIA_INTEGRATION.md`.

### Standard commands (from repo root)

Documented in [README.md](./README.md) and mirrored in CI (`.github/workflows/ci.yml`):

- Install: `corepack enable` then `pnpm install`
- Build: `pnpm build`
- Test: `pnpm test` (Vitest unit tests; no external services required)
- Typecheck: `pnpm typecheck`
- Lint: `pnpm lint` (placeholder `echo` in each package — no ESLint yet)

### Running services for manual E2E

Use **separate terminals** (or tmux sessions) for API and gateway. API alone is enough for REST table/hand flows; gateway is required only for WebSocket ping/subscribe.

**REST smoke (core poker flow):**

```bash
curl -s http://localhost:4000/health
TABLE=$(curl -s -X POST http://localhost:4000/v1/tables -H 'content-type: application/json' -d '{}')
# Then seat players, POST .../hands/start, .../hands/seed, .../hands/deal, .../hands/action
```

See `packages/game-engine/src/nlhe-table.test.ts` for the expected sequence (two players, seeds, deal, fold).

**WebSocket smoke:**

Connect to `ws://localhost:4100/ws`, wait for `connected`, send `{"type":"ping"}`, then `{"type":"subscribe","tableId":"<id>"}`.

### Gotchas

- Buy-in amounts are **mojos** (bigint strings in JSON). Default min buy-in is `2000000000000` per table config.
- In-memory table state: restarting `pnpm dev:api` clears all tables.
- `DAT_ALLOW_DEV_BUYIN=true` in `.env.example` allows dev buy-ins without a configured `DAT_GOVERNANCE_TOKEN_ASSET_ID`.
