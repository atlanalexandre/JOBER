// Réponse du prestataire par le bouton de l'e-mail (handleEmailAction, api/missions.js).
//
// Audit du domaine « prestations », 01/10/2026. Ce chemin ne suivait pas les règles
// de l'application :
//  • le remboursement partait AVANT une écriture inconditionnelle — un refus cliqué
//    pendant que la demande était acceptée dans l'application remboursait le client
//    et annulait une prestation acceptée ;
//  • une prestation affectée par la plateforme était annulée et remboursée au lieu
//    de passer au candidat suivant (CGPS art. 5.2).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHmac } from "crypto";

const SECRET = "secret-de-test";
const MISSION = "11111111-1111-1111-1111-111111111111";
const PRESTA  = "22222222-2222-2222-2222-222222222222";
const CLIENT  = "33333333-3333-3333-3333-333333333333";

function lien(action) {
  const exp = String(Math.floor(Date.now() / 1000) + 3600);
  const sig = createHmac("sha256", SECRET).update(`${action}.${MISSION}.${PRESTA}.${exp}`).digest("base64url");
  return { action, m: MISSION, p: PRESTA, exp, sig };
}

function reponse() {
  const r = { code: 0, corps: "", setHeader() {}, status(c) { r.code = c; return r; }, send(b) { r.corps = b; return r; }, json(b) { r.corps = b; return r; }, end() { return r; } };
  return r;
}

let appels;
function simulerBase({ mission, ecritureRend }) {
  appels = [];
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    const methode = opts.method || "GET";
    appels.push({ url: String(url), methode, corps: opts.body });
    const ok = (data) => ({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) });
    if (String(url).includes("/rest/v1/missions") && methode === "GET" && String(url).includes("status=eq.pending_acceptance")) return ok([mission]);
    if (String(url).includes("/rest/v1/missions") && methode === "PATCH" && String(url).includes("status=eq.pending_acceptance")) return ok(ecritureRend);
    if (String(url).includes("/rest/v1/missions") && methode === "PATCH") return ok([{ id: MISSION }]);
    // Quota du plan (acceptation) : il reste des places.
    if (String(url).includes("/rpc/check_prestataire_slot")) return ok(5);
    return ok([]);
  });
}

const stripe = () => appels.filter(a => a.url.includes("api.stripe.com"));

describe("réponse par le lien de l'e-mail", () => {
  let fetchOrigine;
  beforeEach(() => {
    fetchOrigine = globalThis.fetch;
    process.env.BO_SESSION_SECRET = SECRET;
    process.env.VITE_SUPABASE_URL = "https://base.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "cle";
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
  });
  afterEach(() => { globalThis.fetch = fetchOrigine; });

  const base = { id: MISSION, client_id: CLIENT, prestataire_id: PRESTA, metier: "Serveur", date: "2030-01-01", heure_debut: "10:00", hours: 4, stripe_payment_intent: "pi_x", montant_total: 100, acceptance_deadline: null };

  it("un refus arrivé après une acceptation ne rembourse rien", async () => {
    const { default: handler } = await import("../../../api/missions.js");
    simulerBase({ mission: { ...base, tiers_declaration: null }, ecritureRend: [] });
    const res = reponse();
    await handler({ method: "GET", query: lien("refuse"), headers: {} }, res);
    expect(res.code).toBe(409);
    expect(stripe()).toHaveLength(0);
    const ecriture = appels.find(a => a.methode === "PATCH" && a.url.includes("/rest/v1/missions"));
    expect(ecriture.url).toContain("status=eq.pending_acceptance");
    expect(ecriture.url).toContain(`prestataire_id=eq.${PRESTA}`);
  });

  it("une prestation affectée par la plateforme passe au suivant, sans remboursement", async () => {
    const { default: handler } = await import("../../../api/missions.js");
    simulerBase({ mission: { ...base, tiers_declaration: { lieu: "client" } }, ecritureRend: [{ id: MISSION }] });
    const res = reponse();
    await handler({ method: "GET", query: lien("refuse"), headers: {} }, res);
    expect(res.code).toBe(200);
    expect(stripe()).toHaveLength(0);
    const relance = appels.filter(a => a.methode === "PATCH" && a.url.includes(`/rest/v1/missions?id=eq.${MISSION}`) && !a.url.includes("status=eq."));
    expect(relance.some(a => /"status":"(open|pending_acceptance)"/.test(a.corps))).toBe(true);
  });

  it("une demande directe refusée est bien remboursée, après l'écriture", async () => {
    const { default: handler } = await import("../../../api/missions.js");
    simulerBase({ mission: { ...base, tiers_declaration: null }, ecritureRend: [{ id: MISSION }] });
    const res = reponse();
    await handler({ method: "GET", query: lien("refuse"), headers: {} }, res);
    expect(res.code).toBe(200);
    const iEcriture = appels.findIndex(a => a.methode === "PATCH" && a.url.includes("status=eq.pending_acceptance"));
    const iStripe = appels.findIndex(a => a.url.includes("api.stripe.com"));
    expect(iStripe).toBeGreaterThan(iEcriture);
  });

  it("accepter depuis l'e-mail date la signature du contrat, à l'heure du serveur", async () => {
    const { default: handler } = await import("../../../api/missions.js");
    simulerBase({ mission: { ...base, tiers_declaration: null }, ecritureRend: [{ id: MISSION }] });
    const res = reponse();
    const avant = Date.now();
    await handler({ method: "GET", query: lien("accept"), headers: {} }, res);
    expect(res.code).toBe(200);
    const ecriture = appels.find(a => a.methode === "PATCH" && a.url.includes("status=eq.pending_acceptance"));
    const corps = JSON.parse(ecriture.corps);
    expect(corps.status).toBe("assigned");
    expect(new Date(corps.contrat_presta_signe_at).getTime()).toBeGreaterThanOrEqual(avant);
  });
});
