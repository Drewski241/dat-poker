import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseYourTurnCueHash,
  pickYourTurnCue,
  YOUR_TURN_CUE_CYCLE,
} from "./your-turn-cue.js";

describe("pickYourTurnCue", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    });
  });

  it("cycles through all cues in order", () => {
    let prev: (typeof YOUR_TURN_CUE_CYCLE)[number] | null = null;
    for (const expected of YOUR_TURN_CUE_CYCLE) {
      expect(pickYourTurnCue(prev)).toBe(expected);
      prev = expected;
    }
    expect(pickYourTurnCue(prev)).toBe(YOUR_TURN_CUE_CYCLE[0]);
  });

  it("starts with sloth when there is no prior cue", () => {
    expect(pickYourTurnCue(null)).toBe("sloth");
  });
});

describe("parseYourTurnCueHash", () => {
  it("parses legacy sloth and turn- previews", () => {
    expect(parseYourTurnCueHash("#sloth")).toBe("sloth");
    expect(parseYourTurnCueHash("#turn-owl")).toBe("owl");
    expect(parseYourTurnCueHash("#turn-terrier")).toBe("terrier");
    expect(parseYourTurnCueHash("#lucky")).toBeNull();
  });
});
