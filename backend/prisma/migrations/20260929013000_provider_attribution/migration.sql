-- LedgerEntry: which supplier float a capital move (top-up/reimbursement/
-- withdrawal) belongs to. Nullable: historical rows predate GMPL and cannot
-- be honestly backfilled. `supplier_cost` entries are never denormalized
-- this way, they stay resolved live via order_ref -> Order.supplierCodeAtSale
-- -> SupplierProduct.provider.
ALTER TABLE "ledger_entries" ADD COLUMN     "provider" TEXT;

-- BeneficiaryRequest: the same phone number can need separate approval at
-- DataHub and at GMPL at different times (a routing switch), so `provider`
-- becomes part of the row's identity instead of `phone` alone.
ALTER TABLE "beneficiary_requests" ADD COLUMN     "provider" TEXT NOT NULL DEFAULT 'datahub-gh';

ALTER TABLE "beneficiary_requests" DROP CONSTRAINT "beneficiary_requests_pkey";
ALTER TABLE "beneficiary_requests" ADD CONSTRAINT "beneficiary_requests_pkey" PRIMARY KEY ("phone", "provider");
