/** Verify a Supabase JWT and return the claims used by API authorization. */
export async function verifyAccessToken(supabase, token) {
  const { data, error } = await supabase.auth.getClaims(token);
  const claims = data?.claims;
  if (error || typeof claims?.sub !== "string" || !claims.sub) {
    return { user: null, error: error || new Error("Token does not contain a subject") };
  }
  return {
    user: {
      id: claims.sub,
      email: claims.email,
      role: claims.role,
      user_metadata: claims.user_metadata || {},
      app_metadata: claims.app_metadata || {},
    },
    error: null,
  };
}
