import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { signUpAndCreateOrg } from "./helpers";

/**
 * MyTutor connector (ADR-021) against a fake MyTutor on 127.0.0.1:4199 (the connector
 * runs with MYTUTOR_API_URL pointing at it, see playwright.config.ts): create the
 * connection → sync → browse and export the cache → ask the agent (real LLM, opt-in).
 */
const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../connector/test/fixtures/mytutor",
);
const rows = (name: string) =>
  (JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8")) as { rows: unknown[] }).rows;
const TABLES: Record<string, string> = {
  "/v1/clients/tableCompany/Client": "clients",
  "/v1/clients/tableCompany/Supplier": "suppliers",
  "/v1/company-service/paginated": "services",
  "/v1/vehicles/table": "vehicles",
  "/v1/workers/table-workers": "workers",
  "/v1/profitach/vehicles": "tach_vehicles",
  "/v1/profitach/driver-cards": "tach_driver_cards",
  "/v1/profitach/files": "tach_files",
  "/v1/consignment-notes": "consignment_notes",
  "/v1/waste-work-order/table-info": "waste_work_orders",
};
const methods: string[] = [];
let server: Server;

test.beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url!, "http://x");
    methods.push(`${req.method} ${url.pathname}`);
    const json = (status: number, data: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(data));
    };
    req.resume();
    req.on("end", () => {
      if (url.pathname === "/v1/auth/login") {
        const claims = Buffer.from(
          JSON.stringify({
            companies: [{ company_id: 25, company_name: "TRANSPORTES DEMO S.L." }],
          }),
        ).toString("base64url");
        return json(
          201,
          { access_token: `x.${claims}.y` },
          { "set-cookie": "cookie_profieco=acc; Path=/" },
        );
      }
      if (!(req.headers.cookie ?? "").includes("cookie_profieco=acc")) return json(403, {});
      if (url.pathname === "/v1/empresa/25") return json(200, { name: "TRANSPORTES DEMO S.L." });
      if (/^\/v1\/workers\/\d+$/.test(url.pathname))
        return json(200, { id: 1, certifications: [] });
      if (url.pathname === "/v1/expiration/table") return json(200, { rows: [], count: 0 });
      const table = TABLES[url.pathname];
      if (!table) return json(404, {});
      const all = rows(table);
      return json(200, {
        rows: url.searchParams.get("page") === "1" ? all : [],
        count: all.length,
      });
    });
  });
  await new Promise<void>((r) => server.listen(4199, "127.0.0.1", r));
});

test.afterAll(() => {
  server.closeAllConnections();
  server.close();
});

test("connect ProfiECO to an agent, sync it and browse/export the copied data", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signUpAndCreateOrg(page, `ProfiECO ${Date.now()}`);
  await page.goto("/agents/new", { waitUntil: "networkidle" });
  await page.getByRole("radio", { name: /Lía/ }).click();
  await page.getByRole("button", { name: "Crear agente" }).click();
  await expect(page).toHaveURL(/\/agents\/[0-9a-f-]{36}$/);
  const agentUrl = page.url();
  const agentId = agentUrl.split("/").at(-1)!;

  await page.goto(`/connections/new?agent=${agentId}`, { waitUntil: "networkidle" });
  await page.getByTestId("new-connection-mytutor").click();
  await page.getByLabel("Id de empresa").fill("25");
  await page.getByLabel("Email de ProfiECO").fill("admin@ejemplo.test");
  await page.getByLabel("Contraseña de ProfiECO").fill("secreta");
  await page.getByRole("button", { name: "Probar conexión" }).click();
  await expect(page.getByTestId("mytutor-test-result")).toHaveText(
    "Conexión correcta: TRANSPORTES DEMO S.L.",
    { timeout: 30_000 },
  );
  await page.getByRole("button", { name: "Conectar y sincronizar" }).click();
  await expect(page).toHaveURL(/\/connections\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(page.getByTestId("mytutor-panel")).toContainText("TRANSPORTES DEMO S.L.");

  // The first sync runs in the background; the panel refreshes itself.
  await expect
    .poll(
      async () => {
        await page.reload();
        return page.getByTestId("mytutor-count-clients").textContent();
      },
      { timeout: 90_000, intervals: [3_000] },
    )
    .toBe("2");
  await expect(page.getByTestId("mytutor-count-waste_work_orders")).toHaveText("2");
  // Read-only: only the login is not a GET.
  expect(methods.filter((m) => !m.startsWith("GET ") && !m.includes("/auth/"))).toEqual([]);

  await page.getByTestId("mytutor-view-clients").click();
  // First visit compiles the route in `next dev`: allow for it.
  await expect(page).toHaveURL(/\/mytutor\/clients/, { timeout: 60_000 });
  await expect(page.getByTestId("mytutor-table").locator("tbody tr")).toHaveCount(2, {
    timeout: 60_000,
  });
  const download = page.waitForEvent("download");
  await page.getByTestId("mytutor-export-csv").click();
  const csv = await (await download).path();
  expect(readFileSync(csv, "utf8")).toContain("mytutor_id;");

  // Ask the agent (needs a real model).
  if (!process.env.E2E_LLM) {
    test.info().annotations.push({ type: "skipped-step", description: "chat needs E2E_LLM=1" });
    return;
  }
  await page.goto(`${agentUrl}?tab=test`, { waitUntil: "networkidle" });
  await expect(async () => {
    await page
      .getByLabel("Escribe un mensaje…")
      .fill("Busca en ProfiECO los clientes y dime cuántos hay.");
    await expect(page.getByRole("button", { name: "Enviar" })).toBeEnabled({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await page.getByRole("button", { name: "Enviar" }).click();
  await expect(page.getByTestId("tool-chip").first()).toContainText("buscar_cliente", {
    timeout: 60_000,
  });
});
