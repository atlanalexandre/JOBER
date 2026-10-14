// Une prestation validée AUTOMATIQUEMENT compte au quota du mois (étude du
// 14/10/2026). Seule la validation par le client comptait : la prestation
// quittait les « en cours » que le contrôle de quota additionne, et la place se
// libérait — un compte gratuit dont les clients ne valident pas n'avait plus de
// limite.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, client, api, reservationPayee, tachePlanifieeJusqua } from "./fabrique.js";

test.describe.configure({ timeout: 300_000 });

test("validation automatique : la prestation compte au quota mensuel", async () => {
  const p = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: p, client: c });
  const ok = await api("/api/missions", { action: "respond_mission", mission_id: m.id, response: "accept" }, p.jeton);
  expect(ok.statut, ok.texte.slice(0, 200)).toBe(200);

  // La prestation a eu lieu il y a deux jours ; le prestataire a confirmé la fin,
  // le client n'a jamais répondu.
  const jour = new Date(Date.now() - 2 * 864e5).toLocaleDateString("fr-CA", { timeZone: "Europe/Paris" });
  await sql(`update missions set date = '${jour}', heure_debut = '09:00',
      started_at = ('${jour} 09:00'::timestamp at time zone 'Europe/Paris') where id = '${m.id}'`);
  const fin = await api("/api/missions", { action: "validate_presta", mission_id: m.id }, p.jeton);
  expect(fin.statut, fin.texte.slice(0, 200)).toBe(200);
  const [avant] = await sql(`select missions_completed_month n from profiles where id = '${p.id}'`);

  const statut = async () => (await sql(`select status from missions where id = '${m.id}'`))[0].status;
  await tachePlanifieeJusqua(async () => (await statut()) === "completed", { max: 6 });
  expect(await statut(), "validée automatiquement").toBe("completed");

  const [apres] = await sql(`select missions_completed_month n from profiles where id = '${p.id}'`);
  console.log("[86] quota :", avant.n, "→", apres.n);
  expect(Number(apres.n), "une journée de plus au compteur du mois").toBe(Number(avant.n || 0) + 1);
});
