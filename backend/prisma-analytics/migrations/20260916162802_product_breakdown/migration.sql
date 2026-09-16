/*
  Warnings:

  - Added the required column `product_id` to the `silver_order_facts` table without a default value. This is not possible if the table is not empty.
  - Added the required column `product_name` to the `silver_order_facts` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "bronze_orders" ADD COLUMN     "product_id" TEXT,
ADD COLUMN     "product_name" TEXT;

-- AlterTable
ALTER TABLE "silver_ledger_facts" ADD COLUMN     "product_id" TEXT,
ADD COLUMN     "product_name" TEXT;

-- AlterTable
-- `DEFAULT 'UNKNOWN'` only backfills the rows that already exist (this is a
-- Silver table, fully rebuilt from Bronze on every ETL run, not authoritative
-- long-term storage); the next run recomputes every day and replaces this
-- placeholder with the real product, the same way `network` already defaults
-- to 'UNKNOWN' rather than being nullable.
ALTER TABLE "silver_order_facts" ADD COLUMN     "product_id" TEXT NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "product_name" TEXT NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE "silver_order_facts" ALTER COLUMN "product_id" DROP DEFAULT,
ALTER COLUMN "product_name" DROP DEFAULT;

-- CreateTable
CREATE TABLE "daily_product_summary" (
    "date" INTEGER NOT NULL,
    "product_id" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "orders_count" INTEGER NOT NULL DEFAULT 0,
    "revenue" INTEGER NOT NULL DEFAULT 0,
    "supplier_cost" INTEGER NOT NULL DEFAULT 0,
    "paystack_fee" INTEGER NOT NULL DEFAULT 0,
    "agent_margin" INTEGER NOT NULL DEFAULT 0,
    "profit" INTEGER NOT NULL DEFAULT 0,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_product_summary_pkey" PRIMARY KEY ("date","product_id")
);
