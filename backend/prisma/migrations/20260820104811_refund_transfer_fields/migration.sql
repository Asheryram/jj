-- AlterTable
ALTER TABLE "refund_requests" ADD COLUMN     "momo_network" "Network",
ADD COLUMN     "paid_at" TIMESTAMP(3),
ADD COLUMN     "recipient_code" TEXT,
ADD COLUMN     "transfer_code" TEXT,
ADD COLUMN     "transfer_note" TEXT,
ADD COLUMN     "transfer_status" TEXT;
