-- CreateTable
CREATE TABLE "etl_checkpoint" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "last_finalized_date" INTEGER,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "etl_checkpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_summary" (
    "date" INTEGER NOT NULL,
    "orders_count" INTEGER NOT NULL,
    "completed_count" INTEGER NOT NULL,
    "failed_count" INTEGER NOT NULL,
    "revenue" INTEGER NOT NULL DEFAULT 0,
    "supplier_cost" INTEGER NOT NULL DEFAULT 0,
    "paystack_fees" INTEGER NOT NULL DEFAULT 0,
    "agent_margins" INTEGER NOT NULL DEFAULT 0,
    "refunds_amount" INTEGER NOT NULL DEFAULT 0,
    "profit" INTEGER NOT NULL DEFAULT 0,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_summary_pkey" PRIMARY KEY ("date")
);

-- CreateTable
CREATE TABLE "daily_network_summary" (
    "date" INTEGER NOT NULL,
    "network" TEXT NOT NULL,
    "orders_count" INTEGER NOT NULL DEFAULT 0,
    "revenue" INTEGER NOT NULL DEFAULT 0,
    "supplier_cost" INTEGER NOT NULL DEFAULT 0,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_network_summary_pkey" PRIMARY KEY ("date","network")
);

-- CreateTable
CREATE TABLE "daily_category_summary" (
    "date" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "orders_count" INTEGER NOT NULL DEFAULT 0,
    "revenue" INTEGER NOT NULL DEFAULT 0,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_category_summary_pkey" PRIMARY KEY ("date","category")
);

-- CreateTable
CREATE TABLE "daily_dispatch_reliability" (
    "date" INTEGER NOT NULL,
    "network" TEXT NOT NULL,
    "total_attempts" INTEGER NOT NULL DEFAULT 0,
    "successful" INTEGER NOT NULL DEFAULT 0,
    "no_reply" INTEGER NOT NULL DEFAULT 0,
    "manual_queue" INTEGER NOT NULL DEFAULT 0,
    "other_failed" INTEGER NOT NULL DEFAULT 0,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_dispatch_reliability_pkey" PRIMARY KEY ("date","network")
);

-- CreateTable
CREATE TABLE "daily_agent_summary" (
    "date" INTEGER NOT NULL,
    "agent_id" TEXT NOT NULL,
    "agent_name" TEXT NOT NULL,
    "agent_code" TEXT NOT NULL,
    "orders_count" INTEGER NOT NULL DEFAULT 0,
    "revenue" INTEGER NOT NULL DEFAULT 0,
    "margin" INTEGER NOT NULL DEFAULT 0,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_agent_summary_pkey" PRIMARY KEY ("date","agent_id")
);

-- CreateTable
CREATE TABLE "daily_agent_health" (
    "date" INTEGER NOT NULL,
    "total_agents" INTEGER NOT NULL DEFAULT 0,
    "active_agents" INTEGER NOT NULL DEFAULT 0,
    "dormant_agents" INTEGER NOT NULL DEFAULT 0,
    "new_signups" INTEGER NOT NULL DEFAULT 0,
    "pending_applications" INTEGER NOT NULL DEFAULT 0,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_agent_health_pkey" PRIMARY KEY ("date")
);

-- CreateTable
CREATE TABLE "daily_downline_depth" (
    "date" INTEGER NOT NULL,
    "depth" INTEGER NOT NULL,
    "agent_count" INTEGER NOT NULL DEFAULT 0,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_downline_depth_pkey" PRIMARY KEY ("date","depth")
);

-- CreateTable
CREATE TABLE "hourly_order_volume" (
    "date" INTEGER NOT NULL,
    "hour" INTEGER NOT NULL,
    "orders_count" INTEGER NOT NULL DEFAULT 0,
    "revenue" INTEGER NOT NULL DEFAULT 0,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hourly_order_volume_pkey" PRIMARY KEY ("date","hour")
);

-- CreateTable
CREATE TABLE "daily_checkout_funnel" (
    "date" INTEGER NOT NULL,
    "started" INTEGER NOT NULL DEFAULT 0,
    "paid" INTEGER NOT NULL DEFAULT 0,
    "abandoned" INTEGER NOT NULL DEFAULT 0,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_checkout_funnel_pkey" PRIMARY KEY ("date")
);

-- CreateTable
CREATE TABLE "daily_customer_behavior" (
    "date" INTEGER NOT NULL,
    "unique_buyers" INTEGER NOT NULL DEFAULT 0,
    "repeat_buyers" INTEGER NOT NULL DEFAULT 0,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_customer_behavior_pkey" PRIMARY KEY ("date")
);

-- CreateTable
CREATE TABLE "daily_margin_accuracy" (
    "date" INTEGER NOT NULL,
    "orders_count" INTEGER NOT NULL DEFAULT 0,
    "avg_sale_price" INTEGER NOT NULL DEFAULT 0,
    "avg_supplier_cost" INTEGER NOT NULL DEFAULT 0,
    "avg_margin_bp" INTEGER NOT NULL DEFAULT 0,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_margin_accuracy_pkey" PRIMARY KEY ("date")
);
