// Supprimer au back-office un compte dont une prestation a commencé (décision D3
// d'Alexandre, 14/10/2026). La suppression la remboursait en entier et
// l'annulait : le prestataire n'était pas payé du travail déjà fait. Elle est
// désormais refusée, comme pour un litige, tant que la prestation n'est pas
// terminée.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, client, reservationPayee, api, bo, paiementStripe } from "./fabrique.js";

test.describe.configure({ timeout: 200_000 });

test("prestation commencée : la suppression du client est refusée, rien n'est remboursé", async () => {
  const p = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: p, client: c, heures: 4 });
  const ok = await api("/api/missions", { action: "respond_mission", mission_id: m.id, response: "accept" }, p.jeton);
  expect(ok.statut, ok.texte.slice(0, 200)).toBe(200);
  await sql(`update missions set started_at = now() - interval '1 hour' where id = '${m.id}'`);

  const r = await bo("delete", { profileId: c.id, reason: "Scénario 91" });
  expect(r.statut, r.texte.slice(0, 200)).toBe(409);
  expect(r.json?.error).toMatch(/prestation commencée/);

  const [l] = await sql(`select status from missions where id = '${m.id}'`);
  expect(l.status, "la prestation continue").toBe("assigned");
  expect((await paiementStripe(m.paymentIntent)).rembourse, "rien n'est rendu").toBe(0);
  const [compte] = await sql(`select count(*)::int n from auth.users where id = '${c.id}'`);
  expect(compte.n, "le compte existe toujours").toBe(1);
});
