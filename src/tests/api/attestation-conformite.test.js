// L'attestation de conformité remise au client.
//
// Ce que le client doit pouvoir PROUVER, et non affirmer. L'article L8222-1 du
// Code du travail n'impose la vigilance qu'à partir de 5 000 € HT ; en
// dessous, le donneur d'ordre n'a rien à vérifier — mais il reste exposé à la
// solidarité financière de l'article L8222-2 s'il a fermé les yeux sur un
// travail dissimulé. ALANE vérifie de toute façon : encore faut-il que le
// client reparte avec une trace.
//
// Deux règles gouvernent ce document, et ce sont elles qui sont éprouvées ici :
//
//   1. la validité s'apprécie AU JOUR DE LA PRESTATION, pas au jour où
//      l'attestation est tirée — sans quoi une pièce expirée depuis effacerait
//      une prestation qui s'est pourtant déroulée régulièrement ;
//   2. aucune pièce ne circule : seulement les dates et le constat.
import { describe, it, expect } from "vitest";

// Reproduction de la règle de `api/missions.js`, action attestation_conformite.
const etatPiece = (doc, jour) => {
  const verifieLe = doc?.verified && doc.verified_at ? String(doc.verified_at).slice(0, 10) : null;
  const expireLe  = doc?.expires_at ? String(doc.expires_at).slice(0, 10) : null;
  return {
    verifie_le: verifieLe,
    expire_le: expireLe,
    valide: !!verifieLe && verifieLe <= jour && (!expireLe || expireLe >= jour),
  };
};

const urssaf = (extra) => ({ type: "urssaf", verified: true, verified_at: "2026-01-10", expires_at: "2026-07-10", ...extra });

describe("la validité s'apprécie au jour de la prestation", () => {
  it("vaut pour une prestation pendant la période de validité", () => {
    expect(etatPiece(urssaf(), "2026-03-15").valide).toBe(true);
  });

  it("vaut encore le dernier jour de validité", () => {
    expect(etatPiece(urssaf(), "2026-07-10").valide).toBe(true);
  });

  it("ne vaut pas le lendemain de l'expiration", () => {
    expect(etatPiece(urssaf(), "2026-07-11").valide).toBe(false);
  });

  it("ne vaut pas pour une prestation ANTÉRIEURE à la vérification", () => {
    // Le prestataire a déposé sa pièce après être intervenu : l'attestation ne
    // peut pas couvrir rétroactivement ce jour-là.
    expect(etatPiece(urssaf(), "2026-01-05").valide).toBe(false);
  });

  it("reste vraie pour une prestation passée même si la pièce a expiré depuis", () => {
    // C'est le point décisif : le client garde la preuve de ce qui était vrai
    // le jour où le prestataire est venu.
    const jourDeLaPrestation = "2026-03-15";
    expect(etatPiece(urssaf(), jourDeLaPrestation).valide).toBe(true);
  });
});

describe("les pièces sans échéance", () => {
  it("restent valides tant qu'elles sont vérifiées", () => {
    const kbis = { type: "kbis", verified: true, verified_at: "2026-02-01", expires_at: null };
    expect(etatPiece(kbis, "2027-12-31").valide).toBe(true);
  });
});

describe("une pièce non vérifiée", () => {
  it("n'est jamais valide, même déposée", () => {
    expect(etatPiece({ type: "rc_pro", verified: false, verified_at: null, expires_at: "2027-01-01" }, "2026-05-01").valide).toBe(false);
  });

  it("n'est jamais valide si elle est absente", () => {
    expect(etatPiece(undefined, "2026-05-01").valide).toBe(false);
  });
});

describe("ce que l'attestation ne contient pas", () => {
  it("ne rend ni chemin de fichier, ni contenu de pièce", () => {
    const rendu = etatPiece(urssaf({ file_path: "abc/urssaf", url: "https://…" }), "2026-03-15");
    expect(Object.keys(rendu).sort()).toEqual(["expire_le", "valide", "verifie_le"]);
  });
});
