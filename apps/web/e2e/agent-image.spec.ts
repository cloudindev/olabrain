import { expect, test } from "@playwright/test";
import { signUpAndCreateOrg } from "./helpers";

// A 4x2 red PNG: the browser crops it to 3:4 and re-encodes it.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAIAAADwyuo0AAAAEElEQVR4nGP4z8AARwzIHABvqgf5gNwAKAAAAABJRU5ErkJggg==",
  "base64",
);

test("an agent gets its own picture when created and goes back to the persona's", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await signUpAndCreateOrg(page, `Imagen ${Date.now()}`);
  await page.goto("/agents/new", { waitUntil: "networkidle" });
  await page.getByRole("radio", { name: /Mateo/ }).click();
  await page.getByLabel("Nombre del agente").fill("Ana comercial");
  await page.getByTestId("agent-image-input").setInputFiles({
    name: "ana.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await expect(page.getByTestId("agent-image-remove")).toBeVisible();
  await page.getByRole("button", { name: "Crear agente" }).click();
  await expect(page).toHaveURL(/\/agents\/[0-9a-f-]{36}$/);
  const agentUrl = page.url();

  // Its picture (a data URL) everywhere: header and the agents list.
  await expect(page.locator('img[src^="data:image/"]').first()).toBeVisible();
  await page.goto("/agents", { waitUntil: "networkidle" });
  await expect(page.locator('img[src^="data:image/"]')).toHaveCount(1);

  // Personalizar: back to the persona's portrait.
  await page.goto(`${agentUrl}?tab=customize`, { waitUntil: "networkidle" });
  await page.getByTestId("agent-image-remove").click();
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page.getByText("Guardado")).toBeVisible();
  await page.goto("/agents", { waitUntil: "networkidle" });
  await expect(page.locator('img[src^="data:image/"]')).toHaveCount(0);
});
