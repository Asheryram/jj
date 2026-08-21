-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "WithdrawalStatus" ADD VALUE 'paid';
ALTER TYPE "WithdrawalStatus" ADD VALUE 'failed';

-- AlterTable
ALTER TABLE "withdrawals" ADD COLUMN     "paid_at" TIMESTAMP(3),
ADD COLUMN     "recipient_code" TEXT,
ADD COLUMN     "transfer_code" TEXT,
ADD COLUMN     "transfer_note" TEXT,
ADD COLUMN     "transfer_status" TEXT;
