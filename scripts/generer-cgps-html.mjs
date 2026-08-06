// ═══════════════════════════════════════════════════════════════════════════
// Génération de public/cgps.html depuis la source unique
// ═══════════════════════════════════════════════════════════════════════════
//
// POURQUOI
//
// Les CGPS existaient en deux exemplaires : l'objet `cgps` de
// src/components/client-screens.jsx, affiché dans l'application, et une copie
// HTML écrite à la main dans public/cgps.html, publiquement accessible.
//
// Les deux ont divergé. La copie publique, figée au 30 juillet 2026, ignorait
// l'article 10B (intervention au bénéfice d'un tiers), l'article 10C
// (détermination du prix réellement exécuté) et la réécriture de l'article 5.2.
// Elle engageait pourtant ALANE : c'est le document qu'un client, un contrôleur
// URSSAF ou un juge consulte en premier.
//
// Deux versions d'un même contrat, dont l'une est fausse, est un risque en soi.
// La copie manuelle est donc supprimée : ce script la régénère depuis l'objet
// affiché dans l'application, seule source de vérité.
//
// USAGE
//
//     npm run cgps
//
// À relancer après toute modification de l'objet `cgps`. La CI vérifie que le
// fichier généré correspond bien à la source (npm run cgps:verifier).
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const racine = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(racine, "src/components/client-screens.jsx");
const CIBLE  = join(racine, "public/cgps.html");

// ── Extraction des sections ────────────────────────────────────────────────
//
// On lit le fichier source comme du texte plutôt que de l'importer : le module
// est un composant React qui tire des dizaines de dépendances et ne s'exécute
// pas hors navigateur. L'objet `cgps` est un littéral simple, on le découpe.

function extraireSections(source) {
  const debut = source.indexOf("    cgps: {");
  if (debut === -1) throw new Error("Objet `cgps` introuvable dans " + SOURCE);
  const fin = source.indexOf("contrat_prestation: {", debut);
  if (fin === -1) throw new Error("Fin de l'objet `cgps` introuvable");
  const bloc = source.slice(debut, fin);

  const sections = [];
  // Chaque section est `title:"…",` suivi de `text:"…"`. Les deux chaînes sont
  // des littéraux JavaScript à guillemets doubles : on les relit avec JSON.parse
  // pour que \n et les échappements soient traités exactement comme à l'exécution.
  const motif = /title:\s*("(?:[^"\\]|\\.)*")\s*,\s*\n?\s*text:\s*("(?:[^"\\]|\\.)*")/g;
  let m;
  while ((m = motif.exec(bloc)) !== null) {
    sections.push({ titre: JSON.parse(m[1]), texte: JSON.parse(m[2]) });
  }
  if (!sections.length) throw new Error("Aucune section extraite — le format de l'objet a changé");
  return sections;
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

const source = readFileSync(SOURCE, "utf8");
const sections = extraireSections(source);

// La date de version est déclarée dans la source (`maj:"…"` de l'objet cgps) et
// non déduite de git ou de l'heure de génération. Deux raisons : publier une
// nouvelle version des conditions est une décision éditoriale, et une date
// dérivée du dernier commit rendrait le contrôle CI circulaire — on génère le
// fichier AVANT de committer, il porterait donc toujours la date d'avant.
const maj = source.slice(source.indexOf("    cgps: {")).match(/maj:\s*"([^"]+)"/);
if (!maj) throw new Error("Champ `maj` absent de l'objet `cgps` — la date de version est obligatoire");

const html = rendrePage(sections, maj[1]);

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
  console.log(`[cgps] public/cgps.html régénéré — ${sections.length} articles, version du ${maj[1]}.`);
}
