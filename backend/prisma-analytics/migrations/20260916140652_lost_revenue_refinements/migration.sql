/*
  Warnings:

  - You are about to drop the column `lost_value` on the `daily_lost_revenue_summary` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "daily_lost_revenue_summary" DROP COLUMN "lost_value",
ADD COLUMN     "newly_blocked_value" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "still_blocked_value" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "silver_beneficiary_facts" ADD COLUMN     "resolved_date_key" INTEGER;

-- CreateIndex
CREATE INDEX "silver_beneficiary_facts_resolved_date_key_idx" ON "silver_beneficiary_facts"("resolved_date_key");
