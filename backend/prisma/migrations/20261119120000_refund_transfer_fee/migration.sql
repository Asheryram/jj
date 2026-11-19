-- Each refund transfer now records the sending fee it was charged, like a
-- withdrawal does, instead of every refund ever sent being re-priced at
-- whatever the fee setting says today.
ALTER TABLE "refund_requests" ADD COLUMN "transfer_fee" INTEGER;

-- Refunds already sent through Paystack: freeze today's configured fee
-- (100 pesewas if never changed), the same figure the cash side already
-- uses for them, so nothing on screen moves on deploy.
UPDATE "refund_requests"
SET "transfer_fee" = COALESCE(
  (SELECT ("value" #>> '{}')::int FROM "settings" WHERE "key" = 'payoutTransferFee'),
  100
)
WHERE "method" = 'transfer' AND "transfer_code" IS NOT NULL;

-- And book each of those fees as the business cost it was, so profit and
-- cash agree. Idempotency key matches what `PaymentsService` now writes when
-- a refund transfer lands, so a later redelivered webhook cannot add it twice.
INSERT INTO "ledger_entries" ("id", "idempotency_key", "kind", "amount", "affects_profit", "description", "order_ref", "occurred_at")
SELECT gen_random_uuid()::text,
       'refund:' || r."id" || ':payout_fee',
       'payout_fee',
       -r."transfer_fee",
       true,
       'Paystack transfer fee · refund ' || r."order_ref",
       r."order_ref",
       r."paid_at"
FROM "refund_requests" r
WHERE r."method" = 'transfer' AND r."transfer_code" IS NOT NULL AND r."paid_at" IS NOT NULL AND r."transfer_fee" > 0
ON CONFLICT ("idempotency_key") DO NOTHING;
