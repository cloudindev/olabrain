/**
 * Throwaway MyTutor dump (connector task, phase A). Read-only: only GET requests, plus the
 * login/refresh POSTs. Credentials come from the root .env (MYTUTOR_EMAIL,
 * MYTUTOR_PASSWORD, MYTUTOR_COMPANY_ID) and are never printed.
 *
 *   pnpm --filter @brainagent/connector exec tsx scripts/mytutor-dump.ts
 *
 * Writes tmp/mytutor-dump/<entity>.json and summary.json (git-ignored: personal data) and
 * docs/connectors/mytutor-schema.md.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
config({ path: resolve(ROOT, ".env"), quiet: true });

const BASE = process.env.MYTUTOR_API_URL ?? "https://api.my-tutor.es/v1";
const EMAIL = process.env.MYTUTOR_EMAIL;
const PASSWORD = process.env.MYTUTOR_PASSWORD;
const COMPANY = process.env.MYTUTOR_COMPANY_ID;
const OUT = resolve(ROOT, "tmp/mytutor-dump");
const SCHEMA_DOC = resolve(ROOT, "docs/connectors/mytutor-schema.md");
const UA = "OlaBrain-Connector/0.1";
const MIN_INTERVAL_MS = 500; // at most 2 requests per second
const PAGE_SIZE = 100;
const MAX_PAGES = 200;
const SAMPLE = 5;

if (!EMAIL || !PASSWORD || !COMPANY) {
  console.error("Set MYTUTOR_EMAIL, MYTUTOR_PASSWORD and MYTUTOR_COMPANY_ID in .env");
  process.exit(1);
}

// --- HTTP: cookie session, throttle, retries -------------------------------------------

const cookies: Record<string, string> = {};
let lastRequest = 0;
let accessAt = 0;
let requests = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function keepCookies(res: Response) {
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(";");
    const i = pair!.indexOf("=");
    cookies[pair!.slice(0, i).trim()] = pair!.slice(i + 1).trim();
  }
}

const cookieHeader = () =>
  Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");

async function send(method: "GET" | "POST", path: string, body?: unknown): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const wait = lastRequest + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequest = Date.now();
    requests++;
    const res = await fetch(`${BASE}/${path}`, {
      method,
      headers: {
        "User-Agent": UA,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(Object.keys(cookies).length ? { Cookie: cookieHeader() } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    keepCookies(res);
    if ((res.status === 429 || res.status >= 500) && attempt < 5) {
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt);
      continue;
    }
    return res;
  }
}

async function login() {
  const res = await send("POST", "auth/login", {
    email: EMAIL,
    password: PASSWORD,
    rememberMe: false,
  });
  if (res.status === 401) throw new Error("login: invalid credentials (401)");
  if (res.status === 403) throw new Error("login: the account requires SSO (403)");
  if (!res.ok) throw new Error(`login: HTTP ${res.status}`);
  await res.body?.cancel();
  accessAt = Date.now();
}

async function refresh() {
  const res = await send("POST", "auth/refresh");
  await res.body?.cancel();
  if (!res.ok) return login();
  accessAt = Date.now();
}

/** GET with the session; refreshes the 10-minute access cookie before it expires. */
async function get(path: string): Promise<{ status: number; data: unknown }> {
  if (Date.now() - accessAt > 8 * 60_000) await refresh();
  let res = await send("GET", path);
  if (res.status === 401) {
    await res.body?.cancel();
    await refresh();
    res = await send("GET", path);
  }
  const text = await res.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    // not JSON: keep the text
  }
  return { status: res.status, data };
}

// --- Endpoints -----------------------------------------------------------------------

type Filter = { p: string; v: string; r: string; t?: string; m?: string };
type ListSpec = { entity: string; path: string; filter?: Filter[]; extra?: string };

const active: Filter[] = [{ p: "is_active", v: "true", r: "eq", t: "boolean" }];
const year = (field: string): Filter[] => [
  {
    p: field,
    v: JSON.stringify({ from: "2026-01-01T00:00:00.000Z", to: "2027-01-01T00:00:00.000Z" }),
    r: "like",
    t: "dateRange",
  },
];

