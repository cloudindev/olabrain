import "server-only";
import { env } from "./env";

/** Link that lets the invited person accept (also sent by email when SMTP works). */
export function invitationUrl(id: string): string {
  return `${env().APP_URL.replace(/\/$/, "")}/invitations/${id}`;
}
