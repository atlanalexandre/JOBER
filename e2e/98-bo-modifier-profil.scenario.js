// « Modifier profil » au back-office (20/10/2026) : l'IBAN, l'adresse, le code
// postal, la ville, la société et la présentation étaient ignorés par le
// serveur, qui répondait pourtant « mis à jour ». On vérifie ici, dans la base,
// que chacun est bien enregistré à sa place.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { inscrire, bo } from "./fabrique.js";

test.describe.configure({ timeout: 180_000 });

test("chaque champ modifié est enregistré, l'IBAN hors du jeton, un IBAN faux refusé", async () => {
  const p = await inscrire({ role: "prestataire", prenom: "Profil", metadonnees: { secteur: "proprete", metier: "Agent d'entretien des bureaux" } });

  const faux = await bo("update_profile", { profileId: p.id, rib: "FR7630006000011234567890188" });
  expect(faux.statut, "IBAN à la clé fausse refusé").toBe(400);

  const r = await bo("update_profile", {
    profileId: p.id, rib: "FR76 3000 6000 0112 3456 7890 189", rue: "1 rue de la Recette", cp: "75011",
    ville: "Paris", societe_nom: "Recette Profil", bio: "Présentation de recette",
  });
  expect(r.statut, JSON.stringify(r.json).slice(0, 200)).toBe(200);

  const [ligne] = await sql(`select p.rib, p.adresse, p.code_postal, p.ville, p.societe_nom,
      u.raw_user_meta_data->>'rib' as rib_jeton, u.raw_user_meta_data->>'adresse' as adresse_meta,
      u.raw_user_meta_data->>'code_postal' as cp_meta, u.raw_user_meta_data->>'bio' as bio
    from profiles p join auth.users u on u.id = p.id where p.id = '${p.id}'`);
  expect(ligne.rib).toBe("FR7630006000011234567890189");
  expect(ligne.rib_jeton, "l'IBAN n'entre pas dans le jeton").toBe(null);
  expect(ligne.adresse).toBe("1 rue de la Recette");
  expect(ligne.adresse_meta).toBe("1 rue de la Recette");
  expect(ligne.code_postal).toBe("75011");
  expect(ligne.cp_meta).toBe("75011");
  expect(ligne.ville).toBe("Paris");
  expect(ligne.societe_nom).toBe("Recette Profil");
  expect(ligne.bio).toBe("Présentation de recette");
});
