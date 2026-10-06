-- AlterTable
ALTER TABLE "users" ADD COLUMN     "tours_completed" TEXT[] DEFAULT ARRAY[]::TEXT[];
