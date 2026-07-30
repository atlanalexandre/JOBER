import { describe, it, expect } from "vitest";
import { prixClient, tarifInterim, economiePct, calcCashback, getCashbackTier, CASHBACK_TIERS } from "../constants/plans.js";

// ── Calcul du tarif client ────────────────────────────────────────
describe("prixClient", () => {
  it("retourne le tarifNet tel quel (0% commission)", () => {
    expect(prixClient(14, "restauration")).toBe(14);
    expect(prixClient(12, "proprete")).toBe(12);
  });
  it("ne peut pas retourner un montant négatif", () => {
    expect(prixClient(0, "divers")).toBeGreaterThanOrEqual(0);
  });
});

// ── Comparaison intérim ───────────────────────────────────────────
describe("tarifInterim", () => {
  it("calcule le coefficient ×2.2 de l'intérim", () => {
    expect(tarifInterim(10)).toBeCloseTo(22);
    expect(tarifInterim(14)).toBeCloseTo(30.8);
  });
  it("économie par rapport à l'intérim > 0", () => {
    expect(economiePct(14)).toBeGreaterThan(0);
    expect(economiePct(14)).toBeLessThan(100);
  });
});

// ── Cashback ──────────────────────────────────────────────────────
// Grille de référence, confirmée par Alexandre le 29/07/2026 :
//   Standard  0-2 missions   0,5 %
//   Silver    3-5 missions   0,75 %
//   Gold      6-9 missions   1 %
//   Platinum  10+ missions   1,5 %
// ATTENTION : ces valeurs ne pilotent que l'affichage. Le cashback réellement
// crédité est calculé dans api/missions.js, qui lit la clé `cashback_rates` de
// `platform_settings` et écrase cette grille si elle est renseignée en base.
// Les deux doivent rester alignées — voir DOCUMENTATION.md §4.
describe("getCashbackTier", () => {
  it("0 mission → Standard", () => {
    expect(getCashbackTier(0).label).toBe("Standard");
  });
  it("5 missions → Silver", () => {
    expect(getCashbackTier(5).label).toBe("Silver");
  });
  it("10 missions → Platinum", () => {
    expect(getCashbackTier(10).label).toBe("Platinum");
  });
  it("20 missions → Platinum", () => {
    expect(getCashbackTier(20).label).toBe("Platinum");
  });

  // Bornes exactes : c'est là que se logent les erreurs de palier
  it("respecte les bornes de chaque palier", () => {
    expect(getCashbackTier(2).label).toBe("Standard");
    expect(getCashbackTier(3).label).toBe("Silver");
    expect(getCashbackTier(6).label).toBe("Gold");
    expect(getCashbackTier(9).label).toBe("Gold");
  });
});

describe("calcCashback", () => {
  it("Standard (0-2 missions) → 0,5 %", () => {
    expect(calcCashback(100, 0)).toBeCloseTo(0.5);
  });
  it("Silver (3-5 missions) → 0,75 %", () => {
    expect(calcCashback(100, 5)).toBeCloseTo(0.75);
  });
  it("Gold (6-9 missions) → 1 %", () => {
    expect(calcCashback(100, 6)).toBeCloseTo(1);
  });
  it("Platinum (10+ missions) → 1,5 %", () => {
    expect(calcCashback(100, 20)).toBeCloseTo(1.5);
  });
  it("cashback proportionnel au montant", () => {
    expect(calcCashback(200, 0)).toBeCloseTo(1);
    expect(calcCashback(500, 10)).toBeCloseTo(7.5);
  });
  it("un montant nul ne crédite rien", () => {
    expect(calcCashback(0, 20)).toBe(0);
  });
});

// ── Aller-retour de l'écran de réglages du backoffice ─────────────
// L'écran BO convertit le taux stocké (0,0075) en pourcentage affiché (0,75),
// puis reconvertit à l'enregistrement. Un arrondi à une seule décimale
// transformait silencieusement le palier silver en 0,8 % — et l'écrivait en base
// au premier « Sauvegarder ». Ces deux fonctions reproduisent exactement
// backoffice.jsx (lecture ligne ~1952, écriture ligne ~2146).
describe("réglages BO — conversion des taux de cashback", () => {
  const versAffichage    = (rate) => Math.round(rate * 10000) / 100;
  const versEnregistrement = (pct) => Number(pct) / 100;

  it("affiche chaque palier sans perte de précision", () => {
    expect(versAffichage(0.005)).toBe(0.5);
    expect(versAffichage(0.0075)).toBe(0.75);
    expect(versAffichage(0.01)).toBe(1);
    expect(versAffichage(0.015)).toBe(1.5);
  });

  it("un aller-retour ne modifie aucun taux de la grille", () => {
    for (const tier of CASHBACK_TIERS) {
      expect(versEnregistrement(versAffichage(tier.rate))).toBeCloseTo(tier.rate, 6);
    }
  });
});

