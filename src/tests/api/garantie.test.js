// Garantie « mois sans proposition » (décision d'Alexandre du 04/11/2026) :
// un abonné à qui rien n'a été proposé de tout un mois reçoit le suivant
// offert — une seule fois, et seulement s'il a été disponible TOUT le mois
// (relevé quotidien, 05/11/2026).
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import {
  droitGarantie, etatDuJour, moisEcoule, estDebutDeMois, jourParis, joursDuMois,
  appliquerGarantie, noterReleves, PREMIER_MOIS, ZONE_MIN_KM, RELEVES_MANQUANTS_ADMIS, INTERVALLE_RAPPELS_H,
} from "../../../api/_garantie.js";

const profil = (x = {}) => ({ id: "p1", status: "approved", missions_enabled: true, plan_abonnement: "premium",
  stripe_subscription_id: "sub_p", stripe_customer_id: "cus_p", garantie_mois_offert_at: null, ...x });
const meta = { dispon_jours: ["Lundi", "Mardi"], zone_km: 20 };
const abo = { statut: "active", debutMs: Date.parse("2026-11-15T00:00:00Z") };
const plein = { total: 31, indisponibles: 0 };
const droit = (x = {}) => droitGarantie({ profil: profil(), abonnement: abo, propositions: 0, releves: plein, mois: "2026-12", ...x });

describe("le relevé du matin", () => {
  it("disponible : abonnement actif, accès ouvert, des jours, un rayon suffisant", () => {
    expect(etatDuJour({ profil: profil(), meta, statutAbonnement: "active" })).toEqual({ disponible: true, raison: null });
  });
  it("un paiement en échec (past_due) n'est pas un abonné à jour (05/11/2026)", () => {
    expect(etatDuJour({ profil: profil(), meta, statutAbonnement: "past_due" }).disponible).toBe(false);
  });
  it("rayon jamais renseigné : le rayon par défaut de l'application s'applique (06/11/2026)", () => {
    expect(etatDuJour({ profil: profil(), meta: { dispon_jours: ["Lundi"] }, statutAbonnement: "active" }).disponible).toBe(true);
  });
  it("accès fermé, aucune disponibilité, rayon trop petit : indisponible", () => {
    expect(etatDuJour({ profil: profil({ missions_enabled: false }), meta, statutAbonnement: "active" }).raison).toBe("accès aux prestations fermé");
    expect(etatDuJour({ profil: profil(), meta: { ...meta, dispon_jours: [] }, statutAbonnement: "active" }).disponible).toBe(false);
    expect(etatDuJour({ profil: profil(), meta: { ...meta, zone_km: ZONE_MIN_KM - 1 }, statutAbonnement: "active" }).disponible).toBe(false);
  });
});

describe("le droit au mois offert", () => {
  it("disponible tous les jours, rien proposé : oui", () => {
    expect(droit()).toEqual({ ok: true });
  });
  it("une prestation proposée — même refusée — suffit à ne rien offrir", () => {
    expect(droit({ propositions: 1 }).ok).toBe(false);
  });
  it("un seul jour indisponible dans le mois exclut la garantie — une suspension levée avant le 1er se voit (05/11/2026)", () => {
    expect(droit({ releves: { total: 31, indisponibles: 1 } }).raison).toBe("1 jour(s) sans être disponible");
  });
  it(`relevés manquants : ${RELEVES_MANQUANTS_ADMIS} tolérés, pas davantage`, () => {
    expect(droit({ releves: { total: 31 - RELEVES_MANQUANTS_ADMIS, indisponibles: 0 } }).ok).toBe(true);
    expect(droit({ releves: { total: 31 - RELEVES_MANQUANTS_ADMIS - 1, indisponibles: 0 } }).ok).toBe(false);
  });
  it("une seule fois ; abonné tout le mois ; abonnement actif", () => {
    expect(droit({ profil: profil({ garantie_mois_offert_at: "2027-01-01T00:00:00Z" }) }).raison).toBe("mois déjà offert une fois");
    expect(droit({ abonnement: { statut: "active", debutMs: Date.parse("2026-12-10T00:00:00Z") } }).raison).toBe("abonné après le début du mois");
    expect(droit({ abonnement: { statut: "past_due", debutMs: abo.debutMs } }).ok).toBe(false);
  });
  it(`pas avant ${PREMIER_MOIS}`, () => {
    expect(droit({ mois: "2026-11" }).ok).toBe(false);
  });
  it("les dates se lisent à l'heure de Paris", () => {
    expect(moisEcoule(Date.parse("2027-01-01T00:30:00Z"))).toBe("2026-12");
    expect(jourParis(Date.parse("2026-11-30T23:30:00Z"))).toBe("2026-12-01");
    expect(estDebutDeMois(Date.parse("2026-12-04T12:00:00Z"))).toBe(false);
    expect(joursDuMois("2027-02")).toBe(28);
  });
});

