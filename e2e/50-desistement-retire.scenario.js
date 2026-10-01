// L'ancien désistement `cancel_prestataire` est fermé (audit des prestations, 01/10/2026).
//
// Aucun écran ne l'appelait, mais un appel direct passait une prestation payée
// « à remplacer » en gardant l'argent du client, sans les gardes de `presta_cancel`.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, client, reservationPayee, api } from "./fabrique.js";

test.describe.configure({ timeout: 200_000 });

test("cancel_prestataire ne retire plus une prestation payée sans rembourser", async () => {
  const p = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: p, client: c, heures: 4 });
  const ok = await api("/api/missions", { action: "respond_mission", mission_id: m.id, response: "accept" }, p.jeton);
  expect(ok.statut, ok.texte.slice(0, 200)).toBe(200);
  const r = await api("/api/missions", { action: "cancel_prestataire", mission_id: m.id }, p.jeton);
  expect(r.statut, r.texte.slice(0, 200)).toBe(410);
  const [l] = await sql(`select status, prestataire_id from missions where id = '${m.id}'`);
  expect(l.status).toBe("assigned");
  expect(l.prestataire_id).toBe(p.id);
});
