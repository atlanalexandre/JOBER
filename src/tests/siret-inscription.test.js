// Le SIRET n'est plus écrit par le navigateur (étude d'octobre 2026) : la base le
// pose à la création du compte, et le droit de le modifier lui est retiré — un
// prestataire repoussait sinon son échéance URSSAF en changeant de SIRET.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const auth = readFileSync(new URL("../components/auth.jsx", import.meta.url), "utf8");

describe("inscription", () => {
  it("ne renvoie pas le SIRET dans la ligne de profil complétée par le navigateur", () => {
    for (const bloc of auth.split("completerProfil(data.user.id, {").slice(1)) {
      expect(bloc.slice(0, bloc.indexOf("});"))).not.toMatch(/\bsiret\s*:/);
    }
  });
});
