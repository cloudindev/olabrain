-- RLS for contacts and their memories (same pattern as 0001/0003).

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['contacts', 'contact_memories']
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

-- A conversation belongs to at most one contact of the same tenant. Deleting the contact
-- (RGPD erasure) detaches its conversations; the UI can also delete them explicitly.
ALTER TABLE conversations
  ADD CONSTRAINT conversations_contact_fk
  FOREIGN KEY (contact_id, tenant_id) REFERENCES contacts (id, tenant_id)
  ON DELETE SET NULL (contact_id);
--> statement-breakpoint
CREATE INDEX conversations_contact_idx ON conversations (contact_id);
