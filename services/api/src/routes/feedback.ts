import type { FastifyInstance } from "fastify";
import {
  allowFeedbackFrom,
  saveFeedback,
  type FeedbackImageInput,
} from "../feedback-store.js";

export function registerFeedbackRoutes(app: FastifyInstance): void {
  app.post<{
    Body: {
      comment?: string;
      contact?: string;
      page?: string;
      images?: FeedbackImageInput[];
    };
  }>("/v1/feedback", { bodyLimit: 8_000_000 }, async (req, reply) => {
    const ip = req.ip || req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() || "unknown";
    if (!allowFeedbackFrom(ip)) {
      return reply.status(429).send({ error: "Too many feedback notes from this network. Try again later." });
    }
    try {
      const result = await saveFeedback({
        comment: req.body?.comment ?? "",
        contact: req.body?.contact,
        page: req.body?.page,
        userAgent: req.headers["user-agent"],
        images: req.body?.images,
      });
      return {
        ok: true,
        id: result.id,
        imageCount: result.imageCount,
        note: "Thanks — the operator can read this on the game host. Images are not published on the website.",
      };
    } catch (e) {
      return reply.status(400).send({ error: (e as Error).message });
    }
  });
}
