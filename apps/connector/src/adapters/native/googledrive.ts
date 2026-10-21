/**
 * Google Drive (https://developers.google.com/workspace/drive/api): OAuth 2.0 with PKCE
 * and the non-sensitive `drive.file` scope (only files and folders the app creates or the
 * user opens with it), so no Google security assessment is needed (ADR-015).
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

export const GOOGLE_DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  // The connected account's email, to show it on the connection.
  "openid",
  "email",
];

export type GoogleApp = {
  clientId: string;
  clientSecret: string;
  /** Overridable for tests. */
  authBase?: string;
  tokenUrl?: string;
  apiBase?: string;
  uploadBase?: string;
};

export type GoogleSecret = {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  codeVerifier?: string;
  oauthState?: string;
};

const FOLDER = "application/vnd.google-apps.folder";
const GOOGLE_DOC = "application/vnd.google-apps.document";
/** Multipart uploads are for files up to 5 MB (Drive docs). */
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const api = (app: GoogleApp) =>
  (app.apiBase ?? "https://www.googleapis.com/drive/v3").replace(/\/$/, "");
const uploadUrl = (app: GoogleApp) =>
  `${(app.uploadBase ?? "https://www.googleapis.com/upload/drive/v3").replace(/\/$/, "")}/files?uploadType=multipart&fields=id,name,mimeType,webViewLink`;

export function beginGoogleAuth(app: GoogleApp, connectionId: string, redirectUri: string) {
  const codeVerifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(codeVerifier).digest("base64url");
  const state = `${connectionId}.${randomBytes(16).toString("hex")}`;
  const url = new URL(app.authBase ?? "https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: app.clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: GOOGLE_DRIVE_SCOPES.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    // A refresh token on every consent (Google only sends it with offline + consent).
    access_type: "offline",
    prompt: "consent",
  }).toString();
  return {
    authorizationUrl: url.toString(),
    secret: { codeVerifier, oauthState: state } satisfies GoogleSecret,
  };
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  id_token?: string;
  error?: string;
  error_description?: string;
};

async function tokenRequest(
  app: GoogleApp,
  ctx: Pick<NativeCallContext, "fetcher">,
  form: Record<string, string>,
): Promise<GoogleSecret & { email?: string }> {
  const target = new URL(app.tokenUrl ?? "https://oauth2.googleapis.com/token");
  const res = await executeHttp(
    {
      baseUrl: target.origin,
      method: "POST",
      path: target.pathname.replace(/^\//, ""),
      form: { client_id: app.clientId, client_secret: app.clientSecret, ...form },
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
      `Google rechazó la autorización: ${data.error_description ?? data.error ?? res.status}`,
    );
  }
  // The id_token is a JWT from Google's token endpoint over TLS: its payload is trusted here.
  let email: string | undefined;
  if (data.id_token) {
    try {
      email = JSON.parse(Buffer.from(data.id_token.split(".")[1]!, "base64url").toString()).email;
    } catch {
      email = undefined;
    }
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    email,
  };
}

export async function completeGoogleAuth(
  app: GoogleApp,
  ctx: Pick<NativeCallContext, "fetcher">,
  secret: GoogleSecret,
  code: string,
  redirectUri: string,
) {
  if (!secret.codeVerifier) throw new NativeToolError("no hay una autorización en curso");
  return tokenRequest(app, ctx, {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: secret.codeVerifier,
  });
}

/** Valid access token, refreshing (and persisting) it when it is about to expire. */
async function accessToken(app: GoogleApp, ctx: NativeCallContext): Promise<string> {
  const secret = ctx.secret as GoogleSecret;
  if (secret.accessToken && (secret.expiresAt ?? 0) > Date.now() + 60_000)
    return secret.accessToken;
  if (!secret.refreshToken)
    throw new NativeToolError("la conexión con Google ha caducado: vuelve a autorizarla");
  const { email: _email, ...refreshed } = await tokenRequest(app, ctx, {
    grant_type: "refresh_token",
    refresh_token: secret.refreshToken,
  });
  const next = { ...refreshed, refreshToken: refreshed.refreshToken ?? secret.refreshToken };
  await ctx.saveSecret(next);
  ctx.secret = next;
  return next.accessToken!;
}

async function drive(
  app: GoogleApp,
  ctx: NativeCallContext,
  method: string,
  path: string,
  opts: { query?: Record<string, unknown>; body?: unknown } = {},
): Promise<NativeResult> {
  const token = await accessToken(app, ctx);
  const res = await executeHttp(
    {
      baseUrl: api(app),
      method,
      path,
      query: opts.query,
      body: opts.body,
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
  return { ok: true, data: res.data, truncated: res.truncated };
}

/** multipart/related upload: JSON metadata first, then the bytes (Drive docs). */
async function upload(
  app: GoogleApp,
  ctx: NativeCallContext,
  metadata: Record<string, unknown>,
  file: { mediaType: string; bytes: Uint8Array },
): Promise<NativeResult> {
  if (file.bytes.byteLength > MAX_UPLOAD_BYTES)
    throw new NativeToolError("el archivo supera los 5 MB que admite esta subida");
  const token = await accessToken(app, ctx);
  const boundary = `olabrain-${randomBytes(12).toString("hex")}`;
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
        `--${boundary}\r\nContent-Type: ${file.mediaType}\r\n\r\n`,
    ),
    Buffer.from(file.bytes),
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const res = await ctx.fetcher.safeFetch(
    uploadUrl(app),
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": `multipart/related; boundary=${boundary}`,
        "content-length": String(body.byteLength),
      },
      body,
    },
    { timeoutMs: 30_000, maxBytes: 100_000 },
  );
  let data: unknown = res.body;
  try {
    data = JSON.parse(res.body);
  } catch {
    // keep text
  }
  if (res.status >= 400) {
    const err = (data as { error?: { message?: string } })?.error?.message ?? `HTTP ${res.status}`;
    return { ok: false, data: { error: err }, truncated: false };
  }
  return { ok: true, data, truncated: false };
}

