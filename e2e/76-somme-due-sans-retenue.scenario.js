// Somme due par un prestataire : notifiée sans promettre de retenue (étude du 13/10/2026).
//
// L'article 8B.3 des CGPS exclut depuis le 06/10/2026 toute compensation
// unilatérale. La notification de la créance annonçait encore une retenue de
// « la moitié de chacun » des versements à venir.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, bo } from "./fabrique.js";

test.describe.configure({ timeout: 180_000 });

test("créance notifiée : montant, motif, contestation — et aucune retenue annoncée", async () => {
  const p = await prestataireOperationnel();
  const r = await bo("creer_creance", { prestataire_id: p.id, montant: 12.5, motif: "Remboursement d'un litige après versement (scénario 76)" });
  expect(r.statut, r.texte.slice(0, 200)).toBe(200);
  const [n] = await sql(`select body from notifications where user_id = '${p.id}' and title = 'Somme due à ALANE' order by created_at desc limit 1`);
  expect(n, "le prestataire est prévenu").toBeTruthy();
  expect(n.body).toContain("12,50");
  expect(n.body).toContain("scénario 76");
  expect(n.body).toMatch(/Aucune retenue n'est faite sur vos versements sans votre accord écrit/);
  expect(n.body).not.toMatch(/moitié/);
  const [c] = await sql(`select statut, montant_restant from creances_prestataires where prestataire_id = '${p.id}'`);
  expect(c.statut).toBe("active");
  expect(Number(c.montant_restant)).toBe(12.5);
});
