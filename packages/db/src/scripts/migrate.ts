import { config } from "dotenv";
import { runMigrations } from "../migrate";

config({ path: new URL("../../../../.env", import.meta.url).pathname, quiet: true });

const url = process.env.DATABASE_URL_ADMIN;
if (!url) {
  console.error("DATABASE_URL_ADMIN is not set (copy .env.example to .env)");
  process.exit(1);
}

await runMigrations(url, process.env.APP_DB_PASSWORD);
console.log("migrations applied");