const parent = str(
  "ID de la carpeta de Drive (de drive_crear_carpeta o drive_listar); vacío = raíz",
);

export const GOOGLE_DRIVE_TOOLS: NativeToolDef[] = [
  {
    name: "drive_crear_carpeta",
    description:
      "Crea una carpeta en Google Drive (opcionalmente dentro de otra) y devuelve su id y enlace.",
    inputSchema: schema({ nombre: str("Nombre de la carpeta"), carpeta: parent }, ["nombre"]),
    mode: "write",
  },
  {
    name: "drive_listar",
    description:
      "Lista las carpetas y archivos de Google Drive creados desde OlaBrain (de una carpeta o todos), con su enlace. No ve el resto del Drive.",
    inputSchema: schema({
      carpeta: parent,
      buscar: str("Texto a buscar en el nombre"),
      limite: int("Máximo de resultados (por defecto 25)", { minimum: 1, maximum: 100 }),
    }),
    mode: "read",
  },
  {
    name: "drive_crear_documento",
    description:
      "Crea en Google Drive un documento con el texto que redactes (un acta, un resumen, una nota). Por defecto, Google Doc; o archivo de texto.",
    inputSchema: schema(
      {
        nombre: str("Nombre del documento"),
        contenido: str("Texto del documento"),
        formato: str("Formato", { enum: ["google_doc", "texto"] }),
        carpeta: parent,
      },
      ["nombre", "contenido"],
    ),
    mode: "write",
  },
  {
    name: "drive_subir_archivo",
    description:
      "Sube a Google Drive un archivo: un adjunto del chat (su adjunto_id) o un archivo generado por otra herramienta (su enlace de descarga, p. ej. el PDF de una factura). Máximo 5 MB.",
    inputSchema: schema({
      adjunto_id: str("ID del adjunto del chat"),
      enlace: str("Enlace de descarga generado por otra herramienta (pdf_url)"),
      nombre: str("Nombre con el que guardarlo (por defecto, el original)"),
      carpeta: parent,
    }),
    mode: "write",
  },
];

const FILE_FIELDS = "id,name,mimeType,webViewLink,modifiedTime,size";

const clean = (f: Record<string, unknown>) => ({
  id: f.id,
  nombre: f.name,
  tipo: f.mimeType === FOLDER ? "carpeta" : f.mimeType,
  enlace: f.webViewLink,
  modificado: f.modifiedTime,
});

export async function executeGoogleDriveTool(
  app: GoogleApp,
  ctx: NativeCallContext,
  toolName: string,
  args: Record<string, unknown>,
): Promise<NativeResult> {
  const parents = typeof args.carpeta === "string" && args.carpeta ? [args.carpeta] : undefined;
  switch (toolName) {
    case "drive_crear_carpeta": {
      const res = await drive(app, ctx, "POST", "files", {
        query: { fields: FILE_FIELDS },
        body: { name: args.nombre, mimeType: FOLDER, ...(parents ? { parents } : {}) },
      });
      return res.ok ? { ...res, data: clean(res.data as Record<string, unknown>) } : res;
    }
    case "drive_listar": {
      const q = ["trashed = false"];
      if (parents) q.push(`'${String(parents[0]).replace(/'/g, "")}' in parents`);
      if (args.buscar) q.push(`name contains '${String(args.buscar).replace(/['\\]/g, "")}'`);
      const res = await drive(app, ctx, "GET", "files", {
        query: {
          q: q.join(" and "),
          fields: `files(${FILE_FIELDS})`,
          orderBy: "modifiedTime desc",
          pageSize: Number(args.limite ?? 25),
        },
      });
      if (!res.ok) return res;
      const files = ((res.data as { files?: Record<string, unknown>[] }).files ?? []).map(clean);
      return { ...res, data: files };
    }
    case "drive_crear_documento": {
      const asDoc = args.formato !== "texto";
      const name = String(args.nombre);
      const res = await upload(
        app,
        ctx,
        {
          name: asDoc ? name : name.endsWith(".txt") ? name : `${name}.txt`,
          ...(asDoc ? { mimeType: GOOGLE_DOC } : {}),
          ...(parents ? { parents } : {}),
        },
        { mediaType: "text/plain; charset=UTF-8", bytes: Buffer.from(String(args.contenido)) },
      );
      return res.ok ? { ...res, data: clean(res.data as Record<string, unknown>) } : res;
    }
    case "drive_subir_archivo": {
      if (!ctx.loadFile)
        throw new NativeToolError("no hay archivos disponibles en esta conversación");
      const file = await ctx.loadFile({
        attachmentId: typeof args.adjunto_id === "string" ? args.adjunto_id : undefined,
        link: typeof args.enlace === "string" ? args.enlace : undefined,
      });
      const res = await upload(
        app,
        ctx,
        { name: (args.nombre as string) || file.name, ...(parents ? { parents } : {}) },
        { mediaType: file.mediaType, bytes: file.bytes },
      );
      return res.ok ? { ...res, data: clean(res.data as Record<string, unknown>) } : res;
    }
    default:
      throw new NativeToolError(`herramienta de Google Drive desconocida: ${toolName}`);
  }
}
