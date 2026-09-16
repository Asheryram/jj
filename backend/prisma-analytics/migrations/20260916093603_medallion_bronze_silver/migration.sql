-- CreateTable
CREATE TABLE "bronze_orders" (
    "id" TEXT NOT NULL,
    "date_key" INTEGER NOT NULL,
    "reference" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "network" TEXT,
    "category" TEXT NOT NULL,
    "sale_price" INTEGER NOT NULL,
    "split" JSONB NOT NULL,
    "sold_by_code" TEXT,
    "sold_by_agent_name" TEXT,
    "buyer_phone" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "ingested_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bronze_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bronze_supplier_dispatches" (
    "id" TEXT NOT NULL,
    "date_key" INTEGER NOT NULL,
    "order_id" TEXT NOT NULL,
    "network" TEXT,
    "outcome" TEXT NOT NULL,
    "provider_reference" TEXT,
    "provider_status" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL,
    "ingested_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bronze_supplier_dispatches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bronze_refunds" (
    "id" TEXT NOT NULL,
    "date_key" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "decided_at" TIMESTAMP(3) NOT NULL,
    "ingested_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bronze_refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bronze_users" (
    "id" TEXT NOT NULL,
    "snapshot_date_key" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "referral_code" TEXT NOT NULL,
    "upline_code" TEXT,
    "name" TEXT,
    "joined_at" TIMESTAMP(3) NOT NULL,
    "ingested_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bronze_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "silver_order_facts" (
    "order_id" TEXT NOT NULL,
    "date_key" INTEGER NOT NULL,
    "hour" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "is_paid" BOOLEAN NOT NULL,
    "is_completed" BOOLEAN NOT NULL,
    "network" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "sale_price" INTEGER NOT NULL,
    "supplier_cost" INTEGER NOT NULL DEFAULT 0,
    "paystack_fee" INTEGER NOT NULL DEFAULT 0,
    "agent_margin" INTEGER NOT NULL DEFAULT 0,
    "agent_code" TEXT,
    "agent_id" TEXT,
    "agent_name" TEXT,
    "buyer_phone" TEXT NOT NULL,

    CONSTRAINT "silver_order_facts_pkey" PRIMARY KEY ("order_id")
);

-- CreateTable
CREATE TABLE "silver_dispatch_facts" (
    "dispatch_id" TEXT NOT NULL,
    "date_key" INTEGER NOT NULL,
    "order_id" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "resolved_outcome" TEXT NOT NULL,

    CONSTRAINT "silver_dispatch_facts_pkey" PRIMARY KEY ("dispatch_id")
);

-- CreateTable
CREATE TABLE "silver_refund_facts" (
    "refund_id" TEXT NOT NULL,
    "date_key" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,

    CONSTRAINT "silver_refund_facts_pkey" PRIMARY KEY ("refund_id")
);

-- CreateTable
CREATE TABLE "silver_agent_dim" (
    "agent_id" TEXT NOT NULL,
    "referral_code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "upline_code" TEXT,
    "depth" INTEGER NOT NULL,
    "joined_date_key" INTEGER NOT NULL,
    "snapshot_date_key" INTEGER NOT NULL,

    CONSTRAINT "silver_agent_dim_pkey" PRIMARY KEY ("agent_id")
);

-- CreateIndex
CREATE INDEX "bronze_orders_date_key_idx" ON "bronze_orders"("date_key");

-- CreateIndex
CREATE INDEX "bronze_supplier_dispatches_date_key_idx" ON "bronze_supplier_dispatches"("date_key");

-- CreateIndex
CREATE INDEX "bronze_refunds_date_key_idx" ON "bronze_refunds"("date_key");

-- CreateIndex
CREATE INDEX "bronze_users_snapshot_date_key_idx" ON "bronze_users"("snapshot_date_key");

-- CreateIndex
CREATE INDEX "silver_order_facts_date_key_idx" ON "silver_order_facts"("date_key");

-- CreateIndex
CREATE INDEX "silver_dispatch_facts_date_key_idx" ON "silver_dispatch_facts"("date_key");

-- CreateIndex
CREATE INDEX "silver_refund_facts_date_key_idx" ON "silver_refund_facts"("date_key");
