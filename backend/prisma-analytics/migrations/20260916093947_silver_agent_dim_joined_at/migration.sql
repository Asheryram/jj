/*
  Warnings:

  - Added the required column `joined_at` to the `silver_agent_dim` table without a default value. This is not possible if the table is not empty.
  - Added the required column `role` to the `silver_agent_dim` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "silver_agent_dim" ADD COLUMN     "joined_at" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "role" TEXT NOT NULL;
