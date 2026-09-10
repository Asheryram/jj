-- CreateTable
CREATE TABLE "pending_price_changes" (
    "product_id" TEXT NOT NULL,
    "baseline_price" INTEGER NOT NULL,
    "current_price" INTEGER NOT NULL,
    "first_changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_changed_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pending_price_changes_pkey" PRIMARY KEY ("product_id")
);
