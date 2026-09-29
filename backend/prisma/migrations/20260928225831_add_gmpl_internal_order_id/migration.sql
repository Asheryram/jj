-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "gmpl_internal_order_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "orders_gmpl_internal_order_id_key" ON "orders"("gmpl_internal_order_id");
