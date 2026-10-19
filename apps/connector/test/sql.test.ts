import type { StudioParam } from "@brainagent/core";
import { TEST_ADMIN_URL } from "@brainagent/db/test-env";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EgressBlockedError } from "../src/egress";
import {
  SqlValidationError,
  bindNamedParams,
  runReadOnlyQuery,
  validateReadOnlySql,
} from "../src/adapters/sql";

describe("validateReadOnlySql", () => {
  it.each([
    "SELECT * FROM partes WHERE fecha = :fecha",
    "with t as (select 1 as x) select x from t",
    "SELECT replace(nombre, 'a', 'b') AS n FROM clientes;",
    "SELECT 'DELETE FROM x; DROP TABLE y' AS texto",
    'SELECT "update" FROM t -- comentario con delete',
    "SELECT id::text FROM t",
  ])("accepts %s", (q) => {
    expect(() => validateReadOnlySql(q)).not.toThrow();
  });

  it.each([
    ["DELETE FROM partes", /SELECT o WITH/],
    ["SELECT 1; DROP TABLE partes", /una sentencia/],
    ["WITH d AS (DELETE FROM partes RETURNING *) SELECT * FROM d", /DELETE/],
    ["SELECT * INTO copia FROM partes", /INTO/],
    ["SELECT * FROM partes FOR UPDATE", /UPDATE/],
    ["SELECT pg_sleep(10)", /PG_SLEEP/],
    ["SELECT * FROM t /* sin cerrar", /comentario/],
    ["SELECT 'sin cerrar", /literal/],
    ["SELECT $$x$$", /\$\$/],
    ["  ", /vacía/],
  ])("rejects %s", (q, msg) => {
    expect(() => validateReadOnlySql(q)).toThrow(msg);
  });
});

describe("bindNamedParams", () => {
  const params: StudioParam[] = [
    { name: "fecha", type: "date", description: "", required: true },
    { name: "limite", type: "integer", description: "", required: false },
  ];

  it("binds per dialect and keeps casts and literals untouched", () => {
    const q = "SELECT ':fecha' AS lit, x::date FROM t WHERE f = :fecha AND n < :limite";
    expect(bindNamedParams(q, { fecha: "2026-10-20", limite: 5 }, params, "postgres")).toEqual({
      text: "SELECT ':fecha' AS lit, x::date FROM t WHERE f = $1 AND n < $2",
      values: ["2026-10-20", 5],
    });
    expect(bindNamedParams(q, { fecha: "2026-10-20" }, params, "mysql").text).toContain(
      "f = ? AND n < ?",
    );
    expect(bindNamedParams(q, { fecha: "2026-10-20" }, params, "mssql").text).toContain(
      "f = @p1 AND n < @p2",
    );
  });

  it("validates types, required params and unknown params", () => {
    expect(() => bindNamedParams("SELECT :fecha", {}, params, "postgres")).toThrow(/falta/);
    expect(() =>
      bindNamedParams("SELECT :fecha", { fecha: "20/10/2026" }, params, "postgres"),
    ).toThrow(/AAAA-MM-DD/);
    expect(() => bindNamedParams("SELECT :otro", {}, params, "postgres")).toThrow(
      SqlValidationError,
    );
  });

  it("treats injection attempts as plain values", () => {
    const { values } = bindNamedParams(
      "SELECT * FROM t WHERE nombre = :nombre",
      { nombre: "x'; DROP TABLE t; --" },
      [{ name: "nombre", type: "string", description: "", required: true }],
      "postgres",
    );
    expect(values).toEqual(["x'; DROP TABLE t; --"]);
  });
});

describe("runReadOnlyQuery (Postgres)", () => {
  const url = new URL(TEST_ADMIN_URL);
  const conn = {
    dialect: "postgres" as const,
    host: url.hostname,
    port: Number(url.port || 5432),
    database: url.pathname.slice(1),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ssl: false,
  };
  const policy = { allowedPrivateHosts: ["localhost", "127.0.0.1"] };
  const admin = postgres(TEST_ADMIN_URL, { max: 1, onnotice: () => undefined });

  beforeAll(async () => {
    await admin.unsafe(`
      CREATE SCHEMA IF NOT EXISTS sqltest;
      DROP TABLE IF EXISTS sqltest.partes;
      CREATE TABLE sqltest.partes (id int, fecha date, tecnico text);
      INSERT INTO sqltest.partes SELECT g, DATE '2026-10-20', 'Ana' FROM generate_series(1, 30) g;
    `);
  });

  afterAll(async () => {
    await admin.unsafe("DROP SCHEMA IF EXISTS sqltest CASCADE");
    await admin.end();
  });

  const def = {
    query: "SELECT id, fecha, tecnico FROM sqltest.partes WHERE fecha = :fecha ORDER BY id",
    params: [{ name: "fecha", type: "date" as const, description: "", required: true }],
    maxRows: 10,
    timeoutMs: 3_000,
  };

  it("returns rows capped at maxRows and flags truncation", async () => {
    const res = await runReadOnlyQuery(conn, def, { fecha: "2026-10-20" }, policy);
    expect(res.rows).toHaveLength(10);
    expect(res.truncated).toBe(true);
    expect(res.columns).toEqual(["id", "fecha", "tecnico"]);
    expect(res.rows[0]).toMatchObject({ id: 1, tecnico: "Ana" });
  });

  it("runs in a read-only transaction even if validation were bypassed", async () => {
    // A function that writes is not caught by the keyword check; the transaction stops it.
    await admin.unsafe(`
      CREATE OR REPLACE FUNCTION sqltest.sneaky() RETURNS int LANGUAGE sql AS
      $$ INSERT INTO sqltest.partes VALUES (999, DATE '2026-10-20', 'x') RETURNING 1 $$;
    `);
    await expect(
      runReadOnlyQuery(
        conn,
        { ...def, query: "SELECT sqltest.sneaky() AS r", params: [] },
        {},
        policy,
      ),
    ).rejects.toThrow(/read-only/);
  });

  it("enforces the statement timeout", async () => {
    await admin.unsafe(`
      CREATE OR REPLACE FUNCTION sqltest.slow() RETURNS int LANGUAGE sql AS $$ SELECT 1 FROM pg_sleep(2) $$;
    `);
    await expect(
      runReadOnlyQuery(
        conn,
        { ...def, query: "SELECT sqltest.slow() AS r", params: [], timeoutMs: 300 },
        {},
        policy,
      ),
    ).rejects.toThrow(/timeout/);
  });

  it("refuses private database hosts that are not allowlisted", async () => {
    await expect(
      runReadOnlyQuery(conn, def, { fecha: "2026-10-20" }, { allowedPrivateHosts: [] }),
    ).rejects.toThrow(EgressBlockedError);
  });
});
