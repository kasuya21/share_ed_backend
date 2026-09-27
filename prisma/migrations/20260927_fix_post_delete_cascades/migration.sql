-- Older databases were initialized with ON DELETE RESTRICT even though the
-- current Prisma relations require dependent post data to be removed.
-- Remove any legacy orphan rows before rebuilding the foreign keys.
DELETE FROM "comments" child
WHERE NOT EXISTS (SELECT 1 FROM "posts" parent WHERE parent."post_id" = child."post_id");

DELETE FROM "likes" child
WHERE NOT EXISTS (SELECT 1 FROM "posts" parent WHERE parent."post_id" = child."post_id");

DELETE FROM "bookmarks" child
WHERE NOT EXISTS (SELECT 1 FROM "posts" parent WHERE parent."post_id" = child."post_id");

DELETE FROM "post_tags" child
WHERE NOT EXISTS (SELECT 1 FROM "posts" parent WHERE parent."post_id" = child."post_id");

DELETE FROM "post_media" child
WHERE NOT EXISTS (SELECT 1 FROM "posts" parent WHERE parent."post_id" = child."post_id");

DELETE FROM "post_views" child
WHERE NOT EXISTS (SELECT 1 FROM "posts" parent WHERE parent."post_id" = child."post_id");

DELETE FROM "reports" child
WHERE NOT EXISTS (SELECT 1 FROM "posts" parent WHERE parent."post_id" = child."post_id");

UPDATE "notifications" child
SET "post_id" = NULL
WHERE "post_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "posts" parent WHERE parent."post_id" = child."post_id");

ALTER TABLE "comments" DROP CONSTRAINT IF EXISTS "comments_post_id_fkey";
ALTER TABLE "comments" ADD CONSTRAINT "comments_post_id_fkey"
  FOREIGN KEY ("post_id") REFERENCES "posts"("post_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "likes" DROP CONSTRAINT IF EXISTS "likes_post_id_fkey";
ALTER TABLE "likes" ADD CONSTRAINT "likes_post_id_fkey"
  FOREIGN KEY ("post_id") REFERENCES "posts"("post_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "bookmarks" DROP CONSTRAINT IF EXISTS "bookmarks_post_id_fkey";
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_post_id_fkey"
  FOREIGN KEY ("post_id") REFERENCES "posts"("post_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "post_tags" DROP CONSTRAINT IF EXISTS "post_tags_post_id_fkey";
ALTER TABLE "post_tags" ADD CONSTRAINT "post_tags_post_id_fkey"
  FOREIGN KEY ("post_id") REFERENCES "posts"("post_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "post_media" DROP CONSTRAINT IF EXISTS "post_media_post_id_fkey";
ALTER TABLE "post_media" ADD CONSTRAINT "post_media_post_id_fkey"
  FOREIGN KEY ("post_id") REFERENCES "posts"("post_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "post_views" DROP CONSTRAINT IF EXISTS "post_views_post_id_fkey";
ALTER TABLE "post_views" ADD CONSTRAINT "post_views_post_id_fkey"
  FOREIGN KEY ("post_id") REFERENCES "posts"("post_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "reports" DROP CONSTRAINT IF EXISTS "reports_post_id_fkey";
ALTER TABLE "reports" ADD CONSTRAINT "reports_post_id_fkey"
  FOREIGN KEY ("post_id") REFERENCES "posts"("post_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "notifications_post_id_fkey";
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_post_id_fkey"
  FOREIGN KEY ("post_id") REFERENCES "posts"("post_id") ON DELETE CASCADE ON UPDATE CASCADE;
