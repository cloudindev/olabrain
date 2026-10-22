/**
 * Factorial HR (https://apidoc.factorialhr.com, OpenAPI 2026-10-01): employees, time off,
 * vacation balances and attendance. Auth: company API key in `x-api-key` (company-wide
 * access). Lists answer {data, meta} with cursor pagination (limit ≤ 100, after_id).
 */
import { compact, restClient, type RestCall } from "./rest";
import {
  NativeToolError,
  int,
  schema,
  str,
  type NativeCallContext,
  type NativeResult,
  type NativeToolDef,
} from "./types";

export const FACTORIAL_BASE_URL = "https://api.factorialhr.com";
/** Pinned API version (quarterly releases, each supported one year). */
export const FACTORIAL_API_VERSION = "2026-10-01";
const R = `api/${FACTORIAL_API_VERSION}/resources`;

const DATE_RE = "^\\d{4}-\\d{2}-\\d{2}$";
const date = (description: string) => str(description, { pattern: DATE_RE });
const employeeId = int("ID del empleado en Factorial (búscalo con factorial_empleados)");

type Row = Record<string, unknown>;
type ToolSpec = NativeToolDef & {
  run: (call: RestCall, args: Record<string, unknown>) => Promise<NativeResult>;
};

function list(data: unknown): Row[] {
  return ((data as { data?: Row[] })?.data ?? []) as Row[];
}
function more(data: unknown): boolean {
  return Boolean((data as { meta?: { has_next_page?: boolean } })?.meta?.has_next_page);
}
function pick(row: Row, keys: string[]): Row {
  return Object.fromEntries(keys.filter((k) => row[k] !== undefined).map((k) => [k, row[k]]));
}
function ok(data: unknown): NativeResult {
  return { ok: true, data, truncated: false };
}

const EMPLOYEE_FIELDS = [
  "id",
  "full_name",
  "email",
  "phone_number",
  "location_id",
  "manager_id",
  "timeoff_manager_id",
  "active",
  "terminated_on",
];
const LEAVE_FIELDS = [
  "id",
  "employee_id",
  "employee_full_name",
  "leave_type_name",
  "start_on",
  "finish_on",
  "half_day",
  "description",
  "approved",
  "days_taken",
];
const SHIFT_FIELDS = [
  "id",
  "employee_id",
  "date",
  "clock_in",
  "clock_out",
  "minutes",
  "location_type",
  "observations",
];

/** Leave state as people say it; Factorial's `approved` is true/false (null = pending). */
function leaveState(row: Row): string {
  return row.approved === true ? "aprobada" : row.approved === false ? "rechazada" : "pendiente";
}

