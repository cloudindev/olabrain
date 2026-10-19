-- RLS for the Phase 1 tables (same pattern as 0001_rls.sql).

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tenant_keys', 'credentials', 'connections', 'tools', 'agent_tools',
    'messages', 'tool_calls', 'pending_confirmations'
  ]
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

-- Tool call log and tenant keys are append-only for the app role.
REVOKE UPDATE, DELETE ON tool_calls FROM brainagent_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON tenant_keys FROM brainagent_app;
