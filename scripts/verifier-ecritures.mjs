// ═══════════════════════════════════════════════════════════════════════════
// Écritures d'argent ou de statut dont le résultat est ignoré
// ═══════════════════════════════════════════════════════════════════════════
//
// POURQUOI CE SCRIPT
//
// Quatre pannes de la même famille en une journée :
//
//   • `cancellation_reason` — le client remboursé au prorata, la prestation
//     restée ouverte au montant plein ;
//   • `stripe-refund` — remboursement parti, prestation jamais close ;
//   • `presta_cancel` — remboursement parti, prestation toujours attribuée au
//     prestataire qui venait d'annuler ;
//   • `stripe-webhook` — abonnement payé, plan jamais accordé.
//
// À chaque fois la même forme : une écriture qui suit un mouvement d'argent, et
// dont personne ne regarde le résultat. Un `.catch()` n'y change rien — il
// n'attrape que les erreurs réseau, alors qu'un refus de PostgREST résout
// normalement.
//
// CE QU'IL FAIT
//
//   npm run ecritures
//
// Il relève les PATCH/POST vers `missions` ou `profiles` qui touchent une
// colonne d'argent ou de statut sans que le résultat soit exploité.
//
// CE QU'IL N'EST PAS
//
// Ni un contrôle de CI, ni une liste de défauts. Beaucoup de ces écritures sont
// légitimes : compteurs, horodatages accessoires, écritures dont l'échec est
// sans conséquence. Le critère utile — « de l'argent a-t-il déjà bougé avant
// cette ligne ? » — ne se décide pas automatiquement.
//
// C'est une liste à relire, pas une liste à corriger. La brancher sur
// `npm run coherence` en ferait un contrôle qui crie sur du code légitime,
// donc un contrôle qu'on finit par ignorer.
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync, readdirSync } from "fs";

const SENSIBLES = /\b(status|montant_total|payout_status|payout_amount|payout_due_at|hours|actual_hours|prepaid_balance|cashback_balance|extra_hours_status|plan_abonnement|missions_enabled|stripe_transfer_id|validation_client|validation_prestataire)\s*:/;

const sansChaines = (t) => t
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")
  .replace(/`(?:[^`\\]|\\.)*`|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/gs, "''");

let n = 0;
for (const f of readdirSync("api").filter(x => x.endsWith(".js"))) {
  const src = readFileSync(`api/${f}`, "utf8");
  const lignes = src.split("\n");
  for (let i = 0; i < lignes.length; i++) {
    if (!/\bfetch\(/.test(lignes[i])) continue;
    const brut = lignes.slice(i, i + 14).join("\n");
    // La table vit DANS un gabarit : on la cherche avant de vider les chaînes.
    if (!/rest\/v1\/(missions|profiles)/.test(brut)) continue;
    const bloc = sansChaines(brut);
    if (!/method:\s*''(PATCH|POST|PUT)''|method:\s*"(PATCH|POST|PUT)"/.test(lignes.slice(i, i + 6).join("\n"))) continue;
    if (!SENSIBLES.test(bloc)) continue;
    // Résultat exploité ? affectation, .ok, await sur variable, ou .then
    const assigne = /(const|let|var)\s+\w+\s*=\s*await\s*fetch\(/.test(lignes[i])
                 || /=\s*await\s*fetch\(/.test(lignes[i]);
    if (assigne) continue;
    n++;
    console.log(`${f}:${i + 1}  ${lignes[i].trim().slice(0, 90)}`);
  }
}
console.log(`\n${n} écriture(s) sensible(s) dont le résultat est ignoré.`);
