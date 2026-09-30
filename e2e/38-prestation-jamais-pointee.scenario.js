// Prestation jamais pointée (décision d'Alexandre du 30/09/2026).
//
// Elle était validée d'office 24 h après sa fin, et le prestataire payé — y compris
// quand personne n'était venu, sans que le client le sache. Désormais le client est
// interrogé : « oui » valide ; « non » rembourse tout, frais compris ; « non » alors
// que le prestataire affirme être venu ouvre un litige, que l'équipe tranche. Sans
// réponse, la prestation est validée 24 h après la fin, comme avant.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, client, reservationPayee, paiementStripe, api, tachePlanifiee } from "./fabrique.js";

test.describe.configure({ timeout: 240_000 });

/** Date et heure de Paris, `heures` heures dans le passé. */
function ilYA(heures) {
  const d = new Date(Date.now() - heures * 3600000);
  const date  = d.toLocaleDateString("fr-CA", { timeZone: "Europe/Paris" });                       // 2026-10-01
  const heure = d.toLocaleTimeString("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" }); // 14:05
  return { date, heure };
}

/** Une prestation acceptée, de 2 h, commencée il y a 4 h selon l'horaire, jamais pointée. */
async function prestationNonPointee() {
  const p = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: p, client: c, heures: 2 });
  const ok = await api("/api/missions", { action: "respond_mission", mission_id: m.id, response: "accept" }, p.jeton);
  expect(ok.statut, ok.texte.slice(0, 200)).toBe(200);
  const { date, heure } = ilYA(4);
  await sql(`update missions set date = '${date}', date_debut = '${date}', date_fin = '${date}', heure_debut = '${heure}',
             arrived_at = null, started_at = null where id = '${m.id}'`);
  return { p, c, m };
}

const statut = async (id) => (await sql(`select status from missions where id = '${id}'`))[0].status;

test("personne n'est venu, le prestataire n'a rien confirmé : remboursement intégral, frais compris", async () => {
  const { c, m } = await prestationNonPointee();
  const r = await api("/api/missions", { action: "cancel_client", mission_id: m.id, motif: "absence_prestataire" }, c.jeton);
  expect(r.statut, r.texte.slice(0, 200)).toBe(200);
  const pi = await paiementStripe(m.paymentIntent);
  expect(pi.rembourse, "frais de service compris").toBe(pi.preleve);
  expect(await statut(m.id)).toBe("cancelled");
});

test("le prestataire affirme être venu : le client ne se rembourse pas seul, il ouvre un litige", async () => {
  const { p, c, m } = await prestationNonPointee();
  const conf = await api("/api/missions", { action: "validate_presta", mission_id: m.id }, p.jeton);
  expect(conf.statut, conf.texte.slice(0, 200)).toBe(200);

  const annul = await api("/api/missions", { action: "cancel_client", mission_id: m.id }, c.jeton);
  expect(annul.statut).toBe(409);
  expect(annul.json?.code).toBe("presence_declaree");
  expect((await paiementStripe(m.paymentIntent)).rembourse, "rien n'est remboursé").toBe(0);

  const litige = await api("/api/missions", { action: "dispute", mission_id: m.id, message: "Personne n'est venu." }, c.jeton);
  expect(litige.statut, litige.texte.slice(0, 200)).toBe(200);
  expect(await statut(m.id), "le virement est gelé jusqu'à la décision").toBe("disputed");
});

test("le client confirme qu'elle a eu lieu : il peut valider sans attendre le prestataire", async () => {
  const { c, m } = await prestationNonPointee();
  const r = await api("/api/missions", { action: "complete", mission_id: m.id }, c.jeton);
  expect(r.statut, r.texte.slice(0, 200)).toBe(200);
  expect(await statut(m.id)).toBe("completed");
});

test("une prestation à venir ne se valide toujours pas sans le prestataire", async () => {
  const p = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: p, client: c });
  await api("/api/missions", { action: "respond_mission", mission_id: m.id, response: "accept" }, p.jeton);
  const r = await api("/api/missions", { action: "complete", mission_id: m.id }, c.jeton);
  expect(r.statut).toBe(400);
});

test("la tâche planifiée pose la question au client, une seule fois", async () => {
  const { c, m } = await prestationNonPointee();
  for (let i = 0; i < 2; i++) {
    const t = await tachePlanifiee();
    expect(t.statut, t.texte.slice(0, 200)).toBe(200);
  }
  const [n] = await sql(`select count(*)::int as n from notifications where user_id = '${c.id}' and ref_id = '${m.id}' and title = 'La prestation a-t-elle eu lieu ?'`);
  expect(n.n).toBe(1);
  expect(await statut(m.id), "moins de 24 h après la fin : pas encore validée").toBe("assigned");
});