const TOOLS: ToolSpec[] = [
  {
    name: "factorial_empleados",
    description:
      "Busca empleados en Factorial por nombre o email (por defecto solo los activos). Devuelve su id, que necesitan el resto de herramientas de Factorial.",
    inputSchema: schema({
      nombre: str("Parte del nombre o apellidos"),
      email: str("Email exacto"),
      incluir_bajas: { type: "boolean", description: "Incluir empleados dados de baja" },
      limite: int("Máximo de resultados (1-100, por defecto 25)", { minimum: 1, maximum: 100 }),
    }),
    mode: "read",
    run: async (call, a) => {
      const res = await call("GET", `${R}/employees/employees`, {
        query: compact({
          full_text_name: a.nombre,
          "emails[]": a.email,
          only_active: a.incluir_bajas ? undefined : true,
          limit: a.limite ?? 25,
        }),
      });
      if (!res.ok) return res;
      return ok({
        empleados: list(res.data).map((e) => pick(e, EMPLOYEE_FIELDS)),
        hay_mas: more(res.data),
      });
    },
  },
  {
    name: "factorial_ausencias",
    description:
      "Ausencias y vacaciones en Factorial entre dos fechas, de un empleado o de toda la empresa. Indica el estado (aprobada, pendiente o rechazada).",
    inputSchema: schema(
      {
        desde: date("Desde (AAAA-MM-DD): ausencias que terminan este día o después"),
        hasta: date("Hasta (AAAA-MM-DD): ausencias que empiezan este día o antes"),
        empleado_id: employeeId,
        estado: str("Filtra por estado", { enum: ["todas", "aprobadas", "pendientes"] }),
      },
      ["desde", "hasta"],
    ),
    mode: "read",
    run: async (call, a) => {
      const res = await call("GET", `${R}/timeoff/leaves`, {
        query: compact({
          from: a.desde,
          to: a.hasta,
          "employee_ids[]": a.empleado_id,
          approved: a.estado === "aprobadas" ? true : undefined,
          include_pending: a.estado === "pendientes" ? true : undefined,
          include_leave_type: true,
          limit: 100,
        }),
      });
      if (!res.ok) return res;
      return ok({
        ausencias: list(res.data).map((l) => ({ ...pick(l, LEAVE_FIELDS), estado: leaveState(l) })),
        hay_mas: more(res.data),
      });
    },
  },
  {
    name: "factorial_tipos_ausencia",
    description:
      "Tipos de ausencia de Factorial (vacaciones, enfermedad, asuntos propios…) con su id, para pedir una ausencia.",
    inputSchema: schema({}),
    mode: "read",
    run: async (call) => {
      const res = await call("GET", `${R}/timeoff/leave_types`, {
        query: { active: true, limit: 100 },
      });
      if (!res.ok) return res;
      return ok({
        tipos: list(res.data).map((t) => ({
          id: t.id,
          nombre: t.translated_name ?? t.name,
          requiere_aprobacion: t.approval_required,
          medio_dia: t.half_days_units_enabled,
        })),
      });
    },
  },
  {
    name: "factorial_saldo_vacaciones",
    description:
      "Días de vacaciones y otros permisos disponibles, usados y totales de un empleado en Factorial.",
    inputSchema: schema(
      { empleado_id: employeeId, fecha: date("Fecha de referencia AAAA-MM-DD (por defecto hoy)") },
      ["empleado_id"],
    ),
    mode: "read",
    run: async (call, a) => {
      const [stats, allowances] = await Promise.all([
        call("GET", `${R}/timeoff/allowance_stats`, {
          query: compact({ "employee_ids[]": a.empleado_id, reference_date: a.fecha }),
        }),
        call("GET", `${R}/timeoff/allowances`, { query: { limit: 100 } }),
      ]);
      if (!stats.ok) return stats;
      const names = new Map(
        (allowances.ok ? list(allowances.data) : []).map((x) => [x.id, x.name]),
      );
      return ok({
        saldos: list(stats.data).map((s) => ({
          permiso: names.get(s.allowance_id) ?? s.allowance_id,
          año: s.year,
          disponibles: s.available_days,
          usados: s.used_days,
          total: s.total,
        })),
      });
    },
  },
  {
    name: "factorial_solicitar_ausencia",
    description:
      "Registra una ausencia o vacaciones para un empleado en Factorial (queda pendiente si su tipo requiere aprobación). Usa factorial_tipos_ausencia para el tipo.",
    inputSchema: schema(
      {
        empleado_id: employeeId,
        tipo_id: int("ID del tipo de ausencia"),
        inicio: date("Primer día AAAA-MM-DD"),
        fin: date("Último día AAAA-MM-DD (por defecto, el mismo día)"),
        medio_dia: str("Solo media jornada", { enum: ["beggining_of_day", "end_of_day"] }),
        descripcion: str("Motivo o comentario"),
      },
      ["empleado_id", "tipo_id", "inicio"],
    ),
    mode: "write",
    run: async (call, a) => {
      const res = await call("POST", `${R}/timeoff/leaves`, {
        body: compact({
          employee_id: a.empleado_id,
          leave_type_id: a.tipo_id,
          start_on: a.inicio,
          finish_on: a.fin ?? a.inicio,
          half_day: a.medio_dia,
          description: a.descripcion,
        }),
      });
      if (!res.ok) return res;
      const l = res.data as Row;
      return ok({ ...pick(l, LEAVE_FIELDS), estado: leaveState(l) });
    },
  },
  {
    name: "factorial_aprobar_ausencia",
    description: "Aprueba o rechaza una solicitud de ausencia pendiente en Factorial.",
    inputSchema: schema(
      {
        ausencia_id: int("ID de la ausencia"),
        decision: str("Aprobar o rechazar", { enum: ["aprobar", "rechazar"] }),
        motivo: str("Motivo del rechazo"),
      },
      ["ausencia_id", "decision"],
    ),
    mode: "write",
    run: async (call, a) => {
      const res = await call(
        "POST",
        `${R}/timeoff/leaves/${a.decision === "rechazar" ? "reject" : "approve"}`,
        {
          body: compact({
            id: a.ausencia_id,
            reason: a.decision === "rechazar" ? a.motivo : undefined,
          }),
        },
      );
      if (!res.ok) return res;
      const l = res.data as Row;
      return ok({ ...pick(l, LEAVE_FIELDS), estado: leaveState(l) });
    },
  },
  {
    name: "factorial_fichajes",
    description:
      "Fichajes (entradas y salidas) registrados en Factorial entre dos fechas, de un empleado o de toda la empresa, con los minutos trabajados.",
    inputSchema: schema(
      {
        desde: date("Desde AAAA-MM-DD"),
        hasta: date("Hasta AAAA-MM-DD"),
        empleado_id: employeeId,
      },
      ["desde", "hasta"],
    ),
    mode: "read",
    run: async (call, a) => {
      const res = await call("GET", `${R}/attendance/shifts`, {
        query: compact({
          start_on: a.desde,
          end_on: a.hasta,
          "employee_ids[]": a.empleado_id,
          limit: 100,
        }),
      });
      if (!res.ok) return res;
      const shifts = list(res.data).map((s) => pick(s, SHIFT_FIELDS));
      const minutes = shifts.reduce((sum, s) => sum + (Number(s.minutes) || 0), 0);
      return ok({
        fichajes: shifts,
        horas_totales: Math.round((minutes / 60) * 100) / 100,
        hay_mas: more(res.data),
      });
    },
  },
  {
    name: "factorial_fichar",
    description:
      "Ficha la entrada o la salida de un empleado en Factorial en este momento (la salida cierra su fichaje abierto).",
    inputSchema: schema(
      {
        empleado_id: employeeId,
        accion: str("Entrada o salida", { enum: ["entrada", "salida"] }),
        observaciones: str("Comentario del fichaje"),
        lugar: str("Dónde trabaja (solo en la entrada)", {
          enum: ["office", "business_trip", "work_from_home"],
        }),
      },
      ["empleado_id", "accion"],
    ),
    mode: "write",
    run: async (call, a) => {
      const entry = a.accion === "entrada";
      const res = await call("POST", `${R}/attendance/shifts/${entry ? "clock_in" : "clock_out"}`, {
        body: compact({
          now: new Date().toISOString(),
          employee_id: a.empleado_id,
          observations: a.observaciones,
          location_type: entry ? a.lugar : undefined,
        }),
      });
      if (!res.ok) return res;
      return ok(pick(res.data as Row, SHIFT_FIELDS));
    },
  },
  {
    name: "factorial_equipos",
    description: "Equipos de Factorial con sus miembros (ids de empleado) y responsables.",
    inputSchema: schema({}),
    mode: "read",
    run: async (call) => {
      const res = await call("GET", `${R}/teams/teams`, { query: { limit: 100 } });
      if (!res.ok) return res;
      return ok({
        equipos: list(res.data).map((t) =>
          pick(t, ["id", "name", "employee_ids", "lead_ids", "parent_team_id"]),
        ),
      });
    },
  },
];

