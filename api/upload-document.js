export const config = {
  runtime: 'edge',
};

// ═══════════════════════════════════════════════════════════════════════════
// EN SURSIS — plus aucun écran n'appelle cette fonction (11/09/2026)
// ═══════════════════════════════════════════════════════════════════════════
//
// Les envois de documents passent aujourd'hui par le Storage Supabase depuis le
// navigateur. Ses trois voisines mortes — `get-documents`, `save-document` et
// `update-profile` — ont été supprimées le même jour : deux d'entre elles
// ÉCRIVAIENT, et un point d'entrée authentifié qui modifie des données sans
// aucun usage n'est que de la surface d'attaque.
//
// Celle-ci est gardée en sursis pour une raison précise : le service worker met
// à jour les fichiers, mais un onglet resté ouvert continue d'exécuter le
// JavaScript du premier jour. Une application installée depuis trois semaines
// pourrait donc encore l'appeler, et la supprimer casserait l'envoi de
// documents pour son propriétaire, en silence.
//
// D'où le journal ci-dessous plutôt qu'une suppression à l'aveugle : au lieu de
// deviner, on saura. S'il ne s'allume jamais d'ici trois semaines, la fonction
// part à son tour.


const TYPES_PIECES = ["photo", "kbis", "urssaf", "cni", "domicile", "rib", "rc_pro", "diplomes", "tva", "autre", "titre_sejour"];

export default async function handler(req) {
  // Trace de survie — voir le bandeau ci-dessus. `console.warn` et non `log` :
  // elle doit ressortir dans les journaux Vercel sans qu'on la cherche.
  console.warn("[upload-document] APPELÉE — cette fonction était réputée morte. "
    + "Ne pas la supprimer avant d'avoir compris d'où vient cet appel. "
    + `méthode=${req.method} ua=${String(req.headers.get("user-agent") || "").slice(0, 120)}`);

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  try {
    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.replace('Bearer ', '').trim();
    if (!token) {
      return new Response(JSON.stringify({ error: 'Token requis', expired: true }), { status: 401 });
    }

    const SUPABASE_URL     = ((process.env.VITE_SUPABASE_URL || "").replace(/\s/g, "") || '').replace(/\s/g, '');
    const SERVICE_ROLE_KEY = ((process.env.SUPABASE_SERVICE_ROLE_KEY || "").replace(/\s/g, "") || '').replace(/\s/g, '');
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({ error: 'Configuration manquante' }), { status: 500 });
    }

    // Le jeton est VÉRIFIÉ auprès de Supabase. Il était seulement décodé,
    // signature ignorée : n'importe qui pouvait en fabriquer un au nom d'un
    // prestataire, obtenir une adresse d'envoi vers ses pièces et les
    // remplacer (audit « sécurité », 01/10/2026, e2e/56).
    let userId;
    try {
      const ru = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { 'apikey': SERVICE_ROLE_KEY, 'Authorization': `Bearer ${token}` },
      });
      const u = ru.ok ? await ru.json() : null;
      userId = u?.id || null;
    } catch (e) {
      console.error('[upload-document] vérification du jeton impossible :', e?.message);
    }

    if (!userId) {
      return new Response(JSON.stringify({ error: 'Session expirée — reconnectez-vous.', expired: true }), { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { docType } = body;
    // Le type devient un segment du chemin : hors de la liste, `../autre/cni`
    // écrivait dans le dossier d'un autre compte. Même liste que la contrainte
    // de la base et que api/notify-doc.js.
    if (!TYPES_PIECES.includes(docType)) {
      return new Response(JSON.stringify({ error: 'docType invalide' }), { status: 400 });
    }

    // Nom stable par (prestataire, type) : le remplacement écrase le fichier
    // précédent (upsert plus bas), aucune accumulation d'orphelins.
    const storagePath = `${userId}/${docType}`;

    const svcHeaders = {
      'apikey': SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    };

    // Générer une URL d'upload signée — timeout 8s (Edge : aucun cold start)
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    let signedUrl;
    try {
      const signRes = await fetch(
        `${SUPABASE_URL}/storage/v1/object/upload/sign/Documents/${storagePath}`,
        { method: 'POST', headers: svcHeaders, body: JSON.stringify({ expiresIn: 300, upsert: true }), signal: ctrl.signal }
      );
      clearTimeout(timer);

      if (!signRes.ok) {
        const err = await signRes.text().catch(() => '?');
        console.error('[upload-document] sign error:', signRes.status, err);
        return new Response(JSON.stringify({ error: `Erreur génération URL upload (${signRes.status})` }), { status: 500 });
      }

      const sd = await signRes.json();
      signedUrl = sd.signedURL || sd.url || '';
      if (signedUrl && !signedUrl.startsWith('http')) signedUrl = `${SUPABASE_URL}${signedUrl}`;
    } catch (e) {
      clearTimeout(timer);
      const msg = e?.name === 'AbortError' ? 'Timeout Supabase Storage (>8s)' : (e?.message || 'erreur réseau');
      console.error('[upload-document] sign fetch error:', msg);
      return new Response(JSON.stringify({ error: `Impossible de contacter Supabase Storage: ${msg}` }), { status: 500 });
    }

    if (!signedUrl) {
      return new Response(JSON.stringify({ error: 'URL signée vide — réponse inattendue de Supabase' }), { status: 500 });
    }

    // Pré-enregistrer le document en base (non bloquant)
    fetch(`${SUPABASE_URL}/rest/v1/documents?on_conflict=prestataire_id,type`, {
      method: 'POST',
      headers: { ...svcHeaders, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ prestataire_id: userId, type: docType, storage_path: storagePath, verified: false }),
    }).catch(e => console.error("[upload-document] échec ignoré :", e?.message));

    return new Response(JSON.stringify({ signedUrl, storagePath }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: `Erreur inattendue: ${e?.message || 'inconnue'}` }), { status: 500 });
  }
}