// ── Calcul montant mission ────────────────────────────────────────
describe("Calcul montant total mission", () => {
  const calculMontant = (tarifHoraire, heures, nbJours = 1) =>
    tarifHoraire * heures * nbJours;

  it("prestation simple 8h à 14€/h = 112€", () => {
    expect(calculMontant(14, 8)).toBe(112);
  });
  it("mission 3 jours × 8h × 12€ = 288€", () => {
    expect(calculMontant(12, 8, 3)).toBe(288);
  });
  it("mode urgence +2€/h", () => {
    const base = 14;
    const urgentSurcharge = 2;
    expect(calculMontant(base + urgentSurcharge, 4)).toBe(64);
  });
  it("le montant ne peut pas être négatif", () => {
    expect(calculMontant(0, 0)).toBeGreaterThanOrEqual(0);
  });
});

// ── Fusion des styles du composant Btn ────────────────────────────
// Le style passé en prop est fusionné après celui de la variante. Une propriété
// à undefined — écrite naturellement `condition ? valeur : undefined` — écrasait
// la variante : le bouton « Confirmer & payer » s'affichait en blanc, donc
// apparemment désactivé. Reproduit ici la fusion de ui.jsx.
describe("Btn — fusion des styles", () => {
  const fusion = (variante, passe) => ({
    ...variante,
    ...(passe ? Object.fromEntries(Object.entries(passe).filter(([, v]) => v !== undefined)) : undefined),
  });
  const VARIANTE = { background: "linear-gradient(violet)", color: "#fff" };

  it("une propriété undefined n'écrase pas celle de la variante", () => {
    expect(fusion(VARIANTE, { background: undefined }).background).toBe("linear-gradient(violet)");
  });
  it("une propriété définie écrase bien celle de la variante", () => {
    expect(fusion(VARIANTE, { background: "red" }).background).toBe("red");
  });
  it("les autres propriétés passées sont conservées", () => {
    expect(fusion(VARIANTE, { background: undefined, padding: "13px" })).toEqual({
      background: "linear-gradient(violet)", color: "#fff", padding: "13px",
    });
  });
  it("aucun style passé laisse la variante intacte", () => {
    expect(fusion(VARIANTE, undefined)).toEqual(VARIANTE);
  });
});

// ── Mise à jour du profil : ce que le navigateur peut écrire ──────
// `update-profile` fusionnait sans filtre tout ce qu'on lui envoyait dans
// user_metadata — champs privilégiés compris, et sans aucune limite de taille. Or
// user_metadata est encodé dans le jeton, envoyé en en-tête à chaque requête, et
// Cloudflare plafonne les en-têtes à 16 Ko : une photo en base64 y avait rendu un
// compte totalement inutilisable (règle 1.1).
describe("mise à jour du profil — garde-fous", () => {
  const INTERDITS = ["plan_abonnement","subscription_end_date","plan_souhaite","role","status",
    "missions_enabled","trial_exhausted","missions_completed_month","cashback_balance",
    "prepaid_balance","stripe_customer_id","stripe_subscription_id","stripe_account_id","stripe_account_status"];
  const verdict = (donnees, metaExistant = {}) => {
    if (INTERDITS.some(k => k in donnees)) return "champ interdit";
    for (const v of Object.values(donnees)) {
      if (typeof v === "string" && /^data:/i.test(v)) return "fichier";
    }
    const taille = Buffer.byteLength(JSON.stringify({ ...metaExistant, ...donnees }), "utf8");
    return taille > 6144 ? "trop volumineux" : "ok";
  };

  it("une modification ordinaire passe", () => {
    expect(verdict({ prenom:"Alex", ville:"Nice", tarif_net:15 })).toBe("ok");
  });
  it("s'offrir un abonnement en modifiant son profil : refusé", () => {
    expect(verdict({ plan_abonnement:"elite" })).toBe("champ interdit");
  });
  it("se valider soi-même : refusé", () => {
    expect(verdict({ status:"approved", missions_enabled:true })).toBe("champ interdit");
  });
  it("se créditer un portefeuille : refusé", () => {
    expect(verdict({ prepaid_balance:1000 })).toBe("champ interdit");
  });
  it("une photo en base64 : refusée, c'est le bug qui a bloqué un compte entier", () => {
    expect(verdict({ photo_url:"data:image/png;base64,iVBORw0KGgo..." })).toBe("fichier");
  });
  it("une biographie démesurée : refusée avant d'atteindre la limite du jeton", () => {
    expect(verdict({ bio:"x".repeat(7000) })).toBe("trop volumineux");
  });
  it("le cumul avec l'existant est pris en compte, pas seulement l'envoi", () => {
    expect(verdict({ bio:"x".repeat(3000) }, { competences:"y".repeat(4000) })).toBe("trop volumineux");
  });
});

