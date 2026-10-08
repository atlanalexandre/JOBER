// Catalogue public : prénom et initiale du nom ; nom complet au seul client qui a réservé
// (décision d'Alexandre du 28/09/2026).
import { test, expect } from "@playwright/test";
import { appelApi } from "./outils.js";
import { prestataireOperationnel, client, api, reservationPayee } from "./fabrique.js";

test.describe.configure({ timeout: 180_000 });

test("le catalogue ne donne que l'initiale ; le client de la prestation, et lui seul, voit le nom complet", async () => {
  const p = await prestataireOperationnel();
  const c = await client();
  const intrus = await client();

  // Le catalogue, SANS compte — ce que voit n'importe quel visiteur.
  const r = await appelApi(`/api/prestataires?frais=${Date.now()}`);
  expect(r.statut, `catalogue : ${r.texte.slice(0, 200)}`).toBe(200);
  const { prestataires } = r.json;
  const fiche = prestataires.find(x => x.id === p.id);
  expect(fiche, "le prestataire opérationnel est au catalogue").toBeTruthy();
  expect(fiche.nom).toBe("R.");
  expect(fiche.name).toBe("Sam R.");
  expect(JSON.stringify(fiche)).not.toContain("Recette");

  const m = await reservationPayee({ prestataire: p, client: c });
  const id = await api("/api/missions", { action: "identite_prestataire", mission_id: m.id }, c.jeton);
  expect(id.statut, id.texte.slice(0, 200)).toBe(200);
  expect(id.json.nom).toBe("Recette");
  expect(id.json.prenom).toBe("Sam");
  expect((await api("/api/missions", { action: "identite_prestataire", mission_id: m.id }, intrus.jeton)).statut, "un autre client").toBe(404);
  expect((await api("/api/missions", { action: "identite_prestataire", mission_id: m.id }, p.jeton)).statut, "réservé au client").toBe(404);
});
