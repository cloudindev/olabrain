"use server";

import { connections, credentials, tools } from "@brainagent/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ConnectorRequestError, connectorFetch } from "@/lib/connector";
import { env } from "@/lib/env";
import { requireTenant, tenantTx } from "@/lib/tenant";

export type Result<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

async function run<T>(fn: (tenantId: string) => Promise<T>): Promise<Result<T>> {
  try {
    const ctx = await requireTenant("admin");
    return { ok: true, data: await fn(ctx.tenantId) };
  } catch (e) {
    if (e instanceof ConnectorRequestError) return { ok: false, error: e.message };
    if (e instanceof Error && /forbidden|no_tenant|unauthenticated/.test(e.message)) {
      return { ok: false, error: "No tienes permisos para gestionar conexiones." };
    }
    throw e;
  }
}

type CreateResult = {
  connectionId: string;
  status?: "active" | "needs_auth";
  authorizationUrl?: string;
  tools?: number;
};

export async function createMcpConnection(input: unknown) {
  return run((tenantId) =>
    connectorFetch<CreateResult>(tenantId, "/v1/connections/mcp", { body: input }),
  );
}

export async function createWhmcsConnection(input: unknown) {
  return run((tenantId) =>
    connectorFetch<CreateResult>(tenantId, "/v1/connections/native/whmcs", { body: input }),
  );
}

export async function createApiKeyConnection(
  provider: "holded" | "factorial" | "sesame",
  input: unknown,
) {
  const p = z.enum(["holded", "factorial", "sesame"]).parse(provider);
  return run((tenantId) =>
    connectorFetch<CreateResult>(tenantId, `/v1/connections/native/${p}`, { body: input }),
  );
}

export async function updateWhmcsAccessKey(connectionId: string, accessKey: string | null) {
  return run(async (tenantId) => {
    const res = await connectorFetch<{ ok: boolean; error?: string }>(
      tenantId,
      `/v1/connections/${z.uuid().parse(connectionId)}/whmcs/access-key`,
      { body: { accessKey } },
    );
    revalidatePath(`/connections/${connectionId}`);
    return res;
  });
}

export async function createGoogleDriveConnection(input: unknown) {
  return run((tenantId) =>
    connectorFetch<CreateResult>(tenantId, "/v1/connections/native/googledrive", { body: input }),
  );
}

export async function createMicrosoft365Connection(input: unknown) {
  return run((tenantId) =>
    connectorFetch<CreateResult>(tenantId, "/v1/connections/native/microsoft365", { body: input }),
  );
}

export async function previewOpenApi(input: unknown) {
  return run((tenantId) =>
    connectorFetch<{
      title: string;
      baseUrl: string | null;
      operations: {
        operationId: string;
        name: string;
        description: string;
        mode: "read" | "write";
        tag: string | null;
      }[];
    }>(tenantId, "/v1/openapi/preview", { body: input }),
  );
}

export async function createOpenApiConnection(input: unknown) {
  return run((tenantId) =>
    connectorFetch<CreateResult>(tenantId, "/v1/connections/openapi", { body: input }),
  );
}

export async function createSqlConnection(input: unknown) {
  return run((tenantId) =>
    connectorFetch<CreateResult>(tenantId, "/v1/connections/sql", { body: input }),
  );
}

export async function createHttpConnection(input: unknown) {
  return run((tenantId) =>
    connectorFetch<CreateResult>(tenantId, "/v1/connections/http", { body: input }),
  );
}

export async function syncConnection(id: string) {
  const res = await run((tenantId) =>
    connectorFetch<CreateResult>(tenantId, `/v1/connections/${z.uuid().parse(id)}/sync`, {
      method: "POST",
    }),
  );
  revalidatePath(`/connections/${id}`);
  return res;
}

export async function saveStudioTool(connectionId: string, tool: unknown, toolId?: string) {
  const res = await run((tenantId) =>
    connectorFetch<{ toolId: string }>(
      tenantId,
      toolId
        ? `/v1/connections/${connectionId}/tools/${toolId}`
        : `/v1/connections/${connectionId}/tools`,
      { method: toolId ? "PUT" : "POST", body: tool },
    ),
  );
  revalidatePath(`/connections/${connectionId}`);
  return res;
}

type TestResult = { ok: boolean; data: unknown; truncated: boolean; durationMs: number };

