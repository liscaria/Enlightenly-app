import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const MATERIALS_BUCKET =
  import.meta.env.VITE_SUPABASE_BUCKET || "materials";

export const QUESTION_PAPERS_BUCKET =
  import.meta.env.VITE_SUPABASE_QUESTION_PAPERS_BUCKET || "question-papers";

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null;

if (!isSupabaseConfigured && typeof window !== "undefined") {
  // eslint-disable-next-line no-console
  console.info(
    "[Enlightenly] Supabase not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local to sync to Postgres."
  );
}
