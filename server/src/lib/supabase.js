import { createClient } from "@supabase/supabase-js";
import { config } from "./config.js";

export function createSupabaseForUser(accessToken) {
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    throw new Error("Supabase is not configured on the extraction server.");
  }
  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    },
  });
}

export async function verifyAccessToken(accessToken) {
  const supabase = createSupabaseForUser(accessToken);
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data?.user) {
    return { user: null, error: error?.message || "Invalid or expired token." };
  }
  return { user: data.user, error: null };
}
