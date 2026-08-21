-- CreateEnum
CREATE TYPE "SetupTokenPurpose" AS ENUM ('setup', 'reset');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'superadmin';

-- CreateTable
CREATE TABLE "setup_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "purpose" "SetupTokenPurpose" NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "setup_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "setup_tokens_token_hash_key" ON "setup_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "setup_tokens_user_id_idx" ON "setup_tokens"("user_id");

-- AddForeignKey
ALTER TABLE "setup_tokens" ADD CONSTRAINT "setup_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
