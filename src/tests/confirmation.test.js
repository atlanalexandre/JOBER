// Retour du lien de confirmation d'e-mail : reconnaître le retour, et ne pas
// confondre une confirmation réussie avec un lien expiré.
import { describe, it, expect } from "vitest";
import { adresseRetourConfirmation, lireRetourConfirmation, messageConfirmationSansSession } from "../lib/confirmation.js";

describe("adresseRetourConfirmation", () => {
  it("ramène à l'accueil de l'environnement, marqué", () => {
    expect(adresseRetourConfirmation("https://www.alane.fr")).toBe("https://www.alane.fr/?confirmation=1");
  });
});

describe("lireRetourConfirmation", () => {
  it("ignore une URL sans le marqueur, même avec un code (récupération de mot de passe)", () => {
    expect(lireRetourConfirmation("?code=abc", "")).toBeNull();
    expect(lireRetourConfirmation("", "")).toBeNull();
  });

  it("reconnaît le retour tel que Supabase le renvoie", () => {
    expect(lireRetourConfirmation("?confirmation=1&code=abc", "")).toEqual({ erreur: false, codeErreur: null });
  });

  it("lit l'erreur dans la query comme dans le fragment", () => {
    expect(lireRetourConfirmation("?confirmation=1&error=access_denied&error_code=otp_expired", ""))
      .toEqual({ erreur: true, codeErreur: "otp_expired" });
    expect(lireRetourConfirmation("?confirmation=1", "#error=access_denied&error_code=otp_expired"))
      .toEqual({ erreur: true, codeErreur: "otp_expired" });
  });
});

describe("messageConfirmationSansSession", () => {
  it("un lien valide ouvert ailleurs : l'adresse est confirmée, on invite à se connecter", () => {
    const m = messageConfirmationSansSession({ erreur: false, codeErreur: null });
    expect(m.positif).toBe(true);
    expect(m.titre).toMatch(/confirmée/);
  });

  it("un lien expiré ne se présente pas comme une réussite", () => {
    const m = messageConfirmationSansSession({ erreur: true, codeErreur: "otp_expired" });
    expect(m.positif).toBe(false);
    expect(m.texte).toMatch(/otp_expired/);
  });
});
