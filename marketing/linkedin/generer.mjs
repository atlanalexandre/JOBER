// ═══════════════════════════════════════════════════════════════════════════
// Visuels LinkedIn d'ALANE — une fiche JSON en entrée, une image 1080 × 1350.
// ═══════════════════════════════════════════════════════════════════════════
//
//   npm run linkedin -- <fiche.json> <sortie.png>
//
// Le logo est celui de la page d'accueil (`ALANELogo`, src/App.jsx), les
// couleurs celles de l'application (src/constants/colors.js), les polices
// celles du site (Inter, Plus Jakarta Sans) — téléchargées depuis Google Fonts
// à la première génération, puis gardées en cache.
//
// Un texte trop long pour l'image fait ÉCHOUER la génération, avec le nom de
// la fiche : une image qui déborde ne doit jamais partir. Raccourcir le texte.
//
// Format des fiches et règles de contenu : marketing/linkedin/README.md.
// ═══════════════════════════════════════════════════════════════════════════
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";

const L = 1080, H = 1350;
const VIOLET = "#7C6FE0", VIOLET_CLAIR = "#A29BFE", OR = "#F0B429", NUIT = "#050E20", TEXTE_SECOND = "#9BA0BA";
const FOND = `linear-gradient(160deg, ${NUIT} 0%, #0A1628 40%, #162547 70%, #1E3A7B 100%)`;
// Les sept secteurs, dans les mots de la description du site (index.html).
const SECTEURS = "Propreté · Logistique · Hôtellerie · Restauration<br>Commerce · Grande distribution · Services";

// ── Polices ────────────────────────────────────────────────────────────────
async function polices(cache) {
  fs.mkdirSync(cache, { recursive: true });
  const fichiers = { "Inter": path.join(cache, "Inter.woff2"), "Plus Jakarta Sans": path.join(cache, "PlusJakartaSans-800.woff2") };
  if (Object.values(fichiers).every((f) => fs.existsSync(f))) return fichiers;
  const ua = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
  const r = await fetch("https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700;800&family=Plus+Jakarta+Sans:wght@800&display=swap",
    { headers: { "User-Agent": ua } });
  if (!r.ok) throw new Error(`polices introuvables chez Google Fonts (${r.status})`);
  const css = await r.text();
  const latin = {};
  for (const bloc of css.split("/*").slice(1)) {
    if (!bloc.startsWith(" latin */")) continue;
    const famille = bloc.match(/font-family: '([^']+)'/)?.[1];
    const url = bloc.match(/url\((https:[^)]+)\)/)?.[1];
    if (famille && url && !latin[famille]) latin[famille] = url;
  }
  for (const [famille, fichier] of Object.entries(fichiers)) {
    if (!latin[famille]) throw new Error(`police ${famille} absente de la réponse de Google Fonts`);
    const rf = await fetch(latin[famille]);
    if (!rf.ok) throw new Error(`téléchargement de ${famille} refusé (${rf.status})`);
    fs.writeFileSync(fichier, Buffer.from(await rf.arrayBuffer()));
  }
  return fichiers;
}

