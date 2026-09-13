-- AlterTable
ALTER TABLE "refund_requests" ADD COLUMN     "resolved_manually" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "withdrawals" ADD COLUMN     "resolved_manually" BOOLEAN NOT NULL DEFAULT false;
