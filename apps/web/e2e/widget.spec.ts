import { expect, test } from "@playwright/test";
import { signUpAndCreateOrg } from "./helpers";

test("publish an agent as a web widget and open it from another site", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(120_000);
  await signUpAndCreateOrg(page, `Widget ${Date.now()}`);
  await page.goto("/agents/new", { waitUntil: "networkidle" });
  await page.getByRole("radio", { name: /Mateo/ }).click();
  await page.getByRole("button", { name: "Crear agente" }).click();
  await expect(page).toHaveURL(/\/agents\/[0-9a-f-]{36}$/);
  const agentUrl = page.url();

  await page.goto(`${agentUrl}?tab=publish`, { waitUntil: "networkidle" });
  await page.getByTestId("widget-create").click();
  const snippet = page.getByTestId("widget-snippet");
  await expect(snippet).toContainText("widget.js");
  const widgetId = /data-agent="([0-9a-f-]{36})"/.exec((await snippet.textContent())!)![1]!;

  // Left side + one-tone halo, saved.
  await page.getByRole("radio", { name: "Izquierda" }).click();
  await page.getByRole("radio", { name: "Un tono" }).click();
  await page.getByTestId("widget-save").click();
  await expect(page.getByRole("status")).toHaveText("Guardado");

  // A customer's site: another origin (127.0.0.1 vs localhost) with the snippet pasted in.
  // A real page of ours on that origin, since Chrome blocks routed "public" pages from
  // loading loopback resources.
  await page.goto(`${baseURL!.replace("localhost", "127.0.0.1")}/privacidad`);
  await page.evaluate(
    ({ src, id }) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.setAttribute("data-agent", id);
      document.body.appendChild(s);
    },
    { src: `${baseURL}/widget.js`, id: widgetId },
  );
  const launcher = page.getByRole("button", { name: /Chat con Mateo/ });
  await expect(launcher).toBeVisible();
  const box = (await launcher.boundingBox())!;
  expect(box.x).toBeLessThan(200); // left side
  await launcher.click();
  const frame = page.frameLocator('iframe[title="Mateo"]');
  await expect(frame.getByPlaceholder("Escribe un mensaje…")).toBeVisible();
  await expect(frame.getByText("Agente de inteligencia artificial")).toBeVisible();

  // Only listed domains may frame it once the list is set.
  const res = await page.request.get(`/embed/${widgetId}`);
  expect(res.headers()["content-security-policy"]).toBe("frame-ancestors *");
  // The chat API refuses requests from other origins.
  const foreign = await page.request.post(`/api/widget/${widgetId}/chat`, {
    headers: { origin: "https://cliente.example" },
    data: { message: "hola" },
  });
  expect(foreign.status()).toBe(403);
});
