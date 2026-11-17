import "server-only";
import nodemailer, { type SendMailOptions, type Transporter } from "nodemailer";
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

/** Optional HTML body (the text stays as the plain alternative) and inline images (cid). */
export type EmailExtras = Pick<SendMailOptions, "html" | "attachments">;

/**
 * Sends a plain-text email, with an HTML version when given. Outside production, an unreachable SMTP server (e.g. Mailpit
 * not running) logs the message instead of failing the auth flow.
 */
export async function sendEmail(
  to: string,
  subject: string,
  text: string,
  extras?: EmailExtras,
): Promise<void> {
  try {
    await mailer().sendMail({ from: env().EMAIL_FROM, to, subject, text, ...extras });
  } catch (error) {
    if (env().NODE_ENV === "production") throw error;
    console.warn(
      `[email] SMTP unavailable, message not sent.\nTo: ${to}\nSubject: ${subject}\n\n${text}`,
    );
  }
}

/** False in production while no SMTP server is configured (SMTP_HOST left at its default). */
export function emailReady(): boolean {
  const e = env();
  return e.NODE_ENV !== "production" || e.SMTP_HOST !== "localhost";
}

/** Like sendEmail, but reports failure instead of throwing. */
export async function trySendEmail(
  to: string,
  subject: string,
  text: string,
  extras?: EmailExtras,
): Promise<boolean> {
  if (!emailReady()) return false;
  try {
    await sendEmail(to, subject, text, extras);
    return true;
  } catch (error) {
    console.error(`[email] not sent: ${(error as Error).message}`);
    return false;
  }
}
