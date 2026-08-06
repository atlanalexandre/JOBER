// ═══════════════════════════════════════════════════════════════════════════
// Génération de public/cgps.html depuis la source unique
// ═══════════════════════════════════════════════════════════════════════════
//
// POURQUOI
//
// Les CGPS existaient en quatre exemplaires : le texte intégral dans
// client-screens.jsx, une copie HTML écrite à la main dans public/cgps.html, et
// deux résumés distincts dans auth.jsx — ceux que l'utilisateur validait à
// l'inscription.
//
// Tous avaient divergé. La copie publique, figée au 30 juillet 2026, ignorait
// les articles 10B et 10C ainsi que la réécriture du 5.2. Les résumés
// d'inscription, eux, étaient faux sur l'argent (voir l'en-tête de
// src/constants/cgps.js).
//
// Le texte vit désormais dans src/constants/cgps.js, importé par l'application,
// par les écrans d'inscription et par ce script. On ne recopie plus.
//
// USAGE
//
//     npm run cgps
//
// À relancer après toute modification de src/constants/cgps.js. La CI vérifie
// que le fichier généré correspond bien à la source (npm run cgps:verifier).
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const racine = join(dirname(fileURLToPath(import.meta.url)), "..");
const CIBLE  = join(racine, "public/cgps.html");

// Les CGPS sont importées, plus analysées comme du texte : `constants/cgps.js`
// n'a aucune dépendance et s'exécute tel quel hors navigateur. Le générateur lit
// donc exactement l'objet que l'application affiche, sans expression régulière
// susceptible de rater une section au premier changement de mise en forme.
const { CGPS } = await import(new URL("../src/constants/cgps.js", import.meta.url));

if (!Array.isArray(CGPS?.sections) || !CGPS.sections.length) {
  throw new Error("CGPS.sections est vide ou absent de src/constants/cgps.js");
}
if (!CGPS.maj) {
  throw new Error("Champ `maj` absent de CGPS — la date de version est obligatoire");
}

// ── Rendu ──────────────────────────────────────────────────────────────────

