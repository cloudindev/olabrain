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
