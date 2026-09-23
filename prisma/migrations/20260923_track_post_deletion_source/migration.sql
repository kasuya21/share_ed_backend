ALTER TABLE "posts"
ADD COLUMN "deleted_by" TEXT,
ADD COLUMN "deleted_from_status" "PostStatus";
