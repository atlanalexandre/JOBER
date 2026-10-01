// Retrouver un compte par son adresse (relecture du 01/10/2026).
//
// `/auth/v1/admin/users?email=…` ne filtre pas : la réponse commence par le compte
// le plus récent. La pénalité anti-recréation de l'inscription tombait donc sur le
// dernier inscrit, et la réinitialisation du mot de passe changeait le sien. La
// réinitialisation est éprouvée par src/tests/api/compte-par-email.test.js (son
// lien est signé par un secret que la recette ne connaît pas).
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { inscrire, api } from "./fabrique.js";

test.describe.configure({ timeout: 200_000 });

test("inscription : la pénalité anti-recréation ne tombe plus sur le dernier inscrit", async () => {
  // E : adresse d'un compte supprimé, donc dans la liste anti-recréation.
  const E = `efface.${Date.now()}@recette.alane.test`;
  const a = await inscrire({ role: "client", prenom: "Camille", email: E, metadonnees: { telephone: "07" + String(Date.now()).slice(-8) } });
  expect((await api("/api/support", { action: "delete_account" }, a.jeton)).statut).toBe(200);

  // B : le compte le plus récent, sous une autre adresse.
  const b = await inscrire({ role: "client", prenom: "Camille", email: `recent.${Date.now()}@recette.alane.test` });
  const w = await api("/api/support", { action: "welcome", email: E, prenom: "Camille", nom: "Recette", role: "client" }, b.jeton);
  expect(w.statut).toBe(200);
  const [r] = await sql(`select trial_exhausted from profiles where id = '${b.id}'`);
  expect(r.trial_exhausted, "B n'a rien à voir avec le compte supprimé").toBe(false);
});
