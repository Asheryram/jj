-- Keep what the provider actually said, not just our summary of it.
--
-- A failed order previously left only `reason` — e.g. a bare "Insufficient
-- balance" — with the amounts, the HTTP status and any non-JSON error page
-- discarded at the point of parsing and unrecoverable afterwards.
ALTER TABLE "supplier_dispatches" ADD COLUMN "provider_response" TEXT;
