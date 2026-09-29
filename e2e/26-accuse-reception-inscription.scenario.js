// Accusé de réception de l'inscription d'un prestataire (29/09/2026).
//
// Alexandre l'envoyait à la main : celui de l'écran d'inscription ne partait presque
// jamais (aucune session tant que l'adresse n'est pas confirmée). Le serveur l'envoie
// désormais, une seule fois, au passage du traitement automatique.
//
// Prérequis : migration 2026-09-29_accuse_reception_inscription.sql.
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { inscrire, tachePlanifiee, bo } from "./fabrique.js";

test.describe.configure({ timeout: 240_000 });

test("nouvel inscrit : accusé envoyé une fois par le traitement automatique ; validé avant, rien", async () => {
  const p = await inscrire({ role: "prestataire", prenom: "Accuse", metadonnees: { telephone: "0698765432", metier: "Femme/Valet de chambre", secteur: "hotellerie" } });
  const deja = await inscrire({ role: "prestataire", prenom: "Accuse", metadonnees: { telephone: "0698765433", metier: "Serveur(se)", secteur: "hotellerie" } });
  // Validé avant le passage : il recevra le courriel de validation, pas l'accusé.
  expect((await bo("approve", { profileId: deja.id })).statut).toBe(200);

  const t = await tachePlanifiee();
  expect(t.statut, t.texte.slice(0, 200)).toBe(200);

  const [l] = await sql(`select accuse_inscription_at from profiles where id = '${p.id}'`);
  expect(l.accuse_inscription_at, "accusé envoyé et marqué").not.toBeNull();
  const [d] = await sql(`select accuse_inscription_at from profiles where id = '${deja.id}'`);
  expect(d.accuse_inscription_at, "déjà validé : pas d'accusé").toBeNull();

  // Un second passage ne renvoie rien : la date ne bouge pas.
  await tachePlanifiee();
  const [l2] = await sql(`select accuse_inscription_at from profiles where id = '${p.id}'`);
  expect(l2.accuse_inscription_at).toBe(l.accuse_inscription_at);
});
