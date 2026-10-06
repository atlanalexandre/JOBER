// Heures supplémentaires sur une prestation de PLUSIEURS JOURS (06/10/2026).
//
// Décision d'Alexandre : une heure supplémentaire vaut pour UNE journée, celle
// en cours. Pour changer l'horaire de plusieurs journées, le client modifie la
// commande — pour les journées pas encore commencées, en hausse seulement.
//
// Avant, une heure demandée le dernier jour d'une série de cinq était facturée
// cinq fois, journées déjà faites comprises.

import { describe, it, expect } from "vitest";
import {
  prixHeuresSupp, surPlusieursJours, joursDeLaPrestation, porteeDemande, joursFactures,
  journeesCouvertes, cumulsAjouts, ajoutsNonFaits, detailAjouts,
} from "../../../api/_heures_supp.js";
import { montantsDeCloture } from "../../../api/_cloture.js";
import { finPrestationMs, debutPrestationMs } from "../../../api/_temps.js";
import { nombreDeJours } from "../../../api/_montant.js";

// Du lundi 12 au vendredi 16 octobre 2026, 9 h – 13 h (heure de Paris).
const SERIE = {
  date: null, date_debut: "2026-10-12 00:00:00+00", date_fin: "2026-10-16 00:00:00+00",
  heure_debut: "09:00", hours: 4, tarif_horaire: 20,
};
const a = (jour, hhmm) => debutPrestationMs(jour, hhmm);