export const FACTORIAL_TOOLS: NativeToolDef[] = TOOLS.map(
  ({ name, description, inputSchema, mode }) => ({ name, description, inputSchema, mode }),
);

function factorialCall(ctx: NativeCallContext): RestCall {
  const apiKey = (ctx.secret as { apiKey?: string }).apiKey;
  if (!apiKey) throw new NativeToolError("falta la clave de API de Factorial");
  return restClient(ctx, {
    app: "Factorial",
    baseUrl: FACTORIAL_BASE_URL,
    headers: { "x-api-key": apiKey },
  });
}

export async function executeFactorialTool(
  ctx: NativeCallContext,
  toolName: string,
  args: Record<string, unknown>,
): Promise<NativeResult> {
  const tool = TOOLS.find((t) => t.name === toolName);
  if (!tool) throw new NativeToolError(`herramienta de Factorial desconocida: ${toolName}`);
  return tool.run(factorialCall(ctx), args);
}

/**
 * Validates the key when connecting. A key from another environment (e.g. demo) answers
 * 200 with no data instead of 401, so an empty list also counts as a failure.
 */
export async function checkFactorial(ctx: NativeCallContext): Promise<{ company?: string }> {
  const res = await factorialCall(ctx)("GET", `${R}/api_public/credentials`);
  if (!res.ok) throw new NativeToolError((res.data as { error: string }).error);
  const [me] = list(res.data);
  if (!me) throw new NativeToolError("Factorial no reconoce esa clave de API");
  return { company: (me.legal_name ?? me.name) as string | undefined };
}
