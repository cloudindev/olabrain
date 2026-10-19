import { runMigrations } from "../src/migrate";
import { TEST_ADMIN_URL, TEST_APP_PASSWORD } from "./env";

export default async function setup(): Promise<void> {
  await runMigrations(TEST_ADMIN_URL, TEST_APP_PASSWORD);
}
