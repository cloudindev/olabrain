/**
 * MyTutor API client (undocumented API behind my-tutor.es; flow observed in
 * docs/connectors/mytutor-schema.md). Read-only by construction: the only non-GET
 * requests are the login and the token refresh.
 *
 * - The session is the `cookie_profieco` cookie (10-minute JWT); `cookie_refresh_profieco`
 *   (7 days) renews it at /auth/refresh. A Bearer header is rejected (403).
 * - At most 2 requests per second per client, identifiable User-Agent, exponential backoff
 *   on 429/5xx (their tachograph sync already fights provider rate limits).
 * - Every request goes through the egress guard.
 */
import type { SafeFetcher } from "../../../egress";
import { NativeToolError } from "../types";

export const MYTUTOR_USER_AGENT = "OlaBrain-Connector/0.1";

export type MytutorCredentials = { email: string; password: string };

/** One condition of MyTutor's table filter (`filter=[{p,v,r,t?,m?}]`). */
export type MytutorFilter = {
  p: string;
  v: string;
  r: "eq" | "like" | "gte" | "lte";
  t?: "boolean" | "date" | "dateRange";
  m?: string;
};
export type MytutorSort = { p: string; o: "asc" | "desc" };

export const filters = {
  eq: (p: string, v: string | boolean, t?: MytutorFilter["t"]): MytutorFilter => ({
    p,
    v: String(v),
    r: "eq",
    ...(t ? { t } : {}),
  }),
  like: (p: string, v: string, m?: string): MytutorFilter => ({
    p,
    v,
    r: "like",
    ...(m ? { m } : {}),
  }),
  /** Date range [from, to) as MyTutor's UI sends it. */
  dateRange: (p: string, from: Date, to: Date): MytutorFilter => ({
    p,
    v: JSON.stringify({ from: from.toISOString(), to: to.toISOString() }),
    r: "like",
    t: "dateRange",
  }),
};

/** Query string of a table endpoint (companies, page, size, filter, sorting, extras). */
export function listQuery(opts: {
  companyId: number;
  page: number;
  size: number;
  filter?: MytutorFilter[];
  sorting?: MytutorSort[];
  extra?: Record<string, string>;
}): string {
  const q = new URLSearchParams({
    companies: String(opts.companyId),
    page: String(opts.page),
    size: String(opts.size),
    filter: JSON.stringify(opts.filter ?? []),
    sorting: JSON.stringify(opts.sorting ?? []),
    ...opts.extra,
  });
  return q.toString();
}

/** Rows and total of a table response: `{rows, count}` (or a plain array). */
export function unpackList(data: unknown): {
  rows: Record<string, unknown>[];
  total: number | null;
} {
  if (Array.isArray(data)) return { rows: data as Record<string, unknown>[], total: null };
  const d = (data ?? {}) as Record<string, unknown>;
  if (Array.isArray(d.rows)) {
    return {
      rows: d.rows as Record<string, unknown>[],
      total: typeof d.count === "number" ? d.count : null,
    };
  }
  throw new MytutorError("respuesta inesperada de ProfiECO (no es una lista)", 0);
}

export class MytutorError extends NativeToolError {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "MytutorError";
  }
}

