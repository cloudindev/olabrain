import { describe, expect, it } from "vitest";
import { redactSecrets, toToolName, toolNameSchema } from "./tools";

describe("toToolName", () => {
  it.each([
    ["getPartesHoy", "get_partes_hoy"],
    ["GET /v1/servers/{id}", "get_v1_servers_id"],
    ["Listar facturas pendientes", "listar_facturas_pendientes"],
    ["123-start", "t_123_start"],
    ["añadir línea", "anadir_linea"],
    ["___", "tool"],
  ])("%s → %s", (raw, expected) => {
    const name = toToolName(raw);
    expect(name).toBe(expected);
    expect(toolNameSchema.safeParse(name).success).toBe(true);
  });

  it("caps the length at 64 characters", () => {
    expect(toToolName("a".repeat(100))).toHaveLength(64);
  });
});

describe("redactSecrets", () => {
  it("redacts secret-looking keys at any depth", () => {
    expect(
      redactSecrets({
        user: "ana",
        password: "x",
        nested: { apiKey: "k", headers: { Authorization: "Bearer t" }, list: [{ token: "t" }] },
      }),
    ).toEqual({
      user: "ana",
      password: "[redacted]",
      nested: {
        apiKey: "[redacted]",
        headers: { Authorization: "[redacted]" },
        list: [{ token: "[redacted]" }],
      },
    });
  });
});

describe("redactSecrets: payment data", () => {
  it("hides IBAN, account and card numbers", () => {
    expect(
      redactSecrets({ clientid: 7, iban: "ES91…", cuenta_bancaria: "123", card_number: "4111" }),
    ).toEqual({
      clientid: 7,
      iban: "[redacted]",
      cuenta_bancaria: "[redacted]",
      card_number: "[redacted]",
    });
  });
});
