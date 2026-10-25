import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { config } from "dotenv";

// The admin URL (owner role) to insert a lead the way the connector does.
config({ path: new URL("../../../.env", import.meta.url).pathname, quiet: true });
import { signUpAndCreateOrg } from "./helpers";

// Leads come from web-widget conversations (the LLM calls email_aviso_contacto); their
// capture is covered by the connector tests. Here: the page is protected and starts empty.
test("leads page starts empty for a new organization", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/leads");
  await expect(page).toHaveURL(/\/login/);

  await signUpAndCreateOrg(page, "Leads SL");
  await page.goto("/leads");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Leads");
  await expect(page.getByTestId("leads-empty")).toContainText("Todavía no hay leads");

  // A lead of another organization (or a made-up id) is not found.
  // (Streamed pages answer 200, so check the not-found page itself.)
  await page.goto("/leads/00000000-0000-4000-8000-000000000000");
  await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
});

test("a widget lead shows in the navbar badge, the list (with its agent) and the detail", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const org = `Leads ${Date.now()}`;
  await signUpAndCreateOrg(page, org);
  await page.goto("/agents/new", { waitUntil: "networkidle" });
  await page.getByRole("radio", { name: /Lía/ }).click();
  await page.getByLabel("Función").fill("Recepción web");
  await page.getByRole("button", { name: "Crear agente" }).click();
  await expect(page).toHaveURL(/\/agents\/[0-9a-f-]{36}$/);
  const agentId = page.url().split("/").at(-1)!;

  // Leads are written by the connector when the widget agent notifies a contact; insert
  // one the same way (admin connection, this organization).
  const sql = `insert into leads (tenant_id, agent_id, agent_name, name, email, phone, company, request, agent_notes)
    select tenant_id, id, name, 'Luis Sánchez', 'luis@cliente.es', '+34600112233', 'Cliente SL',
      'Alojar 5 servidores en un rack', 'Interés alto, quiere precio esta semana'
    from agents where id = '${agentId}'`;
  execFileSync("psql", [process.env.DATABASE_URL_ADMIN!, "-X", "-q", "-c", sql]);

  await page.goto("/agents", { waitUntil: "networkidle" });
  await expect(page.getByTestId("leads-badge")).toHaveText("1");
  await page.getByRole("link", { name: /Leads/ }).first().click();
  await expect(page).toHaveURL(/\/leads$/);
  await expect(page.getByText("Luis Sánchez").first()).toBeVisible();
  await expect(page.getByText("Lía").first()).toBeVisible();
  await page.getByText("Luis Sánchez").first().click();
  await expect(page.getByText("Interés alto, quiere precio esta semana")).toBeVisible();
  // Opened = read: the badge goes away.
  await page.goto("/agents", { waitUntil: "networkidle" });
  await expect(page.getByTestId("leads-badge")).toHaveCount(0);
});
