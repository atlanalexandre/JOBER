// Mentions obligatoires de la facture et numérotation par prestataire
// (relecture du 16/11/2026) :
//   - le nom ET l'adresse des deux parties (art. 242 nonies A, annexe II au CGI) ;
//   - une série par prestataire, émetteur de ses factures : continue, sans trou ;
//   - pour un client professionnel, les conditions de règlement, les pénalités et
//     l'indemnité de 40 € (art. L.441-9 et L.441-10 du Code de commerce).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import { adressePostale, prefixeSerie, numeroSuivant } from "../../../api/invoice.js";

describe("outils", () => {
  it("adresse postale : rue, code postal et ville ; vide si rien", () => {
    expect(adressePostale({ adresse: " 12 rue Haute ", code_postal: "75003", ville: "Paris" })).toBe("12 rue Haute, 75003 Paris");
    expect(adressePostale({ ville: "Lyon" })).toBe("Lyon");
    expect(adressePostale({})).toBe("");
  });
  it("série : un préfixe stable par prestataire ; le suivant du plus grand, sinon le premier", () => {
    const p = prefixeSerie("3f2a9c1b-0000-4000-8000-000000000000");
    expect(p).toBe("FAC-3F2A9C1B-");
    expect(numeroSuivant(p, [])).toBe("FAC-3F2A9C1B-000001");
    expect(numeroSuivant(p, ["FAC-3F2A9C1B-000002", "FAC-3F2A9C1B-000007", "FAC-2026-000099"])).toBe("FAC-3F2A9C1B-000008");
    expect(prefixeSerie(null)).toBe(null);
  });
});

const M = "11111111-1111-4111-8111-111111111111";
const CLIENT = "33333333-3333-4333-8333-333333333333";
const PRESTA = "44444444-4444-4444-8444-444444444444";
const json = (v, status = 200) => Promise.resolve(new Response(JSON.stringify(v), { status }));
process.env.VITE_SUPABASE_URL = "https://b.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "cle";
process.env.BO_SESSION_SECRET = "secret";
const jeton = (u) => {
  const exp = Math.floor(Date.now() / 1000) + 600;
  const sig = crypto.createHmac("sha256", "secret").update(`${u}.${M}.${exp}`).digest("hex");
  return `${u}.${M}.${exp}.${sig}`;
};
const MISSION = { id: M, client_id: CLIENT, prestataire_id: PRESTA, status: "completed", metier: "Femme/Valet de chambre", sector: "hotellerie",
  date: "2026-11-10", heure_debut: "09:00", hours: 4, tarif_horaire: 13, montant_total: 60.6, invoice_number: null, adresse: "1 av. X", ville: "Paris" };

function simuler({ client = {}, dejaEmis = [], collision = 0 } = {}) {
  const ecrits = [];
  let refus = collision;
  vi.stubGlobal("fetch", vi.fn((url, o = {}) => {
    const u = decodeURIComponent(String(url)), m = o.method || "GET";
    if (u.includes(`/missions?id=eq.${M}&select=*`)) return json([MISSION]);
    if (u.includes(`/profiles?id=eq.${CLIENT}`)) return json([{ prenom: "Cléa", nom: "Client", adresse: "5 rue du Client", code_postal: "69001", ville: "Lyon", ...client }]);
    if (u.includes(`/profiles?id=eq.${PRESTA}`)) return json([{ prenom: "Léa", nom: "Presta", siret: "73282932000074", mandat_facturation_at: "2026-10-01", adresse: "8 rue Presta", code_postal: "75011", ville: "Paris" }]);
    if (u.includes("/auth/v1/admin/users/")) return json({ email: "x@y.fr", user_metadata: { statut_pro: "auto-entrepreneur" } });
    if (u.includes("/missions?invoice_number=like.")) return json(dejaEmis.map(n => ({ invoice_number: n })));
    if (u.includes("/factures_archives?numero=like.")) return json([]);
    if (u.includes(`/missions?id=eq.${M}&invoice_number=is.null`) && m === "PATCH") {
      if (refus > 0) { refus--; return json({ code: "23505" }, 409); }
      const corps = JSON.parse(String(o.body)); ecrits.push(corps.invoice_number); return json([{ id: M, ...corps }]);
    }
    if (u.includes("platform_settings")) { ecrits.push("COMPTEUR_GLOBAL"); return json([]); }
    return json([]);
  }));
  return ecrits;
}
const facture = async (qui = CLIENT) => {
  const { default: handler } = await import("../../../api/invoice.js");
  const r = { statut: 0, html: "" };
  r.status = (s) => { r.statut = s; return r; }; r.send = (h) => { r.html = String(h); return r; }; r.setHeader = () => r; r.json = () => r; r.end = () => r;
  await handler({ method: "GET", headers: {}, query: { mission_id: M, token: jeton(qui) } }, r);
  return r;
};

describe("la facture émise", () => {
  beforeEach(() => { for (const f of ["error", "log", "warn"]) vi.spyOn(console, f).mockImplementation(() => {}); });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("porte l'adresse du prestataire et celle du client", async () => {
    simuler();
    const r = await facture();
    expect(r.statut, r.html.slice(0, 300)).toBe(200);
    expect(r.html).toContain("8 rue Presta, 75011 Paris");
    expect(r.html).toContain("5 rue du Client, 69001 Lyon");
  });
  it("numérotée dans la série du prestataire, à la suite — sans toucher au compteur global", async () => {
    const ecrits = simuler({ dejaEmis: ["FAC-44444444-000004"] });
    const r = await facture();
    expect(ecrits).toEqual(["FAC-44444444-000005"]);
    expect(r.html).toContain("FAC-44444444-000005");
  });
  it("numéro pris par une autre facture au même instant : on relit la série et on retente", async () => {
    const ecrits = simuler({ collision: 1 });
    expect((await facture()).statut).toBe(200);
    expect(ecrits).toEqual(["FAC-44444444-000001"]);
  });
  it("client professionnel : conditions de règlement, pénalités et indemnité de 40 € ; particulier : non", async () => {
    simuler({ client: { societe_nom: "Hôtel du Parc", siret: "55210055400013" } });
    let r = await facture();
    expect(r.html).toContain("indemnité forfaitaire pour frais de recouvrement de 40 €");
    expect(r.html).toContain("aucun escompte pour paiement anticipé");
    simuler();
    r = await facture();
    expect(r.html).not.toContain("indemnité forfaitaire");
  });
});
