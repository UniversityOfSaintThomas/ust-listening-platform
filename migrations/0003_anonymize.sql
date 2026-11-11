-- Responses are anonymous from here on. Clear any names collected earlier and
-- coarsen stored times from the hour to the day.
UPDATE submissions SET name = NULL;
UPDATE submissions SET created_at = (created_at / 86400) * 86400;
