// Heures supplémentaires sur plusieurs jours, et modification de la commande (06/10/2026).
//
// Décision d'Alexandre : une heure supplémentaire vaut pour UNE journée, celle
// en cours. Pour changer l'horaire de plusieurs journées, le client modifie la
// commande — les journées pas encore commencées, en hausse seulement.
//
// Avant, 1 h demandée sur une série de cinq jours était facturée cinq fois,
// journées déjà faites comprises.
//
// Et la garde de création de la base : un client pouvait créer, depuis la
// console de son navigateur, une prestation portant déjà 24 h réalisées ou un
// versement — colonnes que seul le serveur doit écrire.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, client, reservationPayee, api, confirmerPaiement, paiementStripe, creerPrestationBrute } from "./fabrique.js";

test.describe.configure({ timeout: 300_000 });

const paris = { timeZone: "Europe/Paris" };
const jourParis = (ms) => new Date(ms).toLocaleDateString("fr-CA", paris);
const heureParis = (ms) => new Date(ms).toLocaleTimeString("fr-FR", { ...paris, hour: "2-digit", minute: "2-digit" });
const decaler = (jour, n) => { const d = new Date(`${jour}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/**
 * Une série de cinq journées de 4 h : deux faites, la troisième commencée il y
 * a `depuisH` heures, deux à venir.
 */
async function serieEnCours(depuisH = 1) {
  const p = await prestataireOperationnel();
  const c = await client();
  // Le paiement couvre les cinq journées : 5 × 4 h, ramenées ensuite à 4 h par jour.
  const m = await reservationPayee({ prestataire: p, client: c, heures: 20, tarif: 13 });
  const ok = await api("/api/missions", { action: "respond_mission", mission_id: m.id, response: "accept" }, p.jeton);
  expect(ok.statut, ok.texte.slice(0, 200)).toBe(200);
  const debut = Date.now() - depuisH * 3600e3;
  const aujourdhui = jourParis(debut);
  await sql(`update missions set hours = 4, date = '${decaler(aujourdhui, -2)}', date_debut = '${decaler(aujourdhui, -2)}',
             date_fin = '${decaler(aujourdhui, 2)}', heure_debut = '${heureParis(debut)}',
             started_at = '${new Date(Date.now() - (48 + depuisH) * 3600e3).toISOString()}' where id = '${m.id}'`);
  return { p, c, m };
}

/** Le prestataire chiffre, le client paie et confirme. Rend le montant prélevé (centimes) et le paiement. */
async function accepterEtPayer({ p, c, m }, tarif) {
  const rep = await api("/api/missions", { action: "respond_extra_hours", mission_id: m.id, response: "accept", tarif_horaire: tarif }, p.jeton);
  expect(rep.statut, rep.texte.slice(0, 200)).toBe(200);
  const intent = await api("/api/stripe-intent", { mode: "supplement", mission_id: m.id, currency: "eur" }, c.jeton);
  expect(intent.statut, intent.texte.slice(0, 200)).toBe(200);
  const pay = await confirmerPaiement(intent.json.clientSecret);
  expect(pay.statut, pay.erreur || "").toBe("succeeded");
  const conf = await api("/api/missions", { action: "confirmer_heures_supp", mission_id: m.id, payment_intent: pay.paymentIntent }, c.jeton);
  expect(conf.statut, conf.texte.slice(0, 200)).toBe(200);
  const preleve = (await paiementStripe(pay.paymentIntent)).preleve;
  return { preleve, pi: pay.paymentIntent };
}

test("1 h supplémentaire un jour de série est payée une fois, pas cinq", async () => {
  const s = await serieEnCours(1);
  const d = await api("/api/missions", { action: "request_extra_hours", mission_id: s.m.id, extra_hours: 1, portee: "jour" }, s.c.jeton);
  expect(d.statut, d.texte.slice(0, 200)).toBe(200);
  const [l] = await sql(`select extra_hours_portee, extra_hours_jours from missions where id = '${s.m.id}'`);
  expect(l).toMatchObject({ extra_hours_portee: "jour", extra_hours_jours: 1 });

  const { preleve } = await accepterEtPayer(s, 20);
  // 20 € de prestation + frais de service : bien moins que 5 × 20 €.
  expect(preleve, "une seule journée facturée").toBeGreaterThan(2000);
  expect(preleve).toBeLessThan(3000);

  const [a] = await sql(`select hours, extra_hours_appliquees, montant_heures_ajoutees, heures_ajoutees_total,
                         heures_ajoutees_dernier_jour, extra_hours_jours from missions where id = '${s.m.id}'`);
  expect(Number(a.hours), "l'horaire des autres journées ne bouge pas").toBe(4);
  expect(Number(a.montant_heures_ajoutees)).toBe(20);
  expect(Number(a.heures_ajoutees_total)).toBe(1);
  expect(Number(a.heures_ajoutees_dernier_jour), "ce n'est pas le dernier jour").toBe(0);
  expect(a.extra_hours_jours, "la portée est soldée").toBeNull();
});

test("modifier la commande ajoute les heures aux deux journées à venir", async () => {
  const s = await serieEnCours(1);
  const d = await api("/api/missions", { action: "request_extra_hours", mission_id: s.m.id, extra_hours: 2, portee: "commande" }, s.c.jeton);
  expect(d.statut, d.texte.slice(0, 200)).toBe(200);
  const [l] = await sql(`select extra_hours_portee, extra_hours_jours from missions where id = '${s.m.id}'`);
  expect(l).toMatchObject({ extra_hours_portee: "commande", extra_hours_jours: 2 });

  const { preleve } = await accepterEtPayer(s, 20);
  // 2 h × 20 € × 2 journées = 80 € + frais.
  expect(preleve).toBeGreaterThan(8000);
  expect(preleve).toBeLessThan(10000);

  const [a] = await sql(`select hours, montant_heures_ajoutees, heures_ajoutees_total, heures_ajoutees_dernier_jour
                         from missions where id = '${s.m.id}'`);
  expect(Number(a.hours)).toBe(4);
  expect(Number(a.montant_heures_ajoutees)).toBe(80);
  expect(Number(a.heures_ajoutees_total)).toBe(4);
  expect(Number(a.heures_ajoutees_dernier_jour), "la dernière journée finit 2 h plus tard").toBe(2);
});

test("arrêter la série rend les heures ajoutées aux journées qui n'auront pas lieu", async () => {
  const s = await serieEnCours(1);
  const d = await api("/api/missions", { action: "request_extra_hours", mission_id: s.m.id, extra_hours: 2, portee: "commande" }, s.c.jeton);
  expect(d.statut, d.texte.slice(0, 200)).toBe(200);
  const paye = await accepterEtPayer(s, 20);
  const [avant] = await sql(`select montant_total from missions where id = '${s.m.id}'`);

  const r = await api("/api/missions", { action: "cancel_in_progress", mission_id: s.m.id, annuler_reste: true }, s.c.jeton);
  expect(r.statut, r.texte.slice(0, 200)).toBe(200);
  expect(r.json.remboursementHeuresAjoutees, "2 h × 2 journées × 20 €").toBe(80);

  const stripe = await paiementStripe(paye.pi);
  expect(stripe.rembourse, "rendus sur le paiement de la modification").toBe(8000);
  const [l] = await sql(`select status, montant_heures_ajoutees, heures_ajoutees_total, heures_ajoutees_detail, montant_total
                         from missions where id = '${s.m.id}'`);
  expect(l.status).toBe("completed");
  expect(Number(l.montant_heures_ajoutees), "plus rien d'ajouté à verser").toBe(0);
  expect(Number(l.heures_ajoutees_total)).toBe(0);
  expect(l.heures_ajoutees_detail).toEqual([]);
  expect(Number(l.montant_total)).toBeLessThan(Number(avant.montant_total) - 80 + 0.01);
});

test("entre deux journées, pas d'heures supplémentaires : on modifie la commande", async () => {
  // La journée d'aujourd'hui (4 h) a fini il y a deux heures.
  const s = await serieEnCours(6);
  const d = await api("/api/missions", { action: "request_extra_hours", mission_id: s.m.id, extra_hours: 1, portee: "jour" }, s.c.jeton);
  expect(d.statut, d.texte.slice(0, 200)).toBe(400);
  expect(d.json?.error || "").toMatch(/modifiez la commande/);
  const [l] = await sql(`select extra_hours_status from missions where id = '${s.m.id}'`);
  expect(l.extra_hours_status).toBeNull();
});

test("la base refuse une prestation créée avec des heures réalisées ou un versement", async () => {
  const c = await client();
  for (const champs of [{ actual_hours: 24 }, { extra_hours_tarif: 500 }, { montant_heures_ajoutees: 100 }, { payout_amount: 1000 }]) {
    const r = await creerPrestationBrute(c, champs);
    expect(r.statut, `${JSON.stringify(champs)} : ${r.texte}`).toBeGreaterThanOrEqual(400);
  }
  const normal = await creerPrestationBrute(c);
  expect(normal.statut, `création normale : ${normal.texte}`).toBe(201);
});
