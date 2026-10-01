// Réinitialisation du mot de passe — audit « sécurité », 01/10/2026 (api/_reinitialisation.js).
//
// 1. Plus de secret public de repli (« alane-reset-fallback », en clair dans le dépôt) :
//    qui le lisait pouvait changer le mot de passe de n'importe quel compte.
// 2. Un lien ne sert qu'une fois : il est lié à l'état du compte.
// 3. Une demande au plus toutes les dix minutes par compte.
import { describe, it, expect, vi, afterEach } from "vitest";
import crypto from "node:crypto";
import { secretReinitialisation, signerLien, verifierLien, demandeTropRapprochee, VALIDITE_LIEN_MS } from "../../../api/_reinitialisation.js";
import forgotPassword from "../../../api/forgot-password.js";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

const EMAIL = "demandeur@exemple.fr";

describe("secret", () => {
  it("n'existe pas sans aucune clé — jamais de valeur publique", () => {
    expect(secretReinitialisation({})).toBeNull();
  });
  it("un lien signé avec l'ancien secret public est refusé", () => {
    const secret = secretReinitialisation({ SUPABASE_SERVICE_ROLE_KEY: "cle-serveur" });
    const t = Date.now();
    const forge = `${Buffer.from(EMAIL).toString("base64url")}.${t}.`
      + crypto.createHmac("sha256", "alane-reset-fallback").update(`${EMAIL}:${t}`).digest("hex");
    expect(verifierLien(secret, forge, "etat")).not.toBe("ok");
  });
  it("est propre à cet usage : différent du secret de session brut", () => {
    expect(secretReinitialisation({ BO_SESSION_SECRET: "s" })).not.toBe("s");
  });
});

describe("lien", () => {
  const secret = secretReinitialisation({ BO_SESSION_SECRET: "s" });
  it("vaut pour l'état du compte qui l'a signé", () => {
    expect(verifierLien(secret, signerLien(secret, EMAIL, "etat-1"), "etat-1")).toBe("ok");
  });
  it("ne vaut plus une fois le compte modifié — un lien déjà servi est refusé", () => {
    expect(verifierLien(secret, signerLien(secret, EMAIL, "etat-1"), "etat-2")).toBe("perime");
  });
  it("expire au bout d'une heure", () => {
    const t = Date.now() - VALIDITE_LIEN_MS - 1000;
    expect(verifierLien(secret, signerLien(secret, EMAIL, "e", t), "e")).toBe("expire");
  });
  it("refuse un jeton mal formé", () => {
    expect(verifierLien(secret, "n.importe.quoi", "e")).toBe("invalide");
  });
});

describe("demandes rapprochées", () => {
  it("moins de dix minutes après la précédente : refusée", () => {
    const compte = { app_metadata: { reinit_demandee_at: new Date(Date.now() - 60_000).toISOString() } };
    expect(demandeTropRapprochee(compte)).toBe(true);
  });
  it("première demande, ou plus de dix minutes après : acceptée", () => {
    expect(demandeTropRapprochee({ app_metadata: {} })).toBe(false);
    expect(demandeTropRapprochee({ app_metadata: { reinit_demandee_at: new Date(Date.now() - 11 * 60_000).toISOString() } })).toBe(false);
  });
});

describe("forgot-password", () => {
  function serveur(compte) {
    const appels = { put: [], mails: [] };
    vi.stubEnv("VITE_SUPABASE_URL", "https://b");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "k");
    vi.stubEnv("BO_SESSION_SECRET", "");
    vi.stubEnv("RESEND_API_KEY", "re_x");
    vi.stubGlobal("fetch", vi.fn(async (url, o = {}) => {
      if (String(url).includes("resend.com")) { appels.mails.push(JSON.parse(o.body)); return new Response("{}", { status: 200 }); }
      if (o.method === "PUT") { appels.put.push(JSON.parse(o.body)); return new Response(JSON.stringify({ ...compte, updated_at: "etat-apres-demande" }), { status: 200 }); }
      return new Response(JSON.stringify({ users: [compte] }), { status: 200 });
    }));
    return appels;
  }
  const rep = () => ({ statut: 0, status(s) { this.statut = s; return this; }, json() { return this; } });

  it("note la demande, puis signe le lien avec l'état qui en résulte", async () => {
    const appels = serveur({ id: "u1", email: EMAIL, updated_at: "etat-avant", app_metadata: {} });
    vi.spyOn(console, "log").mockImplementation(() => {});
    const res = rep();
    await forgotPassword({ method: "POST", body: { email: EMAIL } }, res);
    expect(res.statut).toBe(200);
    expect(appels.put[0].app_metadata.reinit_demandee_at).toBeTruthy();
    const jeton = decodeURIComponent(appels.mails[0].html.match(/reset_token=([^"&]+)/)[1]);
    const secret = secretReinitialisation({ SUPABASE_SERVICE_ROLE_KEY: "k" });
    expect(verifierLien(secret, jeton, "etat-apres-demande")).toBe("ok");
  });
  it("une seconde demande dans les dix minutes n'envoie rien", async () => {
    const appels = serveur({ id: "u1", email: EMAIL, updated_at: "e", app_metadata: { reinit_demandee_at: new Date().toISOString() } });
    vi.spyOn(console, "log").mockImplementation(() => {});
    const res = rep();
    await forgotPassword({ method: "POST", body: { email: EMAIL } }, res);
    expect(res.statut).toBe(200);
    expect(appels.mails).toHaveLength(0);
    expect(appels.put).toHaveLength(0);
  });
});