// ── Texte ──────────────────────────────────────────────────────────────────
/** Échappe le HTML, met l'apostrophe typographique, et **ceci** en or. */
const texte = (t) => String(t ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/'/g, "’")
  .replace(/ ([?!:;»])/g, "&nbsp;$1").replace(/« /g, "«&nbsp;")
  .replace(/\*\*(.+?)\*\*/g, `<span style="color:${OR};font-weight:800">$1</span>`);
/** Titres : la ponctuation resserrée (la police des titres l'écarte de la lettre qui précède). */
const ponct = (t) => texte(t).replace(/([,.?!])/g, '<span style="margin-left:-0.07em">$1</span>');

// ── Briques ────────────────────────────────────────────────────────────────
let n = 0;
/** Le symbole du logo. `lien` : "plein", "pointille" (en construction) ou "lumineux". */
function symbole(largeur, hauteur, lien = "plein") {
  const id = `s${++n}`;
  const traits = {
    plein: `<line x1="58" y1="55" x2="102" y2="55" stroke="url(#${id}-l)" stroke-width="3" stroke-linecap="round"/>`,
    pointille: `<line x1="58" y1="55" x2="102" y2="55" stroke="url(#${id}-l)" stroke-width="3" stroke-linecap="round" stroke-dasharray="4 5"/>`,
    // Le halo est un trait large et transparent dessous : un flou sur un trait
    // horizontal (boîte de hauteur nulle) le ferait disparaître.
    lumineux: `<line x1="58" y1="55" x2="102" y2="55" stroke="url(#${id}-l)" stroke-width="11" stroke-linecap="round" opacity="0.28"/>
      <line x1="58" y1="55" x2="102" y2="55" stroke="url(#${id}-l)" stroke-width="4" stroke-linecap="round"/>`,
  };
  return `<svg width="${largeur}" height="${hauteur}" viewBox="0 0 160 110" fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="${id}-l" x1="52" y1="55" x2="108" y2="55" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="${VIOLET}"/><stop offset="100%" stop-color="${OR}"/>
      </linearGradient>
      <filter id="${id}-g" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="6" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    <circle cx="40" cy="55" r="28" fill="${VIOLET}" opacity="0.15"/>
    <circle cx="40" cy="55" r="18" fill="${VIOLET}" filter="url(#${id}-g)"/>
    <circle cx="40" cy="55" r="7" fill="#fff"/>
    ${traits[lien] || traits.plein}
    <circle cx="120" cy="55" r="28" fill="${OR}" opacity="0.15"/>
    <circle cx="120" cy="55" r="18" fill="${OR}" filter="url(#${id}-g)"/>
    <circle cx="120" cy="55" r="7" fill="#fff"/>
  </svg>`;
}
const logo = `<div style="display:flex;align-items:center;gap:25px">${symbole(126, 84)}
  <span style="color:#fff;font-family:Inter;font-weight:700;font-size:59px;letter-spacing:-1px;line-height:1">ALANE</span></div>`;
const pastille = (t) => t ? `<span style="display:inline-block;padding:12px 24px;border:2px solid ${OR};border-radius:99px;color:${OR};font-size:22px;font-weight:700;letter-spacing:3px">${texte(t).toUpperCase()}</span>` : "";
const entete = (f) => `<div style="display:flex;align-items:center;justify-content:space-between">${logo}${pastille(f.pastille)}</div>`;
const titre = (lignes, taille, centre = false) => `<div style="font-family:'Plus Jakarta Sans';font-weight:800;font-size:${taille}px;line-height:1.06;letter-spacing:${-taille / 55}px;${centre ? "text-align:center" : ""}">
  ${(Array.isArray(lignes) ? lignes : [lignes]).map((l, i) => `<div style="color:${i === 0 ? "#fff" : VIOLET_CLAIR}">${ponct(l)}</div>`).join("")}</div>`;
const sousTitre = (t, centre = false) => t ? `<div style="margin-top:30px;color:${TEXTE_SECOND};font-size:33px;font-weight:500;line-height:1.4;${centre ? "text-align:center;margin-left:auto;margin-right:auto;max-width:860px" : ""}">${texte(t)}</div>` : "";
const couleur = (i) => (i % 2 ? OR : VIOLET);
const coche = (c) => `<div style="flex:none;width:52px;height:52px;border-radius:50%;background:${c};display:flex;align-items:center;justify-content:center;box-shadow:0 0 26px ${c}66">
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4.2 4.2L19 7" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></div>`;
const points = (liste = []) => `<div style="margin-top:64px;display:flex;flex-direction:column;gap:${liste.length > 4 ? 34 : 52}px">
  ${liste.map((p, i) => `<div style="display:flex;align-items:flex-start;gap:26px">${coche(couleur(i))}
    <div><div style="color:#fff;font-size:40px;font-weight:700;line-height:1.2">${texte(p.gras)}</div>
    ${p.detail ? `<div style="margin-top:8px;color:${TEXTE_SECOND};font-size:30px;font-weight:500;line-height:1.38">${texte(p.detail)}</div>` : ""}</div></div>`).join("")}</div>`;
const pied = (f) => `<div style="margin-top:auto;padding-top:40px;display:flex;align-items:flex-end;justify-content:space-between;gap:30px">
  <div style="color:${TEXTE_SECOND};font-size:25px;font-weight:500;line-height:1.5">${f.pied_gauche === undefined ? SECTEURS : texte(f.pied_gauche).replace(/\n/g, "<br>")}</div>
  <div style="flex:none;color:${VIOLET_CLAIR};font-size:38px;font-weight:700">${texte(f.pied_droite || "alane.fr")}</div></div>`;

// ── Les quatre modèles ─────────────────────────────────────────────────────
const MODELES = {
  // Un titre, deux à six points cochés.
  "titre-points": (f) => `${entete(f)}<div style="margin-top:110px">${titre(f.titre, 84)}</div>${sousTitre(f.sous_titre)}${points(f.points)}${pied(f)}`,
  // Un grand chiffre doré, un encadré, des points.
  "chiffre": (f) => `${entete(f)}
    <div style="margin-top:100px;display:flex;align-items:center;gap:34px">
      <div style="font-family:'Plus Jakarta Sans';font-weight:800;font-size:250px;line-height:0.9;letter-spacing:-8px;color:${OR};text-shadow:0 0 60px rgba(240,180,41,0.35)">${texte(f.chiffre)}</div>
      <div style="color:#fff;font-family:'Plus Jakarta Sans';font-weight:800;font-size:52px;line-height:1.1;letter-spacing:-1px">${texte(f.chiffre_texte)}</div>
    </div>
    ${f.encadre ? `<div style="margin-top:64px;padding:34px 38px;border-radius:24px;background:rgba(240,180,41,0.10);border:2px solid rgba(240,180,41,0.45);color:#fff;font-size:33px;font-weight:600;line-height:1.35">${texte(f.encadre)}</div>` : ""}
    ${points(f.points)}${pied(f)}`,
  // Trois ou quatre étapes numérotées, reliées comme les deux points du logo.
  "etapes": (f) => `${entete(f)}<div style="margin-top:104px">${titre(f.titre, 82)}</div>${sousTitre(f.sous_titre)}
    <div style="position:relative;margin-top:72px;display:flex;flex-direction:column;gap:${(f.etapes || []).length > 3 ? 44 : 62}px">
      <div style="position:absolute;left:41px;top:84px;bottom:84px;border-left:4px dashed rgba(162,155,254,0.45)"></div>
      ${(f.etapes || []).map((e, i) => `<div style="position:relative;display:flex;gap:32px;align-items:flex-start">
        <div style="flex:none;width:86px;height:86px;border-radius:50%;background:${couleur(i)};display:flex;align-items:center;justify-content:center;font-family:'Plus Jakarta Sans';font-weight:800;font-size:44px;color:#fff;box-shadow:0 0 34px ${couleur(i)}77">${i + 1}</div>
        <div style="padding-top:6px"><div style="color:#fff;font-size:42px;font-weight:700;line-height:1.2">${texte(e.titre)}</div>
        ${e.detail ? `<div style="margin-top:10px;color:${TEXTE_SECOND};font-size:30px;font-weight:500;line-height:1.38">${texte(e.detail)}</div>` : ""}</div></div>`).join("")}
    </div>${pied(f)}`,
  // Une annonce : le symbole au centre, un grand titre, un bouton.
  "annonce": (f) => `${entete(f)}
    <div style="margin-top:110px;display:flex;justify-content:center">${symbole(560, 385, f.lien || "plein")}</div>
    <div style="margin-top:40px">${titre(f.titre, 86, true)}</div>${sousTitre(f.sous_titre, true)}
    ${f.bouton ? `<div style="margin-top:auto;display:flex;justify-content:center"><span style="padding:26px 54px;border-radius:99px;background:${OR};color:${NUIT};font-size:36px;font-weight:800;box-shadow:0 12px 44px rgba(240,180,41,0.45)">${texte(f.bouton)}</span></div>` : pied(f)}`,
};

// ── Rendu ──────────────────────────────────────────────────────────────────
async function generer(fiche, sortie) {
  const f = JSON.parse(fs.readFileSync(fiche, "utf8"));
  const modele = MODELES[f.modele];
  if (!modele) throw new Error(`modèle inconnu « ${f.modele} » (modèles : ${Object.keys(MODELES).join(", ")})`);
  const p = await polices(process.env.ALANE_POLICES || path.join(os.tmpdir(), "alane-polices"));
  const b64 = (fichier) => fs.readFileSync(fichier).toString("base64");
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>
    @font-face { font-family: "Inter"; font-weight: 100 900; src: url(data:font/woff2;base64,${b64(p["Inter"])}) format("woff2"); }
    @font-face { font-family: "Plus Jakarta Sans"; font-weight: 800; src: url(data:font/woff2;base64,${b64(p["Plus Jakarta Sans"])}) format("woff2"); }
    * { box-sizing: border-box; margin: 0; padding: 0; } body { font-family: Inter, sans-serif; }
  </style></head><body>
  <div style="position:relative;width:${L}px;height:${H}px;background:${FOND};overflow:hidden">
    <div style="position:absolute;top:-300px;right:-300px;width:900px;height:900px;border-radius:50%;background:radial-gradient(circle, rgba(124,111,224,0.28) 0%, transparent 65%)"></div>
    <div style="position:absolute;bottom:-280px;left:-280px;width:760px;height:760px;border-radius:50%;background:radial-gradient(circle, rgba(30,58,123,0.45) 0%, transparent 65%)"></div>
    <div id="contenu" style="position:relative;height:100%;padding:84px 84px 76px;display:flex;flex-direction:column;overflow:hidden">${modele(f)}</div>
  </div></body></html>`;

  const navigateur = await chromium.launch();
  try {
    const page = await navigateur.newPage({ viewport: { width: L, height: H } });
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(() => Promise.all(["500 40px Inter", "700 40px Inter", "800 40px Inter", "800 40px 'Plus Jakarta Sans'"]
      .map((p) => document.fonts.load(p))).then(() => document.fonts.ready));
    const etat = await page.evaluate(() => {
      const c = document.getElementById("contenu");
      return { polices: document.fonts.check("700 40px Inter") && document.fonts.check("800 40px 'Plus Jakarta Sans'"),
        deborde: c.scrollHeight > c.clientHeight + 2 || c.scrollWidth > c.clientWidth + 2 };
    });
    if (!etat.polices) throw new Error("polices non chargées");
    if (etat.deborde) throw new Error(`le texte de ${path.basename(fiche)} déborde de l'image : raccourcissez-le`);
    await page.screenshot({ path: sortie });
  } finally {
    await navigateur.close();
  }
}

const [fiche, sortie] = process.argv.slice(2);
if (!fiche || !sortie) {
  console.error("Usage : npm run linkedin -- <fiche.json> <sortie.png>");
  process.exit(1);
}
generer(fiche, sortie)
  .then(() => console.log(`Visuel écrit : ${sortie}`))
  .catch((e) => { console.error(`Visuel non généré : ${e.message}`); process.exit(1); });
