import { expect, test } from "@playwright/test";
import { signUpAndCreateOrg } from "./helpers";

test("share an agent with a password-protected link", async ({ page, browser, baseURL }) => {
  test.setTimeout(120_000);
  await signUpAndCreateOrg(page, `Compartir ${Date.now()}`);
  await page.goto("/agents/new", { waitUntil: "networkidle" });
  await page.getByRole("radio", { name: /Lía/ }).click();
  await page.getByRole("button", { name: "Crear agente" }).click();
  await expect(page).toHaveURL(/\/agents\/[0-9a-f-]{36}$/);
  await page.goto(`${page.url()}?tab=publish`, { waitUntil: "networkidle" });

  // Both options side by side: web widget and shared link.
  await expect(page.getByTestId("widget-create")).toBeVisible();
  await page.getByTestId("share-password").fill("secreta-123");
  await page.getByTestId("share-password-confirm").fill("secreta-123");
  await page.getByTestId("share-create").click();
  const link = await page.getByTestId("share-link").inputValue({ timeout: 30_000 });
  expect(link).toMatch(/\/c\/[0-9a-f-]{36}$/);
  const path = new URL(link).pathname;

  // Someone else, without an account.
  const guest = await browser.newContext();
  const g = await guest.newPage();
  await g.goto(`${baseURL}${path}`, { waitUntil: "networkidle" });
  await expect(g.getByText("Este asistente es privado")).toBeVisible();
  const locked = await g.request.post(`${baseURL}/api/share${path.slice(2)}/chat`, {
    data: { message: "hola" },
    headers: { origin: baseURL! },
  });
  expect(locked.status()).toBe(401);

  await g.getByLabel("Contraseña").fill("mala-clave");
  await g.getByRole("button", { name: "Entrar" }).click();
  await expect(g.getByText("Contraseña incorrecta.")).toBeVisible();
  await g.getByLabel("Contraseña").fill("secreta-123");
  await g.getByRole("button", { name: "Entrar" }).click();
  await expect(g.getByTestId("widget-log")).toBeVisible({ timeout: 30_000 });
  await expect(g.getByLabel("Escribe un mensaje…")).toBeVisible();

  // Changing the password closes the open session.
  await page.getByTestId("share-password").fill("otra-clave-9");
  await page.getByTestId("share-password-confirm").fill("otra-clave-9");
  await page.getByRole("button", { name: "Guardar contraseña" }).click();
  await expect(page.getByText("Guardado.")).toBeVisible();
  await g.reload({ waitUntil: "networkidle" });
  await expect(g.getByText("Este asistente es privado")).toBeVisible();
  await guest.close();
});
