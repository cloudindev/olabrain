import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createServer as createTcpServer, type Server as TcpServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { conversations, createDb, customerAccounts, messages } from "@brainagent/db";
import { expect, test } from "@playwright/test";
import { and, count, eq } from "drizzle-orm";
import { signUpAndCreateOrg } from "./helpers";

/**
 * Extranet (ADR-030), end to end: an extranet agent with ProfiECO (a fake on :4199) →
 * the organization gives a customer access → that person signs in with the emailed code →
 * places an order through the Tool Router → the team enters it in «Pedidos» → the
 * customer is emailed. Emails are caught by a tiny SMTP server on :1025 (SMTP_PORT).
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const FIXTURES = join(ROOT, "apps/connector/test/fixtures/mytutor");
const dotenv = Object.fromEntries(
  readFileSync(join(ROOT, ".env"), "utf8")
    .split("\n")
    .map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim()))
    .filter((m): m is RegExpExecArray => Boolean(m))
    .map((m) => [m[1]!, m[2]!.replace(/^"|"$/g, "")]),
);
const rows = (name: string) =>
  (
    JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8")) as {
      rows: Record<string, unknown>[];
    }
  ).rows;

// Customer 1129 ("corporate_name-1") gets an order and its own service; 1182 another one.
const DATA: Record<string, Record<string, unknown>[]> = {
  "/v1/clients/tableCompany/Client": rows("clients"),
  "/v1/clients/tableCompany/Supplier": rows("suppliers"),
  "/v1/company-service/paginated": [
    {
      id: 501,
      name: "Recogida de lodos",
      description: "Cuba de 10 m3",
      clientId: 1129,
      isGlobal: false,
    },
    {
      id: 502,
      name: "Contenedor general",
      description: "Para todos",
      clientId: null,
      isGlobal: true,
    },
    { id: 503, name: "Servicio de otro cliente", clientId: 1182, isGlobal: false },
  ],
  "/v1/vehicles/table": rows("vehicles"),
  "/v1/workers/table-workers": rows("workers"),
  "/v1/profitach/vehicles": rows("tach_vehicles"),
  "/v1/profitach/driver-cards": rows("tach_driver_cards"),
  "/v1/profitach/files": rows("tach_files"),
  "/v1/consignment-notes": rows("consignment_notes"),
  "/v1/waste-work-order/table-info": [
    ...rows("waste_work_orders"),
    {
      ...rows("waste_work_orders")[0],
      id: 900_001,
      client_id: 1129,
      client: { corporate_name: "corporate_name-1" },
      service_type: "Lodos EDAR",
    },
  ],
};

type Mail = { to: string; subject: string; body: string };
const mails: Mail[] = [];
let erp: Server;
let smtp: TcpServer;

/** Just enough SMTP for nodemailer (no auth, no TLS). */
function smtpSink(): TcpServer {
  return createTcpServer((socket) => {
    let data = false;
    let buffer = "";
    let message = "";
    let to = "";
    socket.write("220 sink\r\n");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let i: number;
      while ((i = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        if (data) {
          if (line === ".") {
            data = false;
            const [rawHead, ...rest] = message.split("\r\n\r\n");
            // Unfold continuation lines of the headers.
            const head = (rawHead ?? "").replace(/\r\n[ \t]+/g, " ");
            const subject = /^Subject: (.*)$/im.exec(head)?.[1] ?? "";
            const raw = rest.join("\r\n\r\n");
            const body = /transfer-encoding: base64/i.test(head)
              ? Buffer.from(raw.replace(/\s+/g, ""), "base64").toString("utf8")
              : /quoted-printable/i.test(head)
                ? Buffer.from(
                    raw
                      .replace(/=\r\n/g, "")
                      .replace(/=([0-9A-F]{2})/g, (_, h: string) =>
                        String.fromCharCode(parseInt(h, 16)),
                      ),
                    "latin1",
                  ).toString("utf8")
                : raw;
            mails.push({ to, subject: decodeMime(subject), body });
            message = "";
            socket.write("250 ok\r\n");
          } else message += `${line.startsWith("..") ? line.slice(1) : line}\r\n`;
          continue;
        }
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === "EHLO" || cmd === "HELO") socket.write("250 sink\r\n");
        else if (cmd === "RCPT") {
          to = /<(.*)>/.exec(line)?.[1] ?? "";
          socket.write("250 ok\r\n");
        } else if (cmd === "DATA") {
          data = true;
          socket.write("354 go\r\n");
        } else if (cmd === "QUIT") {
          socket.end("221 bye\r\n");
        } else socket.write("250 ok\r\n");
      }
    });
  });
}

