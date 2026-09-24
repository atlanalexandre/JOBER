// De l'inscription à l'accès aux prestations : chaque verrou, puis son ouverture.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, api } from "./fabrique.js";

test("un prestataire complet obtient l'accès aux prestations et un compte de virement", async () => {
  const p = await prestataireOperationnel();
  expect(p.ouverture.statut, p.ouverture.texte.slice(0, 300)).toBe(200);
  const [profil] = await sql(`select status, missions_enabled, missions_enabled_at is not null ouvert_le,
      stripe_account_id is not null connect from profiles where id = '${p.id}'`);
  expect(profil.status).toBe("approved");
  expect(profil.missions_enabled).toBe(true);
  expect(profil.ouvert_le, "missions_enabled_at date l'entrée dans l'offre de lancement").toBe(true);

  // L'ouverture ne bloque pas si Stripe échoue (voulu : on ne retient pas quelqu'un
  // qui peut travailler), mais elle ne dit pas non plus pourquoi. On le demande au
  // bouton du prestataire, qui rend l'erreur de Stripe telle quelle.
  let raison = "";
  if (!profil.connect) raison = (await api("/api/stripe-connect", {}, p.jeton)).texte.slice(0, 300);
  expect(profil.connect, `compte Stripe Connect (test) créé à l'ouverture — ${raison}`).toBe(true);
});
