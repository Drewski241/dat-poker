import { describe, expect, it } from "vitest";
import { treasuryStatusText } from "./treasury-status.js";

describe("treasuryStatusText", () => {
  const base = {
    treasuryConfigured: true,
    treasuryReachable: true,
    treasuryHost: "127.0.0.1:4200",
    treasuryError: null as string | null,
    treasuryWalletRpcReachable: true as boolean | null,
  };

  it("shows the Sage fund/sync error as-is", () => {
    expect(
      treasuryStatusText({
        ...base,
        treasuryError: "Treasury Sage has not finished syncing this key",
      }),
    ).toMatch(/not finished syncing/);
  });

  it("is active when HTTP and Sage RPC are up", () => {
    expect(treasuryStatusText(base)).toMatch(/active at 127\.0\.0\.1:4200/);
  });
});
