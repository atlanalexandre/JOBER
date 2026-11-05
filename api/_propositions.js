// Registre des prestations proposées à un prestataire (04/11/2026).
//
// Sert la garantie « mois sans proposition » (api/_garantie.js) : il faut
// pouvoir prouver qu'une prestation a été proposée, même refusée ou laissée
// sans réponse. Les notifications ne le prouvent pas — le prestataire peut
// modifier les siennes. Ce registre, seul le serveur l'écrit (RLS sans policy).
//
// Ne lève jamais : noter la proposition ne doit pas empêcher de la faire. Un
// échec est journalisé — il jouerait en faveur du prestataire, jamais contre.

/**
 * @param {{supabaseUrl:string, headers:object, prestataireId:string, missionId?:string, canal:"directe"|"diffusion"}} o
 * @returns {Promise<boolean>}
 */
export async function noterProposition({ supabaseUrl, headers, prestataireId, missionId = null, canal }) {
  if (!prestataireId) return false;
  try {
    const r = await fetch(`${supabaseUrl}/rest/v1/propositions_recues`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json", "Prefer": "return=minimal" },
      body: JSON.stringify({ prestataire_id: prestataireId, mission_id: missionId, canal }),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      console.error(`[propositions] proposition NON notée (${canal}, prestataire ${prestataireId}, prestation ${missionId}) : ${r.status} ${t.slice(0, 160)}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`[propositions] proposition NON notée (${canal}, prestataire ${prestataireId}) :`, e.message);
    return false;
  }
}
