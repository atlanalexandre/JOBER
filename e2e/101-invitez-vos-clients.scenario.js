// « Invitez vos clients » (02/11/2026) : le client inscrit par le lien d'un
// prestataire lui est rattaché ; sa première prestation d'au moins 50 €,
// terminée et sortie de sa fenêtre de contestation, lui rend ses frais de
// service en cashback et offre un mois au prestataire — une seule fois.
import { test, expect } from "@playwright/test";
import { sql, telephoneTest } from "./outils.js";
import { prestataireOperationnel, inscrire, api, reservationPayee, tachePlanifiee } from "./fabrique.js";
import { connexion, fermerBandeauCookies } from "./parcours.js";

test.describe.configure({ timeout: 300_000 });

test("le lien inscrit le client avec son prestataire, la première prestation récompense les deux", async ({ page }) => {
  const p = await prestataireOperationnel();
  expect(p.ouverture.statut, p.ouverture.texte.slice(0, 300)).toBe(200);

  // L'écran du prestataire montre son lien personnel.
  await connexion(page, { espace: "prestataire", email: p.email });
  await page.waitForURL(/\/provider\//, { timeout: 30_000 });
  await page.goto(page.url().replace(/\/provider\/.*$/, "/provider/invite-clients"));
  await fermerBandeauCookies(page);
  await expect(page.getByRole("heading", { name: "Invitez vos clients" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("lien-invitation")).toContainText(`ref=${p.id}&profil=${p.id}`);

  // Le client s'inscrit par ce lien : la base le rattache à la création du compte.
  const c = await inscrire({ role: "client", prenom: "Camille", metadonnees: {
    parrain: p.id, telephone: telephoneTest(), adresse: "10 rue de Rivoli", code_postal: "75004", ville: "Paris", type_compte: "particulier" } });
  const [lien] = await sql(`select referred_by from profiles where id = '${c.id}'`);
  expect(lien.referred_by).toBe(p.id);
  const bilan = await api("/api/support", { action: "mes_invitations" }, p.jeton);
  expect(bilan.statut, bilan.texte.slice(0, 200)).toBe(200);
  expect(bilan.json.inscrits).toBe(1);

  // La suite demande la migration 2026-11-02_invitation_clients.sql.
  const [col] = await sql("select count(*)::int n from information_schema.columns where table_name = 'profiles' and column_name = 'invitation_recompensee_at'");
  test.skip(col.n === 0, "migration 2026-11-02_invitation_clients.sql non passée sur la recette");

  // Une prestation de 65 € (5 h à 13 €), payée par carte, puis terminée il y a cinq jours.
  const r = await reservationPayee({ prestataire: p, client: c, heures: 5, tarif: 13 });
  const passe = new Date(Date.now() - 5 * 864e5).toLocaleDateString("fr-CA", { timeZone: "Europe/Paris" });
  await sql(`update missions set status = 'completed', date = '${passe}', payout_amount = 65, payout_status = 'pending' where id = '${r.id}'`);
  const fraisPayes = Math.round((r.montant - 65) * 100) / 100;

  const t = await tachePlanifiee();
  expect(t.statut, t.texte.slice(0, 300)).toBe(200);
  const [apres] = await sql(`select invitation_recompensee_at is not null recompense, invitation_mission_id::text mission,
      invitation_frais_offerts::float frais, invitation_mois_offert mois, cashback_balance::float solde from profiles where id = '${c.id}'`);
  expect(apres).toMatchObject({ recompense: true, mission: r.id, frais: fraisPayes, mois: true, solde: fraisPayes });
  const [presta] = await sql(`select plan_abonnement, subscription_end_date::date > current_date + 25 prolonge from profiles where id = '${p.id}'`);
  expect(presta).toEqual({ plan_abonnement: "premium", prolonge: true });

  // Un second passage ne verse rien de plus.
  await tachePlanifiee();
  const [encore] = await sql(`select cashback_balance::float solde from profiles where id = '${c.id}'`);
  expect(encore.solde).toBe(fraisPayes);
  const [notif] = await sql(`select count(*)::int n from notifications where user_id = '${p.id}' and title like '%client invité%'`);
  expect(notif.n).toBe(1);
});
