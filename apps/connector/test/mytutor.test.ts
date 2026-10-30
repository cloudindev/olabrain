import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { connections, mytutorClients, mytutorSyncRuns, tools, withTenant } from "@brainagent/db";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  MytutorClient,
  filters,
  listQuery,
  unpackList,
} from "../src/adapters/native/mytutor/client";
import { ENTITY_BY_NAME, normalize, trim } from "../src/adapters/native/mytutor/entities";
import { createContext } from "../src/context";
import { executeTool, type ConnectionRow } from "../src/execute";
import {
  createMytutorConnection,
  mytutorFile,
  runMytutorSync,
  testMytutorConnection,
  updateMytutorPassword,
} from "../src/services";
import { createTenant, dropTenant, testDbs } from "./helpers";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
const fixture = (name: string): Json =>
  JSON.parse(readFileSync(join(__dirname, "fixtures/mytutor", `${name}.json`), "utf8"));

const EMAIL = "admin@ejemplo.test";
let password = "secreta-1";
const { admin, app: appDb } = testDbs();

/** Fake MyTutor: cookie session, {rows,count} tables from the anonymized fixtures. */
const requests: { method: string; path: string; query: URLSearchParams }[] = [];
const fake = { dropFirstClient: false, throttleOnce: true };
const TABLES: Record<string, () => Json[]> = {
  "/v1/clients/tableCompany/Client": () =>
    fixture("clients").rows.slice(fake.dropFirstClient ? 1 : 0),
  "/v1/clients/tableCompany/Supplier": () => fixture("suppliers").rows,
  "/v1/company-service/paginated": () => fixture("services").rows,
  "/v1/vehicles/table": () => fixture("vehicles").rows,
  "/v1/workers/table-workers": () => fixture("workers").rows,
  "/v1/expiration/table": () => [
    {
      id: 7,
      type: "vehicleHomologation",
      documentType: "Homologación de vehículo",
      endDate: "2020-03-10T23:00:00.000Z",
      vehicleHomologation: { licensePlate: "1033TST" },
    },
  ],
  "/v1/profitach/vehicles": () => fixture("tach_vehicles").rows,
  "/v1/profitach/driver-cards": () => fixture("tach_driver_cards").rows,
  "/v1/profitach/files": () => fixture("tach_files").rows,
  "/v1/consignment-notes": () => fixture("consignment_notes").rows,
  "/v1/waste-work-order/table-info": () => fixture("waste_work_orders").rows,
};

function cookies(r: IncomingMessage) {
  return Object.fromEntries(
    (r.headers.cookie ?? "").split(";").map((c) => c.trim().split("=") as [string, string]),
  );
}

let server: Server;
let baseUrl = "";

