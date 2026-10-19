/**
 * Test databases. Defaults match `infra/docker-compose.yml` (Postgres on 5433) and the
 * `brainagent_test` database created by infra/postgres/init.sql. CI overrides them.
 */
export const TEST_ADMIN_URL =
  process.env.TEST_DATABASE_URL_ADMIN ??
  "postgres://brainagent_owner:brainagent_owner_dev@localhost:5433/brainagent_test";

export const TEST_APP_PASSWORD = process.env.TEST_APP_DB_PASSWORD ?? "brainagent_app_dev";

export const TEST_APP_URL =
  process.env.TEST_DATABASE_URL ??
  `postgres://brainagent_app:${TEST_APP_PASSWORD}@localhost:5433/brainagent_test`;