describe("les journées de la prestation", () => {
  it("une série de cinq jours compte cinq journées, chacune de 9 h à 13 h", () => {
    const j = joursDeLaPrestation(SERIE);
    expect(j.map(x => x.jour)).toEqual(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"]);
    expect(j[0].finMs - j[0].debutMs).toBe(4 * 3600000);
    expect(surPlusieursJours(SERIE)).toBe(true);
  });

  it("une prestation d'un jour n'est pas « sur plusieurs jours »", () => {
    expect(surPlusieursJours({ date: "2026-10-12", heure_debut: "09:00", hours: 4 })).toBe(false);
  });

  it("le dernier jour finit plus tard quand des heures lui ont été ajoutées", () => {
    const j = joursDeLaPrestation({ ...SERIE, heures_ajoutees_dernier_jour: 2 });
    expect(j[4].finMs - j[4].debutMs).toBe(6 * 3600000);
    expect(j[3].finMs - j[3].debutMs).toBe(4 * 3600000);
    expect(finPrestationMs({ ...SERIE, heures_ajoutees_dernier_jour: 2 })).toBe(j[4].finMs);
  });
});

describe("heures supplémentaires : la journée en cours seulement", () => {
  it("le mercredi à 12 h, la demande porte sur un seul jour", () => {
    const p = porteeDemande(SERIE, "jour", a("2026-10-14", "12:00"));
    expect(p).toMatchObject({ ok: true, portee: "jour", jours: 1, dernierJour: false, journee: "2026-10-14" });
  });

  it("jusqu'à 20 minutes après la fin de la journée, pas au-delà", () => {
    expect(porteeDemande(SERIE, "jour", a("2026-10-14", "13:19")).ok).toBe(true);
    expect(porteeDemande(SERIE, "jour", a("2026-10-14", "13:21")).ok).toBe(false);
  });

  it("entre deux journées, elle est refusée et renvoie vers la modification de la commande", () => {
    const p = porteeDemande(SERIE, "jour", a("2026-10-14", "20:00"));
    expect(p.ok).toBe(false);
    expect(p.detail).toMatch(/modifiez la commande/);
  });

  it("le vendredi, la journée en cours est la dernière", () => {
    expect(porteeDemande(SERIE, "jour", a("2026-10-16", "10:00")).dernierJour).toBe(true);
  });
});

describe("modifier la commande : les journées pas encore commencées", () => {
  it("le mercredi à 12 h, jeudi et vendredi sont modifiables", () => {
    const p = porteeDemande(SERIE, "commande", a("2026-10-14", "12:00"));
    expect(p).toMatchObject({ ok: true, portee: "commande", jours: 2, dernierJour: true, journee: "2026-10-15" });
  });

  it("avant le début, toute la série est modifiable", () => {
    expect(porteeDemande(SERIE, "commande", a("2026-10-11", "12:00")).jours).toBe(5);
  });

  it("une journée commencée n'est plus modifiable", () => {
    expect(porteeDemande(SERIE, "commande", a("2026-10-15", "09:00")).jours).toBe(1);
  });

  it("le vendredi en cours, il n'y a plus rien à modifier", () => {
    const p = porteeDemande(SERIE, "commande", a("2026-10-16", "10:00"));
    expect(p.ok).toBe(false);
    expect(p.detail).toMatch(/heures supplémentaires/);
  });

  it("un horaire illisible ne laisse rien chiffrer", () => {
    expect(porteeDemande({ ...SERIE, heure_debut: "xx" }, "commande", a("2026-10-11", "12:00")).ok).toBe(false);
  });
});

describe("ce qui est facturé", () => {
  it("1 h demandée le vendredi est payée une fois, pas cinq", () => {
    const m = { ...SERIE, extra_hours_jours: 1 };
    expect(nombreDeJours(m)).toBe(5);
    expect(joursFactures(m, nombreDeJours(m))).toBe(1);
    expect(prixHeuresSupp(1, 20, joursFactures(m, nombreDeJours(m))).partPrestataire).toBe(20);
  });

  it("une modification pour deux journées est payée deux fois", () => {
    const m = { ...SERIE, extra_hours_jours: 2 };
    expect(prixHeuresSupp(1, 20, joursFactures(m, nombreDeJours(m))).partPrestataire).toBe(40);
  });

  it("une demande antérieure, sans portée figée, garde l'ancien calcul", () => {
    expect(joursFactures({ ...SERIE }, 5)).toBe(5);
    expect(joursFactures({ ...SERIE, extra_hours_jours: null }, 5)).toBe(5);
  });
});

describe("la clôture verse les heures ajoutées à certaines journées", () => {
  // 5 × 4 h × 20 € = 400 €, plus 2 h × 2 journées à 25 €/h = 100 € ajoutés.
  const base = { ...SERIE, actual_hours: null };
  it("la part du prestataire compte le montant ajouté", () => {
    const sans = montantsDeCloture({ ...base, montant_total: 480 });
    const avec = montantsDeCloture({ ...base, montant_total: 600, montant_heures_ajoutees: 100 });
    expect(avec.partPrestataire).toBeCloseTo(sans.partPrestataire + 100, 2);
  });

  it("les frais de service ne sont pas gonflés par l'ajout", () => {
    const sans = montantsDeCloture({ ...base, montant_total: 480 });
    const avec = montantsDeCloture({ ...base, montant_total: 600, montant_heures_ajoutees: 100 });
    // 120 € encaissés de plus pour 100 € de prestation : 20 € de frais en plus.
    expect(avec.fraisService).toBeCloseTo(sans.fraisService + 20, 2);
  });
});

describe("le détail, journée par journée", () => {
  it("une modification pour deux journées couvre les deux DERNIÈRES", () => {
    expect(journeesCouvertes(SERIE, "commande", 2)).toEqual(["2026-10-15", "2026-10-16"]);
  });
  it("des heures du jour couvrent la journée de la demande", () => {
    expect(journeesCouvertes(SERIE, "jour", 1, "2026-10-14")).toEqual(["2026-10-14"]);
  });
  it("les cumuls se recalculent depuis le détail", () => {
    const detail = [
      { jour: "2026-10-14", heures: 1, tarif: 20, paiement: "pi_a" },
      { jour: "2026-10-15", heures: 2, tarif: 25, paiement: "pi_b" },
      { jour: "2026-10-16", heures: 2, tarif: 25, paiement: "pi_b" },
    ];
    expect(cumulsAjouts(SERIE, detail)).toMatchObject({ heures_ajoutees_total: 5, heures_ajoutees_dernier_jour: 2 });
  });
  it("un détail illisible devient un tableau vide", () => {
    expect(detailAjouts({ heures_ajoutees_detail: null })).toEqual([]);
    expect(detailAjouts({ heures_ajoutees_detail: [{ jour: "", heures: 2 }, { jour: "2026-10-14", heures: 0 }] })).toEqual([]);
  });
});

describe("arrêter une série rend les heures ajoutées qui ne seront pas faites", () => {
  // Mercredi : 1 h ajoutée aujourd'hui (20 €/h, pi_a) ; jeudi et vendredi,
  // commande modifiée de +2 h (25 €/h, pi_b).
  const m = { ...SERIE, heures_ajoutees_detail: [
    { jour: "2026-10-14", heures: 1, tarif: 20, paiement: "pi_a" },
    { jour: "2026-10-15", heures: 2, tarif: 25, paiement: "pi_b" },
    { jour: "2026-10-16", heures: 2, tarif: 25, paiement: "pi_b" },
  ] };
  const base = { aujourdHui: "2026-10-14", heuresBase: 4, dejaEcourtee: false };

  it("tout arrêter après 3 h : l'heure du jour et les quatre heures à venir", () => {
    const r = ajoutsNonFaits(m, { ...base, heuresFaites: 3, annulerReste: true });
    expect(r.valeur).toBe(120);                       // 20 + 2 × 50
    expect(r.parPaiement).toEqual({ pi_a: 20, pi_b: 100 });
    expect(r.detail).toEqual([]);
  });

  it("tout arrêter après 5 h : l'heure du jour est faite, elle reste due", () => {
    const r = ajoutsNonFaits(m, { ...base, heuresFaites: 5, annulerReste: true });
    expect(r.valeur).toBe(100);
    expect(r.parPaiement).toEqual({ pi_b: 100 });
    expect(r.detail).toEqual([{ jour: "2026-10-14", heures: 1, tarif: 20, paiement: "pi_a" }]);
  });

  it("écourter seulement aujourd'hui garde jeudi et vendredi", () => {
    const r = ajoutsNonFaits(m, { ...base, heuresFaites: 2, annulerReste: false });
    expect(r.valeur).toBe(20);
    expect(r.detail.map(l => l.jour)).toEqual(["2026-10-15", "2026-10-16"]);
  });

  it("une journée déjà écourtée n'est pas comptée deux fois", () => {
    const r = ajoutsNonFaits(m, { ...base, heuresFaites: 2, annulerReste: true, dejaEcourtee: true });
    expect(r.valeur).toBe(100);
  });

  it("sans heures ajoutées, rien à rendre", () => {
    expect(ajoutsNonFaits(SERIE, { ...base, heuresFaites: 1, annulerReste: true }).valeur).toBe(0);
  });
});

import { dureeMaxDesJournees } from "../../../api/_heures_supp.js";

describe("le plafond de 24 h se juge sur la journée, ajouts compris", () => {
  const m = { ...SERIE, hours: 10, heures_ajoutees_detail: [
    { jour: "2026-10-14", heures: 8, tarif: 20, paiement: "pi_a" },
    { jour: "2026-10-15", heures: 2, tarif: 20, paiement: "pi_b" },
  ] };
  it("le mercredi compte déjà 18 h : 8 h de plus dépasseraient 24 h", () => {
    expect(dureeMaxDesJournees(m, ["2026-10-14"])).toBe(18);
    expect(dureeMaxDesJournees(m, ["2026-10-14"]) + 8 > 24).toBe(true);
  });
  it("une modification de commande se juge sur la journée la plus chargée", () => {
    expect(dureeMaxDesJournees(m, ["2026-10-15", "2026-10-16"])).toBe(12);
  });
  it("sans ajout, la durée prévue", () => {
    expect(dureeMaxDesJournees(SERIE, ["2026-10-14"])).toBe(4);
  });
});
