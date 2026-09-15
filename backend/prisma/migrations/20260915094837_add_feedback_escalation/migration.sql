-- AlterTable
ALTER TABLE "feedback_reports" ADD COLUMN     "escalated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "escalated_at" TIMESTAMP(3),
ADD COLUMN     "escalated_by" TEXT;

-- CreateIndex
CREATE INDEX "feedback_reports_escalated_idx" ON "feedback_reports"("escalated");
