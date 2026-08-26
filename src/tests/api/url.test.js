// L'adresse publique de l'application.
//
// Le 26/08/2026, un prestataire touche « Configurer mes virements » et lit
// « Stripe a refusé le lien de configuration : Redirect urls must begin with
// HTTP or HTTPS ». `APP_URL` contenait l'adresse sans schéma.
//
// Les dix-huit endroits qui la lisaient portaient pourtant tous une précaution
// — un repli sur l'adresse par défaut. Mais ce repli ne joue que si la variable
// est VIDE : renseignée et mal formée, elle passait telle quelle.
//
// Ce test éprouve les formes réellement rencontrées : celle qui a cassé, et
// celles que produit un copier-coller depuis un tableau de bord.
import { describe, it, expect, afterEach } from "vitest";
import { appUrl } from "../../../api/_url.js";

const REPLI = "https://www.alane.fr";
const avec = (v) => { process.env.APP_URL = v; return appUrl(); };

afterEach(() => { delete process.env.APP_URL; });

describe("appUrl", () => {
  it("ajoute le schéma quand il manque — le défaut qui a cassé Stripe", () => {
    expect(avec("www.alane.fr")).toBe(REPLI);
    expect(avec("alane.fr")).toBe("https://alane.fr");
  });

  it("laisse intacte une adresse déjà correcte", () => {
    expect(avec("https://www.alane.fr")).toBe(REPLI);
    expect(avec("http://localhost:5173")).toBe("http://localhost:5173");
  });

  it("retire la barre finale — sinon les liens portent un double slash", () => {
    expect(avec("https://www.alane.fr/")).toBe(REPLI);
    expect(avec("https://www.alane.fr///")).toBe(REPLI);
  });

  it("survit à un copier-coller malheureux", () => {
    // Guillemets embarqués depuis un tableau de bord, et le piège documenté du
    // projet : les espaces invisibles collés depuis un iPad.
    expect(avec('"https://www.alane.fr"')).toBe(REPLI);
    expect(avec("  www.alane.fr  ")).toBe(REPLI);
    expect(avec("'www.alane.fr'")).toBe(REPLI);
  });

  it("retombe sur l'adresse de production quand la variable est absente", () => {
    delete process.env.APP_URL;
    expect(appUrl()).toBe(REPLI);
    expect(avec("")).toBe(REPLI);
  });

  it("rend toujours une adresse exploitable par Stripe", () => {
    // La règle que Stripe applique, et qui a fait échouer la configuration.
    for (const v of ["", "www.alane.fr", "alane.fr/", '"https://www.alane.fr"', "  "]) {
      expect(avec(v)).toMatch(/^https?:\/\/.+[^/]$/);
    }
  });
});