function decodeMime(s: string): string {
  // Adjacent encoded words join without the whitespace between them (RFC 2047).
  return s
    .replace(/\?=\s+=\?/g, "?==?")
    .replace(/=\?utf-8\?([BQ])\?(.*?)\?=/gi, (_, enc: string, text: string) =>
      enc.toUpperCase() === "B"
        ? Buffer.from(text, "base64").toString("utf8")
        : Buffer.from(
            text
              .replace(/_/g, " ")
              .replace(/=([0-9A-F]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16))),
            "latin1",
          ).toString("utf8"),
    );
}

const mailTo = (to: string, subject: RegExp) =>
  expect
    .poll(() => mails.find((m) => m.to === to && subject.test(m.subject)), { timeout: 20_000 })
    .toBeTruthy()
    .then(() => mails.filter((m) => m.to === to && subject.test(m.subject)).at(-1)!);

test.beforeAll(async () => {
  erp = createServer((req, res) => {
    const url = new URL(req.url!, "http://x");
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
      const all = DATA[url.pathname];
      if (!all) return json(404, {});
      return json(200, {
        rows: url.searchParams.get("page") === "1" ? all : [],
        count: all.length,
      });
    });
  });
  await new Promise<void>((r) => erp.listen(4199, "127.0.0.1", r));
  smtp = smtpSink();
  await new Promise<void>((r) => smtp.listen(Number(dotenv.SMTP_PORT ?? 1025), r));
});

test.afterAll(() => {
  erp.closeAllConnections();
  erp.close();
  smtp.close();
});

