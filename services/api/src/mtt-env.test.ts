import { afterEach, describe, expect, it } from "vitest";
import { DAT_MTT_DEFAULTS } from "@dat-poker/shared";
import { normalizeJoinMttFieldSize, readMttFieldSize } from "./mtt-env.js";

describe("readMttFieldSize", () => {
  const env = process.env;

  afterEach(() => {
    process.env = { ...env };
  });

  it("defaults to 500 when DAT_POKER_STAGE=beta", () => {
    delete process.env.DAT_MTT_FIELD_SIZE;
    process.env.DAT_POKER_STAGE = "beta";
    expect(readMttFieldSize()).toBe(500);
  });

  it("respects DAT_MTT_FIELD_SIZE override", () => {
    process.env.DAT_MTT_FIELD_SIZE = "128";
    process.env.DAT_POKER_STAGE = "beta";
    expect(readMttFieldSize()).toBe(128);
  });
});

describe("normalizeJoinMttFieldSize", () => {
  const env = process.env;

  afterEach(() => {
    process.env = { ...env };
  });

  it("defaults to the large field on beta", () => {
    delete process.env.DAT_MTT_FIELD_SIZE;
    process.env.DAT_POKER_STAGE = "beta";
    expect(normalizeJoinMttFieldSize()).toBe(500);
    expect(normalizeJoinMttFieldSize(DAT_MTT_DEFAULTS.fieldSize)).toBe(16);
  });
});
