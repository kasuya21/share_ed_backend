# API access control review

## Policy and findings
- Public: active post feeds, categories, public profile fields, follower/following lists, comments on ACTIVE posts, registration and login.
- Authenticated and active local account: post detail, social mutations, personal notifications/bookmarks/reports/inventory, achievements and profile changes. /auth/me alone permits provisioning a missing local account.
- Owner only: post edits/deletes, comment edits/deletes, profile updates, reward equipment and claims. Media removal is scoped to the owned post ID.
- ADMIN only: account roles/status, categories, rewards, achievement administration, and report moderation routes.
- Post detail keeps existing owner access to drafts and database-authorized moderator/admin access to suspended posts; other users cannot read drafts.

## Changes
- Social routes now require an ACTIVE post: comment listing/creation, like status/toggling, bookmark toggling and reporting. Invalid identifiers return 400; inaccessible/missing posts return the same 404.
- Comment edits require both comment ownership and a published parent post. Owners may still delete their own comments.
- Bookmark lists exclude unpublished posts, preventing draft/hidden content from leaking through previously saved bookmarks.
- HTTP middleware passes the application role read from the database; post detail no longer treats the Supabase role field as the application role.
- Fixed the missing owner account lookup in profile media updates, which previously referenced an undefined user variable.

## Verification
HTTP tests mount actual routers with mocked Supabase and Prisma. Coverage includes every protected route without credentials; every admin/moderator route as a member; forged roles; inactive accounts; hidden post access; cross-user post/comment writes; profile privilege injection; private-list and notification scoping; unowned rewards; and positive owner/moderator/admin cases.

## Scope and limitations
No production writes, database migration, deployment or load test. Mocks verify application authorization and query constraints, not database RLS. Previously distributed public Cloudinary URLs remain outside API authorization; private media requires provider-side access control. Post visibility can change concurrently with requests; strict transactional guarantees across social mutations and moderation need a separate concurrency design. Existing Socket connections are authenticated at connection time; immediate revocation requires a separate disconnect/revalidation policy.
