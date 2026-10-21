// Validation des prestataires par vagues (demande d'Alexandre du 20/10/2026) :
// la liste du back-office dit où en est chaque dossier et qui n'a pas de SIRET,
// le SIRET se saisit au back-office (contrôlé), et la relance des inscrits sans
// SIRET se prépare par un aperçu. L'envoi lui-même n'est pas joué ici : il
// écrirait à tous les comptes de test en attente.
import { test, expect } from "@playwright/test";
import { inscrire, bo } from "./fabrique.js";

test.describe.configure({ timeout: 240_000 });

// Un SIRET de 14 chiffres dont la clé de Luhn est juste.
function siretValide() {
  const base = String(Date.now()).slice(-13).padStart(13, "1");
  for (let d = 0; d <= 9; d++) {
    const s = base + d;
    let somme = 0;
    for (let i = 0; i < 14; i++) { let n = Number(s[i]); if (i % 2 === 0) { n *= 2; if (n > 9) n -= 9; } somme += n; }
    if (somme % 10 === 0) return s;
  }
  throw new Error("aucun SIRET valide trouvé");
}

const ficheDans = async (id) => {
  const r = await bo("list");
  expect(r.statut, "liste du back-office").toBe(200);
  return (Array.isArray(r.json) ? r.json : []).find(p => p.id === id);
};

test("inscrit sans SIRET : signalé, relançable, puis régularisé au back-office", async () => {
  const p = await inscrire({ role: "prestataire", prenom: "Vague", metadonnees: { secteur: "proprete", metier: "Agent d'entretien des bureaux" } });

  const avant = await ficheDans(p.id);
  expect(avant, "le compte figure dans la liste").toBeTruthy();
  expect(avant.status).toBe("pending");
  expect(avant.sans_siret, "sans SIRET").toBe(true);
  expect(avant.etat_dossier, "aucune pièce déposée").toBe("incomplet");

  const apercu = await bo("relance_sans_siret", { mode: "apercu" });
  expect(apercu.statut, JSON.stringify(apercu.json).slice(0, 200)).toBe(200);
  expect(apercu.json.destinataires, "au moins ce compte").toBeGreaterThanOrEqual(1);

  const envoiFaux = await bo("relance_sans_siret", { mode: "envoi", attendus: -1 });
  expect(envoiFaux.statut, "un nombre qui ne correspond pas à l'aperçu est refusé").toBe(409);

  const faux = await bo("update_profile", { profileId: p.id, siret: "12345678900011" });
  expect(faux.statut, "SIRET à la clé fausse refusé").toBe(400);

  const siret = siretValide();
  const bon = await bo("update_profile", { profileId: p.id, siret });
  expect(bon.statut, JSON.stringify(bon.json).slice(0, 200)).toBe(200);
  const apres = await ficheDans(p.id);
  expect(apres.sans_siret, "SIRET enregistré").toBe(false);
  expect(apres.siret).toBe(siret);
});
