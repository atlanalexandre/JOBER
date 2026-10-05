// Passage à Stripe Connect v2 (Accounts v2), demandé par l'équipe Stripe
// Accelerate le 05/10/2026. Champs vérifiés contre la spécification officielle
// (stripe/openapi, version 2026-09-30.endive).
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { Readable } from "node:stream";
import { corpsCompteV2, assurerCompteConnect, lienConfiguration, statutCompte, STRIPE_VERSION_V2 } from "../../../api/_connect.js";
import webhook from "../../../api/stripe-webhook.js";

const json = (v, status = 200) => Promise.resolve(new Response(JSON.stringify(v), { status }));
beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); vi.spyOn(console, "log").mockImplementation(() => {}); vi.spyOn(console, "warn").mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("création du compte de virement en v2", () => {
  it("l'équivalent d'un compte Express qui reçoit des virements", () => {
    const c = corpsCompteV2({ profil: { prenom: "Sam", nom: "Recette" }, email: "sam@x.fr" });
    expect(c.dashboard).toBe("express");
    expect(c.defaults.responsibilities).toEqual({ fees_collector: "application_express", losses_collector: "application" });
    expect(c.configuration).toEqual({ recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } } });
    expect(c.identity).toEqual({ country: "FR", entity_type: "individual", individual: { given_name: "Sam", surname: "Recette", email: "sam@x.fr" } });
    expect(c.defaults.currency).toBe("eur");
    expect(c.contact_email).toBe("sam@x.fr");
  });

  it("appel v2 : JSON, version d'API, clé d'idempotence propre au prestataire", async () => {
    const appels = [];
    vi.stubGlobal("fetch", vi.fn((url, o = {}) => {
      appels.push({ url: String(url), o });
      if (String(url).includes("api.stripe.com")) return json({ id: "acct_1", object: "v2.core.account" });
      return json([{ id: "p1" }]);
    }));
    const r = await assurerCompteConnect({ profil: { id: "p1", prenom: "Sam", nom: "R" }, email: "s@x.fr", supabaseUrl: "https://b", headers: {}, stripeKey: "sk_test" });
    expect(r).toEqual({ ok: true, compteId: "acct_1", cree: true });
    const s = appels.find(a => a.url.includes("stripe"));
    expect(s.url).toBe("https://api.stripe.com/v2/core/accounts");
    expect(s.o.headers["Content-Type"]).toBe("application/json");
    expect(s.o.headers["Stripe-Version"]).toBe(STRIPE_VERSION_V2);
    expect(s.o.headers["Idempotency-Key"]).toBe("compte-presta-p1");
    expect(JSON.parse(s.o.body).dashboard).toBe("express");
  });

  it("lien d'inscription v2", async () => {
    let corps = null, adresse = null;
    vi.stubGlobal("fetch", vi.fn((url, o) => { adresse = String(url); corps = JSON.parse(o.body); return json({ url: "https://connect.stripe.com/x" }); }));
    const r = await lienConfiguration({ compteId: "acct_1", stripeKey: "sk", appUrl: "https://app" });
    expect(r).toEqual({ ok: true, url: "https://connect.stripe.com/x" });
    expect(adresse).toBe("https://api.stripe.com/v2/core/account_links");
    expect(corps).toEqual({ account: "acct_1", use_case: { type: "account_onboarding",
      account_onboarding: { refresh_url: "https://app/provider/dashboard", return_url: "https://app/provider/dashboard" } } });
  });
});

describe("statut du compte", () => {
  const v2 = (statut) => ({ id: "acct_1", configuration: { recipient: { capabilities: { stripe_balance: { stripe_transfers: { status: statut } } } } } });
  it("v2 active → enabled ; restricted → pending", async () => {
    vi.stubGlobal("fetch", vi.fn(() => json(v2("active"))));
    expect(await statutCompte("acct_1", "sk")).toBe("enabled");
    vi.stubGlobal("fetch", vi.fn(() => json(v2("restricted"))));
    expect(await statutCompte("acct_1", "sk")).toBe("pending");
  });
  it("compte que la v2 ne lit pas : repli en v1 (payouts_enabled)", async () => {
    vi.stubGlobal("fetch", vi.fn((url) => String(url).includes("/v2/") ? json({ error: { message: "x" } }, 400) : json({ id: "acct_1", payouts_enabled: true })));
    expect(await statutCompte("acct_1", "sk")).toBe("enabled");
  });
  it("Stripe muet : null, jamais « pas activé »", async () => {
    vi.stubGlobal("fetch", vi.fn(() => json({}, 500)));
    expect(await statutCompte("acct_1", "sk")).toBe(null);
  });
});

describe("webhook : événements v2", () => {
  const signer = (corps, secret) => {
    const t = Math.floor(Date.now() / 1000);
    const req = Readable.from([Buffer.from(corps)]);
    req.method = "POST";
    req.headers = { "stripe-signature": `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${corps}`).digest("hex")}` };
    return req;
  };
  const reponse = () => { const r = { statut: 0 }; r.status = (s) => { r.statut = s; return r; }; r.json = () => r; r.end = () => r; return r; };
  const evenement = JSON.stringify({ id: "evt_1", object: "v2.core.event", type: "v2.core.account[configuration.recipient].capability_status_updated",
    related_object: { id: "acct_9", type: "v2.core.account", url: "/v2/core/accounts/acct_9" } });

  beforeEach(() => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_v1");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET_V2", "whsec_v2");
    vi.stubEnv("VITE_SUPABASE_URL", "https://b.test");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "cle");
  });

  it("signé par la destination v2 : le compte est relu chez Stripe et son statut enregistré", async () => {
    const ecrits = [];
    vi.stubGlobal("fetch", vi.fn((url, o = {}) => {
      const u = String(url);
      if (u.includes("/v2/core/accounts/acct_9")) return json({ id: "acct_9", configuration: { recipient: { capabilities: { stripe_balance: { stripe_transfers: { status: "active" } } } } } });
      if (o.method === "PATCH") { ecrits.push({ u, corps: JSON.parse(o.body) }); return Promise.resolve(new Response(null, { status: 204 })); }
      return json([]);
    }));
    const r = reponse();
    await webhook(signer(evenement, "whsec_v2"), r);
    expect(r.statut).toBe(200);
    expect(ecrits).toEqual([{ u: "https://b.test/rest/v1/profiles?stripe_account_id=eq.acct_9", corps: { stripe_account_status: "enabled" } }]);
  });

  it("mauvaise signature : refusé, rien n'est relu", async () => {
    const f = vi.fn(() => json([]));
    vi.stubGlobal("fetch", f);
    const r = reponse();
    await webhook(signer(evenement, "whsec_autre"), r);
    expect(r.statut).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });
});
