// « Nous contacter » ouvert depuis l'accueil ramenait au choix du profil
// (relecture du 03/11/2026) : le retour suit désormais l'écran d'origine.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../App.jsx", import.meta.url), "utf8");

describe("retour depuis « Nous contacter »", () => {
  it("l'accueil et le choix du profil notent d'où l'on vient", () => {
    expect(app).toMatch(/onContact=\{\(\)=>\{ setRetourContact\("splash"\); setScreen\("public_contact"\); \}\}/);
    expect(app).toMatch(/if\(r==="contact"\)\{ setRetourContact\("role"\);/);
  });
  it("le bouton retour y ramène", () => {
    expect(app).toContain('<PublicContactScreen onBack={()=>setScreen(retourContact)} />');
  });
});
