-- Tenant of an enabled shared link (agent «Compartir»), for the public /c/{id} page.
-- Same pattern as public_channel_tenant (0011): ids only, the rest read under RLS.
CREATE OR REPLACE FUNCTION public_share_tenant(channel uuid) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT tenant_id FROM channels WHERE id = channel AND enabled AND kind = 'share_link' $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public_share_tenant(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public_share_tenant(uuid) TO brainagent_app;
