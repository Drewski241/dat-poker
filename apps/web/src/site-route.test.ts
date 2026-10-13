import { describe, expect, it } from "vitest";
import {
  locationToPath,
  pageToPath,
  parseSiteLocation,
  pathToPage,
  sharedHandPath,
  testerSiteUrls,
} from "./site-route.js";

describe("pathToPage", () => {
  it("treats / as the public landing site", () => {
    expect(pathToPage("/")).toBe("landing");
    expect(pathToPage("")).toBe("landing");
  });

  it("maps /play to the table UI", () => {
    expect(pathToPage("/play")).toBe("play");
    expect(pathToPage("/play/")).toBe("play");
  });

  it("maps /feedback to the tester feedback form", () => {
    expect(pathToPage("/feedback")).toBe("feedback");
    expect(pathToPage("/feedback/")).toBe("feedback");
  });

  it("maps /privacy to the privacy page", () => {
    expect(pathToPage("/privacy")).toBe("privacy");
    expect(pathToPage("/privacy/")).toBe("privacy");
  });

  it("maps /ops to the host ops page", () => {
    expect(pathToPage("/ops")).toBe("ops");
    expect(pathToPage("/ops/")).toBe("ops");
  });

  it("sends unknown paths home so testers still find the site", () => {
    expect(pathToPage("/tables")).toBe("landing");
  });
});

describe("pageToPath", () => {
  it("round-trips landing, play, and feedback", () => {
    expect(pageToPath("landing")).toBe("/");
    expect(pageToPath("play")).toBe("/play");
    expect(pageToPath("feedback")).toBe("/feedback");
    expect(pageToPath("privacy")).toBe("/privacy");
    expect(pageToPath("ops")).toBe("/ops");
    expect(pathToPage(pageToPath("feedback"))).toBe("feedback");
    expect(pathToPage(pageToPath("privacy"))).toBe("privacy");
    expect(pathToPage(pageToPath("ops"))).toBe("ops");
  });
});

describe("parseSiteLocation / shared hand", () => {
  it("parses /h/:handId as a shared hand view", () => {
    expect(parseSiteLocation("/h/abc-123")).toEqual({
      page: "sharedHand",
      handId: "abc-123",
    });
    expect(parseSiteLocation("/h/abc-123/")).toEqual({
      page: "sharedHand",
      handId: "abc-123",
    });
  });

  it("decodes URI components in hand ids", () => {
    expect(parseSiteLocation("/h/hand%2Fid")).toEqual({
      page: "sharedHand",
      handId: "hand/id",
    });
  });

  it("builds share paths and round-trips", () => {
    expect(sharedHandPath("hand-1")).toBe("/h/hand-1");
    const loc = parseSiteLocation(sharedHandPath("uuid-xyz"));
    expect(loc).toEqual({ page: "sharedHand", handId: "uuid-xyz" });
    expect(locationToPath(loc)).toBe("/h/uuid-xyz");
  });

  it("does not treat bare /h as a shared hand", () => {
    expect(parseSiteLocation("/h")).toEqual({ page: "landing" });
    expect(parseSiteLocation("/h/")).toEqual({ page: "landing" });
  });
});

describe("testerSiteUrls", () => {
  it("builds shareable home, play, and feedback URLs", () => {
    expect(testerSiteUrls("https://54-12-34-56.sslip.io")).toEqual({
      home: "https://54-12-34-56.sslip.io/",
      play: "https://54-12-34-56.sslip.io/play",
      feedback: "https://54-12-34-56.sslip.io/feedback",
    });
  });
});
