import { createServer, type Server } from "node:net";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkSmtp, executeSmtpTool } from "../src/adapters/native/smtp";
import type { CapturedContact } from "../src/adapters/native/types";

type Mail = { from: string; to: string[]; data: string };

/** Minimal SMTP server (plain, no auth): records every message it receives. */
function fakeSmtp() {
  const mails: Mail[] = [];
  const server: Server = createServer((socket) => {
    let mail: Mail = { from: "", to: [], data: "" };
    let inData = false;
    let buffer = "";
    socket.write("220 fake ESMTP\r\n");
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      let idx: number;
      while ((idx = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (inData) {
          if (line === ".") {
            inData = false;
            mails.push(mail);
            mail = { from: "", to: [], data: "" };
            socket.write("250 queued\r\n");
          } else mail.data += `${line}\n`;
          continue;
        }
        const cmd = line.toUpperCase();
        if (cmd.startsWith("EHLO") || cmd.startsWith("HELO")) socket.write("250 fake\r\n");
        else if (cmd.startsWith("MAIL FROM")) {
          mail.from = line;
          socket.write("250 ok\r\n");
        } else if (cmd.startsWith("RCPT TO")) {
          mail.to.push(/<([^>]+)>/.exec(line)?.[1] ?? line);
          socket.write("250 ok\r\n");
        } else if (cmd === "DATA") {
          inData = true;
          socket.write("354 go\r\n");
        } else if (cmd === "QUIT") {
          socket.end("221 bye\r\n");
        } else socket.write("250 ok\r\n");
      }
    });
  });
  return { server, mails };
}

const smtp = fakeSmtp();
let port = 0;
const saved: CapturedContact[] = [];

function ctx(recipients = ["ventas@acme.es", "luis@acme.es"]) {
  return {
    config: {
      provider: "smtp",
      host: "127.0.0.1",
      port,
      from: "Web <avisos@acme.es>",
      recipients,
    },
    secret: {},
    saveSecret: async () => undefined,
    fetcher: {} as never,
    timeoutMs: 5_000,
    maxBytes: 100_000,
    egressPolicy: { allowedPrivateHosts: ["127.0.0.1"] },
    saveContact: async (c: CapturedContact) => {
      saved.push(c);
      return { contactId: "c1" };
    },
  };
}

beforeAll(async () => {
  await new Promise<void>((resolve) => smtp.server.listen(0, "127.0.0.1", resolve));
  port = (smtp.server.address() as AddressInfo).port;
});
afterAll(() => {
  smtp.server.close();
});

describe("SMTP connector", () => {
  it("verifies the server when connecting", async () => {
    await expect(checkSmtp(ctx())).resolves.toBeUndefined();
  });

  it("notifies a lead to the configured recipients and saves the contact", async () => {
    const res = await executeSmtpTool(ctx(), "email_aviso_contacto", {
      nombre: "Luis Sánchez",
      email: "luis@cliente.es",
      empresa: "Cliente SL",
      mensaje: "Quiere alojar 5 servidores en un rack",
      apreciaciones: "Interés alto; presupuesto aprobado",
    });
    expect(res.ok).toBe(true);
    const mail = smtp.mails.at(-1)!;
    expect(mail.to.sort()).toEqual(["luis@acme.es", "ventas@acme.es"]);
    expect(mail.data).toContain("Reply-To: luis@cliente.es");
    expect(mail.data).toContain("Quiere alojar 5 servidores en un rack");
    expect(mail.data).toContain("Apreciaciones del agente:");
    expect(mail.data).toContain("Inter=C3=A9s alto; presupuesto aprobado");
    expect(saved.at(-1)).toMatchObject({
      name: "Luis Sánchez",
      email: "luis@cliente.es",
      company: "Cliente SL",
      request: "Quiere alojar 5 servidores en un rack",
      agentNotes: "Interés alto; presupuesto aprobado",
      notes: ["Empresa: Cliente SL", "Pide: Quiere alojar 5 servidores en un rack"],
    });
  });

  it("asks for an email or a phone before notifying", async () => {
    await expect(
      executeSmtpTool(ctx(), "email_aviso_contacto", { nombre: "Ana", mensaje: "Hola" }),
    ).rejects.toThrow("email o un teléfono");
  });

  it("never writes to addresses outside the connection", async () => {
    const before = smtp.mails.length;
    await expect(
      executeSmtpTool(ctx(), "email_enviar", {
        asunto: "Spam",
        mensaje: "...",
        para: "victima@otro.com",
      }),
    ).rejects.toThrow("solo puedo enviar a los destinatarios configurados");
    expect(smtp.mails.length).toBe(before);
    await executeSmtpTool(ctx(), "email_enviar", {
      asunto: "Resumen",
      mensaje: "Hoy 3 visitas",
      para: "VENTAS@acme.es",
    });
    expect(smtp.mails.at(-1)!.to).toEqual(["ventas@acme.es"]);
  });

  it("refuses private hosts that are not allowlisted (egress policy)", async () => {
    const c = { ...ctx(), egressPolicy: { allowedPrivateHosts: [] } };
    await expect(checkSmtp(c)).rejects.toThrow(/no se puede usar el servidor/);
  });
});
