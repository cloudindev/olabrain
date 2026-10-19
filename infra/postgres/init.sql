-- Runs once, on the first start of an empty volume.
-- The app role is created NOLOGIN by migration 0001; `pnpm db:migrate` sets its password.
CREATE DATABASE brainagent_test;
CREATE DATABASE langfuse;
CREATE DATABASE nango;
