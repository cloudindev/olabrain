import { expect, test } from "@playwright/test";
import { signUpAndCreateOrg } from "./helpers";

test("an admin deletes an agent and its conversations from Personalizar", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await signUpAndCreateOrg(page, `Borrar ${Date.now()}`);
  await page.goto("/agents/new", { waitUntil: "networkidle" });
  await page.getByRole("radio", { name: /Mateo/ }).click();
  await page.getByLabel("Nombre del agente").fill("Hugo temporal");
  await page.getByRole("button", { name: "Crear agente" }).click();
  await expect(page).toHaveURL(/\/agents\/[0-9a-f-]{36}$/);
  const agentId = page.url().split("/").at(-1)!;

  // It has a conversation (voice session): deleting the agent must not be blocked by it.
  const session = await page.request.post("/api/lab/token", {
    data: { config: { agent_id: agentId } },
  });
  expect(session.status()).toBe(200);

  await page.goto(`/agents/${agentId}?tab=customize`, { waitUntil: "networkidle" });
  const zone = page.getByTestId("delete-agent");
  await zone.getByRole("button", { name: "Borrar agente" }).click();
  const confirm = zone.getByRole("button", { name: "Borrar definitivamente" });
  await zone.getByLabel(/Escribe «Hugo temporal»/).fill("Hugo");
  await expect(confirm).toBeDisabled();
  await zone.getByLabel(/Escribe «Hugo temporal»/).fill("Hugo temporal");
  await confirm.click();

  await expect(page).toHaveURL(/\/agents$/);
  await expect(page.getByText("Hugo temporal")).toHaveCount(0);
  expect((await page.request.get(`/agents/${agentId}`)).status()).toBe(404);
});
