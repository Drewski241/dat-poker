import { describe, expect, it } from "vitest";
import { pageToPath, pathToPage, testerSiteUrls } from "./site-route.js";

describe("pathToPage", () => {
  it("treats / as the public landing site", () => {
    expect(pathToPage("/")).toBe("landing");
    expect(pathToPage("")).toBe("landing");
  });

  it("maps /play to the table UI", () => {
    expect(pathToPage("/play")).toBe("play");
    expect(pathToPage("/play/")).toBe("play");
  });

  it("sends unknown paths home so testers still find the site", () => {
    expect(pathToPage("/tables")).toBe("landing");
  });
});

describe("pageToPath", () => {
  it("round-trips landing and play", () => {
    expect(pageToPath("landing")).toBe("/");
    expect(pageToPath("play")).toBe("/play");
    expect(pathToPage(pageToPath("play"))).toBe("play");
  });
});

describe("testerSiteUrls", () => {
  it("builds shareable home and play URLs", () => {
    expect(testerSiteUrls("https://54-12-34-56.sslip.io")).toEqual({
      home: "https://54-12-34-56.sslip.io/",
      play: "https://54-12-34-56.sslip.io/play",
    });
  });
});
