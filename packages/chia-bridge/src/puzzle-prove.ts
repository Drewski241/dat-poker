import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface PuzzleCondition {
  opcode: number;
  pubkey?: string;
  message?: string;
  puzzleHash?: string;
  amount?: string;
  value?: string;
}

export interface PuzzleSpendResult {
  ok: boolean;
  conditions?: PuzzleCondition[];
  error?: string;
}

const proveScript = join(dirname(fileURLToPath(import.meta.url)), "../puzzles/prove.py");

function pythonPath(): string {
  const home = process.env.HOME ?? "";
  return `${home}/.local/bin${process.env.PATH ? `:${process.env.PATH}` : ""}`;
}

export function runPuzzleSpend(payload: unknown): PuzzleSpendResult {
  try {
    const stdout = execFileSync("python3", [proveScript], {
      input: JSON.stringify(payload),
      encoding: "utf8",
      env: { ...process.env, PATH: pythonPath() },
    });
    return JSON.parse(stdout) as PuzzleSpendResult;
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? (error as Error).message;
    return { ok: false, error: stderr };
  }
}

export function runPuzzleSelfTest(): {
  ok: boolean;
  closeMessage: string;
  stateMessage: string;
  catPuzzleHash: string;
  channelModHash: string;
  unrollModHash: string;
} {
  const stdout = execFileSync("python3", [proveScript, "--self-test"], {
    encoding: "utf8",
    env: { ...process.env, PATH: pythonPath() },
  });
  return JSON.parse(stdout) as ReturnType<typeof runPuzzleSelfTest>;
}