function simuler({ propositions = 0, releves = 31, indisponibles = 0, reservation = [{ id: "p1" }], abonnementKo = false, avoirKo = false,
  avoirsExistants = [], avoirsKo = false, coupure = false, pages = false, profilLu = profil(), lectures = [], abonnementLu = {}, metaUtil = meta } = {}) {
  const appels = [];
  vi.stubGlobal("fetch", vi.fn(async (url, o = {}) => {
    const u = String(url), m = o.method || "GET";
    appels.push({ u, m, corps: o.body, cle: o.headers?.["Idempotency-Key"], prefer: o.headers?.Prefer });
    const ok = (x) => new Response(JSON.stringify(x), { status: 200 });
    const compte = (n) => new Response(null, { status: 200, headers: { "content-range": `*/${n}` } });
    if (u.includes("profiles?role=eq.prestataire")) { lectures.push(u); return ok([profilLu]); }
    if (u.includes("/auth/v1/admin/users/p1")) return ok({ user_metadata: metaUtil });
    if (u.includes("propositions_recues")) return compte(propositions);
    if (u.includes("garantie_releves") && m === "HEAD") return compte(u.includes("disponible=is.false") ? indisponibles : releves);
    if (u.includes("garantie_releves") && m === "POST") return new Response(null, { status: 201 });
    if (u.includes("/v1/subscriptions/sub_p")) {
      if (abonnementKo) return new Response("{}", { status: 503 });
      return ok({ status: "active", start_date: Math.floor(abo.debutMs / 1000), items: { data: [{ price: { unit_amount: 2999, recurring: { interval: "month" } } }] }, ...abonnementLu });
    }
    if (u.includes("profiles?id=eq.p1") && m === "PATCH") return ok(u.includes("garantie_mois_offert_at=is.null") ? reservation : [{ id: "p1" }]);
    if (u.includes("/balance_transactions") && m === "GET") {
      if (avoirsKo) return new Response("{}", { status: 503 });
      // Deux pages quand on le demande : la première sans l'avoir.
      if (pages && !u.includes("starting_after")) return ok({ data: [{ id: "cbtxn_facture", metadata: {} }], has_more: true });
      return ok({ data: avoirsExistants, has_more: false });
    }
    if (u.includes("/balance_transactions")) {
      if (coupure) throw new Error("connexion coupée");
      return avoirKo ? new Response("{}", { status: 500 }) : ok({ id: "cbtxn_1" });
    }
    if (u.includes("/notifications")) return new Response(null, { status: 201 });
    return ok([]);
  }));
  return appels;
}
const ctx = { supabaseUrl: "https://b.test", headers: { apikey: "k", Authorization: "Bearer k" }, stripeKey: "sk_test" };
const lancer = () => appliquerGarantie({ ...ctx, maintenantMs: Date.parse("2027-01-01T06:00:00Z") });

