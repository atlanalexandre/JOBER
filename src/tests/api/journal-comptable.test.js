// Journal comptable du mois (26/10/2026) : le relevé du solde Stripe, mouvement
// par mouvement, pour le comptable. Avant, l'export ne donnait que les
// prestations — ni frais de service, ni abonnements, ni frais Stripe, ni
// remboursements.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { bornesMois, ligneJournal, totauxJournal, fraisServiceDeduits, natureDuPaiement } from "../../../api/_journal_comptable.js";

const bo = readFileSync(new URL("../../../api/bo-action.js", import.meta.url), "utf8");
const action = bo.slice(bo.indexOf('if (action === "export_comptable")'), bo.indexOf('if (action === "bo_log_export")'));
const ecran = readFileSync(new URL("../../components/backoffice.jsx", import.meta.url), "utf8");
const bouton = ecran.slice(ecran.indexOf("export function BOExportJournal"), ecran.indexOf("export function BOExportPDF"));

const M = "36569606-657d-42f4-818b-692da2566c63";

describe("les bornes du mois sont celles de Paris", () => {
  it("octobre commence à minuit heure d'été, se termine à minuit heure d'hiver", () => {
    const b = bornesMois("2026-10");
    expect(new Date(b.gte * 1000).toISOString()).toBe("2026-09-30T22:00:00.000Z");
    expect(new Date(b.lt * 1000).toISOString()).toBe("2026-10-31T23:00:00.000Z");
  });
  it("décembre se termine le 1er janvier suivant", () => {
    expect(new Date(bornesMois("2026-12").lt * 1000).toISOString()).toBe("2026-12-31T23:00:00.000Z");
  });
  it("un mois illisible est refusé", () => {
    for (const v of ["", "2026-13", "2026-1", "26-10", null, "2026-10-01"]) expect(bornesMois(v)).toBeNull();
  });
});

describe("chaque mouvement est nommé", () => {
  const missions = new Map([[M, { id: M, metier: "Femme de chambre", montant_total: 79.9, tarif_horaire: 15, hours: 5, cashback_applique: 0 }]]);

  it("une réservation, avec ses frais de service déduits des montants enregistrés", () => {
    const l = ligneJournal({ id: "txn_1", type: "charge", amount: 7990, fee: 137, net: 7853, created: 1793007356, available_on: 1793577600,
      source: { id: "ch_1", object: "charge", payment_intent: "pi_1", metadata: { mission: M, client: "c" } } }, missions);
    expect(l).toMatchObject({ nature: "Réservation", montant: 79.9, frais_stripe: 1.37, net: 78.53, frais_service: 4.9,
      prestation: M, metier: "Femme de chambre", connue: true, paiement: "pi_1", origine: "ch_1", mouvement: "txn_1" });
    expect(l.date).toBe("2026-10-26 10:35"); // 09:35 UTC = 10:35 à Paris (heure d'hiver)
  });

  it("un paiement qui ne correspond plus au prix enregistré : frais laissés vides, pas devinés", () => {
    const l = ligneJournal({ id: "txn_2", type: "charge", amount: 5000, fee: 0, net: 5000, created: 0,
      source: { object: "charge", metadata: { mission: M } } }, missions);
    expect(l.frais_service).toBeNull();
  });

  it("les heures supplémentaires, la série et l'abonnement", () => {
    expect(natureDuPaiement({ metadata: { mission: M, type: "heures_supp" } })).toBe("Heures supplémentaires");
    expect(natureDuPaiement({ metadata: { mission: M, type: "serie" } })).toBe("Réservation (série)");
    expect(natureDuPaiement({ metadata: { mission: M, serie: "hebdo" } })).toBe("Réservation (série)");
    expect(natureDuPaiement({ invoice: "in_1", metadata: {} })).toBe("Abonnement prestataire");
    expect(natureDuPaiement({ description: "Subscription creation", metadata: {} })).toBe("Abonnement prestataire");
    expect(natureDuPaiement({ metadata: {} })).toBe("Autre paiement");
  });

  it("un remboursement retrouve sa prestation par le paiement d'origine", () => {
    const l = ligneJournal({ id: "txn_3", type: "refund", amount: -7990, fee: 0, net: -7990, created: 0,
      source: { id: "re_1", object: "refund", charge: { id: "ch_1", payment_intent: "pi_1", metadata: { mission: M } }, metadata: {} } }, missions);
    expect(l).toMatchObject({ nature: "Remboursement — Réservation", montant: -79.9, prestation: M, paiement: "pi_1", frais_service: null });
  });

  it("un versement au prestataire, un virement bancaire, des frais Stripe", () => {
    expect(ligneJournal({ type: "transfer", amount: -7500, fee: 0, net: -7500, source: { id: "tr_1", metadata: { mission_id: M } } }, missions))
      .toMatchObject({ nature: "Versement prestataire", prestation: M, connue: true });
    expect(ligneJournal({ type: "payout", amount: -10000, fee: 0, net: -10000, source: "po_1" }).nature).toBe("Virement vers le compte bancaire");
    expect(ligneJournal({ type: "stripe_fee", amount: -200, fee: 0, net: -200, source: null }).nature).toBe("Frais Stripe");
    expect(ligneJournal({ type: "nouveau_type", amount: 1, fee: 0, net: 1 }).nature).toBe("Autre (nouveau_type)");
  });

  it("en mode test, une prestation absente de la base est signalée (recette et production partagent Stripe)", () => {
    const l = ligneJournal({ type: "charge", amount: 100, fee: 0, net: 100, source: { metadata: { mission: "autre" } } }, missions);
    expect(l.connue).toBe(false);
    expect(ligneJournal({ type: "payout", amount: 1, fee: 0, net: 1 }).connue).toBeNull();
  });
});

