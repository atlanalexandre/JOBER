// Supprimer un compte effaçait les sommes qu'il devait à ALANE (étude du
// 13/10/2026). Ni l'utilisateur ni le back-office ne peuvent plus le faire tant
// qu'une somme due est active ou contestée : on la règle ou on la tranche d'abord.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, api, bo } from "./fabrique.js";

test.describe.configure({ timeout: 180_000 });

test("somme due ouverte : suppression refusée des deux côtés, rien d'effacé", async () => {
  const p = await prestataireOperationnel();
  await sql(`insert into creances_prestataires (prestataire_id, montant_initial, montant_restant, motif, statut)
             values ('${p.id}', 25, 25, 'Scénario 83', 'contestee')`);

  const moi = await api("/api/support", { action: "delete_account" }, p.jeton);
  expect(moi.statut, moi.texte.slice(0, 200)).toBe(409);
  expect(moi.json?.error).toMatch(/25,00\s€ reste due/);

  const parBo = await bo("delete", { profileId: p.id, reason: "Scénario 83" });
  expect(parBo.statut, parBo.texte.slice(0, 200)).toBe(409);
  expect(parBo.json?.error).toMatch(/doit encore 25,00\s€/);

  const [compte] = await sql(`select count(*)::int n from auth.users where id = '${p.id}'`);
  expect(compte.n, "le compte existe toujours").toBe(1);
  const [dette] = await sql(`select count(*)::int n from creances_prestataires where prestataire_id = '${p.id}'`);
  expect(dette.n, "la somme due est intacte").toBe(1);
});
