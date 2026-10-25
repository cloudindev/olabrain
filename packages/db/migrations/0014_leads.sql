CREATE TYPE "public"."lead_status" AS ENUM('new', 'contacted', 'won', 'lost');--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agent_id" uuid,
	"agent_name" text DEFAULT '' NOT NULL,
	"conversation_id" uuid,
	"contact_id" uuid,
	"name" text DEFAULT '' NOT NULL,
	"email" text,
	"phone" text,
	"company" text,
	"request" text DEFAULT '' NOT NULL,
	"agent_notes" text DEFAULT '' NOT NULL,
	"comments" text DEFAULT '' NOT NULL,
	"status" "lead_status" DEFAULT 'new' NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leads_tenant_created_idx" ON "leads" USING btree ("tenant_id","created_at");--> statement-breakpoint
-- RLS for leads (same pattern as 0001/0003/0005).
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE leads FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON leads;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON leads FOR ALL TO PUBLIC
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
