-- CreateEnum
CREATE TYPE "BrandingStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "branding" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "shop_name" TEXT,
    "brand_color" TEXT,
    "logo_mime" TEXT,
    "logo_bytes" BYTEA,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branding_requests" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "agent_name" TEXT NOT NULL,
    "agent_code" TEXT NOT NULL,
    "shop_name" TEXT,
    "brand_color" TEXT,
    "logo_mime" TEXT,
    "logo_bytes" BYTEA,
    "status" "BrandingStatus" NOT NULL DEFAULT 'pending',
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),
    "decided_by" TEXT,

    CONSTRAINT "branding_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "branding_user_id_key" ON "branding"("user_id");

-- CreateIndex
CREATE INDEX "branding_requests_status_idx" ON "branding_requests"("status");

-- CreateIndex
CREATE INDEX "branding_requests_user_id_idx" ON "branding_requests"("user_id");

-- AddForeignKey
ALTER TABLE "branding" ADD CONSTRAINT "branding_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branding_requests" ADD CONSTRAINT "branding_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
