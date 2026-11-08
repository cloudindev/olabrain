"use server";

import {
  EXTRANET_LINK,
  EXTRANET_PROVIDERS,
  customerInviteSchema,
  extranetInputSchema,
  orderStatusInputSchema,
} from "@brainagent/core";
import {
  MYTUTOR_TABLES,
  agents,
  auditLog,
  channels,
  connections,
  customerAccounts,
  customerOrders,
  type Tx,
} from "@brainagent/db";
import { and, asc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { sendEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { requireTenant, tenantTx, type TenantContext } from "@/lib/tenant";
import type { ActionResult } from "./actions";

/**
 * Extranet agents (ADR-030), panel side: the link, the customers who may use it (each one
 * bound by the organization to one customer of the ERP) and the orders they place.
 */

async function extranetAgent(tx: Tx, agentId: string) {
  const [agent] = await tx
    .select({ id: agents.id, name: agents.name, kind: agents.kind })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);
  return agent?.kind === "extranet" ? agent : null;
}

async function extranetUrl(tx: Tx, agentId: string): Promise<string | null> {
  const [link] = await tx
    .select({ id: channels.id })
    .from(channels)
    .where(and(eq(channels.agentId, agentId), eq(channels.kind, EXTRANET_LINK)))
    .limit(1);
  return link ? `${env().APP_URL.replace(/\/$/, "")}/x/${link.id}` : null;
}

export async function saveExtranetLink(agentId: string, input: unknown): Promise<ActionResult> {
  const ctx = await requireTenant("admin");
  const parsed = extranetInputSchema.safeParse(input);
  if (!z.uuid().safeParse(agentId).success || !parsed.success)
    return {
      ok: false,
      error: parsed.success ? "Agente no válido" : parsed.error.issues[0]!.message,
    };
  const ok = await tenantTx(ctx, async (tx) => {
    if (!(await extranetAgent(tx, agentId))) return false;
    const { enabled, ...config } = parsed.data;
    await tx
      .insert(channels)
      .values({ tenantId: ctx.tenantId, agentId, kind: EXTRANET_LINK, config, enabled })
      .onConflictDoUpdate({
        target: [channels.agentId, channels.kind],
        set: { config, enabled, updatedAt: new Date() },
      });
    return true;
  });
  if (!ok) return { ok: false, error: "Agente no encontrado" };
  revalidatePath(`/agents/${agentId}`);
  return { ok: true };
}

export type ErpCustomer = { ref: string; name: string; cif: string | null; emails: string[] };

/** Customers of the ERP (the agent's own connection) to bind a person to. */
export async function searchErpCustomers(
  agentId: string,
  connectionId: string,
  query: string,
): Promise<ErpCustomer[]> {
  const ctx = await requireTenant("admin");
  if (!z.uuid().safeParse(agentId).success || !z.uuid().safeParse(connectionId).success) return [];
  return tenantTx(ctx, async (tx) => {
    const conn = await agentConnection(tx, agentId, connectionId);
    if (!conn) return [];
    const t = MYTUTOR_TABLES.clients;
    const q = query.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ%_]/g, "");
    const rows = await tx
      .select()
      .from(t)
      .where(
        and(
          eq(t.connectionId, connectionId),
          isNull(t.deletedAt),
          q ? or(ilike(t.search, `%${q}%`), eq(t.sourceId, query.trim())) : undefined,
        ),
      )
      .orderBy(asc(t.name))
      .limit(20);
    return rows.map((r) => {
      const raw = r.raw as { billing_emails?: { email?: string }[] };
      return {
        ref: r.sourceId,
        name: r.name,
        cif: r.ref,
        emails: (raw.billing_emails ?? [])
          .map((e) => e.email?.trim().toLowerCase())
          .filter((e): e is string => Boolean(e)),
      };
    });
  });
}

/** The agent's own, active connection to an ERP an extranet can serve. */
async function agentConnection(tx: Tx, agentId: string, connectionId: string) {
  if (!(await extranetAgent(tx, agentId))) return null;
  const [conn] = await tx
    .select({ id: connections.id, provider: sql<string>`${connections.config}->>'provider'` })
    .from(connections)
    .where(and(eq(connections.id, connectionId), eq(connections.agentId, agentId)))
    .limit(1);
  return conn && (EXTRANET_PROVIDERS as readonly string[]).includes(conn.provider) ? conn : null;
}

