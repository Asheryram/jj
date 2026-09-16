/*
  Warnings:

  - Added the required column `created_at` to the `bronze_refunds` table without a default value. This is not possible if the table is not empty.
  - Added the required column `method` to the `bronze_refunds` table without a default value. This is not possible if the table is not empty.
  - Added the required column `order_id` to the `bronze_refunds` table without a default value. This is not possible if the table is not empty.
  - Added the required column `reason` to the `bronze_refunds` table without a default value. This is not possible if the table is not empty.
  - Added the required column `category` to the `silver_refund_facts` table without a default value. This is not possible if the table is not empty.
  - Added the required column `method` to the `silver_refund_facts` table without a default value. This is not possible if the table is not empty.
  - Added the required column `network` to the `silver_refund_facts` table without a default value. This is not possible if the table is not empty.
  - Added the required column `reason` to the `silver_refund_facts` table without a default value. This is not possible if the table is not empty.
  - Added the required column `turnaround_hours` to the `silver_refund_facts` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "bronze_refunds" ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "method" TEXT NOT NULL,
ADD COLUMN     "momo_network" TEXT,
ADD COLUMN     "order_id" TEXT NOT NULL,
ADD COLUMN     "reason" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "bronze_users" ADD COLUMN     "decided_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "daily_category_summary" ADD COLUMN     "agent_margin" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "paystack_fee" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "profit" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "supplier_cost" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "daily_network_summary" ADD COLUMN     "agent_margin" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "paystack_fee" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "profit" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "silver_refund_facts" ADD COLUMN     "category" TEXT NOT NULL,
ADD COLUMN     "method" TEXT NOT NULL,
ADD COLUMN     "network" TEXT NOT NULL,
ADD COLUMN     "reason" TEXT NOT NULL,
ADD COLUMN     "turnaround_hours" DOUBLE PRECISION NOT NULL;

-- CreateTable
CREATE TABLE "bronze_withdrawals" (
    "id" TEXT NOT NULL,
    "date_key" INTEGER NOT NULL,
    "user_id" TEXT NOT NULL,
    "agent_name" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "momo_network" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL,
    "decided_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "ingested_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bronze_withdrawals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bronze_feedback" (
    "id" TEXT NOT NULL,
    "date_key" INTEGER NOT NULL,
    "user_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "escalated" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "decided_at" TIMESTAMP(3),
    "ingested_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bronze_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "silver_withdrawal_facts" (
    "withdrawal_id" TEXT NOT NULL,
    "date_key" INTEGER NOT NULL,
    "agent_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "is_paid" BOOLEAN NOT NULL,
    "hours_to_pay" DOUBLE PRECISION,

    CONSTRAINT "silver_withdrawal_facts_pkey" PRIMARY KEY ("withdrawal_id")
);

-- CreateTable
CREATE TABLE "silver_feedback_facts" (
    "feedback_id" TEXT NOT NULL,
    "date_key" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "escalated" BOOLEAN NOT NULL,
    "turnaround_hours" DOUBLE PRECISION,

    CONSTRAINT "silver_feedback_facts_pkey" PRIMARY KEY ("feedback_id")
);

-- CreateTable
CREATE TABLE "silver_application_facts" (
    "user_id" TEXT NOT NULL,
    "applied_date_key" INTEGER NOT NULL,
    "decided_date_key" INTEGER,
    "outcome" TEXT NOT NULL,
    "hours_to_decide" DOUBLE PRECISION,

    CONSTRAINT "silver_application_facts_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "daily_payout_summary" (
    "date" INTEGER NOT NULL,
    "requested_count" INTEGER NOT NULL DEFAULT 0,
    "requested_amount" INTEGER NOT NULL DEFAULT 0,
    "paid_count" INTEGER NOT NULL DEFAULT 0,
    "paid_amount" INTEGER NOT NULL DEFAULT 0,
    "avg_hours_to_pay" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_payout_summary_pkey" PRIMARY KEY ("date")
);

-- CreateTable
CREATE TABLE "daily_refund_summary" (
    "date" INTEGER NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "amount" INTEGER NOT NULL DEFAULT 0,
    "avg_turnaround_hours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_refund_summary_pkey" PRIMARY KEY ("date")
);

-- CreateTable
CREATE TABLE "daily_refund_network_summary" (
    "date" INTEGER NOT NULL,
    "network" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "amount" INTEGER NOT NULL DEFAULT 0,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_refund_network_summary_pkey" PRIMARY KEY ("date","network")
);

-- CreateTable
CREATE TABLE "daily_refund_reason_summary" (
    "date" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "amount" INTEGER NOT NULL DEFAULT 0,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_refund_reason_summary_pkey" PRIMARY KEY ("date","reason")
);

-- CreateTable
CREATE TABLE "daily_feedback_summary" (
    "date" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "open_count" INTEGER NOT NULL DEFAULT 0,
    "reviewed_count" INTEGER NOT NULL DEFAULT 0,
    "resolved_count" INTEGER NOT NULL DEFAULT 0,
    "escalated_count" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_feedback_summary_pkey" PRIMARY KEY ("date","category")
);

-- CreateTable
CREATE TABLE "daily_application_funnel" (
    "date" INTEGER NOT NULL,
    "applied" INTEGER NOT NULL DEFAULT 0,
    "approved" INTEGER NOT NULL DEFAULT 0,
    "rejected" INTEGER NOT NULL DEFAULT 0,
    "avg_hours_to_decide" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_application_funnel_pkey" PRIMARY KEY ("date")
);

-- CreateTable
CREATE TABLE "daily_solvency_snapshot" (
    "date" INTEGER NOT NULL,
    "expected_at_paystack" INTEGER NOT NULL,
    "spent_on_bundles" INTEGER NOT NULL,
    "free_to_spend" INTEGER NOT NULL,
    "owed_to_agents" INTEGER NOT NULL,
    "owed_to_customers" INTEGER NOT NULL,
    "undelivered_orders" INTEGER NOT NULL,
    "queued_payouts" INTEGER NOT NULL,
    "manual_refund_advances" INTEGER NOT NULL,
    "manual_payout_advances" INTEGER NOT NULL,
    "liabilities_total" INTEGER NOT NULL,
    "float_balance" INTEGER,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_solvency_snapshot_pkey" PRIMARY KEY ("date")
);

-- CreateTable
CREATE TABLE "daily_float_snapshot" (
    "date" INTEGER NOT NULL,
    "balance" INTEGER NOT NULL,
    "reference" INTEGER NOT NULL,
    "level" TEXT NOT NULL,
    "observed_at" TIMESTAMP(3),
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_float_snapshot_pkey" PRIMARY KEY ("date")
);

-- CreateIndex
CREATE INDEX "bronze_withdrawals_date_key_idx" ON "bronze_withdrawals"("date_key");

-- CreateIndex
CREATE INDEX "bronze_feedback_date_key_idx" ON "bronze_feedback"("date_key");

-- CreateIndex
CREATE INDEX "silver_withdrawal_facts_date_key_idx" ON "silver_withdrawal_facts"("date_key");

-- CreateIndex
CREATE INDEX "silver_feedback_facts_date_key_idx" ON "silver_feedback_facts"("date_key");
