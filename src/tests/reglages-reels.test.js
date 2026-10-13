// Des réglages qui affichent la réalité (14/10/2026) : le thème clair restait
// sombre, « Notifications : Activées » était écrit en dur, et la barre du bas
// disparaissait des écrans ouverts depuis le Profil.
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { appliquerTheme, choisirTheme, themeClairEnregistre, CLE_THEME } from "../lib/theme.js";
import { etatNotifications, LIBELLE_NOTIFICATIONS } from "../lib/push.js";

const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");
const app = readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
const main = readFileSync(new URL("../main.jsx", import.meta.url), "utf8");
const reglages = readFileSync(new URL("../components/client-screens.jsx", import.meta.url), "utf8");

describe("thème clair", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("une seule inversion, sur <html> : deux inversions s'annulaient", () => {
    const regles = [...css.matchAll(/([^{}]+)\{[^}]*filter:\s*invert/g)].map(m => m[1].trim().split("\n").pop().trim());
    expect(regles).toContain('[data-alane-theme="light"]');
    expect(css).not.toMatch(/\[data-alane-theme="light"\] (body|#root)[^{]*\{[^}]*filter/);
  });

  it("le choix est réappliqué au démarrage", () => {
    expect(main).toMatch(/appliquerTheme\(themeClairEnregistre\(\)\)/);
  });

  it("choisir le thème l'enregistre et l'applique", () => {
    const stock = {};
    vi.stubGlobal("localStorage", { getItem: k => stock[k] ?? null, setItem: (k, v) => { stock[k] = v; } });
    const attributs = {};
    vi.stubGlobal("document", { documentElement: { setAttribute: (k, v) => { attributs[k] = v; } } });
    choisirTheme(true);
    expect(stock[CLE_THEME]).toBe("1");
    expect(attributs["data-alane-theme"]).toBe("light");
    expect(themeClairEnregistre()).toBe(true);
    const racine = { setAttribute: (k, v) => { attributs[k] = v; } };
    appliquerTheme(false, racine);
    expect(attributs["data-alane-theme"]).toBe("dark");
  });

  it("sans stockage (navigation privée), thème sombre sans erreur", () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("bloqué"); } });
    expect(themeClairEnregistre()).toBe(false);
  });
});

describe("notifications", () => {
  it("la ligne des Réglages lit l'état réel", () => {
    expect(reglages).not.toMatch(/label:"Notifications", value:"Activées"/);
    expect(reglages).toMatch(/LIBELLE_NOTIFICATIONS\[notifEtat\]/);
  });

  it("chaque état a son libellé", () => {
    for (const e of ["actives", "a_activer", "bloquees", "installer", "indisponibles"]) expect(LIBELLE_NOTIFICATIONS[e]).toBeTruthy();
  });

  it("hors navigateur : indisponibles", () => {
    expect(etatNotifications()).toBe("indisponibles");
  });

  it("l'iPhone n'est plus sollicité sans geste de l'utilisateur", () => {
    expect(app).toMatch(/activerNotifications\(\{ demander: !estIOS\(\) \}\)/);
    expect(reglages.replace(/\/\/.*$/gm, "")).not.toMatch(/new Notification\(/);
  });
});

describe("barre du bas prestataire", () => {
  it("reste sur les écrans ouverts depuis le Profil ou une prestation", () => {
    const liste = app.slice(app.indexOf("const prestaScreens=["), app.indexOf("];", app.indexOf("const prestaScreens=[")));
    for (const e of ["abonnement_presta", "presta_profile_edit", "doc_upload", "micro_entreprise", "chat", "settings"]) expect(liste).toContain(`"${e}"`);
  });
  it("allume l'onglet d'où l'on vient", () => {
    expect(app).toMatch(/abonnement_presta:"p_dashboard"/);
    expect(app).toMatch(/chat:"p_missions"/);
  });
});