beforeAll(async () => {
  server = createServer((r, res) => {
    const url = new URL(r.url!, "http://x");
    requests.push({ method: r.method!, path: url.pathname, query: url.searchParams });
    let body = "";
    r.on("data", (c) => (body += c));
    r.on("end", () => {
      const json = (
        status: number,
        data: unknown,
        headers: Record<string, string | string[]> = {},
      ) => {
        res.writeHead(status, { "content-type": "application/json", ...headers });
        res.end(JSON.stringify(data));
      };
      const session = [
        "cookie_profieco=acc; Path=/; HttpOnly",
        "cookie_refresh_profieco=ref; Path=/v1/auth/refresh; HttpOnly",
      ];
      if (url.pathname === "/v1/auth/login" && r.method === "POST") {
        const b = JSON.parse(body) as { email: string; password: string };
        if (b.email !== EMAIL || b.password !== password)
          return json(401, { message: "Unauthorized" });
        const claims = Buffer.from(
          JSON.stringify({
            companies: [{ company_id: 25, company_name: "TRANSPORTES DEMO S.L." }],
          }),
        ).toString("base64url");
        return json(201, { access_token: `x.${claims}.y` }, { "set-cookie": session });
      }
      if (url.pathname === "/v1/auth/refresh" && r.method === "POST")
        return json(200, { access_token: "x" }, { "set-cookie": session[0]! });
      if (cookies(r).cookie_profieco !== "acc") return json(403, { message: "Forbidden" });
      if (r.method !== "GET") return json(405, {});
      if (url.pathname === "/v1/empresa/25") return json(200, fixture("company"));
      if (url.pathname === "/v1/vehicles/table" && fake.throttleOnce) {
        fake.throttleOnce = false;
        return json(429, { message: "slow down" }, { "retry-after": "1" });
      }
      const worker = /^\/v1\/workers\/(\d+)$/.exec(url.pathname);
      if (worker) {
        return json(200, {
          id: Number(worker[1]),
          fullName: "Trabajador Demo",
          certifications: [
            {
              id: Number(worker[1]) * 10,
              name: "CAP mercancías",
              endDate: "2026-12-01T00:00:00.000Z",
              fileId: 555,
            },
          ],
        });
      }
      if (url.pathname === "/v1/files/555/download") {
        res.writeHead(200, {
          "content-type": "application/pdf",
          "content-disposition": 'attachment; filename="cap.pdf"',
        });
        return res.end("%PDF-1.4 demo");
      }
      const table = TABLES[url.pathname];
      if (!table) return json(404, { message: "Not Found" });
      const rows = table();
      const page = Number(url.searchParams.get("page") ?? 1);
      const size = Number(url.searchParams.get("size") ?? 50);
      return json(200, { rows: rows.slice((page - 1) * size, page * size), count: rows.length });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

const ctx = () =>
  createContext({
    db: appDb.db,
    masterKey: randomBytes(32).toString("base64"),
    masterKeyVersion: 1,
    allowedPrivateHosts: ["127.0.0.1"],
    appUrl: "https://app.test",
    logLevel: "silent",
    linkKey: "k".repeat(40),
    mytutorApiUrl: baseUrl,
  });

describe("MyTutor filters and pages", () => {
  it("encodes table queries like MyTutor's UI", () => {
    const q = new URLSearchParams(
      listQuery({
        companyId: 25,
        page: 2,
        size: 100,
        filter: [
          filters.eq("is_active", true, "boolean"),
          filters.like("worker_status", "active", "workerCompanies"),
          filters.dateRange(
            "invoice_date",
            new Date("2026-01-01T00:00:00Z"),
            new Date("2027-01-01T00:00:00Z"),
          ),
        ],
        sorting: [{ p: "id", o: "asc" }],
        extra: { forceIsGlobal: "true" },
      }),
    );
    expect(q.get("companies")).toBe("25");
    expect(q.get("page")).toBe("2");
    expect(JSON.parse(q.get("filter")!)).toEqual([
      { p: "is_active", v: "true", r: "eq", t: "boolean" },
      { p: "worker_status", v: "active", r: "like", m: "workerCompanies" },
      {
        p: "invoice_date",
        v: '{"from":"2026-01-01T00:00:00.000Z","to":"2027-01-01T00:00:00.000Z"}',
        r: "like",
        t: "dateRange",
      },
    ]);
    expect(JSON.parse(q.get("sorting")!)).toEqual([{ p: "id", o: "asc" }]);
    expect(q.get("forceIsGlobal")).toBe("true");
  });

  it("reads {rows,count} and refuses other shapes", () => {
    expect(unpackList({ rows: [{ id: 1 }], count: 9 })).toEqual({ rows: [{ id: 1 }], total: 9 });
    expect(() => unpackList({ message: "x" })).toThrow(/no es una lista/);
  });

  it("maps records to cache columns and trims heavy nested data", () => {
    const client = ENTITY_BY_NAME.clients.map(fixture("clients").rows[0])!;
    expect(client.ref).toMatch(/^B\d{8}$/);
    expect(client.search).toBe(normalize(client.search));
    const order = fixture("waste_work_orders").rows[0];
    const mapped = ENTITY_BY_NAME.waste_work_orders.map(order)!;
    expect(JSON.stringify(mapped.raw).length).toBeLessThan(JSON.stringify(order).length / 3);
    expect(trim({ a: 1, n: { id: 2, name: "x", huge: { deep: 1 } } })).toEqual({
      a: 1,
      n: { id: 2, name: "x" },
    });
    expect(normalize("  Camión   ÁLAVA ")).toBe("camion alava");
  });

  it("keeps the session cookie, throttles and retries 429 with backoff", async () => {
    const c = ctx();
    const slept: number[] = [];
    const client = new MytutorClient({
      baseUrl,
      credentials: { email: EMAIL, password },
      fetcher: c.fetcher,
      minIntervalMs: 500,
      sleep: async (ms) => {
        slept.push(ms);
      },
    });
    fake.throttleOnce = true;
    const pages = [];
    for await (const p of client.pages("vehicles/table", { companyId: 25, size: 1 }))
      pages.push(p.rows.length);
    expect(pages).toEqual([1, 1]);
    expect(slept).toContain(1000); // Retry-After: 1
    expect(slept.some((ms) => ms > 0 && ms <= 500)).toBe(true); // ≤ 2 requests per second
    await c.fetcher.close();
  });
});

describe("MyTutor connection, sync and tools", () => {
  let tenantA = "";
  let tenantB = "";
  let connectionId = "";
  let c: ReturnType<typeof ctx>;

  beforeAll(async () => {
    c = ctx();
    tenantA = await createTenant(admin.db);
    tenantB = await createTenant(admin.db);
  });
  afterAll(async () => {
    await dropTenant(admin.db, tenantA);
    await dropTenant(admin.db, tenantB);
    await c.fetcher.close();
    server.closeAllConnections();
    server.close();
  });

  const conn = async (): Promise<ConnectionRow> => {
    const [row] = await withTenant(appDb.db, tenantA, (tx) =>
      tx.select().from(connections).where(eq(connections.id, connectionId)),
    );
    return row as ConnectionRow;
  };
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<Json> => {
    const res = await executeTool(
      c,
      await conn(),
      { id: name, name, sourceRef: name, config: {}, limits: {} },
      args,
    );
    expect(res.ok).toBe(true);
    return res.data;
  };

  it("tests the login and reads the company before saving", async () => {
    await expect(
      testMytutorConnection(c, { email: EMAIL, password: "mala", companyId: 25 }),
    ).rejects.toThrow(/email o contraseña incorrectos/);
    await expect(
      testMytutorConnection(c, { email: EMAIL, password, companyId: 99 }),
    ).rejects.toThrow(/no tiene acceso a la empresa 99/);
    expect(await testMytutorConnection(c, { email: EMAIL, password, companyId: 25 })).toEqual({
      companyName: "TRANSPORTES DEMO S.L.",
    });
  });

  it("creates the connection with read-only, auto-confirmed tools and the password in the vault", async () => {
    const res = await createMytutorConnection(c, tenantA, {
      name: "MyTutor",
      email: EMAIL,
      password,
      companyId: 25,
    });
    connectionId = res.connectionId;
    expect(res.companyName).toBe("TRANSPORTES DEMO S.L.");
    const row = await conn();
    expect(JSON.stringify(row.config)).not.toContain(password);
    expect(JSON.stringify(row.config)).not.toContain(EMAIL);
    const list = await withTenant(appDb.db, tenantA, (tx) =>
      tx.select().from(tools).where(eq(tools.connectionId, connectionId)),
    );
    expect(list.length).toBe(13);
    expect(list.every((t) => t.mode === "read" && t.confirmation === "auto")).toBe(true);
  });

  it("syncs every entity with GET requests only (plus login/refresh)", async () => {
    requests.length = 0;
    fake.throttleOnce = true;
    const out = await runMytutorSync(c, tenantA, connectionId, {
      trigger: "create",
      budgetMs: 60_000,
    });
    expect(out.status).toBe("done");
    expect(out.entities.clients).toMatchObject({ status: "done", records: 2 });
    expect(out.entities.waste_work_orders).toMatchObject({ status: "done", records: 2 });
    expect(out.entities.worker_documents).toMatchObject({ status: "done", records: 2 });
    const writes = requests.filter((r) => r.method !== "GET");
    expect(writes.every((r) => r.path.startsWith("/v1/auth/"))).toBe(true);
    const clientsReq = requests.find((r) => r.path === "/v1/clients/tableCompany/Client")!;
    expect(JSON.parse(clientsReq.query.get("sorting")!)).toEqual([{ p: "id", o: "asc" }]);
    expect((await conn()).config).toMatchObject({ lastSyncStatus: "done" });
  });

  it("answers the tools from the cache, citing source and sync time", async () => {
    const all = await call("buscar_cliente", { texto: "" });
    expect(all).toMatchObject({ source: "mytutor", total: 2 });
    expect(all.synced_at).toBeTruthy();
    const one = await call("ficha_cliente", { id: all.rows[0].cif_nif });
    expect(one.rows[0].id).toBe(all.rows[0].id);
    const docs = await call("documentos_trabajador", { id: String(fixture("workers").rows[0].id) });
    expect(docs.rows[0]).toMatchObject({ documento: "CAP mercancías", caduca: "2026-12-01" });
    expect(docs.rows[0].pdf).toMatch(/^https:\/\/app\.test\/api\/files\?k=mytutor-file/);
    const workers = await call("trabajadores", { incluir_bajas: true });
    expect(JSON.stringify(workers)).not.toMatch(/"NIF"|birthdate|personalPhone/);
    const exp = await call("vencimientos", { dias: 30 });
    expect(exp.rows[0]).toMatchObject({ caducado: true });
    const car = await call("ficha_vehiculo", { matricula: "1033 tst" });
    expect(car.vencimientos.length).toBe(1);
    const tach = await call("tacografos_estado");
    expect(tach.rows.length).toBe(2);
    const orders = await call("ordenes_residuos", { desde: "2000-01-01", hasta: "2100-01-01" });
    expect(orders.total).toBe(2);
    const file = await mytutorFile(c, tenantA, connectionId, "555");
    expect(new TextDecoder().decode(file.bytes)).toContain("%PDF");
  });

  it("marks records that disappear from MyTutor as deleted", async () => {
    fake.dropFirstClient = true;
    const out = await runMytutorSync(c, tenantA, connectionId, {
      trigger: "manual",
      budgetMs: 60_000,
    });
    expect(out.status).toBe("done");
    expect(out.entities.waste_work_orders?.status).toBe("skipped"); // heavy table: once a day
    const active = await withTenant(appDb.db, tenantA, (tx) =>
      tx
        .select()
        .from(mytutorClients)
        .where(
          and(eq(mytutorClients.connectionId, connectionId), isNull(mytutorClients.deletedAt)),
        ),
    );
    expect(active.length).toBe(1);
    expect((await call("buscar_cliente", { texto: "" })).total).toBe(1);
    fake.dropFirstClient = false;
  });

  it("isolates the cache between tenants (RLS)", async () => {
    const seen = await withTenant(appDb.db, tenantB, (tx) => tx.select().from(mytutorClients));
    expect(seen).toEqual([]);
    const runs = await withTenant(appDb.db, tenantB, (tx) => tx.select().from(mytutorSyncRuns));
    expect(runs).toEqual([]);
    await expect(
      runMytutorSync(c, tenantB, connectionId, { trigger: "manual", budgetMs: 5_000 }),
    ).rejects.toThrow(/no encontrada/);
  });

  it("resumes a sync that ran out of time", async () => {
    const first = await runMytutorSync(c, tenantA, connectionId, {
      trigger: "manual",
      budgetMs: 5_000,
    }).catch(() => null);
    // With 5 s and ~2 req/s it stops part-way; the next call continues the same run.
    if (first?.status === "partial") {
      const next = await runMytutorSync(c, tenantA, connectionId, {
        trigger: "schedule",
        budgetMs: 60_000,
      });
      expect(next.runId).toBe(first.runId);
      expect(next.status).toBe("done");
    } else {
      expect(first?.status).toBe("done");
    }
  });

  it("rotates the password only if MyTutor accepts it", async () => {
    await expect(updateMytutorPassword(c, tenantA, connectionId, "otra")).rejects.toThrow(
      /incorrectos/,
    );
    password = "secreta-2";
    expect(await updateMytutorPassword(c, tenantA, connectionId, "secreta-2")).toEqual({
      ok: true,
    });
    expect(
      (await runMytutorSync(c, tenantA, connectionId, { trigger: "manual", budgetMs: 60_000 }))
        .status,
    ).toBe("done");
  });
});