// ── Dépôt d'un avis ───────────────────────────────────────────────
// L'insertion se faisait depuis le navigateur. Le contrôle « avez-vous déjà travaillé
// ensemble ? » était une requête du front, contournable, et côté prestataire il
// n'existait pas du tout : on pouvait noter n'importe qui, autant de fois que voulu.
// Or la note pilote le classement du catalogue. Reproduit les contrôles de
// api/missions.js (submit_rating).
describe("avis — qui peut noter, et une seule fois", () => {
  const M = { id:"m1", client_id:"c1", prestataire_id:"p1", status:"completed" };
  const verdict = (mission, auteur, dejaNote = false) => {
    const estClient = mission.client_id === auteur;
    const estPresta = mission.prestataire_id === auteur;
    if (!estClient && !estPresta) return "tiers";
    if (!["completed", "closed"].includes(mission.status)) return "pas terminee";
    if (dejaNote) return "doublon";
    return estClient ? mission.prestataire_id : mission.client_id;
  };

  it("le client note le prestataire de SA prestation", () => {
    expect(verdict(M, "c1")).toBe("p1");
  });
  it("le prestataire note le client, sans avoir à le désigner", () => {
    expect(verdict(M, "p1")).toBe("c1");
  });
  it("un tiers ne peut noter personne", () => {
    expect(verdict(M, "inconnu")).toBe("tiers");
  });
  it("une prestation non terminée ne se note pas", () => {
    expect(verdict({ ...M, status:"assigned" }, "c1")).toBe("pas terminee");
  });
  it("un second avis sur la même prestation est refusé", () => {
    expect(verdict(M, "c1", true)).toBe("doublon");
  });

  const noteValide = (n) => Number.isInteger(Number(n)) && Number(n) >= 1 && Number(n) <= 5;
  it("la note doit être un entier de 1 à 5", () => {
    expect(noteValide(5)).toBe(true);
    expect(noteValide(0)).toBe(false);
    expect(noteValide(6)).toBe(false);
    expect(noteValide(4.5)).toBe(false);
    expect(noteValide("abc")).toBe(false);
  });
});

// ── Frais de service retenus à l'annulation ───────────────────────
// Les CGPS art. 8.1 les disent « en principe retenus et non remboursables car ils
// couvrent des coûts déjà engagés », et l'écran de confirmation annonçait déjà
// « hors frais de service ». Seul le serveur les remboursait au-delà de 24 h.
// Unique exception, CGPS art. 8.2 : la défaillance du prestataire.
describe("annulation — frais de service retenus", () => {
  const rembourse = ({ total, frais, defaillancePrestataire }) =>
    defaillancePrestataire ? total : Math.round((total - frais) * 100) / 100;

  it("annulation à plus de 24 h : les frais restent acquis", () => {
    expect(rembourse({ total:116.90, frais:4.90, defaillancePrestataire:false })).toBeCloseTo(112);
  });
  it("annulation à moins de 24 h : même règle", () => {
    expect(rembourse({ total:116.90, frais:4.90, defaillancePrestataire:false })).toBeCloseTo(112);
  });
  it("défaillance du prestataire : remboursement intégral, frais compris", () => {
    expect(rembourse({ total:116.90, frais:4.90, defaillancePrestataire:true })).toBeCloseTo(116.90);
  });
  it("urgence : ce sont bien les 9,90 € réels qui sont retenus", () => {
    expect(rembourse({ total:73.90, frais:9.90, defaillancePrestataire:false })).toBeCloseTo(64);
  });
});

