-- Remove legacy profile fields and unused denormalized post counters.
ALTER TABLE "users"
  DROP COLUMN "location",
  DROP COLUMN "occupation",
  DROP COLUMN "current_theme_id",
  DROP COLUMN "is_onboarded";

ALTER TABLE "posts"
  DROP COLUMN "like_count",
  DROP COLUMN "comment_count",
  DROP COLUMN "bookmark_count";

-- Theme rewards are no longer supported. Production currently contains only FRAME items.
CREATE TYPE "ItemType_new" AS ENUM ('FRAME');
ALTER TABLE "reward_items"
  ALTER COLUMN "item_type" TYPE "ItemType_new"
  USING ("item_type"::text::"ItemType_new");
ALTER TYPE "ItemType" RENAME TO "ItemType_old";
ALTER TYPE "ItemType_new" RENAME TO "ItemType";
DROP TYPE "ItemType_old";
