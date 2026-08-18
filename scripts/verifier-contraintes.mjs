// ═══════════════════════════════════════════════════════════════════════════
// Valeurs écrites par le code — génère la requête qui les confronte aux CHECK
// ═══════════════════════════════════════════════════════════════════════════
//
// POURQUOI CE SCRIPT
//
// Le 18/08/2026, un prestataire ne pouvait pas accepter une prolongation. La
// cause : `missions_extra_hours_status_check` n'autorisait pas la valeur
// `accepte_presta`, introduite la veille avec la prolongation payante.
//
// Le relevé a montré DEUX autres contraintes dans le même état. La pire portait
// sur `delay_status` : la valeur `pending` y était refusée, et comme elle est
// écrite dans le même PATCH que `arrived_at`, c'est le POINTAGE ENTIER qui
// échouait — mais seulement en cas de retard de plus de quinze minutes. Le
// mécanisme d'arbitrage du décalage n'avait donc jamais fonctionné, sans que
// rien ne le signale.
//
// `npm run colonnes` couvre les colonnes qui n'existent pas. Ce script couvre
// le cas voisin et tout aussi silencieux : la colonne existe, mais la valeur
// qu'on y écrit est refusée. Dans les deux cas PostgREST rejette la requête
// ENTIÈRE, pas seulement le champ fautif.
//
// CE QU'IL FAIT
//
//   node scripts/verifier-contraintes.mjs      (ou : npm run contraintes)
//
// Il relève les valeurs littérales écrites dans les colonnes de statut, et
// imprime une requête SQL à passer sur la base. Cette requête affiche, pour
// chaque contrainte, la définition réelle — à comparer à la liste attendue,
// imprimée juste au-dessus.
//
// CE QU'IL N'EST PAS
//
// Il ne compare pas tout seul : il faudrait pour cela analyser l'expression
// SQL d'une CHECK, ce qui produirait des faux positifs sur les contraintes
// composées. Il rapproche deux listes côte à côte et laisse la lecture à un
// humain. Un contrôle qui se trompe finit ignoré, et un garde-fou ignoré ne
// protège plus rien.
// ═══════════════════════════════════════════════════════════════════════════

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Les colonnes dont le NOM est sans ambiguïté dans le code.
//
// `status`, `type` et `role` en sont volontairement absentes. Ces mots servent
// partout — statut Stripe, type de notification, type de champ de formulaire —
// et les relever produirait une liste de trente valeurs dont trois seulement
// concernent la table visée. Un contrôle qui crie sur du code légitime finit
// ignoré, et un garde-fou ignoré ne protège plus rien (CLAUDE.md §4bis).
//
// Leurs contraintes restent imprimées par la requête SQL ci-dessous : la
// comparaison est simplement laissée à l'œil, faute de pouvoir l'automatiser
// sans mentir.
const COLONNES = [
  { table: "missions", col: "extra_hours_status" },
  { table: "missions", col: "delay_status" },
  { table: "missions", col: "payout_status" },
  { table: "missions", col: "payout_hold_reason" },
  { table: "missions", col: "resolution_proposee" },
  { table: "profiles", col: "plan_abonnement" },
  { table: "mission_remplacements", col: "statut" },
];

// Les tables dont on imprime TOUTES les contraintes, y compris celles des
// colonnes trop ambiguës pour être relevées automatiquement.
const TABLES = ["missions", "profiles", "documents", "mission_remplacements", "candidatures"];

function fichiers(dossier, acc = []) {
  for (const e of readdirSync(dossier)) {
    const p = join(dossier, e);
    if (statSync(p).isDirectory()) {
      if (e === "node_modules" || e === "tests") continue;
      fichiers(p, acc);
    } else if (/\.(js|jsx|mjs)$/.test(e)) acc.push(p);
  }
  return acc;
}

const sources = [...fichiers("api"), ...fichiers("src")]
  .map(p => ({ p, texte: readFileSync(p, "utf8") }));

// Une valeur « écrite » est un littéral affecté à la colonne, ou comparé à
// elle. Les deux comptent : une comparaison à une valeur que la contrainte
// refuse signale une branche morte, ce qui est aussi un défaut.
function valeurs(col) {
  const motifs = [
    new RegExp(`${col}\\s*:\\s*["']([a-z_]+)["']`, "g"),
    new RegExp(`${col}\\s*[=!]==\\s*["']([a-z_]+)["']`, "g"),
    new RegExp(`${col}=eq\\.([a-z_]+)`, "g"),
    new RegExp(`${col}=in\\.\\(([a-z_,]+)\\)`, "g"),
  ];
  const trouvees = new Map();
  for (const { p, texte } of sources) {
    for (const m of motifs) {
      for (const r of texte.matchAll(m)) {
        for (const v of r[1].split(",")) {
          if (!v) continue;
          if (!trouvees.has(v)) trouvees.set(v, new Set());
          trouvees.get(v).add(p);
        }
      }
    }
  }
  return trouvees;
}

console.log("═".repeat(75));
console.log("  Valeurs relevées dans le code");
console.log("═".repeat(75));
console.log();

const cibles = [];
for (const { table, col } of COLONNES) {
  const trouvees = valeurs(col);
  if (trouvees.size === 0) continue;
  cibles.push(`${table}.${col}`);
  const liste = [...trouvees.keys()].sort();
  console.log(`  ${table}.${col}`);
  console.log(`    ${liste.join(", ")}`);
  console.log();
}

console.log("═".repeat(75));
console.log("  Requête à passer sur la base — comparer à la liste ci-dessus");
console.log("═".repeat(75));
console.log(`
SELECT c.conrelid::regclass::text AS "table",
       c.conname                  AS contrainte,
       pg_get_constraintdef(c.oid) AS autorise
FROM pg_constraint c
WHERE c.contype = 'c'
  AND c.conrelid::regclass::text IN (${TABLES.map(t => `'${t}'`).join(", ")})
ORDER BY 1, 2;
`);
console.log("Toute valeur imprimée plus haut et absente de la contrainte");
console.log("correspondante fera échouer L'ÉCRITURE ENTIÈRE, pas seulement");
console.log("ce champ. Une valeur présente dans la contrainte mais jamais");
console.log("écrite est inoffensive — souvent le reste d'un état retiré.");
console.log();
console.log(`Colonnes couvertes : ${cibles.length}.`);