// ── Seuil d'annulation sans frais pour retard du prestataire ──────
// Un retard se juge en proportion, pas en minutes : 30 min sur une prestation d'une
// heure, c'est la moitié du service perdu ; sur huit heures, c'est un contretemps.
// Le seuil valait 30 min quelle que soit la durée. Reproduit
// seuilAnnulationRetardMin() et le contrôle de api/missions.js (cancel_client).
describe("annulation sans frais — seuil proportionnel", () => {
  const seuil = (heures) => {
    const dureeMin = Math.max(1, Number(heures) || 1) * 60;
    return Math.min(60, Math.max(20, Math.round(dureeMin * 0.25)));
  };

  it("1 h : annulable dès 20 min de retard, soit un tiers du service", () => {
    expect(seuil(1)).toBe(20);
  });
  it("2 h : 30 min", () => {
    expect(seuil(2)).toBe(30);
  });
  it("4 h : 60 min", () => {
    expect(seuil(4)).toBe(60);
  });
  it("8 h : plafonné à 60 min, pas 2 h", () => {
    expect(seuil(8)).toBe(60);
  });
  it("prestation très courte : plancher de 20 min, on n'annule pas pour 8 min", () => {
    expect(seuil(0.5)).toBe(20);
  });

  // Le droit se referme dès le démarrage : le prestataire est à l'œuvre, et c'est
  // l'arbitrage du décalage qui rééquilibre. Annuler le ferait travailler pour rien.
  const annulableSansFrais = ({ heures, retardMin, demarre }) =>
    !demarre && retardMin >= seuil(heures);

  it("1 h, 25 min de retard, pas démarrée : annulable", () => {
    expect(annulableSansFrais({ heures:1, retardMin:25, demarre:false })).toBe(true);
  });
  it("même retard mais prestation démarrée : plus annulable", () => {
    expect(annulableSansFrais({ heures:1, retardMin:25, demarre:true })).toBe(false);
  });
  it("1 h, 12 min de retard : pas encore annulable", () => {
    expect(annulableSansFrais({ heures:1, retardMin:12, demarre:false })).toBe(false);
  });
});

// ── Décalage de démarrage : qui décide de la fin ──────────────────
// Une prestation prévue de 20h à 21h, démarrée à 20h37, voyait sa fin glisser à
// 21h37 sans que le client ait accepté quoi que ce soit. Le décalage n'était mesuré
// qu'au pointage d'arrivée, jamais au démarrage. La fin reste celle qui était prévue
// tant que le client n'a pas donné son accord.
describe("décalage de démarrage — fin de prestation", () => {
  const H = 3600000;
  const finEffective = ({ debutPrevu, debutReel, heures, accepte }) => {
    const finPrevue = debutPrevu + heures * H;
    const finGlissee = debutReel + heures * H;
    return (!accepte && finPrevue > debutReel) ? Math.min(finPrevue, finGlissee) : finGlissee;
  };
  const T20h = 1_760_000_000_000;          // référence arbitraire = 20h00
  const T20h37 = T20h + 37 * 60000;

  it("démarrage à l'heure : la fin ne bouge pas", () => {
    expect(finEffective({ debutPrevu:T20h, debutReel:T20h, heures:1, accepte:false })).toBe(T20h + H);
  });
  it("démarrage à 20h37 sans accord : fin maintenue à 21h", () => {
    expect(finEffective({ debutPrevu:T20h, debutReel:T20h37, heures:1, accepte:false })).toBe(T20h + H);
  });
  it("démarrage à 20h37 avec accord du client : fin repoussée à 21h37", () => {
    expect(finEffective({ debutPrevu:T20h, debutReel:T20h37, heures:1, accepte:true })).toBe(T20h37 + H);
  });
  it("démarrage en avance : la prestation dure bien ses heures pleines", () => {
    const T19h55 = T20h - 5 * 60000;
    expect(finEffective({ debutPrevu:T20h, debutReel:T19h55, heures:1, accepte:false })).toBe(T19h55 + H);
  });
});

