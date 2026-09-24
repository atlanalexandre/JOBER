// De l'inscription à l'accès aux prestations : chaque verrou, puis son ouverture.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel } from "./fabrique.js";

test("un prestataire complet obtient l'accès aux prestations et un compte de virement", async () => {
  const p = await prestataireOperationnel();
  console.log("[05] ouverture :", p.ouverture.statut, p.ouverture.texte.slice(0, 300));
  expect(p.ouverture.statut, p.ouverture.texte.slice(0, 300)).toBe(200);
  const [profil] = await sql(`select status, missions_enabled, missions_enabled_at is not null ouvert_le,
      stripe_account_id is not null connect from profiles where id = '${p.id}'`);
  expect(profil.status).toBe("approved");
  expect(profil.missions_enabled).toBe(true);
  expect(profil.ouvert_le, "missions_enabled_at date l'entrée dans l'offre de lancement").toBe(true);
  expect(profil.connect, "compte Stripe Connect (test) créé à l'ouverture").toBe(true);
});
