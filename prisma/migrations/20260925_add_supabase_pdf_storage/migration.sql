-- CreateEnum
CREATE TYPE "StorageProvider" AS ENUM ('CLOUDINARY', 'SUPABASE');

-- AlterTable
ALTER TABLE "post_media"
    ADD COLUMN "storage_provider" "StorageProvider" NOT NULL DEFAULT 'CLOUDINARY',
    ADD COLUMN "storage_bucket" TEXT,
    ADD COLUMN "storage_path" TEXT,
    ADD COLUMN "file_size" INTEGER,
    ALTER COLUMN "media_url" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "post_media_post_id_idx" ON "post_media"("post_id");
CREATE INDEX "post_media_storage_provider_idx" ON "post_media"("storage_provider");
