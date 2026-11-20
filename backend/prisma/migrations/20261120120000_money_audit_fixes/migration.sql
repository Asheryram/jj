-- Money audit fixes, November 2026. Touches no order, no split, no balance.

-- 1. Domain renewals paid by Paystack get a Payment row, like orders and
--    top-ups, so the webhook, the sweep and the amount check cover them.
--    Not used in this migration, so it is safe to add inside one.
ALTER TYPE "PaymentPurpose" ADD VALUE IF NOT EXISTS 'domain_renewal';

-- 4. A float refill is only "landed" once someone confirms the money reached
--    the supplier float. Every refill already sent has been booked as landed
--    since the day it was paid, so mark them landed then: nothing on screen
--    moves on deploy, only new refills wait for confirmation.
ALTER TABLE "treasury_transfers" ADD COLUMN "landed_at" TIMESTAMP(3);

UPDATE "treasury_transfers"
SET "landed_at" = COALESCE("paid_at", "created_at")
WHERE "purpose" = 'provider_refill' AND "status" = 'success';

-- 5. A payment in the wrong currency was booked at its foreign amount as if
--    it were pesewas. Book what was asked for in GHS instead, which is also
--    what its refund is for.
UPDATE "ledger_entries" l
SET "amount" = p."amount"
FROM "payments" p
WHERE l."idempotency_key" = 'payment:' || p."reference" || ':unacceptable'
  AND l."description" LIKE 'Payment not accepted (paid in %';

-- 2. A refused (under-paid or wrong-currency) payment is booked as income so
--    that its refund nets it to zero. The refund was booked as not touching
--    profit, so profit kept the income for ever. Count those refunds against
--    profit, as every other refund of booked money already is.
UPDATE "ledger_entries" r
SET "affects_profit" = true
WHERE r."kind" = 'refund'
  AND r."affects_profit" = false
  AND r."order_ref" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "ledger_entries" u
    WHERE u."idempotency_key" = 'payment:' || r."order_ref" || ':unacceptable'
  );
