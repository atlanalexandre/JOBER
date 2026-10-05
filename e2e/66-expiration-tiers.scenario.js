// Réservation chez un tiers restée sans réponse : la tâche planifiée passe au
// candidat suivant au lieu de rembourser (relecture du 04/10/2026).
//
// Chez un tiers, la plateforme choisit le prestataire (CGPS art. 5.2) : le client
// n'a choisi personne et sa commande tient. L'application passait bien au
// suivant ; la tâche planifiée, chemin réellement emprunté quand le client n'a pas
// l'application ouverte, remboursait et annulait.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, client, reservationPayee, tachePlanifiee, paiementStripe } from "./fabrique.js";

test.describe.configure({ timeout: 240_000 });

const DECLARATION_TIERS = {
  beneficiaire: "Hôtel du Parc (recette)", service_vendu: "Remise en état de chambres",
  perimetre: "Chambres du 2e étage", livrable: "Chambres prêtes", organisateur: "Le prestataire organise seul son travail",
};

test("le premier prestataire ne répond pas : la commande passe au suivant, sans remboursement", async () => {
  await prestataireOperationnel();
  await prestataireOperationnel();
  const c = await client({ professionnel: true });
  const m = await reservationPayee({ prestataire: null, client: c, declaration: DECLARATION_TIERS });
  expect(m.mode).toBe("affectation");
  const [avant] = await sql(`select prestataire_id from missions where id = '${m.id}'`);
  await sql(`update missions set acceptance_deadline = now() - interval '5 minutes' where id = '${m.id}'`);

  const r = await tachePlanifiee();
  expect(r.statut, r.texte.slice(0, 200)).toBe(200);

  const [l] = await sql(`select status, prestataire_id from missions where id = '${m.id}'`);
  expect(l.status, "ni refusée ni remboursée").not.toBe("refused");
  expect(["pending_acceptance", "open"]).toContain(l.status);
  expect(l.prestataire_id, "plus le prestataire silencieux").not.toBe(avant.prestataire_id);
  const s = await paiementStripe(m.paymentIntent);
  expect(s.rembourse, "le paiement est conservé").toBe(0);
});

test("l'heure de début est passée : plus de candidat suivant, le client est remboursé", async () => {
  await prestataireOperationnel();
  await prestataireOperationnel();
  const c = await client({ professionnel: true });
  const m = await reservationPayee({ prestataire: null, client: c, declaration: DECLARATION_TIERS });
  expect(m.mode).toBe("affectation");
  // La prestation devait commencer hier : solliciter quelqu'un d'autre n'a plus de sens
  // (relecture du 05/10/2026 — chaque passage relançait la cascade).
  await sql(`update missions set acceptance_deadline = now() - interval '5 minutes',
             date = (now() at time zone 'Europe/Paris')::date - 1 where id = '${m.id}'`);

  const r = await tachePlanifiee();
  expect(r.statut, r.texte.slice(0, 200)).toBe(200);

  const [l] = await sql(`select status from missions where id = '${m.id}'`);
  expect(l.status).toBe("refused");
  await expect.poll(async () => (await paiementStripe(m.paymentIntent)).rembourse, { timeout: 30_000 }).toBeGreaterThan(0);
});
