import { createClient } from "@supabase/supabase-js";

const url  = import.meta.env.VITE_SUPABASE_URL;
const key  = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(url, key, {
  auth: { flowType: "pkce" },
});

// Lit la session brute depuis localStorage SANS déclencher le SDK
// (évite __loadSession → _callRefreshToken → _removeSession qui vide la session)
export function getRawSession() {
  try {
    const ref = new URL(url).hostname.split('.')[0];
    const raw = localStorage.getItem(`sb-${ref}-auth-token`);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
