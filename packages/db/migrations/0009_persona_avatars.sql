ALTER TABLE "personas" ADD COLUMN "avatar_url" text;--> statement-breakpoint
ALTER TABLE "personas" ADD COLUMN "avatar_video" text;--> statement-breakpoint
-- Catalog persona "Sara" is now "Enzo": rename the slug so agents using it keep their persona.
UPDATE "personas" SET "slug" = 'enzo', "name" = 'Enzo' WHERE "tenant_id" IS NULL AND "slug" = 'sara';
