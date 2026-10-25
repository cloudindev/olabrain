import { expect, test } from "@playwright/test";
import { signUpAndCreateOrg } from "./helpers";

// Leads come from web-widget conversations (the LLM calls email_aviso_contacto); their
// capture is covered by the connector tests. Here: the page is protected and starts empty.
test("leads page starts empty for a new organization", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/leads");
  await expect(page).toHaveURL(/\/login/);

  await signUpAndCreateOrg(page, "Leads SL");
  await page.goto("/leads");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Leads");
  await expect(page.getByTestId("leads-empty")).toContainText("Todavía no hay leads");

  // A lead of another organization (or a made-up id) is not found.
  // (Streamed pages answer 200, so check the not-found page itself.)
  await page.goto("/leads/00000000-0000-4000-8000-000000000000");
  await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
});
