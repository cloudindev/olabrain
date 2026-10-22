import { describe, expect, it } from "vitest";
import type { SafeFetcher } from "../src/egress";
import { checkFactorial, executeFactorialTool } from "../src/adapters/native/factorial";
import { checkHolded, executeHoldedTool, madridDayBound } from "../src/adapters/native/holded";
import { daysBetween, executeSesameTool, sesameBaseUrl } from "../src/adapters/native/sesame";
import { NATIVE_TOOLS } from "../src/adapters/native";

type Call = { url: URL; method: string; headers: Headers; body: unknown };

/** Fake egress: records every request and answers from a route table (no network). */
function fakeFetcher(routes: (c: Call) => { status?: number; json: unknown } | undefined) {
  const calls: Call[] = [];
  const fetcher = {
    async safeFetch(raw: string | URL, init: RequestInit = {}) {
      const call: Call = {
        url: new URL(raw),
        method: init.method ?? "GET",
        headers: new Headers(init.headers),
        body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      };
      calls.push(call);
      const res = routes(call) ?? { status: 404, json: { error: "not found" } };
      return {
        status: res.status ?? 200,
        headers: new Headers({ "content-type": "application/json" }),
        body: JSON.stringify(res.json),
        truncated: false,
        url: call.url.toString(),
      };
    },
  } as unknown as SafeFetcher;
  return { fetcher, calls };
}

function ctx(fetcher: SafeFetcher, config: Record<string, unknown> = {}, apiKey = "key-123456") {
  return {
    config,
    secret: { apiKey },
    saveSecret: async () => undefined,
    fetcher,
    timeoutMs: 5_000,
    maxBytes: 100_000,
  };
}

describe("API-key connectors", () => {
  it("expose snake_case tools with object schemas", () => {
    for (const provider of ["holded", "factorial", "sesame"] as const) {
      const list = NATIVE_TOOLS[provider];
      expect(list.length).toBeGreaterThan(5);
      for (const t of list) {
        expect(t.name).toMatch(new RegExp(`^${provider}_[a-z_]+$`));
        expect(t.inputSchema).toMatchObject({ type: "object", additionalProperties: false });
      }
    }
  });
});

describe("Holded", () => {
  it("lists invoices of a Madrid day with bearer auth and sums them", async () => {
    const { fetcher, calls } = fakeFetcher((c) =>
      c.url.pathname === "/api/v2/invoices"
        ? {
            json: {
              items: [
                { id: "a", document_number: "F1", total: "121.00", payments_pending: "121.00" },
                { id: "b", document_number: "F2", total: "10.50", payments_pending: "0.00" },
              ],
              cursor: null,
              has_more: false,
            },
          }
        : undefined,
    );
    const res = await executeHoldedTool(ctx(fetcher), "holded_facturas", { desde: "2026-10-22" });
    expect(res.ok).toBe(true);
    expect(res.data).toMatchObject({ resumen: { numero: 2, total: 131.5, pendiente: 121 } });
    const call = calls[0]!;
    expect(call.headers.get("authorization")).toBe("Bearer key-123456");
    expect(call.url.searchParams.get("start_date")).toBe("2026-10-22T00:00:00+02:00");
    expect(call.url.searchParams.get("end_date")).toBe("2026-10-22T23:59:59+02:00");
  });

  it("finds an invoice by its exact visible number before paying the pending amount", async () => {
    const { fetcher, calls } = fakeFetcher((c) => {
      if (c.url.pathname === "/api/v2/invoices/find-by-number")
        return {
          json: {
            items: [
              { id: "x1", document_number: "F260011" },
              { id: "x2", document_number: "F26001" },
            ],
          },
        };
      if (c.url.pathname === "/api/v2/invoices/x2" && c.method === "GET")
        return { json: { id: "x2", document_number: "F26001", payments_pending: "50.00" } };
      if (c.url.pathname === "/api/v2/invoices/x2/payments") return { status: 201, json: {} };
      return undefined;
    });
    const res = await executeHoldedTool(ctx(fetcher), "holded_registrar_pago", {
      numero: "f26001",
      cuenta_id: "bank1",
    });
    expect(res.ok).toBe(true);
    const pay = calls.find((c) => c.url.pathname.endsWith("/payments"))!;
    expect(pay.method).toBe("POST");
    expect(pay.body).toMatchObject({ amount: "50.00", treasury_id: "bank1" });
  });

  it("creates invoices with price, units and tax ids per line", async () => {
    const { fetcher, calls } = fakeFetcher((c) =>
      c.method === "POST"
        ? { status: 201, json: { id: "new1" } }
        : { json: { id: "new1", document_number: "F9", total: "121.00" } },
    );
    await executeHoldedTool(ctx(fetcher), "holded_crear_factura", {
      contacto_id: "c1",
      lineas: [{ concepto: "Soporte", precio: 100, impuestos: ["iva21"] }],
    });
    expect(calls[0]!.body).toEqual({
      contact_id: "c1",
      items: [{ name: "Soporte", type: "service", price: 100, units: 1, taxes: ["iva21"] }],
    });
  });

  it("reports a rejected key in plain words when connecting", async () => {
    const { fetcher } = fakeFetcher(() => ({
      status: 401,
      json: { title: "Unauthorized", status: 401 },
    }));
    await expect(checkHolded(ctx(fetcher))).rejects.toThrow("Holded rechazó la clave de API");
  });

  it("computes Madrid day bounds across daylight saving time", () => {
    expect(madridDayBound("2026-01-15")).toBe("2026-01-15T00:00:00+01:00");
    expect(madridDayBound("2026-07-15", true)).toBe("2026-07-15T23:59:59+02:00");
  });
});