async function sendInvitation(
  ctx: TenantContext,
  agentName: string,
  url: string,
  account: { email: string; personName: string },
) {
  await sendEmail(
    account.email,
    `${ctx.tenantName} te da acceso a su área de clientes`,
    [
      account.personName ? `Hola, ${account.personName}:` : "Hola:",
      "",
      `${ctx.tenantName} te ha dado acceso a ${agentName}, su asistente para clientes. ` +
        "Por chat o por voz puedes consultar tus pedidos, órdenes y documentos, y hacer pedidos nuevos.",
      "",
      `Entra en: ${url}`,
      `Usa este email (${account.email}): cada vez que entres te enviaremos un código.`,
      "",
      "Es un asistente de inteligencia artificial.",
    ].join("\n"),
  );
}

/** The sign-in link for one person, with their email already filled in. */
function personalLink(url: string, email: string) {
  return `${url}?email=${encodeURIComponent(email)}`;
}

export async function inviteCustomer(
  agentId: string,
  input: unknown,
): Promise<{ ok: true; url: string; emailed: boolean } | { ok: false; error: string }> {
  const ctx = await requireTenant("admin");
  const parsed = customerInviteSchema.safeParse(input);
  if (!z.uuid().safeParse(agentId).success || !parsed.success)
    return {
      ok: false,
      error: parsed.success ? "Agente no válido" : parsed.error.issues[0]!.message,
    };
  const result = await tenantTx(ctx, async (tx) => {
    const agent = await extranetAgent(tx, agentId);
    const conn = agent && (await agentConnection(tx, agentId, parsed.data.connectionId));
    if (!agent || !conn) return { error: "Conexión no válida para la extranet" } as const;
    const t = MYTUTOR_TABLES.clients;
    const [customer] = await tx
      .select({ name: t.name })
      .from(t)
      .where(
        and(
          eq(t.connectionId, conn.id),
          eq(t.sourceId, parsed.data.erpCustomerRef),
          isNull(t.deletedAt),
        ),
      )
      .limit(1);
    if (!customer) return { error: "Ese cliente no está en el ERP" } as const;
    const url = await extranetUrl(tx, agentId);
    if (!url) return { error: "Publica primero el enlace de la extranet" } as const;
    const [account] = await tx
      .insert(customerAccounts)
      .values({
        tenantId: ctx.tenantId,
        agentId,
        connectionId: conn.id,
        erpCustomerRef: parsed.data.erpCustomerRef,
        customerName: customer.name,
        email: parsed.data.email,
        personName: parsed.data.personName,
        invitedByUserId: ctx.user.id,
      })
      .onConflictDoNothing()
      .returning({ id: customerAccounts.id });
    if (!account) return { error: "Ese email ya tiene acceso a este agente" } as const;
    await tx.insert(auditLog).values({
      tenantId: ctx.tenantId,
      actorUserId: ctx.user.id,
      action: "extranet.customer.invite",
      targetType: "customer_account",
      targetId: account.id,
      data: { customer: parsed.data.erpCustomerRef, emailed: parsed.data.sendEmail },
    });
    return { agentName: agent.name, url } as const;
  });
  if ("error" in result) return { ok: false, error: result.error! };
  const link = personalLink(result.url, parsed.data.email);
  if (parsed.data.sendEmail) await sendInvitation(ctx, result.agentName, link, parsed.data);
  revalidatePath(`/agents/${agentId}`);
  return { ok: true, url: link, emailed: parsed.data.sendEmail };
}

const accountAction = z.enum(["enable", "disable", "resend", "delete"]);

