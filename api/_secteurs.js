// ═══════════════════════════════════════════════════════════════════════════
// Ouverture et fermeture des secteurs
// ═══════════════════════════════════════════════════════════════════════════
//
// POURQUOI CE FICHIER
//
// Un secteur ouvert sans prestataire disponible est une promesse qu'ALANE ne
// peut pas tenir : le client commande, personne n'accepte, il est remboursé
// quinze jours plus tard et ne revient pas.
//
// Un seuil automatique a existé, à 30 prestataires. Il n'a jamais fonctionné :
// l'action qui compte les prestataires répondait 401 à ses deux appelants. Le
// jour où ce 401 a été corrigé (30/07/2026), appliquer le seuil aurait fermé
// tous les secteurs d'un coup et rendu la plateforme non réservable — il a donc
// été retiré au profit d'une décision manuelle.
//
// Il est rétabli à la demande d'Alexandre, réglable depuis le backoffice, avec
// une différence essentielle par rapport à la version précédente : une
// possibilité de FORCER L'OUVERTURE d'un secteur sous le seuil. Sans elle,
// aucune plateforme ne peut démarrer — il faudrait vingt prestataires pour
// accepter la première commande, et une première commande pour attirer des
// prestataires.
//
// LES TROIS RÉGLAGES
//
//   sector_min_prestataires   nombre        seuil d'ouverture automatique (20)
//   disabled_sectors          [ "id", … ]   fermés d'autorité, quoi qu'il arrive
//   forced_open_sectors       [ "id", … ]   ouverts malgré un effectif insuffisant
//
// ORDRE DE PRIORITÉ
//
//   1. fermé d'autorité       → fermé, sans discussion
//   2. ouverture forcée       → ouvert, même à zéro prestataire
//   3. effectif ≥ seuil       → ouvert
//   4. sinon                  → fermé
//
// La fermeture d'autorité l'emporte sur l'ouverture forcée : entre deux réglages
// contradictoires, on retient le plus prudent.
// ═══════════════════════════════════════════════════════════════════════════

export const SECTEURS_CONNUS = [
  "proprete", "logistique", "hotellerie", "restauration",
  "commercial", "distribution", "divers",
];

export const SEUIL_PAR_DEFAUT = 20;

/**
 * Lit les trois réglages. Ne lève jamais : un réglage illisible ne doit pas
 * empêcher la plateforme de répondre.
 *
 * Un réglage illisible retombe sur sa valeur par défaut — seuil à 20, aucune
 * fermeture, aucune ouverture forcée. C'est volontairement le comportement
 * prudent : à défaut d'information, on ne prétend pas qu'un secteur est prêt.
 *
 * Le cas de la panne franche est traité ailleurs : `secteurOuvert()` autorise la
 * réservation si l'état ne peut pas être calculé du tout. Une base indisponible
 * ne doit pas empêcher un client de commander.
 */
export async function lireReglagesSecteurs(supabaseUrl, headers) {
  const lire = async (cle, defaut) => {
    try {
      const r = await fetch(`${supabaseUrl}/rest/v1/platform_settings?key=eq.${cle}&select=value`, { headers });
      const d = await r.json();
      const v = Array.isArray(d) && d[0]?.value;
      return v === undefined || v === null ? defaut : v;
    } catch (e) {
      console.error(`[secteurs] lecture de ${cle} impossible :`, e.message);
      return defaut;
    }
  };

  const [seuilBrut, fermes, forces] = await Promise.all([
    lire("sector_min_prestataires", SEUIL_PAR_DEFAUT),
    lire("disabled_sectors", []),
    lire("forced_open_sectors", []),
  ]);

  const seuil = Number(seuilBrut);
  return {
    seuil: Number.isFinite(seuil) && seuil >= 0 ? seuil : SEUIL_PAR_DEFAUT,
    fermes: Array.isArray(fermes) ? fermes : [],
    forces: Array.isArray(forces) ? forces : [],
  };
}

/**
 * État d'un secteur donné.
 * @returns {{open:boolean, disabled:boolean, force_ouvert:boolean, sous_seuil:boolean, count:number, seuil:number}}
 */
