import { expect, test, type Page } from "@playwright/test";
import { signUpAndCreateOrg } from "./helpers";

const activeOrg = (page: Page) => page.getByTestId("org-switcher").locator("option:checked");

test("a member of several organizations can switch the active one", async ({ page, baseURL }) => {
  await signUpAndCreateOrg(page, "Primera SL");
  const res = await page.request.post("/api/auth/organization/create", {
    data: { name: "Segunda SL", slug: `segunda-${Date.now()}` },
    headers: { origin: baseURL! },
  });
  expect(res.ok()).toBe(true);

  await page.goto("/agents", { waitUntil: "networkidle" });
  const switcher = page.getByTestId("org-switcher");
  await expect(switcher.locator("option")).toHaveText(["Primera SL", "Segunda SL"]);
  const before = (await activeOrg(page).textContent())?.trim();
  const other = before === "Segunda SL" ? "Primera SL" : "Segunda SL";

  // From the navbar selector.
  await switcher.selectOption({ label: other });
  await expect(page).toHaveURL(/\/agents$/);
  await expect.poll(async () => (await activeOrg(page).textContent())?.trim()).toBe(other);
  await page.reload({ waitUntil: "networkidle" });
  await expect(activeOrg(page)).toHaveText(other);

  // And back from the user menu.
  await page.getByTestId("user-menu-button").click();
  await page.getByRole("menuitemradio").filter({ hasText: before! }).click();
  await expect.poll(async () => (await activeOrg(page).textContent())?.trim()).toBe(before);
});
