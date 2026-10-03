import pg from "pg";
import type { TournamentPersistedState, TournamentStore } from "./types.js";

export const TOURNAMENT_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS tournaments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  format TEXT NOT NULL,
  status TEXT NOT NULL,
  state JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tournaments_status_idx ON tournaments (status);
`;

/**
 * Postgres-backed tournament snapshot store.
 * Enable with DATABASE_URL; run `migrate()` once on boot.
 */
export class PostgresTournamentStore implements TournamentStore {
  private readonly pool: pg.Pool;

  constructor(databaseUrl: string) {
    this.pool = new pg.Pool({ connectionString: databaseUrl });
  }

  async migrate(): Promise<void> {
    await this.pool.query(TOURNAMENT_SCHEMA_SQL);
  }

  async save(state: TournamentPersistedState): Promise<void> {
    await this.pool.query(
      `INSERT INTO tournaments (id, name, format, status, state, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, NOW())
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         format = EXCLUDED.format,
         status = EXCLUDED.status,
         state = EXCLUDED.state,
         updated_at = NOW()`,
      [
        state.config.id,
        state.config.name,
        state.config.format,
        state.status,
        JSON.stringify(state),
      ],
    );
  }

  async load(tournamentId: string): Promise<TournamentPersistedState | null> {
    const res = await this.pool.query<{ state: TournamentPersistedState }>(
      `SELECT state FROM tournaments WHERE id = $1`,
      [tournamentId],
    );
    return res.rows[0]?.state ?? null;
  }

  async listIds(): Promise<string[]> {
    const res = await this.pool.query<{ id: string }>(`SELECT id FROM tournaments`);
    return res.rows.map((r) => r.id);
  }

  async delete(tournamentId: string): Promise<void> {
    await this.pool.query(`DELETE FROM tournaments WHERE id = $1`, [tournamentId]);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export async function createTournamentStore(
  databaseUrl: string | undefined,
): Promise<{ store: TournamentStore; kind: "memory" | "postgres" }> {
  if (!databaseUrl?.trim()) {
    const { MemoryTournamentStore } = await import("./memory-store.js");
    return { store: new MemoryTournamentStore(), kind: "memory" };
  }
  try {
    const store = new PostgresTournamentStore(databaseUrl);
    await store.migrate();
    // connectivity check
    await store.listIds();
    return { store, kind: "postgres" };
  } catch {
    const { MemoryTournamentStore } = await import("./memory-store.js");
    return { store: new MemoryTournamentStore(), kind: "memory" };
  }
}
