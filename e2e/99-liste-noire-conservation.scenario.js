// Durée de conservation des empreintes (CGPS art. 14.4, décision d'Alexandre
// du 21/10/2026) : à la validation d'un compte, une empreinte de moins de 3 ans
// — ou sans date — désigne un compte recréé ; une empreinte plus ancienne, non.
// C'est aussi la preuve que le filtre envoyé à la base (`dansLaConservation`)
// est accepté : refusé, il ne reconnaîtrait plus personne, en silence.
import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { sql } from "./outils.js";
import { inscrire, bo } from "./fabrique.js";

test.describe.configure({ timeout: 240_000 });

const empreinte = (email) => createHash("sha256").update(email.trim().toLowerCase()).digest("hex");

for (const [cas, date, attendu] of [
  ["empreinte d'il y a un an : compte recréé", "now() - interval '1 year'", true],
  ["empreinte sans date : comptée", "null", true],
  ["empreinte de plus de 3 ans : ne désigne plus personne", "now() - interval '4 years'", false],
]) {
  test(cas, async () => {
    const p = await inscrire({ role: "prestataire", prenom: "Conservation", metadonnees: { secteur: "proprete", metier: "Agent d'entretien des bureaux" } });
    await sql(`insert into account_blacklist (email_hash, reason, created_at) values ('${empreinte(p.email)}', 'recette conservation', ${date})`);
    try {
      await sql(`update profiles set trial_exhausted = false where id = '${p.id}'`);
      const r = await bo("approve", { profileId: p.id });
      expect(r.statut, JSON.stringify(r.json).slice(0, 200)).toBe(200);
      const [l] = await sql(`select trial_exhausted from profiles where id = '${p.id}'`);
      expect(l.trial_exhausted === true, cas).toBe(attendu);
    } finally {
      await sql(`delete from account_blacklist where email_hash = '${empreinte(p.email)}' and reason = 'recette conservation'`);
    }
  });
}
