import "server-only";
import {
  accounts,
  invitations,
  memberships,
  sessions,
  tenants,
  users,
  verifications,
} from "@brainagent/db";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { organization } from "better-auth/plugins/organization";
import { desc, eq } from "drizzle-orm";
import { db } from "./db";
import { sendEmail } from "./email";
import { env } from "./env";
import { invitationUrl } from "./invitations";
import { ac, roles } from "./permissions";

function socialProviders(): BetterAuthOptions["socialProviders"] {
  const e = env();
  return {
    ...(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET
      ? { google: { clientId: e.GOOGLE_CLIENT_ID, clientSecret: e.GOOGLE_CLIENT_SECRET } }
      : {}),
    ...(e.MICROSOFT_CLIENT_ID && e.MICROSOFT_CLIENT_SECRET
      ? {
          microsoft: {
            clientId: e.MICROSOFT_CLIENT_ID,
            clientSecret: e.MICROSOFT_CLIENT_SECRET,
            tenantId: e.MICROSOFT_TENANT_ID,
          },
        }
      : {}),
  };
}

/** Last organization the user joined: becomes the active one on a new session. */
async function defaultOrganizationFor(userId: string): Promise<string | null> {
  const [row] = await db()
    .select({ organizationId: memberships.organizationId })
    .from(memberships)
    .where(eq(memberships.userId, userId))
    .orderBy(desc(memberships.createdAt))
    .limit(1);
  return row?.organizationId ?? null;
}

function createAuth() {
  const e = env();
  return betterAuth({
    appName: "OlaBrain",
    baseURL: e.BETTER_AUTH_URL,
    secret: e.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db(), {
      provider: "pg",
      schema: { users, sessions, accounts, verifications, tenants, memberships, invitations },
    }),
    user: { modelName: "users" },
    session: {
      modelName: "sessions",
      // Signed copy of the session in a cookie for 5 min: page loads don't query the
      // sessions table every time (memberships are still checked per request).
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    account: { modelName: "accounts" },
    verification: { modelName: "verifications" },
    advanced: { database: { generateId: "uuid" } },
    // In-memory store: per process. Move to Redis (secondaryStorage) before running
    // several web instances.
    rateLimit: { enabled: e.AUTH_RATE_LIMIT },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      requireEmailVerification: e.AUTH_REQUIRE_EMAIL_VERIFICATION,
    },
    emailVerification: {
      sendOnSignUp: e.AUTH_REQUIRE_EMAIL_VERIFICATION,
      sendOnSignIn: e.AUTH_REQUIRE_EMAIL_VERIFICATION,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await sendEmail(
          user.email,
          "Confirma tu email en OlaBrain",
          `Hola ${user.name},\n\nConfirma tu email para entrar en OlaBrain:\n${url}\n\nSi no has creado esta cuenta, ignora este mensaje.`,
        );
      },
    },
    socialProviders: socialProviders(),
    databaseHooks: {
      session: {
        create: {
          before: async (session) => ({
            data: {
              ...session,
              activeOrganizationId: await defaultOrganizationFor(session.userId),
            },
          }),
        },
      },
    },
    plugins: [
      organization({
        ac,
        roles,
        creatorRole: "owner",
        allowUserToCreateOrganization: true,
        schema: {
          organization: { modelName: "tenants" },
          member: { modelName: "memberships" },
          invitation: { modelName: "invitations" },
        },
        sendInvitationEmail: async ({ email, organization: org, inviter, id }) => {
          const url = invitationUrl(id);
          // The invitation already exists and its link is shown in Settings › Organization
          // to copy: an SMTP failure must not turn the invitation into an error.
          try {
            await sendEmail(
              email,
              `Invitación a ${org.name} en OlaBrain`,
              `${inviter.user.name} te ha invitado a unirte a ${org.name} en OlaBrain:\n${url}`,
            );
          } catch (error) {
            console.warn("[auth] invitation email not sent", { invitationId: id, error });
          }
        },
      }),
      // Must be last: lets server actions set auth cookies.
      nextCookies(),
    ],
  });
}

type Auth = ReturnType<typeof createAuth>;
const globalForAuth = globalThis as unknown as { brainagentAuth?: Auth };

/** Lazily built so `next build` works without secrets. */
export function auth(): Auth {
  if (!globalForAuth.brainagentAuth) globalForAuth.brainagentAuth = createAuth();
  return globalForAuth.brainagentAuth;
}
