-- Row Level Security for every business table (ADR-002).
--
-- The app connects as `brainagent_app`: not the table owner and without BYPASSRLS, so
-- policies always apply. FORCE RLS also applies them to the owner, so a mistake in the
-- connection string fails closed instead of leaking data.
-- The tenant comes from `app.tenant_id`, set per transaction by withTenant().

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'brainagent_app') THEN
    CREATE ROLE brainagent_app NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint

-- NULLIF: after a transaction-local set_config ends, the setting reads as '' (not NULL).
CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;
--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO brainagent_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO brainagent_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO brainagent_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_current_tenant() TO brainagent_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO brainagent_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO brainagent_app;
--> statement-breakpoint

-- Standard isolation for tables whose tenant_id is NOT NULL.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['agents', 'conversations', 'turn_metrics', 'usage_events', 'audit_log']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL TO PUBLIC
         USING (tenant_id = app_current_tenant())
         WITH CHECK (tenant_id = app_current_tenant())',
      t
    );
  END LOOP;
END
$$;
--> statement-breakpoint

-- audit_log is append-only for the app.
REVOKE UPDATE, DELETE ON audit_log FROM brainagent_app;
--> statement-breakpoint

-- personas: tenant_id NULL is the global catalog. Every tenant reads it; only the
-- migration/seed role (owner) writes it, because writes require tenant_id = current tenant.
ALTER TABLE personas ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE personas FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY personas_read ON personas FOR SELECT TO PUBLIC
  USING (tenant_id IS NULL OR tenant_id = app_current_tenant());
--> statement-breakpoint
CREATE POLICY personas_insert ON personas FOR INSERT TO PUBLIC
  WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
CREATE POLICY personas_update ON personas FOR UPDATE TO PUBLIC
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
CREATE POLICY personas_delete ON personas FOR DELETE TO PUBLIC
  USING (tenant_id = app_current_tenant());
--> statement-breakpoint

-- The seed (owner role) maintains the global catalog. FORCE RLS applies to the owner too,
-- so it gets an explicit policy limited to global rows.
CREATE POLICY personas_catalog_owner ON personas FOR ALL TO CURRENT_USER
  USING (tenant_id IS NULL)
  WITH CHECK (tenant_id IS NULL);
