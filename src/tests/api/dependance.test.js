import { describe, it, expect } from "vitest";
import { couplesADependance, etalementSemaines, SEUILS_PAR_DEFAUT } from "../../../api/_dependance.js";

// ═══════════════════════════════════════════════════════════════════════════
// Vigilance sur la dépendance économique (CGPS art. 10D)
// ═══════════════════════════════════════════════════════════════════════════
//
// Le cas visé : un auto-entrepreneur qui travaille cinq jours par semaine,
// pendant plusieurs mois, pour un seul client. C'est le premier motif de
// requalification devant l'URSSAF.
//
// Deux erreurs coûtent cher ici, et pas de la même façon. Ne pas détecter, c'est
// laisser prospérer la situation qu'on prétend surveiller. Détecter à tort,
// c'est envoyer une demande de justificatifs à un professionnel qui n'a rien à
// se reprocher — et user la crédibilité du dispositif.

// Fabrique des prestations à jours distincts, à partir d'une date de départ.
function serie({ presta, client, n, montant = 100, depart = "2026-01-05", pasJours = 1 }) {
  const t0 = new Date(depart + "T12:00:00Z").getTime();
  return Array.from({ length: n }, (_, i) => ({
    prestataire_id: presta,
    client_id: client,
    montant,
    date: new Date(t0 + i * pasJours * 86400000).toISOString().slice(0, 10),
  }));
}

describe("etalementSemaines", () => {
  it("rend 0 pour une seule date", () => {
    expect(etalementSemaines(["2026-01-05"])).toBe(0);
  });
  it("compte les semaines entre la première et la dernière", () => {
    expect(etalementSemaines(["2026-01-05", "2026-03-02"])).toBe(8);
  });
  it("ignore les dates illisibles", () => {
    expect(etalementSemaines(["pas une date", "2026-01-05"])).toBe(0);
  });
});

describe("aucun signal quand il n'y a rien à signaler", () => {
  it("ne signale rien sur une liste vide", () => {
    expect(couplesADependance([])).toEqual([]);
    expect(couplesADependance(null)).toEqual([]);
  });

  it("ne signale pas un prestataire sous le seuil de prestations", () => {
    // 100 % du chiffre d'affaires, mais 5 prestations seulement : un
    // professionnel qui démarre a mécaniquement un seul client.
    const p = serie({ presta: "p1", client: "c1", n: 5 });
    expect(couplesADependance(p)).toEqual([]);
  });

  it("ne signale pas un prestataire aux clients bien répartis", () => {
    const p = [
      ...serie({ presta: "p1", client: "c1", n: 10, montant: 100 }),
      ...serie({ presta: "p1", client: "c2", n: 10, montant: 100, depart: "2026-02-05" }),
      ...serie({ presta: "p1", client: "c3", n: 10, montant: 100, depart: "2026-03-05" }),
    ];
    // 33 % chacun, et pas assez de jours distincts par client pour la régularité.
    expect(couplesADependance(p)).toEqual([]);
  });

  it("ne signale pas un chantier intensif mais court", () => {
    // 24 jours consécutifs, mais étalés sur 3 semaines : c'est un chantier,
    // pas un poste. La part de CA reste sous le seuil grâce à un autre client.
    const p = [
      ...serie({ presta: "p1", client: "c1", n: 24, montant: 100 }),
      ...serie({ presta: "p1", client: "c2", n: 30, montant: 200, depart: "2026-04-01" }),
    ];
    const s = couplesADependance(p);
    expect(s.find(x => x.client_id === "c1")).toBeUndefined();
  });
});

describe("dépendance économique — part du chiffre d'affaires", () => {
  it("signale un prestataire dont un client fait l'essentiel du chiffre", () => {
    const p = [
      ...serie({ presta: "p1", client: "c1", n: 10, montant: 300 }),   // 3000 €
      ...serie({ presta: "p1", client: "c2", n: 4, montant: 100, depart: "2026-05-01" }), // 400 €
    ];
    const s = couplesADependance(p);
    const signal = s.find(x => x.client_id === "c1");
    expect(signal).toBeDefined();
    expect(signal.motifs).toContain("part_ca");
    expect(signal.part_ca_pct).toBeCloseTo(88.2, 0);
  });

  it("le dénominateur est le chiffre total du prestataire, pas celui du client", () => {
    const p = [
      ...serie({ presta: "p1", client: "c1", n: 10, montant: 100 }),
      ...serie({ presta: "p2", client: "c1", n: 10, montant: 100 }),
    ];
    // c1 commande beaucoup, mais à deux professionnels : chacun est à 100 %
    // de SON chiffre avec c1, ce qui est bien le signal recherché.
    const s = couplesADependance(p);
    expect(s).toHaveLength(2);
    expect(s.every(x => x.part_ca_pct === 100)).toBe(true);
  });

  it("suit le seuil fourni plutôt que la valeur par défaut", () => {
    const p = [
      ...serie({ presta: "p1", client: "c1", n: 10, montant: 100 }),   // 1000 €
      ...serie({ presta: "p1", client: "c2", n: 10, montant: 100, depart: "2026-06-01" }), // 1000 €
    ];
    // 50 % chacun : sous le seuil par défaut de 60 %, au-dessus d'un seuil de 40 %.
    expect(couplesADependance(p).length).toBe(0);
    expect(couplesADependance(p, { part_ca_pct: 40 }).length).toBe(2);
  });
});

describe("intégration durable — régularité dans la durée", () => {
  it("signale cinq jours par semaine pendant deux mois", () => {
    // 40 jours distincts étalés sur environ 8 semaines.
    const p = [
      ...serie({ presta: "p1", client: "c1", n: 40, montant: 100, pasJours: 1.5 }),
      ...serie({ presta: "p1", client: "c2", n: 60, montant: 500, depart: "2026-06-01" }),
    ];
    const signal = couplesADependance(p).find(x => x.client_id === "c1");
    expect(signal).toBeDefined();
    expect(signal.motifs).toContain("regularite");
  });

  it("exige à la fois le nombre de jours ET l'étalement", () => {
    // 30 jours mais tous dans le même mois : pas de signal de régularité.
    const p = [
      ...serie({ presta: "p1", client: "c1", n: 30, montant: 100 }),
      ...serie({ presta: "p1", client: "c2", n: 60, montant: 500, depart: "2026-06-01" }),
    ];
    const signal = couplesADependance(p).find(x => x.client_id === "c1");
    expect(signal).toBeUndefined();
  });
});

describe("classement des signaux", () => {
  it("place en tête ceux qui cumulent les deux indices", () => {
    const p = [
      // p1/c1 : part de CA écrasante ET régularité longue
      ...serie({ presta: "p1", client: "c1", n: 40, montant: 200, pasJours: 1.5 }),
      // p2/c2 : seulement la part de CA
      ...serie({ presta: "p2", client: "c2", n: 10, montant: 100 }),
    ];
    const s = couplesADependance(p);
    expect(s[0].motifs).toHaveLength(2);
    expect(s[0].prestataire_id).toBe("p1");
  });
});

describe("les seuils par défaut restent explicites", () => {
  it("expose des valeurs lisibles et modifiables", () => {
    expect(SEUILS_PAR_DEFAUT.part_ca_pct).toBe(60);
    expect(SEUILS_PAR_DEFAUT.min_prestations_client).toBe(8);
    expect(SEUILS_PAR_DEFAUT.min_jours_distincts).toBe(24);
    expect(SEUILS_PAR_DEFAUT.min_semaines_ecart).toBe(8);
  });
});
