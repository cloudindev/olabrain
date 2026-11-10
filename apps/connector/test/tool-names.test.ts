import { describe, expect, it } from "vitest";
import { disambiguateToolNames } from "../src/router";

const row = (id: string, name: string, connectionName: string) => ({
  id,
  name,
  description: "Busca clientes.",
  connectionName,
});

describe("tool names with two connections of the same kind", () => {
  it("keeps unique names and suffixes repeated ones with their connection", () => {
    const out = disambiguateToolNames([
      row("a1", "buscar_cliente", "ProfiECO Coverde"),
      row("b1", "buscar_cliente", "ProfiECO Contem"),
      row("a2", "servicios", "ProfiECO Coverde"),
    ]);
    expect(out.map((t) => t.name)).toEqual([
      "buscar_cliente_profieco_coverde",
      "buscar_cliente_profieco_contem",
      "servicios",
    ]);
    expect(out[1]!.description).toBe("[Conexión «ProfiECO Contem»] Busca clientes.");
    expect(out[2]!.description).toBe("Busca clientes.");
    expect(new Set(out.map((t) => t.name)).size).toBe(out.length);
  });

  it("stays unique with equal connection names, accents and long names", () => {
    const long = "x".repeat(60);
    const out = disambiguateToolNames([
      row("aaaaaa11", long, "Señal"),
      row("bbbbbb22", long, "Señal"),
    ]);
    const names = out.map((t) => t.name);
    expect(new Set(names).size).toBe(2);
    for (const n of names) {
      expect(n.length).toBeLessThanOrEqual(64);
      expect(n).toMatch(/^[a-zA-Z0-9_-]+$/);
    }
  });
});
