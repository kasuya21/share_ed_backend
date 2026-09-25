import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.SUPABASE_URL || "https://placeholder.supabase.co",
  process.env.SUPABASE_ANON_KEY || "placeholder-anon-key",
  { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
);

const supabaseAdminKey = process.env.SUPABASE_SECRET_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (process.env.NODE_ENV === "production" && !supabaseAdminKey) {
  throw new Error("SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY is required in production");
}

export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL || "https://placeholder.supabase.co",
  supabaseAdminKey || "placeholder-service-key",
  { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
);
