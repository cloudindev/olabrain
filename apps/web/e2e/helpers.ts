import { expect, type Page } from "@playwright/test";

export function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.test`;
}

/** Signs up a fresh user and creates their organization; ends on the agents page. */
export async function signUpAndCreateOrg(page: Page, orgName: string) {
  await page.goto("/signup", { waitUntil: "networkidle" });
  await page.getByLabel("Nombre", { exact: true }).fill("Ana Prueba");
  await page.getByLabel("Email").fill(uniqueEmail("ana"));
  await page.getByLabel("Contraseña").fill("contraseña-segura-123");
  await page.getByRole("button", { name: "Crear cuenta" }).click();

  await expect(page).toHaveURL(/\/onboarding$/);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Nombre de la organización").fill(orgName);
  await page.getByRole("button", { name: "Crear organización" }).click();

  await expect(page).toHaveURL(/\/agents$/);
  await expect(page.getByTestId("tenant-name")).toHaveText(orgName);
}
