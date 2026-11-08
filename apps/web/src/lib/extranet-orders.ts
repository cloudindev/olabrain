import "server-only";
import type { CustomerOrderEvent } from "@brainagent/connector";
import { memberships, tenants, users } from "@brainagent/db";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { env } from "@/lib/env";

/**
 * A customer placed an order through an extranet agent (ADR-030): its owners and admins
 * get an email with the order and a link to the agent's «Pedidos».
 */
export async function notifyCustomerOrder(order: CustomerOrderEvent): Promise<void> {
  const team = await db()
    .select({ email: users.email, role: memberships.role, tenant: tenants.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .innerJoin(tenants, eq(tenants.id, memberships.organizationId))
    .where(and(eq(memberships.organizationId, order.tenantId), ne(memberships.role, "viewer")));
  const to = team.filter((m) => /(^|,)(owner|admin)(,|$)/.test(m.role)).map((m) => m.email);
  if (!to.length) return;
  const url = `${env().APP_URL.replace(/\/$/, "")}/agents/${order.agentId}?tab=orders`;
  const lines = order.lines.map(
    (l) => `- ${l.quantity} × ${l.name} (ref. ${l.ref})${l.note ? ` · ${l.note}` : ""}`,
  );
  await sendEmail(
    to.join(", "),
    `Pedido nº ${order.number} de ${order.customerName}`,
    [
      `${order.customerName} ha hecho un pedido desde el área de clientes.`,
      `Lo ha hecho: ${order.placedBy}`,
      "",
      ...lines,
      order.note ? `\nComentario: ${order.note}` : "",
      "",
      `Revísalo y márcalo como introducido o rechazado: ${url}`,
    ].join("\n"),
  );
}
