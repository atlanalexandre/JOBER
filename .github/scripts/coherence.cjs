#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Contrôle de cohérence — les règles du projet, vérifiées automatiquement
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * POURQUOI CE FICHIER
 *
 * CLAUDE.md énonce des règles nées de pannes réelles. Elles étaient respectées
 * par relecture humaine, c'est-à-dire pas toujours : l'audit du 06-07/08/2026 a
 * trouvé 45 `catch` vides, trois conversions de fuseau horaire fausses, deux
 * chemins d'encaissement dont un seul contrôlé, et une variable d'environnement
 * lue avant sa déclaration.
 *
 * Chaque contrôle ci-dessous correspond à un défaut RÉELLEMENT survenu. Aucun
 * n'est théorique.
 *
 * CE QU'IL NE FAIT PAS
 *
 * Il ne cherche pas les bugs de logique métier — un montant mal calculé, une
 * condition inversée. Cela demande de comprendre l'intention, ce qu'un script
 * ne sait pas faire. C'est l'objet de l'audit IA hebdomadaire.
 *
 * Il ne signale que ce qu'il peut prouver. Un contrôle qui produit des faux
 * positifs finit ignoré, et un garde-fou ignoré ne protège plus rien.
 *
 * USAGE
 *
 *     node .github/scripts/coherence.cjs
 *
 * Sortie 0 si tout va bien, 1 s'il y a au moins une violation bloquante.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const fs = require("fs");
const path = require("path");

const RACINE = path.join(__dirname, "..", "..");

// ── Utilitaires ─────────────────────────────────────────────────────────────

function fichiers(dossier, ext = [".js", ".jsx"]) {
  const out = [];
  const abs = path.join(RACINE, dossier);
  if (!fs.existsSync(abs)) return out;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = path.join(dossier, e.name);
    if (e.isDirectory()) out.push(...fichiers(p, ext));
    else if (ext.some(x => e.name.endsWith(x))) out.push(p);
  }
  return out;
}

const lire = (f) => fs.readFileSync(path.join(RACINE, f), "utf8");

const violations = [];
const avertissements = [];

function violation(regle, fichier, ligne, detail) {
  violations.push({ regle, fichier, ligne, detail });
}
function avertissement(regle, fichier, ligne, detail) {
  avertissements.push({ regle, fichier, ligne, detail });
}

