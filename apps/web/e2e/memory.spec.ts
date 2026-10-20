import { expect, test, type Page } from "@playwright/test";
import { signUpAndCreateOrg } from "./helpers";

/** Memory per contact: learn in one conversation, use it in the next. Needs a real LLM. */
test.skip(!process.env.E2E_LLM, "needs a real LLM (set E2E_LLM=1)");

async function say(page: Page, text: string) {
  await expect(async () => {
    await page.getByLabel("Escribe un mensaje…").fill(text);
    await expect(page.getByRole("button", { name: "Enviar" })).toBeEnabled({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  const before = await page.getByTestId("assistant-message").count();
  await page.getByRole("button", { name: "Enviar" }).click();
  await expect(page.getByTestId("assistant-message")).toHaveCount(before + 1);
  // Wait until the streamed reply is complete (stats line appears with "done").
  await expect(page.getByText(/Primer token \d+ ms/).nth(before)).toBeVisible({ timeout: 60_000 });
}

test("an agent remembers a contact across conversations and the memory can be erased", async ({ page }) => {
  test.setTimeout(180_000);
  await signUpAndCreateOrg(page, "Cloudin Memoria");

  await page.goto("/agents/new", { waitUntil: "networkidle" });
  await page.getByRole("radio", { name: /Alba/ }).click();
  await page.getByRole("button", { name: "Crear agente" }).click();
  await expect(page).toHaveURL(/\/agents\/[0-9a-f-]{36}$/);
  const agentUrl = page.url();

  await page.request.post(`${agentUrl.replace("/agents/", "/api/agents/")}/chat`, { data: {} });
  await page.goto(`${agentUrl}?tab=test`, { waitUntil: "networkidle" });
  await say(page, "Hola, me llamo Luisa, soy la directora de Talleres Ruiz y prefiero que me llamen por la tarde.");

  // Extraction runs in the background after the reply: wait for it on the contact page.
  await expect(async () => {
    await page.goto("/contacts", { waitUntil: "networkidle" });
    await page.getByTestId("contact-list").getByRole("link").first().click();
    await expect(page.getByTestId("memory-list")).toContainText(/Luisa/, { timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
  const contactUrl = page.url();
  await expect(page.getByTestId("memory-list")).toContainText(/tarde/i);

  // New conversation: the agent should know her name without being told.
  await page.goto(`${agentUrl}?tab=test`, { waitUntil: "networkidle" });
  await say(page, "¿Recuerdas cómo me llamo y cuándo prefiero que me llamen?");
  await expect(page.getByTestId("assistant-message").last()).toContainText("Luisa");

  // RGPD: erase the memory.
  await page.goto(contactUrl, { waitUntil: "networkidle" });
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Borrar toda la memoria" }).click();
  await expect(page.getByText("El agente aún no recuerda nada de esta persona.")).toBeVisible();
});
