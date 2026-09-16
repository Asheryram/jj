-- AlterTable
ALTER TABLE "daily_application_funnel" ADD COLUMN     "decided_1_to_4h" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "decided_4_to_24h" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "decided_over_24h" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "decided_under_1h" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "daily_lost_revenue_summary" ADD COLUMN     "resolved_1_to_4h" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "resolved_4_to_24h" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "resolved_over_24h" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "resolved_under_1h" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "daily_payout_summary" ADD COLUMN     "paid_1_to_4h" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "paid_4_to_24h" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "paid_over_24h" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "paid_under_1h" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "daily_refund_summary" ADD COLUMN     "decided_1_to_4h" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "decided_4_to_24h" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "decided_over_24h" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "decided_under_1h" INTEGER NOT NULL DEFAULT 0;
