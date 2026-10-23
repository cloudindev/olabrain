CREATE TYPE "public"."wallet_entry_kind" AS ENUM('grant', 'usage', 'topup', 'adjustment');--> statement-breakpoint
CREATE TABLE "wallet_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" "wallet_entry_kind" NOT NULL,
	"amount_eur" numeric(14, 6) NOT NULL,
	"balance_after_eur" numeric(14, 6) NOT NULL,
	"conversation_id" uuid,
	"description" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"balance_eur" numeric(14, 6) DEFAULT '0' NOT NULL,
	"auto_recharge_threshold_eur" numeric(10, 2),
	"auto_recharge_amount_eur" numeric(10, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "price_eur" numeric(14, 6);--> statement-breakpoint
ALTER TABLE "wallet_ledger" ADD CONSTRAINT "wallet_ledger_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wallet_ledger_tenant_created_idx" ON "wallet_ledger" USING btree ("tenant_id","created_at");--> statement-breakpoint
-- RLS (same pattern as the other business tables).
ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE wallets FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON wallets FOR ALL TO PUBLIC
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE wallet_ledger ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE wallet_ledger FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON wallet_ledger FOR ALL TO PUBLIC
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
-- The ledger is append-only for the app (like audit_log and tool_calls).
REVOKE UPDATE, DELETE ON wallet_ledger FROM brainagent_app;