export function etatSecteur(secteur, effectif, reglages) {
  const count = Number(effectif) || 0;
  const { seuil, fermes, forces } = reglages;

  const disabled     = fermes.includes(secteur);
  const force_ouvert = !disabled && forces.includes(secteur);
  const sous_seuil   = count < seuil;

  return {
    count,
    seuil,
    disabled,
    force_ouvert,
    sous_seuil,
    open: !disabled && (force_ouvert || !sous_seuil),
  };
}

/**
 * État de tous les secteurs connus, à partir d'un décompte par secteur.
 * @param {Record<string, number>} effectifs
 */
export function etatDesSecteurs(effectifs, reglages) {
  const out = {};
  for (const s of SECTEURS_CONNUS) {
    out[s] = etatSecteur(s, effectifs?.[s] || 0, reglages);
  }
  return out;
}

/**
 * Message rendu au client lorsqu'une réservation est refusée.
 * On ne dit pas « il manque 19 prestataires » : c'est une information interne,
 * et l'afficher donnerait au client la mesure exacte de la faiblesse du réseau.
 */
export function messageSecteurFerme(_secteur) {
  return "Ce secteur n'est pas encore ouvert à la réservation dans votre zone. "
       + "Nous vous préviendrons dès qu'il le sera.";
}


// ═══════════════════════════════════════════════════════════════════════════
// État d'ouverture, avec cache de cinq minutes
// ═══════════════════════════════════════════════════════════════════════════
//
// Ce calcul vivait dans `api/missions.js`. Il en a été sorti le 16/08/2026,
// après un incident : le secteur n'était vérifié qu'APRÈS l'encaissement, dans
// `assign_after_payment`. Un client réservait, était débité, puis recevait
// « ce secteur n'est pas encore ouvert à la réservation » — l'argent parti, la
// prestation sans prestataire, et personne de prévenu côté prestataire.
//
// La règle doit donc être lisible depuis `/api/stripe-intent`, c'est-à-dire
// AVANT que le moindre euro ne bouge. Elle est ici pour être appelée des deux
// endroits, sans être recopiée.
//
// Le décompte impose d'énumérer les comptes : c'est coûteux, d'où le cache.

export async function etatSecteursAvecCache(supabaseUrl, headers) {
  const cache = globalThis.__alaneSectorCache;
  if (cache && Date.now() - cache.ts < 300_000) return cache.data;

  const reglages = await lireReglagesSecteurs(supabaseUrl, headers);

  const pr = await fetch(
    `${supabaseUrl}/rest/v1/profiles?role=eq.prestataire&status=eq.approved&missions_enabled=is.true&select=id`,
    { headers }
  );
  const profileData = await pr.json().catch(() => []);
  const approvedIds = new Set((Array.isArray(profileData) ? profileData : []).map(p => p.id));

  // Pagination : au-delà de 1000 comptes, une seule page en oublierait.
  let allUsers = [];
  let page = 1;
  while (true) {
    const ur = await fetch(`${supabaseUrl}/auth/v1/admin/users?per_page=1000&page=${page}`, { headers });
    const ud = await ur.json().catch(() => ({}));
    const batch = ud.users || [];
    allUsers = allUsers.concat(batch);
    if (batch.length < 1000) break;
    page++;
  }

  const counts = {};
  for (const u of allUsers) {
    if (!approvedIds.has(u.id)) continue;
    const sector = u.user_metadata?.secteur || u.user_metadata?.sector;
    if (sector) counts[sector] = (counts[sector] || 0) + 1;
  }

  const data = etatDesSecteurs(counts, reglages);
  globalThis.__alaneSectorCache = { ts: Date.now(), data };
  return data;
}

// Le secteur est-il réservable ? Un secteur inconnu n'est pas bloqué : la liste
// des secteurs connus est côté code, et refuser sur cette base casserait toute
// réservation le jour où un secteur est ajouté sans mise à jour du module.
//
// Une panne de lecture autorise également la réservation : une base
// indisponible ne doit pas empêcher un client de commander.
export async function secteurOuvert(secteur, supabaseUrl, headers) {
  if (!secteur) return true;
  try {
    const etats = await etatSecteursAvecCache(supabaseUrl, headers);
    const e = etats[secteur];
    return e ? e.open : true;
  } catch (e) {
    console.error("[secteurs] état indisponible, réservation autorisée :", e.message);
    return true;
  }
}
