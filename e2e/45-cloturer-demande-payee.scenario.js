// « Clôturer » une demande ouverte déjà payée (audit des prestations, 01/10/2026).
//
// Une prestation affectée par la plateforme que personne n'a acceptée repart en
// diffusion — statut « open » — avec le paiement du client conservé. Le bouton
// « Clôturer la prestation » la fermait sans rien rembourser : le client perdait
// son argent. Seule l'annulation rembourse.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, client, reservationPayee, api } from "./fabrique.js";

test.describe.configure({ timeout: 200_000 });

test("une demande ouverte payée ne se clôture pas sans remboursement", async () => {
  const p = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: p, client: c, heures: 4 });
  // Ce que fait la cascade quand il n'y a plus de candidat : retour en diffusion.
  await sql(`update missions set status = 'open', prestataire_id = null, acceptance_deadline = null where id = '${m.id}'`);

  const r = await api("/api/missions", { action: "close", mission_id: m.id }, c.jeton);
  expect(r.statut, r.texte.slice(0, 200)).toBe(409);
  const [l] = await sql(`select status from missions where id = '${m.id}'`);
  expect(l.status, "toujours ouverte, l'argent n'est pas perdu").toBe("open");

  // Le chemin prévu, lui, fonctionne et rembourse.
  const a = await api("/api/missions", { action: "cancel_client", mission_id: m.id }, c.jeton);
  expect(a.statut, a.texte.slice(0, 200)).toBe(200);
  const [f] = await sql(`select status from missions where id = '${m.id}'`);
  expect(f.status).toBe("cancelled");
});

test("une demande ouverte non payée se clôture toujours", async () => {
  const c = await client();
  const [m] = await sql(`insert into missions (client_id, status, sector, metier, titre, date, heure_debut, hours, tarif_horaire, ville)
     values ('${c.id}', 'open', 'hotellerie', 'Femme/Valet de chambre', 'Recette 45', current_date + 5, '09:00', 4, 13, 'Paris') returning id`);
  const r = await api("/api/missions", { action: "close", mission_id: m.id }, c.jeton);
  expect(r.statut, r.texte.slice(0, 200)).toBe(200);
  const [l] = await sql(`select status from missions where id = '${m.id}'`);
  expect(l.status).toBe("closed");
});
