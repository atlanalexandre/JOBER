// Alerte « nouvelle inscription » (api/support.js, notify_signup) — audit « sécurité », 01/10/2026.
// L'identité venait de la requête : n'importe quel compte faisait envoyer à la direction
// des alertes au nom et à l'adresse de son choix, sans limite.
import { describe, it, expect, vi, afterEach } from "vitest";
import support from "../../../api/support.js";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

function serveur(profil) {
  const mails = [];
  vi.stubEnv("VITE_SUPABASE_URL", "https://b");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "k");
  vi.stubEnv("RESEND_API_KEY", "re_x");
  vi.stubGlobal("fetch", vi.fn(async (url, o = {}) => {
    const u = String(url);
    if (u.endsWith("/auth/v1/user")) return new Response(JSON.stringify({ id: "u1", email: "vrai@exemple.fr", user_metadata: {} }), { status: 200 });
    if (u.includes("resend.com")) { mails.push(JSON.parse(o.body)); return new Response(JSON.stringify({ id: "m" }), { status: 200 }); }
    if (u.includes("/rest/v1/profiles") && (o.method || "GET") === "GET") return new Response(JSON.stringify([profil]), { status: 200 });
    return new Response("[]", { status: 200 });
  }));
  return mails;
}
const appel = () => ({ method: "POST", headers: { authorization: "Bearer jeton" },
  body: { action: "notify_signup", prenom: "Usurpé", nom: "Faux", email: "victime@exemple.fr", role: "prestataire" } });
const rep = () => ({ statut: 0, corps: null, setHeader() {}, status(s) { this.statut = s; return this; }, json(b) { this.corps = b; return this; }, end() { return this; } });

describe("notify_signup", () => {
  it("l'alerte porte l'identité de la base, pas celle de la requête", async () => {
    const mails = serveur({ prenom: "Camille", nom: "Vraie", role: "client", alerte_inscription_at: null });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = rep();
    await support(appel(), res);
    expect(res.statut).toBe(200);
    const texte = JSON.stringify(mails);
    expect(texte).toContain("Camille");
    expect(texte).toContain("vrai@exemple.fr");
    expect(texte).not.toContain("Usurpé");
    expect(texte).not.toContain("victime@exemple.fr");
  });
  it("un compte déjà signalé n'envoie plus rien", async () => {
    const mails = serveur({ prenom: "Camille", nom: "Vraie", role: "client", alerte_inscription_at: "2026-10-01T10:00:00Z" });
    const res = rep();
    await support(appel(), res);
    expect(res.corps?.deja).toBe(true);
    expect(mails).toHaveLength(0);
  });
});
