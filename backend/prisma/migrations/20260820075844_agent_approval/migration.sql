-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "UserStatus" ADD VALUE 'pending';
ALTER TYPE "UserStatus" ADD VALUE 'rejected';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "decided_at" TIMESTAMP(3),
ADD COLUMN     "decided_by" TEXT,
ADD COLUMN     "status_note" TEXT;
