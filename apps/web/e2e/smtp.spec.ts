import { expect, test } from "@playwright/test";
import { signUpAndCreateOrg } from "./helpers";

test("an SMTP connection is created for an agent and private servers are refused", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await signUpAndCreateOrg(page, `Email ${Date.now()}`);
  await page.goto("/agents/new", { waitUntil: "networkidle" });
  await page.getByRole("radio", { name: /Lía/ }).click();
  await page.getByRole("button", { name: "Crear agente" }).click();
  await expect(page).toHaveURL(/\/agents\/[0-9a-f-]{36}$/);
  const agentId = page.url().split("/").at(-1)!;

  await page.goto(`/connections/new?agent=${agentId}`, { waitUntil: "networkidle" });
  await page.getByTestId("new-connection-smtp").click();
  await expect(page.getByText(/solo podrá escribir a los destinatarios/)).toBeVisible();
  await page.getByLabel("Servidor SMTP").fill("10.0.0.1");
  await page.getByLabel("Remitente").fill("avisos@acme.es");
  await page.getByLabel("Destinatarios").fill("ventas@acme.es");
  await page.getByRole("button", { name: "Conectar" }).click();
  // Anti-SSRF: a server in a private network is not allowed.
  await expect(page.getByText(/no se puede usar el servidor 10\.0\.0\.1/)).toBeVisible({
    timeout: 30_000,
  });
});
