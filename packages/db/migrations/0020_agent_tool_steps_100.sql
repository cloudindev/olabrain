-- Agents stopped mid-query on data-heavy questions: every agent gets the new limit, 100.
UPDATE agents
SET policy = jsonb_set(COALESCE(policy, '{}'::jsonb), '{maxToolSteps}', '100'::jsonb)
WHERE COALESCE((policy->>'maxToolSteps')::int, 0) < 100;
