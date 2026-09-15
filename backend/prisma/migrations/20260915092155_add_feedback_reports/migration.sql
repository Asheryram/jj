-- CreateEnum
CREATE TYPE "FeedbackCategory" AS ENUM ('suggestion', 'issue');

-- CreateEnum
CREATE TYPE "FeedbackStatus" AS ENUM ('open', 'reviewed', 'resolved');

-- CreateTable
CREATE TABLE "feedback_reports" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "agent_name" TEXT NOT NULL,
    "agent_code" TEXT NOT NULL,
    "category" "FeedbackCategory" NOT NULL,
    "message" TEXT NOT NULL,
    "status" "FeedbackStatus" NOT NULL DEFAULT 'open',
    "decided_by" TEXT,
    "decided_at" TIMESTAMP(3),
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "feedback_reports_status_idx" ON "feedback_reports"("status");

-- CreateIndex
CREATE INDEX "feedback_reports_user_id_idx" ON "feedback_reports"("user_id");

-- CreateIndex
CREATE INDEX "feedback_reports_created_at_idx" ON "feedback_reports"("created_at");

-- AddForeignKey
ALTER TABLE "feedback_reports" ADD CONSTRAINT "feedback_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
