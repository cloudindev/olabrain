import "server-only";
import { leads } from "@brainagent/db";
import { count, isNull } from "drizzle-orm";
import { cache } from "react";
import { tenantTx, type TenantContext } from "./tenant";

/** Leads nobody has opened yet, for the navbar badge (once per request). */
export const unreadLeadsCount = cache(async (ctx: TenantContext): Promise<number> => {
  const [row] = await tenantTx(ctx, (tx) =>
    tx.select({ n: count() }).from(leads).where(isNull(leads.readAt)),
  );
  return row?.n ?? 0;
});
