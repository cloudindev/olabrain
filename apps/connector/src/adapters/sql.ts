/**
 * Tool Studio SQL: parameterized, read-only queries on Postgres, MySQL and SQL Server.
 *
 * Defense in depth (a read-only DB user is still the first recommendation):
 *  1. Static check: one statement, SELECT/WITH only, no write/DDL/exec keywords.
 *  2. Named params (:fecha) are bound as driver parameters, never interpolated.
 *  3. Read-only transaction (Postgres, MySQL) or rolled-back transaction (SQL Server).
 *  4. Row cap (maxRows + 1 to detect truncation) and server-side statement timeout.
 *  5. The host goes through the egress policy (no private networks unless allowlisted).
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { SqlConfig, StudioParam } from "@brainagent/core";
import mssql from "mssql";
import mysql from "mysql2/promise";
import postgres from "postgres";
import {
  EgressBlockedError,
  assertHostAllowed,
  isBlockedAddress,
  type EgressPolicy,
} from "../egress";

export class SqlValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SqlValidationError";
  }
}

// Statement-level writes (INSERT…, REPLACE INTO…, LOAD DATA…) are already rejected by the
// "must start with SELECT/WITH" rule; this list catches writes and side effects inside one.
const FORBIDDEN = [
  "insert",
  "update",
  "delete",
  "merge",
  "upsert",
  "drop",
  "alter",
  "create",
  "truncate",
  "grant",
  "revoke",
  "exec",
  "execute",
  "call",
  "copy",
  "into",
  "lock",
  "vacuum",
  "attach",
  "detach",
  "set",
  "begin",
  "commit",
  "rollback",
  "savepoint",
  "outfile",
  "dumpfile",
  "pg_sleep",
  "sleep",
  "benchmark",
  "waitfor",
  "dblink",
  "openrowset",
  "opendatasource",
  "xp_cmdshell",
  "sp_executesql",
  "pg_read_file",
  "pg_read_binary_file",
  "lo_import",
  "lo_export",
  "shutdown",
];

/** Removes comments and replaces string/identifier literals with placeholders. */
export function stripSqlLiterals(query: string): string {
  let out = "";
  let i = 0;
  while (i < query.length) {
    const c = query[i]!;
    const next = query[i + 1];
    if (c === "-" && next === "-") {
      while (i < query.length && query[i] !== "\n") i++;
      out += " ";
    } else if (c === "/" && next === "*") {
      const end = query.indexOf("*/", i + 2);
      if (end === -1) throw new SqlValidationError("comentario sin cerrar");
      i = end + 2;
      out += " ";
    } else if (c === "'" || c === '"' || c === "`") {
      let j = i + 1;
      for (; j < query.length; j++) {
        if (query[j] === c) {
          if (query[j + 1] === c)
            j++; // escaped quote
          else break;
        }
      }
      if (j >= query.length) throw new SqlValidationError("literal sin cerrar");
      out += c === "'" ? "''" : '"_"';
      i = j + 1;
    } else if (c === "[") {
      const end = query.indexOf("]", i);
      if (end === -1) throw new SqlValidationError("identificador sin cerrar");
      out += '"_"';
      i = end + 1;
    } else if (c === "$" && /[a-zA-Z_$]/.test(next ?? "")) {
      // Postgres dollar-quoted strings ($$…$$, $tag$…$tag$) are not allowed.
      const tag = /^\$[a-zA-Z_]*\$/.exec(query.slice(i))?.[0];
      if (tag) throw new SqlValidationError("cadenas $$ no permitidas");
      out += c;
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

export function validateReadOnlySql(query: string): void {
  const code = stripSqlLiterals(query).trim().replace(/;\s*$/, "");
  if (!code) throw new SqlValidationError("la consulta está vacía");
  if (code.includes(";")) throw new SqlValidationError("solo se permite una sentencia");
  const words = code.toLowerCase().match(/[a-z_][a-z0-9_$]*/g) ?? [];
  if (words[0] !== "select" && words[0] !== "with") {
    throw new SqlValidationError("la consulta debe empezar por SELECT o WITH");
  }
  const bad = words.find((w) => FORBIDDEN.includes(w));
  if (bad)
    throw new SqlValidationError(
      `palabra no permitida en consultas de lectura: ${bad.toUpperCase()}`,
    );
}

export type Dialect = SqlConfig["dialect"];

/** Replaces :name with driver placeholders. Ignores literals and Postgres :: casts. */
export function bindNamedParams(
  query: string,
  args: Record<string, unknown>,
  params: StudioParam[],
  dialect: Dialect,
): { text: string; values: unknown[] } {
  const known = new Map(params.map((p) => [p.name, p]));
  const values: unknown[] = [];
  let text = "";
  let i = 0;
  while (i < query.length) {
    const c = query[i]!;
    if (c === "'" || c === '"' || c === "`") {
      let j = i + 1;
      for (; j < query.length; j++) {
        if (query[j] === c) {
          if (query[j + 1] === c) j++;
          else break;
        }
      }
      text += query.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === ":" && query[i + 1] === ":") {
      text += "::";
      i += 2;
      continue;
    }
    const m = c === ":" ? /^:([a-z][a-z0-9_]*)/.exec(query.slice(i)) : null;
    if (m) {
      const name = m[1]!;
      const param = known.get(name);
      if (!param) throw new SqlValidationError(`parámetro :${name} no definido`);
      const value = args[name];
      if (value === undefined || value === null) {
        if (param.required) throw new SqlValidationError(`falta el parámetro ${name}`);
      }
      values.push(coerce(param, value));
      text +=
        dialect === "postgres"
          ? `$${values.length}`
          : dialect === "mysql"
            ? "?"
            : `@p${values.length}`;
      i += m[0].length;
      continue;
    }
    text += c;
    i++;
  }
  return { text, values };
}

function coerce(param: StudioParam, value: unknown): unknown {
  if (value === undefined || value === null) return null;
  switch (param.type) {
    case "number":
    case "integer": {
      const n = Number(value);
      if (!Number.isFinite(n) || (param.type === "integer" && !Number.isInteger(n))) {
        throw new SqlValidationError(`${param.name} debe ser un número`);
      }
      return n;
    }
    case "boolean":
      return value === true || value === "true";
    case "date": {
      const s = String(value);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s))
        throw new SqlValidationError(`${param.name} debe ser AAAA-MM-DD`);
      return s;
    }
    default:
      return String(value);
  }
}

/** Resolves the DB host through the egress policy and returns the IP to connect to. */
export async function resolveDbHost(host: string, policy: EgressPolicy): Promise<string> {
  const allowlisted = policy.allowedPrivateHosts.includes(host.toLowerCase());
  if (isIP(host)) {
    assertHostAllowed(host, policy);
    return host;
  }
  const addresses = await lookup(host, { all: true });
  const usable = allowlisted ? addresses : addresses.filter((a) => !isBlockedAddress(a.address));
  if (usable.length === 0) throw new EgressBlockedError(`destino no permitido: ${host}`);
  return usable[0]!.address;
}

export type SqlResult = { columns: string[]; rows: Record<string, unknown>[]; truncated: boolean };

export type SqlConnection = SqlConfig & { password: string };

function serialize(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([k, v]) => [
        k,
        v instanceof Date ? v.toISOString() : typeof v === "bigint" ? v.toString() : v,
      ]),
    ),
  );
}