/** Parcourt un fichier ligne à ligne en ignorant les commentaires évidents. */
function parLigne(f, fn) {
  lire(f).split("\n").forEach((texte, i) => {
    const t = texte.trim();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
    fn(texte, i + 1);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Aucun `catch` vide dans /api  (CLAUDE.md règle 1.2)
// ═══════════════════════════════════════════════════════════════════════════
//
// « Le défaut le plus coûteux de ce projet. » Un catch vide transforme une
// panne franche en comportement dégradé invisible. Côté serveur, l'erreur
// avalée n'a même pas d'utilisateur pour la remarquer.
//
// Le front est exclu : `localStorage` en navigation privée est le cas légitime
// que la règle prévoit expressément.

for (const f of fichiers("api")) {
  parLigne(f, (texte, n) => {
    if (/\}\s*catch\s*(\([^)]*\))?\s*\{\s*\}/.test(texte)) {
      violation("1.2 — catch vide", f, n,
        "Journaliser l'erreur avec son contexte, ou la remonter à l'utilisateur.");
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. Variables d'environnement nettoyées dans /api  (règle 1.4)
// ═══════════════════════════════════════════════════════════════════════════
//
// Les variables Vercel du projet contiennent des espaces invisibles collés
// depuis un iPad. Un en-tête HTTP ne peut pas contenir de retour à la ligne :
// `fetch` lève AVANT d'émettre la requête. Symptômes constatés : 401 et 500
// sans message exploitable.

const ENV_SANS_NETTOYAGE = new Set([
  "RESEND_FROM", "ADMIN_EMAIL",   // espaces significatifs — exception documentée
  "NODE_ENV", "VERCEL_ENV", "VERCEL_URL", "VERCEL",
  "PLATFORM_COMMISSION_RATE",     // passé à parseFloat, insensible aux espaces
  "BO_PASSWORD",                  // comparé avec .trim(), voir bo-verify-pin
]);

for (const f of fichiers("api")) {
  parLigne(f, (texte, n) => {
    const m = [...texte.matchAll(/process\.env\.([A-Z0-9_]+)/g)];
    for (const [, nom] of m) {
      if (ENV_SANS_NETTOYAGE.has(nom)) continue;
      // Nettoyée sur la même ligne, ou passée à Object.keys/in (diagnostic).
      if (texte.includes("replace(/\\s/g")) continue;
      if (/Object\.keys\(process\.env\)/.test(texte)) continue;
      violation("1.4 — variable d'environnement non nettoyée", f, n,
        `${nom} — ajouter .replace(/\\s/g, "") ou l'ajouter aux exceptions documentées.`);
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. La clé service role ne sort jamais de /api  (règle 1.5)
// ═══════════════════════════════════════════════════════════════════════════
//
// Elle contourne toute la sécurité RLS. Dans `src/`, elle finirait dans le
// bundle public.

for (const f of fichiers("src")) {
  parLigne(f, (texte, n) => {
    if (texte.includes("SUPABASE_SERVICE_ROLE_KEY")) {
      violation("1.5 — clé service role hors /api", f, n,
        "Cette clé contourne la RLS et serait embarquée dans le bundle public.");
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. Aucun appel Supabase dans onAuthStateChange  (règle 1.3)
// ═══════════════════════════════════════════════════════════════════════════
//
// supabase-js détient un verrou pendant ce callback : toute requête lancée
// dedans part sans en-tête d'authentification, donc en rôle anonyme, et la RLS
// la rejette. C'était la cause de la déconnexion à chaque rechargement.

for (const f of fichiers("src")) {
  const src = lire(f);
  const i = src.indexOf("onAuthStateChange");
  if (i === -1) continue;
  // Fenêtre approximative du corps du callback.
  const bloc = src.slice(i, i + 1800);
  const appel = bloc.match(/supabase\.(from|rpc|storage)\(/);
  if (appel && !bloc.slice(0, bloc.indexOf(appel[0])).includes("setTimeout")) {
    const n = src.slice(0, i).split("\n").length;
    avertissement("1.3 — appel Supabase dans onAuthStateChange", f, n,
      "Sortir l'appel du callback avec setTimeout(..., 0). Vérifier manuellement : "
      + "la détection est approximative.");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. Bucket `Documents` avec une majuscule  (piège connu)
// ═══════════════════════════════════════════════════════════════════════════
//
// Une erreur de casse a empêché toute suppression de fichier pendant des mois :
// les pièces d'identité restaient en ligne après une demande de suppression.

// Seul le BUCKET prend une majuscule. `supabase.from("documents")` désigne la
// TABLE, dont le nom est bien en minuscules : ne pas la confondre, sous peine
// d'un contrôle qui crie à chaque lecture légitime et finit ignoré.
for (const f of [...fichiers("api"), ...fichiers("src")]) {
  parLigne(f, (texte, n) => {
    const stockage = /storage\/v1\/object\/documents\b/.test(texte)
                  || /storage\s*\.\s*from\(\s*["']documents["']/.test(texte)
                  || /bucket\s*:\s*["']documents["']/.test(texte);
    if (stockage) {
      violation("Bucket Documents — casse", f, n,
        'Le bucket s\'écrit "Documents" avec une majuscule. Une erreur de casse a '
        + "empêché toute suppression de fichier pendant des mois.");
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. heure_debut : jamais de comparaison naïve à Date.now()  (piège connu)
// ═══════════════════════════════════════════════════════════════════════════
//
// `heure_debut` est une heure locale française ; Vercel tourne en UTC. La
// conversion existait en quatre exemplaires recopiés à la main, dont trois
// faux — l'alerte « prestataire en retard » n'a jamais fonctionné.
//
// Toute construction de date à partir de heure_debut doit passer par _temps.js
// ou appliquer frenchOffsetMs sur la même ligne ou la suivante.

for (const f of fichiers("api")) {
  const lignes = lire(f).split("\n");
  lignes.forEach((texte, i) => {
    const t = texte.trim();
    if (t.startsWith("//") || t.startsWith("*")) return;
    // `new Date(`...T${qqch}...`)` où la source mentionne une heure
    if (!/new Date\(`[^`]*T\$\{/.test(texte)) return;
    const contexte = lignes.slice(i, i + 4).join(" ");
    const converti = /frenchOffsetMs|debutPrestationMs|finPrestationMs|retardMinutes/.test(contexte);
    // `T12:00:00` sert au calcul du jour de la semaine : insensible au fuseau.
    const jourSeulement = /T12:00:00/.test(texte);
    if (!converti && !jourSeulement) {
      violation("heure_debut — conversion de fuseau absente", f, i + 1,
        "heure_debut est une heure française, Vercel tourne en UTC. "
        + "Passer par api/_temps.js (debutPrestationMs / finPrestationMs).");
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 7. Aucun champ de diagnostic dans une réponse HTTP  (incident 06/08/2026)
// ═══════════════════════════════════════════════════════════════════════════
//
// /api/bo-verify-pin renvoyait à tout appelant anonyme la longueur exacte de
// BO_PASSWORD et la liste des noms de variables d'environnement. Le diagnostic
// a sa place dans les journaux serveur, pas dans une réponse publique.

for (const f of fichiers("api")) {
  parLigne(f, (texte, n) => {
    if (!/res\.status\([0-9]+\)\.json|return res\.json/.test(texte) && !/_debug/.test(texte)) return;
    if (/_debug/.test(texte)) {
      violation("Diagnostic exposé", f, n,
        "Un champ _debug dans une réponse HTTP est lisible par n'importe qui. "
        + "Utiliser console.error.");
    }
    if (/tempPassword|temp_password/.test(texte) && !texte.includes("console.")) {
      violation("Secret exposé", f, n,
        "Un mot de passe ne sort jamais dans une réponse HTTP.");
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 8. CSP : aucun script tiers hors Stripe  (décision du 07/08/2026)
// ═══════════════════════════════════════════════════════════════════════════
//
// Leaflet venait d'unpkg.com. Un CDN compromis exécutait du code arbitraire sur
// le site, admin.alane.fr compris puisqu'il partage le même bundle, avec accès
// au jeton de session du backoffice.

try {
  const vercel = JSON.parse(lire("vercel.json"));
  const csp = (vercel.headers || [])
    .flatMap(h => h.headers || [])
    .find(h => h.key === "Content-Security-Policy")?.value || "";
  const scriptSrc = (csp.match(/script-src ([^;]*)/) || [])[1] || "";
  const domaines = scriptSrc.split(/\s+/).filter(d => d.startsWith("http"));
  const AUTORISES = ["https://js.stripe.com"];
  for (const d of domaines) {
    if (!AUTORISES.includes(d)) {
      violation("CSP — script tiers", "vercel.json", 0,
        `${d} n'est pas dans la liste des domaines autorisés. Héberger la `
        + "bibliothèque dans public/ plutôt que d'ouvrir le CSP.");
    }
  }
  if (/script-src[^;]*'unsafe-inline'/.test(csp)) {
    violation("CSP — unsafe-inline dans script-src", "vercel.json", 0,
      "Le build ne contient aucun script inline. Retirer la directive.");
  }
} catch (e) {
  avertissement("CSP illisible", "vercel.json", 0, e.message);
}

// ═══════════════════════════════════════════════════════════════════════════
// 9. Tout écran déclaré est classé  (CLAUDE.md §3.2)
// ═══════════════════════════════════════════════════════════════════════════
//
// « Oublier l'étape 3 crée une faille : l'URL contourne le contrôle de rôle. »

try {
  const routes = lire("src/lib/routes.js");
  const app = lire("src/App.jsx");
  const ecrans = [...routes.matchAll(/^\s{2}([a-z_0-9]+):\s*"/gm)].map(m => m[1]);
  const presta = (app.match(/PRESTA_SCREENS\s*=\s*\[[^\]]*\]/) || [""])[0];
  const client = (app.match(/CLIENT_SCREENS\s*=\s*\[[^\]]*\]/) || [""])[0];
  // Un écran public est accessible avant tout rôle : les écrans de connexion
  // (`auth_client`, `auth_presta`) et d'accueil en font partie. Les exiger dans
  // une liste de rôle serait un contresens.
  const publics = (routes.match(/PUBLIC_SCREENS\s*=\s*new Set\(\[[\s\S]*?\]\)/) || [""])[0];

  // On ne signale QUE les écrans dont le nom annonce un rôle. Beaucoup d'écrans
  // sont légitimement partagés — chat, notifications, réglages, page d'attente
  // de validation — et les signaler tous noierait le vrai cas sous le bruit.
  for (const e of ecrans) {
    const pourPresta = e.startsWith("p_") || e.includes("presta");
    const pourClient = e.includes("client");
    if (!pourPresta && !pourClient) continue;
    if (publics.includes(`"${e}"`)) continue;
    const bloc = pourPresta ? presta : client;
    if (!bloc.includes(`"${e}"`)) {
      avertissement("§3.2 — écran de rôle non classé", "src/App.jsx", 0,
        `"${e}" porte un nom réservé à un rôle mais n'apparaît pas dans `
        + `${pourPresta ? "PRESTA_SCREENS" : "CLIENT_SCREENS"}. `
        + "Son URL contournerait alors le contrôle de rôle (CLAUDE.md §3.2).");
    }
  }
} catch (e) {
  avertissement("Classement des écrans illisible", "src/lib/routes.js", 0, e.message);
}

// ═══════════════════════════════════════════════════════════════════════════
// Rapport
// ═══════════════════════════════════════════════════════════════════════════

const B = "\x1b[1m", R = "\x1b[31m", J = "\x1b[33m", V = "\x1b[32m", N = "\x1b[0m";

console.log(`\n${B}Contrôle de cohérence — règles CLAUDE.md${N}\n`);

const grouper = (liste) => {
  const par = {};
  for (const v of liste) (par[v.regle] ||= []).push(v);
  return par;
};

if (violations.length) {
  console.log(`${R}${B}${violations.length} violation(s) bloquante(s)${N}\n`);
  for (const [regle, items] of Object.entries(grouper(violations))) {
    console.log(`${R}▸ ${regle}${N}  (${items.length})`);
    console.log(`  ${items[0].detail}`);
    for (const i of items.slice(0, 12)) console.log(`    ${i.fichier}:${i.ligne}`);
    if (items.length > 12) console.log(`    … et ${items.length - 12} autre(s)`);
    console.log("");
  }
}

if (avertissements.length) {
  console.log(`${J}${B}${avertissements.length} avertissement(s)${N}  — à vérifier à la main\n`);
  for (const [regle, items] of Object.entries(grouper(avertissements))) {
    console.log(`${J}▸ ${regle}${N}  (${items.length})`);
    console.log(`  ${items[0].detail}`);
    for (const i of items.slice(0, 8)) console.log(`    ${i.fichier}:${i.ligne}`);
    console.log("");
  }
}

if (!violations.length && !avertissements.length) {
  console.log(`${V}Aucune violation. Les neuf contrôles passent.${N}\n`);
} else if (!violations.length) {
  console.log(`${V}Aucune violation bloquante.${N}\n`);
}

process.exit(violations.length ? 1 : 0);
