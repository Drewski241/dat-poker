import type { TournamentPersistedState, TournamentStore } from "./types.js";

/** Process-local store — default for tests and API without Postgres. */
export class MemoryTournamentStore implements TournamentStore {
  private readonly data = new Map<string, TournamentPersistedState>();

  async save(state: TournamentPersistedState): Promise<void> {
    this.data.set(state.config.id, structuredClone(state));
  }

  async load(tournamentId: string): Promise<TournamentPersistedState | null> {
    const row = this.data.get(tournamentId);
    return row ? structuredClone(row) : null;
  }

  async listIds(): Promise<string[]> {
    return [...this.data.keys()];
  }

  async delete(tournamentId: string): Promise<void> {
    this.data.delete(tournamentId);
  }
}
