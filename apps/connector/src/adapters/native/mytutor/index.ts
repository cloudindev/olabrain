/**
 * MyTutor native connector (ADR-021): login check, client factory and on-demand files.
 * The API base URL is platform configuration (MYTUTOR_API_URL), never user input.
 */
import type { SafeFetcher } from "../../../egress";
import { MytutorClient, MytutorError, type MytutorCredentials } from "./client";

export { MYTUTOR_TOOLS, executeMytutorTool } from "./tools";
export { syncMytutor, type MytutorConfig, type SyncOutcome } from "./sync";
export { MytutorClient, MytutorError } from "./client";

export const MYTUTOR_DEFAULT_API_URL = "https://api.my-tutor.es/v1";

export function mytutorClient(
  fetcher: SafeFetcher,
  baseUrl: string,
  credentials: MytutorCredentials,
) {
  return new MytutorClient({ baseUrl, credentials, fetcher });
}

/**
 * "Probar conexión": signs in and reads the company (GET empresa/{id}). Returns its name.
 * Read-only: login plus one GET.
 */
export async function checkMytutor(
  fetcher: SafeFetcher,
  baseUrl: string,
  credentials: MytutorCredentials,
  companyId: number,
): Promise<{ companyName: string }> {
  const client = mytutorClient(fetcher, baseUrl, credentials);
  const { companies } = await client.login();
  if (companies.length && !companies.some((c) => c.id === companyId)) {
    throw new MytutorError(
      `Este usuario de ProfiECO no tiene acceso a la empresa ${companyId} (tiene: ${companies
        .map((c) => `${c.id} ${c.name}`)
        .join(", ")})`,
      403,
    );
  }
  const company = (await client.get(`empresa/${companyId}`)) as Record<string, unknown> | null;
  const name =
    (company?.name as string | undefined) ??
    (company?.nombre as string | undefined) ??
    (company?.razonSocial as string | undefined) ??
    companies.find((c) => c.id === companyId)?.name;
  if (!name) throw new MytutorError(`ProfiECO no devolvió la empresa ${companyId}`, 404);
  return { companyName: name };
}

/**
 * A file behind a cached record: "consignment-note:{id}" (its PDF link comes from
 * /files/consignment-note/{id}/url) or a MyTutor file id.
 */
export function mytutorFilePath(ref: string): string {
  const cn = /^consignment-note:(\d+)$/.exec(ref);
  if (cn) return `files/consignment-note/${cn[1]}/url`;
  if (/^\d+$/.test(ref)) return `files/${ref}/download`;
  throw new MytutorError("referencia de archivo no válida", 400);
}
