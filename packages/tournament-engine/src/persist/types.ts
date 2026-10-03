import type { TournamentEngine } from "../tournament.js";

export type TournamentPersistedState = ReturnType<TournamentEngine["exportState"]>;

export interface TournamentStore {
  save(state: TournamentPersistedState): Promise<void>;
  load(tournamentId: string): Promise<TournamentPersistedState | null>;
  listIds(): Promise<string[]>;
  delete(tournamentId: string): Promise<void>;
}
