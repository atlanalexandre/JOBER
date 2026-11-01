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
  it("adresses normalisées, dédoublonnées et de forme valide avant l'envoi par lots (relecture du 31/10/2026)", () => {
    expect(action).toMatch(/const emails = \[\.\.\.new Set\(brutes\.filter\(e => formeValide\.test\(e\)\)\)\];/);
    expect(action).toMatch(/String\(u\.email \|\| ""\)\.trim\(\)\.toLowerCase\(\)/);
    expect(action.indexOf("formeValide.test")).toBeLessThan(action.indexOf("await envoyerInformation("));
  });
});
