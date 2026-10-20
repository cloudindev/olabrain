/**
 * Outlook 365 through Microsoft Graph (delegated permissions, the user signs in):
 *   OAuth 2.0 authorization code + PKCE on login.microsoftonline.com/{tenant}/oauth2/v2.0
 *   Graph v1.0: /me/messages, /me/sendMail, /me/calendarView, /me/events
 * The platform's Entra app (MICROSOFT_CLIENT_ID/SECRET) must list the redirect URI
 * {APP_URL}/api/connections/oauth/callback and the delegated scopes below.
 */
import { createHash, randomBytes } from "node:crypto";
import { executeHttp } from "../http";
import {
  NativeToolError,
  int,
  schema,
  str,
  type NativeCallContext,
  type NativeResult,
  type NativeToolDef,
} from "./types";

export const MICROSOFT_SCOPES = [
  "offline_access",
  "User.Read",
  "Mail.Read",
  "Mail.Send",
  "Calendars.ReadWrite",
];
const DEFAULT_TZ = "Europe/Madrid";

export type MicrosoftApp = {
  clientId: string;
  clientSecret: string;
  tenant: string;
  /** Overridable for tests. */
  loginBase?: string;
  graphBase?: string;
};

export type MicrosoftSecret = {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  codeVerifier?: string;
  oauthState?: string;
};

const loginBase = (app: MicrosoftApp) =>
  (app.loginBase ?? "https://login.microsoftonline.com").replace(/\/$/, "");
const graphBase = (app: MicrosoftApp) =>
  (app.graphBase ?? "https://graph.microsoft.com/v1.0").replace(/\/$/, "");

