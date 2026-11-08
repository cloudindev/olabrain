-- Extranet agents (ADR-030): an agent for the organization's own customers, who sign in
-- with a one-time code and only ever see their own ERP customer's data and orders.
CREATE TYPE "public"."agent_kind" AS ENUM('standard', 'extranet');--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "kind" "agent_kind" DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "customer_account_id" uuid;--> statement-breakpoint
CREATE TYPE "public"."customer_account_status" AS ENUM('invited', 'active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."customer_order_status" AS ENUM('pending', 'entered', 'rejected');--> statement-breakpoint
CREATE TABLE "customer_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"erp_customer_ref" text NOT NULL,
	"customer_name" text DEFAULT '' NOT NULL,
	"email" text NOT NULL,
	"person_name" text DEFAULT '' NOT NULL,
	"contact_id" uuid,
	"status" "customer_account_status" DEFAULT 'invited' NOT NULL,
	"session_epoch" integer DEFAULT 0 NOT NULL,
	"invited_by_user_id" uuid,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_accounts_id_tenant_uq" UNIQUE("id","tenant_id"),
	CONSTRAINT "customer_accounts_agent_email_uq" UNIQUE("agent_id","email")
);
--> statement-breakpoint
CREATE TABLE "customer_login_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"agent_id" uuid,
	"customer_account_id" uuid,
	"connection_id" uuid NOT NULL,
	"erp_customer_ref" text NOT NULL,
	"customer_name" text DEFAULT '' NOT NULL,
	"placed_by" text DEFAULT '' NOT NULL,
	"conversation_id" uuid,
	"lines" jsonb NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"status" "customer_order_status" DEFAULT 'pending' NOT NULL,
	"erp_reference" text,
	"status_note" text DEFAULT '' NOT NULL,
	"handled_by_user_id" uuid,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_orders_tenant_number_uq" UNIQUE("tenant_id","number")
);
--> statement-breakpoint
ALTER TABLE "customer_accounts" ADD CONSTRAINT "customer_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_accounts" ADD CONSTRAINT "customer_accounts_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_accounts" ADD CONSTRAINT "customer_accounts_agent_fk" FOREIGN KEY ("agent_id","tenant_id") REFERENCES "public"."agents"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_accounts" ADD CONSTRAINT "customer_accounts_connection_fk" FOREIGN KEY ("connection_id","tenant_id") REFERENCES "public"."connections"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_login_codes" ADD CONSTRAINT "customer_login_codes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_login_codes" ADD CONSTRAINT "customer_login_codes_account_fk" FOREIGN KEY ("account_id","tenant_id") REFERENCES "public"."customer_accounts"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_orders" ADD CONSTRAINT "customer_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_orders" ADD CONSTRAINT "customer_orders_handled_by_user_id_users_id_fk" FOREIGN KEY ("handled_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_accounts_tenant_idx" ON "customer_accounts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "customer_login_codes_account_idx" ON "customer_login_codes" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "customer_orders_tenant_created_idx" ON "customer_orders" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "customer_orders_customer_idx" ON "customer_orders" USING btree ("connection_id","erp_customer_ref");--> statement-breakpoint
CREATE INDEX "conversations_customer_account_idx" ON "conversations" USING btree ("customer_account_id");--> statement-breakpoint
-- RLS (same pattern as 0001/0003/0005/0014).
ALTER TABLE customer_accounts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE customer_accounts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON customer_accounts FOR ALL TO PUBLIC
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE customer_login_codes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE customer_login_codes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON customer_login_codes FOR ALL TO PUBLIC
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE customer_orders ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE customer_orders FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON customer_orders FOR ALL TO PUBLIC
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
-- Tenant of an enabled extranet link, for the public /x/{id} page (same pattern as 0018).
CREATE OR REPLACE FUNCTION public_extranet_tenant(channel uuid) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT tenant_id FROM channels WHERE id = channel AND enabled AND kind = 'extranet' $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public_extranet_tenant(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public_extranet_tenant(uuid) TO brainagent_app;