/** Enable, disable (ends every open session), resend the invitation or remove access. */
export async function manageCustomer(
  agentId: string,
  accountId: string,
  action: z.infer<typeof accountAction>,
): Promise<ActionResult> {
  const ctx = await requireTenant("admin");
  if (
    !z.uuid().safeParse(agentId).success ||
    !z.uuid().safeParse(accountId).success ||
    !accountAction.safeParse(action).success
  )
    return { ok: false, error: "Datos no válidos" };
  const result = await tenantTx(ctx, async (tx) => {
    const agent = await extranetAgent(tx, agentId);
    if (!agent) return null;
    const where = and(eq(customerAccounts.id, accountId), eq(customerAccounts.agentId, agentId));
    const [account] = await tx.select().from(customerAccounts).where(where).limit(1);
    if (!account) return null;
    if (action === "delete") await tx.delete(customerAccounts).where(where);
    else if (action === "disable")
      await tx
        .update(customerAccounts)
        .set({ status: "disabled", sessionEpoch: account.sessionEpoch + 1 })
        .where(where);
    else if (action === "enable")
      await tx
        .update(customerAccounts)
        .set({ status: account.lastLoginAt ? "active" : "invited" })
        .where(where);
    await tx.insert(auditLog).values({
      tenantId: ctx.tenantId,
      actorUserId: ctx.user.id,
      action: `extranet.customer.${action}`,
      targetType: "customer_account",
      targetId: accountId,
    });
    return { account, agentName: agent.name, url: await extranetUrl(tx, agentId) };
  });
  if (!result) return { ok: false, error: "No encontrado" };
  if (action === "resend") {
    if (result.account.status === "disabled")
      return { ok: false, error: "Activa el acceso antes de reenviar la invitación" };
    if (!result.url) return { ok: false, error: "Publica primero el enlace de la extranet" };
    await sendInvitation(
      ctx,
      result.agentName,
      personalLink(result.url, result.account.email),
      result.account,
    );
  }
  revalidatePath(`/agents/${agentId}`);
  return { ok: true };
}

const STATUS_ES = { pending: "pendiente", entered: "introducido", rejected: "rechazado" } as const;

/** The team enters or rejects an order; the customer is told by email. */
export async function updateOrderStatus(orderId: string, input: unknown): Promise<ActionResult> {
  const ctx = await requireTenant("builder");
  const parsed = orderStatusInputSchema.safeParse(input);
  if (!z.uuid().safeParse(orderId).success || !parsed.success)
    return {
      ok: false,
      error: parsed.success ? "Pedido no válido" : parsed.error.issues[0]!.message,
    };
  const result = await tenantTx(ctx, async (tx) => {
    const [order] = await tx
      .select({ order: customerOrders, email: customerAccounts.email })
      .from(customerOrders)
      .leftJoin(customerAccounts, eq(customerAccounts.id, customerOrders.customerAccountId))
      .where(eq(customerOrders.id, orderId))
      .limit(1);
    if (!order) return null;
    await tx
      .update(customerOrders)
      .set({
        status: parsed.data.status,
        erpReference: parsed.data.erpReference || null,
        statusNote: parsed.data.statusNote,
        handledByUserId: ctx.user.id,
        readAt: order.order.readAt ?? new Date(),
      })
      .where(eq(customerOrders.id, orderId));
    await tx.insert(auditLog).values({
      tenantId: ctx.tenantId,
      actorUserId: ctx.user.id,
      action: "extranet.order.status",
      targetType: "customer_order",
      targetId: orderId,
      data: { status: parsed.data.status },
    });
    return { ...order, changed: order.order.status !== parsed.data.status };
  });
  if (!result) return { ok: false, error: "Pedido no encontrado" };
  if (result.changed && result.email && parsed.data.status !== "pending") {
    const n = result.order.number;
    await sendEmail(
      result.email,
      `Tu pedido nº ${n} ha sido ${STATUS_ES[parsed.data.status]}`,
      [
        `${ctx.tenantName} ha ${parsed.data.status === "entered" ? "introducido" : "rechazado"} tu pedido nº ${n}.`,
        parsed.data.erpReference ? `Referencia: ${parsed.data.erpReference}` : "",
        parsed.data.statusNote ? `\nComentario: ${parsed.data.statusNote}` : "",
        "",
        "Puedes preguntar por él a tu asistente en el área de clientes.",
      ]
        .filter((l, i, all) => l || all[i - 1])
        .join("\n"),
    );
  }
  if (result.order.agentId) revalidatePath(`/agents/${result.order.agentId}`);
  return { ok: true };
}

export async function markOrderRead(orderId: string): Promise<void> {
  const ctx = await requireTenant("viewer");
  if (!z.uuid().safeParse(orderId).success) return;
  await tenantTx(ctx, (tx) =>
    tx
      .update(customerOrders)
      .set({ readAt: new Date() })
      .where(and(eq(customerOrders.id, orderId), isNull(customerOrders.readAt))),
  );
}
