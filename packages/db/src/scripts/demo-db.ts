/**
 * Demo database for the reference tools partes_hoy(fecha) and horas_equipo(fecha)
 * (CLAUDE.md §6, Fase 1). Creates `demo_ops` with a read-only user and data around today.
 * Development only: `pnpm db:demo`.
 */
import { config } from "dotenv";
import postgres from "postgres";

config({ path: new URL("../../../../.env", import.meta.url).pathname, quiet: true });

const adminUrl = process.env.DATABASE_URL_ADMIN;
const password = process.env.DEMO_DB_PASSWORD;
if (!adminUrl || !password) {
  console.error("DATABASE_URL_ADMIN and DEMO_DB_PASSWORD must be set");
  process.exit(1);
}

const server = postgres(adminUrl, { max: 1, onnotice: () => undefined });
const [exists] = await server`select 1 from pg_database where datname = 'demo_ops'`;
if (!exists) await server.unsafe("CREATE DATABASE demo_ops");
const [role] = await server`select 1 from pg_roles where rolname = 'demo_reader'`;
const pw = (await server`select format('%L', ${password}::text) as q`)[0]!.q as string;
await server.unsafe(role ? `ALTER ROLE demo_reader WITH LOGIN PASSWORD ${pw}` : `CREATE ROLE demo_reader LOGIN PASSWORD ${pw}`);
await server.end();

const url = new URL(adminUrl);
url.pathname = "/demo_ops";
const db = postgres(url.toString(), { max: 1, onnotice: () => undefined });
await db.unsafe(`
  DROP TABLE IF EXISTS partes, horas;
  CREATE TABLE partes (
    id serial PRIMARY KEY,
    fecha date NOT NULL,
    cliente text NOT NULL,
    direccion text NOT NULL,
    tecnico text NOT NULL,
    estado text NOT NULL CHECK (estado IN ('pendiente', 'en curso', 'cerrado')),
    descripcion text NOT NULL
  );
  CREATE TABLE horas (
    id serial PRIMARY KEY,
    fecha date NOT NULL,
    tecnico text NOT NULL,
    horas numeric(4,1) NOT NULL,
    proyecto text NOT NULL
  );
  INSERT INTO partes (fecha, cliente, direccion, tecnico, estado, descripcion) VALUES
    (current_date, 'Clínica Dental Sol', 'C/ Mayor 12, Madrid', 'Ana López', 'en curso', 'Revisión de climatización'),
    (current_date, 'Panadería Hermanos Gil', 'Av. Libertad 3, Getafe', 'Luis Martín', 'pendiente', 'Avería en horno eléctrico'),
    (current_date, 'Gestoría Ruiz', 'C/ Alcalá 200, Madrid', 'Ana López', 'pendiente', 'Instalación de enchufes'),
    (current_date, 'Hotel Prado', 'Paseo del Prado 8, Madrid', 'Marta Sanz', 'cerrado', 'Cambio de luminarias'),
    (current_date - 1, 'Clínica Dental Sol', 'C/ Mayor 12, Madrid', 'Luis Martín', 'cerrado', 'Mantenimiento preventivo'),
    (current_date + 1, 'Colegio San José', 'C/ Toledo 45, Madrid', 'Marta Sanz', 'pendiente', 'Revisión cuadro eléctrico');
  INSERT INTO horas (fecha, tecnico, horas, proyecto) VALUES
    (current_date, 'Ana López', 6.5, 'Clínica Dental Sol'),
    (current_date, 'Luis Martín', 4.0, 'Panadería Hermanos Gil'),
    (current_date, 'Marta Sanz', 7.5, 'Hotel Prado'),
    (current_date - 1, 'Luis Martín', 8.0, 'Clínica Dental Sol'),
    (current_date - 1, 'Ana López', 7.0, 'Oficina'),
    (current_date - 1, 'Marta Sanz', 3.5, 'Colegio San José');
  REVOKE ALL ON ALL TABLES IN SCHEMA public FROM demo_reader;
  GRANT USAGE ON SCHEMA public TO demo_reader;
  GRANT SELECT ON partes, horas TO demo_reader;
`);
await db.end();
console.log("demo_ops ready (user demo_reader, read-only)");
