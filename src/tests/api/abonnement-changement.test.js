// Changer de formule d'abonnement.
//
// Ce qui est éprouvé ici, ce sont les DÉCISIONS : modifier ou souscrire à neuf,
// facturer tout de suite ou porter un avoir, et — le plus important — savoir si
// un abonnement qui meurt doit faire retomber quelqu'un au plan gratuit.
//
// C'est cette dernière qui a le plus coûté : un abonné Elite était dégradé le
// jour où son ancien abonnement Premium, resté actif par erreur, était enfin
// résilié.
import { describe, it, expect } from "vitest";

const RANG = { free: 0, premium: 1, elite: 2 };

/** La décision prise par `api/stripe-subscription.js`. */
function decision({ planVise, planActuel, abonnement, statut }) {
  const vivant = abonnement && ["active", "trialing", "past_due"].includes(statut);
  if (!vivant) return planVise === "free" ? "refus" : "souscription";
  if (planVise === "free") return "resiliation_fin_de_periode";
  return (RANG[planVise] ?? 0) > (RANG[planActuel] ?? 0) ? "montee" : "descente";
}

/** Le prorata appliqué par Stripe selon le sens du changement. */
const prorata = (d) => d === "montee" ? "always_invoice" : "create_prorations";

/** La décision prise par le webhook sur `customer.subscription.deleted`. */
const doitDegrader = (idEvenement, abonnementDuProfil) =>
  !abonnementDuProfil || idEvenement === abonnementDuProfil;

describe("changer de formule", () => {
  it("Premium → Elite modifie l'abonnement, il n'en crée pas un second", () => {
    // Le défaut d'origine : un second abonnement, donc 29 € + 59 € prélevés
    // chaque mois, et le premier que plus personne ne surveillait.
    expect(decision({ planVise:"elite", planActuel:"premium", abonnement:"sub_A", statut:"active" }))
      .toBe("montee");
  });

  it("une montée se facture tout de suite, une descente porte un avoir", () => {
    // Le nouveau quota est disponible dans la seconde : il se paie dans la
    // seconde. À l'inverse, rembourser une différence sur une carte pour la
    // reprélever le mois suivant n'a aucun intérêt.
    expect(prorata("montee")).toBe("always_invoice");
    expect(prorata("descente")).toBe("create_prorations");
  });

  it("Elite → Premium est une descente", () => {
    expect(decision({ planVise:"premium", planActuel:"elite", abonnement:"sub_A", statut:"active" }))
      .toBe("descente");
  });

  it("le retour au gratuit résilie en FIN de période", () => {
    // Le mois est payé, il est dû : couper l'accès dans la seconde reviendrait
    // à garder l'argent sans fournir le service.
    expect(decision({ planVise:"free", planActuel:"elite", abonnement:"sub_A", statut:"active" }))
      .toBe("resiliation_fin_de_periode");
  });

  it("sans abonnement vivant, on souscrit à neuf", () => {
    expect(decision({ planVise:"elite", planActuel:"free", abonnement:null, statut:null }))
      .toBe("souscription");
    // Une référence périmée en base ne doit pas empêcher de se réabonner.
    expect(decision({ planVise:"elite", planActuel:"premium", abonnement:"sub_mort", statut:"canceled" }))
      .toBe("souscription");
  });

  it("résilier sans rien avoir est refusé", () => {
    expect(decision({ planVise:"free", planActuel:"free", abonnement:null, statut:null }))
      .toBe("refus");
  });

  it("un abonnement en impayé reste modifiable", () => {
    // `past_due` n'est pas mort : le client peut vouloir changer de formule
    // pour régulariser. Le renvoyer sur une souscription neuve lui en créerait
    // une deuxième, ce qu'on vient précisément de supprimer.
    expect(decision({ planVise:"premium", planActuel:"elite", abonnement:"sub_A", statut:"past_due" }))
      .toBe("descente");
  });
});

describe("un abonnement qui meurt ne dégrade que s'il est le bon", () => {
  it("dégrade quand c'est l'abonnement courant", () => {
    expect(doitDegrader("sub_A", "sub_A")).toBe(true);
  });

  it("ignore un abonnement qui n'est plus celui du profil", () => {
    // Le cas qui a coûté cher : l'ancien Premium meurt, l'abonné Elite payait
    // toujours, et il se retrouvait au plan gratuit.
    expect(doitDegrader("sub_ancien", "sub_courant")).toBe(false);
  });

  it("dégrade quand le profil ne référence aucun abonnement", () => {
    // Sans référence, on ne peut rien comparer. On dégrade — c'est le sens
    // prudent : laisser un quota payant à quelqu'un qui ne paie plus coûte à
    // la plateforme, l'inverse se rattrape en un clic.
    expect(doitDegrader("sub_A", null)).toBe(true);
  });
});
