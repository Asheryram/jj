-- CreateEnum
CREATE TYPE "Role" AS ENUM ('customer', 'agent', 'admin');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'suspended');

-- CreateEnum
CREATE TYPE "Category" AS ENUM ('data', 'airtime', 'voice', 'sms', 'afa', 'checker');

-- CreateEnum
CREATE TYPE "Network" AS ENUM ('MTN', 'Telecel', 'AirtelTigo');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('pending', 'processing', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "PaidWith" AS ENUM ('wallet', 'momo');

-- CreateEnum
CREATE TYPE "TxType" AS ENUM ('topup', 'purchase', 'refund');

-- CreateEnum
CREATE TYPE "EarningType" AS ENUM ('sale', 'downline', 'reversal', 'withdrawal');

-- CreateEnum
CREATE TYPE "WithdrawalStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT,
    "role" "Role" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "referral_code" TEXT NOT NULL,
    "upline_code" TEXT,
    "markup_percent" INTEGER NOT NULL DEFAULT 8,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_products" (
    "code" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'datahub-gh',
    "category" "Category" NOT NULL,
    "network" "Network",
    "name" TEXT NOT NULL,
    "validity" TEXT NOT NULL,
    "cost_price" INTEGER NOT NULL,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_products_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "supplier_dispatches" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "order_ref" TEXT NOT NULL,
    "supplier_code" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "cost_price" INTEGER NOT NULL,
    "outcome" TEXT NOT NULL,
    "reason" TEXT,
    "simulated" BOOLEAN NOT NULL DEFAULT true,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_dispatches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "category" "Category" NOT NULL,
    "network" "Network",
    "name" TEXT NOT NULL,
    "validity" TEXT NOT NULL,
    "supplier_code" TEXT,
    "supplier_cost" INTEGER NOT NULL,
    "admin_price" INTEGER NOT NULL,
    "standard_price" INTEGER NOT NULL,
    "max_retail_price" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_prices" (
    "user_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "resale_price" INTEGER NOT NULL,

    CONSTRAINT "agent_prices_pkey" PRIMARY KEY ("user_id","product_id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "idempotency_key" TEXT,
    "product_id" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "network" "Network",
    "category" "Category" NOT NULL,
    "recipient" TEXT NOT NULL,
    "sale_price" INTEGER NOT NULL,
    "split" JSONB NOT NULL,
    "sold_by_code" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'processing',
    "paid_with" "PaidWith" NOT NULL,
    "buyer" TEXT NOT NULL,
    "buyer_phone" TEXT NOT NULL,
    "buyer_user_id" TEXT,
    "voucher_serial" TEXT,
    "voucher_pin" TEXT,
    "refunded" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "TxType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "earnings" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "EarningType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "product_name" TEXT,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "earnings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdrawals" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "agent_name" TEXT NOT NULL,
    "agent_phone" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "momo_network" "Network" NOT NULL,
    "status" "WithdrawalStatus" NOT NULL DEFAULT 'pending',
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),

    CONSTRAINT "withdrawals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claimable_credits" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "reference" TEXT NOT NULL,
    "claimed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "claimable_credits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_referral_code_key" ON "users"("referral_code");

-- CreateIndex
CREATE INDEX "users_upline_code_idx" ON "users"("upline_code");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "supplier_products_category_idx" ON "supplier_products"("category");

-- CreateIndex
CREATE INDEX "supplier_products_available_idx" ON "supplier_products"("available");

-- CreateIndex
CREATE INDEX "supplier_dispatches_order_id_idx" ON "supplier_dispatches"("order_id");

-- CreateIndex
CREATE INDEX "supplier_dispatches_outcome_idx" ON "supplier_dispatches"("outcome");

-- CreateIndex
CREATE INDEX "products_category_idx" ON "products"("category");

-- CreateIndex
CREATE INDEX "products_network_idx" ON "products"("network");

-- CreateIndex
CREATE INDEX "products_supplier_code_idx" ON "products"("supplier_code");

-- CreateIndex
CREATE UNIQUE INDEX "orders_reference_key" ON "orders"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "orders_idempotency_key_key" ON "orders"("idempotency_key");

-- CreateIndex
CREATE INDEX "orders_sold_by_code_idx" ON "orders"("sold_by_code");

-- CreateIndex
CREATE INDEX "orders_status_idx" ON "orders"("status");

-- CreateIndex
CREATE INDEX "orders_created_at_idx" ON "orders"("created_at");

-- CreateIndex
CREATE INDEX "orders_buyer_phone_idx" ON "orders"("buyer_phone");

-- CreateIndex
CREATE INDEX "orders_reference_buyer_phone_idx" ON "orders"("reference", "buyer_phone");

-- CreateIndex
CREATE INDEX "transactions_user_id_created_at_idx" ON "transactions"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_user_id_reference_type_key" ON "transactions"("user_id", "reference", "type");

-- CreateIndex
CREATE INDEX "earnings_user_id_created_at_idx" ON "earnings"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "earnings_user_id_reference_type_key" ON "earnings"("user_id", "reference", "type");

-- CreateIndex
CREATE INDEX "withdrawals_status_idx" ON "withdrawals"("status");

-- CreateIndex
CREATE INDEX "withdrawals_user_id_idx" ON "withdrawals"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "claimable_credits_reference_key" ON "claimable_credits"("reference");

-- CreateIndex
CREATE INDEX "claimable_credits_phone_idx" ON "claimable_credits"("phone");

-- AddForeignKey
ALTER TABLE "supplier_dispatches" ADD CONSTRAINT "supplier_dispatches_supplier_code_fkey" FOREIGN KEY ("supplier_code") REFERENCES "supplier_products"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_dispatches" ADD CONSTRAINT "supplier_dispatches_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_supplier_code_fkey" FOREIGN KEY ("supplier_code") REFERENCES "supplier_products"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_prices" ADD CONSTRAINT "agent_prices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_prices" ADD CONSTRAINT "agent_prices_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_buyer_user_id_fkey" FOREIGN KEY ("buyer_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "earnings" ADD CONSTRAINT "earnings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
