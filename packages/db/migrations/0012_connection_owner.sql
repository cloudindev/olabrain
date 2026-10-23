ALTER TABLE "connections" ADD COLUMN "agent_id" uuid;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_agent_fk" FOREIGN KEY ("agent_id","tenant_id") REFERENCES "public"."agents"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "connections_agent_idx" ON "connections" USING btree ("agent_id");--> statement-breakpoint
-- Each existing connection goes to the first agent that had its tools; other agents lose
-- them (connections are no longer shared between agents).
UPDATE "connections" c SET "agent_id" = owner.agent_id
FROM (
  SELECT DISTINCT ON (t.connection_id) t.connection_id, at.agent_id
  FROM "agent_tools" at
  JOIN "tools" t ON t.id = at.tool_id
  JOIN "agents" a ON a.id = at.agent_id
  ORDER BY t.connection_id, a.created_at, a.id
) owner
WHERE c.id = owner.connection_id AND c.agent_id IS NULL;
--> statement-breakpoint
DELETE FROM "agent_tools" at
USING "tools" t, "connections" c
WHERE t.id = at.tool_id AND c.id = t.connection_id
  AND (c.agent_id IS NULL OR c.agent_id <> at.agent_id);
