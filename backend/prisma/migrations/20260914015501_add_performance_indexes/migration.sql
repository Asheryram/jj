-- CreateIndex
CREATE INDEX "ledger_entries_payment_ref_idx" ON "ledger_entries"("payment_ref");

-- CreateIndex
CREATE INDEX "ledger_entries_withdrawal_id_idx" ON "ledger_entries"("withdrawal_id");

-- CreateIndex
CREATE INDEX "ledger_entries_kind_occurred_at_idx" ON "ledger_entries"("kind", "occurred_at");

-- CreateIndex
CREATE INDEX "orders_status_created_at_idx" ON "orders"("status", "created_at");

-- CreateIndex
CREATE INDEX "orders_sold_by_code_created_at_idx" ON "orders"("sold_by_code", "created_at");

-- CreateIndex
CREATE INDEX "orders_buyer_user_id_idx" ON "orders"("buyer_user_id");

-- CreateIndex
CREATE INDEX "orders_refunded_idx" ON "orders"("refunded");

-- CreateIndex
CREATE INDEX "payments_paid_at_idx" ON "payments"("paid_at");

-- CreateIndex
CREATE INDEX "refund_requests_created_at_idx" ON "refund_requests"("created_at");

-- CreateIndex
CREATE INDEX "refund_requests_paid_at_idx" ON "refund_requests"("paid_at");

-- CreateIndex
CREATE INDEX "supplier_dispatches_created_at_idx" ON "supplier_dispatches"("created_at");

-- CreateIndex
CREATE INDEX "withdrawals_requested_at_idx" ON "withdrawals"("requested_at");

-- CreateIndex
CREATE INDEX "withdrawals_paid_at_idx" ON "withdrawals"("paid_at");

-- CreateIndex
CREATE INDEX "withdrawals_agent_phone_idx" ON "withdrawals"("agent_phone");
