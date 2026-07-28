export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
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

    // Décoder le JWT localement — aucun appel réseau, atob disponible en Edge
    let userId;
    try {
      const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(atob(b64));
      if (payload?.sub && payload?.exp * 1000 > Date.now() + 5000) {
        userId = payload.sub;
      }
    } catch { /* continue */ }

    if (!userId) {
      return new Response(JSON.stringify({ error: 'Token expiré — reconnectez-vous.', expired: true }), { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { docType, fileName, mimeType } = body;
    if (!docType) {
      return new Response(JSON.stringify({ error: 'docType requis' }), { status: 400 });
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
    }).catch(() => {});

    return new Response(JSON.stringify({ signedUrl, storagePath }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: `Erreur inattendue: ${e?.message || 'inconnue'}` }), { status: 500 });
  }
}
