CREATE TYPE "public"."mytutor_sync_status" AS ENUM('running', 'done', 'error');--> statement-breakpoint
CREATE TABLE "mytutor_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"source_id" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"ref" text,
	"status" text,
	"occurred_at" timestamp with time zone,
	"parent_id" text,
	"file_id" text,
	"search" text DEFAULT '' NOT NULL,
	"raw" jsonb NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mytutor_consignment_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"source_id" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"ref" text,
	"status" text,
	"occurred_at" timestamp with time zone,
	"parent_id" text,
	"file_id" text,
	"search" text DEFAULT '' NOT NULL,
	"raw" jsonb NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mytutor_expirations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"source_id" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"ref" text,
	"status" text,
	"occurred_at" timestamp with time zone,
	"parent_id" text,
	"file_id" text,
	"search" text DEFAULT '' NOT NULL,
	"raw" jsonb NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mytutor_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"source_id" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"ref" text,
	"status" text,
	"occurred_at" timestamp with time zone,
	"parent_id" text,
	"file_id" text,
	"search" text DEFAULT '' NOT NULL,
	"raw" jsonb NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mytutor_suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"source_id" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"ref" text,
	"status" text,
	"occurred_at" timestamp with time zone,
	"parent_id" text,
	"file_id" text,
	"search" text DEFAULT '' NOT NULL,
	"raw" jsonb NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mytutor_sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"status" "mytutor_sync_status" DEFAULT 'running' NOT NULL,
	"trigger" text DEFAULT 'schedule' NOT NULL,
	"entities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "mytutor_tach_driver_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"source_id" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"ref" text,
	"status" text,
	"occurred_at" timestamp with time zone,
	"parent_id" text,
	"file_id" text,
	"search" text DEFAULT '' NOT NULL,
	"raw" jsonb NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mytutor_tach_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"source_id" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"ref" text,
	"status" text,
	"occurred_at" timestamp with time zone,
	"parent_id" text,
	"file_id" text,
	"search" text DEFAULT '' NOT NULL,
	"raw" jsonb NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mytutor_tach_vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"source_id" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"ref" text,
	"status" text,
	"occurred_at" timestamp with time zone,
	"parent_id" text,
	"file_id" text,
	"search" text DEFAULT '' NOT NULL,
	"raw" jsonb NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mytutor_vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"source_id" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"ref" text,
	"status" text,
	"occurred_at" timestamp with time zone,
	"parent_id" text,
	"file_id" text,
	"search" text DEFAULT '' NOT NULL,
	"raw" jsonb NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mytutor_waste_work_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"source_id" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"ref" text,
	"status" text,
	"occurred_at" timestamp with time zone,
	"parent_id" text,
	"file_id" text,
	"search" text DEFAULT '' NOT NULL,
	"raw" jsonb NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mytutor_worker_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"source_id" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"ref" text,
	"status" text,
	"occurred_at" timestamp with time zone,
	"parent_id" text,
	"file_id" text,
	"search" text DEFAULT '' NOT NULL,
	"raw" jsonb NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mytutor_workers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"source_id" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"ref" text,
	"status" text,
	"occurred_at" timestamp with time zone,
	"parent_id" text,
	"file_id" text,
	"search" text DEFAULT '' NOT NULL,
	"raw" jsonb NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mytutor_clients" ADD CONSTRAINT "mytutor_clients_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mytutor_clients" ADD CONSTRAINT "mytutor_clients_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mytutor_consignment_notes" ADD CONSTRAINT "mytutor_consignment_notes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mytutor_consignment_notes" ADD CONSTRAINT "mytutor_consignment_notes_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mytutor_expirations" ADD CONSTRAINT "mytutor_expirations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mytutor_expirations" ADD CONSTRAINT "mytutor_expirations_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mytutor_services" ADD CONSTRAINT "mytutor_services_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mytutor_services" ADD CONSTRAINT "mytutor_services_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mytutor_suppliers" ADD CONSTRAINT "mytutor_suppliers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mytutor_suppliers" ADD CONSTRAINT "mytutor_suppliers_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mytutor_sync_runs" ADD CONSTRAINT "mytutor_sync_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mytutor_sync_runs" ADD CONSTRAINT "mytutor_sync_runs_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mytutor_tach_driver_cards" ADD CONSTRAINT "mytutor_tach_driver_cards_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mytutor_tach_driver_cards" ADD CONSTRAINT "mytutor_tach_driver_cards_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mytutor_tach_files" ADD CONSTRAINT "mytutor_tach_files_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mytutor_tach_files" ADD CONSTRAINT "mytutor_tach_files_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mytutor_tach_vehicles" ADD CONSTRAINT "mytutor_tach_vehicles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mytutor_tach_vehicles" ADD CONSTRAINT "mytutor_tach_vehicles_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mytutor_vehicles" ADD CONSTRAINT "mytutor_vehicles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mytutor_vehicles" ADD CONSTRAINT "mytutor_vehicles_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mytutor_waste_work_orders" ADD CONSTRAINT "mytutor_waste_work_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mytutor_waste_work_orders" ADD CONSTRAINT "mytutor_waste_work_orders_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mytutor_worker_documents" ADD CONSTRAINT "mytutor_worker_documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mytutor_worker_documents" ADD CONSTRAINT "mytutor_worker_documents_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mytutor_workers" ADD CONSTRAINT "mytutor_workers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mytutor_workers" ADD CONSTRAINT "mytutor_workers_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mytutor_clients_source_uq" ON "mytutor_clients" USING btree ("connection_id","source_id");--> statement-breakpoint
