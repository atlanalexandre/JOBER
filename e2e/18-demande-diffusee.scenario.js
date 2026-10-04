// « Ne pas choisir le prestataire » : la demande diffusée, de bout en bout (réparée le 28/09/2026).
//
// Le client décrit son besoin sans désigner personne ; les prestataires du métier le
// voient dans leur onglet Prestations et se proposent ; le client choisit parmi eux,
// réserve et paie comme d'ordinaire. Le paiement ferme la demande et prévient les
// autres. Avant : aucun prestataire ne pouvait se proposer, et le client ne voyait
// même pas les propositions (lecture refusée par la base).
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, client, api, payerPrestation, reservationPayee } from "./fabrique.js";
import { connexion, fermerBandeauCookies } from "./parcours.js";

test.describe.configure({ timeout: 240_000 });

const dansJours = (n) => new Date(Date.now() + n * 864e5).toLocaleDateString("fr-CA", { timeZone: "Europe/Paris" });

async function sansTutoriel(page, c) {
  await page.addInitScript((id) => {
    try { localStorage.setItem(`alane_tour_done_${id}`, "1"); } catch { /* stockage indisponible : le gestionnaire ci-dessous prend le relais */ }
  }, c.id);
  await page.addLocatorHandler(page.getByText("Passer le tutoriel"), (l) => l.click());
  await page.addLocatorHandler(page.getByText("Passer", { exact: true }), (l) => l.click());
}

/** Une demande diffusée, par le même appel que l'écran (MissionRequestScreen). */
async function demandeDiffusee(c, champs = {}) {
  const { RECETTE_REF } = await import("./outils.js");
  const { anon } = await import("./fabrique.js");
  const { request } = await import("@playwright/test");
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;
  const ctx = await request.newContext({ proxy });
  const id = crypto.randomUUID();
  const r = await ctx.post(`https://${RECETTE_REF}.supabase.co/rest/v1/missions`, {
    headers: { apikey: await anon(), Authorization: `Bearer ${c.jeton}`, Prefer: "return=minimal" },
    data: { id, client_id: c.id, sector: "hotellerie", metier: "Femme/Valet de chambre", date: dansJours(6), hours: 8,
      heure_debut: "09:00", ville: "Paris", adresse: "10 rue de Rivoli", description: "Recette — demande diffusée", status: "open", ...champs },
  });
  expect(r.ok(), `demande diffusée : ${r.status()} ${(await r.text()).slice(0, 200)}`).toBeTruthy();
  await ctx.dispose();
  return id;
}

const etat = async (id) => (await sql(`select status, prestataire_id, cancellation_reason from missions where id = '${id}'`))[0];

