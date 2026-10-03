#!/usr/bin/env node
/**
 * CLI: simulate a full tournament with bots (no beta testers needed).
 *
 *   pnpm sim:tournament -- --players 24 --seed 1
 */
import { simulateTournament } from "./simulator.js";

function arg(name: string, fallback?: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0) return process.argv[idx + 1];
  return fallback;
}

const players = Number(arg("players", "16"));
const seed = Number(arg("seed", "1"));
const style = (arg("style", "random") ?? "random") as "passive" | "loose" | "random";

const result = await simulateTournament({
  players,
  seed,
  style,
  onProgress: (p) => {
    if (p.hands % 25 === 0) {
      console.log(
        `hands=${p.hands} active=${p.active} tables=${p.tables} status=${p.status}`,
      );
    }
  },
});

console.log(
  JSON.stringify(
    {
      ...result,
      prizePoolMojos: result.prizePoolMojos.toString(),
      payouts: result.payouts.map((p) => ({
        ...p,
        prizeMojos: p.prizeMojos.toString(),
      })),
    },
    null,
    2,
  ),
);

if (result.status !== "completed") {
  process.exitCode = 1;
}
