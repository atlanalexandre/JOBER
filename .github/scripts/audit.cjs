#!/usr/bin/env node
/**
 * Audit statique JOBER
 * Vérifie la cohérence routes API, actions, colonnes DB, imports.
 * Exécuté sur chaque push main + toutes les nuits à 6h UTC.
 */

const fs   = require("fs");
const path = require("path");

const ROOT    = path.join(__dirname, "../..");
const SRC     = path.join(ROOT, "src");
const API_DIR = path.join(ROOT, "api");

const errors   = [];
const warnings = [];
const ok       = [];

function err(msg)  { errors.push("❌ " + msg); }
function warn(msg) { warnings.push("⚠️  " + msg); }
function pass(msg) { ok.push("✅ " + msg); }

// ── Lecture récursive des fichiers ───────────────────────────────────────────
function readAllFiles(dir, ext = [".jsx", ".js"]) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules") {
      results.push(...readAllFiles(full, ext));
    } else if (entry.isFile() && ext.some(e => entry.name.endsWith(e))) {
      results.push({ file: full, code: fs.readFileSync(full, "utf8") });
    }
  }
  return results;
}

// ── 1. Limite Vercel Hobby : max 12 fonctions serverless ─────────────────────
const apiFiles = fs.readdirSync(API_DIR).filter(f => f.endsWith(".js"));
if (apiFiles.length > 12) {
  err(`Trop de fonctions serverless : ${apiFiles.length}/12 (Vercel Hobby limit)\n   Fichiers: ${apiFiles.join(", ")}`);
} else {
  pass(`Fonctions serverless : ${apiFiles.length}/12`);
}

