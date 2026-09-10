-- AlterTable
ALTER TABLE "products" ADD COLUMN     "priced_against_real_cost" INTEGER,
ADD COLUMN     "priced_against_real_cost_at" TIMESTAMP(3);
