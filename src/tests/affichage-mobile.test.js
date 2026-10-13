// Sur téléphone, il fallait souvent dézoomer pour voir tout l'écran, et la
// barre du bas disparaissait (signalé le 13/10/2026). Trois causes, trois
// garde-fous.
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { estMobile, REQUETE_MOBILE } from "../hooks/useResponsive.js";

const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");
const dossier = new URL("../components/", import.meta.url);
const sources = [
  ["App.jsx", readFileSync(new URL("../App.jsx", import.meta.url), "utf8")],
  ...readdirSync(dossier).filter(f => f.endsWith(".jsx")).map(f => [f, readFileSync(new URL(f, dossier), "utf8")]),
];

describe("téléphone ou ordinateur", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("se décide par une requête média, que le zoom ne fausse pas", () => {
    const vues = [];
    vi.stubGlobal("window", { innerWidth: 1200, matchMedia: (q) => { vues.push(q); return { matches: true }; } });
    expect(estMobile()).toBe(true);
    expect(vues).toEqual([REQUETE_MOBILE]);
  });

  it("un téléphone tenu à l'horizontale reste un téléphone", () => {
    expect(REQUETE_MOBILE).toMatch(/\(pointer: coarse\) and \(max-height: 500px\)/);
  });
});

describe("pas de zoom automatique à la saisie sur iPhone", () => {
  it("les champs passent à 16 px sur iOS", () => {
    expect(css).toMatch(/@supports \(-webkit-touch-callout: none\)\s*\{\s*input, select, textarea\s*\{\s*font-size: 16px !important;/);
  });
  it("le zoom par pincement n'est pas bloqué", () => {
    const index = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
    expect(index).not.toMatch(/maximum-scale|user-scalable/);
  });
});

describe("fenêtres plein écran", () => {
  // Une fenêtre centrée plus haute que l'écran perdait son haut et son bas, sans
  // défilement possible : le tutoriel prestataire cachait ainsi « Passer le
  // tutoriel » sur un petit iPhone. `safe center` recentre tant que ça tient,
  // et colle en haut, défilable, dès que ça dépasse.
  const fenetres = sources.flatMap(([f, src]) => src.split("\n")
    .map((l, i) => ({ f, n: i + 1, l }))
    .filter(({ l }) => l.includes('position:"fixed"') && /inset:0|top:0, *left:0, *right:0, *bottom:0/.test(l) && l.includes('display:"flex"')));

  it("il y en a bien à contrôler", () => {
    expect(fenetres.length).toBeGreaterThan(20);
  });

  it("aucune n'est centrée sans « safe »", () => {
    const fautives = fenetres.filter(({ l }) => /alignItems:"(center|flex-end)"|justifyContent:"center"/.test(l));
    expect(fautives.map(({ f, n }) => `${f}:${n}`)).toEqual([]);
  });

  it("toutes peuvent défiler", () => {
    const fixes = fenetres.filter(({ l }) => !/overflowY:"auto"|overflow:"auto"/.test(l));
    expect(fixes.map(({ f, n }) => `${f}:${n}`)).toEqual([]);
  });
});
