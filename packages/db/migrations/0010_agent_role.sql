ALTER TABLE "agents" ADD COLUMN "role" text DEFAULT '' NOT NULL;--> statement-breakpoint
-- Existing agents keep the role their persona used to give them (e.g. "Agenda").
UPDATE "agents" SET "role" = "personas"."role" FROM "personas" WHERE "agents"."persona_id" = "personas"."id" AND "agents"."role" = '';
