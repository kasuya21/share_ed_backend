/** Verify a Supabase JWT and return the claims used by API authorization. */
export async function verifyAccessToken(supabase, token) {
  const { data, error } = await supabase.auth.getClaims(token);
  const claims = data?.claims;
  const issuedAt = Number(claims?.iat);
  const expiresAt = Number(claims?.exp);
  const requestedMaximum = Number.parseInt(process.env.ACCESS_TOKEN_MAX_AGE_SECONDS, 10);
  const maximumLifetime = Number.isSafeInteger(requestedMaximum) && requestedMaximum >= 300
    ? Math.min(requestedMaximum, 3600)
    : 3600;
  const invalidLifetime = !Number.isSafeInteger(issuedAt)
    || !Number.isSafeInteger(expiresAt)
    || expiresAt <= issuedAt
    || expiresAt - issuedAt > maximumLifetime + 60;

  if (error || typeof claims?.sub !== "string" || !claims.sub || invalidLifetime) {
    const validationError = typeof claims?.sub !== "string" || !claims?.sub
      ? new Error("Token does not contain a subject")
      : new Error("Token lifetime is invalid");
    return { user: null, error: error || validationError };
  }
  return {
    user: {
      id: claims.sub,
      email: claims.email,
      role: claims.role,
      aal: claims.aal,
      session_id: claims.session_id,
      issued_at: issuedAt,
      expires_at: expiresAt,
      user_metadata: claims.user_metadata || {},
      app_metadata: claims.app_metadata || {},
    },
    error: null,
  };
}
