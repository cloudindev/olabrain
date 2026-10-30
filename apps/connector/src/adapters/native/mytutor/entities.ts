/**
 * What each MyTutor cache table is synced from and how a source record maps to its
 * columns. Field names come from the observed API (docs/connectors/mytutor-schema.md).
 */
import type { MytutorEntity } from "@brainagent/core";
import type { MytutorFilter } from "./client";

type Row = Record<string, unknown>;

export type MappedRecord = {
  sourceId: string;
  name: string;
  ref: string | null;
  status: string | null;
  occurredAt: Date | null;
  parentId: string | null;
  fileId: string | null;
  search: string;
  raw: Row;
};

export type EntitySpec = {
  entity: MytutorEntity;
  /** Table endpoint (paginated with companies/page/size/filter/sorting). */
  path?: string;
  filter?: MytutorFilter[];
  extra?: Record<string, string>;
  /** Built from the cards of another entity's records instead of a table endpoint. */
  fromParent?: {
    parent: MytutorEntity;
    /** Card endpoint of one parent record. */
    path: (parentSourceId: string) => string;
    children: (card: Row) => Row[];
  };
  /** Minimum hours between two syncs of this entity (heavy tables). */
  minHours?: number;
  map: (r: Row) => MappedRecord | null;
};

const str = (v: unknown): string | null =>
  v === null || v === undefined || v === "" ? null : String(v);
