-- The product people know is ProfiECO, not MyTutor (the id "mytutor" stays internally).
-- Connections still using the old default name and the texts their agents read.
UPDATE connections SET name = 'ProfiECO'
WHERE config->>'provider' = 'mytutor' AND name = 'MyTutor';
--> statement-breakpoint
UPDATE tools SET description = replace(description, 'MyTutor', 'ProfiECO')
WHERE description LIKE '%MyTutor%'
  AND connection_id IN (SELECT id FROM connections WHERE config->>'provider' = 'mytutor');
