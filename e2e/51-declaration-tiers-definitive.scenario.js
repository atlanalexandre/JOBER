// La déclaration d'intervention chez un tiers ne se réécrit pas (audit des prestations, 01/10/2026).
//
// Elle décide de ce qu'un refus déclenche — candidat suivant ou remboursement — et a
// valeur de preuve (CGPS art. 10B). Elle se réécrivait à tout moment, même payée.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, client, reservationPayee, api } from "./fabrique.js";

test.describe.configure({ timeout: 200_000 });

test("après le paiement, la déclaration ne change plus", async () => {
  const p = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: p, client: c, heures: 4, declaration: { lieu: "etablissement_propre" } });
  const r = await api("/api/missions", { action: "declarer_tiers", mission_id: m.id, declaration: {
    beneficiaire: "Hôtel Recette", service_vendu: "Ménage", perimetre: "Chambres", livrable: "Chambres faites", organisateur: "Client recette",
  } }, c.jeton);
  expect(r.statut, r.texte.slice(0, 200)).toBe(409);
  const [l] = await sql(`select tiers_declaration from missions where id = '${m.id}'`);
  expect(l.tiers_declaration.lieu).toBe("etablissement_propre");
});
