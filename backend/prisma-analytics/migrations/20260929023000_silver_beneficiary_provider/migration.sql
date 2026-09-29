-- Same reasoning as bronze_beneficiary_requests: the same phone can be
-- blocked under two different providers at different times, so provider
-- joins phone as this table's key too, or one provider's row silently
-- overwrites the other's on every ETL run.
ALTER TABLE "silver_beneficiary_facts" ADD COLUMN     "provider" TEXT NOT NULL DEFAULT 'datahub-gh';

ALTER TABLE "silver_beneficiary_facts" DROP CONSTRAINT "silver_beneficiary_facts_pkey";
ALTER TABLE "silver_beneficiary_facts" ADD CONSTRAINT "silver_beneficiary_facts_pkey" PRIMARY KEY ("phone", "provider");
