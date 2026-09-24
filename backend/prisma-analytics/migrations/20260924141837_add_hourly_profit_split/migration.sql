/*
  Warnings:

  - Added the required column `hour` to the `silver_ledger_facts` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "daily_summary" ADD COLUMN     "carryover_adjustment" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "same_day_profit" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "hourly_order_volume" ADD COLUMN     "agent_margins" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "carryover_adjustment" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "completed_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "failed_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "paystack_fees" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "profit" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "refunds_amount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "same_day_profit" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "supplier_cost" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "silver_ledger_facts" ADD COLUMN     "hour" INTEGER NOT NULL;
