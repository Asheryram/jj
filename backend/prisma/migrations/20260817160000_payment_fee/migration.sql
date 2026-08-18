-- What Paystack kept on each payment, as reported by them.
--
-- Recorded rather than derived from a rate: it varies by channel and they change
-- it, so a hardcoded percentage would misstate every margin the day it moved.
ALTER TABLE "payments" ADD COLUMN "fee" INTEGER;
