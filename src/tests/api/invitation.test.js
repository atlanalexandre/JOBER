// « Invitez vos clients » (décision d'Alexandre du 02/11/2026, option A) : le
// client invité reçoit ses frais de service en cashback après sa première
// prestation d'au moins 50 €, et le prestataire qui l'a invité un mois offert.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import {
  prestationQualifiante, fraisAOffrir, partPrestation, premieresQualifiantes, decisionMoisOffert,
  recompenserInvitations, MONTANT_MIN, PLAFOND_MOIS_PAR_AN, LANCEMENT,
} from "../../../api/_invitation.js";

const MAINTENANT = Date.parse("2026-11-02T12:00:00Z");
const terminee = (x = {}) => ({
  id: "m1", client_id: "c1", status: "completed", payout_status: "pending", stripe_payment_intent: "pi_TEST12345",
  date: "2026-10-20", heure_debut: "09:00", hours: 5, tarif_horaire: 12, payout_amount: 60, montant_total: 66.1,
  created_at: "2026-10-18T10:00:00Z", ...x,
});

describe("la prestation qui ouvre la récompense", () => {
  it("terminée, payée, contestation close, au moins 50 € : oui", () => {
    expect(prestationQualifiante(terminee(), MAINTENANT)).toEqual({ ok: true });
  });
  it("moins de 50 € hors frais : non — le minimum d'Alexandre contre les faux comptes", () => {
    expect(MONTANT_MIN).toBe(50);
    expect(prestationQualifiante(terminee({ payout_amount: 49.99 }), MAINTENANT).ok).toBe(false);
    expect(prestationQualifiante(terminee({ payout_amount: 50 }), MAINTENANT).ok).toBe(true);
  });
  it("les 48 h de contestation encore ouvertes : pas encore", () => {
    expect(prestationQualifiante(terminee({ date: "2026-11-01", heure_debut: "18:00" }), MAINTENANT))
      .toEqual({ ok: false, raison: "contestation encore ouverte" });
  });
  it("litige, versement retenu ou annulé, prestation close ou non payée : non", () => {
    for (const x of [{ payout_status: "held" }, { payout_status: "annule" }, { status: "disputed" }, { status: "closed" },
      { status: "cancelled" }, { stripe_payment_intent: null }]) {
      expect(prestationQualifiante(terminee(x), MAINTENANT).ok, JSON.stringify(x)).toBe(false);
    }
  });
  it("les frais offerts sont ceux payés : prix − part du prestataire, jamais négatifs ni aberrants", () => {
    expect(fraisAOffrir(terminee())).toBe(6.1);
    expect(fraisAOffrir(terminee({ montant_total: 60 }))).toBe(0);
    expect(fraisAOffrir(terminee({ montant_total: 500 }))).toBe(0);
    expect(fraisAOffrir(terminee({ montant_total: null }))).toBe(0);
    expect(partPrestation({ tarif_horaire: 15, hours: 4, date_debut: "2026-10-01 00:00:00+00", date_fin: "2026-10-02 00:00:00+00" })).toBe(120);
  });
  it("relecture du 04/11/2026 : ni portefeuille, ni part du prestataire devinée", () => {
    expect(prestationQualifiante(terminee({ stripe_payment_intent: "wallet_abc123456" }), MAINTENANT))
      .toEqual({ ok: false, raison: "paiement hors carte" });
    expect(prestationQualifiante(terminee({ payout_amount: null }), MAINTENANT))
      .toEqual({ ok: false, raison: "part du prestataire inconnue" });
  });
  it("une seule par client : la plus ancienne qui remplit les conditions", () => {
    const m = premieresQualifiantes([
      terminee({ id: "tard", created_at: "2026-10-19T00:00:00Z" }),
      terminee({ id: "petite", payout_amount: 20, created_at: "2026-10-01T00:00:00Z" }),
      terminee({ id: "tot", created_at: "2026-10-10T00:00:00Z" }),
    ], MAINTENANT);
    expect(m.get("c1").id).toBe("tot");
  });
});

describe("le mois offert au prestataire", () => {
  const parrain = { id: "p1", role: "prestataire" };
  it("accordé dans le cas ordinaire", () => {
    expect(decisionMoisOffert({ parrain, dejaOffertsSurUnAn: 0, carteClient: "fpA", cartesPresta: ["fpB"] }).offrir).toBe(true);
  });
  it(`plafonné à ${PLAFOND_MOIS_PAR_AN} sur douze mois`, () => {
    expect(decisionMoisOffert({ parrain, dejaOffertsSurUnAn: PLAFOND_MOIS_PAR_AN, carteClient: null, cartesPresta: [] }))
      .toMatchObject({ offrir: false });
  });
  it("refusé si la carte du client est une carte du prestataire (faux client)", () => {
    expect(decisionMoisOffert({ parrain, dejaOffertsSurUnAn: 0, carteClient: "fpA", cartesPresta: ["fpA"] }))
      .toEqual({ offrir: false, raison: "carte du client = carte du prestataire" });
  });
  it("jamais pour un parrain client : le programme est celui des prestataires", () => {
    expect(decisionMoisOffert({ parrain: { id: "x", role: "client" }, dejaOffertsSurUnAn: 0 }).offrir).toBe(false);
  });
});

