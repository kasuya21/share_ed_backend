# Error logging

Application errors are written as one JSON record per line to stderr (visible in hosting logs). No logging service or external destination is required.

Each record includes a UTC timestamp, severity, stable event name, and error name/code/message/stack when available. HTTP records include the server-generated requestId, method, matched route template and authenticated userId when available. Request completion records include status and durationMs; validation responses include invalidFields.

Use the response's `X-Request-ID` header to find related records. This header is exposed through CORS. A failed request can generate a detailed cause record followed by an `http.request.failed` completion record with the same ID. Background notification/upload work started within a request inherits its ID. Scheduled jobs have operation-specific events and resource IDs instead.

Examples of events:
- `controllers.createPost`: post creation failed; inspect error.code and stack.
- `auth.login.provider_rejected`: authentication provider rejected login.
- `http.unhandled_error`: error reached the Express error handler.
- `post.view_tracking_failed`: viewing succeeded but view tracking failed.
- `database.pool.error`: database pool emitted an error.
- `cron.media.delete_failed`: scheduled media removal failed.

Passwords, tokens, cookies, configured credential values and URLs are redacted. Full request bodies, query strings, raw database metadata and query arguments are not recorded. Prisma errors use safe descriptions and codes; stacks include frame locations only. Do not pass arbitrary payloads into event names or context metadata.

This change improves diagnostics; it does not suppress fatal process errors or automatically restart a crashed server. Client API response bodies remain unchanged. Tests use local HTTP requests and simulated errors, without production service calls.
