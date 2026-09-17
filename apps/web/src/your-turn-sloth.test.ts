import { describe, expect, it } from "vitest";
import { YOUR_TURN_COPY } from "./components/YourTurnSloth.js";

describe("YourTurnSloth", () => {
  it("tells the player it is their turn, with no rush", () => {
    expect(YOUR_TURN_COPY).toBe("It's your turn! No Rush!");
  });
});
