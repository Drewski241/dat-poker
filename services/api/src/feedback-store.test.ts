import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  allowFeedbackFrom,
  decodeDataUrl,
  detectImageKind,
  resetFeedbackRateLimitForTests,
  saveFeedback,
} from "./feedback-store.js";

const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

describe("detectImageKind", () => {
  it("accepts PNG magic and rejects SVG", () => {
    expect(detectImageKind(PNG_1x1)).toBe("png");
    expect(detectImageKind(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>"))).toBeNull();
  });
});

describe("decodeDataUrl", () => {
  it("decodes a data URL or raw base64", () => {
    const raw = PNG_1x1.toString("base64");
    expect(decodeDataUrl(`data:image/png;base64,${raw}`)?.equals(PNG_1x1)).toBe(true);
    expect(decodeDataUrl(raw)?.equals(PNG_1x1)).toBe(true);
  });
});

describe("allowFeedbackFrom", () => {
  it("rate-limits a noisy IP", () => {
    resetFeedbackRateLimitForTests();
    for (let i = 0; i < 8; i++) {
      expect(allowFeedbackFrom("1.2.3.4", 1_000 + i)).toBe(true);
    }
    expect(allowFeedbackFrom("1.2.3.4", 1_010)).toBe(false);
    expect(allowFeedbackFrom("9.9.9.9", 1_010)).toBe(true);
  });
});

describe("saveFeedback", () => {
  it("writes comment JSON and a PNG, and refuses SVG", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dat-feedback-"));
    process.env.DAT_FEEDBACK_DIR = dir;
    try {
      const saved = await saveFeedback({
        comment: "QR never appeared on /play",
        contact: "tester@example.com",
        page: "/play",
        images: [{ dataBase64: PNG_1x1.toString("base64") }],
      });
      const json = JSON.parse(await readFile(join(dir, saved.id, "feedback.json"), "utf8")) as {
        comment: string;
        images: string[];
      };
      expect(json.comment).toContain("QR never appeared");
      expect(json.images).toEqual(["image-1.png"]);

      await expect(
        saveFeedback({
          comment: "xss",
          images: [{ dataBase64: Buffer.from("<svg></svg>").toString("base64") }],
        }),
      ).rejects.toThrow(/JPEG, PNG, or WebP/);
    } finally {
      await rm(dir, { recursive: true, force: true });
      delete process.env.DAT_FEEDBACK_DIR;
    }
  });
});
