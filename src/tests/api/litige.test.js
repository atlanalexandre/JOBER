import { describe, it, expect } from "vitest";

// ═══════════════════════════════════════════════════════════════════════════
// Recevabilité d'un litige (CGPS art. 17.1)
// ═══════════════════════════════════════════════════════════════════════════
//
// Le litige n'était recevable que sur une prestation déjà clôturée. Or c'est
// AVANT la validation que tout se joue : c'est elle qui déclenche le virement.
// Un client qui constatait un problème à cet instant devait valider — donc
// libérer l'argent — pour pouvoir contester ensuite.
//
// La règle du serveur est reproduite ici. Elle décide si les fonds restent
// gelés ou partent : elle mérite d'être vérifiée.

function litigeRecevable(mission) {
  const contestableAvantValidation =
    mission.status === "assigned" && mission.validation_prestataire;
  return mission.status === "completed" || Boolean(contestableAvantValidation);
}

describe("litige avant validation du client", () => {
  it("est recevable dès que le prestataire a confirmé la fin", () => {
    expect(litigeRecevable({ status: "assigned", validation_prestataire: true })).toBe(true);
  });

  it("reste recevable après clôture, dans la fenêtre de 48 h", () => {
    expect(litigeRecevable({ status: "completed", validation_prestataire: true })).toBe(true);
  });
});

describe("litige irrecevable", () => {
  it("refuse une prestation que le prestataire n'a pas confirmée", () => {
    // Rien ne prouve encore que la prestation est finie : le contester
    // reviendrait à geler des fonds sur une simple déclaration.
    expect(litigeRecevable({ status: "assigned", validation_prestataire: false })).toBe(false);
  });

  it("refuse une prestation non commencée ou annulée", () => {
    for (const status of ["open", "pending_acceptance", "cancelled", "refused", "needs_replacement"]) {
      expect(litigeRecevable({ status, validation_prestataire: true })).toBe(false);
    }
  });
});

describe("effet sur l'auto-validation", () => {
  // Le cron auto-valide les prestations `assigned` dont la date est passée.
  // Le passage en `disputed` les en fait sortir : c'est ce qui gèle les fonds.
  const autoValidable = (m) => m.status === "assigned";

  it("une prestation contestée sort du champ de l'auto-validation", () => {
    expect(autoValidable({ status: "assigned" })).toBe(true);
    expect(autoValidable({ status: "disputed" })).toBe(false);
  });
});
