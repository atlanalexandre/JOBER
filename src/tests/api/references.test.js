// Références d'expérience confirmées par e-mail (09/11/2026, décision d'Alexandre).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import {
  validerReference, validerReponse, alerteDe, courrielReference, empreinte, genererJeton, jetonExpire, MAX_REFERENCES, quiDe,
} from "../../../api/_references.js";

const corps = (x = {}) => ({ siret: "552 100 554 00025", metier: "Agent de propreté", annee_debut: 2021, annee_fin: 2023,
  contact_nom: "Claire Martin", contact_email: "c.martin@nettoyage-pro.fr", accord: true, ...x });
const ctx = { metiersDeclares: ["Agent de propreté", { metier: "Plongeur" }], emailPrestataire: "moi@gmail.com", anneeCourante: 2026 };

describe("la demande du prestataire", () => {
  it("acceptée : SIRET nettoyé, un de ses métiers, des années, un contact qui n'est pas lui", () => {
    const v = validerReference(corps(), ctx);
    expect(v.ok).toBe(true);
    expect(v.valeur).toMatchObject({ siret: "55210055400025", metier: "Agent de propreté", annee_fin: 2023, contact_email: "c.martin@nettoyage-pro.fr" });
    expect(validerReference(corps({ metier: "Plongeur", annee_fin: "" }), ctx).valeur.annee_fin).toBeNull();
  });
  it("refusée : métier qu'il n'a pas déclaré, SIRET faux, années incohérentes, lui-même, sans accord", () => {
    expect(validerReference(corps({ metier: "Agent de sécurité" }), ctx).ok).toBe(false);
    expect(validerReference(corps({ siret: "123" }), ctx).ok).toBe(false);
    expect(validerReference(corps({ annee_debut: 2024, annee_fin: 2022 }), ctx).ok).toBe(false);
    expect(validerReference(corps({ annee_debut: 2030 }), ctx).ok).toBe(false);
    expect(validerReference(corps({ contact_email: "MOI@gmail.com" }), ctx).erreur).toContain("autre personne");
    expect(validerReference(corps({ accord: false }), ctx).ok).toBe(false);
    expect(validerReference(corps({ contact_nom: "<a href=x>" }), ctx).ok).toBe(false);
  });
  it(`${MAX_REFERENCES} références au plus, plafond annoncé`, () => expect(MAX_REFERENCES).toBe(5));
  it("un métier réécrit dans user_metadata, hors du catalogue, n'entre pas dans l'e-mail (09/11/2026)", () => {
    const v = validerReference(corps({ metier: "Réclamez votre remboursement ici" }), { ...ctx, metiersDeclares: ["Réclamez votre remboursement ici"] });
    expect(v.ok).toBe(false);
  });
  it("le nom vient de la fiche, réduit à des lettres : une adresse ne passe pas (09/11/2026)", () => {
    const q = quiDe({ prenom: "Gagnez 500€ sur arnaque.example", nom: "X" });
    for (const morceau of ["500", "€", "arnaque.example"]) expect(q).not.toContain(morceau);
    expect(quiDe(null)).toBe("Un prestataire");
  });
});

describe("l'anti-fraude et le message", () => {
  it("signale une adresse personnelle et un contact partagé", () => {
    expect(alerteDe({ contactEmail: "c.martin@nettoyage-pro.fr" })).toBeNull();
    expect(alerteDe({ contactEmail: "ami@gmail.com" })).toContain("adresse personnelle");
    expect(alerteDe({ contactEmail: "x@ent.fr", autresPrestataires: 2 })).toContain("2 autre(s) prestataire(s)");
  });
  it("le message échappe tout, et ne porte que ce que le serveur a lu", () => {
    const m = courrielReference({ qui: quiDe({ prenom: "Léa", nom: "Durand" }), entreprise: "<b>ACME</b>", metier: "Agent de propreté", debut: 2021, fin: 2023, lien: "https://www.alane.fr/reference?t=abc", expireLe: "09/12/2026" });
    expect(m.subject).toContain("Léa D.");
    expect(m.html).toContain("&lt;b&gt;ACME&lt;/b&gt;");
    expect(m.html).toContain("de 2021 à 2023");
    expect(m.html).toContain("jusqu'au 09/12/2026");
    expect(m.html).toContain("supprime avec le compte");
  });
  it("le jeton n'est gardé que par son empreinte, et expire en 30 jours", () => {
    const { jeton, hash } = genererJeton();
    expect(jeton.length).toBeGreaterThanOrEqual(40);
    expect(hash).toBe(empreinte(jeton));
    expect(hash).not.toContain(jeton);
    expect(jetonExpire("2026-10-01T00:00:00Z", Date.parse("2026-11-09T00:00:00Z"))).toBe(true);
    expect(jetonExpire("2026-11-01T00:00:00Z", Date.parse("2026-11-09T00:00:00Z"))).toBe(false);
  });
  it("la réponse : oui/non obligatoire, commentaire borné, pas de recommandation sans avoir travaillé", () => {
    expect(validerReponse({}).ok).toBe(false);
    expect(validerReponse({ a_travaille: false, recommande: true }).valeur.recommande).toBeNull();
    expect(validerReponse({ a_travaille: true, commentaire: "x".repeat(900) }).valeur.commentaire).toHaveLength(500);
  });
});