describe("l'examen du début de mois", () => {
  beforeEach(() => { vi.spyOn(console, "log").mockImplementation(() => {}); vi.spyOn(console, "error").mockImplementation(() => {}); });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("rien proposé, disponible tout le mois : un avoir d'un mois, une seule lecture Stripe", async () => {
    const appels = simuler();
    expect(await lancer()).toEqual({ examines: 1, offerts: 1 });
    expect(appels.find(a => a.u.includes("/balance_transactions") && a.m === "POST").cle).toBe("garantie-p1-2026-12");
    expect(appels.filter(a => a.u.includes("/v1/subscriptions/")).length).toBe(1);
  });
  it("une proposition reçue : arrêt avant tout appel à Stripe", async () => {
    const appels = simuler({ propositions: 2 });
    expect((await lancer()).offerts).toBe(0);
    expect(appels.some(a => a.u.includes("stripe.com"))).toBe(false);
  });
  it("un jour indisponible dans le mois : rien", async () => {
    simuler({ indisponibles: 3 });
    expect((await lancer()).offerts).toBe(0);
  });
  it("avoir refusé par Stripe : la réservation est rendue, la garantie n'est pas consommée (05/11/2026)", async () => {
    const appels = simuler({ avoirKo: true });
    expect((await lancer()).offerts).toBe(0);
    const rendu = appels.filter(a => a.u.includes("profiles?id=eq.p1") && a.m === "PATCH").pop();
    expect(JSON.parse(rendu.corps)).toEqual({ garantie_mois_offert_at: null, garantie_mois_offert_mois: null });
  });
  it("Stripe illisible : rien n'est réservé, l'examen est repris au passage suivant", async () => {
    const appels = simuler({ abonnementKo: true });
    expect((await lancer()).offerts).toBe(0);
    expect(appels.some(a => a.m === "PATCH")).toBe(false);
  });
  it("avoir déjà créé par un essai précédent : pas de second avoir, le mois est compté offert (06/11/2026)", async () => {
    const appels = simuler({ avoirsExistants: [{ id: "cbtxn_0", metadata: { garantie_prestataire: "p1", garantie_mois: "2026-12" } }] });
    expect((await lancer()).offerts).toBe(1);
    expect(appels.some(a => a.u.includes("/balance_transactions") && a.m === "POST")).toBe(false);
  });
  it("avoir créé un mois PRÉCÉDENT sans que la réponse arrive : garantie consommée, aucun second avoir (07/11/2026)", async () => {
    const appels = simuler({ avoirsExistants: [{ id: "cbtxn_0", metadata: { garantie_prestataire: "p1", garantie_mois: "2026-11" } }] });
    expect((await lancer()).offerts).toBe(0);
    expect(appels.some(a => a.u.includes("/balance_transactions") && a.m === "POST")).toBe(false);
    const reserve = appels.find(a => a.u.includes("profiles?id=eq.p1") && a.m === "PATCH");
    expect(JSON.parse(reserve.corps).garantie_mois_offert_mois).toBe("2026-11");
    expect(appels.filter(a => a.u.includes("profiles?id=eq.p1") && a.m === "PATCH")).toHaveLength(1); // jamais rendue
  });
  it("l'avoir est cherché au-delà de la première page de mouvements (07/11/2026)", async () => {
    const appels = simuler({ pages: true, avoirsExistants: [{ id: "cbtxn_0", metadata: { garantie_prestataire: "p1", garantie_mois: "2026-12" } }] });
    expect((await lancer()).offerts).toBe(1);
    expect(appels.some(a => a.u.includes("starting_after=cbtxn_facture"))).toBe(true);
    expect(appels.some(a => a.u.includes("/balance_transactions") && a.m === "POST")).toBe(false);
  });
  it("coupure réseau pendant l'avoir : la réservation est rendue (06/11/2026)", async () => {
    const appels = simuler({ coupure: true });
    expect((await lancer()).offerts).toBe(0);
    const rendu = appels.filter(a => a.u.includes("profiles?id=eq.p1") && a.m === "PATCH").pop();
    expect(JSON.parse(rendu.corps)).toEqual({ garantie_mois_offert_at: null, garantie_mois_offert_mois: null });
  });
  it("avoirs illisibles : rien n'est réservé (06/11/2026)", async () => {
    const appels = simuler({ avoirsKo: true });
    expect((await lancer()).offerts).toBe(0);
    expect(appels.some(a => a.m === "PATCH")).toBe(false);
  });
  it("dernier passage du mois : la réservation est GARDÉE, aucun second avoir possible (08/11/2026)", async () => {
    const appels = simuler({ avoirKo: true });
    expect((await appliquerGarantie({ ...ctx, maintenantMs: Date.parse("2027-01-03T22:30:00Z") })).offerts).toBe(0);
    const patchs = appels.filter(a => a.u.includes("profiles?id=eq.p1") && a.m === "PATCH");
    expect(patchs).toHaveLength(1); // la réservation, jamais rendue
    expect(console.error.mock.calls.flat().join(" ")).toContain("la garantie reste RÉSERVÉE");
  });
  it("résilié en fin de période : pas de mois offert, il n'y aura pas de prochain prélèvement (08/11/2026)", async () => {
    const appels = simuler({ abonnementLu: { cancel_at_period_end: true } });
    expect((await lancer()).offerts).toBe(0);
    expect(appels.some(a => a.m === "PATCH")).toBe(false);
  });
  it("une remise de 50 % : l'avoir vaut ce qu'il paie, pas le prix affiché (08/11/2026)", async () => {
    const appels = simuler({ abonnementLu: { discount: { coupon: { percent_off: 50 } } } });
    expect((await lancer()).offerts).toBe(1);
    const avoir = appels.find(a => a.u.includes("/balance_transactions") && a.m === "POST");
    expect(new URLSearchParams(avoir.corps).get("amount")).toBe("-1500");
  });
  it("en impayé, la fiche repasse en « free » : le relevé la voit, et la note indisponible (08/11/2026)", async () => {
    const lectures = [];
    const appels = simuler({ profilLu: profil({ plan_abonnement: "free" }), lectures });
    expect(await noterReleves({ ...ctx, maintenantMs: Date.parse("2026-12-03T06:00:00Z") })).toEqual({ releves: 1 });
    expect(lectures[0]).not.toContain("plan_abonnement=in.");
    const ecrit = appels.find(a => a.u.includes("garantie_releves") && a.m === "POST");
    expect(JSON.parse(ecrit.corps)[0]).toMatchObject({ disponible: false, raison: "pas d'abonnement payant" });
  });
  it("le relevé du matin écrit une ligne par abonné, remplacée si le traitement repasse le même jour", async () => {
    const appels = simuler();
    expect(await noterReleves({ ...ctx, maintenantMs: Date.parse("2026-12-03T06:00:00Z") })).toEqual({ releves: 1 });
    const ecrit = appels.find(a => a.u.includes("garantie_releves") && a.m === "POST");
    expect(JSON.parse(ecrit.corps)).toEqual([{ prestataire_id: "p1", jour: "2026-12-03", disponible: true, raison: null }]);
    expect(ecrit.prefer).toContain("resolution=merge-duplicates");
  });
});