// ── Heures facturées quand le décalage reste sans réponse ─────────
// Le champ `delay_status` était lu à la validation sans jamais être utilisé : un
// client qui n'avait rien accepté payait les heures pleines. Il paie désormais
// jusqu'à l'heure de fin prévue.
describe("décalage sans réponse — heures facturées", () => {
  const facturees = ({ heuresPrevues, retardMin, statut }) => {
    if (statut !== "pending") return heuresPrevues;
    return Math.max(0, Math.round((heuresPrevues - retardMin / 60) * 100) / 100);
  };

  it("sans réponse du client : 1h prévue, 37 min de retard → 0,38 h facturée", () => {
    expect(facturees({ heuresPrevues:1, retardMin:37, statut:"pending" })).toBeCloseTo(0.38);
  });
  it("décalage accepté : les heures prévues sont dues", () => {
    expect(facturees({ heuresPrevues:1, retardMin:37, statut:"approved" })).toBe(1);
  });
  it("refus explicite : déjà arbitré ailleurs, pas de seconde réduction", () => {
    expect(facturees({ heuresPrevues:0.38, retardMin:37, statut:"rejected" })).toBeCloseTo(0.38);
  });
  it("un retard supérieur à la durée ne rend jamais un montant négatif", () => {
    expect(facturees({ heuresPrevues:1, retardMin:120, statut:"pending" })).toBe(0);
  });
});

// ── Plan d'abonnement opposable ───────────────────────────────────
// À l'inscription, le prestataire choisit son abonnement d'un simple appui et cette
// valeur partait dans user_metadata. `profiles.plan_abonnement` restant vide faute de
// paiement, le repli sur user_metadata accordait Elite — 999 prestations, badge et
// première place — à qui n'avait jamais rien réglé. Seul `profiles`, écrit par le
// webhook Stripe ou le backoffice, fait foi.
describe("plan d'abonnement — source de vérité", () => {
  // `metadata` est volontairement ignoré : c'est tout l'objet de la correction.
  const planOpposable = ({ profil, metadata: _metadata }) => profil || "free";

  it("un plan choisi à l'inscription n'accorde rien", () => {
    expect(planOpposable({ profil:null, metadata:"elite" })).toBe("free");
  });
  it("un plan réglé et inscrit par le webhook fait foi", () => {
    expect(planOpposable({ profil:"premium", metadata:"free" })).toBe("premium");
  });
  it("metadata ne peut jamais relever le plan du profil", () => {
    expect(planOpposable({ profil:"premium", metadata:"elite" })).toBe("premium");
  });
  it("sans rien nulle part : plan gratuit", () => {
    expect(planOpposable({ profil:null, metadata:null })).toBe("free");
  });
});

// ── Montant facturé ───────────────────────────────────────────────
// La facture omettait elle aussi le nombre de jours : une prestation récurrente de
// 5 jours était facturée une seule journée. Elle doit porter le même montant que
// celui versé au prestataire — c'est sa facture au client.
describe("facture — montant HT", () => {
  const htFacture = ({ tarif, heures, jours = 1 }) => Math.round(tarif * heures * jours * 100) / 100;

  it("prestation simple : 8h × 14 €", () => {
    expect(htFacture({ tarif:14, heures:8 })).toBe(112);
  });
  it("récurrent 5 jours : les 5 journées sont facturées", () => {
    expect(htFacture({ tarif:14, heures:8, jours:5 })).toBe(560);
  });
  it("le HT facturé égale la part versée au prestataire", () => {
    const part = Math.round(14 * 8 * 3 * 100) / 100;
    expect(htFacture({ tarif:14, heures:8, jours:3 })).toBe(part);
  });
});

// ── Récapitulatif de paiement sur la facture ──────────────────────
// Les frais de service sont affichés au client, mais séparément de la facture du
// prestataire : les inscrire sur celle-ci gonflerait son chiffre d'affaires déclaré
// — donc ses cotisations et son plafond de micro-entreprise — sur un argent qu'il
// n'encaisse pas. Un écart aberrant n'affiche rien plutôt qu'un chiffre faux.
describe("facture — frais de service affichés au client", () => {
  const frais = ({ totalPaye, ttcPrestation }) => {
    const calc = Math.round((totalPaye - ttcPrestation) * 100) / 100;
    return (calc > 0 && calc < ttcPrestation) ? calc : 0;
  };

  it("prestation simple : 4,90 € de frais affichés", () => {
    expect(frais({ totalPaye:116.90, ttcPrestation:112 })).toBeCloseTo(4.90);
  });
  it("urgence : 9,90 € de frais affichés", () => {
    expect(frais({ totalPaye:73.90, ttcPrestation:64 })).toBeCloseTo(9.90);
  });
  it("montant payé égal au facturé : aucun frais, pas de récapitulatif", () => {
    expect(frais({ totalPaye:112, ttcPrestation:112 })).toBe(0);
  });
  it("écart aberrant : rien n'est affiché plutôt qu'un chiffre faux", () => {
    expect(frais({ totalPaye:500, ttcPrestation:112 })).toBe(0);
    expect(frais({ totalPaye:50,  ttcPrestation:112 })).toBe(0);
  });
});

