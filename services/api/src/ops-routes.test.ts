import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { serializeForJson } from "./serialize.js";
import { registerOpsRoutes } from "./routes/ops.js";
import { registerFeedbackRoutes } from "./routes/feedback.js";
import { resetFeedbackRateLimitForTests, saveFeedback } from "./feedback-store.js";
import {
  recordActivePlayer,
  recordHandCompleted,
  resetOpsMetricsForTests,
} from "./ops-metrics.js";
import { resetTablesForTests } from "./routes/tables.js";

async function buildApp() {
  const app = Fastify();
  app.addHook("preSerialization", async (_req, _reply, payload) => {
    if (payload === undefined || payload === null) return payload;
    return serializeForJson(payload);
  });
  registerFeedbackRoutes(app);
  registerOpsRoutes(app);
  return app;
}

describe("ops routes", () => {
  let feedbackDir = "";

  beforeEach(async () => {
    process.env.DAT_OPS_TOKEN = "ops-test-token-ok";
    feedbackDir = await mkdtemp(join(tmpdir(), "dat-ops-fb-"));
    process.env.DAT_FEEDBACK_DIR = feedbackDir;
    resetFeedbackRateLimitForTests();
    resetOpsMetricsForTests();
    resetTablesForTests();
  });

  afterEach(async () => {
    delete process.env.DAT_OPS_TOKEN;
    delete process.env.DAT_FEEDBACK_DIR;
    if (feedbackDir) await rm(feedbackDir, { recursive: true, force: true });
  });

  it("requires ops token and returns metrics + triageable feedback", async () => {
    const app = await buildApp();
    const denied = await app.inject({ method: "GET", url: "/v1/ops/metrics" });
    expect(denied.statusCode).toBe(401);

    recordActivePlayer("p1");
    recordHandCompleted({
      reason: "fold",
      boardLen: 3,
      participantIds: ["p1", "dat-poker:house"],
    });
    const saved = await saveFeedback({ comment: "Buttons too small on phone", page: "/play" });

    const metrics = await app.inject({
      method: "GET",
      url: "/v1/ops/metrics",
      headers: { "x-dat-ops-token": "ops-test-token-ok" },
    });
    expect(metrics.statusCode).toBe(200);
    const body = JSON.parse(metrics.body) as {
      dau: number;
      handsCompleted: number;
      dropOffStreet: { flop: number };
    };
    expect(body.dau).toBe(1);
    expect(body.handsCompleted).toBe(1);
    expect(body.dropOffStreet.flop).toBe(1);

    const list = await app.inject({
      method: "GET",
      url: "/v1/ops/feedback",
      headers: { authorization: "Bearer ops-test-token-ok" },
    });
    expect(list.statusCode).toBe(200);
    const listed = JSON.parse(list.body) as { feedback: { id: string; label: string; status: string }[] };
    expect(listed.feedback[0]?.id).toBe(saved.id);
    expect(listed.feedback[0]?.label).toBe("new");
    expect(listed.feedback[0]?.status).toBe("open");

    const patch = await app.inject({
      method: "PATCH",
      url: `/v1/ops/feedback/${saved.id}`,
      headers: { "x-dat-ops-token": "ops-test-token-ok", "content-type": "application/json" },
      payload: { label: "ux", status: "triage", triageNote: "mobile action bar" },
    });
    expect(patch.statusCode).toBe(200);
    const patched = JSON.parse(patch.body) as {
      feedback: { label: string; status: string; triageNote?: string };
    };
    expect(patched.feedback.label).toBe("ux");
    expect(patched.feedback.status).toBe("triage");
    expect(patched.feedback.triageNote).toContain("mobile");

    const status = await app.inject({
      method: "GET",
      url: "/v1/ops/status",
      headers: { "x-dat-ops-token": "ops-test-token-ok" },
    });
    expect(status.statusCode).toBe(200);
    const st = JSON.parse(status.body) as { openFeedback: number; today: { dau: number } };
    expect(st.openFeedback).toBe(1);
    expect(st.today.dau).toBe(1);

    await app.close();
  });

  it("returns 503 when ops token is not configured", async () => {
    delete process.env.DAT_OPS_TOKEN;
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/ops/status",
      headers: { "x-dat-ops-token": "anything-long" },
    });
    expect(res.statusCode).toBe(503);
    await app.close();
  });
});
