-- Every movement of money, once.
--
-- `idempotency_key` is derived from the event rather than the moment of writing,
-- so a retried webhook, a re-checked order or a repeated settlement collides
-- instead of double-counting. `affects_profit` separates cash movement from
-- profit and loss: paying an agent settles a margin already accrued, and
-- counting both would charge it twice.

-- CreateEnum
CREATE TYPE "LedgerKind" AS ENUM ('revenue', 'payment_fee', 'supplier_cost', 'agent_margin', 'referral_bonus', 'refund', 'payout', 'payout_fee', 'topup');

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "kind" "LedgerKind" NOT NULL,
    "amount" INTEGER NOT NULL,
    "affects_profit" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT NOT NULL,
    "order_ref" TEXT,
    "payment_ref" TEXT,
    "withdrawal_id" TEXT,
    "user_id" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_idempotency_key_key" ON "ledger_entries"("idempotency_key");

-- CreateIndex
CREATE INDEX "ledger_entries_kind_idx" ON "ledger_entries"("kind");

-- CreateIndex
CREATE INDEX "ledger_entries_occurred_at_idx" ON "ledger_entries"("occurred_at");

-- CreateIndex
CREATE INDEX "ledger_entries_order_ref_idx" ON "ledger_entries"("order_ref");

-- CreateIndex
CREATE INDEX "ledger_entries_user_id_idx" ON "ledger_entries"("user_id");
