// ═══════════════════════════════════════════════════════════════════════════
// Le prix affiché et le prix prélevé doivent être le même
// ═══════════════════════════════════════════════════════════════════════════
//
// POURQUOI
//
// Ils viennent de DEUX SOURCES QUI NE SE PARLENT PAS :
//
//   • le prestataire voit `platform_settings.subscription_prices`, réglable
//     depuis le back-office ;
//   • il est prélevé du montant du tarif Stripe désigné par les variables
//     d'environnement `STRIPE_PRICE_*`, réglable depuis le tableau de bord
//     Stripe.
//
// Rien ne les rapproche. Modifier l'un sans l'autre fait afficher un prix et en
// prélever un second — ce qui est une pratique commerciale trompeuse (art.
// L121-2 du Code de la consommation) et, sur un prélèvement récurrent, une
// réclamation qu'on ne découvre qu'au premier relevé bancaire.
//
// Ce n'est pas une crainte théorique : le même écart entre ce qui est annoncé
// et ce qui est appliqué s'est produit trois fois sur la seule offre de
// lancement, et deux fois sur les prix des formules recopiés en dur dans des
// écrans.
//
// CE QUE FAIT CE MODULE
//
// Il lit les deux, les compare, et dit où ça diverge. Il ne corrige rien : on
// ne devine pas lequel des deux fait foi — baisser le prélèvement léserait
// l'entreprise, relever l'affichage léserait le prestataire. C'est un
// arbitrage, pas une réparation automatique.
// ═══════════════════════════════════════════════════════════════════════════

/** Les quatre tarifs vendus : formule et périodicité. */
export const TARIFS = [
  { plan: "premium", periode: "monthly", suffixe: "PREMIUM_MONTHLY", libelle: "Premium mensuel" },
  { plan: "premium", periode: "yearly",  suffixe: "PREMIUM_YEARLY",  libelle: "Premium annuel"  },
  { plan: "elite",   periode: "monthly", suffixe: "ELITE_MONTHLY",   libelle: "Elite mensuel"   },
  { plan: "elite",   periode: "yearly",  suffixe: "ELITE_YEARLY",    libelle: "Elite annuel"    },
];

/**
 * L'identifiant du tarif Stripe, quel que soit le nom de la variable.
 *
 * Deux écritures coexistent dans Vercel — `STRIPE_PRICE_X` et `STRIPE_X` —, et
 * les variables y sont marquées « Sensitive », donc illisibles après
 * enregistrement. Les renommer imposerait de retrouver les quatre identifiants
 * dans Stripe et de tout ressaisir : on accepte les deux formes, comme le fait
 * déjà `api/stripe-subscription.js`.
 */
export function idTarifStripe(suffixe) {
  for (const nom of [`STRIPE_PRICE_${suffixe}`, `STRIPE_${suffixe}`]) {
    const v = (process.env[nom] || "").replace(/\s/g, "");
    if (v) return { id: v, variable: nom };
  }
  return { id: null, variable: null };
}

/**
 * Compare les prix affichés et les prix prélevés.
 *
 * @returns {Promise<{ok:boolean, lignes:Array, ecarts:Array, indisponible:boolean}>}
 *
 * `indisponible` distingue « je n'ai pas pu vérifier » de « tout va bien » :
 * une clé Stripe absente ne doit pas se lire comme une absence d'écart.
 */
export async function comparerPrix(affiches, stripeKey) {
  const cle = (stripeKey || "").replace(/\s/g, "");
  if (!cle) {
    return { ok: false, indisponible: true, lignes: [], ecarts: [],
             motif: "Clé Stripe absente — comparaison impossible." };
  }

  const lignes = await Promise.all(TARIFS.map(async (t) => {
    const affiche = Number(affiches?.[t.plan]?.[t.periode]);
    const { id, variable } = idTarifStripe(t.suffixe);
    const base = { ...t, affiche: Number.isFinite(affiche) ? affiche : null, variable, idTarif: id };

    if (!id) return { ...base, preleve: null, etat: "tarif_absent" };

    try {
      const r = await fetch(`https://api.stripe.com/v1/prices/${encodeURIComponent(id)}`, {
        headers: { "Authorization": `Bearer ${cle}` },
      });
      if (!r.ok) {
        const d = await r.text().catch(() => "");
        console.error(`[prix] tarif ${id} illisible chez Stripe (${r.status}) : ${d.slice(0, 160)}`);
        return { ...base, preleve: null, etat: "illisible" };
      }
      const p = await r.json();
      // Stripe exprime les montants en centimes. `unit_amount` peut être nul
      // sur un tarif à paliers : on ne sait alors pas comparer, et on le dit.
      const preleve = Number.isFinite(p?.unit_amount) ? p.unit_amount / 100 : null;
      if (preleve === null) return { ...base, preleve: null, etat: "non_comparable" };
      if (base.affiche === null) return { ...base, preleve, etat: "affichage_absent" };
      // Comparaison au centime : deux montants égaux ne doivent pas diverger
      // sur une erreur de virgule flottante.
      const ecart = Math.round((preleve - base.affiche) * 100);
      return { ...base, preleve, etat: ecart === 0 ? "conforme" : "ecart", ecartCentimes: ecart };
    } catch (e) {
      console.error(`[prix] comparaison impossible pour ${id} :`, e.message);
      return { ...base, preleve: null, etat: "illisible" };
    }
  }));

  const ecarts = lignes.filter(l => l.etat === "ecart");
  const incertains = lignes.filter(l => ["illisible", "tarif_absent", "non_comparable", "affichage_absent"].includes(l.etat));
  return {
    ok: ecarts.length === 0 && incertains.length === 0,
    indisponible: incertains.length > 0,
    lignes, ecarts,
  };
}

/** Une phrase lisible par un humain, pour un journal ou un courriel. */
export function resumeEcart(ligne) {
  const eur = (v) => v === null ? "—" : `${Number(v).toFixed(2).replace(".", ",")} €`;
  if (ligne.etat === "ecart") {
    return `${ligne.libelle} : affiché ${eur(ligne.affiche)}, prélevé ${eur(ligne.preleve)}`;
  }
  if (ligne.etat === "tarif_absent")     return `${ligne.libelle} : aucun tarif Stripe renseigné`;
  if (ligne.etat === "affichage_absent") return `${ligne.libelle} : prix non affiché aux prestataires`;
  if (ligne.etat === "non_comparable")   return `${ligne.libelle} : tarif Stripe à paliers, non comparable`;
  if (ligne.etat === "illisible")        return `${ligne.libelle} : tarif Stripe illisible`;
  return `${ligne.libelle} : conforme`;
}
