-- Numbers a customer tried to buy for that DataHub GH has not approved.
--
-- Their /beneficiaries submission endpoint returns 502, so approval is a manual
-- job in their dashboard — which is impossible if nobody records who tried.
CREATE TABLE "beneficiary_requests" (
  "phone"          TEXT NOT NULL,
  "network_key"    TEXT NOT NULL,
  "attempts"       INTEGER NOT NULL DEFAULT 1,
  "last_product"   TEXT,
  "last_value"     INTEGER,
  "first_seen_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at"   TIMESTAMP(3) NOT NULL,
  "approved_at"    TIMESTAMP(3),
  CONSTRAINT "beneficiary_requests_pkey" PRIMARY KEY ("phone")
);

CREATE INDEX "beneficiary_requests_approved_at_idx" ON "beneficiary_requests"("approved_at");
