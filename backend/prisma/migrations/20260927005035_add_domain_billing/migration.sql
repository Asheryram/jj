-- CreateEnum
CREATE TYPE "DomainMode" AS ENUM ('subdomain', 'custom');

-- CreateEnum
CREATE TYPE "BillingInterval" AS ENUM ('monthly', 'yearly');

-- CreateEnum
CREATE TYPE "DomainRenewalMethod" AS ENUM ('balance', 'paystack');

-- CreateEnum
CREATE TYPE "DomainRenewalStatus" AS ENUM ('pending', 'paid', 'failed');

-- AlterTable
ALTER TABLE "custom_domains" ADD COLUMN     "billing_interval" "BillingInterval" NOT NULL DEFAULT 'monthly',
ADD COLUMN     "grace_ends_at" TIMESTAMP(3),
ADD COLUMN     "mode" "DomainMode" NOT NULL DEFAULT 'custom',
ADD COLUMN     "next_renewal_at" TIMESTAMP(3),
ADD COLUMN     "price_amount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "domain_pricing" (
    "id" TEXT NOT NULL,
    "mode" "DomainMode" NOT NULL,
    "interval" "BillingInterval" NOT NULL,
    "cost_amount" INTEGER NOT NULL DEFAULT 0,
    "price_amount" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "domain_pricing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "domain_renewals" (
    "id" TEXT NOT NULL,
    "domain_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" "DomainRenewalMethod" NOT NULL,
    "status" "DomainRenewalStatus" NOT NULL DEFAULT 'pending',
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "paystack_reference" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMP(3),

    CONSTRAINT "domain_renewals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "domain_pricing_mode_interval_key" ON "domain_pricing"("mode", "interval");

-- CreateIndex
CREATE UNIQUE INDEX "domain_renewals_paystack_reference_key" ON "domain_renewals"("paystack_reference");

-- CreateIndex
CREATE INDEX "domain_renewals_domain_id_idx" ON "domain_renewals"("domain_id");

-- AddForeignKey
ALTER TABLE "domain_renewals" ADD CONSTRAINT "domain_renewals_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "custom_domains"("id") ON DELETE CASCADE ON UPDATE CASCADE;