// ── Le point d'entrée, avec une base et des services simulés ────────────────
vi.mock("../../../api/_auth.js", () => ({
  verifyUser: vi.fn(async () => ({ id: "p1", email: "moi@gmail.com", user_metadata: { prenom: "Léa", nom: "Durand", metier: "Agent de propreté" } })),
  refuserCompteBloque: vi.fn(async () => false),
}));
vi.mock("../../../api/_email.js", async (orig) => ({ ...(await orig()), sendEmail: vi.fn(async () => true) }));
const { default: handler } = await import("../../../api/references.js");
const { sendEmail } = await import("../../../api/_email.js");

function reponse() {
  const res = { statusCode: 0, corps: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (j) => { res.corps = j; return res; };
  res.end = () => res;
  return res;
}
const appel = async (body) => { const res = reponse(); await handler({ method: "POST", headers: { authorization: "Bearer x" }, body }, res); return res; };

describe("/api/references", () => {
  let appels, base;
  beforeEach(() => {
    process.env.VITE_SUPABASE_URL = "https://b.test"; process.env.SUPABASE_SERVICE_ROLE_KEY = "k";
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    appels = [];
    base = { role: "prestataire", existantes: [], partages: [], sirene: { results: [{ siren: "552100554", nom_complet: "NETTOYAGE PRO", etat_administratif: "A", siege: { siret: "55210055400025" } }] },
      parJeton: [], ecrites: [{ id: "r1" }] };
    vi.stubGlobal("fetch", vi.fn(async (url, o = {}) => {
      const u = String(url), m = o.method || "GET";
      appels.push({ u, m, corps: o.body ? JSON.parse(o.body) : null });
      const ok = (x) => new Response(JSON.stringify(x), { status: 200 });
      if (u.includes("recherche-entreprises")) return ok(base.sirene);
      if (u.includes("/profiles?id=eq.p1&select=")) return ok([{ role: base.role, prenom: "Léa", nom: "Durand" }]);
      if (u.includes("references_experience?jeton_hash=")) return ok(base.parJeton);
      if (u.includes("references_experience?prestataire_id=eq.p1")) return ok(base.existantes);
      if (u.includes("references_experience?contact_email=")) return ok(base.partages);
      if (u.includes("references_experience") && m === "POST") return ok([{ id: "r1" }]);
      if (u.includes("references_experience") && m === "PATCH") return ok(base.ecrites);
      if (u.includes("/auth/v1/admin/users/")) return ok({ user_metadata: { prenom: "Léa", nom: "Durand" } });
      return ok([]);
    }));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("ajouter : le nom de l'entreprise vient du registre, pas du prestataire ; seule l'empreinte du jeton est gardée", async () => {
    const r = await appel({ action: "ajouter", ...corps(), entreprise: "Texte libre du navigateur" });
    expect(r.statusCode, JSON.stringify(r.corps)).toBe(200);
    const insertion = appels.find(a => a.m === "POST" && a.u.includes("references_experience")).corps;
    expect(insertion.entreprise).toBe("NETTOYAGE PRO");
    expect(insertion.jeton_hash).toMatch(/^[0-9a-f]{64}$/);
    const envoi = sendEmail.mock.calls.at(-1)[0];
    expect(envoi.html).not.toContain("Texte libre");
    const jeton = envoi.html.match(/reference\?t=([A-Za-z0-9_-]+)/)[1];
    expect(empreinte(jeton)).toBe(insertion.jeton_hash);
  });
  it("ajouter : refusé à un client, au-delà de 5, pour un doublon, pour une entreprise fermée", async () => {
    base.role = "client";
    expect((await appel({ action: "ajouter", ...corps() })).statusCode).toBe(403);
    const recente = new Date().toISOString(), ancienne = new Date(Date.now() - 40 * 86400000).toISOString();
    base.role = "prestataire"; base.existantes = Array.from({ length: 5 }, (_, i) => ({ contact_email: `x${i}@a.fr`, statut: "en_attente", created_at: recente }));
    expect((await appel({ action: "ajouter", ...corps() })).statusCode).toBe(409);
    // Cinq demandes expirées ne bloquent plus rien, et la même personne peut être relancée (09/11/2026).
    base.existantes = Array.from({ length: 5 }, (_, i) => ({ contact_email: i ? `x${i}@a.fr` : "c.martin@nettoyage-pro.fr", statut: i % 2 ? "expiree" : "en_attente", created_at: ancienne }));
    expect((await appel({ action: "ajouter", ...corps() })).statusCode).toBe(200);
    base.existantes = [{ contact_email: "c.martin@nettoyage-pro.fr", statut: "en_attente", created_at: recente }];
    expect((await appel({ action: "ajouter", ...corps() })).statusCode).toBe(409);
    base.existantes = []; base.sirene.results[0].etat_administratif = "F";
    expect((await appel({ action: "ajouter", ...corps() })).statusCode).toBe(400);
  });
  it("ajouter : e-mail non parti → la référence est retirée, le prestataire réessaie", async () => {
    sendEmail.mockResolvedValueOnce(undefined);
    const r = await appel({ action: "ajouter", ...corps() });
    expect(r.statusCode).toBe(502);
    expect(appels.some(a => a.m === "DELETE" && a.u.includes("references_experience?id=eq.r1"))).toBe(true);
  });
  it("répondre : une seule fois, la condition sur le statut rend l'écriture atomique", async () => {
    base.parJeton = [{ id: "r1", prestataire_id: "p1", entreprise: "NETTOYAGE PRO", metier: "Agent de propreté", annee_debut: 2021, statut: "en_attente", created_at: new Date().toISOString() }];
    const ok = await appel({ action: "repondre", jeton: "x".repeat(43), reponse: { a_travaille: true, recommande: true } });
    expect(ok.statusCode).toBe(200);
    const ecrit = appels.find(a => a.m === "PATCH");
    expect(ecrit.u).toContain("statut=eq.en_attente");
    expect(ecrit.corps.statut).toBe("confirmee");
    base.ecrites = [];
    expect((await appel({ action: "repondre", jeton: "x".repeat(43), reponse: { a_travaille: true } })).statusCode).toBe(410);
    base.parJeton[0].statut = "confirmee";
    expect((await appel({ action: "lire", jeton: "x".repeat(43) })).statusCode).toBe(410);
  });
  it("lire un lien expiré par le balayage : « expiré », et non « déjà répondu » (10/11/2026)", async () => {
    base.parJeton = [{ id: "r1", prestataire_id: "p1", entreprise: "X", metier: "Agent de propreté", annee_debut: 2021, statut: "expiree", created_at: new Date().toISOString() }];
    const r = await appel({ action: "lire", jeton: "x".repeat(43) });
    expect(r.statusCode).toBe(410);
    expect(r.corps.error).toBe("Ce lien a expiré.");
  });
  it("un contact déjà cité ailleurs : l'alerte remonte aussi sur les références antérieures (10/11/2026)", async () => {
    base.partages = [{ prestataire_id: "autre" }];
    const r = await appel({ action: "ajouter", ...corps() });
    expect(r.statusCode).toBe(200);
    const anterieures = appels.find(a => a.m === "PATCH" && a.u.includes("prestataire_id=neq.p1") && a.u.includes("alerte=is.null"));
    expect(anterieures.corps.alerte).toContain("autre(s) prestataire(s)");
  });
  it("lire : le prénom et l'initiale, lus sur la fiche", async () => {
    base.parJeton = [{ id: "r1", prestataire_id: "p1", entreprise: "NETTOYAGE PRO", metier: "Agent de propreté", annee_debut: 2021, annee_fin: null, statut: "en_attente", created_at: new Date().toISOString() }];
    const r = await appel({ action: "lire", jeton: "x".repeat(43) });
    expect(r.corps).toEqual({ qui: "Léa D.", entreprise: "NETTOYAGE PRO", metier: "Agent de propreté", annee_debut: 2021, annee_fin: null });
  });
});

// La relance, une seule, 7 jours après l'envoi (09/11/2026).
describe("la relance d'une référence sans réponse", async () => {
  const { aRelancer, relancerReferences, RELANCE_APRES_JOURS, empreinte: emp } = await import("../../../api/_references.js");
  const J = 86400000, maintenant = Date.parse("2026-11-20T07:00:00Z");
  const ref = (x = {}) => ({ id: "r1", prestataire_id: "p1", entreprise: "NETTOYAGE PRO", metier: "Agent de propreté", annee_debut: 2021, annee_fin: null,
    contact_email: "c@ent.fr", jeton_hash: "ancien", statut: "en_attente",
    created_at: new Date(maintenant - 8 * J).toISOString(), envoyee_at: new Date(maintenant - 8 * J + 5000).toISOString(), ...x });

  it(`relancée après ${RELANCE_APRES_JOURS} jours, une seule fois, jamais après réponse ni expiration`, () => {
    expect(aRelancer(ref(), maintenant)).toBe(true);
    expect(aRelancer(ref({ envoyee_at: new Date(maintenant - 3 * J).toISOString(), created_at: new Date(maintenant - 3 * J).toISOString() }), maintenant)).toBe(false);
    expect(aRelancer(ref({ envoyee_at: new Date(maintenant - 1 * J).toISOString() }), maintenant), "déjà relancée").toBe(false);
    expect(aRelancer(ref({ statut: "confirmee" }), maintenant)).toBe(false);
    expect(aRelancer(ref({ envoyee_at: null }), maintenant), "jamais partie").toBe(false);
    expect(aRelancer(ref({ created_at: new Date(maintenant - 31 * J).toISOString(), envoyee_at: new Date(maintenant - 31 * J).toISOString() }), maintenant)).toBe(false);
  });

  const simuler = (envoi = true) => {
    const appels = [];
    sendEmail.mockReset(); sendEmail.mockImplementation(async () => envoi);
    vi.stubGlobal("fetch", vi.fn(async (url, o = {}) => {
      const u = String(url), m = o.method || "GET";
      appels.push({ u, m, corps: o.body ? JSON.parse(o.body) : null });
      const ok = (x) => new Response(JSON.stringify(x), { status: 200 });
      if (u.includes("references_experience?statut=eq.en_attente")) return ok([ref()]);
      if (u.includes("/profiles?id=eq.p1&select=prenom,nom")) return ok([{ prenom: "Léa", nom: "Durand" }]);
      if (m === "PATCH" && u.includes("created_at=lt.")) return ok([{ id: "vieille" }]);
      if (m === "PATCH") return ok([{ id: "r1" }]);
      return ok([]);
    }));
    return appels;
  };
  beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); vi.spyOn(console, "log").mockImplementation(() => {}); });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("un nouveau lien remplace l'ancien, conditionné à l'ancienne empreinte, et le message dit « Rappel »", async () => {
    const appels = simuler(true);
    expect(await relancerReferences({ supabaseUrl: "https://b.test", headers: {}, maintenantMs: maintenant })).toEqual({ relancees: 1, expirees: 1 });
    const p = appels.find(a => a.m === "PATCH" && a.u.includes("id=eq.r1"));
    expect(p.u).toContain("jeton_hash=eq.ancien");
    expect(p.corps.envoyee_at).toBe(new Date(maintenant).toISOString());
    const envoi = sendEmail.mock.calls.at(-1)[0];
    expect(envoi.subject).toMatch(/^Rappel/);
    expect(envoi.subject).toContain("Léa D.");
    // La date limite du rappel est celle de la première demande, pas 30 jours de plus.
    // Le dernier jour entier où le lien vaut (création + 29 jours), 10/11/2026.
    expect(envoi.html).toContain(`jusqu'au ${new Date(maintenant + 21 * J).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })}`);
    expect(emp(envoi.html.match(/reference\?t=([A-Za-z0-9_-]+)/)[1])).toBe(p.corps.jeton_hash);
  });
  it("e-mail non parti : l'ancien lien est rétabli, la référence peut toujours répondre", async () => {
    const appels = simuler(false);
    expect((await relancerReferences({ supabaseUrl: "https://b.test", headers: {}, maintenantMs: maintenant })).relancees).toBe(0);
    const retour = appels.filter(a => a.m === "PATCH" && a.u.includes("id=eq.r1"))[1];
    expect(retour.corps).toEqual({ jeton_hash: "ancien", envoyee_at: ref().envoyee_at });
  });
  it("les demandes au lien expiré passent « sans réponse » au balayage", async () => {
    const appels = simuler(true);
    await relancerReferences({ supabaseUrl: "https://b.test", headers: {}, maintenantMs: maintenant });
    const balayage = appels.find(a => a.m === "PATCH" && a.u.includes("created_at=lt."));
    expect(balayage.u).toContain("statut=eq.en_attente");
    expect(balayage.u).toContain("select=id");
    expect(balayage.corps).toEqual({ statut: "expiree" });
  });
  it("branchée sur le balayage du matin, après le relevé de la garantie, même s'il échoue", () => {
    const cron = readFileSync(new URL("../../../api/cron-reset-monthly.js", import.meta.url), "utf8");
    expect(cron.match(/await relancerLesReferences\(\);/g)).toHaveLength(2);
  });
});