const echapper = (s) => String(s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// « 10C.2 Commencement décalé », « 4.2 Autonomie économique… » : un sous-titre
// numéroté ouvre le bloc et se lit mieux en gras, comme dans l'application.
const SOUS_TITRE = /^(\d+[A-Z]?(?:\.\d+)?\s+\S[^\n]{2,79})$/;

function rendreIntro(lignes) {
  if (lignes.length && SOUS_TITRE.test(lignes[0].trim())) {
    const reste = lignes.slice(1).join(" ").trim();
    return `<strong>${echapper(lignes[0].trim())}</strong>${reste ? `<br>\n    ${echapper(reste)}` : ""}`;
  }
  return echapper(lignes.join(" ").trim());
}

// Le texte des sections est du texte brut : les paragraphes sont séparés par
// une ligne vide, les listes commencent par « • ». On ne produit que du HTML
// sémantique — aucune mise en forme n'est inventée.
function rendreTexte(texte) {
  const blocs = texte.split("\n\n").map(b => b.trim()).filter(Boolean);
  return blocs.map(bloc => {
    const lignes = bloc.split("\n");
    const puces = lignes.filter(l => l.trimStart().startsWith("•"));
    if (puces.length === lignes.length) {
      const items = puces.map(l => `<li>${echapper(l.trimStart().slice(1).trim())}</li>`).join("\n      ");
      return `    <ul>\n      ${items}\n    </ul>`;
    }
    if (puces.length) {
      // Un intitulé suivi d'une liste : on rend l'intitulé puis la liste.
      const intro = lignes.filter(l => !l.trimStart().startsWith("•"));
      const items = puces.map(l => `<li>${echapper(l.trimStart().slice(1).trim())}</li>`).join("\n      ");
      return `    <p>${rendreIntro(intro)}</p>\n    <ul>\n      ${items}\n    </ul>`;
    }
    if (lignes.length > 1 && SOUS_TITRE.test(lignes[0].trim())) {
      return `    <p><strong>${echapper(lignes[0].trim())}</strong><br>\n    ${echapper(lignes.slice(1).join("\n")).replace(/\n/g, "<br>\n    ")}</p>`;
    }
    return `    <p>${echapper(bloc).replace(/\n/g, "<br>\n    ")}</p>`;
  }).join("\n");
}

function rendrePage(sections, dateMaj) {
  const corps = sections.map(s =>
    `    <h3>${echapper(s.titre)}</h3>\n${rendreTexte(s.texte)}`
  ).join("\n\n");

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Conditions Générales de Prestation de Services — ALANE</title>
  <meta name="description" content="Conditions Générales de Prestation de Services de la plateforme ALANE.">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 15px;
      line-height: 1.8;
      color: #1a1a2e;
      background: #fafafa;
      padding: 48px 20px 80px;
    }
    .wrap { max-width: 760px; margin: 0 auto; }
    header { text-align: center; margin-bottom: 48px; padding-bottom: 32px; border-bottom: 2px solid #1a1a2e; }
    .logo { font-family: system-ui, sans-serif; font-size: 13px; font-weight: 700; letter-spacing: .15em; text-transform: uppercase; color: #4a4aaa; margin-bottom: 12px; }
    h1 { font-size: 26px; line-height: 1.3; font-weight: 700; }
    .maj { font-family: system-ui, sans-serif; font-size: 13px; color: #666; margin-top: 12px; }
    h3 { font-size: 18px; margin: 36px 0 12px; padding-top: 8px; font-weight: 700; }
    p { margin-bottom: 14px; }
    ul { margin: 0 0 14px 22px; }
    li { margin-bottom: 7px; }
    strong { font-weight: 700; }
    footer { margin-top: 56px; padding-top: 24px; border-top: 1px solid #ddd; font-family: system-ui, sans-serif; font-size: 13px; color: #666; text-align: center; }
    footer a { color: #4a4aaa; }
    @media (prefers-color-scheme: dark) {
      body { background: #12121a; color: #e8e8ef; }
      header { border-bottom-color: #e8e8ef; }
      .logo { color: #9b8cff; }
      .maj, footer { color: #9a9aa8; }
      footer { border-top-color: #33333f; }
      footer a { color: #9b8cff; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <div class="logo">ALANE</div>
      <h1>Conditions Générales de Prestation de Services</h1>
      <div class="maj">Dernière mise à jour : ${echapper(dateMaj)}</div>
    </header>

${corps}

    <footer>
      ALANE · <a href="https://www.alane.fr">www.alane.fr</a><br>
      Ce document est généré automatiquement depuis les conditions affichées dans l'application.
    </footer>
  </div>
</body>
</html>
`;
}

// ── Exécution ──────────────────────────────────────────────────────────────

const sections = CGPS.sections.map(s => ({ titre: s.title, texte: s.text }));

// La date de version est déclarée dans la source (`CGPS.maj`) et non déduite de
// git ou de l'heure de génération. Deux raisons : publier une nouvelle version
// des conditions est une décision éditoriale, et une date dérivée du dernier
// commit rendrait le contrôle CI circulaire — on génère le fichier AVANT de
// committer, il porterait donc toujours la date d'avant.
const html = rendrePage(sections, CGPS.maj);

if (process.argv.includes("--verifier")) {
  const actuel = readFileSync(CIBLE, "utf8");
  if (actuel !== html) {
    console.error(
      "[cgps] public/cgps.html ne correspond plus aux conditions affichées dans l'application.\n" +
      "       Deux versions du même contrat, dont une fausse, engagent ALANE.\n" +
      "       Lancez `npm run cgps` et validez le résultat."
    );
    process.exit(1);
  }
  console.log(`[cgps] public/cgps.html est à jour (${sections.length} articles).`);
} else {
  writeFileSync(CIBLE, html);
  console.log(`[cgps] public/cgps.html régénéré — ${sections.length} articles, version du ${CGPS.maj}.`);
}
