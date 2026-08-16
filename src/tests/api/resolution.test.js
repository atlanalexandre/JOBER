// L'article 17.1 des CGPS disait deux choses contradictoires : qu'ALANE
// formulait une « proposition sans caractère contraignant », et qu'elle pouvait
// « donner instruction de verser, de rembourser ou de maintenir les fonds
// indisponibles ». Le code, lui, ne connaissait que la seconde : le backoffice
// remboursait dans la seconde, sans proposition ni délai.
//
// L'article réécrit ne connaît plus que trois causes de déblocage : l'accord
// des parties, les procédures de l'établissement de paiement, une décision de
// justice. Ces tests portent sur la première — la seule qu'ALANE outille, et
// la seule où un silence produit un mouvement d'argent.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  DELAI_OPPOSITION_MS, RESOLUTIONS, libelleResolution,
  echeanceOppositionMs, accordRepute, executerResolution, montantRemboursable,
} from "../../../api/_resolution.js";

const H = 3600000;
const dans = (ms) => new Date(Date.now() + ms).toISOString();

describe("délai d'opposition", () => {
  it("court sur 48 heures, comme le délai de réclamation", () => {
    expect(DELAI_OPPOSITION_MS).toBe(48 * H);
  });

  it("l'échéance se calcule depuis la notification, pas depuis la prestation", () => {
    const t = 1_700_000_000_000;
    expect(echeanceOppositionMs(t)).toBe(t + 48 * H);
  });
});

describe("accord réputé formé", () => {
  const base = { resolution_proposee: "verser_prestataire", resolution_echeance_at: dans(-H) };

  it("se forme à l'échéance quand personne ne s'est opposé", () => {
    expect(accordRepute(base)).toBe(true);
  });

  it("ne se forme pas avant l'échéance", () => {
    expect(accordRepute({ ...base, resolution_echeance_at: dans(H) })).toBe(false);
  });

  // Le cœur de la correction : l'opposition d'UNE SEULE partie suffit. Sans
  // cela, le silence de l'une vaudrait accord des deux, et la « proposition »
  // resterait une décision d'ALANE sous un autre nom.
  it("ne se forme pas si une partie s'est opposée, même après l'échéance", () => {
    expect(accordRepute({ ...base, resolution_opposition_at: dans(-2 * H) })).toBe(false);
  });

  it("n'existe pas sans proposition", () => {
    expect(accordRepute({ resolution_echeance_at: dans(-H) })).toBe(false);
    expect(accordRepute(null)).toBe(false);
  });

  // Une échéance illisible ne doit pas se lire comme « échéance passée » :
  // une date absente ferait partir de l'argent sans qu'aucun délai ait couru.
  it("ne se forme pas si l'échéance est absente ou illisible", () => {
    expect(accordRepute({ resolution_proposee: "verser_prestataire" })).toBe(false);
    expect(accordRepute({ resolution_proposee: "verser_prestataire", resolution_echeance_at: "n'importe quoi" })).toBe(false);
  });
});

describe("résolutions formulables", () => {
  it("se limite aux deux dénouements que la Plateforme sait exécuter", () => {
    expect(RESOLUTIONS).toEqual(["verser_prestataire", "rembourser_client"]);
  });

  it("chacune a un libellé lisible pour la notification aux parties", () => {
    for (const r of RESOLUTIONS) expect(libelleResolution(r).length).toBeGreaterThan(5);
  });
});

// Décision du 16/08/2026 : les frais de service restent acquis, comme en
// matière d'annulation. Le remboursement portait auparavant sur l'intégralité
// du PaymentIntent — une troisième règle, différente des deux autres.
describe("part remboursable d'un litige", () => {
  // 8 h à 14 €/h = 112 € de prestation, 118,10 € payés → 6,10 € de frais.
  const m = { montant_total: 118.10, tarif_horaire: 14, hours: 8, actual_hours: 8 };

  it("rembourse le prix de la prestation, pas les frais de service", () => {
    const { centimes, fraisRetenus } = montantRemboursable(m);
    expect(centimes).toBe(11200);
    expect(fraisRetenus).toBeCloseTo(6.10, 2);
  });

  it("tient compte du nombre de jours d'une prestation multi-jours", () => {
    // 3 jours × 8 h × 14 € = 336 € de prestation, 345 € payés → 9 € de frais.
    const { centimes } = montantRemboursable({
      montant_total: 345, tarif_horaire: 14, hours: 8, actual_hours: 8,
      date_debut: "2026-08-10", date_fin: "2026-08-12",
    });
    expect(centimes).toBe(33600);
  });

  // À défaut de savoir ce qui est dû, on ne retient rien au consommateur :
  // `null` fait rembourser la totalité côté appelant.
  it("ne retient rien quand les frais ne sont pas établissables", () => {
    expect(montantRemboursable({ montant_total: 0 }).centimes).toBeNull();
    expect(montantRemboursable({ montant_total: 112, tarif_horaire: 14, hours: 8 }).centimes).toBeNull();
    expect(montantRemboursable({}).centimes).toBeNull();
  });
});

