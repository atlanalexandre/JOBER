// Les corrections du 25/09/2026, vues À L'ÉCRAN — là où elles avaient été constatées :
//
//   #852  prix urgent   = tarif du prestataire + surcoût réglé (`urgency_surcharge`),
//                         le même sur l'écran d'urgence, la réservation et en base ;
//   #856  urgence       = 20 minutes pour répondre, annoncées telles quelles au prestataire ;
//   #853  « En route »  = seulement quand le prestataire a partagé sa position ;
//   #857  abonnement    = annuel = mensuel × 12 − 20 %, au centime, « facturés une fois par an ».
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, client, payerPrestation, reservationPayee, api } from "./fabrique.js";
import { connexion, fermerBandeauCookies } from "./parcours.js";
import { formatMontant, prixAnnuel } from "../src/constants/plans.js";

test.describe.configure({ timeout: 240_000 });

/**
 * Les deux tutoriels de l'accueil client s'ouvrent au premier passage, avec un temps de
 * retard, par-dessus l'écran : Playwright les passe dès qu'ils apparaissent.
 */
async function sansTutoriel(page, c) {
  await page.addInitScript((id) => {
    try { localStorage.setItem(`alane_tour_done_${id}`, "1"); } catch { /* stockage indisponible : le gestionnaire ci-dessous prend le relais */ }
  }, c.id);
  await page.addLocatorHandler(page.getByText("Passer le tutoriel"), (l) => l.click());
  await page.addLocatorHandler(page.getByText("Passer", { exact: true }), (l) => l.click());
}
const reglage = async (cle) => (await sql(`select value from platform_settings where key = '${cle}'`))[0]?.value;
/** « 18,00 € » → 18 ; les espaces insécables de toLocaleString sont tolérés. */
const euros = (texte) => Number(String(texte).replace(/[^\d,]/g, "").replace(",", "."));

