import nodemailer, { type Transporter } from "nodemailer";
import type { Env } from "../config/env.js";
import { HttpError } from "../utils/errors.js";
import { orgConfig } from "../config/org.js";

export interface MailOptions {
  to?: string;
  bcc?: string[];
  subject: string;
  text: string;
  html?: string;
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
}
export interface Mailer {
  ready: boolean;
  send(options: MailOptions): Promise<void>;
}

/** E-mail through the organisation's own SMTP account. Without SMTP settings, `ready` is false and sending returns a clear 503. */
export function createMailer(env: Pick<Env, "SMTP_HOST" | "SMTP_PORT" | "SMTP_USER" | "SMTP_PASS" | "SMTP_FROM">): Mailer {
  const ready = Boolean(env.SMTP_HOST && env.SMTP_FROM);
  let transport: Transporter | undefined;
  return {
    ready,
    async send(options) {
      if (!ready) throw new HttpError(503, "Email is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS and SMTP_FROM.");
      transport ??= nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_PORT === 465,
        auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined
      });
      await transport.sendMail({ from: env.SMTP_FROM, replyTo: orgConfig.email, ...options });
    }
  };
}
