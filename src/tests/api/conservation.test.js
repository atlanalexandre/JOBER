import { describe, it, expect } from "vitest";
import {
  aPurger, etatRcPro, TYPES_A_PURGER,
  DELAI_APRES_VERIFICATION_JOURS, PLAFOND_DEPUIS_DEPOT_MOIS,
} from "../../../api/_conservation.js";

const JOUR = 86400000;
const MAINTENANT = Date.UTC(2026, 7, 14, 12, 0, 0); // 14 août 2026
const ilYA = (jours) => new Date(MAINTENANT - jours * JOUR).toISOString();

const doc = (o = {}) => ({
  type: "cni", verified: false, verified_at: null,
  created_at: ilYA(1), purged_at: null, ...o,
});

describe("aPurger", () => {
  it("ne touche pas une pièce déposée hier", () => {
    expect(aPurger(doc(), MAINTENANT).purger).toBe(false);
  });

  it("purge une pièce vérifiée depuis plus de trente jours", () => {
    const r = aPurger(doc({ verified: true, verified_at: ilYA(31), created_at: ilYA(60) }), MAINTENANT);
    expect(r.purger).toBe(true);
    expect(r.cause).toBe("verification");
  });

  it("attend les trente jours — à vingt-neuf, on ne touche à rien", () => {
    expect(aPurger(doc({ verified: true, verified_at: ilYA(29), created_at: ilYA(40) }), MAINTENANT).purger).toBe(false);
    expect(DELAI_APRES_VERIFICATION_JOURS).toBe(30);
  });

  it("purge au bout de douze mois même sans vérification", () => {
    // Une pièce jamais vérifiée n'a jamais servi : la garder est le pire des cas.
    const r = aPurger(doc({ verified: false, created_at: "2025-08-13T00:00:00Z" }), MAINTENANT);
    expect(r.purger).toBe(true);
    expect(r.cause).toBe("plafond");
    expect(PLAFOND_DEPUIS_DEPOT_MOIS).toBe(12);
  });

  it("compte les douze mois en mois calendaires, pas en 365 jours", () => {
    // Déposée le 14 août 2025 : le plafond tombe le 14 août 2026, pas le 13.
    expect(aPurger(doc({ created_at: "2025-08-14T12:00:00Z" }), MAINTENANT).purger).toBe(true);
    expect(aPurger(doc({ created_at: "2025-08-15T12:00:00Z" }), MAINTENANT).purger).toBe(false);
  });

  it("ne purge que les pièces d'identité", () => {
    expect(TYPES_A_PURGER).toEqual(["cni", "kbis", "domicile"]);
    for (const type of ["rib", "rc_pro", "urssaf", "photo", "diplomes", "tva", "autre"]) {
      const r = aPurger(doc({ type, verified: true, verified_at: ilYA(400), created_at: ilYA(400) }), MAINTENANT);
      expect(r.purger, `${type} ne doit pas être purgé`).toBe(false);
    }
  });

  it("ne repurge pas une pièce déjà supprimée", () => {
    expect(aPurger(doc({ verified: true, verified_at: ilYA(400), created_at: ilYA(400), purged_at: ilYA(10) }), MAINTENANT).purger).toBe(false);
  });

  it("ne tombe pas sur une date illisible", () => {
    expect(aPurger(doc({ created_at: "pas-une-date" }), MAINTENANT).purger).toBe(false);
    expect(aPurger(doc({ verified: true, verified_at: "n'importe quoi", created_at: ilYA(1) }), MAINTENANT).purger).toBe(false);
  });
});

describe("etatRcPro", () => {
  const dans = (jours) => new Date(MAINTENANT + jours * JOUR).toISOString().slice(0, 10);

  it("rend « inconnue » sans date de validité", () => {
    expect(etatRcPro(null, MAINTENANT)).toBe("inconnue");
    expect(etatRcPro("", MAINTENANT)).toBe("inconnue");
  });

  it("rend « valide » loin de l'échéance", () => {
    expect(etatRcPro(dans(90), MAINTENANT)).toBe("valide");
  });

  it("prévient trente jours avant", () => {
    expect(etatRcPro(dans(20), MAINTENANT)).toBe("bientot_expiree");
    expect(etatRcPro(dans(31), MAINTENANT)).toBe("valide");
  });

  it("couvre la dernière journée entière de validité", () => {
    // Une attestation valable « jusqu'au 14 août » l'est encore le 14 à midi.
    expect(etatRcPro("2026-08-14", MAINTENANT)).toBe("bientot_expiree");
    expect(etatRcPro("2026-08-13", MAINTENANT)).toBe("expiree");
  });

  it("ne devient suspendable qu'après trente jours de tolérance", () => {
    expect(etatRcPro(dans(-29), MAINTENANT)).toBe("expiree");
    expect(etatRcPro(dans(-31), MAINTENANT)).toBe("suspendable");
  });
});
