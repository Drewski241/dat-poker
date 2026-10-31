import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export const MAX_FEEDBACK_COMMENT = 8_000;
export const MAX_FEEDBACK_CONTACT = 200;
export const MAX_FEEDBACK_IMAGES = 3;
export const MAX_FEEDBACK_IMAGE_BYTES = 1_500_000;

const hits = new Map<string, number[]>();

export function feedbackDir(): string {
  const fromEnv = process.env.DAT_FEEDBACK_DIR?.trim();
  if (fromEnv) return resolve(fromEnv);
  return resolve(process.cwd(), "data/feedback");
}

export function allowFeedbackFrom(ip: string, now = Date.now(), max = 8, windowMs = 60 * 60 * 1000): boolean {
  const key = ip || "unknown";
  const prev = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (prev.length >= max) {
    hits.set(key, prev);
    return false;
  }
  prev.push(now);
  hits.set(key, prev);
  return true;
}

export function resetFeedbackRateLimitForTests(): void {
  hits.clear();
}

export function detectImageKind(bytes: Buffer): "jpeg" | "png" | "webp" | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  const riff = bytes.subarray(0, 4).toString("ascii");
  const webp = bytes.subarray(8, 12).toString("ascii");
  if (riff === "RIFF" && webp === "WEBP") return "webp";
  return null;
}

export function decodeDataUrl(raw: string): Buffer | null {
  const trimmed = raw.trim();
  const comma = trimmed.indexOf(",");
  const payload = comma >= 0 && trimmed.slice(0, comma).includes("base64") ? trimmed.slice(comma + 1) : trimmed;
  try {
    const buf = Buffer.from(payload, "base64");
    if (!buf.length) return null;
    return buf;
  } catch {
    return null;
  }
}

export interface FeedbackImageInput {
  name?: string;
  type?: string;
  dataBase64: string;
}

export async function saveFeedback(params: {
  comment: string;
  contact?: string;
  page?: string;
  userAgent?: string;
  images?: FeedbackImageInput[];
}): Promise<{ id: string; imageCount: number }> {
  const comment = params.comment.trim();
  if (comment.length < 3) {
    throw new Error("Please write a short comment");
  }
  if (comment.length > MAX_FEEDBACK_COMMENT) {
    throw new Error("Comment is too long");
  }
  const contact = (params.contact ?? "").trim().slice(0, MAX_FEEDBACK_CONTACT);
  const page = (params.page ?? "").trim().slice(0, 80);
  const images = params.images ?? [];
  if (images.length > MAX_FEEDBACK_IMAGES) {
    throw new Error("At most 3 images");
  }

  const id = randomUUID();
  const dir = join(feedbackDir(), id);
  await mkdir(dir, { recursive: true, mode: 0o700 });

  const saved: string[] = [];
  for (const [i, image] of images.entries()) {
    const bytes = decodeDataUrl(image.dataBase64);
    if (!bytes) {
      throw new Error("Image could not be read");
    }
    if (bytes.length > MAX_FEEDBACK_IMAGE_BYTES) {
      throw new Error("Each image must be under 1.5 MB");
    }
    const kind = detectImageKind(bytes);
    if (!kind) {
      throw new Error("Images must be JPEG, PNG, or WebP (no SVG)");
    }
    const filename = `image-${i + 1}.${kind === "jpeg" ? "jpg" : kind}`;
    await writeFile(join(dir, filename), bytes, { mode: 0o600 });
    saved.push(filename);
  }

  const record = {
    id,
    createdAt: new Date().toISOString(),
    page,
    contact,
    comment,
    userAgent: (params.userAgent ?? "").slice(0, 300),
    images: saved,
  };
  await writeFile(join(dir, "feedback.json"), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  return { id, imageCount: saved.length };
}
