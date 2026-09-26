-- AlterEnum UploadSessionStatus
ALTER TYPE "UploadSessionStatus" ADD VALUE IF NOT EXISTS 'OPEN';
ALTER TYPE "UploadSessionStatus" ADD VALUE IF NOT EXISTS 'FINALIZING';
ALTER TYPE "UploadSessionStatus" ADD VALUE IF NOT EXISTS 'CLEANING';
ALTER TYPE "UploadSessionStatus" ADD VALUE IF NOT EXISTS 'CLEANED';

-- CreateEnum UploadAssetType
CREATE TYPE "UploadAssetType" AS ENUM ('COVER', 'IMAGE', 'PDF');

-- CreateEnum UploadAssetStatus
CREATE TYPE "UploadAssetStatus" AS ENUM ('SIGNED', 'UPLOADED', 'VERIFYING', 'VERIFIED', 'ATTACHED', 'DETACHED', 'DELETE_PENDING', 'DELETED', 'FAILED');

-- CreateEnum JobStatus
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- AlterTable upload_sessions
ALTER TABLE "upload_sessions"
    ADD COLUMN IF NOT EXISTS "draft_id" TEXT,
    ADD COLUMN IF NOT EXISTS "reserved_bytes" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "last_activity_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ALTER COLUMN "requested_types" DROP NOT NULL,
    ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- CreateIndexes on upload_sessions
CREATE UNIQUE INDEX IF NOT EXISTS "upload_sessions_user_id_draft_id_key" ON "upload_sessions"("user_id", "draft_id");
CREATE INDEX IF NOT EXISTS "upload_sessions_last_activity_at_idx" ON "upload_sessions"("last_activity_at");

-- CreateTable upload_assets
CREATE TABLE IF NOT EXISTS "upload_assets" (
    "upload_asset_id" TEXT NOT NULL,
    "upload_session_id" TEXT NOT NULL,
    "client_file_id" TEXT NOT NULL,
    "provider" "StorageProvider" NOT NULL,
    "asset_type" "UploadAssetType" NOT NULL,
    "status" "UploadAssetStatus" NOT NULL DEFAULT 'SIGNED',
    "bucket" TEXT,
    "storage_path" TEXT,
    "public_id" TEXT,
    "secure_url" TEXT,
    "original_name" TEXT,
    "mime_type" TEXT,
    "file_size" INTEGER,
    "checksum" TEXT,
    "verification_error" TEXT,
    "verified_at" TIMESTAMP(3),
    "attached_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "upload_assets_pkey" PRIMARY KEY ("upload_asset_id")
);

-- CreateIndexes on upload_assets
CREATE UNIQUE INDEX IF NOT EXISTS "upload_assets_upload_session_id_client_file_id_key" ON "upload_assets"("upload_session_id", "client_file_id");
CREATE INDEX IF NOT EXISTS "upload_assets_upload_session_id_status_idx" ON "upload_assets"("upload_session_id", "status");
CREATE INDEX IF NOT EXISTS "upload_assets_status_updated_at_idx" ON "upload_assets"("status", "updated_at");
CREATE UNIQUE INDEX IF NOT EXISTS "upload_assets_provider_storage_path_key" ON "upload_assets"("provider", "storage_path") WHERE "storage_path" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "upload_assets_provider_public_id_key" ON "upload_assets"("provider", "public_id") WHERE "public_id" IS NOT NULL;

-- AddForeignKey to upload_assets
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'upload_assets_upload_session_id_fkey'
    ) THEN
        ALTER TABLE "upload_assets" ADD CONSTRAINT "upload_assets_upload_session_id_fkey"
            FOREIGN KEY ("upload_session_id") REFERENCES "upload_sessions"("upload_session_id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- Serialize quota checks per session so concurrent sign requests cannot exceed
-- 15 active files or 50 MiB in total. Text comparison avoids enum-version casts.
CREATE OR REPLACE FUNCTION enforce_upload_asset_quota()
RETURNS TRIGGER AS $$
DECLARE
    active_count INTEGER;
    active_bytes BIGINT;
BEGIN
    PERFORM 1 FROM "upload_sessions"
    WHERE "upload_session_id" = NEW."upload_session_id"
    FOR UPDATE;

    SELECT COUNT(*), COALESCE(SUM("file_size"), 0)
    INTO active_count, active_bytes
    FROM "upload_assets"
    WHERE "upload_session_id" = NEW."upload_session_id"
      AND "upload_asset_id" <> NEW."upload_asset_id"
      AND "status"::text NOT IN ('FAILED', 'DELETED', 'DETACHED', 'DELETE_PENDING');

    IF NEW."status"::text NOT IN ('FAILED', 'DELETED', 'DETACHED', 'DELETE_PENDING') THEN
        active_count := active_count + 1;
        active_bytes := active_bytes + COALESCE(NEW."file_size", 0);
    END IF;

    IF active_count > 15 OR active_bytes > 52428800 THEN
        RAISE EXCEPTION 'upload_asset_quota_exceeded' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "upload_assets_enforce_quota" ON "upload_assets";
CREATE TRIGGER "upload_assets_enforce_quota"
BEFORE INSERT OR UPDATE OF "status", "file_size", "upload_session_id"
ON "upload_assets"
FOR EACH ROW EXECUTE FUNCTION enforce_upload_asset_quota();

-- CreateTable background_jobs
CREATE TABLE IF NOT EXISTS "background_jobs" (
    "job_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMP(3),
    "locked_by" TEXT,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "background_jobs_pkey" PRIMARY KEY ("job_id")
);

-- CreateIndexes on background_jobs
CREATE INDEX IF NOT EXISTS "background_jobs_status_available_at_idx" ON "background_jobs"("status", "available_at");
CREATE INDEX IF NOT EXISTS "background_jobs_locked_at_idx" ON "background_jobs"("locked_at");
