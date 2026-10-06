-- CreateTable
CREATE TABLE "admin_actions" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "actor_role" "Role" NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "body" JSONB,
    "status_code" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "admin_actions_created_at_idx" ON "admin_actions"("created_at");

-- CreateIndex
CREATE INDEX "admin_actions_actor_id_idx" ON "admin_actions"("actor_id");
