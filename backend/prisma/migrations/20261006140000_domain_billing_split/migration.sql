-- AlterEnum
ALTER TYPE "EarningType" ADD VALUE 'domain_share';

-- AlterEnum
ALTER TYPE "LedgerKind" ADD VALUE 'superadmin_share';

-- AlterTable
ALTER TABLE "custom_domains" ADD COLUMN     "cost_amount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "hosting_status" TEXT,
ADD COLUMN     "payment_method" "DomainRenewalMethod" NOT NULL DEFAULT 'balance',
ADD COLUMN     "ready_at" TIMESTAMP(3),
ADD COLUMN     "suspended" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "domain_renewals" ADD COLUMN     "fee_amount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "paystack_fee" INTEGER,
ADD COLUMN     "share_amount" INTEGER NOT NULL DEFAULT 0;


-- A domain already live was ready before this column existed.
UPDATE "custom_domains" SET "ready_at" = COALESCE("reviewed_at", "requested_at") WHERE "active" = true;
