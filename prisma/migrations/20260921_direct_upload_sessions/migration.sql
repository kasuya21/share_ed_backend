CREATE TYPE "UploadSessionStatus" AS ENUM ('PENDING', 'COMMITTED', 'EXPIRED');

ALTER TABLE "posts" ADD COLUMN "idempotency_key" TEXT;

CREATE TABLE "upload_sessions" (
    "upload_session_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "post_id" TEXT,
    "status" "UploadSessionStatus" NOT NULL DEFAULT 'PENDING',
    "requested_types" JSONB NOT NULL,
    "verified_assets" JSONB,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "upload_sessions_pkey" PRIMARY KEY ("upload_session_id")
);

CREATE UNIQUE INDEX "posts_author_id_idempotency_key_key" ON "posts"("author_id", "idempotency_key");
CREATE INDEX "upload_sessions_user_id_status_idx" ON "upload_sessions"("user_id", "status");
CREATE INDEX "upload_sessions_status_expires_at_idx" ON "upload_sessions"("status", "expires_at");

ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_post_id_fkey"
FOREIGN KEY ("post_id") REFERENCES "posts"("post_id") ON DELETE SET NULL ON UPDATE CASCADE;
