# Security review ? 2026-09-14

## Implemented
- Socket connections require a verified Supabase token and an ACTIVE local account. Room membership is derived exclusively from that identity.
- Removed email-only account linking that rewrote the primary user ID. Conflicting identities now return 409; linking must be handled by the identity provider with ownership verification.
- Strict Bearer parsing for protected HTTP routes; registration and password type/length validation.
- Disabled Supabase session persistence and background token refresh on the backend client.
- Auth endpoints limited to 20 requests per minute per IP, including /me; bounded in-process storage. JSON/form payload and multipart field/file counts are bounded.
- Uploads use an explicit MIME allowlist and basic file signature checks before reaching controllers. SVG and HTML uploads are rejected. This is not malware scanning or full file-format validation.
- Owners cannot edit removed/moderated posts or assign moderation-only statuses.
- Added response headers, no-store for authenticated responses, safe parser/upload errors, and removed internal errors from comment responses.
- Swagger no longer persists authorization; additional environment files are ignored by Git.

## Integration and operational follow-up
- Frontend Socket.IO must connect with auth: { token: session.access_token }. Refresh the token on reconnect. Sending only a user ID is insufficient.
- Socket authorization is checked on connection. Existing connections still need a disconnect/revalidation policy for bans, logout and token expiry.
- Rate limits are per process. For multiple instances use a shared store or gateway; behind a proxy configure trust only for the actual trusted proxy topology, otherwise all clients may share one limit.
- Upload memory can still reach 16 x 25 MiB per request; production ingress needs aggregate request size, concurrency and connection limits.
- API documentation remains publicly available. Decide whether production should expose it.
- Review provider-side Supabase RLS, auth configuration, storage policies and deployment secrets separately; these were not exercised.
- Existing unrelated working-tree changes were preserved. No production database mutation or deployment was performed.

## Validation
Local Node tests cover malformed credentials, Socket identity isolation and inactive accounts, request throttling/reset, security headers, safe errors, body limits, and forged multipart content. External database/auth/Cloudinary end-to-end flows require a staging environment.

## Dependency audit and secret handling
Production audit entries decreased from 12 to 4 (high), remaining in the Prisma tooling dependency chain: prisma, @prisma/config, deepmerge-ts and mysql2. Full audit retains 10 entries (8 high, 2 moderate), including Postman conversion tooling. The suggested force fix downgrades major versions; this was not applied.
Removed Prisma configuration logging of the database connection URL. A credential was printed during build verification by the pre-existing logger; rotate that database password and review historical CI/deployment logs.

## Final verification
- npm run build: PASS (Prisma Client 7.10.0 generated).
- npm test: PASS, 11 tests, including account-linking, provisioning and moderation regression checks.
- Protected routes reject identities missing a local account; only /auth/me allows identity provisioning.
- No deployment or production service integration test was performed.
