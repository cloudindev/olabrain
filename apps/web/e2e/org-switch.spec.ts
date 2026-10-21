import { expect, test } from "@playwright/test";
import { signUpAndCreateOrg } from "./helpers";

test("a member of several organizations can switch the active one", async ({ page, baseURL }) => {
  await signUpAndCreateOrg(page, "Primera SL");
  const res = await page.request.post("/api/auth/organization/create", {
    data: { name: "Segunda SL", slug: `segunda-${Date.now()}` },
    headers: { origin: baseURL! },
  });
  expect(res.ok()).toBe(true);
  const second = ((await res.json()) as { id: string }).id;

  await page.goto("/agents", { waitUntil: "networkidle" });
  const switcher = page.getByTestId("tenant-name");
  await expect(switcher.locator("option")).toHaveText(["Primera SL", "Segunda SL"]);

  const target = (await switcher.inputValue()) === second ? "Primera SL" : "Segunda SL";
  await switcher.selectOption({ label: target });
  await expect(page).toHaveURL(/\/agents$/);
  await expect
    .poll(async () => (await switcher.locator("option:checked").textContent())?.trim())
    .toBe(target);
  await page.reload({ waitUntil: "networkidle" });
  await expect(switcher.locator("option:checked")).toHaveText(target);
});
