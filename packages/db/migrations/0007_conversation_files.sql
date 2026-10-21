CREATE TABLE "conversation_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"media_type" text NOT NULL,
	"size" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '1 day' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation_files" ADD CONSTRAINT "conversation_files_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_files" ADD CONSTRAINT "conversation_files_conversation_fk" FOREIGN KEY ("conversation_id","tenant_id") REFERENCES "public"."conversations"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_files_conversation_idx" ON "conversation_files" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "conversation_files_expires_idx" ON "conversation_files" USING btree ("expires_at");