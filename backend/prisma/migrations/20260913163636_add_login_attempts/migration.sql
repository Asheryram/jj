-- CreateTable
CREATE TABLE "login_attempts" (
    "email" TEXT NOT NULL,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "window_start" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_until" TIMESTAMP(3),

    CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("email")
);
