import { expect, test } from "@playwright/test";
import { signUpAndCreateOrg } from "./helpers";

// Phone layout: only the last two messages show, so a download link would scroll away.
test.use({ viewport: { width: 390, height: 844 } });

function sse(events: object[]) {
  return events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
}

test("a download link stays pinned above the messages for a few seconds", async ({ page }) => {
  test.setTimeout(90_000);
  await signUpAndCreateOrg(page, `Pin ${Date.now()}`);
  await page.goto("/agents/new", { waitUntil: "networkidle" });
  await page.getByRole("radio", { name: /Teo/ }).click();
  await page.getByLabel("Nombre del agente").fill("Teo");
  await page.getByRole("button", { name: "Crear agente" }).click();
  await expect(page).toHaveURL(/\/agents\/[0-9a-f-]{36}$/);

  // The chat stream is faked: the first reply carries an invoice PDF, the rest are text.
  let turn = 0;
  await page.route("**/api/agents/*/chat", (route) => {
    turn += 1;
    const events: object[] = [
      { type: "conversation", id: "00000000-0000-4000-8000-000000000001" },
      { type: "delta", text: `Respuesta ${turn}` },
    ];
    if (turn === 1)
      events.push({ type: "file", label: "Factura CDIN-1", url: "https://example.test/f.pdf" });
    events.push({ type: "done", firstTokenMs: 1, totalMs: 2 });
    return route.fulfill({ status: 200, contentType: "text/event-stream", body: sse(events) });
  });

  const input = page.getByPlaceholder("Escribe un mensaje…");
  for (const text of ["pdf de la factura", "gracias", "otra cosa"]) {
    await input.fill(text);
    await page.getByRole("button", { name: "Enviar" }).click();
    await expect(page.getByTestId("chat-log")).toContainText(`Respuesta ${turn}`);
  }

  // The reply with the link is no longer among the last two, but the link is pinned.
  const pinned = page.getByTestId("pinned-files");
  await expect(pinned.getByRole("link", { name: /Factura CDIN-1/ })).toBeVisible();
  await expect(pinned).toBeHidden({ timeout: 12_000 });
});
