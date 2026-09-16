-- CreateTable
CREATE TABLE "bronze_ledger_entries" (
    "id" TEXT NOT NULL,
    "date_key" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "affects_profit" BOOLEAN NOT NULL,
    "order_ref" TEXT,
    "withdrawal_id" TEXT,
    "user_id" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "ingested_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bronze_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bronze_beneficiary_requests" (
    "phone" TEXT NOT NULL,
    "snapshot_date_key" INTEGER NOT NULL,
    "network_key" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL,
    "last_product" TEXT,
    "last_value" INTEGER,
    "first_seen_at" TIMESTAMP(3) NOT NULL,
    "approved_at" TIMESTAMP(3),
    "ingested_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bronze_beneficiary_requests_pkey" PRIMARY KEY ("phone")
);

-- CreateTable
CREATE TABLE "silver_ledger_facts" (
    "entry_id" TEXT NOT NULL,
    "date_key" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "affects_profit" BOOLEAN NOT NULL,
    "order_ref" TEXT,
    "network" TEXT,
    "category" TEXT,
    "agent_id" TEXT,

    CONSTRAINT "silver_ledger_facts_pkey" PRIMARY KEY ("entry_id")
);

-- CreateTable
CREATE TABLE "silver_beneficiary_facts" (
    "phone" TEXT NOT NULL,
    "date_key" INTEGER NOT NULL,
    "network_key" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL,
    "last_value" INTEGER,
    "resolved" BOOLEAN NOT NULL,
    "hours_to_resolve" DOUBLE PRECISION,

    CONSTRAINT "silver_beneficiary_facts_pkey" PRIMARY KEY ("phone")
);

-- CreateTable
CREATE TABLE "daily_lost_revenue_summary" (
    "date" INTEGER NOT NULL,
    "newly_blocked" INTEGER NOT NULL DEFAULT 0,
    "still_blocked" INTEGER NOT NULL DEFAULT 0,
    "resolved" INTEGER NOT NULL DEFAULT 0,
    "lost_value" INTEGER NOT NULL DEFAULT 0,
    "avg_hours_to_resolve" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_lost_revenue_summary_pkey" PRIMARY KEY ("date")
);

-- CreateIndex
CREATE INDEX "bronze_ledger_entries_date_key_idx" ON "bronze_ledger_entries"("date_key");

-- CreateIndex
CREATE INDEX "bronze_beneficiary_requests_snapshot_date_key_idx" ON "bronze_beneficiary_requests"("snapshot_date_key");

-- CreateIndex
CREATE INDEX "silver_ledger_facts_date_key_idx" ON "silver_ledger_facts"("date_key");

-- CreateIndex
CREATE INDEX "silver_beneficiary_facts_date_key_idx" ON "silver_beneficiary_facts"("date_key");