const LISTS: ListSpec[] = [
  { entity: "clients_all", path: "clients/tableCompany/Client" },
  { entity: "clients_active", path: "clients/tableCompany/Client", filter: active },
  { entity: "suppliers_all", path: "clients/tableCompany/Supplier" },
  { entity: "suppliers_active", path: "clients/tableCompany/Supplier", filter: active },
  { entity: "vehicles_all", path: "vehicles/table" },
  {
    // vehicles/table has no is_active: a vehicle in service is not deregistered.
    entity: "vehicles_active",
    path: "vehicles/table",
    filter: [{ p: "isDeregistered", v: "false", r: "eq", t: "boolean" }],
  },
  { entity: "workers_all", path: "workers/table-workers" },
  {
    entity: "workers_active",
    path: "workers/table-workers",
    filter: [{ p: "worker_status", v: "active", r: "like", m: "workerCompanies" }],
  },
  { entity: "tach_vehicles", path: "profitach/vehicles" },
  { entity: "tach_driver_cards", path: "profitach/driver-cards" },
  { entity: "tach_files", path: "profitach/files" },
  { entity: "tach_synchronizations", path: "profitach/synchronizations" },
  { entity: "tach_download_history", path: "profitach/download-history" },
  { entity: "consignment_notes", path: "consignment-notes" },
  { entity: "invoices_all", path: "invoices/table" },
  { entity: "invoices_2026", path: "invoices/table", filter: year("invoice_date") },
  { entity: "waste_work_orders", path: "waste-work-order/table-info" },
];

const SINGLES: { entity: string; path: string }[] = [
  { entity: "company", path: `empresa/${COMPANY}` },
  { entity: "company_services", path: `serviciosEmpresa/${COMPANY}` },
  { entity: "company_profidigital", path: `subservicios/profidigital/empresa/${COMPANY}` },
  { entity: "invoice_config", path: `invoice-config/${COMPANY}` },
  { entity: "waste_management_config", path: `waste-management-config?companies=${COMPANY}` },
  { entity: "waste_delivery_note_ids", path: `waste-delivery-note/get-ids?companies=${COMPANY}` },
  {
    entity: "expiration_notification_count",
    path: `expiration/active-notification-count?companies=${COMPANY}`,
  },
  { entity: "provinces", path: "provinces" },
  { entity: "towns_page1", path: "towns/infinite?page=1" },
];

function listQuery(page: number, filter: Filter[] = [], extra = "") {
  const q = new URLSearchParams({
    companies: String(COMPANY),
    page: String(page),
    size: String(PAGE_SIZE),
    filter: JSON.stringify(filter),
    sorting: "[]",
  });
  return `${q.toString()}${extra ? `&${extra}` : ""}`;
}

/** Rows and total from the shapes seen so far ({rows,count}) or a plain array. */
function unpack(data: unknown): { rows: unknown[]; total: number | null } | null {
  if (Array.isArray(data)) return { rows: data, total: null };
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    const rows = d.rows ?? d.data ?? d.items ?? d.results;
    const total = d.count ?? d.total ?? d.totalItems ?? d.totalCount;
    if (Array.isArray(rows)) return { rows, total: typeof total === "number" ? total : null };
  }
  return null;
}

type EndpointSummary = {
  entity: string;
  endpoint: string;
  status: number;
  records: number;
  reportedTotal: number | null;
  pages: number;
  fields: FieldInfo[];
  error?: string;
};
type FieldInfo = { name: string; types: string[]; nullPct: number };

const summaries: EndpointSummary[] = [];
const errors: { endpoint: string; error: string }[] = [];

async function paginate(spec: ListSpec): Promise<unknown[]> {
  const all: unknown[] = [];
  let total: number | null = null;
  let pages = 0;
  let status = 0;
  let error: string | undefined;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const path = `${spec.path}?${listQuery(page, spec.filter, spec.extra)}`;
    const res = await get(path);
    status = res.status;
    if (res.status !== 200) {
      error = `HTTP ${res.status}: ${JSON.stringify(res.data).slice(0, 200)}`;
      break;
    }
    const got = unpack(res.data);
    if (!got) {
      // Not a list: keep the whole response as one record.
      all.push(res.data);
      pages = 1;
      break;
    }
    pages = page;
    total = got.total;
    all.push(...got.rows);
    // A plain array ignores paging unless it fills the page.
    if (got.total === null && got.rows.length < PAGE_SIZE) break;
    if (got.total !== null && all.length >= got.total) break;
    if (got.rows.length === 0) break;
    if (got.total === null && page > 1 && sameAsPrevious(all, got.rows.length)) {
      all.splice(all.length - got.rows.length);
      break;
    }
  }
  if (error) errors.push({ endpoint: spec.path, error });
  summaries.push({
    entity: spec.entity,
    endpoint: `${spec.path}${spec.filter ? ` filter=${JSON.stringify(spec.filter)}` : ""}`,
    status,
    records: all.length,
    reportedTotal: total,
    pages,
    fields: inferFields(all),
    error,
  });
  await save(spec.entity, all);
  console.log(`${spec.entity}: ${all.length} records${error ? ` (${error.slice(0, 60)})` : ""}`);
  return all;
}

