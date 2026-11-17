import "server-only";
import sharp from "sharp";
import type { EmailExtras } from "./email";

const LOGO_CID = "org-logo@olabrain";
const DATA_URL = /^data:image\/(png|webp|jpeg);base64,([A-Za-z0-9+/]+=*)$/;

export type InvitationEmail = {
  orgName: string;
  orgLogo: string | null;
  agentName: string;
  personName: string;
  email: string;
  url: string;
};

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The organization's logo as an inline PNG attachment. Email clients block data: URLs
 * and Outlook desktop cannot show WebP, so it is converted and referenced by cid.
 * Null (header falls back to the name) when there is no logo or it cannot be decoded.
 */
async function logoAttachment(
  logo: string | null,
): Promise<{ png: Buffer; width: number; height: number } | null> {
  const match = logo ? DATA_URL.exec(logo) : null;
  if (!match) return null;
  try {
    const { data, info } = await sharp(Buffer.from(match[2]!, "base64"))
      .resize({ width: 400, height: 120, fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer({ resolveWithObject: true });
    // Shown at half size: sharp on high-density screens. At most 200 × 60 px.
    return { png: data, width: Math.round(info.width / 2), height: Math.round(info.height / 2) };
  } catch {
    return null;
  }
}

/** Plain text, HTML (table layout with inline styles, for every email client) and logo. */
export async function invitationEmail(
  m: InvitationEmail,
): Promise<{ subject: string; text: string; extras: EmailExtras }> {
  const subject = `${m.orgName} te da acceso a su área de clientes`;
  const greeting = m.personName ? `Hola, ${m.personName}:` : "Hola:";
  const intro = `${m.orgName} te ha dado acceso a ${m.agentName}, su asistente para clientes.`;
  const what =
    "Por chat o por voz puedes consultar tus pedidos, órdenes y documentos, y hacer pedidos nuevos.";
  const how = "Para entrar usa este email; cada vez que accedas te enviaremos un código.";
  const ai = `${m.agentName} es un asistente de inteligencia artificial.`;

  const text = [
    greeting,
    "",
    `${intro} ${what}`,
    "",
    `Entra en: ${m.url}`,
    `Usa este email (${m.email}): cada vez que entres te enviaremos un código.`,
    "",
    ai,
  ].join("\n");

  const logo = await logoAttachment(m.orgLogo);
  const header = logo
    ? `<img src="cid:${LOGO_CID}" width="${logo.width}" height="${logo.height}" alt="${esc(m.orgName)}" style="display:block;border:0;outline:none;max-width:200px;height:auto;">`
    : `<span style="font-size:20px;font-weight:700;color:#0f172a;letter-spacing:-0.2px;">${esc(m.orgName)}</span>`;
  const font =
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";
  const url = esc(m.url);

  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f1f4f8;${font}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(intro)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1f4f8;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
<tr><td style="background:#ffffff;border-radius:16px;border:1px solid #e3e8ef;overflow:hidden;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td style="padding:28px 36px 24px;border-bottom:1px solid #eef1f5;">${header}</td></tr>
<tr><td style="padding:32px 36px 8px;${font}">
<p style="margin:0 0 6px;font-size:13px;font-weight:600;letter-spacing:0.6px;text-transform:uppercase;color:#64748b;">Área de clientes</p>
<h1 style="margin:0 0 20px;font-size:24px;line-height:1.3;font-weight:700;color:#0f172a;">Ya tienes acceso a ${esc(m.agentName)}</h1>
<p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:#334155;">${esc(greeting)}</p>
<p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:#334155;">${esc(intro)}</p>
<p style="margin:0 0 28px;font-size:16px;line-height:1.6;color:#334155;">${esc(what)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td align="center" bgcolor="#0f172a" style="border-radius:10px;">
<a href="${url}" target="_blank" style="display:inline-block;padding:14px 28px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;${font}">Entrar en el área de clientes</a>
</td></tr></table>
</td></tr>
<tr><td style="padding:24px 36px 32px;${font}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="background:#f6f8fb;border-radius:10px;padding:16px 18px;">
<p style="margin:0 0 4px;font-size:14px;line-height:1.5;color:#334155;">${esc(how)}</p>
<p style="margin:0;font-size:14px;line-height:1.5;font-weight:600;color:#0f172a;">${esc(m.email)}</p>
</td></tr></table>
<p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#64748b;">Si el botón no funciona, copia este enlace en tu navegador:<br><a href="${url}" style="color:#2563eb;word-break:break-all;">${url}</a></p>
</td></tr>
</table>
</td></tr>
<tr><td align="center" style="padding:20px 24px 0;${font}">
<p style="margin:0;font-size:12px;line-height:1.6;color:#94a3b8;">${esc(ai)}<br>Has recibido este email porque ${esc(m.orgName)} te ha invitado a su área de clientes.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  return {
    subject,
    text,
    extras: {
      html,
      attachments: logo
        ? [{ filename: "logo.png", content: logo.png, contentType: "image/png", cid: LOGO_CID }]
        : [],
    },
  };
}