test("par l'écran : le client diffuse, le prestataire se propose, le client le choisit et réserve", async ({ browser }) => {
  const p = await prestataireOperationnel();
  const autre = await prestataireOperationnel();
  const c = await client();

  // 1. Le client diffuse sa demande, par l'écran.
  const pageC = await browser.newPage();
  await sansTutoriel(pageC, c);
  await connexion(pageC, { email: c.email });
  await expect(pageC).toHaveURL(/\/dashboard/, { timeout: 30_000 });
  await fermerBandeauCookies(pageC);
  await pageC.getByText("Hôtellerie").first().click();
  // La liste des métiers se charge après l'en-tête : on clique jusqu'à ouvrir le métier.
  await expect(async () => {
    await pageC.getByText("Femme/Valet de chambre", { exact: true }).first().click();
    await expect(pageC.getByText("← Tous les métiers")).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
  await pageC.getByText("Ne pas choisir le prestataire").click();
  const jour = dansJours(6);
  await pageC.locator('input[type="date"]').fill(jour);
  await pageC.locator('input[type="time"]').fill("10:00");
  await pageC.getByPlaceholder("12 rue de la Paix").fill("10 rue de Rivoli");
  await pageC.getByPlaceholder("Paris").fill("Paris");
  // Une description unique : la recette accumule des demandes ouvertes semblables.
  const repere = `Recette ${Date.now()}`;
  await pageC.getByPlaceholder(/Tâches attendues/).fill(repere);
  await pageC.getByRole("button", { name: /Envoyer aux prestataires/ }).click();
  await expect(pageC.getByText("Demande diffusée")).toBeVisible({ timeout: 20_000 });
  const [d] = await sql(`select id, status, date::text, heure_debut from missions where client_id = '${c.id}' order by created_at desc limit 1`);
  expect(d.status).toBe("open");

  // 2. Le prestataire la voit dans son onglet Prestations et se propose.
  const pageP = await browser.newPage();
  // Au premier passage : demande de géolocalisation, guide des onglets, tutoriel.
  const fenetreGeo = pageP.getByText("Autoriser la géolocalisation", { exact: false });
  await pageP.addLocatorHandler(fenetreGeo, () => pageP.getByRole("button", { name: "Annuler", exact: true }).click());
  await pageP.addLocatorHandler(pageP.getByText("Passer le guide"), (l) => l.click());
  await pageP.addLocatorHandler(pageP.getByText("Passer le tutoriel"), (l) => l.click());
  await connexion(pageP, { espace: "prestataire", email: p.email });
  await expect(pageP).toHaveURL(/\/provider\//, { timeout: 30_000 });
  await expect(pageP.getByText(/📢 Demandes ouvertes/)).toBeVisible({ timeout: 20_000 });
  await pageP.screenshot({ path: "e2e-resultats/captures/18-demandes-ouvertes.png", fullPage: true });
  const carte = pageP.locator("div").filter({ hasText: repere }).filter({ has: pageP.getByRole("button", { name: /Je suis disponible/ }) }).last();
  await carte.getByRole("button", { name: /Je suis disponible/ }).click();
  await expect.poll(async () => (await sql(`select count(*)::int n from candidatures where mission_id = '${d.id}' and prestataire_id = '${p.id}'`))[0].n, { timeout: 15_000 }).toBe(1);
  const [n] = await sql(`select title from notifications where user_id = '${c.id}' and ref_id = '${d.id}' order by created_at desc limit 1`);
  expect(n?.title, "le client est prévenu").toBe("🙋 Un prestataire est disponible");

  // Un second se propose aussi (par le même appel que le bouton).
  const r2 = await api("/api/missions", { action: "candidater", mission_id: d.id }, autre.jeton);
  expect(r2.statut, r2.texte.slice(0, 200)).toBe(200);

  // 3. Le client voit les propositions, choisit, et la réservation reprend sa demande.
  await expect(pageC.getByText(/candidatures? reçues?/)).toBeVisible({ timeout: 30_000 });
  await pageC.screenshot({ path: "e2e-resultats/captures/18-propositions.png", fullPage: true });
  await pageC.getByRole("button", { name: /Choisir/ }).first().click();
  await expect(pageC.locator('input[type="date"]')).toHaveValue(jour);
  await expect(pageC.locator('input[type="time"]')).toHaveValue("10:00");
  await pageC.getByRole("button", { name: /Continuer/ }).click();
  await pageC.getByText("J'ai lu et j'accepte les termes de ce contrat").locator("xpath=preceding-sibling::div[1]").click();
  await pageC.getByRole("button", { name: /Signer électroniquement/ }).click();
  await pageC.getByRole("button", { name: /Même adresse qu'à l'inscription/ }).click();
  await pageC.getByRole("button", { name: /Confirmer l'adresse/ }).click();
  await pageC.getByRole("button", { name: /Confirmer & payer/ }).click();
  await expect(pageC).toHaveURL(/\/booking\/payment/);

  // 4. Paiement (mêmes appels que le tunnel) : le prestataire choisi a la réservation,
  //    la demande est fermée, l'autre candidat est prévenu.
  const [m] = await sql(`select id, montant_total, date::text from missions where client_id = '${c.id}' and status = 'pending_acceptance' order by created_at desc limit 1`);
  expect(m.date, "la réservation reprend la date de la demande").toBe(jour);
  const choisi = (await sql(`select prestataire_id from candidatures where mission_id = '${d.id}' order by created_at asc limit 1`))[0].prestataire_id;
  const pay = await payerPrestation({ jetonClient: c.jeton, missionId: m.id, montant: Number(m.montant_total), prestataireId: choisi, diffusionId: d.id });
  expect(pay.etape, JSON.stringify(pay)).toBe("ok");
  expect((await etat(m.id)).prestataire_id).toBe(choisi);
  const fermee = await etat(d.id);
  expect(fermee.status, "la demande diffusée est fermée").toBe("cancelled");
  const cands = await sql(`select prestataire_id, status from candidatures where mission_id = '${d.id}'`);
  expect(cands.find(x => x.prestataire_id === choisi).status).toBe("accepted");
  const perdant = cands.find(x => x.prestataire_id !== choisi);
  expect(perdant.status).toBe("rejected");
  const [np] = await sql(`select title from notifications where user_id = '${perdant.prestataire_id}' and title = 'Demande pourvue'`);
  expect(np, "l'autre candidat est prévenu").toBeTruthy();
});

test("ce que voit et peut faire un prestataire : la ville sans l'adresse, une seule proposition, son métier seulement", async () => {
  const p = await prestataireOperationnel();
  const autreMetier = await prestataireOperationnel({ metier: "Bagagiste / Portier" });
  const c = await client();
  const d = await demandeDiffusee(c);

  const lo = await api("/api/missions", { action: "list_open" }, p.jeton);
  expect(lo.statut, lo.texte.slice(0, 200)).toBe(200);
  const vue = lo.json.demandes.find(x => x.id === d);
  expect(vue, "la demande est visible du prestataire du métier").toBeTruthy();
  expect(vue.adresse, "jamais l'adresse exacte").toBeUndefined();
  expect(vue.client_id, "jamais l'identité du client").toBeUndefined();
  expect(vue.ville).toBe("Paris");

  expect((await api("/api/missions", { action: "candidater", mission_id: d }, p.jeton)).statut).toBe(200);
  expect((await api("/api/missions", { action: "candidater", mission_id: d }, p.jeton)).statut, "une seule fois").toBe(409);
  expect((await api("/api/missions", { action: "candidater", mission_id: d }, autreMetier.jeton)).statut, "autre métier").toBe(403);
  expect((await api("/api/missions", { action: "candidater", mission_id: d }, c.jeton)).statut, "un client ne se propose pas").toBe(403);
  expect((await api("/api/missions", { action: "list_open" }, c.jeton)).statut, "un client ne liste pas les demandes des autres").toBe(403);

  // Le client lit les propositions de SA demande, par le serveur ; un autre client, non.
  const g = await api("/api/missions", { action: "get_candidatures", mission_id: d }, c.jeton);
  expect(g.json?.length).toBe(1);
  const intrus = await client();
  expect((await api("/api/missions", { action: "get_candidatures", mission_id: d }, intrus.jeton)).statut).toBe(403);
});

test("le client retire sa demande : elle disparaît, ceux qui s'étaient proposés sont prévenus", async () => {
  const p = await prestataireOperationnel();
  const c = await client();
  const d = await demandeDiffusee(c);
  expect((await api("/api/missions", { action: "candidater", mission_id: d }, p.jeton)).statut).toBe(200);

  const intrus = await client();
  expect((await api("/api/missions", { action: "annuler_diffusion", mission_id: d }, intrus.jeton)).statut, "pas celle d'un autre").toBe(404);
  const r = await api("/api/missions", { action: "annuler_diffusion", mission_id: d }, c.jeton);
  expect(r.statut, r.texte.slice(0, 200)).toBe(200);
  expect((await etat(d)).status).toBe("cancelled");
  const lo = await api("/api/missions", { action: "list_open" }, p.jeton);
  expect(lo.json.demandes.some(x => x.id === d), "plus dans les demandes ouvertes").toBe(false);
  const [n] = await sql(`select body from notifications where user_id = '${p.id}' and title = 'Demande pourvue' order by created_at desc limit 1`);
  expect(n?.body).toContain("a retiré sa demande");
  expect((await api("/api/missions", { action: "candidater", mission_id: d }, p.jeton)).statut, "plus possible de se proposer").toBe(409);
});

test("payer un prestataire qui ne s'était pas proposé ne ferme pas la demande", async () => {
  // L'identifiant de la demande vient du navigateur : il ne doit fermer que ce qui concerne le payé.
  const p = await prestataireOperationnel();
  const c = await client();
  const d = await demandeDiffusee(c);
  const m = await reservationPayee({ prestataire: p, client: c, diffusionId: d });
  expect((await etat(m.id)).prestataire_id).toBe(p.id);
  expect((await etat(d)).status, "la demande reste ouverte").toBe("open");
});

test("prestation déjà payée revenue en diffusion : le premier qui se propose la prend", async () => {
  // Une prestation affectée par la plateforme repasse `open` quand plus aucun candidat
  // ne répond (cascade, affecter_tiers). Le client a payé et n'a aucun écran pour
  // choisir : se proposer ne faisait rien, jusqu'à l'annulation à l'heure prévue.
  const initial = await prestataireOperationnel();
  const preneur = await prestataireOperationnel();
  const second  = await prestataireOperationnel();
  const tropCher = await prestataireOperationnel({ tarif: 20 });
  const c = await client();
  const m = await reservationPayee({ prestataire: initial, client: c });
  // État laissé par la cascade à court de candidats (affecterCandidatSuivant).
  await sql(`update missions set status = 'open', prestataire_id = null, acceptance_deadline = null where id = '${m.id}'`);

  const lo = await api("/api/missions", { action: "list_open" }, preneur.jeton);
  expect(lo.statut).toBe(200);
  const vue = lo.json.demandes.find(d => d.id === m.id);
  expect(vue, "visible dans les demandes ouvertes").toBeTruthy();
  expect(vue.deja_payee).toBe(true);
  expect(Number(vue.tarif_horaire)).toBe(13);
  expect(vue.stripe_payment_intent, "l'identifiant Stripe ne sort pas").toBeUndefined();

  const cher = await api("/api/missions", { action: "candidater", mission_id: m.id }, tropCher.jeton);
  expect(cher.statut, "tarif réglé inférieur au sien").toBe(409);

  // La reprise attribue la prestation sur-le-champ : elle vaut acceptation, donc
  // signature du contrat (décision d'Alexandre du 01/10/2026).
  const sansSignature = await api("/api/missions", { action: "candidater", mission_id: m.id }, preneur.jeton);
  expect(sansSignature.statut, "pas de reprise sans signer le contrat").toBe(400);
  const r = await api("/api/missions", { action: "candidater", mission_id: m.id, contrat_signe: true }, preneur.jeton);
  expect(r.statut, r.texte.slice(0, 200)).toBe(200);
  expect(r.json.attribuee).toBe(true);
  const apres = await etat(m.id);
  expect(apres.status).toBe("assigned");
  expect(apres.prestataire_id).toBe(preneur.id);
  const [sig] = await sql(`select contrat_presta_signe_at from missions where id = '${m.id}'`);
  expect(sig.contrat_presta_signe_at, "signature du contrat datée à la reprise").toBeTruthy();
  const [trace] = await sql(`select status from candidatures where mission_id = '${m.id}' and prestataire_id = '${preneur.id}'`);
  expect(trace?.status, "trace horodatée du choix").toBe("accepted");
  const [n] = await sql(`select title from notifications where user_id = '${c.id}' and ref_id = '${m.id}' order by created_at desc limit 1`);
  expect(n?.title).toContain("Prestataire trouvé");

  expect((await api("/api/missions", { action: "candidater", mission_id: m.id, contrat_signe: true }, second.jeton)).statut, "déjà prise").toBe(409);
});

test("reprise directe : refusée à moins de 30 minutes du début, possible malgré une proposition antérieure", async () => {
  // Relecture du 28/09/2026. La date seule était contrôlée : une prestation de 08 h
  // restait « à prendre » à 09 h. Et une proposition faite avant la reprise directe
  // grisait le bouton, alors que seule la reprise peut faire aboutir une prestation payée.
  const initial = await prestataireOperationnel();
  const tardif = await prestataireOperationnel();
  const c = await client();

  const bientot = await reservationPayee({ prestataire: initial, client: c, debutMs: Date.now() + 10 * 60000 });
  await sql(`update missions set status = 'open', prestataire_id = null, acceptance_deadline = null where id = '${bientot.id}'`);
  const lo = await api("/api/missions", { action: "list_open" }, tardif.jeton);
  expect(lo.json.demandes.find(d => d.id === bientot.id), "masquée : commence dans 10 minutes").toBeUndefined();
  expect((await api("/api/missions", { action: "candidater", mission_id: bientot.id }, tardif.jeton)).statut).toBe(409);
  expect((await etat(bientot.id)).prestataire_id).toBeNull();

  const plusTard = await reservationPayee({ prestataire: initial, client: c, dansJours: 7 });
  await sql(`update missions set status = 'open', prestataire_id = null, acceptance_deadline = null where id = '${plusTard.id}'`);
  // Proposition « à l'ancienne », laissée en attente avant la mise en place de la reprise.
  await sql(`insert into candidatures (mission_id, prestataire_id, status) values ('${plusTard.id}', '${tardif.id}', 'pending')`);
  const r = await api("/api/missions", { action: "candidater", mission_id: plusTard.id, contrat_signe: true }, tardif.jeton);
  expect(r.statut, r.texte.slice(0, 200)).toBe(200);
  expect(r.json.attribuee).toBe(true);
  expect((await etat(plusTard.id)).prestataire_id).toBe(tardif.id);
  // La proposition antérieure devient la trace de la reprise (elle restait « en attente »).
  const [trace] = await sql(`select status from candidatures where mission_id = '${plusTard.id}' and prestataire_id = '${tardif.id}'`);
  expect(trace?.status).toBe("accepted");
});

test("par l'écran : reprendre une prestation payée fait d'abord signer le contrat", async ({ browser }) => {
  const initial = await prestataireOperationnel();
  const preneur = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: initial, client: c, dansJours: 6 });
  // Une description UNIQUE : la recette garde les demandes des essais
  // précédents, identiques à l'écran (même métier, même date, « Scénario de
  // recette »). « .first() » prenait l'une d'elles, et l'essai attendait en vain
  // sur la sienne (recette du 03/10/2026).
  const repere = `Reprise ${Date.now()}`;
  await sql(`update missions set status = 'open', prestataire_id = null, acceptance_deadline = null,
             description = '${repere}' where id = '${m.id}'`);

  const page = await browser.newPage();
  const fenetreGeo = page.getByText("Autoriser la géolocalisation", { exact: false });
  await page.addLocatorHandler(fenetreGeo, () => page.getByRole("button", { name: "Annuler", exact: true }).click());
  await page.addLocatorHandler(page.getByText("Passer le guide"), (l) => l.click());
  await page.addLocatorHandler(page.getByText("Passer le tutoriel"), (l) => l.click());
  await connexion(page, { espace: "prestataire", email: preneur.email });
  await expect(page).toHaveURL(/\/provider\//, { timeout: 30_000 });
  const carte = page.locator("div").filter({ hasText: repere }).filter({ has: page.getByRole("button", { name: /Je prends cette prestation/ }) }).last();
  await carte.getByRole("button", { name: /Je prends cette prestation/ }).click();
  await expect(page.getByText("Contrat de prestation de service").first()).toBeVisible();
  await page.locator("label").filter({ hasText: "J'ai lu et j'accepte" }).locator("div").first().click();
  await page.getByRole("button", { name: /Signer électroniquement/ }).click();
  await expect.poll(async () => (await etat(m.id)).prestataire_id, { timeout: 20_000 }).toBe(preneur.id);
  const [l] = await sql(`select contrat_presta_signe_at from missions where id = '${m.id}'`);
  expect(l.contrat_presta_signe_at, "signature datée").toBeTruthy();
  await page.close();
});
