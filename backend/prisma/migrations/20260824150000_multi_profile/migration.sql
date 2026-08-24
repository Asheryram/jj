-- DropIndex
DROP INDEX "users_email_key";
-- DropIndex
DROP INDEX "users_phone_key";
-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");
-- CreateIndex
CREATE INDEX "users_phone_idx" ON "users"("phone");
-- CreateIndex
CREATE UNIQUE INDEX "users_email_role_key" ON "users"("email", "role");
-- CreateIndex
CREATE UNIQUE INDEX "users_phone_role_key" ON "users"("phone", "role");