export async function runReadOnlyQuery(
  conn: SqlConnection,
  def: { query: string; params: StudioParam[]; maxRows: number; timeoutMs: number },
  args: Record<string, unknown>,
  policy: EgressPolicy,
): Promise<SqlResult> {
  validateReadOnlySql(def.query);
  const { text, values } = bindNamedParams(
    def.query.trim().replace(/;\s*$/, ""),
    args,
    def.params,
    conn.dialect,
  );
  const host = await resolveDbHost(conn.host, policy);
  const limit = def.maxRows + 1;
  let rows: Record<string, unknown>[];

  if (conn.dialect === "postgres") {
    const sql = postgres({
      host,
      port: conn.port,
      database: conn.database,
      username: conn.user,
      password: conn.password,
      ssl: conn.ssl ? { servername: conn.host } : false,
      max: 1,
      connect_timeout: Math.ceil(def.timeoutMs / 1000),
      prepare: false,
      onnotice: () => undefined,
    });
    try {
      rows = await sql.begin("read only", async (tx) => {
        await tx.unsafe(`SET LOCAL statement_timeout = ${Math.floor(def.timeoutMs)}`);
        return (await tx.unsafe(
          `SELECT * FROM (${text}) AS q LIMIT ${limit}`,
          values as never[],
        )) as never;
      });
    } finally {
      await sql.end({ timeout: 2 });
    }
  } else if (conn.dialect === "mysql") {
    const db = await mysql.createConnection({
      // mysql2 cannot set the TLS servername: with SSL connect by (already validated) name.
      host: conn.ssl ? conn.host : host,
      port: conn.port,
      database: conn.database,
      user: conn.user,
      password: conn.password,
      ssl: conn.ssl ? {} : undefined,
      connectTimeout: def.timeoutMs,
      dateStrings: true,
    });
    try {
      await db.query(`SET SESSION MAX_EXECUTION_TIME = ${Math.floor(def.timeoutMs)}`);
      await db.query("START TRANSACTION READ ONLY");
      const [result] = await db.query(
        { sql: `SELECT * FROM (${text}) AS q LIMIT ${limit}`, timeout: def.timeoutMs },
        values,
      );
      await db.query("ROLLBACK");
      rows = result as Record<string, unknown>[];
    } finally {
      await db.end();
    }
  } else {
    const pool = await new mssql.ConnectionPool({
      server: host,
      port: conn.port,
      database: conn.database,
      user: conn.user,
      password: conn.password,
      connectionTimeout: def.timeoutMs,
      requestTimeout: def.timeoutMs,
      options: {
        encrypt: conn.ssl,
        trustServerCertificate: !conn.ssl,
        serverName: conn.ssl ? conn.host : undefined,
      },
    }).connect();
    const transaction = new mssql.Transaction(pool);
    try {
      await transaction.begin();
      const request = new mssql.Request(transaction);
      values.forEach((v, idx) => request.input(`p${idx + 1}`, v));
      // SQL Server has no read-only transaction: cap rows and always roll back.
      const result = await request.query(`SET ROWCOUNT ${limit}; ${text}; SET ROWCOUNT 0;`);
      rows = result.recordset as Record<string, unknown>[];
    } finally {
      await transaction.rollback().catch(() => undefined);
      await pool.close();
    }
  }

  const truncated = rows.length > def.maxRows;
  const kept = serialize(rows.slice(0, def.maxRows));
  return { columns: kept[0] ? Object.keys(kept[0]) : [], rows: kept, truncated };
}
