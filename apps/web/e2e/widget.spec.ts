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

  // Light by default, even on a dark device.
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(`/embed/${widgetId}`);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(`${agentUrl}?tab=publish`, { waitUntil: "networkidle" });

  // Left side + one-tone halo + dark chat, saved.
  await page.getByRole("radio", { name: "Izquierda" }).click();
  await page.getByRole("radio", { name: "Oscuro" }).click();
  await page.getByRole("radio", { name: "Un tono" }).click();
  await page.getByRole("radio", { name: "Pastel" }).click();
  await page.locator("#widget-size").fill("88");
  await page.getByTestId("widget-save").click();
  await expect(page.getByRole("status")).toHaveText("Guardado");

  // A customer's site: another origin (127.0.0.1 vs localhost) with the snippet pasted in.
  // A real page of ours on that origin, since Chrome blocks routed "public" pages from
  // loading loopback resources.
  const customerSite = `${baseURL!.replace("localhost", "127.0.0.1")}/privacidad`;
  const openCustomerSite = async (target: typeof page) => {
    await target.goto(customerSite);
    await target.evaluate(
      ({ src, id }) => {
        const s = document.createElement("script");
        s.src = src;
        s.async = true;
        s.setAttribute("data-agent", id);
        document.body.appendChild(s);
      },
      { src: `${baseURL}/widget.js`, id: widgetId },
    );
  };
  await openCustomerSite(page);
  const launcher = page.getByRole("button", { name: /Chat con Mateo/ });
  await expect(launcher).toBeVisible();
  const box = (await launcher.boundingBox())!;
  expect(box.x).toBeLessThan(200); // left side
  expect(Math.round(box.width)).toBe(88); // chosen size
  await launcher.click();
  const frame = page.frameLocator('iframe[title="Mateo"]');
  await expect(frame.getByPlaceholder("Escribe un mensaje…")).toBeVisible();
  await expect(frame.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(frame.getByRole("link", { name: "OlaBrain" })).toHaveAttribute(
    "href",
    "https://www.olabrain.com",
  );
  await expect(frame.getByText("Agente IA by")).toBeVisible();

  // The thread survives minimizing and a reload, and stays in this tab only.
  const sent: { conversationId?: string | null }[] = [];
  await page.context().route(`**/api/widget/${widgetId}/chat`, (route) => {
    sent.push(route.request().postDataJSON());
    return route.fulfill({
      contentType: "text/event-stream",
      body: `data: {"type":"conversation","id":"c-1"}\n\ndata: {"type":"delta","text":"Respuesta guardada"}\n\n`,
    });
  });
  // Retried: the panel's input is visible before it hydrates, and Enter then does nothing.
  const say = (text: string) =>
    expect(async () => {
      const input = frame.getByPlaceholder("Escribe un mensaje…");
      await input.fill(text);
      await input.press("Enter");
      await expect(input).toHaveValue("", { timeout: 1000 });
    }).toPass();
  await say("Mensaje guardado");
  await expect(frame.getByText("Respuesta guardada")).toBeVisible();
  await frame.getByRole("button", { name: "Cerrar" }).click();
  await expect(page.locator("[data-olabrain] .panel")).not.toHaveClass(/open/);
  await launcher.click();
  await expect(frame.getByText("Respuesta guardada")).toBeVisible();

  await openCustomerSite(page);
  await launcher.click();
  await expect(frame.getByText("Mensaje guardado")).toBeVisible();
  await expect(frame.getByText("Respuesta guardada")).toBeVisible();
  await say("Otro mensaje");
  await expect.poll(() => sent.at(-1)?.conversationId).toBe("c-1");

  const otherTab = await page.context().newPage();
  await openCustomerSite(otherTab);
  await otherTab.getByRole("button", { name: /Chat con Mateo/ }).click();
  const otherFrame = otherTab.frameLocator('iframe[title="Mateo"]');
  await expect(otherFrame.getByPlaceholder("Escribe un mensaje…")).toBeVisible();
  await expect(otherFrame.getByText("Mensaje guardado")).toHaveCount(0);
  await otherTab.close();

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
