import { createClient } from "@supabase/supabase-js";

const url  = import.meta.env.VITE_SUPABASE_URL;
const key  = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(url, key, {
  auth: { flowType: "pkce" },
});

// Lit la session brute depuis localStorage SANS déclencher le SDK
// Clé calculée par SupabaseClient : sb-${hostname[0]}-auth-token
export function getRawSession() {
  try {
    const raw = localStorage.getItem("supabase.auth.token");
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
