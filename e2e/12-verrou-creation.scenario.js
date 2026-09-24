// Ce que la BASE refuse à la création d'une prestation, quel que soit l'écran.
//
// Une prestation est insérée par le navigateur du client : n'importe qui peut
// donc rejouer cette insertion depuis la console, avec ses propres valeurs. Le
// déclencheur `missions_creation_guard` est la seule barrière qu'aucun chemin
// ne contourne. Le 24/09/2026, posé sur la recette, il laissait TOUT passer
// (migration 2026-09-24_secu_verrou_creation_prestation_effectif.sql).
import { test, expect } from "@playwright/test";
import { client, creerPrestationBrute } from "./fabrique.js";

test("les deux créations de l'application passent", async () => {
  const c = await client();
  // Réservation (App.jsx) : sans prestataire, en attente, montant complet.
  const reservation = await creerPrestationBrute(c);
  expect(reservation.statut, reservation.texte).toBe(201);
  // Diffusion (client-screens.jsx) : statut « open », sans tarif ni montant.
  const diffusion = await creerPrestationBrute(c, { status: "open", tarif_horaire: null, montant_total: null });
  expect(diffusion.statut, diffusion.texte).toBe(201);
});

const fraudes = {
  "s'affecter un prestataire": (c) => ({ prestataire_id: c.id }),
  "payer 1 € pour 104 € de travail": () => ({ montant_total: 1 }),
  "se rattacher un paiement": () => ({ stripe_payment_intent: "pi_faux_000000000000" }),
  "fixer le délai de réponse": () => ({ acceptance_deadline: new Date(Date.now() + 365 * 864e5).toISOString() }),
  "naître déjà attribuée": () => ({ status: "assigned" }),
  "antidater le pointage": () => ({ started_at: new Date().toISOString() }),
  "créer au nom d'un autre": () => ({ client_id: crypto.randomUUID() }),
};

for (const [cas, champs] of Object.entries(fraudes)) {
  test(`refusé par la base : ${cas}`, async () => {
    const c = await client();
    const r = await creerPrestationBrute(c, champs(c));
    console.log(`[12] ${cas} :`, r.statut, r.texte.slice(0, 120));
    expect(r.statut, `${cas} — accepté par la base`).not.toBe(201);
  });
}
