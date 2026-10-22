import { expect, test } from "@playwright/test";

test("public home shows the agent and guards the voice endpoint", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("automatiza");
  await expect(page.getByRole("heading", { name: "Habla con Alba" })).toBeVisible();
  await expect(page.getByTestId("home-start")).toBeEnabled();
  await expect(page.locator('video[src="/alba/idle.mp4"]')).toHaveCount(1);
  await expect(page.getByText("agente de inteligencia artificial")).toBeVisible();

  // Other sites (or scripts without an Origin) can't start calls on our account.
  expect((await request.post("/api/public/voice")).status()).toBe(403);
  const foreign = await request.post("/api/public/voice", {
    headers: { origin: "https://evil.example" },
  });
  expect(foreign.status()).toBe(403);
});

test("legal pages are public and linked from the home footer", async ({ page }) => {
  await page.goto("/");
  for (const [link, heading] of [
    ["Aviso legal", "Aviso legal"],
    ["Política de privacidad", "Política de privacidad"],
    ["Política de cookies", "Política de cookies"],
  ]) {
    await page.locator("footer").getByRole("link", { name: link }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
  }
  await page.goto("/privacidad");
  await expect(page.getByText("auth/drive.file")).toBeVisible();
});
