// Garantie « mois sans proposition » (décision d'Alexandre du 04/11/2026) :
// un abonné à qui rien n'a été proposé de tout un mois reçoit le suivant
// offert — une seule fois, et seulement s'il était réellement disponible.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { droitGarantie, moisEcoule, estDebutDeMois, appliquerGarantie, PREMIER_MOIS, ZONE_MIN_KM } from "../../../api/_garantie.js";

const DEBUT_DEC = Date.parse("2026-11-30T23:00:00Z"); // 1er décembre, minuit à Paris
const profil = (x = {}) => ({ id: "p1", status: "approved", missions_enabled: true, missions_enabled_at: "2026-11-10T10:00:00Z",
  plan_abonnement: "premium", stripe_subscription_id: "sub_p", stripe_customer_id: "cus_p", garantie_mois_offert_at: null, ...x });
const meta = { dispon_jours: ["Lundi", "Mardi"], zone_km: 20 };
const abo = { statut: "active", debutMs: Date.parse("2026-11-15T00:00:00Z") };
const droit = (x = {}) => droitGarantie({ profil: profil(), meta, abonnement: abo, propositions: 0, mois: "2026-12", ...x });

describe("le droit au mois offert", () => {
  it("abonné disponible tout le mois, rien proposé : oui", () => {
    expect(droit()).toEqual({ ok: true });
  });
  it("une prestation proposée — même refusée — suffit à ne rien offrir", () => {
    expect(droit({ propositions: 1 })).toMatchObject({ ok: false });
  });
  it("une seule fois par prestataire", () => {
    expect(droit({ profil: profil({ garantie_mois_offert_at: "2027-01-01T00:00:00Z" }) }).raison).toBe("mois déjà offert une fois");
  });
  it("il faut avoir été réellement disponible", () => {
    expect(droit({ meta: { ...meta, dispon_jours: [] } }).raison).toBe("aucun jour de disponibilité");
    expect(droit({ meta: { ...meta, zone_km: ZONE_MIN_KM - 1 } }).ok).toBe(false);
    expect(droit({ profil: profil({ missions_enabled: false }) }).raison).toBe("accès aux prestations fermé");
    expect(droit({ profil: profil({ status: "suspended" }) }).ok).toBe(false);
    expect(droit({ profil: profil({ missions_enabled_at: "2026-12-05T00:00:00Z" }) }).raison).toBe("accès ouvert après le début du mois");
  });
  it("abonné payant pendant TOUT le mois", () => {
    expect(droit({ abonnement: { statut: "active", debutMs: Date.parse("2026-12-10T00:00:00Z") } }).raison).toBe("abonné après le début du mois");
    expect(droit({ abonnement: { statut: "canceled", debutMs: abo.debutMs } }).ok).toBe(false);
    expect(droit({ profil: profil({ plan_abonnement: "free" }) }).ok).toBe(false);
  });
  it(`pas avant ${PREMIER_MOIS} : le registre des propositions n'existait pas`, () => {
    expect(droit({ mois: "2026-11" }).raison).toBe("mois antérieur au registre des propositions");
  });
  it("le mois écoulé et les trois premiers jours se lisent à l'heure de Paris", () => {
    expect(moisEcoule(DEBUT_DEC + 3600e3)).toBe("2026-11");
    expect(moisEcoule(Date.parse("2027-01-01T00:30:00Z"))).toBe("2026-12");
    expect(estDebutDeMois(DEBUT_DEC + 3600e3)).toBe(true);
    expect(estDebutDeMois(Date.parse("2026-12-04T12:00:00Z"))).toBe(false);
  });
});

function simuler({ propositions = 0, reservation = [{ id: "p1" }], abonnementKo = false } = {}) {
  const appels = [];
  vi.stubGlobal("fetch", vi.fn(async (url, o = {}) => {
    const u = String(url), m = o.method || "GET";
    appels.push({ u, m, corps: o.body, cle: o.headers?.["Idempotency-Key"] });
    const ok = (x) => new Response(JSON.stringify(x), { status: 200 });
    if (u.includes("profiles?role=eq.prestataire&plan_abonnement=in.")) return ok([profil()]);
    if (u.includes("/auth/v1/admin/users/p1")) return ok({ user_metadata: meta });
    if (u.includes("propositions_recues")) return new Response(null, { status: 200, headers: { "content-range": `*/${propositions}` } });
    if (u.includes("/v1/subscriptions/sub_p")) {
      if (abonnementKo) return new Response("{}", { status: 503 });
      return ok({ status: "active", start_date: Math.floor(abo.debutMs / 1000), items: { data: [{ price: { unit_amount: 2999, recurring: { interval: "month" } } }] } });
    }
    if (u.includes("garantie_mois_offert_at=is.null") && m === "PATCH") return ok(reservation);
    if (u.includes("/balance_transactions")) return ok({ id: "cbtxn_1" });
    if (u.includes("/notifications")) return new Response(null, { status: 201 });
    return ok([]);
  }));
  return appels;
}
const lancer = () => appliquerGarantie({ supabaseUrl: "https://b.test", headers: { apikey: "k", Authorization: "Bearer k" }, stripeKey: "sk_test", maintenantMs: Date.parse("2027-01-01T06:00:00Z") });

describe("le traitement du début de mois", () => {
  beforeEach(() => { vi.spyOn(console, "log").mockImplementation(() => {}); vi.spyOn(console, "error").mockImplementation(() => {}); });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("rien proposé en décembre : un avoir d'un mois, avec une clé propre au prestataire", async () => {
    const appels = simuler();
    expect(await lancer()).toEqual({ examines: 1, offerts: 1 });
    const avoir = appels.find(a => a.u.includes("/balance_transactions"));
    expect(avoir.cle).toBe("garantie-p1");
    expect(new URLSearchParams(avoir.corps).get("amount")).toBe("-2999");
    expect(JSON.parse(appels.find(a => a.m === "PATCH").corps).garantie_mois_offert_mois).toBe("2026-12");
  });
  it("une proposition reçue : rien", async () => {
    const appels = simuler({ propositions: 2 });
    expect(await lancer()).toEqual({ examines: 1, offerts: 0 });
    expect(appels.some(a => a.u.includes("/balance_transactions"))).toBe(false);
  });
  it("déjà offert par un autre passage : pas de second avoir", async () => {
    const appels = simuler({ reservation: [] });
    expect((await lancer()).offerts).toBe(0);
    expect(appels.some(a => a.u.includes("/balance_transactions"))).toBe(false);
  });
  it("Stripe illisible : rien n'est réservé, l'examen est repris au passage suivant", async () => {
    const appels = simuler({ abonnementKo: true });
    expect((await lancer()).offerts).toBe(0);
    expect(appels.some(a => a.m === "PATCH")).toBe(false);
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
  it("le traitement tourne avec les rappels, les trois premiers jours du mois", () => {
    expect(lire("cron-reset-monthly.js")).toMatch(/if \(queryAction === "reminders"\) try \{\s*if \(estDebutDeMois\(\)\) \{[\s\S]{0,200}appliquerGarantie\(/);
  });
  it("les CGPS le disent (art. 6B.3)", () => {
    expect(readFileSync(new URL("../../constants/cgps.js", import.meta.url), "utf8")).toContain("Garantie « mois sans proposition »");
  });
});