const date = (v: unknown): Date | null => {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
const obj = (v: unknown): Row =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {};

/** Lower-case, accent-free text for search. */
export function normalize(...parts: unknown[]): string {
  return parts
    .filter((p) => p !== null && p !== undefined && p !== "")
    .map((p) => String(p))
    .join(" ")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const NAME_KEYS =
  /^(id|name|nombre|corporate_name|brand_name|fullName|surname|code|description|license_plate|licensePlate|cif_nif|NIF|type|status)$/;

/**
 * Keeps scalars and, for nested objects/arrays of objects, only their ids and names: the
 * waste orders carry ~10 KB of nested documents each that nobody searches by.
 */
export function trim(r: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(r)) {
    if (v === null || typeof v !== "object") out[k] = v;
    else if (Array.isArray(v)) {
      out[k] = v.slice(0, 50).map((x) => (x && typeof x === "object" ? pick(x as Row) : x));
    } else out[k] = pick(v as Row);
  }
  return out;
}
function pick(o: Row): Row {
  return Object.fromEntries(
    Object.entries(o).filter(
      ([k, v]) => NAME_KEYS.test(k) && (v === null || typeof v !== "object"),
    ),
  );
}

const fullName = (...p: unknown[]) => p.filter(Boolean).join(" ").trim();

function clientLike(r: Row): MappedRecord {
  const name = String(r.corporate_name ?? r.brand_name ?? "");
  return {
    sourceId: String(r.id),
    name,
    ref: str(r.cif_nif),
    status: r.is_active === false ? "inactive" : "active",
    occurredAt: date(r.updatedAt),
    parentId: null,
    fileId: null,
    search: normalize(name, r.brand_name, r.cif_nif, r.extra_external_id),
    raw: r,
  };
}

/** Worker documents inside a worker card (`workers/{id}?allDocuments=true`). */
const DOC_LISTS = ["aditionalDocuments", "regulatedStudies", "certifications"] as const;
function fileIdOf(d: Row): string | null {
  return str(d.fileId ?? d.file_id ?? d.pdfFileId ?? obj(d.file).id ?? obj(d.document).fileId);
}

export const ENTITIES: EntitySpec[] = [
  {
    entity: "clients",
    path: "clients/tableCompany/Client",
    map: clientLike,
  },
  {
    entity: "suppliers",
    path: "clients/tableCompany/Supplier",
    map: clientLike,
  },
  {
    // ProfiDATA › Empresa › Servicios (forceIsGlobal: the company's catalog, not per client).
    entity: "services",
    path: "company-service/paginated",
    extra: { forceIsGlobal: "true", showCompany: "false" },
    map: (r) => ({
      sourceId: String(r.id),
      name: String(r.name ?? ""),
      ref: str(r.legacyId),
      status: str(r.type),
      occurredAt: date(r.updatedAt),
      parentId: str(r.clientId),
      fileId: null,
      search: normalize(r.name, r.description, r.type),
      raw: r,
    }),
  },
  {
    entity: "vehicles",
    path: "vehicles/table",
    map: (r) => {
      const name = fullName(r.licensePlate, r.brand, r.model);
      return {
        sourceId: String(r.id),
        name,
        ref: str(r.licensePlate),
        status: r.isDeregistered ? "deregistered" : "active",
        occurredAt: date(r.registrationDate),
        parentId: str(r.workerId),
        fileId: null,
        search: normalize(
          r.licensePlate,
          String(r.licensePlate ?? "").replace(/\W/g, ""),
          r.brand,
          r.model,
          r.type,
        ),
        raw: r,
      };
    },
  },
  {
    entity: "workers",
    path: "workers/table-workers",
    map: (r) => {
      const wc = (Array.isArray(r.workerCompanies) ? r.workerCompanies[0] : null) as Row | null;
      const name = String(r.fullName ?? fullName(r.name, r.surname));
      return {
        sourceId: String(r.id),
        name,
        ref: str(r.NIF),
        status: str(wc?.workerStatus) ?? (r.isActive === false ? "inactive" : "active"),
        occurredAt: date(r.registrationDate),
        parentId: str(r.vehicleId),
        fileId: null,
        search: normalize(name, r.NIF, r.email),
        raw: r,
      };
    },
  },
  {
    entity: "worker_documents",
    fromParent: {
      parent: "workers",
      path: (id) => `workers/${id}?allDocuments=true`,
      children: (card) =>
        DOC_LISTS.flatMap((list) =>
          (Array.isArray(card[list]) ? (card[list] as Row[]) : []).map((d) => ({
            ...d,
            _list: list,
            _workerId: card.id,
            _workerName: card.fullName ?? fullName(card.name, card.surname),
          })),
        ),
    },
    map: (d) => {
      const name = String(d.name ?? d.documentType ?? d.type ?? d.title ?? d._list);
      return {
        sourceId: `${d._list}:${d.id}`,
        name,
        ref: str(d.number ?? d.code),
        status: str(d.status),
        occurredAt: date(d.endDate ?? d.expirationDate ?? d.expiration_date ?? d.validUntil),
        parentId: str(d._workerId),
        fileId: fileIdOf(d),
        search: normalize(name, d._workerName, d.documentType),
        raw: d,
      };
    },
  },
  {
    entity: "expirations",
    path: "expiration/table",
    extra: { scope: "company" },
    map: (r) => {
      const wc = obj(r.workerCertification);
      const vh = obj(r.vehicleHomologation);
      const who = str(obj(wc.worker).fullName ?? vh.licensePlate ?? obj(vh.vehicle).licensePlate);
      const name = fullName(r.documentType, who ? `· ${who}` : "");
      return {
        sourceId: String(r.id),
        name,
        ref: who,
        status: str(r.type),
        occurredAt: date(r.endDate),
        parentId: str(wc.workerId ?? vh.vehicleId),
        fileId: str(wc.fileId ?? vh.fileId),
        search: normalize(r.documentType, r.type, who),
        raw: r,
      };
    },
  },
  {
    entity: "tach_vehicles",
    path: "profitach/vehicles",
    map: (r) => ({
      sourceId: String(r.id),
      name: String(r.registrationNumber ?? ""),
      ref: str(r.registrationNumber),
      status: r.disabled ? "disabled" : str(r.status),
      occurredAt: date(r.lastDownloadedAt),
      parentId: null,
      fileId: null,
      search: normalize(
        r.registrationNumber,
        String(r.registrationNumber ?? "").replace(/\W/g, ""),
      ),
      raw: r,
    }),
  },
  {
    entity: "tach_driver_cards",
    path: "profitach/driver-cards",
    map: (r) => {
      const name = fullName(r.holderFirstName, r.holderLastName);
      return {
        sourceId: String(r.id),
        name,
        ref: str(r.cardNumber),
        status: r.disabled ? "disabled" : "active",
        occurredAt: date(r.lastDownloadedAt),
        parentId: str(r.lastVehicleNumber),
        fileId: null,
        search: normalize(name, r.cardNumber, r.lastVehicleNumber),
        raw: r,
      };
    },
  },
  {
    entity: "tach_files",
    path: "profitach/files",
    map: (r) => {
      const who = r.vehicleRegistrationNumber ?? r.driverCardNumber;
      return {
        sourceId: String(r.id),
        name: fullName(r.type, who),
        ref: str(who),
        status: str(r.status),
        occurredAt: date(r.downloadedAt),
        parentId: str(r.vehicleId ?? r.driverCardId),
        fileId: null,
        search: normalize(
          r.type,
          r.vehicleRegistrationNumber,
          r.driverCardNumber,
          obj(r.driverCard).holderLastName,
        ),
        raw: trim(r),
      };
    },
  },
  {
    entity: "consignment_notes",
    path: "consignment-notes",
    map: (r) => {
      const shipper = obj(r.shipper);
      const name = fullName(r.deliveryNoteNumber, shipper.corporate_name ?? shipper.name);
      return {
        sourceId: String(r.id),
        name,
        ref: str(r.deliveryNoteNumber),
        status: str(r.status),
        occurredAt: date(r.pickupDate),
        parentId: str(r.shipperId),
        // The document's PDF: /files/consignment-note/{id}.
        fileId: r.pdfFileId ? `consignment-note:${r.id}` : null,
        search: normalize(
          r.deliveryNoteNumber,
          shipper.corporate_name,
          shipper.name,
          r.originPlace,
          r.deliveryPlace,
        ),
        raw: trim(r),
      };
    },
  },
  {
    entity: "waste_work_orders",
    path: "waste-work-order/table-info",
    minHours: 24,
    map: (r) => {
      const client = obj(r.client);
      const clientName = client.corporate_name ?? client.brand_name;
      return {
        sourceId: String(r.id),
        name: fullName(clientName, r.service_type ? `· ${r.service_type}` : ""),
        ref: str(r.license_plate ?? r.external_dcs_number),
        status: str(r.status),
        occurredAt: date(r.start_date ?? r.call_date),
        parentId: str(r.client_id),
        fileId: null,
        search: normalize(
          clientName,
          r.license_plate,
          r.external_dcs_number,
          r.service_type,
          obj(r.workplace).name,
        ),
        raw: trim(r),
      };
    },
  },
];

export const ENTITY_BY_NAME = Object.fromEntries(ENTITIES.map((e) => [e.entity, e])) as Record<
  MytutorEntity,
  EntitySpec
>;
