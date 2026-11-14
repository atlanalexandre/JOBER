// L'e-mail de validation du profil (bo-action, `approve`) : le SIRET, que
// l'accès aux prestations exige, est réclamé à ceux qui ne l'ont pas, le CV
// aussi, et la photo n'est jamais celle de la pièce d'identité (13/11/2026).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DOCS_REQUIS } from "../../../api/_documents.js";

const racine = new URL("../../../", import.meta.url).pathname;
const bo = readFileSync(join(racine, "api/bo-action.js"), "utf8");
const debut = bo.indexOf('subject: "Bienvenue sur ALANE — Votre compte est activé ! 🎉"');
const courriel = bo.slice(bo.lastIndexOf("const tousDocsPresta", debut), bo.indexOf("});", debut));

describe("l'e-mail de validation du profil", () => {
  it("réclame le SIRET à qui ne l'a pas, lu sur la fiche puis sur l'inscription", () => {
    expect(courriel).toContain("sansSiret = !aUnSiret(fp[0] || {}, userData.user_metadata || {});");
    expect(courriel).toContain("Votre numéro SIRET est obligatoire");
    // Aucun champ ne permet de l'ajouter dans l'application après l'inscription :
    // il s'envoie au support, comme dans la relance des inscrits sans SIRET (13/11/2026).
    expect(courriel).not.toContain("Renseignez-le dans votre profil");
    expect(courriel).toContain("mailto:support@alane.fr");
  });
  it("rappelle le CV quand il est incomplet, et renvoie vers LinkedIn", () => {
    expect(courriel).toContain("cvIncomplet = manquesCv(");
    expect(courriel).toContain("https://www.linkedin.com/company/alane-fr/");
  });
  it("est signé « L'équipe ALANE » ; le compte de virement n'y est pas demandé (son lien part à l'ouverture de l'accès)", () => {
    expect(courriel).toContain("L'équipe ALANE");
    expect(courriel).toContain("vous enverrons le lien pour configurer vos virements");
  });
  it("la photo demandée n'est jamais celle de la pièce d'identité", () => {
    expect(DOCS_REQUIS.find(d => d.id === "photo").info).toContain("pas celle de votre pièce d'identité");
  });
});
