// Messagerie : participants explicites, « lu » partagé (refondue le 28/09/2026).
//
// Un message n'était rattaché à sa conversation que par une chaîne, et la règle
// de lecture y cherchait l'identifiant de l'appelant. Le non-lu vivait dans le
// navigateur. Ce qui est éprouvé ici : qui peut écrire, qui peut lire, et que le
// « lu » ne se pose que par le destinataire, conversation par conversation.
//
// Prérequis : migration 2026-09-28_messagerie_participants_explicites.sql.
import { test, expect, request } from "@playwright/test";
import { sql, RECETTE_REF } from "./outils.js";
import { prestataireOperationnel, client, api, anon, reservationPayee } from "./fabrique.js";

test.describe.configure({ timeout: 180_000 });

const REST = `https://${RECETTE_REF}.supabase.co/rest/v1/messages`;

/** Requête REST avec le jeton d'un utilisateur — la clé du navigateur, RLS comprise. */
async function rest(methode, chemin, jeton, data) {
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;
  const ctx = await request.newContext({ proxy });
  const r = await ctx.fetch(`${REST}${chemin}`, {
    method: methode,
    headers: { apikey: await anon(), Authorization: `Bearer ${jeton}`, Prefer: "return=representation" },
    ...(data ? { data } : {}),
  });
  const corps = await r.json().catch(() => null);
  await ctx.dispose();
  return { statut: r.status(), corps };
}

test("écrire, lire, marquer lu : chacun sa conversation, et rien d'autre", async () => {
  const p = await prestataireOperationnel();
  const c = await client();
  const intrus = await client();
  await reservationPayee({ prestataire: p, client: c });

  // Envoi par le client : le serveur pose les deux participants et le bon côté.
  const e = await api("/api/missions", { action: "envoyer_message", recipient_id: p.id, content: "Bonjour, recette" }, c.jeton);
  expect(e.statut, e.texte.slice(0, 200)).toBe(200);
  const [ligne] = await sql(`select client_id, prestataire_id, sender_tag, lu_at from messages where id = '${e.json.message.id}'`);
  expect(ligne.client_id).toBe(c.id);
  expect(ligne.prestataire_id).toBe(p.id);
  expect(ligne.sender_tag).toBe("client");
  expect(ligne.lu_at).toBeNull();

  // Sans prestation en commun, pas d'envoi.
  expect((await api("/api/missions", { action: "envoyer_message", recipient_id: p.id, content: "Intrusion" }, intrus.jeton)).statut).toBe(403);

  // Lecture : les deux participants, et eux seuls.
  const filtre = `?client_id=eq.${c.id}&prestataire_id=eq.${p.id}&select=id`;
  expect((await rest("GET", filtre, p.jeton)).corps).toHaveLength(1);
  expect((await rest("GET", filtre, c.jeton)).corps).toHaveLength(1);
  expect((await rest("GET", filtre, intrus.jeton)).corps, "un tiers ne lit rien").toHaveLength(0);

  // Le navigateur ne peut ni écrire, ni modifier, ni effacer (CGPS 17.1 : une pièce).
  const direct = await rest("POST", "", c.jeton, { conversation_key: `prov${p.id}-user${c.id}`, client_id: c.id, prestataire_id: p.id, sender_id: c.id, sender_tag: "client", content: "direct" });
  expect(direct.statut, "insertion directe refusée").toBeGreaterThanOrEqual(400);
  await rest("PATCH", `?id=eq.${e.json.message.id}`, c.jeton, { content: "réécrit" });
  await rest("DELETE", `?id=eq.${e.json.message.id}`, c.jeton);
  const [intact] = await sql(`select content from messages where id = '${e.json.message.id}'`);
  expect(intact?.content, "ni modifié ni effacé").toBe("Bonjour, recette");

  // Non-lu du prestataire : 1. L'auteur ne peut pas marquer son propre message lu.
  const nonLus = `?or=(client_id.eq.${p.id},prestataire_id.eq.${p.id})&sender_id=neq.${p.id}&lu_at=is.null&select=id`;
  expect((await rest("GET", nonLus, p.jeton)).corps).toHaveLength(1);
  const parAuteur = await api("/api/missions", { action: "marquer_messages_lus", interlocuteur_id: p.id }, c.jeton);
  expect(parAuteur.json.lus, "l'auteur ne marque pas son message lu").toBe(0);
  const parIntrus = await api("/api/missions", { action: "marquer_messages_lus", interlocuteur_id: c.id }, intrus.jeton);
  expect(parIntrus.json.lus, "un tiers ne marque rien").toBe(0);

  const lu = await api("/api/missions", { action: "marquer_messages_lus", interlocuteur_id: c.id }, p.jeton);
  expect(lu.statut).toBe(200);
  expect(lu.json.lus).toBe(1);
  expect((await rest("GET", nonLus, p.jeton)).corps, "badge éteint").toHaveLength(0);
});
