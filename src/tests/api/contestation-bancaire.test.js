import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { Readable } from "node:stream";
import { readFileSync } from "node:fs";
import handler from "../../../api/stripe-webhook.js";

// Décision d'Alexandre du 30/09/2026 : une contestation bancaire retient le
// versement du prestataire (CGPS art. 7.4). Sans retenue, une contestation arrivée
// pendant les 48 h laissait partir le virement.

const SECRET = "whsec_test";
function requete(evenement) {
  const corps = JSON.stringify(evenement);
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", SECRET).update(`${t}.${corps}`).digest("hex");
  const req = Readable.from([Buffer.from(corps)]);
  req.method = "POST";
  req.headers = { "stripe-signature": `t=${t},v1=${sig}` };
  return req;
}
const reponse = () => { const r = { statut: 0 }; r.status = (s) => { r.statut = s; return r; }; r.json = () => r; r.end = () => r; return r; };

beforeEach(() => {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", SECRET);
  vi.stubEnv("VITE_SUPABASE_URL", "https://b.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "cle");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function simuler(mission) {
  const appels = [];
  vi.stubGlobal("fetch", vi.fn(async (url, o = {}) => {
    const u = String(url);
    appels.push({ u, methode: o.method || "GET", corps: o.body });
    if (u.includes("/rest/v1/missions?or=(stripe_payment_intent")) return new Response(JSON.stringify([mission]), { status: 200 });
    if (u.includes("/rest/v1/missions?id=") && o.method === "PATCH") return new Response(JSON.stringify([{ id: mission.id }]), { status: 200 });
    return new Response("[]", { status: 200 });
  }));
  return appels;
}
const evenement = { type: "charge.dispute.created", data: { object: { id: "dp_1", charge: "ch_1", payment_intent: "pi_1", amount: 11098, reason: "fraudulent", status: "needs_response" } } };

describe("contestation bancaire", () => {
  it("versement en attente : retenu 90 jours au plus, motif « opposition bancaire », prestataire prévenu", async () => {
    const appels = simuler({ id: "m1", client_id: "c1", prestataire_id: "p1", payout_status: "pending", payout_amount: 104 });
    const res = reponse();
    await handler(requete(evenement), res);
    expect(res.statut).toBe(200);
    const retenue = appels.find(a => a.methode === "PATCH" && a.u.includes("missions?id=eq.m1"));
    expect(retenue.u).toContain("payout_status=in.(pending,failed)");
    const corps = JSON.parse(retenue.corps);
    expect(corps.payout_status).toBe("held");
    expect(corps.payout_hold_reason).toBe("opposition_bancaire");
    const jours = (new Date(corps.payout_hold_until) - new Date(corps.payout_hold_at)) / 86400000;
    expect(Math.round(jours)).toBe(90);
    expect(appels.some(a => a.u.includes("/rest/v1/notifications") && a.corps.includes("opposition bancaire"))).toBe(true);
  });

  it("versement déjà parti : rien n'est réécrit", async () => {
    const appels = simuler({ id: "m1", client_id: "c1", prestataire_id: "p1", payout_status: "transferred", payout_amount: 104 });
    await handler(requete(evenement), reponse());
    expect(appels.some(a => a.methode === "PATCH" && a.u.includes("missions?id=eq.m1"))).toBe(false);
  });

  // Décision d'Alexandre du 01/10/2026 : une contestation reçue AVANT la clôture
  // n'avait aucun versement à retenir, et le virement partait à la clôture.
  it("pas encore clôturée : la retenue est inscrite, sans créer de versement", async () => {
    const appels = simuler({ id: "m1", client_id: "c1", prestataire_id: "p1", payout_status: null, payout_amount: null });
    await handler(requete(evenement), reponse());
    const inscription = appels.find(a => a.methode === "PATCH" && a.u.includes("missions?id=eq.m1"));
    expect(inscription.u).toContain("payout_status=is.null");
    const corps = JSON.parse(inscription.corps);
    expect(corps.payout_status, "pas de versement inventé").toBeUndefined();
    expect(corps.payout_hold_reason).toBe("opposition_bancaire");
    expect(Math.round((new Date(corps.payout_hold_until) - new Date(corps.payout_hold_at)) / 86400000)).toBe(90);
  });
});

// Relecture du 23/10/2026 : la retenue tombait d'office à 90 jours, quelle que
// soit l'issue — une opposition PERDUE laissait partir le versement.
describe("issue de l'opposition (charge.dispute.closed)", () => {
  const ferme = (status) => ({ type: "charge.dispute.closed", data: { object: { id: "dp_1", payment_intent: "pi_1", amount: 11098, status } } });
  // `missions` : les prestations retenues que la lecture rend ; `autresOuvertes` :
  // oppositions encore ouvertes sur l'autre paiement de la prestation.
  function simulerIssue(missions, autresOuvertes = []) {
    const appels = [];
    vi.stubGlobal("fetch", vi.fn(async (url, o = {}) => {
      const u = String(url);
      appels.push({ u, methode: o.method || "GET", corps: o.body });
      if (u.includes("/rest/v1/missions?and=") && !o.method) return new Response(JSON.stringify(missions), { status: 200 });
      if (u.includes("/rest/v1/missions?id=eq.") && o.method === "PATCH") return new Response("[{}]", { status: 200 });
      // pi_1 : le paiement dont l'opposition vient d'être gagnée ; les autres
      // oppositions sont sur l'autre paiement.
      if (u.includes("api.stripe.com/v1/disputes")) return new Response(JSON.stringify({ data: u.includes("payment_intent=pi_1") ? [] : autresOuvertes }), { status: 200 });
      if (u.includes("api.resend.com")) return new Response(JSON.stringify({ id: "e1" }), { status: 200 });
      return new Response("[]", { status: 200 });
    }));
    return appels;
  }
  it("la lecture prend aussi le versement vide (retenue inscrite avant la clôture) et celui en attente", async () => {
    const appels = simulerIssue([]);
    await handler(requete(ferme("won")), reponse());
    const lecture = appels.find(a => a.u.includes("/rest/v1/missions?and="));
    expect(decodeURIComponent(lecture.u)).toContain("or(payout_status.is.null,payout_status.in.(held,pending,failed))");
    expect(lecture.u).not.toContain("not.in");
  });
  it("gagnée, versement retenu : la retenue est levée, le versement repart, le prestataire est prévenu", async () => {
    const appels = simulerIssue([{ id: "m1", prestataire_id: "p1", payout_status: "held", stripe_payment_intent: "pi_1" }]);
    const res = reponse();
    await handler(requete(ferme("won")), res);
    expect(res.statut).toBe(200);
    const levee = appels.find(a => a.methode === "PATCH" && a.u.includes("missions?id=eq.m1"));
    expect(JSON.parse(levee.corps)).toEqual({ payout_hold_reason: null, payout_hold_at: null, payout_hold_until: null, payout_status: "pending" });
    expect(appels.some(a => a.u.includes("/rest/v1/notifications") && a.corps.includes("rejetée"))).toBe(true);
  });
  it("gagnée, retenue inscrite avant la clôture : elle est effacée, sans inventer de versement", async () => {
    const appels = simulerIssue([{ id: "m1", prestataire_id: "p1", payout_status: null, stripe_payment_intent: "pi_1" }]);
    await handler(requete(ferme("won")), reponse());
    const levee = appels.find(a => a.methode === "PATCH" && a.u.includes("missions?id=eq.m1"));
    expect(JSON.parse(levee.corps)).toEqual({ payout_hold_reason: null, payout_hold_at: null, payout_hold_until: null });
  });
  it("gagnée, oppositions illisibles chez Stripe : rien n'est tranché, 500 pour que Stripe réémette (relecture du 27/10/2026)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const appels = [];
    vi.stubGlobal("fetch", vi.fn(async (url, o = {}) => {
      const u = String(url);
      appels.push({ u, methode: o.method || "GET", corps: o.body });
      if (u.includes("/rest/v1/missions?and=") && !o.method) return new Response(JSON.stringify([{ id: "m1", prestataire_id: "p1", payout_status: "held", stripe_payment_intent: "pi_1" }]), { status: 200 });
      if (u.includes("api.stripe.com/v1/disputes")) return new Response("{}", { status: 503 });
      return new Response("[]", { status: 200 });
    }));
    const res = reponse();
    await handler(requete(ferme("won")), res);
    expect(res.statut).toBe(500);
    // Ni levée, ni terme effacé : la retenue garde son échéance de 90 jours.
    expect(appels.some(a => a.methode === "PATCH" && a.u.includes("/rest/v1/missions"))).toBe(false);
  });
  it("gagnée, mais l'autre paiement de la prestation est encore contesté : la retenue reste", async () => {
    const appels = simulerIssue([{ id: "m1", prestataire_id: "p1", payout_status: "held", stripe_payment_intent: "pi_0", extra_hours_payment_intent: "pi_1" }],
      [{ id: "dp_0", status: "needs_response" }]);
    await handler(requete(ferme("won")), reponse());
    expect(appels.some(a => a.u.includes("api.stripe.com/v1/disputes?payment_intent=pi_0"))).toBe(true);
    // La retenue reste, sans terme : rien n'est levé (relecture du 26/10/2026).
    const ecrit = appels.filter(a => a.methode === "PATCH" && a.u.includes("missions?id=eq.m1"));
    expect(ecrit.map(a => JSON.parse(a.corps))).toEqual([{ payout_hold_until: null }]);
  });
  it("gagnée, mais l'autre paiement a une opposition PERDUE : la retenue sans terme reste (relecture du 25/10/2026)", async () => {
    const appels = simulerIssue([{ id: "m1", prestataire_id: "p1", payout_status: "held", stripe_payment_intent: "pi_0", extra_hours_payment_intent: "pi_1" }],
      [{ id: "dp_0", status: "lost" }]);
    await handler(requete(ferme("won")), reponse());
    const ecrit = appels.filter(a => a.methode === "PATCH" && a.u.includes("missions?id=eq.m1"));
    expect(ecrit.map(a => JSON.parse(a.corps))).toEqual([{ payout_hold_until: null }]);
  });
  it("gagnée, mais une AUTRE opposition du même paiement est perdue : la retenue reste (relecture du 26/10/2026)", async () => {
    const appels = [];
    vi.stubGlobal("fetch", vi.fn(async (url, o = {}) => {
      const u = String(url);
      appels.push({ u, methode: o.method || "GET", corps: o.body });
      if (u.includes("/rest/v1/missions?and=") && !o.method) return new Response(JSON.stringify([{ id: "m1", payout_status: "held", stripe_payment_intent: "pi_1" }]), { status: 200 });
      if (u.includes("/rest/v1/missions?id=eq.") && o.method === "PATCH") return new Response("[{}]", { status: 200 });
      if (u.includes("api.stripe.com/v1/disputes?payment_intent=pi_1")) return new Response(JSON.stringify({ data: [{ id: "dp_1", status: "won" }, { id: "dp_a", status: "lost" }] }), { status: 200 });
      return new Response("[]", { status: 200 });
    }));
    await handler(requete(ferme("won")), reponse());
    const ecrit = appels.filter(a => a.methode === "PATCH");
    expect(ecrit.map(a => JSON.parse(a.corps))).toEqual([{ payout_hold_until: null }]);
  });
  it("l'écriture vise l'état lu ; si rien n'est écrit (état changé entre-temps), 500 et Stripe réémet", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const appels = [];
    vi.stubGlobal("fetch", vi.fn(async (url, o = {}) => {
      const u = String(url);
      appels.push({ u, methode: o.method || "GET" });
      if (u.includes("/rest/v1/missions?and=") && !o.method) return new Response(JSON.stringify([{ id: "m1", payout_status: "pending", stripe_payment_intent: "pi_1" }]), { status: 200 });
      if (u.includes("api.stripe.com/v1/disputes")) return new Response(JSON.stringify({ data: [] }), { status: 200 });
      return new Response("[]", { status: 200 });
    }));
    const res = reponse();
    await handler(requete(ferme("won")), res);
    const ecriture = appels.find(a => a.methode === "PATCH");
    expect(ecriture.u).toContain("payout_status=eq.pending");
    expect(res.statut).toBe(500);
  });
  it("perdue : la retenue garde son motif et perd son terme — plus rien ne la lève seul ; l'administrateur est prévenu", async () => {
    vi.stubEnv("ADMIN_EMAIL", "admin@exemple.fr");
    vi.stubEnv("RESEND_API_KEY", "re_x");
    const appels = simulerIssue([{ id: "m1", prestataire_id: "p1", payout_status: null, stripe_payment_intent: "pi_1" }]);
    await handler(requete(ferme("lost")), reponse());
    const maintenue = appels.find(a => a.methode === "PATCH" && a.u.includes("missions?id=eq.m1"));
    expect(JSON.parse(maintenue.corps)).toEqual({ payout_hold_until: null });
    expect(maintenue.u).toContain("payout_hold_reason=eq.opposition_bancaire");
    expect(appels.some(a => a.u.includes("api.resend.com") && a.corps.includes("Opposition perdue"))).toBe(true);
  });
  it("base indisponible : 500, Stripe réémettra", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    const res = reponse();
    await handler(requete(ferme("won")), res);
    expect(res.statut).toBe(500);
  });
});

