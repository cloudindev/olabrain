-- Tool rounds per reply: the old default (4) cut data-heavy answers short. Agents still on
-- 4 or fewer (or without the setting) get the new default, 20.
UPDATE agents
SET policy = jsonb_set(COALESCE(policy, '{}'::jsonb), '{maxToolSteps}', '20'::jsonb)
WHERE COALESCE((policy->>'maxToolSteps')::int, 0) <= 4;
