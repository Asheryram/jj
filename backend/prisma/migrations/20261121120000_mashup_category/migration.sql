-- MTN Mashup packs (data, minutes and SMS in one), sold by NetPulse.
-- Adding an enum value only; no existing row changes.
ALTER TYPE "Category" ADD VALUE IF NOT EXISTS 'mashup';
