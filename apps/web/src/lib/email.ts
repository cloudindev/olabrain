import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { env } from "./env";

let transporter: Transporter | undefined;

function mailer(): Transporter {
  if (!transporter) {
    const e = env();
    transporter = nodemailer.createTransport({
      host: e.SMTP_HOST,
      port: e.SMTP_PORT,
      secure: e.SMTP_PORT === 465,
      auth: e.SMTP_USER ? { user: e.SMTP_USER, pass: e.SMTP_PASSWORD ?? "" } : undefined,
    });
  }
  return transporter;
}

/**
 * Sends a plain-text email. Outside production, an unreachable SMTP server (e.g. Mailpit
 * not running) logs the message instead of failing the auth flow.
 */
export async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  try {
    await mailer().sendMail({ from: env().EMAIL_FROM, to, subject, text });
  } catch (error) {
    if (env().NODE_ENV === "production") throw error;
    console.warn(
      `[email] SMTP unavailable, message not sent.\nTo: ${to}\nSubject: ${subject}\n\n${text}`,
    );
  }
}
