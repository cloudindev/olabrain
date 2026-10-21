import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RichText } from "./rich-text";

const html = (text: string) => renderToStaticMarkup(createElement(RichText, { text }));

describe("RichText", () => {
  it("renders lists, bold and code from model Markdown", () => {
    const out = html("Hoy hay 2 partes:\n\n- **Hotel Prado**: cerrado\n- `PT-12` pendiente");
    expect(out).toContain("<p>Hoy hay 2 partes:</p>");
    expect(out).toContain('<ul class="list-disc pl-5">');
    expect(out).toContain("<strong>Hotel Prado</strong>");
    expect(out).toContain(">PT-12</code>");
  });

  it("numbered lists and line breaks", () => {
    const out = html("Pasos:\nuno\n1. Abrir\n2. Cerrar");
    expect(out).toContain("<p>Pasos:<br/>uno</p>");
    expect(out).toContain('<ol class="list-decimal pl-5">');
  });

  it("never injects HTML from the model", () => {
    const out = html('<img src=x onerror="alert(1)"> **<b>hola</b>**');
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
    expect(out).toContain("<strong>&lt;b&gt;hola&lt;/b&gt;</strong>");
  });
});