describe("branchements", () => {
  const lire = (f) => readFileSync(new URL(`../../../api/${f}`, import.meta.url), "utf8");
  it("chaque proposition est notée : choix direct (et cascade, série) et diffusion", () => {
    expect(lire("_nouvelle_demande.js")).toContain('canal: "directe"');
    expect(lire("missions.js")).toContain('canal: "diffusion"');
    // En une seule écriture, après la boucle (05/11/2026).
    expect(lire("missions.js")).toContain("noterPropositions({ supabaseUrl: SUPABASE_URL, headers, prestataireIds: proposes");
  });
  it("l'examen tourne avec les rappels les trois premiers jours ; le relevé chaque matin, même si les documents échouent", () => {
    const cron = lire("cron-reset-monthly.js");
    expect(cron).toMatch(/if \(queryAction === "reminders"\) try \{\s*if \(estDebutDeMois\(\)\) \{[\s\S]{0,200}appliquerGarantie\(/);
    expect(cron.match(/await releverGarantie\(\);/g)).toHaveLength(2);
  });
  it("l'intervalle des rappels est celui de vercel.json (07/11/2026)", () => {
    const cron = JSON.parse(readFileSync(new URL("../../../vercel.json", import.meta.url), "utf8")).crons
      .find(c => c.path.includes("action=reminders"));
    expect(cron.schedule).toBe(`0 */${INTERVALLE_RAPPELS_H} * * *`);
  });
  it("les abonnés sont lus en entier (lireTout)", () => {
    expect(lire("_garantie.js")).toMatch(/const lireAbonnes = [^\n]*lireTout\(/);
  });
  it("les CGPS le disent (art. 6B.3)", () => {
    expect(readFileSync(new URL("../../constants/cgps.js", import.meta.url), "utf8")).toContain("relevées chaque jour par ALANE");
  });
});

describe("le prix lu chez Stripe, remises déployées (09/11/2026)", () => {
  const lire = (f) => readFileSync(new URL(`../../../api/${f}`, import.meta.url), "utf8");
  it("chaque lecture de l'abonnement demande ses remises, et le parrainage passe par la règle commune", () => {
    expect(lire("_garantie.js")).toContain("subscriptions/${encodeURIComponent(subscriptionId)}?expand[]=discounts");
    expect(lire("_invitation.js")).toContain("?expand[]=discounts");
    const w = lire("stripe-webhook.js");
    expect(w).toContain("avoirCentimes = prixMensuelDepuisAbonnement(sd) * moisOfferts");
    expect(w).not.toMatch(/interval === "year" \? Number\(prix\.unit_amount\) \/ 12/);
  });
});
