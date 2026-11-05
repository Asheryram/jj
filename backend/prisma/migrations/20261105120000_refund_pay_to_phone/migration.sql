ALTER TABLE "refund_requests" ADD COLUMN "pay_to_phone" TEXT;

ALTER TYPE "TreasuryPurpose" ADD VALUE 'advance_repayment';

ALTER TABLE "treasury_transfers" ADD COLUMN "covers" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
