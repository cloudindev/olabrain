import { expect, test } from "@playwright/test";
import { signUpAndCreateOrg } from "./helpers";

test("a new organization gets the signup credit, shown in the header and Balance", async ({
  page,
}) => {
  await signUpAndCreateOrg(page, `Saldo ${Date.now()}`);
  const pill = page.getByTestId("balance-pill");
  await expect(pill).toContainText("0,42");
  await pill.click();
  await expect(page).toHaveURL(/\/billing$/);
  await expect(page.getByTestId("billing-balance")).toContainText("0,42");
  await expect(page.getByTestId("billing-ledger")).toContainText("Saldo de bienvenida");
  await expect(page.getByText("Minuto de voz", { exact: true })).toBeVisible();
});

test("an admin tops up through Stripe Checkout", async ({ page }) => {
  // Needs Stripe keys (ideally test mode) in the server's environment.
  test.skip(!process.env.E2E_STRIPE, "set E2E_STRIPE=1 with STRIPE_SECRET_KEY configured");
  test.setTimeout(120_000);
  await signUpAndCreateOrg(page, `Recarga ${Date.now()}`);
  await page.goto("/billing", { waitUntil: "networkidle" });
  await page.getByRole("radio", { name: /50/ }).click();
  await expect(page.getByTestId("topup-submit")).toHaveText(/Recargar 50/);
  await page.getByTestId("topup-submit").click();
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30_000 });
});
