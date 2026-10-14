// La date d'inscription ne se réécrit pas depuis le navigateur (étude du 13/10/2026).
//
// `profiles.created_at` restait modifiable par son titulaire. Elle décide de
// l'offre de lancement (les 100 premiers inscrits) et de l'échéance de
// l'attestation URSSAF : antidatée, elle donnait le quota Premium ; postdatée,
// elle repoussait la suspension indéfiniment. Migration
// `2026-10-13_secu_profils_date_inscription_non_modifiable.sql`.
import { test, expect, request } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, anon } from "./fabrique.js";

const SUPABASE = "https://qoizrysxwjmhqwuteajj.supabase.co";

test("un prestataire ne peut pas réécrire sa date d'inscription, mais modifie toujours sa ville", async () => {
  test.setTimeout(180_000);
  const p = await prestataireOperationnel();
  const [avant] = await sql(`select created_at::text c from profiles where id = '${p.id}'`);
  const h = await request.newContext({ proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined });
  const entetes = { apikey: await anon(), Authorization: `Bearer ${p.jeton}`, "Content-Type": "application/json", Prefer: "return=minimal" };

  const r = await h.patch(`${SUPABASE}/rest/v1/profiles?id=eq.${p.id}`, { headers: entetes, data: { created_at: "2030-01-01T00:00:00Z" } });
  expect(r.status(), "écriture refusée par la base").toBe(403);
  const [apres] = await sql(`select created_at::text c from profiles where id = '${p.id}'`);
  expect(apres.c).toBe(avant.c);

  const ok = await h.patch(`${SUPABASE}/rest/v1/profiles?id=eq.${p.id}`, { headers: entetes, data: { ville: "Lyon" } });
  expect(ok.status(), "les champs du profil restent modifiables").toBe(204);
});
