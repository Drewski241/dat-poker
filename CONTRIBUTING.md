# Contributing

## Setup

```bash
cd dat-poker
corepack enable
pnpm install
pnpm build
pnpm test
```

## Branch naming

Use feature branches off `main` (e.g. `feature/web-client`, `fix/hand-settlement`).

## Pull requests

- Keep changes focused on one concern
- Run `pnpm test` and `pnpm typecheck` before opening
- Update docs when changing architecture or public APIs
