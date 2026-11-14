-- An agent may have its own picture (data URL uploaded by the user); it overrides the
-- persona's portrait everywhere the agent is shown.
ALTER TABLE "agents" ADD COLUMN "avatar_url" text;
