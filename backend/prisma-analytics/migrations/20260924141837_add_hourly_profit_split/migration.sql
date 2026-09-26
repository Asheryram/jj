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
-- DEFAULT 0 added by hand: the generated statement had no default at all,
-- which Postgres refuses outright the moment this table holds a single row
-- (see the P3009 incident this fix resolves). 0 is a safe placeholder for
-- any pre-existing row, this warehouse is fully derived, never a source of
-- truth (see AnalyticsPrismaService's own doc comment), and the ETL job's
-- delete-then-reinsert cycle (etl.service.ts) overwrites every row it
-- touches with the real computed hour on its next run regardless.
ALTER TABLE "silver_ledger_facts" ADD COLUMN     "hour" INTEGER NOT NULL DEFAULT 0;
