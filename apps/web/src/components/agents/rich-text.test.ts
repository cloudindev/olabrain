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

  it("shows fenced code as an escaped, scrollable block", () => {
    const out = html(
      'Aquí va:\n```html\n<footer class="py-24">\n  - no es lista\n</footer>\n```\nFin',
    );
    expect(out).toContain("<pre");
    expect(out).toContain("overflow-auto");
    expect(out).toContain(
      "&lt;footer class=&quot;py-24&quot;&gt;\n  - no es lista\n&lt;/footer&gt;</pre>",
    );
    expect(out).not.toContain("<ul");
    expect(out).toContain("<p>Fin</p>");
  });

  it("never injects HTML from the model", () => {
    const out = html('<img src=x onerror="alert(1)"> **<b>hola</b>**');
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
    expect(out).toContain("<strong>&lt;b&gt;hola&lt;/b&gt;</strong>");
  });

  it("renders markdown and bare https links, never javascript: ones", () => {
    const out = html(
      "[Descargar factura](https://app.olabrain.com/api/files?k=a&s=b) o https://x.es/f.pdf.",
    );
    expect(out).toContain(
      '<a href="https://app.olabrain.com/api/files?k=a&amp;s=b" target="_blank" rel="noopener noreferrer"',
    );
    expect(out).toContain(">Descargar factura</a>");
    expect(out).toContain('href="https://x.es/f.pdf"');
    expect(out).toContain("</a>.");
    expect(html("[x](javascript:alert(1))")).not.toContain("<a");
  });
});
