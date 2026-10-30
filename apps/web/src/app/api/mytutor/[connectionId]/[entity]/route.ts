import { connections } from "@brainagent/db";
import { eq } from "drizzle-orm";
import ExcelJS from "exceljs";
import { z } from "zod";
import { entityRows, flatten, isMytutorEntity } from "@/lib/mytutor";
import { AuthError, requireTenant, tenantTx } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CSV_SEP = ";"; // Excel in Spanish opens ";" files in columns

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * CSV/XLSX export of one MyTutor entity from the cache, with the page's filters (what
 * MyTutor's own UI doesn't offer). Signed-in members of the organization only.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ connectionId: string; entity: string }> },
) {
  const { connectionId, entity } = await params;
  if (!z.uuid().safeParse(connectionId).success || !isMytutorEntity(entity)) {
    return new Response("No encontrado", { status: 404 });
  }
  let ctx;
  try {
    ctx = await requireTenant("viewer");
  } catch (e) {
    return new Response("No autorizado", { status: e instanceof AuthError ? e.status : 401 });
  }
  const sp = new URL(request.url).searchParams;
  const format = sp.get("format") === "xlsx" ? "xlsx" : "csv";
  const filters = {
    q: sp.get("q")?.slice(0, 100) ?? undefined,
    status: sp.get("status")?.slice(0, 60) ?? undefined,
    from: sp.get("from") ?? undefined,
    to: sp.get("to") ?? undefined,
    withDeleted: sp.get("bajas") === "1",
  };
  const rows = await tenantTx(ctx, async (tx) => {
    const [conn] = await tx
      .select()
      .from(connections)
      .where(eq(connections.id, connectionId))
      .limit(1);
    if (!conn || (conn.config as { provider?: string }).provider !== "mytutor") return null;
    return entityRows(tx, connectionId, entity, filters);
  });
  if (!rows) return new Response("No encontrado", { status: 404 });

  const flat = rows.map((r) => ({
    mytutor_id: r.sourceId,
    ...flatten(r.raw),
    baja_en_mytutor: r.deletedAt ? r.deletedAt.toISOString() : null,
    copiado: r.syncedAt.toISOString(),
  }));
  const columns = [...new Set(flat.flatMap((r) => Object.keys(r)))];
  const name = `mytutor-${entity}-${new Date().toISOString().slice(0, 10)}`;

  if (format === "csv") {
    const lines = [
      columns.map(csvCell).join(CSV_SEP),
      ...flat.map((r) =>
        columns.map((c) => csvCell((r as Record<string, unknown>)[c])).join(CSV_SEP),
      ),
    ];
    return new Response(`\uFEFF${lines.join("\r\n")}`, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${name}.csv"`,
        "cache-control": "private, no-store",
      },
    });
  }

  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet(entity.slice(0, 31));
  sheet.columns = columns.map((c) => ({
    header: c,
    key: c,
    width: Math.min(40, Math.max(10, c.length + 2)),
  }));
  for (const r of flat) sheet.addRow(r);
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  const buffer = await book.xlsx.writeBuffer();
  return new Response(buffer as ArrayBuffer, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${name}.xlsx"`,
      "cache-control": "private, no-store",
    },
  });
}
