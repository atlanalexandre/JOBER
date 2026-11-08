// La politique de confidentialité suit ce que fait l'application (09/11/2026).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { CGPS } from "../constants/cgps.js";

const lire = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

describe("la politique de confidentialité", () => {
  it("décrit les personnes citées en référence, et leurs droits", () => {
    const politique = lire("components/client-screens.jsx");
    expect(politique).toContain("9 bis. Personnes citées comme références");
    expect(politique).toContain("art. 6.1.f RGPD");
    const art14 = CGPS.sections.find(s => /Article 14/.test(s.title)).text;
    expect(art14).toContain("références d'expérience");
  });
  it("le message à la référence renvoie à la politique et à l'adresse des droits", () => {
    const m = lire("../api/_references.js");
    expect(m).toContain("rgpd@alane.fr");
    expect(m).toContain("article 9 bis");
  });
  it("une seule adresse pour exercer ses droits : rgpd@alane.fr — privacy@ n'existe pas", () => {
    for (const f of ["components/auth.jsx", "components/client-screens.jsx", "constants/cgps.js", "constants/cgu.js"]) {
      expect(lire(f), f).not.toContain("privacy@alane.fr");
    }
  });
});