describe("exécution d'une résolution", () => {
  const SB = "https://exemple.supabase.co";
  const headers = { apikey: "x" };
  let appels;

  beforeEach(() => {
    appels = [];
    vi.stubGlobal("fetch", vi.fn(async (url, opts) => {
      appels.push({ url: String(url), opts });
      if (String(url).includes("api.stripe.com")) {
        return { ok: true, json: async () => ({ id: "re_test" }) };
      }
      return { ok: true, json: async () => [{}], text: async () => "" };
    }));
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("refuse une résolution inconnue plutôt que de deviner", async () => {
    const out = await executerResolution({
      mission: { id: "m1" }, resolution: "faire_moitie_moitie", supabaseUrl: SB, headers,
    });
    expect(out.ok).toBe(false);
    expect(appels).toHaveLength(0);
  });

  // Le versement repasse en `pending` : sans cette remise à zéro, une
  // prestation dont le virement avait échoué avant le litige resterait
  // `failed` et ne serait jamais payée.
  it("verser_prestataire replace la prestation dans la file des versements", async () => {
    const out = await executerResolution({
      mission: { id: "m1" }, resolution: "verser_prestataire", supabaseUrl: SB, headers,
      cause: "accord_tacite",
    });
    expect(out.ok).toBe(true);
    const corps = JSON.parse(appels[0].opts.body);
    expect(corps.status).toBe("completed");
    expect(corps.payout_status).toBe("pending");
    expect(corps.resolution_executee_cause).toBe("accord_tacite");
  });

  it("rembourser_client appelle Stripe avant de clore la prestation", async () => {
    const out = await executerResolution({
      mission: { id: "m2", stripe_payment_intent: "pi_1" }, resolution: "rembourser_client",
      supabaseUrl: SB, headers, stripeKey: "sk_test", cause: "justice",
    });
    expect(out.ok).toBe(true);
    expect(appels[0].url).toContain("api.stripe.com/v1/refunds");
    expect(appels[1].url).toContain("/missions?id=eq.m2");
    expect(JSON.parse(appels[1].opts.body).status).toBe("closed");
  });

  it("le remboursement envoyé à Stripe est plafonné au prix de la prestation", async () => {
    await executerResolution({
      mission: {
        id: "m6", stripe_payment_intent: "pi_5",
        montant_total: 118.10, tarif_horaire: 14, hours: 8, actual_hours: 8,
      },
      resolution: "rembourser_client", supabaseUrl: SB, headers, stripeKey: "sk_test",
    });
    expect(appels[0].opts.body).toContain("amount=11200");
  });

  it("sans montant établissable, rembourse la totalité plutôt que de retenir à l'aveugle", async () => {
    await executerResolution({
      mission: { id: "m7", stripe_payment_intent: "pi_6" },
      resolution: "rembourser_client", supabaseUrl: SB, headers, stripeKey: "sk_test",
    });
    expect(appels[0].opts.body).not.toContain("amount=");
  });

  // Le traitement automatique repasse toutes les deux heures. Sans clé
  // d'idempotence, un échec réseau après l'appel Stripe mais avant l'écriture
  // en base rembourserait deux fois.
  it("le remboursement porte une clé d'idempotence stable", async () => {
    await executerResolution({
      mission: { id: "m3", stripe_payment_intent: "pi_2" }, resolution: "rembourser_client",
      supabaseUrl: SB, headers, stripeKey: "sk_test",
    });
    expect(appels[0].opts.headers["Idempotency-Key"]).toBe("resolution-m3");
  });

  it("sans clé Stripe, échoue franchement au lieu de clore sans rembourser", async () => {
    const out = await executerResolution({
      mission: { id: "m4", stripe_payment_intent: "pi_3" }, resolution: "rembourser_client",
      supabaseUrl: SB, headers, stripeKey: "",
    });
    expect(out.ok).toBe(false);
    expect(appels).toHaveLength(0);
  });

  it("un refus de Stripe ne clôt pas la prestation", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (String(url).includes("api.stripe.com")) {
        return { ok: false, json: async () => ({ error: { message: "carte expirée" } }) };
      }
      throw new Error("la base ne devait pas être touchée");
    }));
    const out = await executerResolution({
      mission: { id: "m5", stripe_payment_intent: "pi_4" }, resolution: "rembourser_client",
      supabaseUrl: SB, headers, stripeKey: "sk_test",
    });
    expect(out.ok).toBe(false);
    expect(out.detail).toContain("carte expirée");
  });
});
