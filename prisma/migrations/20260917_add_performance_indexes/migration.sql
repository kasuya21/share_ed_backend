CREATE INDEX IF NOT EXISTS "posts_post_status_created_at_idx"
  ON "posts"("post_status", "created_at");

CREATE INDEX IF NOT EXISTS "posts_post_status_view_count_idx"
  ON "posts"("post_status", "view_count");

CREATE INDEX IF NOT EXISTS "post_views_viewed_at_post_id_idx"
  ON "post_views"("viewed_at", "post_id");

CREATE INDEX IF NOT EXISTS "notifications_user_id_created_at_idx"
  ON "notifications"("user_id", "created_at");
