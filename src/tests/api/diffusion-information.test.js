import { describe, it, expect, vi, afterEach } from "vitest";
import { destinatairesInformation, htmlInformation, enLots, envoyerInformation, MAX_DESTINATAIRES, TAILLE_LOT, PAUSE_ENTRE_LOTS_MS } from "../../../api/_diffusion.js";
import { readFileSync } from "node:fs";

// 13/10/2026 : aucun envoi groupé du back-office ne joignait tous les inscrits
// par e-mail. Celui-ci part à tous, validés ou non, sauf les comptes écartés.

const confirme = "2026-09-01T10:00:00Z";
const comptes = [
  { id: "c1", email: "Client@Exemple.fr", email_confirmed_at: confirme },
  { id: "p1", email: "presta.attente@exemple.fr", email_confirmed_at: confirme },
  { id: "p2", email: "presta.refuse@exemple.fr", email_confirmed_at: confirme },
  { id: "p3", email: "presta.suspendu@exemple.fr", email_confirmed_at: confirme },
  { id: "x1", email: "jamais.confirme@exemple.fr", email_confirmed_at: null },
  { id: "b1", email: "banni@exemple.fr", email_confirmed_at: confirme, banned_until: "2999-01-01T00:00:00Z" },
  { id: "s1", email: "sans.profil@exemple.fr", email_confirmed_at: confirme },
  { id: "d1", email: "client@exemple.fr", email_confirmed_at: confirme },
  { id: "v1", email: "", email_confirmed_at: confirme },
];
const profils = [
  { id: "c1", status: "approved" }, { id: "p1", status: "pending" },
  { id: "p2", status: "rejected" }, { id: "p3", status: "suspended" },
];

describe("destinatairesInformation()", () => {
  it("joint validés, en attente et inscriptions inachevées ; écarte refusés, suspendus, bannis, non confirmés, doublons", () => {
    const { adresses, ecartees } = destinatairesInformation(comptes, profils);
    expect(adresses).toEqual(["client@exemple.fr", "presta.attente@exemple.fr", "sans.profil@exemple.fr"]);
    expect(ecartees).toEqual({ non_confirmees: 1, refusees_ou_suspendues: 2, bannies: 1 });
  });

  it("inclut les adresses jamais confirmées sur demande", () => {
    const { adresses } = destinatairesInformation(comptes, profils, { inclureNonConfirmees: true });
    expect(adresses).toContain("jamais.confirme@exemple.fr");
  });

  it("un bannissement échu ne prive plus de l'e-mail", () => {
    const { adresses } = destinatairesInformation([{ id: "b", email: "b@x.fr", email_confirmed_at: confirme, banned_until: "2020-01-01T00:00:00Z" }], []);
    expect(adresses).toEqual(["b@x.fr"]);
  });
});

describe("htmlInformation()", () => {
  it("échappe le texte et découpe les paragraphes", () => {
    const html = htmlInformation("Bonjour <b>tous</b>\n\nLigne 1\nLigne 2");
    expect(html).toContain("<p>Bonjour &lt;b&gt;tous&lt;/b&gt;</p><p>Ligne 1<br/>Ligne 2</p>");
  });
});

describe("envoyerInformation()", () => {
  afterEach(() => { vi.unstubAllEnvs(); });
  const sansPause = { pause: async () => {} };

  it("sans clé Resend, n'envoie rien et le dit", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const fetchImpl = vi.fn();
    const r = await envoyerInformation(["a@x.fr"], { sujet: "S", html: "<p>m</p>" }, { fetchImpl, ...sansPause });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(r).toMatchObject({ envoyes: 0, echecs: 1 });
    expect(r.erreur).toMatch(/non configuré/);
  });

  it("un e-mail par adresse, par lots de 100, jamais une adresse en copie d'une autre", async () => {
    vi.stubEnv("RESEND_API_KEY", " cle ");
    const corps = [];
    const fetchImpl = vi.fn(async (url, opts) => { corps.push(JSON.parse(opts.body)); return { ok: true }; });
    const adresses = Array.from({ length: 250 }, (_, i) => `u${i}@x.fr`);
    const r = await envoyerInformation(adresses, { sujet: "S", html: "<p>m</p>" }, { fetchImpl, ...sansPause });
    expect(r).toEqual({ envoyes: 250, echecs: 0, erreur: null });
    expect(corps.map(c => c.length)).toEqual([100, 100, 50]);
    expect(corps.flat().every(e => e.to.length === 1)).toBe(true);
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe("Bearer cle");
  });

  it("un lot refusé est compté en échec, les suivants partent", async () => {
    vi.stubEnv("RESEND_API_KEY", "cle");
    let n = 0;
    const fetchImpl = vi.fn(async () => (++n === 1 ? { ok: false, status: 422, text: async () => "invalide" } : { ok: true }));
    const r = await envoyerInformation(Array.from({ length: 150 }, (_, i) => `u${i}@x.fr`), { sujet: "S", html: "h" }, { fetchImpl, ...sansPause });
    expect(r.envoyes).toBe(50);
    expect(r.echecs).toBe(100);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("une erreur serveur est réessayée une fois", async () => {
    vi.stubEnv("RESEND_API_KEY", "cle");
    let n = 0;
    const fetchImpl = vi.fn(async () => (++n === 1 ? { ok: false, status: 503, text: async () => "" } : { ok: true }));
    const r = await envoyerInformation(["a@x.fr"], { sujet: "S", html: "h" }, { fetchImpl, ...sansPause });
    expect(r.envoyes).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("enLots découpe sans perte", () => {
    expect(enLots([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});

describe("plafond de l'envoi", () => {
  it("tient dans la minute d'une fonction, appel à Resend compris (1 s par lot au pire)", () => {
    const lots = Math.ceil(MAX_DESTINATAIRES / TAILLE_LOT);
    const pire = lots * (PAUSE_ENTRE_LOTS_MS + 1000);
    expect(pire, "marge de 15 s pour la lecture des comptes").toBeLessThanOrEqual(45_000);
  });
  it("bo-action applique ce plafond, et la fonction a bien 60 s", () => {
    const bo = readFileSync(new URL("../../../api/bo-action.js", import.meta.url), "utf8");
    expect(bo).toMatch(/adresses\.length > MAX_DESTINATAIRES/);
    const vercel = JSON.parse(readFileSync(new URL("../../../vercel.json", import.meta.url), "utf8"));
    expect(vercel.functions["api/bo-action.js"].maxDuration).toBe(60);
  });
});
