-- Support the bounded newest-comments query without sorting all comments for a post.
CREATE INDEX IF NOT EXISTS "comments_post_id_created_at_idx"
  ON "comments"("post_id", "created_at" DESC);

-- Support reverse tag lookups used by post filtering.
CREATE INDEX IF NOT EXISTS "post_tags_tag_id_post_id_idx"
  ON "post_tags"("tag_id", "post_id");

-- Support a user's report history in newest-first order.
CREATE INDEX IF NOT EXISTS "reports_user_id_created_at_idx"
  ON "reports"("user_id", "created_at" DESC);