test("urgence : le prix part du tarif du prestataire, le même de l'écran à la base, 20 minutes pour répondre", async ({ page }) => {
  const p = await prestataireOperationnel();
  const c = await client();
  const surcout = Number(await reglage("urgency_surcharge") ?? 2);

  await sansTutoriel(page, c);
  await connexion(page, { email: c.email });
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
  await fermerBandeauCookies(page);
  await page.getByText("Hôtellerie").first().click();

  // La liste des métiers, en urgence : le prix part des tarifs réels des prestataires.
  // Elle annonçait le tarif par défaut du métier + surcoût (17,50 €) quand la
  // réservation facturait 18,00 €.
  await page.getByText("Mode Urgence").click();
  await expect(page.getByText(`+${formatMontant(surcout)} HT/h`).first()).toBeVisible();
  const ligne = page.getByText("Femme/Valet de chambre", { exact: true }).first().locator("xpath=..");
  const prixListe = await ligne.getByText(/€ HT\/h/).first().innerText();
  await page.getByText("Mode Urgence").click(); // on la désactive : l'écran du métier a son propre interrupteur

  await page.getByText("Femme/Valet de chambre").first().click();
  await expect(page.getByText("← Tous les métiers")).toBeVisible();
  await page.getByText("Mode Urgence").click();
  // Le surcoût s'affiche d'abord à sa valeur par défaut (2 €), le temps de lire le réglage.
  await expect(page.getByText(`Surcoût urgence : +${surcout},00 € HT/h`)).toBeVisible();

  // L'écran d'urgence : tarif standard DU PRESTATAIRE, surcoût, total.
  const detail = page.getByText("💶 Détail du tarif urgence").locator("xpath=..");
  const standard = euros(await detail.getByText("Tarif standard").locator("xpath=following-sibling::*[1]").innerText());
  const total = euros(await detail.getByText("Tarif urgence total").locator("xpath=following-sibling::*[1]").innerText());
  const nom = (await page.getByText(/Votre demande part à .+ en /).innerText()).match(/part à (.+?) en /)[1];
  console.log(`[16] urgence : ${standard} + ${surcout} = ${total} (${nom})`);
  expect(total, "tarif du prestataire + surcoût réglé dans le back-office").toBeCloseTo(standard + surcout, 2);
  console.log(`[16] liste des métiers en urgence : « ${prixListe} »`);
  if (prixListe.startsWith("dès")) expect(euros(prixListe), "le prix « dès » est le plus bas des prestataires").toBeLessThanOrEqual(total + 0.001);
  else expect(euros(prixListe), "la liste annonce le prix facturé").toBeCloseTo(total, 2);
  await page.screenshot({ path: "e2e-resultats/captures/16-urgence.png", fullPage: true });

  // La réservation affiche le même tarif.
  await page.getByRole("button", { name: /Envoyer la prestation maintenant/ }).click();
  await expect(page.getByText(`Tarif urgence : ${formatMontant(total)} HT/h`, { exact: false })).toBeVisible();
  await page.locator("textarea").fill("Scénario de recette — urgence");
  await page.getByRole("button", { name: /Continuer/ }).click();
  await page.getByText("J'ai lu et j'accepte les termes de ce contrat").locator("xpath=preceding-sibling::div[1]").click();
  await page.getByRole("button", { name: /Signer électroniquement/ }).click();
  await page.getByRole("button", { name: /Même adresse qu'à l'inscription/ }).click();
  await page.getByRole("button", { name: /Confirmer l'adresse/ }).click();
  await page.getByRole("button", { name: /Confirmer & payer/ }).click();
  await expect(page).toHaveURL(/\/booking\/payment/);

  // En base : le tarif réellement facturé.
  const [m] = await sql(`select id, tarif_horaire, hours, montant_total from missions where client_id = '${c.id}' order by created_at desc limit 1`);
  expect(Number(m.tarif_horaire), "la prestation enregistre le tarif urgent affiché").toBeCloseTo(total, 2);

  // Payée : le serveur reconnaît l'urgence à ses frais, et donne 20 minutes au prestataire.
  // Le prestataire de l'écran porte un nom partagé par tous les comptes d'essai : on
  // affecte celui de ce scénario, ce qui ne change rien au délai calculé.
  const r = await payerPrestation({ jetonClient: c.jeton, missionId: m.id, montant: Number(m.montant_total), prestataireId: p.id });
  expect(r.etape, JSON.stringify(r)).toBe("ok");
  const [e] = await sql(`select extract(epoch from (acceptance_deadline - now()))/60 as minutes from missions where id = '${m.id}'`);
  expect(Number(e.minutes), "20 minutes pour répondre en urgence").toBeGreaterThan(17);
  expect(Number(e.minutes)).toBeLessThan(21);
  const [n] = await sql(`select body from notifications where ref_id = '${m.id}' and title = 'Nouvelle demande de prestation'`);
  expect(n?.body).toMatch(/Vous avez (19|20) minutes pour accepter ou refuser/);
});

test("suivi : « Prestation confirmée » tant que le prestataire n'a pas partagé sa position, puis « En route »", async ({ page }) => {
  const p = await prestataireOperationnel();
  const c = await client();
  const m = await reservationPayee({ prestataire: p, client: c });
  const ok = await api("/api/missions", { action: "respond_mission", mission_id: m.id, response: "accept" }, p.jeton);
  expect(ok.statut, ok.texte.slice(0, 200)).toBe(200);
  // La prestation a commencé il y a dix minutes (heure de Paris) : l'accueil la montre « en cours ».
  await sql(`update missions set date = (now() at time zone 'Europe/Paris')::date,
    heure_debut = to_char((now() at time zone 'Europe/Paris') - interval '10 minutes', 'HH24:MI') where id = '${m.id}'`);

  await sansTutoriel(page, c);
  await connexion(page, { email: c.email });
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
  await page.getByRole("button", { name: "📍" }).first().click();
  await expect(page.getByText("Prestation confirmée").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("En route vers vous")).toHaveCount(0);
  await page.screenshot({ path: "e2e-resultats/captures/16-suivi-confirmee.png", fullPage: true });

  // Le prestataire part : il partage sa position (fenêtre ouverte, la prestation a commencé).
  const pos = await api("/api/missions", { action: "update_position", mission_id: m.id, lat: 48.8566, lng: 2.3522 }, p.jeton);
  expect(pos.statut, pos.texte.slice(0, 200)).toBe(200);
  // L'écran relit la position toutes les 20 secondes.
  await expect(page.getByText("En route vers vous").first()).toBeVisible({ timeout: 45_000 });
  await page.screenshot({ path: "e2e-resultats/captures/16-suivi-en-route.png", fullPage: true });
});

test("abonnement annuel : le prix du back-office, ramené au mois au centime, et le montant annuel", async ({ page }) => {
  const p = await prestataireOperationnel();
  const prix = await reglage("subscription_prices");
  await connexion(page, { espace: "prestataire", email: p.email });
  await expect(page).toHaveURL(/\/provider\//, { timeout: 30_000 });
  await page.goto("/provider/subscription");
  await page.getByRole("button", { name: "Annuel −20 %" }).click();
  for (const plan of ["premium", "elite"]) {
    const annuel = Number(prix?.[plan]?.yearly) > 0 ? Number(prix[plan].yearly) : prixAnnuel(prix?.[plan]?.monthly);
    const mensuel = Math.round(annuel / 12 * 100) / 100;
    console.log(`[16] ${plan} : ${formatMontant(mensuel)}/mois, ${formatMontant(annuel)} par an (règle : ${formatMontant(prixAnnuel(prix?.[plan]?.monthly))})`);
    await expect(page.getByText(`soit ${formatMontant(annuel)} facturés une fois par an`)).toBeVisible();
    await expect(page.getByText(formatMontant(mensuel), { exact: false }).first()).toBeVisible();
    expect(annuel, `${plan} : le prix annuel réglé suit la règle mensuel × 12 − 20 %`).toBeCloseTo(prixAnnuel(prix[plan].monthly), 2);
  }
  await page.screenshot({ path: "e2e-resultats/captures/16-abonnement-annuel.png", fullPage: true });
});
