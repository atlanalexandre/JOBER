// ═══════════════════════════════════════════════════════════════════════════
// Session du back-office — vérification du jeton `ts.nonce.signature`
// ═══════════════════════════════════════════════════════════════════════════
//
// Le jeton est émis par `bo-verify-pin` : horodatage, nombre aléatoire, et
// HMAC-SHA256 des deux avec BO_SESSION_SECRET (ou, à défaut, une clé dérivée
// de la clé service role — même règle que l'émission). Valable 24 h.
//
// Trois copies de cette vérification existent (`bo-action`, `stripe-refund`,
// `cron-reset-monthly`), qui acceptent encore l'ancien format à deux parties
// `ts.signature` — plus émis depuis des mois. Celle-ci ne l'accepte pas : un
// format que personne n'émet n'a pas à rester ouvert (étude du 13/10/2026).
// ═══════════════════════════════════════════════════════════════════════════
import crypto from "crypto";

export const DUREE_SESSION_BO_S = 86400;

export function secretSessionBO() {
  const bss = (process.env.BO_SESSION_SECRET || "").replace(/\s/g, "");
  if (bss) return bss;
  const srk = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").replace(/\s/g, "");
  if (srk) return crypto.createHmac("sha256", srk).update("bo-session-fallback").digest("hex");
  return null;
}

/** Vrai si l'en-tête `Authorization` porte une session du back-office valide. */
export function sessionBOValide(enTete, nowMs = Date.now()) {
  if (typeof enTete !== "string" || !enTete.startsWith("Bearer ")) return false;
  const secret = secretSessionBO();
  if (!secret) return false;
  const parts = enTete.slice(7).split(".");
  if (parts.length !== 3) return false;
  const [ts, nonce, sig] = parts;
  if (!/^\d{9,11}$/.test(ts) || !/^[0-9a-f]{8,64}$/.test(nonce) || !/^[0-9a-f]{64}$/.test(sig)) return false;
  const age = Math.floor(nowMs / 1000) - Number(ts);
  if (age < 0 || age > DUREE_SESSION_BO_S) return false;
  const attendu = crypto.createHmac("sha256", secret).update(`${ts}.${nonce}`).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(attendu, "hex"));
}