describe("une retenue sans terme n'annonce pas de date", () => {
  const cron = readFileSync(new URL("../../../api/cron-reset-monthly.js", import.meta.url), "utf8");
  it("le prestataire ne lit plus « 1 janvier 1970 »", () => {
    expect(cron).toMatch(/const finLe = m\.payout_hold_until\s+\? new Date\(m\.payout_hold_until\)/);
    expect(cron).toMatch(/finLe \? `La retenue prend fin au plus tard le \$\{finLe\}/);
  });
});

describe("le traitement des versements respecte une retenue sans terme", () => {
  const cron = readFileSync(new URL("../../../api/cron-reset-monthly.js", import.meta.url), "utf8");
  it("à l'émission, une retenue sans terme retient ; la levée d'office ne touche que les retenues datées", () => {
    expect(cron).toMatch(/if \(m\.payout_hold_reason && \(!m\.payout_hold_until \|\| new Date\(m\.payout_hold_until\)\.getTime\(\) > Date\.now\(\)\)\)/);
    expect(cron).toMatch(/payout_status=eq\.held&payout_hold_until=lte\./);
  });
  it("tous les versements dus sont lus, et ceux qui peuvent partir passent d'abord (relecture du 26/10/2026)", () => {
    expect(cron).toMatch(/dus = await lireTout\(/);
    expect(cron).toMatch(/const lots = ordonnerVersements\(dus, etatsComptes, 200\)/);
  });
});

describe("le traitement des versements ne retient que si la retenue est toujours là", () => {
  it("le passage en « retenu » vérifie le motif (relecture du 26/10/2026)", () => {
    const cron = readFileSync(new URL("../../../api/cron-reset-monthly.js", import.meta.url), "utf8");
    expect(cron).toMatch(/payout_status=eq\.pending&payout_hold_reason=eq\.\$\{encodeURIComponent\(m\.payout_hold_reason\)\}/);
  });
});
