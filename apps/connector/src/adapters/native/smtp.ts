/**
 * Email through the customer's SMTP server. The connection fixes the recipients: tools
 * (also used by anonymous web-widget visitors) can only write to them, so the agent can't
 * be turned into a spam relay. The host goes through the egress policy (no private
 * networks unless allowlisted) and we connect to the resolved IP (no DNS rebinding).
 */
import nodemailer from "nodemailer";
import { resolveDbHost } from "../sql";
import {
  NativeToolError,
  schema,
  str,
  type NativeCallContext,
  type NativeResult,
  type NativeToolDef,
} from "./types";

export type SmtpConfig = {
  provider: "smtp";
  host: string;
  port: number;
  from: string;
  recipients: string[];
};
type SmtpSecret = { user?: string; password?: string };

const TOOLS: NativeToolDef[] = [
  {
    name: "email_aviso_contacto",
    description:
      "Avisa por email a la empresa de una persona que quiere que la contacten (p. ej. un visitante de la web) y la guarda en Contactos. Úsala en cuanto tengas su nombre, un email o un teléfono y lo que necesita. Envía siempre a los destinatarios configurados.",
    inputSchema: schema(
      {
        nombre: str("Nombre y apellidos"),
        email: str("Email de la persona"),
        telefono: str("Teléfono de la persona"),
        empresa: str("Empresa, si la dice"),
        mensaje: str("Qué necesita o pide, resumido"),
      },
      ["nombre", "mensaje"],
    ),
    mode: "write",
    autoConfirm: true,
  },
  {
    name: "email_enviar",
    description:
      "Envía un email a la empresa (solo a los destinatarios configurados en la conexión), p. ej. un resumen o un aviso.",
    inputSchema: schema(
      {
        asunto: str("Asunto"),
        mensaje: str("Texto del email"),
        para: str("Destinatario: uno de los configurados (por defecto, todos)"),
      },
      ["asunto", "mensaje"],
    ),
    mode: "write",
    autoConfirm: true,
  },
];

export const SMTP_TOOLS = TOOLS;

/** One transport per call, to the IP the egress policy approved (TLS checks the name). */
async function transport(ctx: NativeCallContext) {
  const cfg = ctx.config as SmtpConfig;
  const secret = ctx.secret as SmtpSecret;
  if (!ctx.egressPolicy) throw new NativeToolError("política de salida no configurada");
  const ip = await resolveDbHost(cfg.host, ctx.egressPolicy).catch((e: Error) => {
    throw new NativeToolError(`no se puede usar el servidor ${cfg.host}: ${e.message}`);
  });
  return nodemailer.createTransport({
    host: ip,
    port: cfg.port,
    secure: cfg.port === 465,
    requireTLS: cfg.port === 587,
    tls: { servername: cfg.host },
    auth: secret.user ? { user: secret.user, pass: secret.password ?? "" } : undefined,
    connectionTimeout: Math.min(ctx.timeoutMs, 15_000),
    greetingTimeout: Math.min(ctx.timeoutMs, 15_000),
    socketTimeout: Math.min(ctx.timeoutMs, 20_000),
  });
}

async function send(
  ctx: NativeCallContext,
  to: string[],
  subject: string,
  text: string,
  replyTo?: string,
) {
  const cfg = ctx.config as SmtpConfig;
  const t = await transport(ctx);
  try {
    const info = await t.sendMail({ from: cfg.from, to, subject, text, replyTo });
    return { enviado: true, destinatarios: to, id: info.messageId };
  } catch (e) {
    throw new NativeToolError(`el servidor de correo rechazó el envío: ${(e as Error).message}`);
  } finally {
    t.close();
  }
}

const clean = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 2000) : "");

export async function executeSmtpTool(
  ctx: NativeCallContext,
  toolName: string,
  args: Record<string, unknown>,
): Promise<NativeResult> {
  const cfg = ctx.config as SmtpConfig;
  const recipients = cfg.recipients ?? [];
  if (!recipients.length) throw new NativeToolError("la conexión no tiene destinatarios");

  if (toolName === "email_aviso_contacto") {
    const nombre = clean(args.nombre);
    const email = clean(args.email);
    const telefono = clean(args.telefono);
    const empresa = clean(args.empresa);
    const mensaje = clean(args.mensaje);
    if (!email && !telefono)
      throw new NativeToolError("pide un email o un teléfono antes de avisar");
    // Contacts first: the lead is never lost even if the email fails.
    const saved = ctx.saveContact
      ? await ctx.saveContact({
          name: nombre,
          email: email || undefined,
          phone: telefono || undefined,
          notes: [empresa && `Empresa: ${empresa}`, mensaje && `Pide: ${mensaje}`].filter(
            (n): n is string => Boolean(n),
          ),
        })
      : null;
    const body = [
      "Nuevo contacto recogido por tu agente de OlaBrain:",
      "",
      `Nombre: ${nombre}`,
      email && `Email: ${email}`,
      telefono && `Teléfono: ${telefono}`,
      empresa && `Empresa: ${empresa}`,
      "",
      "Qué necesita:",
      mensaje,
    ]
      .filter((l) => l !== "")
      .join("\n");
    const result = await send(
      ctx,
      recipients,
      `Nuevo contacto: ${nombre}${empresa ? ` (${empresa})` : ""}`,
      body,
      email || undefined,
    );
    return { ok: true, truncated: false, data: { ...result, contacto_guardado: Boolean(saved) } };
  }

  if (toolName === "email_enviar") {
    const para = clean(args.para).toLowerCase();
    const to = para ? recipients.filter((r) => r.toLowerCase() === para) : recipients;
    if (!to.length)
      throw new NativeToolError(
        `solo puedo enviar a los destinatarios configurados: ${recipients.join(", ")}`,
      );
    const result = await send(ctx, to, clean(args.asunto) || "Aviso", clean(args.mensaje));
    return { ok: true, truncated: false, data: result };
  }

  throw new NativeToolError(`herramienta de email desconocida: ${toolName}`);
}

/** Checks host, port and credentials when connecting (SMTP handshake, no email sent). */
export async function checkSmtp(ctx: NativeCallContext): Promise<void> {
  const t = await transport(ctx);
  try {
    await t.verify();
  } catch (e) {
    throw new NativeToolError(`no se pudo conectar al servidor de correo: ${(e as Error).message}`);
  } finally {
    t.close();
  }
}