// ── Versement au prestataire ──────────────────────────────────────
// Deux chemins de virement calculaient deux montants différents, tous deux faux :
// /api/missions oubliait le nombre de jours (un récurrent de 5 jours ne versait
// qu'une journée) et le webhook versait `montant_total`, frais de service compris —
// ALANE reversait donc sa propre rémunération. Le contrat signé par les deux parties
// annonce « Montant net dû au Prestataire » = tarif × heures. Décision du 30/07/2026 :
// le prestataire reçoit la part horaire, ALANE conserve ses frais de service.
describe("versement au prestataire", () => {
  const partPrestataire = ({ tarif, heures, jours = 1 }) =>
    Math.round(tarif * heures * jours * 100) / 100;
  // Frais réellement encaissés, déduits de ce que le client a payé.
  const fraisService = ({ totalPaye, tarif, heuresPrevues, jours = 1 }) => {
    const prevue = Math.round(tarif * heuresPrevues * jours * 100) / 100;
    return (prevue > 0 && totalPaye > prevue) ? Math.round((totalPaye - prevue) * 100) / 100 : 0;
  };

  it("prestation simple : 8h × 14 € = 112 €, et non les 116,90 € payés", () => {
    expect(partPrestataire({ tarif:14, heures:8 })).toBe(112);
  });
  it("ALANE conserve les 4,90 € de frais de service", () => {
    expect(fraisService({ totalPaye:116.90, tarif:14, heuresPrevues:8 })).toBeCloseTo(4.90);
  });
  it("récurrent 5 jours : 5 journées versées (560 €), pas une seule (112 €)", () => {
    expect(partPrestataire({ tarif:14, heures:8, jours:5 })).toBe(560);
  });
  it("urgence : les 9,90 € de frais restent acquis à ALANE", () => {
    expect(fraisService({ totalPaye:73.90, tarif:16, heuresPrevues:4 })).toBeCloseTo(9.90);
  });
  it("heures réelles supérieures aux heures prévues : le prestataire est payé au réel", () => {
    expect(partPrestataire({ tarif:14, heures:10 })).toBe(140);
    // …et les frais de service ne bougent pas, ils rémunèrent la mise en relation
    expect(fraisService({ totalPaye:116.90, tarif:14, heuresPrevues:8 })).toBeCloseTo(4.90);
  });
  it("montant payé incohérent : aucun frais inventé", () => {
    expect(fraisService({ totalPaye:50, tarif:14, heuresPrevues:8 })).toBe(0);
  });
});

// ── Délai de contestation d'une prestation ────────────────────────
// Les CGPS écrivent : « Au-delà de 48 heures sans signalement par le Client, la
// Prestation est réputée définitivement validée […] et aucune contestation ne pourra
// être acceptée. » Rien ne l'appliquait : une prestation terminée depuis des mois
// restait contestable, et la garantie donnée au prestataire n'en était pas une.
// Reproduit le contrôle de api/missions.js (action `dispute`).
describe("litige — délai de 48 h après la fin de la prestation", () => {
  const H = 3600000;
  // finPrestation : pointage réel s'il existe, sinon horaire prévu.
  const finPrestation = ({ startedAt, debutPrevu, hours }) => {
    const duree = Math.max(1, hours || 1) * H;
    if (startedAt) return startedAt + duree;
    if (debutPrevu) return debutPrevu + duree;
    return null;
  };
  const contestable = (m, maintenant) => {
    const fin = finPrestation(m);
    if (!fin) return true;                       // non vérifiable → on laisse passer
    return maintenant <= fin + 48 * H;
  };
  const T0 = 1_760_000_000_000;

  it("juste après la fin : contestable", () => {
    expect(contestable({ debutPrevu:T0, hours:8 }, T0 + 8*H + 60000)).toBe(true);
  });
  it("47 h après la fin : encore contestable", () => {
    expect(contestable({ debutPrevu:T0, hours:8 }, T0 + 8*H + 47*H)).toBe(true);
  });
  it("49 h après la fin : hors délai", () => {
    expect(contestable({ debutPrevu:T0, hours:8 }, T0 + 8*H + 49*H)).toBe(false);
  });
  it("le délai part du pointage réel quand il existe, pas de l'horaire prévu", () => {
    // Prestation prévue à T0 mais démarrée 6 h plus tard : à T0+50h, la fin réelle
    // n'a que 44 h — le client doit encore pouvoir contester.
    expect(contestable({ debutPrevu:T0, startedAt:T0 + 6*H, hours:2 }, T0 + 50*H)).toBe(true);
  });
  it("sans date exploitable, on ne bloque pas un litige légitime", () => {
    expect(contestable({ hours:8 }, T0 + 1000*H)).toBe(true);
  });
});

