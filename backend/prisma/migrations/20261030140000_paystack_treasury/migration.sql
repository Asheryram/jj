-- CreateEnum
CREATE TYPE "TreasuryPurpose" AS ENUM ('provider_refill', 'owner_drawing');

-- CreateEnum
CREATE TYPE "PaystackTopupSource" AS ENUM ('unclassified', 'settlement_momo', 'own_money', 'not_topup');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LedgerKind" ADD VALUE 'owner_topup';
ALTER TYPE "LedgerKind" ADD VALUE 'owner_drawing';

-- CreateTable
CREATE TABLE "treasury_destinations" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "network" "Network" NOT NULL,
    "recipient_code" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "treasury_destinations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "treasury_transfers" (
    "id" TEXT NOT NULL,
    "purpose" "TreasuryPurpose" NOT NULL,
    "provider" TEXT,
    "amount" INTEGER NOT NULL,
    "fee" INTEGER NOT NULL,
    "destination_id" TEXT NOT NULL,
    "note" TEXT,
    "requested_by" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "transfer_code" TEXT,
    "status_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMP(3),

    CONSTRAINT "treasury_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paystack_topups" (
    "id" TEXT NOT NULL,
    "ledger_id" TEXT NOT NULL,
    "transaction_id" TEXT,
    "reason" TEXT,
    "amount" INTEGER NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "source" "PaystackTopupSource" NOT NULL DEFAULT 'unclassified',
    "classified_by" TEXT,
    "classified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "paystack_topups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "treasury_destinations_phone_network_key" ON "treasury_destinations"("phone", "network");

-- CreateIndex
CREATE INDEX "treasury_transfers_status_idx" ON "treasury_transfers"("status");

-- CreateIndex
CREATE INDEX "treasury_transfers_created_at_idx" ON "treasury_transfers"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "paystack_topups_ledger_id_key" ON "paystack_topups"("ledger_id");

-- CreateIndex
CREATE INDEX "paystack_topups_source_idx" ON "paystack_topups"("source");

-- AddForeignKey
ALTER TABLE "treasury_transfers" ADD CONSTRAINT "treasury_transfers_destination_id_fkey" FOREIGN KEY ("destination_id") REFERENCES "treasury_destinations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

