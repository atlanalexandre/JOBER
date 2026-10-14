// Compte suspendu : plus de carte, de paiement ni d'abonnement par un appel
// direct (étude du 13/10/2026).
//
// L'application déconnecte un compte suspendu, mais son jeton reste valable et
// se rafraîchit : `/api/stripe-intent` et `/api/stripe-subscription` ne
// regardaient que le jeton, et laissaient enregistrer une carte, payer une
// réservation ou souscrire un abonnement.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { client, prestataireOperationnel, creerPrestationBrute, api } from "./fabrique.js";

test.describe.configure({ timeout: 180_000 });

test("client suspendu : carte et réservation refusées, retrait de carte possible", async () => {
  const c = await client();
  const m = { id: crypto.randomUUID() };
  const cree = await creerPrestationBrute(c, { id: m.id });
  expect(cree.statut, cree.texte).toBeLessThan(300);
  await sql(`update profiles set status = 'suspended' where id = '${c.id}'`);

  const carte = await api("/api/stripe-intent", { action: "setup_card" }, c.jeton);
  expect(carte.statut, carte.texte.slice(0, 200)).toBe(403);
  expect(carte.json?.code).toBe("compte_bloque");

  const paiement = await api("/api/stripe-intent", { mission_id: m.id, utiliser_cashback: false }, c.jeton);
  expect(paiement.statut, paiement.texte.slice(0, 200)).toBe(403);

  const panier = await api("/api/booking-draft", { action: "save", mission_id: m.id }, c.jeton);
  expect(panier.statut).toBe(403);

  // Retirer une carte reste permis (refus pour une autre raison : carte inconnue).
  const retrait = await api("/api/stripe-intent", { action: "detach_pm", pmId: "pm_inconnu" }, c.jeton);
  expect(retrait.json?.code).not.toBe("compte_bloque");

  // Réactivé : tout revient.
  await sql(`update profiles set status = 'approved' where id = '${c.id}'`);
  const apres = await api("/api/stripe-intent", { action: "setup_card" }, c.jeton);
  expect(apres.statut, apres.texte.slice(0, 200)).toBe(200);
});

test("prestataire suspendu : abonnement refusé, résiliation possible", async () => {
  const p = await prestataireOperationnel();
  await sql(`update profiles set status = 'suspended' where id = '${p.id}'`);
  const sous = await api("/api/stripe-subscription", { plan: "premium" }, p.jeton);
  expect(sous.statut, sous.texte.slice(0, 200)).toBe(403);
  const resil = await api("/api/stripe-subscription", { plan: "free" }, p.jeton);
  expect(resil.json?.code).not.toBe("compte_bloque");
});
