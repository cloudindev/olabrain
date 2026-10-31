import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { config } from "dotenv";
import { signUpAndCreateOrg } from "./helpers";

// The admin URL (owner role) to empty the wallet.
config({ path: new URL("../../../.env", import.meta.url).pathname, quiet: true });

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

test("without balance the agent's chat links to Balance; the user menu stays above the chat", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const org = `Sin saldo ${Date.now()}`;
  await signUpAndCreateOrg(page, org);
  await page.goto("/agents/new", { waitUntil: "networkidle" });
  await page.getByRole("radio", { name: /Mateo/ }).click();
  await page.getByRole("button", { name: "Crear agente" }).click();
  await expect(page).toHaveURL(/\/agents\/[0-9a-f-]{36}$/);
  const agentUrl = page.url();

  // The menu opens over the chat panel: its items can be clicked.
  await page.getByRole("button", { name: /Ana Prueba/ }).click();
  await page.getByRole("menuitem", { name: "Cerrar sesión" }).click({ trial: true });
  await page.keyboard.press("Escape");

  execFileSync("psql", [
    process.env.DATABASE_URL_ADMIN!,
    "-X",
    "-q",
    "-c",
    `update wallets set balance_eur = 0 where tenant_id = (select id from tenants where name = '${org}')`,
  ]);
  await page.goto(agentUrl, { waitUntil: "networkidle" });
  const input = page.getByPlaceholder("Escribe un mensaje…");
  await input.fill("Hola");
  await input.press("Enter");
  await page.getByRole("link", { name: /Te has quedado sin saldo/ }).click();
  await expect(page).toHaveURL(/\/billing$/);
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