// ── 2. Routes API appelées dans le frontend ──────────────────────────────────
const srcFiles  = readAllFiles(SRC);
const fetchRegex = /fetch\(["'`]\/api\/([a-z0-9_-]+)["'`]/g;
const routeRefs  = new Map(); // route -> [fichiers]

for (const { file, code } of srcFiles) {
  let m;
  while ((m = fetchRegex.exec(code)) !== null) {
    const route = m[1];
    if (!routeRefs.has(route)) routeRefs.set(route, []);
    const rel = path.relative(ROOT, file);
    if (!routeRefs.get(route).includes(rel)) routeRefs.get(route).push(rel);
  }
}

for (const [route, files] of routeRefs) {
  const apiFile = path.join(API_DIR, route + ".js");
  if (!fs.existsSync(apiFile)) {
    err(`Route inexistante /api/${route}\n   Appelée dans : ${files.join(", ")}`);
  } else {
    pass(`/api/${route} → api/${route}.js`);
  }
}

// ── 3. Actions appelées dans le frontend vs actions gérées dans l'API ────────
const actionCallRegex  = /action:\s*["']([a-z_]+)["']/g;
const actionHandleRegex = /action\s*===\s*["']([a-z_]+)["']/g;

// Actions gérées par endpoint
const handledActions = {};
for (const fname of apiFiles) {
  const code    = fs.readFileSync(path.join(API_DIR, fname), "utf8");
  const handled = new Set();
  let m;
  while ((m = actionHandleRegex.exec(code)) !== null) handled.add(m[1]);
  handledActions[fname.replace(".js", "")] = handled;
}

// Actions appelées depuis src/
const calledActions = {}; // endpoint -> Set<action>
for (const { file, code } of srcFiles) {
  // Trouve tous les blocs fetch("/api/xxx", { body: JSON.stringify({ action: "yyy" }) })
  // Stratégie : cherche chaque fetch("/api/xxx", ...), prend le JSON.stringify le plus
  // proche qui suit, et extrait l'action à l'intérieur — évite les faux positifs.
  const fetchPosRegex = /fetch\(["'`]\/api\/([a-z0-9_-]+)["'`]/g;
  let m;
  while ((m = fetchPosRegex.exec(code)) !== null) {
    const endpoint = m[1];
    // Cherche le JSON.stringify({ dans les 400 chars qui suivent
    const window400 = code.slice(m.index, m.index + 400);
    const strStart  = window400.indexOf("JSON.stringify(");
    if (strStart === -1) continue;
    // Prend les 300 chars dans ce stringify pour trouver action
    const strSnippet  = window400.slice(strStart, strStart + 300);
    // Stoppe au prochain fetch( pour ne pas déborder sur l'appel suivant
    const nextFetch   = strSnippet.indexOf("fetch(");
    const bounded     = nextFetch > 0 ? strSnippet.slice(0, nextFetch) : strSnippet;
    const actionMatch = /action:\s*["']([a-z_]+)["']/.exec(bounded);
    if (actionMatch) {
      if (!calledActions[endpoint]) calledActions[endpoint] = new Set();
      calledActions[endpoint].add(actionMatch[1]);
    }
  }
}

for (const [endpoint, actions] of Object.entries(calledActions)) {
  const handled = handledActions[endpoint];
  if (!handled) continue; // déjà signalé comme route inexistante
  for (const action of actions) {
    if (!handled.has(action)) {
      err(`Action non gérée : /api/${endpoint} action="${action}"`);
    } else {
      pass(`/api/${endpoint} action="${action}"`);
    }
  }
}

// ── 4. Colonnes Supabase interdites ──────────────────────────────────────────
// Liste des mauvais noms de colonnes connus (anciens noms, typos)
const BANNED_COLUMNS = [
  { bad: "nb_heures",       good: "hours",       table: "missions" },
  { bad: "nombre_heures",   good: "hours",       table: "missions" },
  { bad: "total_amount",    good: "montant_total", table: "missions" },
  { bad: "hourly_rate",     good: "tarif_horaire", table: "missions" },
  { bad: "prestataire_status", good: "status",    table: "profiles" },
];

for (const { file, code } of srcFiles) {
  for (const { bad, good, table } of BANNED_COLUMNS) {
    if (code.includes(bad)) {
      const rel = path.relative(ROOT, file);
      err(`Colonne interdite "${bad}" dans ${rel}\n   Utiliser "${good}" (table ${table})`);
    }
  }
}
if (!errors.some(e => e.includes("Colonne interdite"))) {
  pass("Noms de colonnes Supabase corrects");
}

// ── 5. Imports composants React ───────────────────────────────────────────────
// Vérifie que les imports relatifs dans App.jsx existent sur le disque
const appJsx = path.join(SRC, "App.jsx");
if (fs.existsSync(appJsx)) {
  const code         = fs.readFileSync(appJsx, "utf8");
  const importRegex  = /from\s+["'](\.\/[^"']+)["']/g;
  let m;
  while ((m = importRegex.exec(code)) !== null) {
    const importPath = m[1];
    const candidates = [importPath, importPath + ".js", importPath + ".jsx"].map(p =>
      path.join(SRC, p)
    );
    if (!candidates.some(fs.existsSync)) {
      err(`Import introuvable dans App.jsx : "${importPath}"`);
    }
  }
  pass("Imports App.jsx vérifiés");
}

// ── 6. Variables d'environnement critiques ────────────────────────────────────
const REQUIRED_CLIENT_VARS = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY", "VITE_STRIPE_PUBLIC_KEY"];
const REQUIRED_SERVER_VARS = [
  "SUPABASE_SERVICE_ROLE_KEY", "RESEND_API_KEY", "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET", "BO_PASSWORD", "BO_SESSION_SECRET",
];

const allSrc = srcFiles.map(f => f.code).join("\n");
const allApi = apiFiles.map(f => fs.readFileSync(path.join(API_DIR, f), "utf8")).join("\n");

for (const v of REQUIRED_CLIENT_VARS) {
  if (!allSrc.includes(v)) warn(`Variable client non utilisée : ${v}`);
}
for (const v of REQUIRED_SERVER_VARS) {
  if (!allApi.includes(v)) warn(`Variable serveur non utilisée : ${v}`);
}
pass("Variables d'environnement vérifiées");

// ── Rapport final ─────────────────────────────────────────────────────────────
console.log("\n══════════════════════════════════════════════");
console.log("       AUDIT JOBER — " + new Date().toISOString().slice(0, 10));
console.log("══════════════════════════════════════════════\n");

if (ok.length)       console.log(ok.join("\n"));
if (warnings.length) { console.log("\n" + warnings.join("\n")); }

if (errors.length) {
  console.log("\n" + errors.join("\n"));
  console.log(`\n🔴 ${errors.length} erreur(s) critique(s) détectée(s) — build bloqué.\n`);
  process.exit(1);
} else {
  console.log(`\n✅ Audit réussi — aucun problème critique détecté.\n`);
}