/** Endpoints that ignore `page` repeat the first page: stop instead of looping. */
function sameAsPrevious(all: unknown[], n: number) {
  if (all.length < 2 * n) return false;
  const last = JSON.stringify(all.slice(-n));
  const prev = JSON.stringify(all.slice(-2 * n, -n));
  return last === prev;
}

async function single(entity: string, path: string) {
  const res = await get(path);
  const error = res.status === 200 ? undefined : `HTTP ${res.status}`;
  if (error) errors.push({ endpoint: path, error });
  const records = Array.isArray(res.data) ? res.data : [res.data];
  summaries.push({
    entity,
    endpoint: path,
    status: res.status,
    records: res.status === 200 ? records.length : 0,
    reportedTotal: null,
    pages: 1,
    fields: res.status === 200 ? inferFields(records) : [],
    error,
  });
  if (res.status === 200) await save(entity, res.data);
  console.log(`${entity}: HTTP ${res.status}`);
  return res.status === 200 ? res.data : null;
}

// --- Field inference -----------------------------------------------------------------

function typeOf(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "string") {
    if (/^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(v)) return "date";
    return "string";
  }
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  return typeof v;
}

/** Top-level fields plus one level of nested objects (dotted names). */
function inferFields(rows: unknown[]): FieldInfo[] {
  const stats = new Map<string, { types: Set<string>; nulls: number; seen: number }>();
  const objects = rows.filter((r): r is Record<string, unknown> => !!r && typeof r === "object");
  const visit = (name: string, v: unknown) => {
    const s = stats.get(name) ?? { types: new Set(), nulls: 0, seen: 0 };
    const t = typeOf(v);
    s.seen++;
    if (t === "null") s.nulls++;
    else s.types.add(t);
    stats.set(name, s);
  };
  for (const r of objects) {
    for (const [k, v] of Object.entries(r)) {
      visit(k, v);
      if (v && typeof v === "object" && !Array.isArray(v)) {
        for (const [k2, v2] of Object.entries(v)) visit(`${k}.${k2}`, v2);
      }
    }
  }
  const n = objects.length || 1;
  return [...stats.entries()].map(([name, s]) => ({
    name,
    types: [...s.types].sort(),
    // Missing in a row counts as null.
    nullPct: Math.round(((s.nulls + (n - s.seen)) / n) * 1000) / 10,
  }));
}

async function save(entity: string, data: unknown) {
  await writeFile(resolve(OUT, `${entity}.json`), JSON.stringify(data, null, 2));
}

// --- Run -----------------------------------------------------------------------------

const idOf = (r: unknown) => {
  const o = r as Record<string, unknown>;
  return o?.id ?? o?.client_id ?? o?.worker_id ?? o?.cliente_id;
};

