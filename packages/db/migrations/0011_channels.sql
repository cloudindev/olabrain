CREATE TABLE "channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channels_agent_kind_uq" UNIQUE("agent_id","kind")
);
--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_agent_fk" FOREIGN KEY ("agent_id","tenant_id") REFERENCES "public"."agents"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "channels_tenant_idx" ON "channels" USING btree ("tenant_id");--> statement-breakpoint
-- RLS (same pattern as 0001/0003/0005/0008).
ALTER TABLE channels ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE channels FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON channels;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON channels FOR ALL TO PUBLIC
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
-- Public widget requests only carry the channel id: this resolves its organization (and
-- nothing else) so the request can continue inside that tenant's RLS context.
CREATE OR REPLACE FUNCTION public_channel_tenant(channel uuid) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT tenant_id FROM channels WHERE id = channel AND enabled AND kind = 'web_widget' $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public_channel_tenant(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public_channel_tenant(uuid) TO brainagent_app;
