import { runMigrations } from "@brainagent/db/migrate";
import { TEST_ADMIN_URL, TEST_APP_PASSWORD } from "@brainagent/db/test-env";

export default async function setup(): Promise<void> {
  await runMigrations(TEST_ADMIN_URL, TEST_APP_PASSWORD);
}
