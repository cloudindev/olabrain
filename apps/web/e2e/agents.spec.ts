import { expect, test } from "@playwright/test";
import { signUpAndCreateOrg } from "./helpers";

/**
 * CLAUDE.md §7: create agent → connect a tool → talk to it.
 * The conversation step calls a real LLM, so it only runs with E2E_LLM=1.
 */
test("create an agent, connect the demo database tools and use them", async ({ page }) => {
  test.setTimeout(120_000);
  await signUpAndCreateOrg(page, "Talleres Ruiz");

  // Connect: demo SQL connection with partes_hoy and horas_equipo.
  await page.goto("/connections", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Añadir ejemplo (BD de demo)" }).click();
  await expect(page).toHaveURL(/\/connections\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("tool-partes_hoy")).toBeVisible();
  await expect(page.getByTestId("tool-horas_equipo")).toBeVisible();

  // Test the tool from the connection page.
  const row = page.getByTestId("tool-partes_hoy");
  await row.getByRole("button", { name: "Probar" }).click();
  await row.getByRole("button", { name: "Ejecutar" }).click();
  await expect(row.getByTestId("tool-result")).toContainText("Clínica Dental Sol");

  // Create the agent from the catalog.
  await page.goto("/agents/new", { waitUntil: "networkidle" });
  await page.getByRole("radio", { name: /Mateo/ }).click();
  await page.getByLabel("Nombre del agente").fill("Hugo de operaciones");
  await page.getByRole("button", { name: "Crear agente" }).click();
  await expect(page).toHaveURL(/\/agents\/[0-9a-f-]{36}$/);
  const agentUrl = page.url();

  // The agent opens on its conversation (avatar + chat).
  await expect(page.getByTestId("agent-console-state")).toBeVisible();

  // Give it instructions (Personalizar).
  await page.goto(`${agentUrl}?tab=customize`, { waitUntil: "networkidle" });
  await page
    .getByLabel("Instrucciones")
    .fill("Trabajas para Talleres Ruiz. Responde en una o dos frases.");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByRole("status")).toHaveText("Guardado");

  // New agents start without connections; the demo one has no owner yet: adopt it.
  await page.goto(`${agentUrl}?tab=connections`, { waitUntil: "networkidle" });
  await expect(page.getByTestId("connection-cards")).not.toContainText("Operaciones (demo)");
  const unowned = page.getByTestId("unowned-connections");
  await expect(unowned).toContainText("Operaciones (demo)");
  await unowned.getByRole("button", { name: "Usar en este agente" }).click();
  // A card per connected app; opening it shows its tools.
  await expect(page.getByTestId("connection-cards")).toContainText("2/2 herramientas");
  await page.getByTestId("connection-card-Operaciones (demo)").click();
  await expect(page).toHaveURL(/connection=[0-9a-f-]{36}/);
  await expect(page.getByRole("switch", { name: "partes_hoy" })).toBeChecked();
  await expect(page.getByRole("switch", { name: "horas_equipo" })).toBeChecked();
  await page.getByRole("switch", { name: "horas_equipo" }).uncheck({ force: true });
  await expect(page.getByTestId("tools-summary")).toHaveText("1 de 2 herramientas activas");
  await page.getByRole("switch", { name: "horas_equipo" }).check({ force: true });
  await expect(page.getByText(/cambio sin guardar/)).toHaveCount(0);

  await page.goto("/agents");
  await expect(page.getByTestId("agent-list")).toContainText("2 herramientas");

  // Another agent never gets (or sees) this agent's connection.
  await page.goto("/agents/new", { waitUntil: "networkidle" });
  await page.getByRole("radio", { name: /Nora/ }).click();
  await page.getByLabel("Nombre del agente").fill("Nora soporte");
  await page.getByRole("button", { name: "Crear agente" }).click();
  await expect(page).toHaveURL(/\/agents\/[0-9a-f-]{36}$/);
  await page.goto(`${page.url()}?tab=connections`, { waitUntil: "networkidle" });
  await expect(page.getByText("Operaciones (demo)")).toHaveCount(0);
  await page.goto(agentUrl);

  test.skip(!process.env.E2E_LLM, "conversation step needs a real LLM (set E2E_LLM=1)");

  // Talk to it: the agent must call partes_hoy and answer with real data.
  // Warm up the chat route: under `next dev` its first compilation can force a full page
  // reload that would wipe the conversation state.
  await page.request.post(`${agentUrl.replace("/agents/", "/api/agents/")}/chat`, { data: {} });
  await page.goto(`${agentUrl}?tab=test`, { waitUntil: "networkidle" });
  // `next dev` may hydrate after the first fill and reset the controlled textarea.
  await expect(async () => {
    await page
      .getByLabel("Escribe un mensaje…")
      .fill("¿Qué partes de trabajo hay hoy? Dime los clientes.");
    await expect(page.getByRole("button", { name: "Enviar" })).toBeEnabled({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await page.getByRole("button", { name: "Enviar" }).click();
  await expect(page.getByTestId("tool-chip").first()).toContainText("partes_hoy", {
    timeout: 60_000,
  });
  await expect(page.getByTestId("assistant-message").last()).toContainText(
    /Clínica|Panadería|Gestoría|Hotel/,
    {
      timeout: 60_000,
    },
  );

  // Attach a file: the agent reads it with the message.
  await page.locator('input[type="file"]').setInputFiles({
    name: "tarifas.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Tarifas 2026: el plan Pro cuesta 199 euros al mes."),
  });
  await expect(page.getByText("tarifas.txt")).toBeVisible();
  await page
    .getByLabel("Escribe un mensaje…")
    .fill("Según el archivo, ¿cuánto cuesta el plan Pro?");
  await page.getByRole("button", { name: "Enviar" }).click();
  await expect(page.getByTestId("assistant-message").last()).toContainText("199", {
    timeout: 60_000,
  });
});