async function main() {
  const started = Date.now();
  await mkdir(OUT, { recursive: true });
  await login();
  await refresh(); // the refresh flow, checked once up front

  const lists: Record<string, unknown[]> = {};
  for (const spec of LISTS) lists[spec.entity] = await paginate(spec);
  for (const s of SINGLES) await single(s.entity, s.path);

  // Samples: 5 client records with their services, items and residues; 5 workers.
  const clientIds = (lists.clients_active ?? []).slice(0, SAMPLE).map(idOf).filter(Boolean);
  const clientCards: unknown[] = [];
  for (const id of clientIds) {
    const card = (await get(`clients/${id}`)).data;
    const extra = `clientId=${id}&showCompany=false`;
    const related: Record<string, unknown> = {};
    for (const [k, path] of [
      ["services", "company-service/paginated"],
      ["items", "items/paginated"],
      ["residues", "residue/paginated"],
    ] as const) {
      const res = await get(`${path}?${listQuery(1, [], extra)}`);
      related[k] = res.status === 200 ? res.data : { status: res.status };
      if (res.status !== 200)
        errors.push({ endpoint: `${path}?clientId=${id}`, error: `HTTP ${res.status}` });
    }
    clientCards.push({ card, ...related });
  }
  await save("clients_sample", clientCards);
  summaries.push({
    entity: "clients_sample",
    endpoint: "clients/{id} + company-service|items|residue/paginated?clientId={id}",
    status: 200,
    records: clientCards.length,
    reportedTotal: null,
    pages: 1,
    fields: inferFields(clientCards.map((c) => (c as { card: unknown }).card)),
  });

  const workerIds = (lists.workers_active ?? []).slice(0, SAMPLE).map(idOf).filter(Boolean);
  const workerCards: unknown[] = [];
  for (const id of workerIds) workerCards.push((await get(`workers/${id}?allDocuments=true`)).data);
  await save("workers_sample", workerCards);
  summaries.push({
    entity: "workers_sample",
    endpoint: "workers/{id}?allDocuments=true",
    status: 200,
    records: workerCards.length,
    reportedTotal: null,
    pages: 1,
    fields: inferFields(workerCards),
  });

  const summary = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE,
    companyId: COMPANY,
    seconds: Math.round((Date.now() - started) / 1000),
    requests,
    endpoints: summaries,
    errors,
  };
  await writeFile(resolve(OUT, "summary.json"), JSON.stringify(summary, null, 2));
  await writeSchemaDoc(summary.generatedAt);
  console.log(`done: ${requests} requests in ${summary.seconds}s, ${errors.length} errors`);
}

/** Field names, types and null rates only: no values (personal data stays in tmp/). */
async function writeSchemaDoc(generatedAt: string) {
  const rel = (name: string) =>
    /(^|_|\.)(id|.*_id|.*Id)$/.test(name) && name !== "id" ? "→ id" : "";
  const lines = [
    "# MyTutor API: esquema observado",
    "",
    `Generado por \`apps/connector/scripts/mytutor-dump.ts\` el ${generatedAt.slice(0, 10)} (empresa ${COMPANY}). API no documentada: puede cambiar sin aviso.`,
    "",
    "## Autenticación (observada)",
    "",
    "- `POST /v1/auth/login` con JSON `{email, password, rememberMe}`. 200 → cuerpo `{access_token, refresh_token, rememberMe, hasMultiCompanies}` y cookies HttpOnly en `.my-tutor.es`: `cookie_profieco` (acceso, JWT, 600 s) y `cookie_refresh_profieco` (renovación, 7 días, solo en las rutas `/v1/auth/refresh`, `/v1/auth/usuario/login-company` y `/v1/auth/impersonate`). 401 = credenciales incorrectas; 403 = la cuenta exige SSO.",
    "- Las peticiones se autentican **solo con la cookie** `cookie_profieco`: con `Authorization: Bearer <access_token>` la API responde 403.",
    "- `POST /v1/auth/refresh` con la cookie de renovación → `{access_token}` y una cookie de acceso nueva. El frontend renueva cuando quedan < 60 s o tras un 401.",
    "- El JWT lleva `usuario_id`, `empresa_id`, `role`, `companies[{company_id, company_name, parentCompanyId}]`, `veosat_token` (SSO de ProfiFLEET) y otros indicadores.",
    "",
    "## Listas",
    "",
    "Parámetros: `companies`, `page`, `size`, `filter` (JSON: `[{p, v, r, t?, m?}]`), `sorting` (JSON). Respuesta `{rows, count}`.",
    "",
  ];
  for (const s of summaries) {
    lines.push(
      `### ${s.entity}`,
      "",
      `\`${s.endpoint}\` · HTTP ${s.status} · ${s.records} registros${s.reportedTotal !== null ? ` (count ${s.reportedTotal})` : ""}`,
      "",
    );
    if (!s.fields.length) {
      lines.push(s.error ? `Error: ${s.error}` : "Sin campos.", "");
      continue;
    }
    lines.push("| Campo | Tipo | % nulos | Relación |", "|---|---|---|---|");
    for (const f of s.fields)
      lines.push(
        `| \`${f.name}\` | ${f.types.join(" / ") || "null"} | ${f.nullPct} | ${rel(f.name)} |`,
      );
    lines.push("");
  }
  await mkdir(dirname(SCHEMA_DOC), { recursive: true });
  await writeFile(SCHEMA_DOC, lines.join("\n"));
}

main().catch((e: Error) => {
  console.error(`mytutor dump failed: ${e.message}`);
  process.exit(1);
});
