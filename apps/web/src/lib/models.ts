import "server-only";
// Imported (not read from disk) so it is bundled into serverless functions.
import modelsConfig from "../../../../config/models.json";

export type ModelOption = { id: string; label: string; default?: boolean };

/** Model catalog from config/models.json (names live in configuration, not code). */
export function modelCatalog(): ModelOption[] {
  return (modelsConfig as { models: ModelOption[] }).models;
}
