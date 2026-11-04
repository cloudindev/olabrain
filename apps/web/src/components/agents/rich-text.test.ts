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

  it("draws Markdown tables with header, alignment and escaped pipes", () => {
    const out = html(
      "**Top 10**\n\n| # | Cliente | Órdenes |\n|---|---|---:|\n| 1 | **FCC Aqualia** | 142 |\n| 2 | A \\| B | 55 |\n\nFin",
    );
    expect(out).toContain('<div class="max-w-full overflow-x-auto rounded-xl border');
    expect(out).toContain('<th class="px-2.5 py-2 font-semibold sm:px-3 text-left">Cliente</th>');
    expect(out).toContain('<th class="px-2.5 py-2 font-semibold sm:px-3 text-right">Órdenes</th>');
    expect(out).toContain(
      '<td class="px-2.5 py-2 align-top sm:px-3 whitespace-nowrap text-left"><strong>FCC Aqualia</strong></td>',
    );
    expect(out).toContain(">A | B</td>");
    expect(out).toContain('text-right">142</td>');
    expect(out).not.toContain("---");
    expect(out).toContain("<p>Fin</p>");
  });

  it("keeps a lone pipe line as text and tolerates a row still streaming", () => {
    expect(html("a | b\n| solo |")).not.toContain("<table");
    const out = html("| a | b |\n|---|---|\n| 1 | 2");
    expect(out).toContain("<table");
    expect(out).toContain(">2</td>");
  });

  it("never injects HTML from a table cell", () => {
    expect(html("| x |\n|---|\n| <script>alert(1)</script> |")).toContain("&lt;script&gt;");
  });
});