// Le traitement complet, base et Stripe simulés.
const lireCorps = (b) => { if (!b) return null; try { return JSON.parse(b); } catch { return Object.fromEntries(new URLSearchParams(b)); } };
function simuler({ dejaOfferts = 0, carteClient = "fpA", cartesPresta = ["fpB"], reservation = [{ id: "c1" }], parrain } = {}) {
  const appels = [];
  vi.stubGlobal("fetch", vi.fn(async (url, o = {}) => {
    const u = String(url);
    const m = o.method || "GET";
    appels.push({ u, m, corps: lireCorps(o.body), cle: o.headers?.["Idempotency-Key"] });
    const ok = (x) => new Response(JSON.stringify(x), { status: 200 });
    if (u.includes("profiles?role=eq.client&referred_by=not.is.null")) return ok([{ id: "c1", referred_by: "p1" }]);
    if (u.includes("/rest/v1/missions?client_id=in.(c1)")) return ok([terminee()]);
    if (u.includes("profiles?id=in.(p1)")) return ok([parrain || { id: "p1", role: "prestataire", plan_abonnement: "free", stripe_customer_id: "cus_p" }]);
    if (m === "HEAD") return new Response(null, { status: 200, headers: { "content-range": `0-0/${dejaOfferts}` } });
    if (u.includes("/v1/payment_intents/pi_TEST12345")) return ok({ latest_charge: { payment_method_details: { card: { fingerprint: carteClient } } } });
    if (u.includes("/v1/customers/cus_p/payment_methods")) return ok({ data: cartesPresta.map(f => ({ card: { fingerprint: f } })) });
    if (u.includes("profiles?id=eq.c1&invitation_recompensee_at=is.null")) return ok(reservation);
    if (u.includes("/rpc/increment_cashback")) return ok([{ cashback_balance: 6.1 }]);
    if (u.includes("/v1/subscriptions/sub_p")) return ok({ items: { data: [{ price: { unit_amount: 2999, recurring: { interval: "month" } } }] } });
    if (u.includes("/balance_transactions")) return ok({ id: "cbtxn_1" });
    if (u.includes("profiles?id=eq.p1") && m === "PATCH") return ok([{ id: "p1" }]);
    if (u.includes("/notifications")) return new Response(null, { status: 201 });
    return ok([]);
  }));
  return appels;
}
const lancer = () => recompenserInvitations({ supabaseUrl: "https://b.test", headers: { apikey: "k", Authorization: "Bearer k" }, stripeKey: "sk_test", maintenantMs: MAINTENANT });

