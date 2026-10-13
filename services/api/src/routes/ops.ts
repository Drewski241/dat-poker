import type { FastifyInstance } from "fastify";
import { requireOpsAuth, opsTokenConfigured } from "../ops-auth.js";
import { getOpsMetricsSnapshot } from "../ops-metrics.js";
import {
  FEEDBACK_LABELS,
  FEEDBACK_STATUSES,
  isFeedbackLabel,
  isFeedbackStatus,
  listFeedback,
  updateFeedbackTriage,
} from "../feedback-store.js";
import { lobbyPresence } from "./tables.js";

const startedAtMs = Date.now();

export function registerOpsRoutes(app: FastifyInstance): void {
  app.get("/v1/ops/status", async (req, reply) => {
    if (!requireOpsAuth(req, reply)) return;
    const presence = lobbyPresence();
    const metrics = getOpsMetricsSnapshot();
    const feedback = await listFeedback(200);
    const openFeedback = feedback.filter((f) => f.status === "open" || f.status === "triage").length;
    return {
      ok: true,
      opsEnabled: Boolean(opsTokenConfigured()),
      buildRef: process.env.DAT_POKER_REPO_REF?.trim() || null,
      uptimeSeconds: Math.floor((Date.now() - startedAtMs) / 1000),
      tables: presence.tableCount,
      seatedHumans: presence.seatedHumans,
      humansInHand: presence.humansInHand,
      today: {
        dau: metrics.dau,
        handsCompleted: metrics.handsCompleted,
        handsPerActivePlayer: metrics.handsPerActivePlayer,
      },
      openFeedback,
      feedbackLabels: FEEDBACK_LABELS,
      feedbackStatuses: FEEDBACK_STATUSES,
    };
  });

  app.get("/v1/ops/metrics", async (req, reply) => {
    if (!requireOpsAuth(req, reply)) return;
    return getOpsMetricsSnapshot();
  });

  app.get<{ Querystring: { limit?: string; status?: string } }>("/v1/ops/feedback", async (req, reply) => {
    if (!requireOpsAuth(req, reply)) return;
    const limit = Number(req.query.limit ?? 50);
    let items = await listFeedback(Number.isFinite(limit) ? limit : 50);
    if (req.query.status && isFeedbackStatus(req.query.status)) {
      items = items.filter((f) => f.status === req.query.status);
    }
    return { feedback: items };
  });

  app.patch<{
    Params: { id: string };
    Body: { label?: string; status?: string; triageNote?: string };
  }>("/v1/ops/feedback/:id", async (req, reply) => {
    if (!requireOpsAuth(req, reply)) return;
    const label = req.body?.label;
    const status = req.body?.status;
    if (label !== undefined && !isFeedbackLabel(label)) {
      return reply.status(400).send({ error: `label must be one of: ${FEEDBACK_LABELS.join(", ")}` });
    }
    if (status !== undefined && !isFeedbackStatus(status)) {
      return reply.status(400).send({ error: `status must be one of: ${FEEDBACK_STATUSES.join(", ")}` });
    }
    try {
      const updated = await updateFeedbackTriage(req.params.id, {
        ...(label ? { label } : {}),
        ...(status ? { status } : {}),
        ...(req.body?.triageNote !== undefined ? { triageNote: req.body.triageNote } : {}),
      });
      return { ok: true, feedback: updated };
    } catch (e) {
      return reply.status(404).send({ error: (e as Error).message });
    }
  });
}
