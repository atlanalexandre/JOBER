// Le client annule une réservation payée que personne n'a reprise : tout lui est
// rendu, frais de service compris (décision D2 d'Alexandre, 14/10/2026).
//
// Une réservation payée repart en recherche — statut « open » — quand la cascade
// des candidats ou l'affectation par ALANE n'a trouvé personne. Elle cherche un
// remplaçant — « needs_replacement » — quand son prestataire s'est désisté. À
// l'heure de début, la tâche planifiée l'annule et rend tout. Le client qui
// annulait lui-même avant cette heure se voyait, lui, retenir ses frais de
// service : ils rémunèrent une mise en relation qui n'avait produit personne.
//
// La règle ordinaire ne change pas : une réservation proposée à un prestataire,
// qui peut encore l'accepter, garde ses frais à l'annulation (`e2e/09`).
import { test, expect } from "@playwright/test";
import { sql } from "./outils.js";
import { prestataireOperationnel, client, reservationPayee, api, paiementStripe } from "./fabrique.js";

test.describe.configure({ timeout: 200_000 });

for (const statut of ["open", "needs_replacement"]) {
  test(`personne pour la faire (${statut}) : le client annule, prix et frais lui sont rendus`, async () => {
    const p = await prestataireOperationnel();
    const c = await client();
    const m = await reservationPayee({ prestataire: p, client: c, heures: 8 });
    // Ce que font la cascade (plus de candidat) et le désistement du prestataire.
    await sql(`update missions set status = '${statut}', prestataire_id = null, acceptance_deadline = null where id = '${m.id}'`);

    const r = await api("/api/missions", { action: "cancel_client", mission_id: m.id }, c.jeton);
    expect(r.statut, r.texte.slice(0, 200)).toBe(200);

    const s = await paiementStripe(m.paymentIntent);
    expect(s.preleve, "8 h × 13 € + frais de service").toBeGreaterThan(8 * 13 * 100);
    expect(s.rembourse, "prix ET frais de service").toBe(s.preleve);
    const [l] = await sql(`select status from missions where id = '${m.id}'`);
    expect(l.status).toBe("cancelled");
  });
}
