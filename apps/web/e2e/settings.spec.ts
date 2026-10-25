import { expect, test } from "@playwright/test";
import { signUpAndCreateOrg, uniqueEmail } from "./helpers";

// `next dev` compiles each settings route on its first hit.
test.describe.configure({ timeout: 90_000 });

test("profile: change the display name", async ({ page }) => {
  await signUpAndCreateOrg(page, "Perfil SL");
  await page.goto("/settings/profile", { waitUntil: "networkidle" });

  await expect(page.getByLabel("Email")).toHaveValue(/@example\.test$/);
  const name = page.getByLabel("Nombre visible");
  await expect(name).toHaveValue("Ana Prueba");
  await name.fill("Ana Cambiada");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByRole("status")).toHaveText("Nombre actualizado.");

  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByLabel("Nombre visible")).toHaveValue("Ana Cambiada");
});

test("organization: the creator is owner and can invite with a copyable link", async ({ page }) => {
  await signUpAndCreateOrg(page, "Equipo SL");
  await page.goto("/settings/organization", { waitUntil: "networkidle" });

  await expect(page.getByLabel("Nombre", { exact: true })).toHaveValue("Equipo SL");
  const me = page.getByTestId("member-row");
  await expect(me).toHaveCount(1);
  await expect(me).toContainText("Ana Prueba");
  await expect(me.getByTestId("member-role")).toHaveText("Propietario");

  const email = uniqueEmail("invitado");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Rol", { exact: true }).selectOption({ label: "Creador" });
  await page.getByRole("button", { name: "Invitar" }).click();

  const link = page.getByTestId("invitation-link");
  await expect(link).toHaveValue(/\/invitations\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("pending-invitations")).toContainText(email);
});

test("preferences: switch the language to English and back", async ({ page }) => {
  await signUpAndCreateOrg(page, "Idiomas SL");
  await page.goto("/settings/preferences", { waitUntil: "networkidle" });

  await expect(page.getByRole("heading", { name: "Idioma" })).toBeVisible();
  await page.getByText("English", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "Language" })).toBeVisible();
  await expect(page.getByRole("radio", { name: /^English/ })).toBeChecked();

  await page.getByText("Español", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "Idioma" })).toBeVisible();
  await expect(page.getByRole("radio", { name: /^Español/ })).toBeChecked();
});
