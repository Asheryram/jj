-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "resolved_manually" BOOLEAN NOT NULL DEFAULT false;