CREATE INDEX "mytutor_clients_tenant_idx" ON "mytutor_clients" USING btree ("tenant_id","connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mytutor_consignment_notes_source_uq" ON "mytutor_consignment_notes" USING btree ("connection_id","source_id");--> statement-breakpoint
CREATE INDEX "mytutor_consignment_notes_tenant_idx" ON "mytutor_consignment_notes" USING btree ("tenant_id","connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mytutor_expirations_source_uq" ON "mytutor_expirations" USING btree ("connection_id","source_id");--> statement-breakpoint
CREATE INDEX "mytutor_expirations_tenant_idx" ON "mytutor_expirations" USING btree ("tenant_id","connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mytutor_services_source_uq" ON "mytutor_services" USING btree ("connection_id","source_id");--> statement-breakpoint
CREATE INDEX "mytutor_services_tenant_idx" ON "mytutor_services" USING btree ("tenant_id","connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mytutor_suppliers_source_uq" ON "mytutor_suppliers" USING btree ("connection_id","source_id");--> statement-breakpoint
CREATE INDEX "mytutor_suppliers_tenant_idx" ON "mytutor_suppliers" USING btree ("tenant_id","connection_id");--> statement-breakpoint
CREATE INDEX "mytutor_sync_runs_conn_idx" ON "mytutor_sync_runs" USING btree ("connection_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mytutor_tach_driver_cards_source_uq" ON "mytutor_tach_driver_cards" USING btree ("connection_id","source_id");--> statement-breakpoint
CREATE INDEX "mytutor_tach_driver_cards_tenant_idx" ON "mytutor_tach_driver_cards" USING btree ("tenant_id","connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mytutor_tach_files_source_uq" ON "mytutor_tach_files" USING btree ("connection_id","source_id");--> statement-breakpoint
CREATE INDEX "mytutor_tach_files_tenant_idx" ON "mytutor_tach_files" USING btree ("tenant_id","connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mytutor_tach_vehicles_source_uq" ON "mytutor_tach_vehicles" USING btree ("connection_id","source_id");--> statement-breakpoint
CREATE INDEX "mytutor_tach_vehicles_tenant_idx" ON "mytutor_tach_vehicles" USING btree ("tenant_id","connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mytutor_vehicles_source_uq" ON "mytutor_vehicles" USING btree ("connection_id","source_id");--> statement-breakpoint
CREATE INDEX "mytutor_vehicles_tenant_idx" ON "mytutor_vehicles" USING btree ("tenant_id","connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mytutor_waste_work_orders_source_uq" ON "mytutor_waste_work_orders" USING btree ("connection_id","source_id");--> statement-breakpoint
CREATE INDEX "mytutor_waste_work_orders_tenant_idx" ON "mytutor_waste_work_orders" USING btree ("tenant_id","connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mytutor_worker_documents_source_uq" ON "mytutor_worker_documents" USING btree ("connection_id","source_id");--> statement-breakpoint
CREATE INDEX "mytutor_worker_documents_tenant_idx" ON "mytutor_worker_documents" USING btree ("tenant_id","connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mytutor_workers_source_uq" ON "mytutor_workers" USING btree ("connection_id","source_id");--> statement-breakpoint
CREATE INDEX "mytutor_workers_tenant_idx" ON "mytutor_workers" USING btree ("tenant_id","connection_id");
--> statement-breakpoint
-- RLS for the MyTutor cache (same pattern as the other business tables).
ALTER TABLE mytutor_clients ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE mytutor_clients FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON mytutor_clients FOR ALL TO PUBLIC
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE mytutor_suppliers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE mytutor_suppliers FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON mytutor_suppliers FOR ALL TO PUBLIC
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE mytutor_services ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE mytutor_services FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON mytutor_services FOR ALL TO PUBLIC
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE mytutor_vehicles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE mytutor_vehicles FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON mytutor_vehicles FOR ALL TO PUBLIC
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE mytutor_workers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE mytutor_workers FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON mytutor_workers FOR ALL TO PUBLIC
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE mytutor_worker_documents ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE mytutor_worker_documents FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON mytutor_worker_documents FOR ALL TO PUBLIC
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE mytutor_expirations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE mytutor_expirations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON mytutor_expirations FOR ALL TO PUBLIC
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE mytutor_tach_vehicles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE mytutor_tach_vehicles FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON mytutor_tach_vehicles FOR ALL TO PUBLIC
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE mytutor_tach_driver_cards ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE mytutor_tach_driver_cards FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON mytutor_tach_driver_cards FOR ALL TO PUBLIC
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE mytutor_tach_files ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE mytutor_tach_files FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON mytutor_tach_files FOR ALL TO PUBLIC
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE mytutor_consignment_notes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE mytutor_consignment_notes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON mytutor_consignment_notes FOR ALL TO PUBLIC
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE mytutor_waste_work_orders ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE mytutor_waste_work_orders FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON mytutor_waste_work_orders FOR ALL TO PUBLIC
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE mytutor_sync_runs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE mytutor_sync_runs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON mytutor_sync_runs FOR ALL TO PUBLIC
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
-- One running sync per connection at a time.
CREATE UNIQUE INDEX mytutor_sync_runs_one_running ON mytutor_sync_runs (connection_id) WHERE status = 'running';
--> statement-breakpoint
-- MyTutor connections whose sync is due (or has a run to resume), across tenants, for the
-- scheduler. Returns ids only; the sync itself runs inside each tenant's RLS transaction.
CREATE OR REPLACE FUNCTION mytutor_due_connections() RETURNS TABLE (tenant_id uuid, connection_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT c.tenant_id, c.id FROM connections c
     WHERE c.kind = 'native' AND c.config->>'provider' = 'mytutor' AND c.status = 'active'
       AND (
         EXISTS (SELECT 1 FROM mytutor_sync_runs r WHERE r.connection_id = c.id AND r.status = 'running')
         OR COALESCE((c.config->>'lastSyncAt')::timestamptz, 'epoch'::timestamptz)
            + make_interval(hours => COALESCE((c.config->>'syncEveryHours')::int, 6)) <= now()
       )
     ORDER BY COALESCE((c.config->>'lastSyncAt')::timestamptz, 'epoch'::timestamptz) $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION mytutor_due_connections() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION mytutor_due_connections() TO brainagent_app;
