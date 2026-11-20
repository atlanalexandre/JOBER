// Back-office, « Modifier profil » : le champ « SIRET de la société (client
// professionnel) » s'affichait aussi pour un prestataire. Six SIRET y ont été
// saisis le 17/11/2026 : rangés dans `kbis`, ils n'étaient vus ni par le compteur
// « Sans SIRET », ni par la validation, ni par l'échéance URSSAF.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const bo = readFileSync(new URL("../../components/backoffice.jsx", import.meta.url), "utf8");

describe("Modifier profil — le SIRET d'un prestataire va dans son champ", () => {
  it("le champ du client professionnel n'est pas proposé pour un prestataire", () => {
    expect(bo).toContain('{p.role !== "prestataire" && <FI label="SIRET de la société (client professionnel)" field="kbis" />}');
  });
  it("le prestataire garde son champ SIRET, écrit sur sa fiche", () => {
    const bloc = bo.slice(bo.indexOf('{p.role === "prestataire" && <>'));
    expect(bloc.slice(0, 1500)).toContain('<FI label="SIRET (14 chiffres)" field="siret" />');
  });
});
