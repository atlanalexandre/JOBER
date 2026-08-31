import { describe, it, expect } from "vitest";
import { profilDepuisMetadonnees, roleDeclare } from "../../../api/_profil.js";

// Une inscription peut échouer APRÈS la création du compte et AVANT celle du
// profil. Le compte existe alors sans profil : son propriétaire ne peut ni se
// réinscrire (« un compte existe déjà »), ni se connecter (« profil
// introuvable »), et personne ne sait qu'il s'est inscrit.
const CANDIDAT = {
  id: "b639b67d-0000-0000-0000-000000000001",
  email: "lhermitte.f@exemple.fr",
  user_metadata: {
    role: "prestataire", prenom: " François ", nom: "Lhermitte",
    adresse: "11 Rue de la Verrerie", code_postal: "44100", ville: "Nantes",
    accepte_communications: true,
  },
};

describe("profilDepuisMetadonnees()", () => {
  it("reconstruit le profil depuis les données d'inscription", () => {
    const p = profilDepuisMetadonnees(CANDIDAT);
    expect(p.id).toBe(CANDIDAT.id);
    expect(p.role).toBe("prestataire");
    expect(p.prenom).toBe("François");        // espaces retirés
    expect(p.ville).toBe("Nantes");
  });

  // Réparer, ce n'est pas requalifier : un profil reconstruit n'accorde jamais
  // ce qu'une inscription normale n'accorde pas.
  it("n'accorde aucun droit", () => {
    const p = profilDepuisMetadonnees(CANDIDAT);
    expect(p.status).toBe("pending");
    expect(p.plan_abonnement).toBe("free");
    expect(p).not.toHaveProperty("missions_enabled");
    expect(p).not.toHaveProperty("cashback_balance");
    expect(p).not.toHaveProperty("stripe_account_id");
  });

  it("ne consent rien à la place de l'utilisateur", () => {
    const sansAccord = profilDepuisMetadonnees({ id: "x", user_metadata: { role: "client" } });
    expect(sansAccord.accepte_communications).toBe(false);
    expect(sansAccord.accepte_communications_at).toBeNull();
    // Une valeur autre que `true` ne vaut pas consentement.
    const bancal = profilDepuisMetadonnees({ id: "x", user_metadata: { accepte_communications: "oui" } });
    expect(bancal.accepte_communications).toBe(false);
  });

  it("ne se casse pas sur des métadonnées absentes", () => {
    const p = profilDepuisMetadonnees({ id: "x" });
    expect(p.role).toBe("client");
    expect(p.prenom).toBeNull();
    expect(p.status).toBe("pending");
  });
});

// Le balayage automatique décide pour quelqu'un d'absent : il ne doit rien
// inventer. Un compte sans rôle déclaré est signalé, pas rangé d'office.
describe("roleDeclare()", () => {
  it("ne reconnaît que les deux rôles réellement déclarables", () => {
    expect(roleDeclare(CANDIDAT)).toBe("prestataire");
    expect(roleDeclare({ user_metadata: { role: "client" } })).toBe("client");
  });

  it("renvoie null plutôt que de trancher", () => {
    for (const meta of [{}, { role: "" }, { role: "admin" }, { role: "Prestataire" }]) {
      expect(roleDeclare({ user_metadata: meta })).toBeNull();
    }
    expect(roleDeclare(null)).toBeNull();
  });
});
