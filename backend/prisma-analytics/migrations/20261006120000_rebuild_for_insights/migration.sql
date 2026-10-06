-- AlterTable
ALTER TABLE "daily_float_snapshot" DROP CONSTRAINT "daily_float_snapshot_pkey",
ADD COLUMN     "expected" INTEGER,
ADD COLUMN     "provider" TEXT NOT NULL DEFAULT 'datahub-gh',
ADD CONSTRAINT "daily_float_snapshot_pkey" PRIMARY KEY ("date", "provider");

-- AlterTable
ALTER TABLE "etl_checkpoint" ADD COLUMN     "fact_version" INTEGER,
ADD COLUMN     "last_run_at" TIMESTAMP(3);

-- DropTable
DROP TABLE IF EXISTS "bronze_feedback";

-- DropTable
DROP TABLE IF EXISTS "bronze_ledger_entries";

-- DropTable
DROP TABLE IF EXISTS "bronze_orders";

-- DropTable
DROP TABLE IF EXISTS "bronze_refunds";

-- DropTable
DROP TABLE IF EXISTS "bronze_supplier_dispatches";

-- DropTable
DROP TABLE IF EXISTS "bronze_withdrawals";

-- DropTable
DROP TABLE IF EXISTS "daily_agent_health";

-- DropTable
DROP TABLE IF EXISTS "daily_agent_summary";

-- DropTable
DROP TABLE IF EXISTS "daily_application_funnel";

-- DropTable
DROP TABLE IF EXISTS "daily_category_summary";

-- DropTable
DROP TABLE IF EXISTS "daily_checkout_funnel";

-- DropTable
DROP TABLE IF EXISTS "daily_customer_behavior";

-- DropTable
DROP TABLE IF EXISTS "daily_dispatch_reliability";

-- DropTable
DROP TABLE IF EXISTS "daily_downline_depth";

-- DropTable
DROP TABLE IF EXISTS "daily_feedback_summary";

-- DropTable
DROP TABLE IF EXISTS "daily_lost_revenue_summary";

-- DropTable
DROP TABLE IF EXISTS "daily_margin_accuracy";

-- DropTable
DROP TABLE IF EXISTS "daily_network_summary";

-- DropTable
DROP TABLE IF EXISTS "daily_payout_summary";

-- DropTable
DROP TABLE IF EXISTS "daily_product_summary";

-- DropTable
DROP TABLE IF EXISTS "daily_refund_network_summary";

-- DropTable
DROP TABLE IF EXISTS "daily_refund_reason_summary";

-- DropTable
DROP TABLE IF EXISTS "daily_refund_summary";

-- DropTable
DROP TABLE IF EXISTS "daily_summary";

-- DropTable
DROP TABLE IF EXISTS "hourly_order_volume";

-- DropTable
DROP TABLE IF EXISTS "silver_dispatch_facts";

-- DropTable
DROP TABLE IF EXISTS "silver_feedback_facts";

-- DropTable
DROP TABLE IF EXISTS "silver_ledger_facts";

-- DropTable
DROP TABLE IF EXISTS "silver_order_facts";

-- DropTable
DROP TABLE IF EXISTS "silver_refund_facts";

-- DropTable
DROP TABLE IF EXISTS "silver_withdrawal_facts";

-- CreateTable
CREATE TABLE "fact_orders" (
    "order_id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "date_key" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "hour" INTEGER NOT NULL,
    "weekday" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "paid_with" TEXT NOT NULL,
    "is_paid" BOOLEAN NOT NULL,
    "is_completed" BOOLEAN NOT NULL,
    "is_failed_after_pay" BOOLEAN NOT NULL,
    "network" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "provider" TEXT,
    "channel" TEXT NOT NULL,
    "agent_id" TEXT,
    "agent_code" TEXT,
    "agent_name" TEXT,
    "buyer_phone" TEXT NOT NULL,
    "buyer_user_id" TEXT,
    "sale_price" INTEGER NOT NULL,
    "revenue" INTEGER NOT NULL DEFAULT 0,
    "supplier_cost" INTEGER NOT NULL DEFAULT 0,
    "paystack_fee" INTEGER NOT NULL DEFAULT 0,
    "agent_margin" INTEGER NOT NULL DEFAULT 0,
    "adjustments" INTEGER NOT NULL DEFAULT 0,
    "profit" INTEGER NOT NULL DEFAULT 0,
    "paid_at" TIMESTAMP(3),
    "first_sent_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "failure_reason" TEXT,
    "refund_amount" INTEGER,
    "refund_status" TEXT,
    "refund_created_at" TIMESTAMP(3),
    "refund_settled_at" TIMESTAMP(3),

    CONSTRAINT "fact_orders_pkey" PRIMARY KEY ("order_id")
);

-- CreateTable
CREATE TABLE "fact_withdrawals" (
    "withdrawal_id" TEXT NOT NULL,
    "date_key" INTEGER NOT NULL,
    "agent_id" TEXT NOT NULL,
    "agent_name" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "fee" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "manual" BOOLEAN NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL,
    "decided_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),

    CONSTRAINT "fact_withdrawals_pkey" PRIMARY KEY ("withdrawal_id")
);

-- CreateIndex
CREATE INDEX "fact_orders_date_key_idx" ON "fact_orders"("date_key");

-- CreateIndex
CREATE INDEX "fact_orders_buyer_phone_idx" ON "fact_orders"("buyer_phone");

-- CreateIndex
CREATE INDEX "fact_orders_agent_id_idx" ON "fact_orders"("agent_id");

-- CreateIndex
CREATE INDEX "fact_withdrawals_date_key_idx" ON "fact_withdrawals"("date_key");

