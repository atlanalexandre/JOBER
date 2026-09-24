// Fin de prestation et versement au prestataire (CGPS art. 5.4 et 17.1).
//
// Le virement ne part pas à la validation du client : il part à la fermeture de
// la fenêtre de contestation, 48 h après la FIN de la prestation. Un litige
// ouvert dans ce délai le bloque ; passé ce délai, on ne peut plus contester.
//
// Le temps est simulé en reculant les dates en base de recette, puis en
// déclenchant la tâche planifiée comme le ferait Vercel.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, client, api, reservationPayee, tachePlanifiee } from "./fabrique.js";

test.describe.configure({ timeout: 180_000 });

const H = 3600e3;
const jourParis = (ms) => new Date(ms).toLocaleDateString("fr-CA", { timeZone: "Europe/Paris" });
const versement = async (id) => (await sql(`select status, payout_status, payout_due_at, payout_amount, stripe_transfer_id from missions where id = '${id}'`))[0];

/**
 * Une prestation de 8 h, commencée `ilYa` ms plus tôt à 09 h (heure de Paris),
 * acceptée, démarrée, et dont le prestataire a confirmé la fin.
 */
async function prestationFinie({ ilYaJours = 1 } = {}) {
  const p = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: p, client: c });
  const ok = await api("/api/missions", { action: "respond_mission", mission_id: m.id, response: "accept" }, p.jeton);
  expect(ok.statut, ok.texte.slice(0, 200)).toBe(200);

  // Préparation : la prestation a eu lieu (date reculée, démarrage pointé).
  const jour = jourParis(Date.now() - ilYaJours * 24 * H);
  await sql(`update missions set date = '${jour}', heure_debut = '09:00',
      started_at = ('${jour} 09:00'::timestamp at time zone 'Europe/Paris') where id = '${m.id}'`);

  const fin = await api("/api/missions", { action: "validate_presta", mission_id: m.id }, p.jeton);
  expect(fin.statut, `confirmation de fin par le prestataire : ${fin.texte.slice(0, 200)}`).toBe(200);
  // Fin prévue : 09 h + 8 h = 17 h, heure de Paris.
  const [{ fin_ms }] = await sql(`select extract(epoch from ('${jour} 17:00'::timestamp at time zone 'Europe/Paris')) * 1000 as fin_ms`);
  return { p, c, m, finMs: Number(fin_ms) };
}

test("à la validation, le versement est programmé 48 h après la fin — pas avant", async () => {
  const { c, m, finMs } = await prestationFinie();
  const v = await api("/api/missions", { action: "complete", mission_id: m.id }, c.jeton);
  expect(v.statut, v.texte.slice(0, 200)).toBe(200);

  const e = await versement(m.id);
  console.log("[10] après validation :", JSON.stringify(e));
  expect(e.status).toBe("completed");
  expect(e.payout_status).toBe("pending");
  expect(Number(e.payout_amount), "part du prestataire : 8 h × 13 €").toBeCloseTo(104, 2);
  expect(Math.abs(new Date(e.payout_due_at).getTime() - (finMs + 48 * H)), "échéance = fin + 48 h").toBeLessThan(60e3);

  // La tâche planifiée passe : l'échéance n'est pas atteinte, rien ne part.
  const t = await tachePlanifiee();
  expect(t.statut, t.texte.slice(0, 200)).toBe(200);
  const apres = await versement(m.id);
  expect(apres.payout_status, "aucun virement avant la fermeture de la fenêtre").toBe("pending");
  expect(apres.stripe_transfer_id).toBeNull();
});

test("un litige ouvert dans les 48 h bloque le versement", async () => {
  const { c, m } = await prestationFinie();
  expect((await api("/api/missions", { action: "complete", mission_id: m.id }, c.jeton)).statut).toBe(200);

  const l = await api("/api/missions", { action: "dispute", mission_id: m.id, message: "Scénario de recette" }, c.jeton);
  expect(l.statut, l.texte.slice(0, 200)).toBe(200);

  // L'échéance passe pendant le litige : le virement ne doit pas partir.
  await sql(`update missions set payout_due_at = now() - interval '1 minute' where id = '${m.id}'`);
  await tachePlanifiee();
  const e = await versement(m.id);
  console.log("[10] litige :", JSON.stringify(e));
  expect(e.status).toBe("disputed");
  expect(e.payout_status, "versement suspendu par le litige").not.toBe("transferred");
  expect(e.stripe_transfer_id).toBeNull();
});

test("passé 48 h après la fin, le client ne peut plus contester", async () => {
  const { c, m } = await prestationFinie({ ilYaJours: 3 });
  expect((await api("/api/missions", { action: "complete", mission_id: m.id }, c.jeton)).statut).toBe(200);
  const l = await api("/api/missions", { action: "dispute", mission_id: m.id, message: "Trop tard" }, c.jeton);
  expect(l.statut, l.texte.slice(0, 200)).toBe(400);
  expect((await versement(m.id)).status).toBe("completed");
});

test("échéance atteinte : la tâche planifiée verse, ou dit pourquoi elle ne peut pas", async () => {
  const { p, c, m } = await prestationFinie({ ilYaJours: 3 });
  expect((await api("/api/missions", { action: "complete", mission_id: m.id }, c.jeton)).statut).toBe(200);
  const t = await tachePlanifiee();
  expect(t.statut, t.texte.slice(0, 200)).toBe(200);

  const e = await versement(m.id);
  const [pr] = await sql(`select stripe_account_id is not null connect, stripe_account_status from profiles where id = '${p.id}'`);
  console.log("[10] échéance atteinte :", JSON.stringify(e), "— compte de virement :", JSON.stringify(pr), "— tâche :", t.texte.slice(0, 200));
  if (pr.connect && pr.stripe_account_status === "enabled") {
    expect(e.payout_status).toBe("transferred");
    expect(e.stripe_transfer_id).toMatch(/^tr_/);
  } else {
    // Sans compte de virement actif, le versement reste en attente — jamais
    // « versé » à tort, jamais perdu : il partira quand le compte sera activé.
    expect(e.payout_status).toBe("pending");
    expect(e.stripe_transfer_id).toBeNull();
  }
});
