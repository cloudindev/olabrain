import { expect, test } from "@playwright/test";
import { signUpAndCreateOrg } from "./helpers";

test("a member of several organizations can switch the active one", async ({ page, baseURL }) => {
  await signUpAndCreateOrg(page, "Primera SL");
  const res = await page.request.post("/api/auth/organization/create", {
    data: { name: "Segunda SL", slug: `segunda-${Date.now()}` },
    headers: { origin: baseURL! },
  });
  expect(res.ok()).toBe(true);

  await page.goto("/agents", { waitUntil: "networkidle" });
  const tenant = page.getByTestId("tenant-name");
  const before = (await tenant.textContent())?.trim();
  const target = before === "Segunda SL" ? "Primera SL" : "Segunda SL";

  await page.getByTestId("user-menu-button").click();
  const orgs = page.getByRole("menuitemradio");
  await expect(orgs).toHaveText(["Primera SL", "Segunda SL"]);
  await orgs.filter({ hasText: target }).click();

  await expect(page).toHaveURL(/\/agents$/);
  await expect(tenant).toHaveText(target);
  await page.reload({ waitUntil: "networkidle" });
  await expect(tenant).toHaveText(target);
});
