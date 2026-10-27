// Journal comptable du mois (26/10/2026) : le relevé du solde Stripe, lu par
// tranches, éclairé par la base. C'est la preuve que la lecture Stripe dépliée
// (`expand[]=data.source.charge`) est acceptée par la clé de l'environnement,
// et que la lecture des prestations citées passe : l'une ou l'autre refusée, le
// comptable recevrait un fichier vide.
import { test, expect } from "@playwright/test";
import { bo } from "./fabrique.js";

test.describe.configure({ timeout: 120_000 });

const moisCourant = () => new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit" })
  .format(new Date()).slice(0, 7);

test("une tranche du mois : mouvements nommés, prestations retrouvées, reprise fournie", async () => {
  const r = await bo("export_comptable", { mois: moisCourant() });
  expect(r.statut, JSON.stringify(r.json).slice(0, 200)).toBe(200);
  expect(r.json.mode).toBe("test");
  const { lignes } = r.json;
  // La recette paie des réservations chaque jour : le mois n'est jamais vide.
  expect(lignes.length).toBeGreaterThan(0);
  for (const l of lignes) {
    expect(l.nature, l.mouvement).not.toMatch(/^Autre \(/);
    expect(l.mouvement).toMatch(/^txn_/);
    expect(Math.abs(Math.round((l.montant - l.frais_stripe - l.net) * 100)), l.mouvement).toBe(0);
  }
  // Des prestations de CETTE base sont retrouvées (les autres viennent de la production).
  expect(lignes.some(l => l.connue === true)).toBe(true);
  for (const l of lignes.filter(x => x.frais_service != null)) expect(l.frais_service).toBeGreaterThanOrEqual(0);
  if (r.json.suite) {
    const s = await bo("export_comptable", { mois: moisCourant(), apres: r.json.suite });
    expect(s.statut).toBe(200);
    expect(s.json.lignes[0]?.mouvement).not.toBe(lignes[0].mouvement);
  }
});

test("mois ou reprise invalides : refusés", async () => {
  expect((await bo("export_comptable", { mois: "2026-13" })).statut).toBe(400);
  expect((await bo("export_comptable", { mois: moisCourant(), apres: "x&limit=1" })).statut).toBe(400);
});
