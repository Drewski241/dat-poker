import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

export interface SentMail {
  to: string;
  subject: string;
  text: string;
}

const outbox: SentMail[] = [];
let transport: Transporter | null | undefined;

function emailMode(): "memory" | "log" | "smtp" {
  const raw = process.env.DAT_EMAIL_MODE?.trim().toLowerCase();
  if (raw === "memory" || raw === "log" || raw === "smtp") return raw;
  if (process.env.DAT_SMTP_HOST?.trim()) return "smtp";
  return "log";
}

function fromAddress(): string {
  return process.env.DAT_EMAIL_FROM?.trim() || "DAT Poker <noreply@localhost>";
}

function smtpTransport(): Transporter {
  const host = process.env.DAT_SMTP_HOST?.trim();
  if (!host) {
    throw new Error("DAT_SMTP_HOST is required when DAT_EMAIL_MODE=smtp");
  }
  const port = Number(process.env.DAT_SMTP_PORT ?? 587);
  const user = process.env.DAT_SMTP_USER?.trim();
  const pass = process.env.DAT_SMTP_PASS ?? "";
  const secure = process.env.DAT_SMTP_SECURE === "true" || port === 465;
  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user ? { user, pass } : undefined,
  });
}

async function getTransport(): Promise<Transporter | null> {
  if (transport !== undefined) return transport;
  const mode = emailMode();
  if (mode === "memory" || mode === "log") {
    transport = null;
    return transport;
  }
  transport = smtpTransport();
  return transport;
}

export async function sendMail(params: { to: string; subject: string; text: string }): Promise<void> {
  const mode = emailMode();
  if (mode === "memory") {
    outbox.push({ to: params.to, subject: params.subject, text: params.text });
    return;
  }
  if (mode === "log") {
    console.info(`[dat-poker mail] to=${params.to} subject=${params.subject}\n${params.text}`);
    return;
  }
  const tx = await getTransport();
  if (!tx) throw new Error("Email transport is not configured");
  await tx.sendMail({
    from: fromAddress(),
    to: params.to,
    subject: params.subject,
    text: params.text,
  });
}

export async function sendEmailVerificationMail(params: {
  to: string;
  username: string;
  code: string;
  expiresInMinutes: number;
}): Promise<void> {
  const text = [
    `Hi ${params.username},`,
    "",
    "Verify your DAT Poker account email with this one-time code:",
    "",
    params.code,
    "",
    `The code expires in ${params.expiresInMinutes} minutes.`,
    "",
    "If you did not create an account, you can ignore this message.",
  ].join("\n");
  await sendMail({
    to: params.to,
    subject: "Verify your DAT Poker email",
    text,
  });
}

export async function sendPasswordResetMail(params: {
  to: string;
  username: string;
  code: string;
  expiresInMinutes: number;
}): Promise<void> {
  const text = [
    `Hi ${params.username},`,
    "",
    "Use this one-time code to reset your DAT Poker password:",
    "",
    params.code,
    "",
    `The code expires in ${params.expiresInMinutes} minutes.`,
    "",
    "If you did not request a reset, you can ignore this message.",
  ].join("\n");
  await sendMail({
    to: params.to,
    subject: "Reset your DAT Poker password",
    text,
  });
}

/** Extract an 8-char hex code from the latest matching outbox message (tests). */
export function latestOutboxCodeForTests(to: string, subjectIncludes: string): string | undefined {
  const mail = [...outbox].reverse().find((m) => m.to === to && m.subject.includes(subjectIncludes));
  if (!mail) return undefined;
  const match = mail.text.match(/\b([0-9a-f]{8})\b/i);
  return match?.[1]?.toLowerCase();
}

export function resetMailOutboxForTests(): void {
  outbox.length = 0;
  transport = undefined;
}
