import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";

export type ModelOption = { id: string; label: string; default?: boolean };

let cached: ModelOption[] | undefined;

/** Model catalog from config/models.json (names live in configuration, not code). */
export function modelCatalog(): ModelOption[] {
  if (!cached) {
    const file = path.resolve(process.cwd(), "../../config/models.json");
    cached = (JSON.parse(readFileSync(file, "utf8")) as { models: ModelOption[] }).models;
  }
  return cached;
}
