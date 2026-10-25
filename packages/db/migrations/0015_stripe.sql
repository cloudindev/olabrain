ALTER TABLE "wallets" ADD COLUMN "auto_recharge_attempted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN "stripe_payment_method_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_ledger_topup_ref_uq" ON "wallet_ledger" USING btree ("tenant_id",("data"->>'ref')) WHERE "wallet_ledger"."kind" = 'topup';