export function beginMicrosoftAuth(app: MicrosoftApp, connectionId: string, redirectUri: string) {
  const codeVerifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(codeVerifier).digest("base64url");
  const state = `${connectionId}.${randomBytes(16).toString("hex")}`;
  const url = new URL(`${loginBase(app)}/${encodeURIComponent(app.tenant)}/oauth2/v2.0/authorize`);
  url.search = new URLSearchParams({
    client_id: app.clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: MICROSOFT_SCOPES.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return {
    authorizationUrl: url.toString(),
    secret: { codeVerifier, oauthState: state } satisfies MicrosoftSecret,
  };
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

async function tokenRequest(
  app: MicrosoftApp,
  ctx: Pick<NativeCallContext, "fetcher">,
  form: Record<string, string>,
): Promise<MicrosoftSecret> {
  const res = await executeHttp(
    {
      baseUrl: `${loginBase(app)}/${encodeURIComponent(app.tenant)}/oauth2/v2.0/`,
      method: "POST",
      path: "token",
      form: {
        client_id: app.clientId,
        client_secret: app.clientSecret,
        scope: MICROSOFT_SCOPES.join(" "),
        ...form,
      },
      auth: { type: "none" },
      secret: {},
      timeoutMs: 15_000,
      maxBytes: 100_000,
    },
    ctx.fetcher,
  );
  const data = res.data as TokenResponse;
  if (!res.ok || !data.access_token) {
    throw new NativeToolError(
      `Microsoft rechazó la autorización: ${data.error_description?.split("\r\n")[0] ?? data.error ?? res.status}`,
    );
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
}

export async function completeMicrosoftAuth(
  app: MicrosoftApp,
  ctx: Pick<NativeCallContext, "fetcher">,
  secret: MicrosoftSecret,
  code: string,
  redirectUri: string,
): Promise<MicrosoftSecret> {
  if (!secret.codeVerifier) throw new NativeToolError("no hay una autorización en curso");
  return tokenRequest(app, ctx, {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: secret.codeVerifier,
  });
}

/** Valid access token, refreshing (and persisting) it when it is about to expire. */
async function accessToken(app: MicrosoftApp, ctx: NativeCallContext): Promise<string> {
  const secret = ctx.secret as MicrosoftSecret;
  if (secret.accessToken && (secret.expiresAt ?? 0) > Date.now() + 60_000)
    return secret.accessToken;
  if (!secret.refreshToken)
    throw new NativeToolError("la conexión con Microsoft ha caducado: vuelve a autorizarla");
  const refreshed = await tokenRequest(app, ctx, {
    grant_type: "refresh_token",
    refresh_token: secret.refreshToken,
  });
  const next = { ...refreshed, refreshToken: refreshed.refreshToken ?? secret.refreshToken };
  await ctx.saveSecret(next);
  ctx.secret = next;
  return next.accessToken!;
}

async function graph(
  app: MicrosoftApp,
  ctx: NativeCallContext,
  method: string,
  path: string,
  opts: { query?: Record<string, unknown>; body?: unknown; headers?: Record<string, string> } = {},
): Promise<NativeResult> {
  const token = await accessToken(app, ctx);
  const res = await executeHttp(
    {
      baseUrl: graphBase(app),
      method,
      path,
      query: opts.query,
      body: opts.body,
      headers: opts.headers,
      auth: { type: "bearer" },
      secret: { token },
      timeoutMs: ctx.timeoutMs,
      maxBytes: ctx.maxBytes,
    },
    ctx.fetcher,
  );
  if (!res.ok) {
    const err =
      (res.data as { error?: { message?: string } })?.error?.message ?? `HTTP ${res.status}`;
    return { ok: false, data: { error: err }, truncated: res.truncated };
  }
  return { ok: true, data: res.data === "" ? { ok: true } : res.data, truncated: res.truncated };
}

/** "2026-10-20" → start/end of that day with the Madrid UTC offset (DST-aware). */
export function dayBounds(date: string, tz = DEFAULT_TZ): { start: string; end: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new NativeToolError("la fecha debe ser AAAA-MM-DD");
  const offset = (iso: string) => {
    const probe = new Date(`${iso}Z`);
    const local = new Date(probe.toLocaleString("en-US", { timeZone: tz }));
    const utc = new Date(probe.toLocaleString("en-US", { timeZone: "UTC" }));
    const minutes = Math.round((local.getTime() - utc.getTime()) / 60_000);
    const sign = minutes >= 0 ? "+" : "-";
    const abs = Math.abs(minutes);
    return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
  };
  return {
    start: `${date}T00:00:00${offset(`${date}T00:00:00`)}`,
    end: `${date}T23:59:59${offset(`${date}T23:59:59`)}`,
  };
}

const emails = {
  type: "array",
  items: { type: "string", format: "email" },
  minItems: 1,
  maxItems: 20,
};

export const MICROSOFT365_TOOLS: NativeToolDef[] = [
  {
    name: "outlook_buscar_correos",
    description:
      "Busca correos en el buzón de Outlook del usuario conectado (por texto, remitente o asunto). Sin texto, devuelve los más recientes.",
    inputSchema: schema({
      buscar: str("Texto a buscar"),
      limite: int("Máximo de correos (por defecto 10)", { minimum: 1, maximum: 25 }),
    }),
    mode: "read",
  },
  {
    name: "outlook_leer_correo",
    description:
      "Lee el contenido completo de un correo de Outlook por su id (obtenido con outlook_buscar_correos).",
    inputSchema: schema({ id: str("ID del correo") }, ["id"]),
    mode: "read",
  },
  {
    name: "outlook_enviar_correo",
    description: "Envía un correo desde la cuenta de Outlook conectada.",
    inputSchema: schema(
      {
        para: { ...emails, description: "Destinatarios" },
        asunto: str("Asunto"),
        cuerpo: str("Texto del correo"),
        cc: { ...emails, minItems: 0, description: "Copia" },
      },
      ["para", "asunto", "cuerpo"],
    ),
    mode: "write",
  },
  {
    name: "outlook_agenda",
    description:
      "Citas y reuniones del calendario de Outlook entre dos fechas (AAAA-MM-DD, ambas incluidas).",
    inputSchema: schema(
      {
        desde: str("Fecha inicial (AAAA-MM-DD)", { format: "date" }),
        hasta: str("Fecha final (AAAA-MM-DD)", { format: "date" }),
      },
      ["desde", "hasta"],
    ),
    mode: "read",
  },
  {
    name: "outlook_crear_evento",
    description:
      "Crea una cita en el calendario de Outlook (hora de Madrid) e invita a los asistentes indicados.",
    inputSchema: schema(
      {
        asunto: str("Título de la cita"),
        inicio: str("Inicio, AAAA-MM-DDTHH:MM (hora de Madrid)"),
        fin: str("Fin, AAAA-MM-DDTHH:MM (hora de Madrid)"),
        asistentes: { ...emails, minItems: 0, description: "Emails de los asistentes" },
        ubicacion: str("Lugar"),
        descripcion: str("Notas"),
      },
      ["asunto", "inicio", "fin"],
    ),
    mode: "write",
  },
];

const recipients = (list: unknown) =>
  ((list as string[] | undefined) ?? []).map((address) => ({ emailAddress: { address } }));
const textPrefer = { prefer: `outlook.body-content-type="text"` };

export async function executeMicrosoft365Tool(
  app: MicrosoftApp,
  ctx: NativeCallContext,
  toolName: string,
  args: Record<string, unknown>,
): Promise<NativeResult> {
  switch (toolName) {
    case "outlook_buscar_correos": {
      const query: Record<string, unknown> = {
        $top: Number(args.limite ?? 10),
        $select: "id,subject,from,receivedDateTime,bodyPreview,isRead",
      };
      // $search can't be combined with $orderby.
      if (args.buscar) query.$search = `"${String(args.buscar).replace(/"/g, "")}"`;
      else query.$orderby = "receivedDateTime desc";
      return graph(app, ctx, "GET", "me/messages", { query });
    }
    case "outlook_leer_correo":
      return graph(app, ctx, "GET", `me/messages/${encodeURIComponent(String(args.id))}`, {
        query: { $select: "id,subject,from,toRecipients,ccRecipients,receivedDateTime,body" },
        headers: textPrefer,
      });
    case "outlook_enviar_correo":
      return graph(app, ctx, "POST", "me/sendMail", {
        body: {
          message: {
            subject: args.asunto,
            body: { contentType: "Text", content: args.cuerpo },
            toRecipients: recipients(args.para),
            ccRecipients: recipients(args.cc),
          },
        },
      });
    case "outlook_agenda": {
      const from = dayBounds(String(args.desde)).start;
      const to = dayBounds(String(args.hasta)).end;
      return graph(app, ctx, "GET", "me/calendarView", {
        query: {
          startDateTime: from,
          endDateTime: to,
          $select: "subject,start,end,location,organizer,attendees",
          $orderby: "start/dateTime",
          $top: 50,
        },
        headers: { prefer: `outlook.timezone="${DEFAULT_TZ}"` },
      });
    }
    case "outlook_crear_evento":
      return graph(app, ctx, "POST", "me/events", {
        body: {
          subject: args.asunto,
          body: { contentType: "Text", content: args.descripcion ?? "" },
          start: { dateTime: args.inicio, timeZone: DEFAULT_TZ },
          end: { dateTime: args.fin, timeZone: DEFAULT_TZ },
          location: args.ubicacion ? { displayName: args.ubicacion } : undefined,
          attendees: ((args.asistentes as string[] | undefined) ?? []).map((address) => ({
            emailAddress: { address },
            type: "required",
          })),
        },
      });
    default:
      throw new NativeToolError(`herramienta de Outlook desconocida: ${toolName}`);
  }
}

/** Account the connection belongs to (shown in the UI). */
export async function microsoftAccount(
  app: MicrosoftApp,
  ctx: NativeCallContext,
): Promise<string | null> {
  const res = await graph(app, ctx, "GET", "me", { query: { $select: "mail,userPrincipalName" } });
  const me = res.data as { mail?: string; userPrincipalName?: string };
  return res.ok ? (me.mail ?? me.userPrincipalName ?? null) : null;
}
