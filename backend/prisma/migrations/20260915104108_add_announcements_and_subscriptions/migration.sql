-- CreateEnum
CREATE TYPE "AnnouncementAudience" AS ENUM ('all', 'selected');

-- CreateTable
CREATE TABLE "announcements" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "audience" "AnnouncementAudience" NOT NULL,
    "createdBy" TEXT NOT NULL,
    "created_by_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcement_recipients" (
    "id" TEXT NOT NULL,
    "announcement_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "read_at" TIMESTAMP(3),
    "email_sent" BOOLEAN NOT NULL DEFAULT false,
    "email_error" TEXT,

    CONSTRAINT "announcement_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_subscriptions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT,
    "renewal_url" TEXT,
    "notes" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "alert_days_before" INTEGER NOT NULL DEFAULT 14,
    "alerted_at" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "announcements_created_at_idx" ON "announcements"("created_at");

-- CreateIndex
CREATE INDEX "announcement_recipients_user_id_read_at_idx" ON "announcement_recipients"("user_id", "read_at");

-- CreateIndex
CREATE UNIQUE INDEX "announcement_recipients_announcement_id_user_id_key" ON "announcement_recipients"("announcement_id", "user_id");

-- CreateIndex
CREATE INDEX "service_subscriptions_expires_at_idx" ON "service_subscriptions"("expires_at");

-- AddForeignKey
ALTER TABLE "announcement_recipients" ADD CONSTRAINT "announcement_recipients_announcement_id_fkey" FOREIGN KEY ("announcement_id") REFERENCES "announcements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_recipients" ADD CONSTRAINT "announcement_recipients_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
