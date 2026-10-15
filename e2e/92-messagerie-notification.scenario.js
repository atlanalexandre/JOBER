// Messagerie : le destinataire est prévenu par le serveur, depuis le message
// enregistré (décision D5 d'Alexandre, 14/10/2026).
//
// La notification partait d'un second appel, `chat_notify`, auquel le navigateur
// donnait le nom de l'expéditeur et le texte : ALANE les envoyait tels quels, à
// son nom, par e-mail et SMS, autant de fois qu'on l'appelait. La recette n'a ni
// clé d'e-mail ni clé de SMS (DOCUMENTATION.md §8) : ce qui s'y voit, c'est la
// notification dans l'application, construite au même endroit. Le plafond des
// e-mails et SMS est éprouvé par `src/tests/api/messagerie-notification.test.js`.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, client, api, reservationPayee } from "./fabrique.js";

test.describe.configure({ timeout: 180_000 });

test("le destinataire est prévenu du message enregistré, et d'aucun texte venu du navigateur", async () => {
  const p = await prestataireOperationnel();
  const c = await client();
  await reservationPayee({ prestataire: p, client: c });

  // L'ancien appel, avec un nom et un texte fabriqués : accepté, rien n'est envoyé.
  // Il créait une notification « Service client ALANE » et partait par SMS.
  const faux = await api("/api/missions", { action: "chat_notify", recipient_id: p.id,
    sender_name: "Service client ALANE", message_preview: "Votre paiement a échoué : appelez le 0899000000" }, c.jeton);
  expect(faux.statut, faux.texte.slice(0, 200)).toBe(200);
  const [forges] = await sql(`select count(*)::int n from notifications where user_id = '${p.id}'
    and (body like '%0899000000%' or title like '%Service client ALANE%')`);
  expect(forges.n, "aucune notification au texte fabriqué").toBe(0);

  const e = await api("/api/missions", { action: "envoyer_message", recipient_id: p.id, content: "Bonjour, scénario 92" }, c.jeton);
  expect(e.statut, e.texte.slice(0, 200)).toBe(200);
  const [n] = await sql(`select title, body from notifications where user_id = '${p.id}' and ref_id = '${c.id}' order by created_at desc limit 1`);
  expect(n?.body, "le texte enregistré").toBe("Bonjour, scénario 92");
  expect(n?.title).toMatch(/^💬 Nouveau message de /);
});