describe("Factorial", () => {
  it("uses the pinned version, x-api-key and array filters", async () => {
    const { fetcher, calls } = fakeFetcher(() => ({
      json: {
        data: [{ id: 1, employee_full_name: "Ana", approved: null, start_on: "2026-10-01" }],
        meta: { has_next_page: false },
      },
    }));
    const res = await executeFactorialTool(ctx(fetcher), "factorial_ausencias", {
      desde: "2026-10-01",
      hasta: "2026-10-31",
      empleado_id: 7,
      estado: "pendientes",
    });
    const call = calls[0]!;
    expect(call.url.toString()).toContain(
      "https://api.factorialhr.com/api/2026-10-01/resources/timeoff/leaves?",
    );
    expect(call.headers.get("x-api-key")).toBe("key-123456");
    expect(call.url.searchParams.get("employee_ids[]")).toBe("7");
    expect(call.url.searchParams.get("include_pending")).toBe("true");
    expect(res.data).toMatchObject({ ausencias: [{ id: 1, estado: "pendiente" }] });
  });

  it("clocks in with the current time and the employee", async () => {
    const { fetcher, calls } = fakeFetcher(() => ({ json: { id: 5, employee_id: 7 } }));
    await executeFactorialTool(ctx(fetcher), "factorial_fichar", {
      empleado_id: 7,
      accion: "entrada",
    });
    expect(calls[0]!.url.pathname).toBe("/api/2026-10-01/resources/attendance/shifts/clock_in");
    expect(calls[0]!.body).toMatchObject({ employee_id: 7 });
    expect(typeof (calls[0]!.body as { now: string }).now).toBe("string");
  });

  it("treats an empty credentials answer as an unknown key (other environment)", async () => {
    const { fetcher } = fakeFetcher(() => ({ json: { data: [], meta: {} } }));
    await expect(checkFactorial(ctx(fetcher))).rejects.toThrow("no reconoce");
  });
});

describe("Sesame HR", () => {
  it("only accepts region codes as host part", () => {
    expect(sesameBaseUrl("eu1")).toBe("https://api-eu1.sesametime.com");
    expect(() => sesameBaseUrl("evil.com/x")).toThrow("región");
  });

  it("matches employee names locally and hides sensitive fields", async () => {
    const { fetcher, calls } = fakeFetcher(() => ({
      json: {
        data: [
          {
            id: "u1",
            firstName: "Ana",
            lastName: "López",
            nid: "12345678Z",
            accountNumber: "ES00",
          },
          { id: "u2", firstName: "Luis", lastName: "Pérez" },
        ],
        meta: { currentPage: 1, lastPage: 1 },
      },
    }));
    const res = await executeSesameTool(ctx(fetcher, { region: "eu2" }), "sesame_empleados", {
      nombre: "lópez",
    });
    expect(calls[0]!.url.host).toBe("api-eu2.sesametime.com");
    expect(res.data).toEqual({ empleados: [{ id: "u1", nombre: "Ana López" }] });
    expect(JSON.stringify(res.data)).not.toContain("12345678Z");
  });

  it("requests vacations on the employee's calendar for every day of the range", async () => {
    const { fetcher, calls } = fakeFetcher((c) => {
      if (c.url.pathname === "/schedule/v1/vacation-calendars")
        return { json: { data: [{ id: "cal1", year: 2026 }], meta: {} } };
      if (c.url.pathname === "/schedule/v1/vacation-day-off-requests")
        return { json: { data: { id: "r1", status: "pending", daysOff: [] } } };
      return undefined;
    });
    await executeSesameTool(ctx(fetcher), "sesame_solicitar_vacaciones", {
      empleado_id: "u1",
      inicio: "2026-12-30",
      fin: "2027-01-02",
    });
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.headers.get("authorization")).toBe("Bearer key-123456");
    expect(post.body).toMatchObject({
      employeeId: "u1",
      calendarId: "cal1",
      type: "create",
      onlyWithSchedule: true,
      daysOff: [
        { date: "2026-12-30" },
        { date: "2026-12-31" },
        { date: "2027-01-01" },
        { date: "2027-01-02" },
      ],
    });
  });

  it("rejects reversed or huge date ranges", () => {
    expect(() => daysBetween("2026-02-10", "2026-02-01")).toThrow();
    expect(() => daysBetween("2026-01-01", "2026-12-31")).toThrow("como mucho");
  });
});