// ── Identifiant de document accepté par le backoffice ─────────────
// La clé primaire de `documents` est un entier (BIGSERIAL), pas un uuid. Le backoffice
// exigeait un uuid : toute validation et tout refus de document répondaient « docId
// invalide », le bouton n'a donc jamais fonctionné. Les deux formes sont acceptées, et
// rien d'autre — l'identifiant part dans une URL PostgREST.
describe("identifiant de document — validation", () => {
  const isUuid  = (v) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
  const isDocId = (v) => {
    if (isUuid(v)) return true;
    const s = typeof v === "number" ? String(v) : v;
    return typeof s === "string" && /^[0-9]{1,19}$/.test(s);
  };

  it("accepte un entier (BIGSERIAL), en nombre comme en chaîne", () => {
    expect(isDocId(12)).toBe(true);
    expect(isDocId("12")).toBe(true);
  });
  it("accepte un uuid, au cas où la colonne changerait de type", () => {
    expect(isDocId("3fa85f64-5717-4562-b3fc-2c963f66afa6")).toBe(true);
  });
  it("refuse l'entrée virtuelle de la photo de profil", () => {
    expect(isDocId("photo_virtual")).toBe(false);
  });
  it("refuse toute tentative d'injection dans l'URL PostgREST", () => {
    expect(isDocId("1 or true")).toBe(false);
    expect(isDocId("1,2")).toBe(false);
    expect(isDocId("*")).toBe(false);
    expect(isDocId("")).toBe(false);
    expect(isDocId(null)).toBe(false);
  });
});

// ── Cohérence du montant encaissé ─────────────────────────────────
// La ligne `missions` est insérée par le navigateur du client et le déclencheur
// `missions_field_tamper_guard` ne protège que les UPDATE : un client pouvait créer
// sa prestation avec montant_total = 1 €, payer 1 €, puis se faire affecter un
// prestataire à 200 €. Reproduit le contrôle de api/stripe-intent.js : ce qui reste
// après la part horaire doit être l'un des trois frais de service légitimes.
describe("montant encaissé — contrôle de cohérence", () => {
  const FRAIS = { single: 4.90, range: 2.90, urgent: 9.90 };
  const coherent = ({ total, tarif, hours, jours = 1 }) => {
    const partHoraire = tarif * hours;
    if (partHoraire <= 0) return true;   // non vérifiable, on laisse passer
    const admis = [FRAIS.single, Math.round(FRAIS.range * jours * 100) / 100, FRAIS.urgent];
    const constates = Math.round((total - partHoraire * jours) * 100) / 100;
    return admis.some(f => Math.abs(f - constates) <= 0.01);
  };

  it("prestation simple légitime : 8h × 14 € + 4,90 € de frais", () => {
    expect(coherent({ total: 116.90, tarif: 14, hours: 8 })).toBe(true);
  });
  it("urgence légitime : frais de 9,90 €", () => {
    expect(coherent({ total: 73.90, tarif: 16, hours: 4 })).toBe(true);
  });
  it("récurrent 5 jours : frais de 2,90 € × 5", () => {
    expect(coherent({ total: 14.50 + 14 * 8 * 5, tarif: 14, hours: 8, jours: 5 })).toBe(true);
  });
  it("montant fabriqué à 1 € : refusé", () => {
    expect(coherent({ total: 1, tarif: 14, hours: 8 })).toBe(false);
  });
  it("frais rabotés à zéro : refusé", () => {
    expect(coherent({ total: 112, tarif: 14, hours: 8 })).toBe(false);
  });
  it("frais gonflés au-delà du barème : refusé", () => {
    expect(coherent({ total: 200, tarif: 14, hours: 8 })).toBe(false);
  });
  it("tarif ou durée absents : non vérifiable, laissé passer", () => {
    expect(coherent({ total: 116.90, tarif: 0, hours: 0 })).toBe(true);
  });
});