describe("les frais de service ne sont déduits que sans hypothèse", () => {
  const m = { montant_total: 79.9, tarif_horaire: 15, hours: 5 };
  it("cashback déduit du paiement", () => {
    expect(fraisServiceDeduits({ ...m, cashback_applique: 5 }, 7490)).toBe(4.9);
  });
  it("plusieurs jours", () => {
    expect(fraisServiceDeduits({ montant_total: 160.7, tarif_horaire: 15, hours: 5, date_debut: "2026-10-01 00:00:00+00", date_fin: "2026-10-02 00:00:00+00" }, 16070))
      .toBe(10.7);
  });
  it("sans prestation ou sans tarif, rien", () => {
    expect(fraisServiceDeduits(null, 100)).toBeNull();
    expect(fraisServiceDeduits({ montant_total: 10 }, 1000)).toBeNull();
  });
});

describe("totaux au centime", () => {
  it("additionne en centimes, sans erreur de virgule", () => {
    const t = totauxJournal([
      { nature: "Réservation", montant: 0.1, frais_stripe: 0.01, net: 0.09 },
      { nature: "Réservation", montant: 0.2, frais_stripe: 0.02, net: 0.18 },
      { nature: "Frais Stripe", montant: -2, frais_stripe: 0, net: -2 },
    ]);
    expect(t).toEqual([
      { nature: "Frais Stripe", nombre: 1, montant: -2, frais_stripe: 0, net: -2 },
      { nature: "Réservation", nombre: 2, montant: 0.3, frais_stripe: 0.03, net: 0.27 },
    ]);
  });
});

describe("l'action et le bouton", () => {
  it("lit le relevé par tranches, paiements dépliés, et rend une reprise", () => {
    expect(action).toContain("balance_transactions");
    expect(action).toContain("expand[]=data.source.charge");
    expect(action).toMatch(/created\[gte\]=\$\{bornes\.gte\}&created\[lt\]=\$\{bornes\.lt\}/);
    expect(action).toMatch(/suite/);
    expect(action).toMatch(/\/\^txn_/);
  });
  it("un échec Stripe ou base arrête l'export, au lieu de rendre un fichier incomplet", () => {
    expect(action).toMatch(/if \(!r\.ok\) throw/);
    expect(action.match(/status\(502\)/g)).toHaveLength(2);
  });
  it("le bouton enchaîne les tranches, signale le mode test, et ne s'arrête pas en silence", () => {
    expect(bouton).toContain('action: "export_comptable"');
    expect(bouton).toMatch(/apres = j\.suite/);
    expect(bouton).toMatch(/mode TEST/);
    expect(bouton).toMatch(/if \(apres\) throw/);
    expect(bouton).toContain("totauxJournal(lignes)");
  });
});