/** Claims we read from the access JWT (no signature check: it is MyTutor's own token). */
function jwtClaims(token: string): Record<string, unknown> {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

export type MytutorClientOptions = {
  baseUrl: string;
  credentials: MytutorCredentials;
  fetcher: SafeFetcher;
  /** Minimum time between requests (default 500 ms = 2 req/s). */
  minIntervalMs?: number;
  timeoutMs?: number;
  /** Size cap of one JSON response (a page of waste orders is ~1 MB). */
  maxBytes?: number;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
};

export class MytutorClient {
  private cookies = new Map<string, string>();
  private lastRequest = 0;
  private accessAt = 0;
  private readonly base: string;
  private readonly minInterval: number;
  private readonly sleep: (ms: number) => Promise<void>;
  requests = 0;

  constructor(private readonly opts: MytutorClientOptions) {
    this.base = opts.baseUrl.replace(/\/$/, "");
    this.minInterval = opts.minIntervalMs ?? 500;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private keepCookies(headers: Headers) {
    for (const c of headers.getSetCookie()) {
      const [pair] = c.split(";");
      const i = pair!.indexOf("=");
      if (i > 0) this.cookies.set(pair!.slice(0, i).trim(), pair!.slice(i + 1).trim());
    }
  }

  private cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  private async throttle() {
    const wait = this.lastRequest + this.minInterval - Date.now();
    if (wait > 0) await this.sleep(wait);
    this.lastRequest = Date.now();
  }

  /** One request with throttle and retries on 429/5xx. */
  private async send(method: "GET" | "POST", path: string, body?: unknown) {
    const maxRetries = this.opts.maxRetries ?? 5;
    for (let attempt = 0; ; attempt++) {
      await this.throttle();
      this.requests++;
      const headers: Record<string, string> = {
        "user-agent": MYTUTOR_USER_AGENT,
        accept: "application/json",
      };
      if (body !== undefined) headers["content-type"] = "application/json";
      if (this.cookies.size) headers.cookie = this.cookieHeader();
      const res = await this.opts.fetcher.safeFetch(
        `${this.base}/${path.replace(/^\//, "")}`,
        { method, headers, body: body === undefined ? undefined : JSON.stringify(body) },
        { timeoutMs: this.opts.timeoutMs ?? 30_000, maxBytes: this.opts.maxBytes ?? 20_000_000 },
      );
      this.keepCookies(res.headers);
      if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
        const retryAfter = Number(res.headers.get("retry-after"));
        await this.sleep(retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt);
        continue;
      }
      if (res.truncated)
        throw new MytutorError("respuesta de ProfiECO demasiado grande", res.status);
      return res;
    }
  }

  /** Signs in. Returns the companies the user can see (from the access token). */
  async login(): Promise<{ companies: { id: number; name: string }[] }> {
    this.cookies.clear();
    const res = await this.send("POST", "auth/login", {
      email: this.opts.credentials.email,
      password: this.opts.credentials.password,
      rememberMe: false,
    });
    if (res.status === 401) throw new MytutorError("ProfiECO: email o contraseña incorrectos", 401);
    if (res.status === 403)
      throw new MytutorError(
        "ProfiECO: esta cuenta inicia sesión con SSO; usa un usuario con contraseña",
        403,
      );
    if (res.status !== 200 && res.status !== 201)
      throw new MytutorError(
        `ProfiECO no permitió iniciar sesión (HTTP ${res.status})`,
        res.status,
      );
    this.accessAt = Date.now();
    let token = "";
    try {
      token = String((JSON.parse(res.body) as { access_token?: string }).access_token ?? "");
    } catch {
      // the cookie is what matters
    }
    const companies =
      (jwtClaims(token).companies as { company_id: number; company_name: string }[]) ?? [];
    return { companies: companies.map((c) => ({ id: c.company_id, name: c.company_name })) };
  }

  private async refresh() {
    const res = await this.send("POST", "auth/refresh");
    if (res.status === 200 || res.status === 201) this.accessAt = Date.now();
    else await this.login();
  }

  /** GET a JSON resource; renews the 10-minute access cookie before it expires. */
  async get(path: string): Promise<unknown> {
    if (!this.accessAt) await this.login();
    else if (Date.now() - this.accessAt > 8 * 60_000) await this.refresh();
    let res = await this.send("GET", path);
    if (res.status === 401) {
      await this.refresh();
      res = await this.send("GET", path);
    }
    if (res.status !== 200) {
      throw new MytutorError(
        `ProfiECO respondió HTTP ${res.status} en ${path.split("?")[0]}`,
        res.status,
      );
    }
    try {
      return JSON.parse(res.body);
    } catch {
      throw new MytutorError(`ProfiECO devolvió algo que no es JSON en ${path.split("?")[0]}`, 200);
    }
  }

  /** A file (PDF…) streamed through the egress guard, never stored. */
  async file(
    path: string,
  ): Promise<{ bytes: Uint8Array<ArrayBuffer>; contentType: string; filename: string }> {
    if (!this.accessAt) await this.login();
    else if (Date.now() - this.accessAt > 8 * 60_000) await this.refresh();
    await this.throttle();
    this.requests++;
    const res = await this.opts.fetcher.guardedFetch(`${this.base}/${path.replace(/^\//, "")}`, {
      headers: { "user-agent": MYTUTOR_USER_AGENT, cookie: this.cookieHeader() },
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 30_000),
    });
    if (res.status !== 200) {
      await res.body?.cancel();
      throw new MytutorError(`ProfiECO no devolvió el archivo (HTTP ${res.status})`, res.status);
    }
    const type = res.headers.get("content-type") ?? "application/octet-stream";
    // Some endpoints answer with a link to the file (plain text or {url}), not the file.
    if (type.includes("application/json") || type.includes("text/plain")) {
      const text = (await res.text()).trim();
      let link = text;
      if (type.includes("application/json")) {
        try {
          link = String((JSON.parse(text) as { url?: string }).url ?? "");
        } catch {
          link = "";
        }
      }
      const url = /^https:\/\//.test(link) ? new URL(link) : null;
      // Only MyTutor's own document hosts (e.g. edocumentos.my-tutor.es).
      if (!url || !/(^|\.)my-tutor\.es$/.test(url.hostname)) {
        throw new MytutorError("ProfiECO no devolvió el archivo", 200);
      }
      await this.throttle();
      this.requests++;
      const file = await this.opts.fetcher.guardedFetch(url, {
        headers: { "user-agent": MYTUTOR_USER_AGENT },
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 30_000),
      });
      if (file.status !== 200)
        throw new MytutorError(`descarga fallida (HTTP ${file.status})`, file.status);
      const name = decodeURIComponent(url.pathname.split("/").pop() ?? "") || "documento.pdf";
      return {
        bytes: new Uint8Array(await file.arrayBuffer()),
        contentType: name.endsWith(".pdf")
          ? "application/pdf"
          : (file.headers.get("content-type") ?? "application/octet-stream"),
        filename: filenameOf(file.headers) ?? name,
      };
    }
    return {
      bytes: new Uint8Array(await res.arrayBuffer()),
      contentType: type,
      filename: filenameOf(res.headers) ?? "documento.pdf",
    };
  }

  /** Every page of a table endpoint, `size` rows at a time, from `startPage`. */
  async *pages(
    path: string,
    q: Omit<Parameters<typeof listQuery>[0], "page">,
    startPage = 1,
  ): AsyncGenerator<{ page: number; rows: Record<string, unknown>[]; total: number | null }> {
    let previousFirst: unknown = undefined;
    for (let page = startPage; page < startPage + 1000; page++) {
      const { rows, total } = unpackList(await this.get(`${path}?${listQuery({ ...q, page })}`));
      // An endpoint that ignores `page` returns the same rows again: stop.
      if (page > startPage && rows[0] && rows[0].id === previousFirst) return;
      previousFirst = rows[0]?.id;
      yield { page, rows, total };
      if (rows.length < q.size) return;
      if (total !== null && page * q.size >= total) return;
    }
  }
}

function filenameOf(headers: Headers): string | null {
  const cd = headers.get("content-disposition") ?? "";
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
  return m ? decodeURIComponent(m[1]!) : null;
}