// ── Quota mensuel du prestataire et offre de lancement ────────────
// L'inscription annonce « 10 prestations/mois gratuites aux 100 premiers inscrits ».
// Le quota retombait pourtant toujours sur plan_limits.free (2) : un prestataire du
// lancement se voyait refuser sa 3ᵉ prestation. Reproduit la décision de
// limitePlanMensuelle() dans api/missions.js.
describe("limite mensuelle — offre de lancement", () => {
  const LIMITES = { free: 2, premium: 10, elite: 999 };
  const limite = ({ plan, lancement, rangCentPremiers }) => {
    const base = LIMITES[plan] ?? LIMITES.free;
    if (plan !== "free" || !lancement || !rangCentPremiers) return base;
    return Math.max(base, LIMITES.premium);
  };

  it("prestataire du lancement : 10 prestations, pas 2", () => {
    expect(limite({ plan:"free", lancement:true, rangCentPremiers:true })).toBe(10);
  });
  it("hors des 100 premiers : le plan free reste à 2", () => {
    expect(limite({ plan:"free", lancement:true, rangCentPremiers:false })).toBe(2);
  });
  it("offre de lancement désactivée : retour à 2 pour tout le monde", () => {
    expect(limite({ plan:"free", lancement:false, rangCentPremiers:true })).toBe(2);
  });
  it("un plan payant n'est jamais dégradé par l'offre", () => {
    expect(limite({ plan:"premium", lancement:true, rangCentPremiers:true })).toBe(10);
    expect(limite({ plan:"elite",   lancement:true, rangCentPremiers:true })).toBe(999);
  });
});

// ── Ouverture d'un secteur ────────────────────────────────────────
// L'ouverture dépendait d'un seuil de prestataires (30 par défaut) alors que l'action
// qui le calculait répondait toujours 401 : le verrou n'a jamais fonctionné. Le jour où
// elle redevenait joignable, tous les secteurs se fermaient d'un coup. Seule la décision
// explicite de l'administrateur compte désormais.
describe("ouverture d'un secteur", () => {
  const ouvert = (secteur, desactives) => !desactives.includes(secteur);

  it("un secteur non désactivé est ouvert, même sans aucun prestataire", () => {
    expect(ouvert("proprete", [])).toBe(true);
  });
  it("un secteur désactivé dans le backoffice est fermé", () => {
    expect(ouvert("hotellerie", ["hotellerie"])).toBe(false);
  });
  it("la désactivation ne touche que le secteur visé", () => {
    expect(ouvert("restauration", ["hotellerie"])).toBe(true);
  });
});

// ── Frais retenus en cas d'annulation client < 24h ────────────────
// L'écran de réservation annonce « frais de service retenus uniquement ». Ces
// frais varient (plans.js FRAIS_MER : 4,90 simple · 2,90/jour récurrent · 9,90
// urgence) alors qu'un forfait de 4,90 € était retenu : un client en récurrent
// perdait 4,90 € pour 2,90 € payés, et une urgence ne laissait que 4,90 € sur
// 9,90 € encaissés. Reproduit le calcul de api/missions.js (cancel_client).
describe("annulation < 24h — frais réellement retenus", () => {
  const fraisRetenus = ({ tarif, hours, jours, total }) => {
    const partHoraire = tarif * hours * jours;
    const deduits = Math.round((total - partHoraire) * 100) / 100;
    const max = Math.max(9.90, 2.90 * jours) + 0.01;
    return (deduits > 0 && deduits <= max && deduits < total) ? deduits : Math.min(4.90, total);
  };

  it("prestation simple : retient les 4,90 € payés", () => {
    expect(fraisRetenus({ tarif:15, hours:1, jours:1, total:19.90 })).toBeCloseTo(4.90);
  });
  it("urgence : retient les 9,90 € payés, pas 4,90", () => {
    expect(fraisRetenus({ tarif:15, hours:1, jours:1, total:24.90 })).toBeCloseTo(9.90);
  });
  it("récurrent 1 jour : retient 2,90 € et non 4,90 — le client n'est plus surfacturé", () => {
    expect(fraisRetenus({ tarif:15, hours:1, jours:1, total:17.90 })).toBeCloseTo(2.90);
  });
  it("récurrent 5 jours : retient les 14,50 € payés", () => {
    expect(fraisRetenus({ tarif:15, hours:2, jours:5, total:164.50 })).toBeCloseTo(14.50);
  });
  it("données incomplètes : repli sur le forfait", () => {
    expect(fraisRetenus({ tarif:0, hours:0, jours:1, total:19.90 })).toBeCloseTo(4.90);
  });
  it("ne retient jamais plus que le montant payé", () => {
    expect(fraisRetenus({ tarif:0, hours:0, jours:1, total:2 })).toBeLessThanOrEqual(2);
  });
});
