CREATE TYPE "public"."memory_source" AS ENUM('auto', 'explicit', 'manual');--> statement-breakpoint
CREATE TABLE "contact_memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"content" text NOT NULL,
	"source" "memory_source" NOT NULL,
	"conversation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"email" text,
	"phone" text,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contacts_id_tenant_uq" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "contact_id" uuid;--> statement-breakpoint
ALTER TABLE "contact_memories" ADD CONSTRAINT "contact_memories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_memories" ADD CONSTRAINT "contact_memories_contact_fk" FOREIGN KEY ("contact_id","tenant_id") REFERENCES "public"."contacts"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_memories_contact_idx" ON "contact_memories" USING btree ("contact_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_tenant_user_uq" ON "contacts" USING btree ("tenant_id","user_id") WHERE "contacts"."user_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_tenant_email_uq" ON "contacts" USING btree ("tenant_id","email") WHERE "contacts"."email" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_tenant_phone_uq" ON "contacts" USING btree ("tenant_id","phone") WHERE "contacts"."phone" IS NOT NULL;