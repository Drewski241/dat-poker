import nodemailer from "nodemailer";

export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

const outbox: OutboundEmail[] = [];

export function resetEmailOutboxForTests(): void {
  outbox.length = 0;
}

export function getEmailOutbox(): readonly OutboundEmail[] {
  return outbox;
}

export function lastEmailTo(recipient: string): OutboundEmail | undefined {
  const want = recipient.trim().toLowerCase();
  for (let i = outbox.length - 1; i >= 0; i--) {
    if (outbox[i]!.to.toLowerCase() === want) return outbox[i];
  }
  return undefined;
}

/** Dev / tests: capture mail locally. Production: set DAT_SMTP_HOST (+ credentials). */
export function emailDevMode(): boolean {
  if (process.env.DAT_EMAIL_DEV === "true") return true;
  if (process.env.DAT_ACCOUNTS_PATH === "memory") return true;
  return !process.env.DAT_SMTP_HOST?.trim();
}

function publicAppUrl(): string {
  const raw = process.env.DAT_PUBLIC_APP_URL?.trim() || "http://localhost:5173";
  return raw.replace(/\/+$/, "");
}

export function verificationLink(token: string): string {
  return `${publicAppUrl()}/verify-email?token=${encodeURIComponent(token)}`;
}

export async function sendEmail(message: OutboundEmail): Promise<void> {
  if (emailDevMode()) {
    outbox.push(message);
    return;
  }

  const host = process.env.DAT_SMTP_HOST!.trim();
  const port = Number(process.env.DAT_SMTP_PORT ?? 587);
  const user = process.env.DAT_SMTP_USER?.trim();
  const pass = process.env.DAT_SMTP_PASS?.trim();
  const from = process.env.DAT_SMTP_FROM?.trim() || "DAT Poker <noreply@datspiritpoker.com>";

  const transporter = nodemailer.createTransport({
    host,
    port: Number.isFinite(port) ? port : 587,
    secure: port === 465,
    auth: user && pass ? { user, pass } : undefined,
  });

  await transporter.sendMail({
    from,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html ?? message.text.replace(/\n/g, "<br>\n"),
  });
}

export async function sendVerificationEmail(params: {
  to: string;
  username: string;
  token: string;
}): Promise<void> {
  const link = verificationLink(params.token);
  await sendEmail({
    to: params.to,
    subject: "Verify your DAT Poker account",
    text: [
      `Hi ${params.username},`,
      "",
      "Confirm your email to sign in and play:",
      link,
      "",
      "This link expires in 48 hours. If you did not create an account, ignore this message.",
    ].join("\n"),
    html: `<p>Hi ${params.username},</p><p><a href="${link}">Verify your email</a> to sign in and play.</p><p>This link expires in 48 hours.</p>`,
  });
}

export async function sendPasswordResetEmail(params: {
  to: string;
  username: string;
  resetCode: string;
  expiresInMinutes: number;
}): Promise<void> {
  await sendEmail({
    to: params.to,
    subject: "DAT Poker password reset",
    text: [
      `Hi ${params.username},`,
      "",
      `Your password reset code is: ${params.resetCode}`,
      "",
      `Enter this code on the site within ${params.expiresInMinutes} minutes.`,
      "If you did not request a reset, ignore this email.",
    ].join("\n"),
    html: `<p>Hi ${params.username},</p><p>Your password reset code is: <strong>${params.resetCode}</strong></p><p>Enter it on the site within ${params.expiresInMinutes} minutes.</p>`,
  });
}
