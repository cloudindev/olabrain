import "server-only";
import { env } from "@/lib/env";
import type { SocialProvider } from "./social-buttons";

export function enabledSocialProviders(): SocialProvider[] {
  const e = env();
  const out: SocialProvider[] = [];
  if (e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET) out.push("google");
  if (e.MICROSOFT_CLIENT_ID && e.MICROSOFT_CLIENT_SECRET) out.push("microsoft");
  return out;
}