export async function testStudioTool(
  connectionId: string,
  tool: unknown,
  args: unknown,
  allowWrite: boolean,
) {
  return run((tenantId) =>
    connectorFetch<TestResult>(tenantId, `/v1/connections/${connectionId}/tools/test`, {
      body: { tool, args, allowWrite },
    }),
  );
}

export async function testSavedTool(toolId: string, args: unknown, allowWrite: boolean) {
  return run((tenantId) =>
    connectorFetch<TestResult>(tenantId, `/v1/tools/${toolId}/test`, {
      body: { args, allowWrite },
    }),
  );
}

const patchSchema = z.object({
  enabled: z.boolean().optional(),
  confirmation: z.enum(["required", "auto"]).optional(),
});

/** Admin choices that don't need secrets: done directly under RLS. */
export async function updateTool(toolId: string, patch: unknown): Promise<Result<null>> {
  const ctx = await requireTenant("admin");
  const parsed = patchSchema.safeParse(patch);
  if (!parsed.success || !z.uuid().safeParse(toolId).success)
    return { ok: false, error: "Datos no válidos" };
  const [row] = await tenantTx(ctx, (tx) =>
    tx
      .update(tools)
      .set(parsed.data)
      .where(eq(tools.id, toolId))
      .returning({ connectionId: tools.connectionId }),
  );
  if (row) revalidatePath(`/connections/${row.connectionId}`);
  return { ok: true, data: null };
}

export async function deleteConnection(id: string): Promise<Result<null>> {
  const ctx = await requireTenant("admin");
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "Datos no válidos" };
  await tenantTx(ctx, async (tx) => {
    const [conn] = await tx
      .delete(connections)
      .where(eq(connections.id, id))
      .returning({ credentialId: connections.credentialId });
    if (conn?.credentialId)
      await tx.delete(credentials).where(eq(credentials.id, conn.credentialId));
  });
  revalidatePath("/connections");
  return { ok: true, data: null };
}

/** Development helper: demo database with the reference tools (CLAUDE.md §6). */
export async function addDemoConnection() {
  const password = env().DEMO_DB_PASSWORD;
  if (!password) return { ok: false as const, error: "DEMO_DB_PASSWORD no está configurado" };
  const dbUrl = new URL(env().DATABASE_URL);
  const res = await run(async (tenantId) => {
    const { connectionId } = await connectorFetch<CreateResult>(tenantId, "/v1/connections/sql", {
      body: {
        name: "Operaciones (demo)",
        config: {
          dialect: "postgres",
          host: dbUrl.hostname,
          port: Number(dbUrl.port || 5432),
          database: "demo_ops",
          user: "demo_reader",
          ssl: false,
        },
        password,
      },
    });
    const fecha = [
      {
        name: "fecha",
        type: "date",
        description: "Fecha en formato AAAA-MM-DD. Para hoy, usa la fecha actual.",
        required: true,
      },
    ];
    await connectorFetch(tenantId, `/v1/connections/${connectionId}/tools`, {
      body: {
        kind: "sql",
        definition: {
          name: "partes_hoy",
          description:
            "Partes de trabajo de una fecha: cliente, dirección, técnico asignado, estado (pendiente, en curso, cerrado) y descripción.",
          query:
            "SELECT id, cliente, direccion, tecnico, estado, descripcion FROM partes WHERE fecha = :fecha ORDER BY estado, cliente",
          params: fecha,
          maxRows: 100,
          timeoutMs: 5000,
        },
      },
    });
    await connectorFetch(tenantId, `/v1/connections/${connectionId}/tools`, {
      body: {
        kind: "sql",
        definition: {
          name: "horas_equipo",
          description:
            "Horas trabajadas por cada técnico en una fecha, con el total por persona y el proyecto.",
          query:
            "SELECT tecnico, SUM(horas) AS horas, string_agg(proyecto, ', ') AS proyectos FROM horas WHERE fecha = :fecha GROUP BY tecnico ORDER BY tecnico",
          params: fecha,
          maxRows: 100,
          timeoutMs: 5000,
        },
      },
    });
    return { connectionId };
  });
  if (res.ok) {
    revalidatePath("/connections");
    redirect(`/connections/${res.data.connectionId}`);
  }
  return res;
}
