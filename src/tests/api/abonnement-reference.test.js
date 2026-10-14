// Un abonnement en impayé garde sa référence (étude d'octobre 2026).
//
// Le webhook effaçait `stripe_subscription_id` dès qu'un abonnement cessait d'être
// actif — y compris sur un simple impayé, que Stripe continue de relancer — et rien
// ne la rétablissait quand le paiement aboutissait. Le profil redevenait abonné sans
// référence : la suppression du compte ne résiliait plus l'abonnement (prélevé
// ensuite chaque mois), un changement de formule en ouvrait un second, et
// « Résilier » répondait « aucun abonnement ».
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { ecritureAbonnement } from "../../../api/stripe-webhook.js";

const MAJ = "customer.subscription.updated";

describe("ce que le webhook écrit sur le profil", () => {
  it("impayé : retour au gratuit, la référence reste", () => {
    for (const status of ["past_due", "unpaid", "incomplete"]) {
      const p = ecritureAbonnement(MAJ, { id: "sub_1", status }, null);
      expect(p.plan_abonnement).toBe("free");
      expect(p, status).not.toHaveProperty("stripe_subscription_id");
    }
  });

  it("paiement abouti : la formule revient, et la référence avec elle", () => {
    const p = ecritureAbonnement(MAJ, { id: "sub_1", status: "active", current_period_end: 1793000000 }, "elite");
    expect(p).toMatchObject({ plan_abonnement: "elite", stripe_subscription_id: "sub_1" });
    expect(p.subscription_end_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("abonnement mort : la référence est effacée", () => {
    expect(ecritureAbonnement("customer.subscription.deleted", { id: "sub_1", status: "canceled" }, null))
      .toMatchObject({ plan_abonnement: "free", stripe_subscription_id: null });
    expect(ecritureAbonnement(MAJ, { id: "sub_1", status: "incomplete_expired" }, null))
      .toMatchObject({ stripe_subscription_id: null });
  });

  it("le webhook passe par cette fonction pour les deux écritures", () => {
    const src = readFileSync(new URL("../../../api/stripe-webhook.js", import.meta.url), "utf8");
    expect(src.match(/JSON\.stringify\(ecritureAbonnement\(event\.type, sub,/g)).toHaveLength(2);
    expect(src).not.toMatch(/plan_abonnement: "free", subscription_end_date: null, stripe_subscription_id: null/);
  });
});
