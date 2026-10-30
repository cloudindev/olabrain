/**
 * MyTutor cache entities (ADR-021): what the connector syncs and the panel lists. The
 * sync itself (endpoints, mapping) lives in apps/connector; this is the shared metadata.
 */
export const MYTUTOR_ENTITIES = [
  "clients",
  "suppliers",
  "services",
  "vehicles",
  "workers",
  "worker_documents",
  "expirations",
  "tach_vehicles",
  "tach_driver_cards",
  "tach_files",
  "consignment_notes",
  "waste_work_orders",
] as const;
export type MytutorEntity = (typeof MYTUTOR_ENTITIES)[number];

export const MYTUTOR_ENTITY_LABELS: Record<MytutorEntity, string> = {
  clients: "Clientes",
  suppliers: "Proveedores",
  services: "Servicios",
  vehicles: "Vehículos",
  workers: "Trabajadores",
  worker_documents: "Documentos de trabajadores",
  expirations: "Vencimientos",
  tach_vehicles: "Tacógrafo: vehículos",
  tach_driver_cards: "Tacógrafo: tarjetas",
  tach_files: "Tacógrafo: descargas",
  consignment_notes: "Documentos de control",
  waste_work_orders: "Órdenes de residuos",
};

/** Default sync cadence; each connection can change it. */
export const MYTUTOR_DEFAULT_SYNC_HOURS = 6;

/** Per-entity sync status kept in mytutor_sync_runs.entities. */
export type MytutorEntityStatus = {
  /** skipped: synced recently enough (heavy tables sync at most once a day). */
  status: "pending" | "running" | "done" | "skipped" | "error";
  /** Next page to fetch (resumable across function invocations). */
  page: number;
  records: number;
  error?: string;
  /** The endpoint rejected `sorting`: paginate without it. */
  noSort?: boolean;
};