test("an extranet agent: customer access, sign-in with a code, an order and its follow-up", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(300_000);
  await signUpAndCreateOrg(page, `Extranet ${Date.now()}`);
  await page.goto("/agents/new", { waitUntil: "networkidle" });
  await page.getByRole("radio", { name: /Lía/ }).click();
  await page.getByRole("radio", { name: /Extranet de clientes/ }).check();
  await page.getByLabel("Nombre").fill("Portal Coverde");
  await page.getByRole("button", { name: "Crear agente" }).click();
  // First hit compiles the agent page in `next dev`.
  await expect(page).toHaveURL(/\/agents\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  const agentUrl = page.url();
  const agentId = agentUrl.split("/").at(-1)!;

  // Its own tabs; «Publicar» is the customer area only.
  await expect(page.getByRole("link", { name: "Clientes" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Pedidos" })).toBeVisible();
  await page.goto(`${agentUrl}?tab=publish`, { waitUntil: "networkidle" });
  await expect(page.getByTestId("extranet-card")).toBeVisible();
  await expect(page.getByTestId("widget-create")).toHaveCount(0);
  const extranetUrl = await page.getByTestId("extranet-link").inputValue();
  expect(extranetUrl).toMatch(/\/x\/[0-9a-f-]{36}$/);
  const extranetPath = new URL(extranetUrl).pathname;

  // ProfiECO connected to the agent and synced.
  await page.goto(`${agentUrl}?tab=customers`, { waitUntil: "networkidle" });
  await expect(page.getByTestId("customers-no-erp")).toBeVisible();
  await page.goto(`/connections/new?agent=${agentId}`, { waitUntil: "networkidle" });
  await page.getByTestId("new-connection-mytutor").click();
  await page.getByLabel("Id de empresa").fill("25");
  await page.getByLabel("Email de ProfiECO").fill("admin@ejemplo.test");
  await page.getByLabel("Contraseña de ProfiECO").fill("secreta");
  await page.getByRole("button", { name: "Probar conexión" }).click();
  await expect(page.getByTestId("mytutor-test-result")).toContainText("Conexión correcta", {
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Conectar y sincronizar" }).click();
  await expect(page).toHaveURL(/\/connections\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect
    .poll(
      async () => {
        await page.reload();
        return page.getByTestId("mytutor-count-waste_work_orders").textContent();
      },
      { timeout: 90_000, intervals: [3_000] },
    )
    .toBe("3");

  // The organization gives Marta, of customer 1129, access.
  await page.goto(`${agentUrl}?tab=customers`, { waitUntil: "networkidle" });
  await page.getByLabel("Cliente del ERP").fill("1129");
  await page
    .getByTestId("erp-results")
    .getByRole("button", { name: /corporate_name-1\b/ })
    .click();
  await expect(page.getByTestId("chosen-customer")).toHaveText("corporate_name-1");
  await expect(page.getByLabel("Email de la persona")).toHaveValue("persona5@ejemplo.test");
  await page.getByLabel("Nombre (opcional)").fill("Marta");
  await page.getByTestId("customer-invite").click();
  await expect(page.getByRole("status")).toHaveText("Invitación enviada.");
  await expect(page.getByTestId("customer-list")).toContainText("Marta");
  const invitation = await mailTo("persona5@ejemplo.test", /te da acceso/);
  expect(invitation.body).toContain(extranetPath);

  // Marta signs in from her own browser.
  const guest = await browser.newContext();
  const g = await guest.newPage();
  await g.goto(`${baseURL}${extranetPath}`, { waitUntil: "networkidle" });
  // An unknown email gets the same answer, and no code.
  await g.getByLabel("Email").fill("nadie@ejemplo.test");
  await g.getByRole("button", { name: "Enviar código" }).click();
  await expect(g.getByText(/te hemos enviado un código/)).toBeVisible();
  await g.getByRole("button", { name: "Usar otro email" }).click();
  await g.getByLabel("Email").fill("persona5@ejemplo.test");
  await g.getByRole("button", { name: "Enviar código" }).click();
  const codeMail = await mailTo("persona5@ejemplo.test", /código de acceso/);
  const code = /(\d{6})/.exec(codeMail.subject)![1]!;
  expect(mails.some((m) => m.to === "nadie@ejemplo.test")).toBe(false);
  await g.getByLabel("Código de 6 cifras").fill(code === "000000" ? "111111" : "000000");
  await g.getByRole("button", { name: "Entrar" }).click();
  await expect(g.getByText("Código incorrecto.")).toBeVisible();
  await g.getByLabel("Código de 6 cifras").fill(code);
  await g.getByRole("button", { name: "Entrar" }).click();
  await expect(g.getByTestId("extranet-session")).toHaveText("Marta · corporate_name-1", {
    timeout: 30_000,
  });

  // Without the session cookie the chat is closed.
  const locked = await page.request.post(`/api/extranet${extranetPath.slice(2)}/chat`, {
    data: { message: "hola" },
    headers: { origin: baseURL! },
  });
  expect(locked.status()).toBe(401);

  // Marta writes; her conversation is bound to her account by the server.
  const say = async (text: string) => {
    await expect(async () => {
      const input = g.getByPlaceholder("Escribe un mensaje…");
      await input.fill(text);
      await input.press("Enter");
      await expect(input).toHaveValue("", { timeout: 1000 });
    }).toPass();
  };
  await say("Hola");
  const { db, close } = createDb(dotenv.DATABASE_URL_ADMIN!, { max: 1 });
  try {
    const [account] = await db
      .select()
      .from(customerAccounts)
      .where(eq(customerAccounts.agentId, agentId));
    expect(account).toMatchObject({ status: "active", erpCustomerRef: "1129" });
    const conversationId = await expect
      .poll(
        async () =>
          (
            await db
              .select({ id: conversations.id })
              .from(conversations)
              .where(eq(conversations.customerAccountId, account!.id))
          )[0]?.id,
        { timeout: 20_000 },
      )
      .toBeTruthy()
      .then(
        async () =>
          (
            await db
              .select({ id: conversations.id })
              .from(conversations)
              .where(eq(conversations.customerAccountId, account!.id))
          )[0]!.id,
      );

    // What the agent runtime does, through the Tool Router.
    const callTool = async (toolName: string, args: Record<string, unknown>, confirm = false) =>
      (
        await page.request.post("http://127.0.0.1:4100/v1/tools/call", {
          headers: {
            authorization: `Bearer ${dotenv.CONNECTOR_SERVICE_TOKEN}`,
            "x-tenant-id": account!.tenantId,
          },
          data: { agentId, conversationId, toolName, args, confirm },
        })
      ).json();
    const orders = await callTool("mis_ordenes", {});
    expect(orders.status).toBe("ok");
    expect(orders.result.rows.map((r: { servicio: string }) => r.servicio)).toEqual(["Lodos EDAR"]);
    const catalog = await callTool("catalogo", {});
    expect(catalog.result.rows.map((r: { referencia: string }) => r.referencia).sort()).toEqual([
      "501",
      "502",
    ]);
    expect((await callTool("buscar_cliente", { texto: "corporate" })).status).toBe("error");
    const order = {
      lineas: [{ referencia: "501", cantidad: 2, nota: "El lunes" }],
      nota: "Urgente",
    };
    expect((await callTool("nuevo_pedido", order)).status).toBe("needs_confirmation");
    await say("Sí, confírmalo");
    // Valid only once the customer's new message is stored (proof of a human "yes").
    await expect
      .poll(
        async () =>
          (
            await db
              .select({ n: count() })
              .from(messages)
              .where(and(eq(messages.conversationId, conversationId), eq(messages.role, "user")))
          )[0]!.n,
        { timeout: 20_000 },
      )
      .toBe(2);
    const placed = await callTool("nuevo_pedido", order, true);
    expect(placed.status).toBe("ok");
    expect(placed.result).toMatchObject({ pedido: 1, estado: "pendiente" });
  } finally {
    await close();
  }

  // The team sees it in «Pedidos», enters it in the ERP and the customer is told.
  await page.goto(agentUrl, { waitUntil: "networkidle" });
  await expect(page.getByTestId("orders-badge")).toHaveText("1");
  await page.goto(`${agentUrl}?tab=orders`, { waitUntil: "networkidle" });
  const row = page.getByTestId("order-row").first();
  await expect(row).toHaveAttribute("data-unread", "true");
  await expect(row).toContainText("corporate_name-1");
  await row.getByRole("button").first().click();
  await expect(row).toContainText("Recogida de lodos");
  await expect(row).toContainText("Urgente");
  await row.getByLabel("Referencia en el ERP").fill("ALB-77");
  await row.getByTestId("order-entered").click();
  await expect(row.getByRole("status")).toHaveText("Guardado.");
  await expect(row).toContainText("Introducido");
  const update = await mailTo("persona5@ejemplo.test", /pedido nº 1 ha sido introducido/);
  expect(update.body).toContain("ALB-77");

  // Taking her access away ends her session at once.
  await page.goto(`${agentUrl}?tab=customers`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Quitar acceso" }).click();
  await expect(page.getByTestId("customer-list")).toContainText("Sin acceso");
  await g.reload({ waitUntil: "networkidle" });
  await expect(g.getByRole("button", { name: "Enviar código" })).toBeVisible();
  await guest.close();
});
