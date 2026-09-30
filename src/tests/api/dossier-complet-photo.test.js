import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import handler from "../../../api/notify-doc.js";

// 30/09/2026 : une photo enregistrée depuis « Modifier mon profil » va dans
// `profiles.avatar_url` sans passer par le dépôt de pièces. Si c'était la
// dernière pièce manquante, l'alerte « dossier complet » ne partait pas.

const AUTRES = ["kbis", "urssaf", "cni", "domicile", "rib", "rc_pro"];

function reponse() {
  const res = { statut: 0, corps: null };
  res.status = (s) => { res.statut = s; return res; };
  res.json = (c) => { res.corps = c; return res; };
  res.end = () => res;
  return res;
}

function simuler({ profil, types }) {
  const courriels = [];
  vi.stubGlobal("fetch", vi.fn(async (url, o = {}) => {
    const u = String(url);
    if (u.includes("/auth/v1/user")) return new Response(JSON.stringify({ id: "p1", email: "p@test.fr", user_metadata: { role: "prestataire" } }), { status: 200 });
    if (u.includes("/rest/v1/profiles")) return new Response(JSON.stringify([profil]), { status: 200 });
    if (u.includes("/rest/v1/documents")) return new Response(JSON.stringify(types.map(type => ({ type }))), { status: 200 });
    if (u.includes("api.resend.com")) { courriels.push(JSON.parse(o.body)); return new Response("{}", { status: 200 }); }
    return new Response("{}", { status: 404 });
  }));
  return courriels;
}

const appel = () => ({ method: "POST", headers: { authorization: "Bearer jeton" }, body: { verifierDossier: true } });
const PROFIL = { role: "prestataire", prenom: "Awa", nom: "D", status: "approved", missions_enabled: false, avatar_url: "data:image/jpeg;base64,xx", cv: null };

beforeEach(() => {
  vi.stubEnv("VITE_SUPABASE_URL", "https://base.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "cle");
  vi.stubEnv("RESEND_API_KEY", "resend");
  vi.stubEnv("ADMIN_EMAIL", "admin@test.fr");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("photo de profil, dernière pièce du dossier", () => {
  it("toutes les autres pièces déposées : une alerte « dossier complet »", async () => {
    const courriels = simuler({ profil: PROFIL, types: AUTRES });
    const res = reponse();
    await handler(appel(), res);
    expect(res.statut).toBe(200);
    expect(res.corps.alerte).toBe(true);
    expect(courriels).toHaveLength(1);
    expect(courriels[0].subject).toContain("Dossier complet");
  });

  it("une autre pièce manque encore : rien", async () => {
    const courriels = simuler({ profil: PROFIL, types: AUTRES.filter(t => t !== "rib") });
    const res = reponse();
    await handler(appel(), res);
    expect(res.corps.alerte).toBe(false);
    expect(courriels).toHaveLength(0);
  });

  it("une photo était déjà déposée comme pièce : le dossier était déjà complet, pas de nouvelle alerte", async () => {
    const courriels = simuler({ profil: PROFIL, types: [...AUTRES, "photo"] });
    await handler(appel(), reponse());
    expect(courriels).toHaveLength(0);
  });

  it("pas de photo en base : l'écran ne suffit pas à déclencher l'alerte", async () => {
    const courriels = simuler({ profil: { ...PROFIL, avatar_url: null }, types: AUTRES });
    await handler(appel(), reponse());
    expect(courriels).toHaveLength(0);
  });

  it("compte déjà activé, ou pas encore validé : rien", async () => {
    for (const p of [{ ...PROFIL, missions_enabled: true }, { ...PROFIL, status: "pending" }]) {
      const courriels = simuler({ profil: p, types: AUTRES });
      await handler(appel(), reponse());
      expect(courriels).toHaveLength(0);
      vi.unstubAllGlobals();
    }
  });
});
