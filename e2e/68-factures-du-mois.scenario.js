// Toutes les factures du mois en un seul document (04/10/2026).
// Jusqu'ici, client et prestataire devaient ouvrir chaque prestation pour en
// sortir la facture. L'export réunit celles du mois — et seulement les leurs :
// le serveur filtre sur l'identité portée par le jeton, propre au mois.
import { test, expect } from "@playwright/test";
import { sql, appelApi } from "./outils.js";
import { prestataireOperationnel, client, reservationPayee, api } from "./fabrique.js";

test.describe.configure({ timeout: 180_000 });

const MOIS = "2026-08";
const jetonDuMois = async (jeton, mois = MOIS) => {
  const r = await api("/api/missions", { action: "generate_invoice_token", mois }, jeton);
  expect(r.statut, r.texte.slice(0, 200)).toBe(200);
  return r.json.token;
};
const ouvrir = (mois, token) => appelApi(`/api/invoice?mois=${mois}&token=${encodeURIComponent(token)}`);
const nbFactures = (html) => (html.match(/class="facture-du-mois"/g) || []).length;

test("le client et le prestataire sortent les factures du mois, et seulement les leurs", async () => {
  const p = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: p, client: c });
  await sql(`update missions set status = 'completed', date = '${MOIS}-15' where id = '${m.id}'`);

  // Le client : un document, une facture.
  const doc = await ouvrir(MOIS, await jetonDuMois(c.jeton));
  expect(doc.statut, doc.texte.slice(0, 300)).toBe(200);
  expect(doc.texte).toContain("Vos factures — août 2026");
  expect(nbFactures(doc.texte)).toBe(1);

  // Le prestataire : la même.
  const docP = await ouvrir(MOIS, await jetonDuMois(p.jeton));
  expect(docP.statut).toBe(200);
  expect(nbFactures(docP.texte)).toBe(1);

  // Une prestation annulée du même mois n'y entre pas.
  const annulee = await reservationPayee({ prestataire: p, client: c });
  await sql(`update missions set status = 'cancelled', invoice_number = null, date = '${MOIS}-20' where id = '${annulee.id}'`);
  const encore = await ouvrir(MOIS, await jetonDuMois(c.jeton));
  expect(nbFactures(encore.texte)).toBe(1);

  // Un autre client n'y voit rien.
  const autre = await client();
  const rien = await ouvrir(MOIS, await jetonDuMois(autre.jeton));
  expect(rien.statut).toBe(200);
  expect(rien.texte).toContain("Aucune facture en août 2026");

  // Le jeton d'un mois n'ouvre pas un autre mois, ni un jeton de facture seule.
  const autreMois = await ouvrir("2026-07", await jetonDuMois(c.jeton));
  expect(autreMois.statut).toBe(401);
  const unitaire = await api("/api/missions", { action: "generate_invoice_token", mission_id: m.id }, c.jeton);
  expect(unitaire.statut).toBe(200);
  const detourne = await ouvrir(MOIS, unitaire.json.token);
  expect(detourne.statut).toBe(401);

  // Mois mal formé : refusé à la génération du jeton.
  const mauvais = await api("/api/missions", { action: "generate_invoice_token", mois: "2026-13" }, c.jeton);
  expect(mauvais.statut).toBe(400);
});

test("une facture déjà émise garde sa date d'émission", async () => {
  const p = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: p, client: c });
  const numero = `FAC-RECETTE-${Date.now()}`;
  // L'archive porte la date d'émission. Elle ne se modifie pas en base : on la
  // crée donc d'emblée à une date passée, comme si la facture datait d'août.
  await sql(`update missions set status = 'completed', invoice_number = '${numero}', date = '${MOIS}-15' where id = '${m.id}'`);
  await sql(`insert into factures_archives (numero, mission_id, emise_le, montant_ht, montant_tva, montant_ttc, contenu)
             values ('${numero}', '${m.id}', '${MOIS}-16T10:00:00Z', 0, 0, 0,
                     '{"version":1,"emise_le":"${MOIS}-16T10:00:00Z"}'::jsonb)`);

  const t = await api("/api/missions", { action: "generate_invoice_token", mission_id: m.id }, c.jeton);
  expect(t.statut).toBe(200);
  const doc = await appelApi(`/api/invoice?mission_id=${m.id}&token=${encodeURIComponent(t.json.token)}`);
  expect(doc.statut, doc.texte.slice(0, 300)).toBe(200);
  expect(doc.texte).toContain("Émise le 16/08/2026");

  // Et dans l'export du mois, la même date.
  const mois = await ouvrir(MOIS, await jetonDuMois(c.jeton));
  expect(mois.texte).toContain("Émise le 16/08/2026");
});

test("plusieurs jours et factures à numéroter : toutes dans le document, aucune en échec", async () => {
  const p = await prestataireOperationnel();
  const c = await client();
  const mois = "2026-07";
  const ids = [];
  // Cinq prestations d'un jour, encore sans numéro : en parallèle, elles se
  // disputaient le compteur et l'une échouait.
  for (let j = 10; j < 15; j++) {
    const id = crypto.randomUUID(); ids.push(id);
    await sql(`insert into missions (id, client_id, prestataire_id, sector, metier, date, hours, heure_debut, tarif_horaire, montant_total, adresse, ville, status)
               values ('${id}', '${c.id}', '${p.id}', 'hotellerie', 'Femme/Valet de chambre', '${mois}-${j}', 8, '09:00', 13, 110.98, '10 rue de Rivoli', 'Paris', 'completed')`);
  }
  // Une prestation de plusieurs jours : `date` est nulle, seule `date_debut` la situe.
  const multi = crypto.randomUUID(); ids.push(multi);
  await sql(`insert into missions (id, client_id, prestataire_id, sector, metier, date, date_debut, date_fin, hours, heure_debut, tarif_horaire, montant_total, adresse, ville, status)
             values ('${multi}', '${c.id}', '${p.id}', 'hotellerie', 'Femme/Valet de chambre', null, '${mois}-20', '${mois}-22', 8, '09:00', 13, 332.94, '10 rue de Rivoli', 'Paris', 'completed')`);

  const doc = await ouvrir(mois, await jetonDuMois(c.jeton, mois));
  expect(doc.statut, doc.texte.slice(0, 300)).toBe(200);
  expect(doc.texte).not.toContain("n'ont pas pu être éditées");
  expect(nbFactures(doc.texte)).toBe(6);

  const nums = await sql(`select invoice_number from missions where id in ('${ids.join("','")}')`);
  const distincts = new Set(nums.map(n => n.invoice_number).filter(Boolean));
  expect(distincts.size, "six numéros distincts").toBe(6);
});
