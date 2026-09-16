import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { TARIFS, idTarifStripe, comparerPrix, resumeEcart } from "../../../api/_prix.js";

// Le prix affiché et le prix prélevé viennent de deux sources qui ne se parlent
// pas : le réglage du back-office commande l'affichage, le tarif Stripe commande
// le prélèvement. Modifier l'un sans l'autre fait afficher un prix et en
// prélever un second — et sur un abonnement récurrent, la réclamation n'arrive
// qu'au premier relevé bancaire.

const GRILLE = { premium: { monthly: 29.99, yearly: 290 }, elite: { monthly: 79.99, yearly: 790 } };

const stripeRepond = (montantsParId) => vi.fn(async (url) => {
  const id = decodeURIComponent(String(url).split("/prices/")[1] || "");
  if (!(id in montantsParId)) return { ok: false, status: 404, text: async () => "no such price" };
  return { ok: true, json: async () => ({ unit_amount: montantsParId[id] }) };
});

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const poserTarifs = () => {
  for (const t of TARIFS) vi.stubEnv(`STRIPE_PRICE_${t.suffixe}`, `price_${t.suffixe}`);
};

describe("idTarifStripe()", () => {
  // Deux écritures coexistent dans Vercel, et les variables y sont « Sensitive »,
  // donc illisibles après enregistrement : renommer imposerait de ressaisir les
  // quatre identifiants depuis Stripe, soit quatre occasions de se tromper.
  it("accepte les deux écritures de la variable", () => {
    vi.stubEnv("STRIPE_PRICE_PREMIUM_MONTHLY", "price_A");
    expect(idTarifStripe("PREMIUM_MONTHLY").id).toBe("price_A");
    vi.unstubAllEnvs();
    vi.stubEnv("STRIPE_ELITE_YEARLY", "price_B");
    expect(idTarifStripe("ELITE_YEARLY").id).toBe("price_B");
  });

  it("rend null quand aucune n'est renseignée", () => {
    expect(idTarifStripe("PREMIUM_YEARLY").id).toBeNull();
  });
});

describe("comparerPrix()", () => {
  it("ne signale rien quand tout concorde", async () => {
    poserTarifs();
    vi.stubGlobal("fetch", stripeRepond({
      price_PREMIUM_MONTHLY: 2999, price_PREMIUM_YEARLY: 29000,
      price_ELITE_MONTHLY: 7999,   price_ELITE_YEARLY: 79000,
    }));
    const r = await comparerPrix(GRILLE, "sk_test");
    expect(r.ok).toBe(true);
    expect(r.ecarts).toHaveLength(0);
  });

  it("détecte un écart et dit lequel", async () => {
    poserTarifs();
    vi.stubGlobal("fetch", stripeRepond({
      price_PREMIUM_MONTHLY: 3499,   // affiché 29,99 — prélevé 34,99
      price_PREMIUM_YEARLY: 29000, price_ELITE_MONTHLY: 7999, price_ELITE_YEARLY: 79000,
    }));
    const r = await comparerPrix(GRILLE, "sk_test");
    expect(r.ok).toBe(false);
    expect(r.ecarts).toHaveLength(1);
    expect(resumeEcart(r.ecarts[0])).toMatch(/affiché 29,99 €, prélevé 34,99 €/);
  });

  // Une clé absente ou un tarif illisible ne doivent pas se lire comme une
  // absence d'écart : « je n'ai pas pu vérifier » n'est pas « tout va bien ».
  it("distingue l'impossibilité de la conformité", async () => {
    const sansCle = await comparerPrix(GRILLE, "");
    expect(sansCle.ok).toBe(false);
    expect(sansCle.indisponible).toBe(true);

    poserTarifs();
    vi.stubGlobal("fetch", stripeRepond({ price_PREMIUM_MONTHLY: 2999 }));  // trois introuvables
    const partiel = await comparerPrix(GRILLE, "sk_test");
    expect(partiel.ok).toBe(false);
    expect(partiel.indisponible).toBe(true);
    expect(partiel.ecarts).toHaveLength(0);
  });

  it("signale un tarif Stripe non renseigné", async () => {
    vi.stubGlobal("fetch", stripeRepond({}));
    const r = await comparerPrix(GRILLE, "sk_test");
    expect(r.lignes.every(l => l.etat === "tarif_absent")).toBe(true);
    expect(resumeEcart(r.lignes[0])).toMatch(/aucun tarif Stripe renseigné/);
  });

  // Deux montants égaux ne doivent pas diverger sur une erreur de virgule
  // flottante : la comparaison se fait au centime.
  it("compare au centime, pas en virgule flottante", async () => {
    poserTarifs();
    vi.stubGlobal("fetch", stripeRepond({
      price_PREMIUM_MONTHLY: 2999, price_PREMIUM_YEARLY: 29000,
      price_ELITE_MONTHLY: 7999,   price_ELITE_YEARLY: 79000,
    }));
    const r = await comparerPrix({ premium: { monthly: 29.99, yearly: 290.0 },
                                   elite: { monthly: 79.99, yearly: 790.0 } }, "sk_test");
    expect(r.ok).toBe(true);
  });
});

describe("le contrôle est branché des deux côtés", () => {
  const bo   = readFileSync(new URL("../../../api/bo-action.js", import.meta.url), "utf8");
  const cron = readFileSync(new URL("../../../api/cron-reset-monthly.js", import.meta.url), "utf8");
  const ecran= readFileSync(new URL("../../components/backoffice.jsx", import.meta.url), "utf8");

  it("à la demande, depuis le back-office", () => {
    expect(bo).toContain('action === "verifier_prix"');
    expect(ecran).toContain("verifierPrix");
  });

  it("et automatiquement, chaque jour", () => {
    const bloc = cron.slice(cron.indexOf('queryAction === "documents"'));
    expect(bloc).toContain("comparerPrix");
    expect(bloc).toContain("ADMIN_EMAIL");
  });

  // On n'alerte que sur un écart constaté : une clé absente relève de
  // l'exploitation, pas d'une promesse trompeuse.
  it("n'alerte que sur un écart réel", () => {
    const bloc = cron.slice(cron.indexOf("comparerPrix"));
    expect(bloc).toContain("prix.ecarts.length > 0");
    expect(bloc).toContain("prix.indisponible");
  });

  // Baisser le prélèvement léserait l'entreprise, relever l'affichage léserait
  // le prestataire : c'est un arbitrage, pas une réparation automatique.
  it("ne corrige jamais tout seul", () => {
    const prix = readFileSync(new URL("../../../api/_prix.js", import.meta.url), "utf8");
    expect(prix).not.toMatch(/PATCH|POST.*subscription_prices/);
    expect(prix).toMatch(/Il ne corrige rien/);
  });
});
