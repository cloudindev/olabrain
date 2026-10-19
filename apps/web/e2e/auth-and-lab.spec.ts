import { expect, test } from "@playwright/test";
import { signUpAndCreateOrg } from "./helpers";

test("sign up → create organization → lab session token and metrics", async ({ page }) => {
  await signUpAndCreateOrg(page, "Peluquería Núñez");
  await page.goto("/lab");
  await expect(page.getByRole("heading", { name: "Laboratorio de voz" })).toBeVisible();

  const tokenResponse = await page.request.post("/api/lab/token", {
    data: { config: { tts: { provider: "cartesia" } } },
  });
  expect(tokenResponse.status()).toBe(200);
  const session = await tokenResponse.json();
  expect(session.token).toMatch(/^ey/);
  expect(session.roomName).toBe(`lab-${session.conversationId}`);

  const metricsResponse = await page.request.post("/api/lab/metrics", {
    data: {
      conversationId: session.conversationId,
      turn: 1,
      connMs: 800,
      eotMs: 420,
      firstTokenMs: 380,
      firstAudioMs: 1150,
      breakdown: { tts_ttfb_ms: 160 },
    },
  });
  expect(metricsResponse.status()).toBe(200);
});

test("lab API rejects anonymous requests and invalid config", async ({ page, request }) => {
  const anonymous = await request.post("/api/lab/token", { data: {} });
  expect(anonymous.status()).toBe(401);

  await signUpAndCreateOrg(page, "Taller Ruiz");
  const invalid = await page.request.post("/api/lab/token", {
    data: { config: { mode: "avatar" } },
  });
  expect(invalid.status()).toBe(400);
});

test("a tenant cannot write metrics into another tenant's conversation", async ({ browser }) => {
  const contextA = await browser.newContext();
  const pageA = await contextA.newPage();
  await signUpAndCreateOrg(pageA, "Empresa A");
  const { conversationId } = await (
    await pageA.request.post("/api/lab/token", { data: {} })
  ).json();

  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  await signUpAndCreateOrg(pageB, "Empresa B");
  const attack = await pageB.request.post("/api/lab/metrics", {
    data: { conversationId, turn: 1, connMs: null, eotMs: 1, firstTokenMs: 1, firstAudioMs: 1 },
  });
  expect(attack.status()).toBe(404);

  await contextA.close();
  await contextB.close();
});

test("unauthenticated visitors are sent to login", async ({ page }) => {
  await page.goto("/lab");
  await expect(page).toHaveURL(/\/login\?next=%2Flab$/);
  await expect(page.getByRole("heading", { name: "Entra en BrainAgent" })).toBeVisible();
});
