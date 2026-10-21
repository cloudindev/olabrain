-- RLS for conversation files (same pattern as 0001/0003/0005).
ALTER TABLE conversation_files ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE conversation_files FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON conversation_files;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON conversation_files FOR ALL TO PUBLIC
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
