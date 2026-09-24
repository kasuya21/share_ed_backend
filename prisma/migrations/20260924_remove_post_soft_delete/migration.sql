-- Existing soft-deleted posts become permanent deletions before the lifecycle
-- status and recovery metadata are removed.
DELETE FROM "posts" WHERE "post_status" = 'DELETED';
DELETE FROM "notifications" WHERE "type" = 'POST_RESTORED';

ALTER TABLE "posts"
DROP COLUMN "deleted_by",
DROP COLUMN "deleted_from_status";

CREATE TYPE "PostStatus_new" AS ENUM ('DRAFT', 'ACTIVE', 'UNACTIVED');
ALTER TABLE "posts" ALTER COLUMN "post_status" DROP DEFAULT;
ALTER TABLE "posts"
ALTER COLUMN "post_status" TYPE "PostStatus_new"
USING ("post_status"::text::"PostStatus_new");
ALTER TYPE "PostStatus" RENAME TO "PostStatus_old";
ALTER TYPE "PostStatus_new" RENAME TO "PostStatus";
DROP TYPE "PostStatus_old";
ALTER TABLE "posts" ALTER COLUMN "post_status" SET DEFAULT 'DRAFT';

CREATE TYPE "NotificationTypeCode_new" AS ENUM (
  'NEW_FOLLOWER',
  'NEW_LIKE',
  'LIKE',
  'NEW_COMMENT',
  'NEW_POST',
  'BOOKMARK_REMOVED',
  'POST_SUSPENDED',
  'POST_REMOVED',
  'POST_REPORTED',
  'ACHIEVEMENT_COMPLETED',
  'ACCOUNT_BANNED',
  'ACCOUNT_UNBANNED'
);
ALTER TABLE "notifications" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "notifications"
ALTER COLUMN "type" TYPE "NotificationTypeCode_new"
USING ("type"::text::"NotificationTypeCode_new");
ALTER TYPE "NotificationTypeCode" RENAME TO "NotificationTypeCode_old";
ALTER TYPE "NotificationTypeCode_new" RENAME TO "NotificationTypeCode";
DROP TYPE "NotificationTypeCode_old";
ALTER TABLE "notifications" ALTER COLUMN "type" SET DEFAULT 'NEW_POST';
