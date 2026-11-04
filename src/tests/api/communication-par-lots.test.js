// « Communication à tous les prestataires » (relecture du 30/10/2026) : par lots
// de 100 via api/_diffusion.js, comme l'e-mail d'information. Cinq envois en
// parallèle dépassaient la cadence de Resend, et au-delà d'une centaine de
// destinataires la fonction dépassait sa minute, arrêtée en plein envoi.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const bo = readFileSync(new URL("../../../api/bo-action.js", import.meta.url), "utf8");
const action = bo.slice(bo.indexOf('if (action === "send_global_comm")'), bo.indexOf('if (action === "send_info_mail")'));
const ecran = readFileSync(new URL("../../components/backoffice.jsx", import.meta.url), "utf8");

describe("send_global_comm", () => {
  it("envoie par lots, avec la fonction de l'e-mail d'information", () => {
    expect(action).toContain("await envoyerInformation(emails,");
    expect(action).not.toMatch(/sendEmail\(/);
    expect(action).not.toMatch(/Promise\.all\(chunk/);
  });
  it("refuse au-delà du plafond, avant d'envoyer quoi que ce soit", () => {
    expect(action.indexOf("emails.length > MAX_DESTINATAIRES")).toBeLessThan(action.indexOf("await envoyerInformation("));
  });
  it("compte ce que Resend a accepté, et dit les échecs", () => {
    expect(action).toMatch(/journaliser\("send_global_comm", \{ details: \{ envoyes, echecs/);
    expect(action).not.toMatch(/sent\+\+/);
    expect(ecran).toMatch(/\$\{j\.echecs\} envoi\(s\) en échec/);
  });
  it("adresses passées par la règle de l'e-mail d'information : forme valide, ni bannis ni jamais confirmés (relecture du 01/11/2026)", () => {
    expect(action).toMatch(/const \{ adresses: emails, ecartees \} = destinatairesInformation\(authUsers\.filter\(u => ids\.has\(u\.id\)\), profiles\);/);
    expect(action.indexOf("destinatairesInformation(")).toBeLessThan(action.indexOf("await envoyerInformation("));
  });
});

describe("forme des adresses (api/_diffusion.js)", async () => {
  const { adresseValide, destinatairesInformation } = await import("../../../api/_diffusion.js");
  it("« jean@gmail » (sans extension) est écartée : Resend refuserait le lot entier", () => {
    expect(adresseValide("jean@gmail")).toBe(false);
    expect(adresseValide("jean@gmail.com")).toBe(true);
    expect(adresseValide("jean dupont@gmail.com")).toBe(false);
    const { adresses } = destinatairesInformation([
      { id: "a", email: "jean@gmail", email_confirmed_at: "2026-01-01" },
      { id: "b", email: " Paul@Exemple.fr ", email_confirmed_at: "2026-01-01" },
    ], []);
    expect(adresses).toEqual(["paul@exemple.fr"]);
    // Comptée, pour qu'on sache qui relancer (02/11/2026).
    expect(destinatairesInformation([{ id: "a", email: "jean@gmail", email_confirmed_at: "2026-01-01" }], []).ecartees.invalides).toBe(1);
  });
  it("une adresse invalide d'un compte suspendu compte comme suspendue, et une seule fois (03/11/2026)", () => {
    const { ecartees } = destinatairesInformation([
      { id: "s", email: "susp@gmail", email_confirmed_at: "2026-01-01" },
      { id: "a", email: "jean@gmail", email_confirmed_at: "2026-01-01" },
      { id: "b", email: "JEAN@gmail", email_confirmed_at: "2026-01-01" },
    ], [{ id: "s", status: "suspended" }]);
    expect(ecartees).toMatchObject({ refusees_ou_suspendues: 1, invalides: 1 });
  });
});
