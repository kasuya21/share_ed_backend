ALTER TYPE "NotificationTypeCode" ADD VALUE IF NOT EXISTS 'LIKE';

ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "actor_id" TEXT;

WITH ranked AS (
  SELECT "notification_id",
         ROW_NUMBER() OVER (
           PARTITION BY "user_id", "actor_id", "post_id", "type"
           ORDER BY "created_at" DESC, "notification_id" DESC
         ) AS row_number
  FROM "notifications"
  WHERE "type" = 'LIKE'
    AND "actor_id" IS NOT NULL
    AND "post_id" IS NOT NULL
)
DELETE FROM "notifications" n
USING ranked r
WHERE n."notification_id" = r."notification_id"
  AND r.row_number > 1;

CREATE INDEX IF NOT EXISTS "notifications_actor_id_idx" ON "notifications"("actor_id");
CREATE INDEX IF NOT EXISTS "notifications_user_id_actor_id_post_id_type_idx"
  ON "notifications"("user_id", "actor_id", "post_id", "type");

CREATE UNIQUE INDEX IF NOT EXISTS "notifications_like_identity_key"
  ON "notifications"("user_id", "actor_id", "post_id", "type")
  WHERE "type" = 'LIKE' AND "actor_id" IS NOT NULL AND "post_id" IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notifications_actor_id_fkey'
  ) THEN
    ALTER TABLE "notifications"
      ADD CONSTRAINT "notifications_actor_id_fkey"
      FOREIGN KEY ("actor_id") REFERENCES "users"("user_id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
