// Réservation payée mais jamais affectée : remboursée, pas annulée en silence
// (relecture du 04/10/2026).
//
// Le webhook ne rattache pas le paiement d'une réservation ordinaire : c'est
// l'application qui le fait, juste après. Un client qui fermait l'application à cet
// instant laissait une ligne aux mêmes marqueurs qu'un tunnel abandonné, que la
// tâche de nettoyage annulait deux heures plus tard — client débité, sans
// prestation ni remboursement.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { client, api, confirmerPaiement, creerPrestationBrute, tachePlanifiee, paiementStripe } from "./fabrique.js";

test.describe.configure({ timeout: 240_000 });

test("payée puis navigateur fermé : la prestation est remboursée avant d'être annulée", async () => {
  const c = await client();
  const id = crypto.randomUUID();
  const cree = await creerPrestationBrute(c, { id });
  expect(cree.statut, cree.texte).toBe(201);
  const intent = await api("/api/stripe-intent", { amount: 110.98, currency: "eur", mission_id: id, metadata: {} }, c.jeton);
  expect(intent.json?.clientSecret, intent.texte.slice(0, 200)).toBeTruthy();
  const pi = intent.json.clientSecret.split("_secret_")[0];
  await confirmerPaiement(intent.json.clientSecret);
  // … et l'application est fermée : aucune affectation. Trois heures passent.
  await sql(`update missions set created_at = now() - interval '3 hours' where id = '${id}'`);
  // La recherche de Stripe s'actualise en moins d'une minute.
  await new Promise((r) => setTimeout(r, 60_000));

  const r = await tachePlanifiee("/api/cron-abandon");
  expect(r.statut, r.texte.slice(0, 200)).toBe(200);

  const [l] = await sql(`select status from missions where id = '${id}'`);
  expect(l.status).toBe("cancelled");
  const s = await paiementStripe(pi);
  expect(s.rembourse, "le paiement est intégralement remboursé").toBe(s.preleve);
});
