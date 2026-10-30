/**
 * Schedules the hourly MyTutor sync in Supabase (ADR-021): pg_cron calls
 * POST {APP_URL}/api/cron/mytutor-sync through pg_net with CRON_SECRET, which is kept in
 * Supabase Vault (not in the job's text). Idempotent: re-run it to rotate the secret.
 *
 *   set -a; . ./.env.production; set +a; pnpm --filter @brainagent/db cron:mytutor
 */
import { config } from "dotenv";
import postgres from "postgres";

config({ path: new URL("../../../../.env", import.meta.url).pathname, quiet: true });

const url = process.env.DATABASE_URL_ADMIN;
const secret = process.env.CRON_SECRET;
const appUrl = (process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? "").replace(/\/$/, "");
if (!url || !secret || secret.length < 32 || !/^https:\/\//.test(appUrl)) {
  console.error("Needs DATABASE_URL_ADMIN, CRON_SECRET (≥ 32 chars) and an https APP_URL");
  process.exit(1);
}

const sql = postgres(url, { max: 1, onnotice: () => undefined });
try {
  await sql`create extension if not exists pg_cron`;
  await sql`create extension if not exists pg_net`;
  const [existing] = await sql`select id from vault.secrets where name = 'mytutor_cron_secret'`;
  if (existing) await sql`select vault.update_secret(${existing.id}, ${secret})`;
  else await sql`select vault.create_secret(${secret}, 'mytutor_cron_secret')`;
  await sql`select cron.unschedule(jobid) from cron.job where jobname = 'mytutor-sync'`;
  const command = `
    select net.http_post(
      url := '${appUrl}/api/cron/mytutor-sync',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'mytutor_cron_secret'),
        'Content-Type', 'application/json'),
      body := '{}'::jsonb,
      timeout_milliseconds := 300000)`;
  await sql`select cron.schedule('mytutor-sync', '7 * * * *', ${command})`;
  console.log(`scheduled: every hour at :07 → ${appUrl}/api/cron/mytutor-sync`);
} finally {
  await sql.end();
}
