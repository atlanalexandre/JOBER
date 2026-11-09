// Le défilement vers une section ne décale pas la page sur téléphone (09/11/2026).
//
// `scrollIntoView` faisait défiler aussi les cadres masqués (overflow: hidden)
// de la page : sur iPhone, le texte collait au bord gauche après un clic sur
// une case de l'accueil, ou sur un secteur du catalogue. Tout passe désormais
// par src/lib/defiler.js. Ce scénario joue ces clics sur l'écran d'un téléphone
// (projet « mobile » de playwright.config.js) et vérifie qu'aucun cadre n'a bougé.
import { test, expect } from "@playwright/test";
import { client } from "./fabrique.js";
import { ouvrir, connexion, fermerBandeauCookies } from "./parcours.js";

/** Les cadres décalés à tort : un défilement horizontal, ou vertical dans un cadre masqué. */
const cadresDecales = (page) => page.evaluate(() => {
  const decales = [];
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (el.scrollLeft !== 0 || (el.scrollTop !== 0 && cs.overflowY === "hidden")) decales.push(`${el.tagName}.${String(el.className).slice(0, 30)}`);
  }
  return { decales, x: window.scrollX, deborde: document.documentElement.scrollWidth > window.innerWidth };
});

test("accueil : les cases « client » et « indépendant » mènent à leur texte sans décaler la page", async ({ page }) => {
  await ouvrir(page, "/");
  await fermerBandeauCookies(page);
  for (const [cas, ancre] of [["Vous êtes indépendant ?", "pour-les-independants"], ["Vous cherchez un prestataire ?", "pour-les-clients"]]) {
    await page.getByText(cas).first().click();
    await expect.poll(async () => page.evaluate((id) => Math.round(document.getElementById(id).getBoundingClientRect().top), ancre),
      { timeout: 10_000 }).toBeLessThan(120);
    const etat = await cadresDecales(page);
    expect(etat.decales, `cadres décalés après « ${cas} »`).toEqual([]);
    expect(etat.x).toBe(0);
    expect(etat.deborde).toBe(false);
  }
});

test("catalogue : un secteur choisi arrive sous la barre des secteurs, sans décaler la page", async ({ page }) => {
  const c = await client();
  await connexion(page, { espace: "client", email: c.email });
  await expect(page).not.toHaveURL(/\/auth\/signin/, { timeout: 30_000 });
  await ouvrir(page, "/providers");
  await fermerBandeauCookies(page);
  await page.getByRole("button", { name: /Divers/ }).first().click();
  await page.waitForTimeout(1500);
  const etat = await cadresDecales(page);
  expect(etat.decales, "cadres décalés après le choix d'un secteur").toEqual([]);
  expect(etat.x).toBe(0);
  expect(etat.deborde).toBe(false);
});
