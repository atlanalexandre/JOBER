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
