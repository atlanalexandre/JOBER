// ═══════════════════════════════════════════════════════════════════════════
// Colonnes écrites par /api — génère la requête qui les confronte à la base
// ═══════════════════════════════════════════════════════════════════════════
//
// POURQUOI CE SCRIPT
//
// `api/missions.js` écrivait `cancellation_reason` sur une colonne qui n'avait
// jamais existé. PostgREST répond alors 400 (code 42703) et **n'applique rien
// de la requête** — pas seulement la colonne fautive. Le résultat n'étant pas
// vérifié, l'échec était invisible.
//
// Conséquence réelle : à l'interruption d'une prestation en cours, le client
// était remboursé au prorata chez Stripe, mais la prestation restait `assigned`
// avec son montant d'origine. Elle se clôturait normalement, et le prestataire
// était payé sur le montant plein — ALANE réglait donc une somme dont elle
// venait de rendre une partie.
//
// Le défaut a été trouvé par hasard, en écrivant une requête de nettoyage. Ce
// script est là pour qu'on n'ait plus à compter sur le hasard.
//
// CE QU'IL FAIT
//
//   node scripts/verifier-colonnes.mjs        (ou : npm run colonnes)
//
// Il relève toutes les colonnes écrites vers PostgREST depuis `api/`, et
// imprime une requête SQL à exécuter sur la base. Cette requête ne renvoie
// que les colonnes ABSENTES. Attendu : zéro ligne.
//
// CE QU'IL N'EST PAS
//
// Ce n'est pas un contrôle de CI, et il n'est pas branché sur `npm run
// coherence` : la réponse est dans la base, pas dans le code. C'est une aide à
// la relecture, à passer après toute migration et avant toute mise en
// production. Sa sortie se lit comme une liste de CANDIDATS : l'analyse est
// statique, elle peut manquer une écriture construite dynamiquement.
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync, readdirSync } from "fs";

// Clés qui vivent DANS un JSON stocké en colonne, et n'en sont donc pas.
const IMBRIQUEES = new Set([
  "lieu", "declare_le", "doc_id", "resolution", "cause", "justification",
  "accepte_le", "version", "raison", "motif_detail",
]);

/**
 * Extrait le littéral objet passé en `body:`, accolades équilibrées.
 *
 * On part de `body:` et non du premier `JSON.stringify` venu : un appel peut
 * en contenir plusieurs — un message journalisé, une réponse d'erreur — et
 * prendre le mauvais fait remonter des clés qui ne sont pas des colonnes.
 */
function corpsJson(bloc) {
  // L'accolade doit suivre IMMÉDIATEMENT `JSON.stringify(`. Sans cette
  // exigence, un corps passé par variable — `JSON.stringify(payload)` — faisait
  // chercher l'accolade bien plus loin, dans du code sans rapport : le relevé
  // remontait alors `error`, la clé d'une réponse HTTP voisine.
  const m = bloc.match(/body:\s*JSON\.stringify\(\s*\{/);
  if (!m) return null;
  const debut = m.index + m[0].length - 1;
  let prof = 0;
  for (let k = debut; k < bloc.length; k++) {
    if (bloc[k] === "{") prof++;
    else if (bloc[k] === "}") {
      prof--;
      if (prof === 0) return bloc.slice(debut, k + 1);
    }
  }
  return null;
}

/**
 * Clés de PREMIER niveau d'un littéral objet.
 *
 * Ce qui est imbriqué est du contenu de colonne JSON — `details: { error, count }`
 * dans un journal, `tiers_declaration: { lieu, declare_le }` — et remonter ces
 * clés-là ferait chercher en base des colonnes qui n'ont jamais eu vocation à
 * exister. Un contrôle qui crie sur du code légitime finit ignoré.
 */
/**
 * Vide le contenu de toutes les chaînes.
 *
 * Les gabarits contiennent des `${...}` dont les accolades faussaient
 * l'équilibrage : le corps analysé débordait sur le code suivant, et le relevé
 * remontait `error`, `webhook`, ou `e` — la variable d'un `catch`. Les chaînes
 * ordinaires, elles, contiennent du français ponctué de deux-points, d'où des
 * « colonnes » nommées `appel` ou `personne`.
 *
 * Conséquence assumée : une clé ÉCRITE ENTRE GUILLEMETS ne serait pas relevée.
 * Le code n'en contient aucune, et un relevé incomplet vaut mieux qu'un
 * contrôle qui crie sur du code légitime — celui-là, on finit par l'ignorer.
 */
const sansGabarits = (t) => t
  // Commentaires d'abord : ils sont écrits en français, ponctués de
  // deux-points, d'où des « colonnes » nommées `personne` ou `disciplinaire`.
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/[^\n]*/g, "")
  .replace(/`(?:[^`\\]|\\.)*`|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/gs, "''");

function clesDePremierNiveau(corps) {
  const cles = [];
  // Profondeur calculée en comptant les accolades qui précèdent la clé. Une
  // clé de premier niveau se trouve à la profondeur 1 — l'accolade ouvrante du
  // littéral lui-même.
  for (const t of corps.matchAll(/["']?([a-z_][a-z0-9_]*)["']?\s*:/g)) {
    const avant = corps.slice(0, t.index);
    const prof = (avant.match(/\{/g) || []).length - (avant.match(/\}/g) || []).length;
    if (prof === 1) cles.push(t[1]);
  }
  return cles;
}

const parTable = new Map();
for (const f of readdirSync("api").filter(n => n.endsWith(".js"))) {
  const src = readFileSync(`api/${f}`, "utf8");
  for (const bloc of src.split(/\bfetch\(/)) {
    const t = bloc.match(/^\s*`?\$\{[A-Z_0-9]+\}\/rest\/v1\/([a-z_]+)/);
    if (!t || t[1] === "rpc") continue;
    if (!/method:\s*["'](POST|PATCH|PUT)["']/.test(bloc)) continue;
    const corps = corpsJson(sansGabarits(bloc));
    if (!corps) continue;
    const cles = clesDePremierNiveau(corps);
    if (!parTable.has(t[1])) parTable.set(t[1], new Set());
    for (const c of cles) if (!IMBRIQUEES.has(c)) parTable.get(t[1]).add(c);
  }
}

const lignes = [];
for (const [table, cols] of [...parTable].sort()) {
  if (!cols.size) continue;
  lignes.push(`  ('${table}', ARRAY[${[...cols].sort().map(c => `'${c}'`).join(",")}])`);
}

const total = [...parTable.values()].reduce((n, s) => n + s.size, 0);

process.stdout.write(`-- ═══════════════════════════════════════════════════════════════════════
-- Colonnes écrites par les fonctions /api mais absentes de la base
-- ═══════════════════════════════════════════════════════════════════════
--
-- Généré par : npm run colonnes
-- ${parTable.size} table(s), ${total} colonne(s) relevée(s).
--
-- PostgREST refuse l'INTÉGRALITÉ d'une requête qui mentionne une colonne
-- inconnue, pas seulement la colonne fautive. Si le résultat n'est pas
-- vérifié, l'échec est invisible.
--
-- ATTENDU : 0 ligne. Toute ligne renvoyée est une écriture qui échoue à
-- chaque appel, en silence.

WITH ecrites(table_name, colonnes) AS (VALUES
${lignes.join(",\n")}
)
SELECT e.table_name, c AS colonne_manquante
FROM ecrites e, unnest(e.colonnes) AS c
WHERE NOT EXISTS (
  SELECT 1 FROM information_schema.columns i
  WHERE i.table_schema = 'public'
    AND i.table_name = e.table_name
    AND i.column_name = c
)
ORDER BY 1, 2;
`);