describe("le traitement automatique", () => {
  beforeEach(() => { vi.spyOn(console, "log").mockImplementation(() => {}); vi.spyOn(console, "error").mockImplementation(() => {}); });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("crédite le client de ses frais et offre un mois Premium au prestataire gratuit", async () => {
    const appels = simuler();
    expect(await lancer()).toEqual({ clients: 1, mois: 1, ignores: 0 });
    const res = appels.find(a => a.u.includes("invitation_recompensee_at=is.null") && a.m === "PATCH");
    expect(res.corps).toMatchObject({ invitation_mission_id: "m1", invitation_frais_offerts: 6.1, invitation_mois_offert: true });
    expect(appels.find(a => a.u.includes("increment_cashback")).corps).toEqual({ p_user_id: "c1", p_delta: 6.1, p_missions: 0 });
    expect(appels.find(a => a.u.includes("profiles?id=eq.p1") && a.m === "PATCH").corps.plan_abonnement).toBe("premium");
  });

  it("un prestataire abonné reçoit un avoir chez Stripe, avec une clé propre au client invité", async () => {
    const appels = simuler({ parrain: { id: "p1", role: "prestataire", plan_abonnement: "premium", stripe_customer_id: "cus_p", stripe_subscription_id: "sub_p" } });
    expect(await lancer()).toEqual({ clients: 1, mois: 1, ignores: 0 });
    const avoir = appels.find(a => a.u.includes("/balance_transactions"));
    expect(avoir.cle).toBe("invitation-c1");
    expect(avoir.corps.amount).toBe("-2999");
    expect(appels.some(a => a.u.includes("profiles?id=eq.p1") && a.m === "PATCH")).toBe(false);
  });

  it("déjà récompensé par un autre passage : rien n'est versé deux fois", async () => {
    const appels = simuler({ reservation: [] });
    expect(await lancer()).toEqual({ clients: 0, mois: 0, ignores: 0 });
    expect(appels.some(a => a.u.includes("increment_cashback"))).toBe(false);
  });

  it("carte du prestataire : le client garde son cashback, le prestataire n'a pas de mois", async () => {
    const appels = simuler({ cartesPresta: ["fpA"] });
    expect(await lancer()).toEqual({ clients: 1, mois: 0, ignores: 1 });
    expect(appels.find(a => a.u.includes("invitation_recompensee_at=is.null") && a.m === "PATCH").corps.invitation_mois_offert).toBe(false);
  });

  it("client parrainé par un autre client : ni cashback ni mois, mais marqué pour ne plus être relu", async () => {
    const appels = simuler({ parrain: { id: "p1", role: "client" } });
    expect(await lancer()).toEqual({ clients: 0, mois: 0, ignores: 1 });
    expect(appels.some(a => a.u.includes("increment_cashback"))).toBe(false);
    expect(appels.find(a => a.u.includes("invitation_recompensee_at=is.null") && a.m === "PATCH").corps.invitation_frais_offerts).toBe(0);
  });

  it("plafond atteint : pas de mois offert", async () => {
    simuler({ dejaOfferts: 6 });
    expect(await lancer()).toMatchObject({ mois: 0, ignores: 1 });
  });

  it("seuls les clients inscrits depuis le lancement sont lus (04/11/2026)", async () => {
    const appels = simuler();
    await lancer();
    expect(appels.find(a => a.u.includes("profiles?role=eq.client")).u).toContain(`created_at=gte.${encodeURIComponent(LANCEMENT)}`);
  });

  it("prix de l'abonnement illisible : rien n'est réservé, le mois n'est pas perdu (04/11/2026)", async () => {
    const appels = simuler({ parrain: { id: "p1", role: "prestataire", plan_abonnement: "premium", stripe_customer_id: "cus_p", stripe_subscription_id: "sub_p" } });
    const f = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (url, o) => String(url).includes("/v1/subscriptions/") ? new Response("{}", { status: 503 }) : f(url, o)));
    expect(await lancer()).toEqual({ clients: 0, mois: 0, ignores: 0 });
    expect(appels.some(a => a.u.includes("invitation_recompensee_at=is.null") && a.m === "PATCH")).toBe(false);
  });

  it("abonnement disparu chez Stripe : le client est crédité, le mois offert en Premium — plus de report sans fin (05/11/2026)", async () => {
    const appels = simuler({ parrain: { id: "p1", role: "prestataire", plan_abonnement: "premium", stripe_customer_id: "cus_p", stripe_subscription_id: "sub_p" } });
    const f = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (url, o) => String(url).includes("/v1/subscriptions/") ? new Response("{}", { status: 404 }) : f(url, o)));
    expect(await lancer()).toEqual({ clients: 1, mois: 1, ignores: 0 });
    expect(appels.some(a => a.u.includes("/balance_transactions"))).toBe(false);
    expect(appels.find(a => a.u.includes("profiles?id=eq.p1") && a.m === "PATCH").corps.plan_abonnement).toBe("premium");
  });

  it("Stripe illisible : rien n'est réservé, tout est reporté au passage suivant", async () => {
    const appels = simuler();
    const f = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (url, o) => String(url).includes("/v1/payment_intents/") ? new Response("{}", { status: 500 }) : f(url, o)));
    expect(await lancer()).toEqual({ clients: 0, mois: 0, ignores: 0 });
    expect(appels.some(a => a.u.includes("invitation_recompensee_at=is.null") && a.m === "PATCH")).toBe(false);
  });

  it("colonne absente (migration non passée) : rien n'est versé, et c'est journalisé", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ code: "42703" }), { status: 400 })));
    expect(await lancer()).toEqual({ clients: 0, mois: 0, ignores: 0 });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("2026-11-02_invitation_clients.sql"), expect.any(String));
  });
});

describe("branchements", () => {
  const cron = readFileSync(new URL("../../../api/cron-reset-monthly.js", import.meta.url), "utf8");
  const support = readFileSync(new URL("../../../api/support.js", import.meta.url), "utf8");
  const app = readFileSync(new URL("../../App.jsx", import.meta.url), "utf8");
  it("en mode rappels seulement : ni à la surveillance des documents, ni au passage mensuel (04/11/2026)", () => {
    expect(cron).toMatch(/if \(queryAction === "reminders"\) try \{\s*const STRIPE_SK_I[\s\S]{0,200}recompenserInvitations\(/);
  });
  it("le traitement tourne toutes les deux heures, avant le retour anticipé du mode rappels", () => {
    expect(cron.indexOf("recompenserInvitations({")).toBeGreaterThan(0);
    expect(cron.indexOf("recompenserInvitations({")).toBeLessThan(cron.indexOf('if (req.query?.action === "reminders")'));
  });
  it("un compte ancien ne peut plus se rattacher après coup à un parrain", () => {
    expect(support).toMatch(/Date\.now\(\) - creeLe > 24 \* 3600000/);
  });
  it("l'écran est réservé aux prestataires", () => {
    expect(app).toMatch(/PRESTA_SCREENS=\[[^\]]*"invite_clients"/);
  });
});
