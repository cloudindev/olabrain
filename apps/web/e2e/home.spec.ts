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
