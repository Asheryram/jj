-- Mirrors the main database's BeneficiaryRequest change: the same phone
-- number can hold under two different providers at different times (a
-- routing switch), so provider joins phone as part of this snapshot's key
-- too, or a GMPL row and a DataHub row for the same phone would overwrite
-- each other here.
ALTER TABLE "bronze_beneficiary_requests" ADD COLUMN     "provider" TEXT NOT NULL DEFAULT 'datahub-gh';

ALTER TABLE "bronze_beneficiary_requests" DROP CONSTRAINT "bronze_beneficiary_requests_pkey";
ALTER TABLE "bronze_beneficiary_requests" ADD CONSTRAINT "bronze_beneficiary_requests_pkey" PRIMARY KEY ("phone", "provider");
