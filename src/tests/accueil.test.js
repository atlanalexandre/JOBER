// L'accueil client affichait deux blocs — « à valider » et « en cours » — et
// laissait un trou entre les deux : une prestation réservée pour demain
// n'apparaissait nulle part. Il fallait ouvrir « Prestations », puis l'onglet
// « Assignées », pour la retrouver.
//
// Ces tests portent sur les dates de bord, qui ne se vérifient pas en cliquant :
// une prestation qui vient de commencer, une qui vient de finir, une prolongée
// au-delà de son créneau.

import { describe, it, expect } from "vitest";
import { etatAccueil, debutMs, finMs } from "../lib/accueil.js";

const H = 3600000;
// Heure locale du navigateur, comme le fait le composant.
const localIso = (ms) => {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
    heure_debut: `${p(d.getHours())}:${p(d.getMinutes())}`,
  };
};
const MAINTENANT = new Date("2026-08-17T12:00:00").getTime();
const presta = (decalageMs, extra = {}) => ({
  id: `m${decalageMs}`, status: "assigned", hours: 2,
  ...localIso(MAINTENANT + decalageMs), ...extra,
});

describe("horaires", () => {
  it("lit le début et la fin depuis la date et l'heure", () => {
    const m = presta(0);
    expect(debutMs(m)).toBeCloseTo(MAINTENANT, -4);
    expect(finMs(m) - debutMs(m)).toBe(2 * H);
  });

  // Le select d'origine oubliait `actual_hours` : une prestation prolongée
  // disparaissait de l'accueil avant d'être finie.
  it("la durée réelle prime sur la durée prévue", () => {
    const m = presta(0, { hours: 2, actual_hours: 5 });
    expect(finMs(m) - debutMs(m)).toBe(5 * H);
  });

  it("une date illisible ne produit pas d'instant", () => {
    expect(debutMs({ date: "n'importe quoi" })).toBe(0);
    expect(debutMs({})).toBe(0);
    expect(finMs({})).toBe(0);
  });
});

describe("prestation à venir", () => {
  it("remonte celle qui n'a pas encore commencé", () => {
    const { prochaine } = etatAccueil([presta(3 * H)], MAINTENANT);
    expect(prochaine).not.toBeNull();
  });

  it("retient la plus proche quand il y en a plusieurs", () => {
    const { prochaine } = etatAccueil([presta(48 * H), presta(3 * H), presta(24 * H)], MAINTENANT);
    expect(prochaine.id).toBe(`m${3 * H}`);
  });

  // Le client a payé et attend une réponse : c'est précisément le moment où il
  // a besoin de voir sa prestation.
  it("inclut une prestation en attente d'acceptation", () => {
    const { prochaine } = etatAccueil([presta(3 * H, { status: "pending_acceptance" })], MAINTENANT);
    expect(prochaine?.status).toBe("pending_acceptance");
  });

  it("ignore une prestation déjà commencée", () => {
    const { prochaine } = etatAccueil([presta(-H)], MAINTENANT);
    expect(prochaine).toBeNull();
  });

  it("ignore les prestations closes, annulées ou en litige", () => {
    const closes = ["completed", "cancelled", "closed", "disputed", "refused"]
      .map(st => presta(3 * H, { status: st }));
    expect(etatAccueil(closes, MAINTENANT).prochaine).toBeNull();
  });
});

describe("prestation en cours", () => {
  it("compte celle dont le créneau court", () => {
    const { enCours } = etatAccueil([presta(-H)], MAINTENANT);
    expect(enCours).toHaveLength(1);
  });

  it("ne compte plus celle dont le créneau est écoulé", () => {
    const { enCours } = etatAccueil([presta(-3 * H)], MAINTENANT);
    expect(enCours).toHaveLength(0);
  });

  it("compte encore celle qui a été prolongée", () => {
    // Commencée il y a 3 h, prévue pour 2 h, réellement 5 h.
    const { enCours } = etatAccueil([presta(-3 * H, { hours: 2, actual_hours: 5 })], MAINTENANT);
    expect(enCours).toHaveLength(1);
  });
});

// Sans cette exclusion, une prestation dont le prestataire a confirmé la fin
// serait comptée à la fois « à valider » et « en cours » tant que son créneau
// n'est pas écoulé : le client verrait deux blocs se contredire.
describe("les trois états sont exclusifs", () => {
  const confirmee = presta(-H, { validation_prestataire: true });

  it("une prestation à valider n'est pas aussi « en cours »", () => {
    const { aValider, enCours, prochaine } = etatAccueil([confirmee], MAINTENANT);
    expect(aValider).toHaveLength(1);
    expect(enCours).toHaveLength(0);
    expect(prochaine).toBeNull();
  });

  it("une prestation à valider n'est pas non plus « à venir »", () => {
    const { aValider, prochaine } = etatAccueil(
      [presta(3 * H, { validation_prestataire: true })], MAINTENANT
    );
    expect(prochaine).toBeNull();
    // Elle n'est pas « à valider » non plus : son créneau n'a pas commencé.
    expect(aValider).toHaveLength(1);
  });
});

describe("robustesse", () => {
  it("une liste absente ne fait rien planter", () => {
    for (const v of [null, undefined, {}, "x"]) {
      const e = etatAccueil(v, MAINTENANT);
      expect(e.aValider).toEqual([]);
      expect(e.enCours).toEqual([]);
      expect(e.prochaine).toBeNull();
    }
  });
});

// Le pointage réel fait foi quand il existe : une prestation commencée avec du
// retard finit avec du retard. C'est la règle du serveur (`finPrestationMs`) ;
// la reproduire différemment ici ferait diverger l'écran et la base sur la
// question de savoir quand une prestation est finie — et c'est cette fin qui
// ferme la fenêtre des heures supplémentaires.
describe("la fin suit le pointage réel", () => {
  it("part du démarrage déclaré plutôt que de l'horaire prévu", () => {
    const prevu = presta(0, { hours: 2 });
    const retarde = { ...prevu, started_at: new Date(MAINTENANT + 3600000).toISOString() };
    expect(finMs(retarde) - finMs(prevu)).toBe(3600000);
  });

  it("retombe sur l'horaire prévu sans pointage", () => {
    const m = presta(0, { hours: 2 });
    expect(finMs(m)).toBeCloseTo(debutMs(m) + 2 * H, -4);
  });

  it("un pointage illisible ne fait pas perdre la fin prévue", () => {
    const m = presta(0, { hours: 2, started_at: "n'importe quoi" });
    expect(finMs(m)).toBeCloseTo(debutMs(m) + 2 * H, -4);
  });
});
