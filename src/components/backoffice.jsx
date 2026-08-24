import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase.js";
import { C, font, r, shadow } from "../constants/colors.js";
import { SECTOR_LABELS, SECTORS } from "../constants/data.js";
import { Btn, Input, Badge, SectionHeader, Card, MiniBar, DonutChart, Stars, showToast, showConfirm, showPrompt } from "./ui.jsx";

// Libellés des types de documents. Déclarés une seule fois : deux copies locales
// coexistaient dans le rendu, et celle de la liste des comptes avait oublié `tva`,
// qui s'affichait donc en brut.
const DOC_LABELS = {
  kbis:"KBIS / SIRET", urssaf:"Attestation URSSAF", cni:"Pièce d'identité", rib:"RIB / IBAN",
  tva:"Attestation TVA", rc_pro:"RC Pro", rcpro:"RC Pro", photo:"Photo profil",
  domicile:"Justif. domicile", diplomes:"Diplômes", autre:"Autre document",
};

// Icônes des types de documents — même raison que DOC_LABELS ci-dessus : trois
// copies divergentes coexistaient, dont deux sans `tva`.
const DOC_ICONS = {
  kbis:"🏢", urssaf:"🏛️", cni:"🪪", rib:"💳", tva:"📋", rc_pro:"🛡️", rcpro:"🛡️",
  photo:"📸", domicile:"🏠", diplomes:"🎓", autre:"📄",
};

// Helper centralisé pour tous les appels BO — injecte automatiquement le token signé
export function boFetch(body) {
  let token = ""; try { token = sessionStorage.getItem("bo_token") || ""; } catch(e) {}
  return fetch("/api/bo-action", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

export function useBoData() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [visits, setVisits] = useState(null);
  const [authError, setAuthError] = useState(null);

  const fetchAll = () => Promise.all([
    boFetch({ action: "stats" }).then(async r => {
      const j = await r.json();
      if (r.status === 401 || (j && j.error && !j.users)) {
        setAuthError(j.error || "Token invalide");
        return null;
      }
      setAuthError(null);
      return (j && j.users) ? j : null;
    }).catch(e => { setAuthError(e?.message || "Erreur réseau"); return null; }),
    boFetch({ action: "visits_stats" }).then(r => r.json()).catch(() => null),
  ]).then(([stats, vis]) => {
    setData(stats);
    setVisits(vis);
    setLoading(false);
  });

  useEffect(() => {
    fetchAll();
    const iv = setInterval(fetchAll, 60000);
    return () => clearInterval(iv);
  }, []);

  return { data, loading, visits, authError };
}

// AlertRow — backoffice alertes
function AlertRow({ a }) {
  const [done, setDone] = useState(false);
  return (
    <div style={{ background:"#0D1B3E", borderRadius:r, padding:"13px 14px", marginBottom:9, border:`2px solid ${done?C.success+"44":a.color+"33"}`, display:"flex", gap:10, alignItems:"center", opacity:done?0.6:1, transition:"all 0.3s" }}>
      <div style={{ width:40, height:40, borderRadius:12, background:`${done?C.success:a.color}15`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>{done?"✅":a.icon}</div>
      <div style={{ flex:1 }}>
        <div style={{ fontWeight:700, color:C.text, fontSize:13 }}>{a.text}</div>
        {!done && a.urgent && <Badge color={a.color} small>Urgent</Badge>}
        {done && <span style={{ fontSize:11, color:C.success, fontWeight:600 }}>Traité ✓</span>}
      </div>
      {!done && <button onClick={()=>setDone(true)} style={{ padding:"7px 12px", borderRadius:10, border:"none", background:`${a.color}18`, color:a.color, fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>Traiter</button>}
    </div>
  );
}

export function BackofficeLogin({ onLogin, onBack }) {
  const [pwd, setPwd]           = useState("");
  const [show, setShow]         = useState(false);
  const [error, setError]       = useState("");
  const [needsSetup, setNeedsSetup] = useState(false);
  const [checking, setChecking] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const locked = attempts >= 5;

  const handleSubmit = () => {
    if (!pwd.trim() || checking || locked) return;
    setChecking(true); setError("");
    fetch("/api/bo-verify-pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: pwd }),
    })
      .then(async r => {
        const text = await r.text();
        let j;
        try { j = JSON.parse(text); } catch { throw new Error(`Réponse serveur (${r.status}): ${text.slice(0, 120)}`); }
        return { status: r.status, ...j };
      })
      .then(j => {
        setChecking(false);
        if (j.ok) { try { sessionStorage.setItem("bo_token", j.token || ""); } catch(e) {} onLogin(); }
        else {
          if (j.needsSetup) setNeedsSetup(true);
          setError(j.error || "Mot de passe incorrect");
          setPwd(""); setAttempts(a => a + 1);
        }
      })
      .catch((e) => { setChecking(false); setError(e?.message || "Erreur réseau inconnue"); setPwd(""); setAttempts(a => a + 1); });
  };

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(160deg,#050E20,#0A1628,#1E3A7B)`, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:32, position:"relative" }}>
      <button onClick={onBack} style={{ position:"absolute", top:54, left:22, background:"rgba(255,255,255,0.15)", border:"none", borderRadius:10, padding:"7px 14px", color:C.white, cursor:"pointer", fontSize:13 }}>← Retour</button>

      <div style={{ width:72, height:72, borderRadius:22, background:`${C.violet}44`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:32, marginBottom:20, border:`2px solid ${C.violet}66` }}>🔐</div>
      <h2 style={{ color:C.white, fontSize:22, fontWeight:800, margin:"0 0 6px", fontFamily:font.display }}>Backoffice ALANE</h2>
      <p style={{ color:"rgba(255,255,255,0.6)", fontSize:14, margin:"0 0 36px" }}>Accès administrateur uniquement</p>

      {locked && <p style={{ color:C.accent, fontSize:13, marginBottom:16, fontWeight:600 }}>Accès bloqué — trop de tentatives</p>}
      {!locked && error && <p style={{ color:C.accent, fontSize:13, marginBottom:16, fontWeight:600 }}>{error}</p>}
      {/* Le mot de passe de repli était affiché ici, en clair, avec un bouton
          pour s'en servir : une variable d'environnement absente ouvrait le
          backoffice à quiconque ouvrait cette page. Il ne se lit désormais que
          dans les journaux Vercel, auxquels seul le propriétaire a accès. */}
      {needsSetup && (
        <div style={{ background:"rgba(196,169,107,0.12)", border:"1px solid rgba(196,169,107,0.4)", borderRadius:10, padding:"10px 14px", marginBottom:12, maxWidth:320, width:"100%" }}>
          <p style={{ color:"rgba(196,169,107,0.9)", fontSize:11, margin:"0 0 6px", fontWeight:700 }}>BO_PASSWORD n&apos;est pas configuré</p>
          <p style={{ color:"rgba(255,255,255,0.7)", fontSize:11, margin:0, lineHeight:1.6 }}>
            Définissez-le dans Vercel → Settings → Environment Variables, puis redéployez.
            Un mot de passe de repli figure dans les journaux du projet
            (Vercel → Logs, fonction <span style={{ fontFamily:"monospace" }}>bo-verify-pin</span>).
          </p>
        </div>
      )}
      {!locked && !error && !needsSetup && <p style={{ color:"rgba(255,255,255,0.6)", fontSize:13, marginBottom:16 }}>{checking ? "Vérification…" : "Entrez votre mot de passe"}</p>}

      <div style={{ width:"100%", maxWidth:320, position:"relative", marginBottom:16 }}>
        <input
          type={show ? "text" : "password"}
          value={pwd}
          onChange={e => { setPwd(e.target.value); setError(""); }}
          onKeyDown={e => e.key === "Enter" && handleSubmit()}
          disabled={locked || checking}
          placeholder="Mot de passe administrateur"
          autoComplete="current-password"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          style={{ width:"100%", boxSizing:"border-box", background:"rgba(255,255,255,0.08)", border:`2px solid ${error ? C.danger : "rgba(255,255,255,0.15)"}`, borderRadius:14, padding:"15px 48px 15px 18px", color:C.white, fontSize:16, fontFamily:"inherit", outline:"none", transition:"border-color 0.2s" }}
        />
        <button onClick={() => setShow(s => !s)} style={{ position:"absolute", right:14, top:"50%", transform:"translateY(-50%)", background:"transparent", border:"none", color:"rgba(255,255,255,0.6)", cursor:"pointer", fontSize:18, lineHeight:1 }}>
          {show ? "🙈" : "👁️"}
        </button>
      </div>

      <button
        onClick={handleSubmit}
        disabled={!pwd.trim() || locked || checking}
        style={{ width:"100%", maxWidth:320, padding:"15px", borderRadius:14, border:"none", background: (!pwd.trim() || locked || checking) ? "rgba(124,111,224,0.3)" : C.violet, color:C.white, fontSize:16, fontWeight:800, cursor: (!pwd.trim() || locked || checking) ? "default" : "pointer", fontFamily:"inherit", transition:"all 0.2s" }}>
        {checking ? "Vérification…" : "Accéder au backoffice →"}
      </button>
    </div>
  );
}

function DemoDocPreview({ type }) {
  const S = { // styles communs
    page: { background:"#fff", borderRadius:8, width:"100%", maxWidth:560, margin:"0 auto", fontFamily:"'Arial',sans-serif", color:"#1a1a1a", overflow:"hidden", boxShadow:"0 4px 24px rgba(0,0,0,0.3)" },
    header: { background:"#003189", color:"#fff", padding:"16px 24px", display:"flex", alignItems:"center", justifyContent:"space-between" },
    body: { padding:"20px 24px" },
    row: { display:"flex", justifyContent:"space-between", borderBottom:"1px solid #eee", padding:"7px 0", fontSize:13 },
    label: { color:"#666", fontWeight:600, fontSize:12 },
    value: { color:"#1a1a1a", fontWeight:700, fontSize:13, textAlign:"right" },
    stamp: { border:"3px solid #22C55E", borderRadius:8, padding:"6px 14px", color:"#22C55E", fontWeight:900, fontSize:13, display:"inline-block", transform:"rotate(-5deg)", letterSpacing:1, marginTop:12 },
    section: { fontWeight:700, fontSize:11, color:"#003189", textTransform:"uppercase", letterSpacing:1, borderBottom:"2px solid #003189", paddingBottom:4, marginBottom:10, marginTop:16 },
  };

  if (type === "kbis") return (
    <div style={S.page}>
      <div style={S.header}>
        <div>
          <div style={{ fontSize:10, opacity:0.7, letterSpacing:2, marginBottom:2 }}>TRIBUNAL DE COMMERCE DE PARIS</div>
          <div style={{ fontWeight:900, fontSize:16, letterSpacing:1 }}>EXTRAIT K-BIS</div>
        </div>
        <div style={{ textAlign:"right", fontSize:11 }}>
          <div>N° RCS : 823 456 789</div>
          <div style={{ opacity:0.7 }}>Paris B</div>
        </div>
      </div>
      <div style={S.body}>
        <div style={S.section}>Identification de l'entreprise</div>
        {[["Dénomination","ATLAN SERVICES SAS"],["Forme juridique","Société par Actions Simplifiée"],["Capital social","10 000,00 €"],["SIRET","823 456 789 00015"],["Code APE","7820Z – Activité des agences de travail temporaire"],["Date d'immatriculation","15/03/2019"],["Adresse","12 Rue de la Paix, 75002 Paris"]].map(([l,v])=>(
          <div key={l} style={S.row}><span style={S.label}>{l}</span><span style={S.value}>{v}</span></div>
        ))}
        <div style={{ textAlign:"center", marginTop:16 }}>
          <div style={S.stamp}>✓ CERTIFIÉ CONFORME</div>
          <div style={{ fontSize:10, color:"#999", marginTop:8 }}>Délivré le 12/01/2025 — Greffe du Tribunal de Commerce de Paris</div>
        </div>
      </div>
    </div>
  );

  if (type === "urssaf") return (
    <div style={S.page}>
      <div style={{ ...S.header, background:"#C8102E" }}>
        <div>
          <div style={{ fontSize:10, opacity:0.7, letterSpacing:2, marginBottom:2 }}>URSSAF ÎLE-DE-FRANCE</div>
          <div style={{ fontWeight:900, fontSize:15 }}>ATTESTATION DE VIGILANCE</div>
        </div>
        <div style={{ fontSize:22, opacity:0.6 }}>🏛️</div>
      </div>
      <div style={S.body}>
        <div style={S.section}>Employeur</div>
        {[["Raison sociale","ATLAN SERVICES SAS"],["SIRET","823 456 789 00015"],["Adresse","12 Rue de la Paix, 75002 Paris"]].map(([l,v])=>(
          <div key={l} style={S.row}><span style={S.label}>{l}</span><span style={S.value}>{v}</span></div>
        ))}
        <div style={S.section}>Attestation</div>
        <div style={{ fontSize:13, lineHeight:1.7, color:"#333", background:"#f8f9fa", borderRadius:6, padding:"12px 14px", marginBottom:12 }}>
          L'URSSAF Île-de-France atteste que l'entreprise <strong>ATLAN SERVICES SAS</strong> est à jour de ses obligations déclaratives et de paiement envers les organismes de recouvrement à la date du présent document.
        </div>
        {[["Période couverte","01/01/2025 – 31/03/2025"],["Date d'émission","10/01/2025"],["Référence","URSSAFx2025-0088741"]].map(([l,v])=>(
          <div key={l} style={S.row}><span style={S.label}>{l}</span><span style={S.value}>{v}</span></div>
        ))}
        <div style={{ textAlign:"center", marginTop:12 }}>
          <div style={S.stamp}>✓ VALIDE</div>
        </div>
      </div>
    </div>
  );

  if (type === "rc_pro") return (
    <div style={S.page}>
      <div style={{ ...S.header, background:"#1E3A5F" }}>
        <div>
          <div style={{ fontSize:10, opacity:0.7, letterSpacing:2, marginBottom:2 }}>AXA FRANCE IARD</div>
          <div style={{ fontWeight:900, fontSize:15 }}>ATTESTATION RC PROFESSIONNELLE</div>
        </div>
        <div style={{ fontSize:22, opacity:0.6 }}>🛡️</div>
      </div>
      <div style={S.body}>
        <div style={S.section}>Assuré</div>
        {[["Nom / Raison sociale","ATLAN SERVICES SAS"],["SIRET","823 456 789 00015"],["Activité","Mise à disposition de personnel"],["Adresse","12 Rue de la Paix, 75002 Paris"]].map(([l,v])=>(
          <div key={l} style={S.row}><span style={S.label}>{l}</span><span style={S.value}>{v}</span></div>
        ))}
        <div style={S.section}>Contrat</div>
        {[["N° de police","AXA-RC-2024-887654"],["Garanties","RC exploitation + RC professionnelle"],["Capital garanti","2 000 000 €"],["Période de validité","01/01/2025 – 31/12/2025"],["Émise le","05/01/2025"]].map(([l,v])=>(
          <div key={l} style={S.row}><span style={S.label}>{l}</span><span style={S.value}>{v}</span></div>
        ))}
        <div style={{ textAlign:"center", marginTop:12 }}>
          <div style={S.stamp}>✓ EN VIGUEUR</div>
        </div>
      </div>
    </div>
  );

  if (type === "rib") return (
    <div style={S.page}>
      <div style={{ ...S.header, background:"#00843D" }}>
        <div>
          <div style={{ fontSize:10, opacity:0.7, letterSpacing:2, marginBottom:2 }}>CRÉDIT AGRICOLE ILE-DE-FRANCE</div>
          <div style={{ fontWeight:900, fontSize:15 }}>RELEVÉ D'IDENTITÉ BANCAIRE</div>
        </div>
        <div style={{ fontSize:22, opacity:0.6 }}>💳</div>
      </div>
      <div style={S.body}>
        <div style={S.section}>Titulaire du compte</div>
        {[["Titulaire","ATLAN SERVICES SAS"],["Adresse","12 Rue de la Paix, 75002 Paris"]].map(([l,v])=>(
          <div key={l} style={S.row}><span style={S.label}>{l}</span><span style={S.value}>{v}</span></div>
        ))}
        <div style={S.section}>Coordonnées bancaires</div>
        {[["Banque","18206"],["Guichet","00060"],["N° de compte","06123456789"],["Clé RIB","56"],["Domiciliation","CA IDF PARIS 08"]].map(([l,v])=>(
          <div key={l} style={S.row}><span style={S.label}>{l}</span><span style={S.value} style={{ fontFamily:"monospace" }}>{v}</span></div>
        ))}
        <div style={{ background:"#f0f7f0", borderRadius:8, padding:"12px 16px", marginTop:14, border:"1px solid #22C55E22" }}>
          <div style={{ fontSize:10, color:"#666", fontWeight:600, marginBottom:4 }}>IBAN</div>
          <div style={{ fontFamily:"monospace", fontSize:16, fontWeight:900, color:"#003189", letterSpacing:2 }}>FR76 1820 6000 6006 1234 5678 956</div>
          <div style={{ fontFamily:"monospace", fontSize:13, color:"#555", marginTop:4 }}>BIC : AGRIFRPP882</div>
        </div>
      </div>
    </div>
  );

  if (type === "cni") return (
    <div style={S.page}>
      <div style={{ background:"#002395", padding:"0" }}>
        <div style={{ background:"linear-gradient(135deg,#002395,#ED2939)", padding:"20px 24px 12px", color:"#fff" }}>
          <div style={{ fontSize:9, letterSpacing:3, opacity:0.8, marginBottom:4 }}>RÉPUBLIQUE FRANÇAISE</div>
          <div style={{ fontWeight:900, fontSize:14, letterSpacing:2 }}>CARTE NATIONALE D'IDENTITÉ</div>
        </div>
        <div style={{ background:"#fff", padding:"20px 24px" }}>
          <div style={{ display:"flex", gap:16, alignItems:"flex-start" }}>
            <div style={{ width:80, height:100, background:"#e8e8e8", borderRadius:4, display:"flex", alignItems:"center", justifyContent:"center", fontSize:36, flexShrink:0 }}>👤</div>
            <div style={{ flex:1 }}>
              {[["Nom","ATLAN"],["Prénom(s)","Alexandre Jean"],["Date de naissance","14/03/1992"],["Lieu de naissance","Paris (75)"],["Nationalité","Française"],["Sexe","M"]].map(([l,v])=>(
                <div key={l} style={{ marginBottom:6 }}>
                  <div style={{ fontSize:9, color:"#002395", fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>{l}</div>
                  <div style={{ fontSize:13, fontWeight:700, color:"#1a1a1a" }}>{v}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ borderTop:"1px solid #eee", marginTop:14, paddingTop:10 }}>
            {[["N° carte","991234567890"],["Date de délivrance","20/06/2022"],["Date d'expiration","20/06/2032"],["Délivrée par","Préfecture de Police de Paris"]].map(([l,v])=>(
              <div key={l} style={S.row}><span style={S.label}>{l}</span><span style={S.value}>{v}</span></div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  if (type === "domicile") return (
    <div style={S.page}>
      <div style={{ ...S.header, background:"#F05A22" }}>
        <div>
          <div style={{ fontSize:10, opacity:0.7, letterSpacing:2, marginBottom:2 }}>EDF — ÉLECTRICITÉ DE FRANCE</div>
          <div style={{ fontWeight:900, fontSize:15 }}>FACTURE D'ÉLECTRICITÉ</div>
        </div>
        <div style={{ fontSize:22, opacity:0.6 }}>🏠</div>
      </div>
      <div style={S.body}>
        <div style={S.section}>Client</div>
        {[["Nom","Alexandre ATLAN"],["Adresse de fourniture","12 Rue de la Paix, Apt 3B"],["Code postal / Ville","75002 Paris"],["Référence client","0612345678901"]].map(([l,v])=>(
          <div key={l} style={S.row}><span style={S.label}>{l}</span><span style={S.value}>{v}</span></div>
        ))}
        <div style={S.section}>Facture</div>
        {[["N° de facture","EDF-2025-01-887456"],["Période","01/12/2024 – 31/12/2024"],["Date d'émission","08/01/2025"],["Montant TTC","87,42 €"],["Échéance","28/01/2025"]].map(([l,v])=>(
          <div key={l} style={S.row}><span style={S.label}>{l}</span><span style={S.value}>{v}</span></div>
        ))}
        <div style={{ textAlign:"center", marginTop:12 }}>
          <div style={S.stamp}>✓ PAYÉE</div>
        </div>
      </div>
    </div>
  );

  if (type === "photo") return (
    <div style={{ textAlign:"center", padding:24 }}>
      <div style={{ width:180, height:180, borderRadius:"50%", background:"linear-gradient(135deg,#7C6FE0,#4F46E5)", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 16px", border:"4px solid rgba(124,111,224,0.4)", fontSize:80 }}>
        👤
      </div>
      <div style={{ color:"#fff", fontWeight:700, fontSize:18, marginBottom:4 }}>Alexandre ATLAN</div>
      <div style={{ color:"rgba(255,255,255,0.6)", fontSize:13, marginBottom:16 }}>Prestataire · Plan Élite</div>
      <div style={{ background:"rgba(34,197,94,0.1)", border:"1px solid rgba(34,197,94,0.3)", borderRadius:10, padding:"8px 20px", display:"inline-block" }}>
        <span style={{ color:"#22C55E", fontWeight:700, fontSize:13 }}>✓ Photo validée</span>
      </div>
    </div>
  );

  return null;
}

export function BOComptes() {
  const [profiles, setProfiles]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [filter, setFilter]       = useState("pending");
  const [roleFilter, setRoleFilter] = useState("all");
  const [actioning, setActioning] = useState(null);
  const [expanded, setExpanded]   = useState(null);
  const [verifs, setVerifs]       = useState({});
  // IBAN révélés dans cette session d'écran, par identifiant de compte.
  const [ibansReveles, setIbansReveles] = useState({});
  const [ibanEnCours, setIbanEnCours]   = useState(null);

  // La valeur complète est demandée au serveur, une fiche à la fois, et
  // l'appel est consigné dans bo_logs.
  // « Je ne reçois pas les notifications » n'avait aucune réponse : rien ne
  // distinguait un abonnement absent, une clé manquante, un refus d'Apple ou un
  // téléphone mal réglé. Ce test rend le résultat de CHAQUE appareil.
  const [testPush, setTestPush] = useState({});
  const [testEnCours, setTestEnCours] = useState(null);
  const testerPush = async (id) => {
    setTestEnCours(id);
    try {
      const r = await fetch("/api/bo-action", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${sessionStorage.getItem("bo_token") || ""}` },
        body: JSON.stringify({ action: "test_push", profileId: id }),
      });
      const j = await r.json().catch(() => ({}));
      setTestPush(v => ({ ...v, [id]: r.ok ? j : { diagnostic: j.error || `Erreur ${r.status}`, appareils: [] } }));
    } catch (e) {
      setTestPush(v => ({ ...v, [id]: { diagnostic: e.message, appareils: [] } }));
    }
    setTestEnCours(null);
  };

  const revelerIban = async (id) => {
    setIbanEnCours(id);
    try {
      const r = await fetch("/api/bo-action", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${sessionStorage.getItem("bo_token") || ""}` },
        body: JSON.stringify({ action: "reveal_iban", profileId: id }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.rib) setIbansReveles(v => ({ ...v, [id]: j.rib }));
      else alert(j.error || "IBAN indisponible");
    } catch (e) {
      console.error("[reveal_iban] échec :", e.message);
      alert("Connexion impossible");
    }
    setIbanEnCours(null);
  };
  const [verifying, setVerifying] = useState(null);
  const [deleteModal, setDeleteModal] = useState(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [docs, setDocs]           = useState({});
  const [docsLoading, setDocsLoading] = useState({});
  const [docVerifying, setDocVerifying] = useState(null);
  const [validatingAll, setValidatingAll] = useState(null);
  const [previewDoc, setPreviewDoc] = useState(null);
  const [editMode, setEditMode]   = useState(null);
  const [editVals, setEditVals]   = useState({});
  const [editSaving, setEditSaving] = useState(false);
  const [editResult, setEditResult] = useState(null);
  const [contactModal, setContactModal] = useState(null);
  const [contactSubject, setContactSubject] = useState("");
  const [contactMessage, setContactMessage] = useState("");
  const [contactSending, setContactSending] = useState(false);
  const [contactResult, setContactResult] = useState(null);
  const [docModal, setDocModal] = useState(null); // { profileId, name }
  const [search, setSearch] = useState("");
  const [cashbackAdj, setCashbackAdj] = useState({});
  const [cashbackSaving, setCashbackSaving] = useState(null);
  const [planRepairSaving, setPlanRepairSaving] = useState(null);

  const handleVerify = async (p) => {
    setVerifying(p.id);
    try {
      const res = await fetch("/api/verify-docs", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        // Le SIRET d'un prestataire est dans `siret` ; `kbis` n'est renseigné que
        // pour les clients professionnels. La vérification partait donc à vide sur
        // tous les prestataires, alors que c'est là qu'elle compte le plus.
        body: JSON.stringify({ iban: ibansReveles[p.id] || "", siret: p.siret || p.kbis || "" }),
      });
      const data = await res.json();
      setVerifs(v => ({ ...v, [p.id]: data }));
    } catch(e) {
      setVerifs(v => ({ ...v, [p.id]: { error: "Erreur réseau" } }));
    }
    setVerifying(null);
  };

  const loadDocs = async (profileId) => {
    if (docs[profileId]) return;
    setDocsLoading(l => ({ ...l, [profileId]: true }));
    try {
      const r = await boFetch({ action:"list_docs", profileId });
      const data = await r.json();
      setDocs(d => ({ ...d, [profileId]: Array.isArray(data) ? data : [] }));
    } catch { setDocs(d => ({ ...d, [profileId]: [] })); }
    setDocsLoading(l => ({ ...l, [profileId]: false }));
  };

  const handleVerifyDoc = async (profileId, docId, docType) => {
    const validite = await demanderValidite(docType);
    if (!validite.ok) return;
    setDocVerifying(docId);
    // L'état n'est mis à jour que si le serveur a réellement validé : l'écran
    // affichait « vérifié » même quand l'appel échouait.
    try {
      const r = await boFetch({ action:"verify_doc", profileId, docId, expiresAt: validite.expiresAt });
      const j = await r.json().catch(() => ({}));
      if (r.ok) setDocs(d => ({ ...d, [profileId]: (d[profileId]||[]).map(doc => doc.id===docId ? { ...doc, verified:true } : doc) }));
      else showToast(j.error || `Erreur ${r.status}`, "error");
    } catch(e) { showToast(e?.message || "Erreur réseau", "error"); }
    setDocVerifying(null);
  };

  // Refus d'un document : le motif est obligatoire, il est envoyé au prestataire
  // dans la notification qui lui demande d'en redéposer un.
  const handleRejectDoc = async (profileId, docId, label) => {
    const motif = await showPrompt(`Motif du refus pour « ${label} » — il sera envoyé au prestataire :`);
    if (motif === null) return;
    if (!String(motif).trim()) { showToast("Motif obligatoire — refus annulé."); return; }
    setDocVerifying(docId);
    try {
      const r = await boFetch({ action:"reject_doc", profileId, docId, motif });
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        setDocs(d => ({ ...d, [profileId]: (d[profileId]||[]).filter(doc => doc.id !== docId) }));
        showToast("Document refusé — le prestataire est prévenu.", "success");
      } else {
        showToast(j.error || `Erreur ${r.status}`, "error");
      }
    } catch(e) { showToast(e?.message || "Erreur réseau", "error"); }
    setDocVerifying(null);
  };

  const handleVerifyAllDocs = async (profileId) => {
    const unverified = (docs[profileId]||[]).filter(d => !d.verified && !d.isVirtual);
    if (!unverified.length) return;

    // Valider en bloc revient à certifier des pièces qu'on n'a pas forcément
    // ouvertes — un Kbis hors sujet est déjà passé comme ça. La confirmation
    // nomme les documents concernés pour rendre l'acte conscient.
    const liste = unverified.map(d => `• ${DOC_LABELS[d.type] || d.type}`).join("\n");
    const ok = await showConfirm(
      `Vous allez valider ${unverified.length} document${unverified.length > 1 ? "s" : ""} :\n\n${liste}\n\n`
      + "Les avez-vous tous ouverts et contrôlés ? Valider un document revient à certifier "
      + "que vous l'avez vérifié.\n\nConfirmer la validation ?"
    );
    if (!ok) return;

    setValidatingAll(profileId);
    const valides = [];
    const echecs  = [];
    // Le motif renvoyé par le serveur était jeté : l'écran annonçait « Échec sur :
    // … Réessayez » sans jamais dire pourquoi, et réessayer ne servait à rien
    // puisque la cause était la même à chaque fois (règle 1.2).
    let motif = null;
    for (const doc of unverified) {
      try {
        const r = await boFetch({ action:"verify_doc", profileId, docId: doc.id });
        if (r.ok) { valides.push(doc.id); continue; }
        const j = await r.json().catch(() => ({}));
        echecs.push(DOC_LABELS[doc.type] || doc.type);
        if (!motif) motif = j.error || `erreur ${r.status}`;
      } catch (e) {
        echecs.push(DOC_LABELS[doc.type] || doc.type);
        if (!motif) motif = e?.message || "erreur réseau";
      }
    }
    // Seuls les documents réellement validés changent d'état : l'ancien code les
    // marquait tous vérifiés à l'écran, même en cas d'échec côté serveur.
    setDocs(d => ({ ...d, [profileId]: (d[profileId]||[]).map(doc => valides.includes(doc.id) ? { ...doc, verified:true } : doc) }));
    setValidatingAll(null);
    if (echecs.length) {
      console.error("[BO] validation en bloc — échecs :", echecs, "motif :", motif);
      showToast(`Échec sur ${echecs.length} document${echecs.length > 1 ? "s" : ""} — ${motif}`);
    }
  };

  useEffect(() => {
    if (!expanded) return;
    const p = profiles.find(x => x.id === expanded);
    if (p?.role === "prestataire" && !docs[expanded]) loadDocs(expanded);
  }, [expanded]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await boFetch({ action:"list" });
      const data = await res.json();
      setProfiles(Array.isArray(data) ? data : []);
    } catch(e) { setProfiles([]); }
    setLoading(false);
  };

  useEffect(()=>{ load(); },[]);

  const handleAction = async (profileId, action, reason) => {
    setActioning(profileId+action);
    try {
      const r = await boFetch({ action, profileId, reason });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) showToast(j.error || `Erreur ${r.status}`, "error");
      // Un versement encore dû disparaît avec le compte. C'est parfois voulu —
      // on ne paie pas un fraudeur — mais jamais quelque chose qu'on découvre
      // trois semaines plus tard dans les journaux.
      else if (j.versementsDus > 0) {
        showToast(`Compte supprimé. ⚠️ ${j.versementsDus.toFixed(2).replace(".", ",")} € de versement n'ont pas été émis — vérifiez si la somme est due.`, "error");
      }
    } catch(e) { showToast(e?.message || "Erreur réseau", "error"); }
    setActioning(null);
    load();
  };

  const handleContact = async () => {
    if (!contactSubject.trim() || !contactMessage.trim()) return;
    setContactSending(true);
    setContactResult(null);
    try {
      const res = await boFetch({ action:"send_user_email", profileId: contactModal.profileId, subject: contactSubject.trim(), message: contactMessage.trim() });
      const data = await res.json();
      setContactResult(data.success ? "ok" : "error");
      if (data.success) setTimeout(() => { setContactModal(null); setContactSubject(""); setContactMessage(""); setContactResult(null); }, 1500);
    } catch { setContactResult("error"); }
    setContactSending(false);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteModal) return;
    await handleAction(deleteModal.profileId, "delete", deleteReason.trim());
    setDeleteModal(null);
    setDeleteReason("");
  };

  const startEdit = (p) => {
    setEditVals({
      prenom: p.prenom || "",
      nom: p.nom || "",
      telephone: p.telephone || "",
      rib: p.rib || "",
      type_compte: p.type_compte || "",
      societe_nom: p.societe_nom || "",
      kbis: p.kbis || "",
      ae_siret: p.ae_siret || "",
      secteur: p.secteur || "",
      metier: p.metier || "",
      tarif_net: p.tarif_net != null ? String(p.tarif_net) : "",
      bio: p.bio || "",
      rue: p.rue || p.adresse || "",
      cp: p.cp || p.code_postal || "",
      ville: p.ville || "",
      frequence_besoins: p.frequence_besoins || "",
      volume_horaire: p.volume_horaire != null ? String(p.volume_horaire) : "",
      plan_abonnement: p.plan_abonnement || "free",
      subscription_end_date: p.subscription_end_date ? p.subscription_end_date.slice(0, 10) : "",
    });
    setEditMode(p.id);
    setEditResult(null);
  };

  const saveEdit = async (profileId) => {
    setEditSaving(true);
    setEditResult(null);
    try {
      const r = await boFetch({ action: "update_profile", profileId, ...editVals });
      const j = await r.json();
      if (j.success) {
        setEditResult("ok");
        setEditMode(null);
        load();
      } else {
        setEditResult("error");
      }
    } catch { setEditResult("error"); }
    setEditSaving(false);
  };

  const FI = ({ label, value, field, type = "text", options = null }) => (
    <div style={{ marginBottom: 10 }}>
      <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 10, fontWeight: 600, marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      {options ? (
        <select value={editVals[field] || ""} onChange={e => setEditVals(v => ({ ...v, [field]: e.target.value }))}
          style={{ width: "100%", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, padding: "8px 10px", color: "#fff", fontSize: 12, fontFamily: "inherit" }}>
          {options.map(([val, lbl]) => <option key={val} value={val}>{lbl}</option>)}
        </select>
      ) : type === "textarea" ? (
        <textarea value={editVals[field] || ""} onChange={e => setEditVals(v => ({ ...v, [field]: e.target.value }))} rows={3}
          style={{ width: "100%", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, padding: "8px 10px", color: "#fff", fontSize: 12, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }} />
      ) : (
        <input type={type} value={editVals[field] || ""} onChange={e => setEditVals(v => ({ ...v, [field]: e.target.value }))} placeholder={type==="date" ? "AAAA-MM-JJ" : type==="time" ? "HH:MM" : undefined}
          style={{ width: "100%", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, padding: "8px 10px", color: "#fff", fontSize: 12, fontFamily: "inherit", boxSizing: "border-box" }} />
      )}
    </div>
  );

  const InfoRow = ({ icon, label, value, mono }) => value ? (
    <div style={{ marginBottom: 7 }}>
      <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 11 }}>{icon} {label} : </span>
      <span style={{ color: C.white, fontSize: 12, fontWeight: 600, fontFamily: mono ? "monospace" : "inherit", wordBreak: "break-word" }}>{value}</span>
    </div>
  ) : null;

  const statusColor = { pending:"#FCD34D", approved:C.success, rejected:"#F25E5E" };
  const statusLabel = { pending:"En attente", approved:"Approuvé", rejected:"Refusé" };
  const searchLow = search.toLowerCase().trim();
  const filtered = profiles.filter(p => {
    if (filter !== "all" && p.status !== filter) return false;
    if (roleFilter !== "all" && p.role !== roleFilter) return false;
    if (searchLow) {
      const hay = [p.email, p.prenom, p.nom, p.telephone, p.societe_nom].filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(searchLow)) return false;
    }
    return true;
  });

  return (
    <div style={{ padding:"16px 18px" }}>
      <h3 style={{ color:C.white, fontSize:15, fontWeight:800, margin:"0 0 14px" }}>Validation des comptes</h3>

      <input type="text" placeholder="🔍 Rechercher par email, prénom, nom, téléphone…" value={search} onChange={e=>setSearch(e.target.value)}
        style={{ width:"100%", padding:"9px 12px", borderRadius:10, border:`1px solid ${C.border}`, background:"rgba(255,255,255,0.05)", color:C.text, fontSize:13, fontFamily:"inherit", marginBottom:12, boxSizing:"border-box", outline:"none" }} />

      {/* Filtre statut */}
      <div style={{ display:"flex", gap:6, marginBottom:10, flexWrap:"wrap" }}>
        {[["pending","⏳ En attente"],["approved","✅ Approuvés"],["rejected","❌ Refusés"],["all","Tous"]].map(([val,label])=>(
          <button key={val} onClick={()=>setFilter(val)} style={{ padding:"6px 12px", borderRadius:20, border:`1px solid ${filter===val?C.violet:"rgba(255,255,255,0.15)"}`, background:filter===val?`${C.violet}33`:"transparent", color:filter===val?C.violet:"rgba(255,255,255,0.5)", fontSize:11, fontWeight:filter===val?700:400, cursor:"pointer", fontFamily:"inherit" }}>{label}</button>
        ))}
      </div>

      {/* Filtre rôle */}
      <div style={{ display:"flex", gap:6, marginBottom:16 }}>
        {[["all","👥 Tous"],["client","🏢 Clients"],["prestataire","👷 Prestataires"]].map(([val,label])=>(
          <button key={val} onClick={()=>setRoleFilter(val)} style={{ padding:"6px 12px", borderRadius:20, border:`1px solid ${roleFilter===val?"#FCD34D":"rgba(255,255,255,0.1)"}`, background:roleFilter===val?"rgba(252,211,77,0.12)":"transparent", color:roleFilter===val?"#FCD34D":"rgba(255,255,255,0.4)", fontSize:11, fontWeight:roleFilter===val?700:400, cursor:"pointer", fontFamily:"inherit" }}>{label}</button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign:"center", color:"rgba(255,255,255,0.6)", padding:"32px 0", fontSize:13 }}>Chargement…</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign:"center", color:"rgba(255,255,255,0.6)", padding:"32px 0", fontSize:13 }}>Aucun compte dans cette catégorie</div>
      ) : filtered.map(p => (
        <div key={p.id} style={{ background:"#0D1B3E", border:`1px solid rgba(255,255,255,0.07)`, borderRadius:14, padding:"14px 16px", marginBottom:10 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ color:C.white, fontWeight:700, fontSize:14 }}>
                {p.prenom||p.nom ? `${p.prenom||""} ${p.nom||""}`.trim() : "Nom non renseigné"}
              </div>
              <div style={{ color:"rgba(255,255,255,0.6)", fontSize:11, marginTop:2 }}>
                {p.email || "Email non disponible"}
              </div>
              <div style={{ color:"rgba(255,255,255,0.6)", fontSize:10, marginTop:2 }}>
                {p.role==="prestataire"?"👷 Prestataire":"🏢 Client"} · {new Date(p.created_at).toLocaleDateString("fr-FR")}
              </div>
              {p.role==="prestataire" && docs[p.id] && (() => {
                const total = docs[p.id].length;
                const ok = docs[p.id].filter(d=>d.verified).length;
                return total > 0 ? (
                  <div style={{ marginTop:4, display:"flex", alignItems:"center", gap:6 }}>
                    <div style={{ height:4, flex:1, maxWidth:80, background:"rgba(255,255,255,0.1)", borderRadius:4, overflow:"hidden" }}>
                      <div style={{ height:"100%", width:`${(ok/total)*100}%`, background: ok===total ? C.success : C.accentGold, borderRadius:4, transition:"width 0.3s" }} />
                    </div>
                    <span style={{ fontSize:10, color: ok===total ? C.success : C.accentGold, fontWeight:700 }}>{ok}/{total} docs</span>
                  </div>
                ) : null;
              })()}
            </div>
            <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:6 }}>
              <div style={{ background:`${statusColor[p.status]||"#888"}22`, border:`1px solid ${statusColor[p.status]||"#888"}55`, borderRadius:8, padding:"3px 10px", color:statusColor[p.status]||"#888", fontSize:11, fontWeight:700 }}>
                {statusLabel[p.status]||p.status}
              </div>
              {p.blacklisted && (
                <div style={{ background:"rgba(242,94,94,0.18)", border:"1px solid rgba(242,94,94,0.6)", borderRadius:8, padding:"3px 10px", color:"#F25E5E", fontSize:10, fontWeight:700 }}>
                  ⚠️ Compte recréé
                </div>
              )}
              {p.trial_exhausted && (
                <div style={{ background:"rgba(242,94,94,0.15)", border:"1px solid rgba(242,94,94,0.4)", borderRadius:8, padding:"3px 10px", color:"#F25E5E", fontSize:10, fontWeight:700 }}>
                  🔒 Quota épuisé
                </div>
              )}
              <button onClick={()=>setExpanded(expanded===p.id?null:p.id)} style={{ fontSize:10, color:"rgba(255,255,255,0.6)", background:"none", border:"none", cursor:"pointer", fontFamily:"inherit" }}>
                {expanded===p.id?"▲ Masquer":"▼ Détails"}
              </button>
            </div>
          </div>

          {/* Détails étendus */}
          {expanded===p.id && (
            <div style={{ background:"rgba(255,255,255,0.03)", borderRadius:10, padding:"14px", marginBottom:10 }}>

              {/* ── Header section avec bouton modifier ── */}
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12, paddingBottom:10, borderBottom:"1px solid rgba(255,255,255,0.07)" }}>
                <span style={{ color:"rgba(255,255,255,0.6)", fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:0.5 }}>📋 Informations complètes</span>
                {editMode === p.id ? (
                  <div style={{ display:"flex", gap:8 }}>
                    <button onClick={()=>{ setEditMode(null); setEditResult(null); }} style={{ padding:"5px 12px", borderRadius:8, border:"1px solid rgba(255,255,255,0.2)", background:"transparent", color:"rgba(255,255,255,0.6)", fontSize:11, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>Annuler</button>
                    <button onClick={()=>saveEdit(p.id)} disabled={editSaving} style={{ padding:"5px 14px", borderRadius:8, border:"none", background:C.violet, color:"#fff", fontSize:11, fontWeight:700, cursor:"pointer", fontFamily:"inherit", opacity:editSaving?0.6:1 }}>
                      {editSaving ? "Sauvegarde…" : "💾 Sauvegarder"}
                    </button>
                  </div>
                ) : (
                  <button onClick={()=>startEdit(p)} style={{ padding:"5px 12px", borderRadius:8, border:`1px solid ${C.violet}44`, background:"transparent", color:C.violet, fontSize:11, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>✏️ Modifier</button>
                )}
              </div>
              {editResult === "ok" && <div style={{ fontSize:12, color:C.success, fontWeight:600, marginBottom:8 }}>✅ Modifications sauvegardées</div>}
              {editResult === "error" && <div style={{ fontSize:12, color:"#F25E5E", fontWeight:600, marginBottom:8 }}>❌ Erreur lors de la sauvegarde</div>}

              {editMode === p.id ? (
                /* ── MODE ÉDITION ── */
                <div>
                  <div style={{ color:"rgba(255,255,255,0.6)", fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:0.5, marginBottom:8 }}>Identité</div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:12 }}>
                    <FI label="Prénom" field="prenom" />
                    <FI label="Nom" field="nom" />
                  </div>

                  <div style={{ color:"rgba(255,255,255,0.6)", fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:0.5, marginBottom:8 }}>Contact & paiement</div>
                  <div style={{ marginBottom:12 }}>
                    <FI label="Téléphone" field="telephone" />
                    <FI label="IBAN / RIB" field="rib" />
                  </div>

                  <div style={{ color:"rgba(255,255,255,0.6)", fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:0.5, marginBottom:8 }}>Profil légal</div>
                  <div style={{ marginBottom:12 }}>
                    <FI label="Type de compte" field="type_compte" options={[["","— Non renseigné —"],["particulier","Particulier"],["professionnel","Professionnel"]]} />
                    <FI label="Nom de la société" field="societe_nom" />
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                      <FI label="KBIS / SIRET" field="kbis" />
                      <FI label="SIRET auto-entrepreneur" field="ae_siret" />
                    </div>
                  </div>

                  {p.role === "prestataire" && <>
                    <div style={{ color:"rgba(255,255,255,0.6)", fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:0.5, marginBottom:8 }}>Activité professionnelle</div>
                    <div style={{ marginBottom:12 }}>
                      <FI label="Secteur" field="secteur" options={[["","— Non renseigné —"],["logistique","Logistique"],["btp","BTP"],["restauration","Restauration"],["proprete","Propreté"],["commercial","Commercial"],["hotellerie","Hôtellerie"],["distribution","Distribution"],["divers","Divers"]]} />
                      <FI label="Métier / Poste" field="metier" />
                      <FI label="Tarif net (€/h)" field="tarif_net" type="number" />
                      <FI label="Bio / Présentation" field="bio" type="textarea" />
                    </div>
                  </>}

                  {p.role === "client" && <>
                    <div style={{ color:"rgba(255,255,255,0.6)", fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:0.5, marginBottom:8 }}>Besoins</div>
                    <div style={{ marginBottom:12 }}>
                      <FI label="Fréquence des besoins" field="frequence_besoins" options={[["","— Non renseigné —"],["occasionnel","Occasionnel"],["regulier","Régulier"],["permanent","Permanent"]]} />
                      <FI label="Volume horaire (h/mois)" field="volume_horaire" type="number" />
                    </div>
                  </>}

                  <div style={{ color:"rgba(255,255,255,0.6)", fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:0.5, marginBottom:8 }}>Adresse</div>
                  <div style={{ marginBottom:12 }}>
                    <FI label="Rue / Adresse" field="rue" />
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                      <FI label="Code postal" field="cp" />
                      <FI label="Ville" field="ville" />
                    </div>
                  </div>

                  <div style={{ color:"rgba(255,255,255,0.6)", fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:0.5, marginBottom:8 }}>Abonnement</div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:4 }}>
                    <FI label="Plan" field="plan_abonnement" options={[["free","Gratuit"],["premium","Premium"],["elite","Elite"]]} />
                    <FI label="Date de fin" field="subscription_end_date" type="date" />
                  </div>
                </div>
              ) : (
                /* ── MODE LECTURE ── */
                <div style={{ fontSize:12 }}>
                  <div>
                    <InfoRow icon="📧" label="Email" value={p.email} />
                    <InfoRow icon="📱" label="Tél" value={p.telephone} />
                    {/* L'IBAN n'arrive plus dans la liste : il se demande une
                        fiche à la fois, et la demande est tracée (RGPD art. 5.1.c). */}
                    <InfoRow icon="🏦" label="IBAN" mono value={
                      ibansReveles[p.id]
                        ? ibansReveles[p.id]
                        : p.rib_present
                          ? <span>
                              •••• {p.rib_fin}
                              <button onClick={()=>revelerIban(p.id)} disabled={ibanEnCours === p.id}
                                style={{ marginLeft:8, padding:"2px 8px", borderRadius:6, border:`1px solid ${C.violet}66`, background:"transparent", color:C.violet, fontSize:10, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
                                {ibanEnCours === p.id ? "…" : "Afficher"}
                              </button>
                            </span>
                          : null
                    } />
                    <div style={{ padding:"8px 0", borderBottom:`1px solid ${C.border}` }}>
                      <button onClick={()=>testerPush(p.id)} disabled={testEnCours === p.id}
                        style={{ padding:"6px 12px", borderRadius:8, border:`1px solid ${C.violet}66`, background:"transparent", color:C.violet, fontSize:11, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
                        {testEnCours === p.id ? "Envoi…" : "🔔 Tester les notifications"}
                      </button>
                      {testPush[p.id] && (
                        <div style={{ marginTop:8, fontSize:11, color:C.textSub, lineHeight:1.6 }}>
                          {(testPush[p.id].appareils || []).map((a, i) => (
                            <div key={i} style={{ color: a.statut === 201 || a.statut === 200 ? C.success : C.danger }}>
                              {a.service} — {a.lecture}
                            </div>
                          ))}
                          <div style={{ marginTop:4, color:C.textMuted }}>{testPush[p.id].diagnostic}</div>
                        </div>
                      )}
                    </div>
                    <InfoRow icon="👤" label="Type" value={p.type_compte === "professionnel" ? "Professionnel" : p.type_compte === "particulier" ? "Particulier" : p.type_compte} />
                    <InfoRow icon="🏢" label="Société" value={p.societe_nom} />
                    <InfoRow icon="📄" label="KBIS/SIRET" value={p.kbis} />
                    <InfoRow icon="🪪" label="AE SIRET" value={p.ae_siret || p.siret} />
                    {p.role === "prestataire" && p.date_naissance && (
                      <InfoRow icon="🎂" label="Naissance" value={(() => {
                        const dob = new Date(p.date_naissance);
                        const today = new Date();
                        const age = today.getFullYear() - dob.getFullYear() - (today < new Date(today.getFullYear(), dob.getMonth(), dob.getDate()) ? 1 : 0);
                        return `${dob.toLocaleDateString("fr-FR")} (${age} ans)`;
                      })()} />
                    )}
                    {p.role === "prestataire" && <>
                      <InfoRow icon="🗂️" label="Secteur" value={p.secteur} />
                      <InfoRow icon="💼" label="Métier" value={p.metier} />
                      <InfoRow icon="💶" label="Tarif net" value={p.tarif_net ? `${p.tarif_net} €/h` : null} />
                      <InfoRow icon="📍" label="Adresse" value={[p.rue || p.adresse, p.cp || p.code_postal, p.ville].filter(Boolean).join(", ") || null} />
                      <InfoRow icon="🌐" label="Langues" value={Array.isArray(p.langues) ? p.langues.join(", ") : p.langues} />
                      <InfoRow icon="🎯" label="Rayon" value={p.zone_km ? `${p.zone_km} km` : null} />
                      <InfoRow icon="📊" label="Niveau" value={[p.niveau, p.experience_ans ? `${p.experience_ans} an${p.experience_ans > 1 ? "s" : ""} d'expérience` : null].filter(Boolean).join(" · ") || null} />
                      <InfoRow icon="🏷️" label="Statut" value={p.statut_pro} />
                      <InfoRow icon="📅" label="Disponibilités" value={(() => {
                        const jours = Array.isArray(p.dispon_jours) ? p.dispon_jours.join(", ") : null;
                        return [jours, p.dispo_immediat ? "disponible immédiatement" : null].filter(Boolean).join(" · ") || null;
                      })()} />
                      <InfoRow icon="🧰" label="Autres métiers" value={(() => {
                        if (!Array.isArray(p.metiers_list) || p.metiers_list.length <= 1) return null;
                        return p.metiers_list.map(m => m?.metier || m).filter(Boolean).join(", ");
                      })()} />
                      <InfoRow icon="⭐" label="Compétences" value={Array.isArray(p.competences) ? p.competences.join(", ") : p.competences} />
                      <InfoRow icon="📝" label="Bio" value={p.bio} />
                    </>}
                    {p.role === "client" && <>
                      <InfoRow icon="📍" label="Adresse" value={[p.adresse || p.rue, p.code_postal || p.cp, p.ville].filter(Boolean).join(", ") || null} />
                      <InfoRow icon="🔄" label="Fréquence" value={p.frequence_besoins} />
                      <InfoRow icon="⏱️" label="Volume" value={p.volume_horaire ? `${p.volume_horaire}h/mois` : null} />
                    </>}
                    <InfoRow icon="💳" label="Plan" value={p.plan_abonnement || "free"} />
                    <InfoRow icon="📅" label="Fin abonnement" value={p.subscription_end_date ? new Date(p.subscription_end_date).toLocaleDateString("fr-FR") : null} />
                  </div>
                  {p.role === "prestataire" && (
                    <div style={{ marginTop:10, background:"rgba(240,180,41,0.06)", border:"1px solid rgba(240,180,41,0.25)", borderRadius:10, padding:"10px 12px" }}>
                      <div style={{ color:"#F0B429", fontWeight:700, fontSize:12, marginBottom:8 }}>🔧 Forcer le plan (profiles + user_metadata)</div>
                      <div style={{ display:"flex", gap:6 }}>
                        {[["free","Gratuit","#8B8FA8"],["premium","Premium","#7C6FE0"],["elite","Élite","#F0B429"]].map(([plan,label,color])=>(
                          <button key={plan} disabled={planRepairSaving===p.id} onClick={async()=>{
                            setPlanRepairSaving(p.id);
                            const r = await boFetch({ action:"repair_plan", profileId:p.id, plan });
                            const result = await r.json().catch(()=>null);
                            await load();
                            setPlanRepairSaving(null);
                            if (r.ok && result?.success) {
                              showToast(`Plan "${plan}" appliqué ✓ — profiles + user_metadata mis à jour`);
                            } else {
                              showToast(`Erreur repair_plan: ${result?.error||"inconnu"} — ${result?.detail||""}`);
                            }
                          }} style={{ flex:1, padding:"7px 4px", borderRadius:8, border:`1.5px solid ${color}55`, background:`${color}18`, color, fontWeight:700, fontSize:11, cursor:"pointer", fontFamily:"inherit", opacity:planRepairSaving===p.id?0.5:1 }}>
                            {planRepairSaving===p.id?"…":label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {p.role === "client" && (
                    <div style={{ marginTop:10, background:"rgba(16,217,143,0.06)", border:"1px solid rgba(16,217,143,0.2)", borderRadius:10, padding:"10px 12px" }}>
                      <div style={{ color:C.success, fontWeight:700, fontSize:12, marginBottom:8 }}>💰 Cashback client</div>
                      <div style={{ color:C.textSub, fontSize:12, marginBottom:8 }}>Solde actuel : <strong style={{ color:C.success }}>{(p.cashback_balance||0).toFixed(2)} €</strong></div>
                      <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap" }}>
                        <input type="text" inputMode="decimal" placeholder="Montant (ex: 5 ou -2)" value={cashbackAdj[p.id]?.delta||""} onChange={e=>setCashbackAdj(a=>({...a,[p.id]:{...a[p.id],delta:e.target.value}}))
                        } style={{ width:120, padding:"6px 10px", borderRadius:8, border:`1px solid ${C.border}`, background:"rgba(255,255,255,0.05)", color:C.text, fontSize:12, fontFamily:"inherit" }} />
                        <input type="text" placeholder="Motif (optionnel)" value={cashbackAdj[p.id]?.reason||""} onChange={e=>setCashbackAdj(a=>({...a,[p.id]:{...a[p.id],reason:e.target.value}}))} style={{ flex:1, minWidth:100, padding:"6px 10px", borderRadius:8, border:`1px solid ${C.border}`, background:"rgba(255,255,255,0.05)", color:C.text, fontSize:12, fontFamily:"inherit" }} />
                        <button disabled={cashbackSaving===p.id||!cashbackAdj[p.id]?.delta} onClick={async()=>{
                          const delta = parseFloat(String(cashbackAdj[p.id]?.delta||"").replace(",","."));
                          if (isNaN(delta)) return;
                          setCashbackSaving(p.id);
                          const res = await boFetch({ action:"adjust_cashback", profileId:p.id, delta, reason:cashbackAdj[p.id]?.reason||"" });
                          const j = await res.json();
                          if (j.ok) setCashbackAdj(a=>({...a,[p.id]:{delta:"",reason:""}}));
                          setCashbackSaving(null);
                        }} style={{ padding:"6px 12px", borderRadius:8, border:"none", background:C.success, color:"#fff", fontWeight:700, fontSize:11, cursor:"pointer", fontFamily:"inherit", opacity:cashbackSaving===p.id?0.5:1 }}>
                          {cashbackSaving===p.id?"…":"Appliquer"}
                        </button>
                      </div>
                    </div>
                  )}
                  {p.role === "prestataire" && p.bio && (
                    <div style={{ marginTop:8, padding:"8px 10px", background:"rgba(255,255,255,0.04)", borderRadius:8 }}>
                      <div style={{ color:"rgba(255,255,255,0.6)", fontSize:10, fontWeight:600, marginBottom:4 }}>BIO</div>
                      <div style={{ color:"rgba(255,255,255,0.7)", lineHeight:1.6 }}>{p.bio}</div>
                    </div>
                  )}
                  {p.role === "prestataire" && Array.isArray(p.competences) && p.competences.length > 0 && (
                    <div style={{ marginTop:8 }}>
                      <div style={{ color:"rgba(255,255,255,0.6)", fontSize:10, fontWeight:600, marginBottom:4 }}>COMPÉTENCES</div>
                      <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
                        {p.competences.map((c, i) => (
                          <span key={i} style={{ background:"rgba(124,111,224,0.15)", border:"1px solid rgba(124,111,224,0.3)", borderRadius:6, padding:"2px 8px", color:C.violet, fontSize:10, fontWeight:600 }}>{c}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {p.role === "client" && Array.isArray(p.secteurs_besoins) && p.secteurs_besoins.length > 0 && (
                    <div style={{ marginTop:8 }}>
                      <div style={{ color:"rgba(255,255,255,0.6)", fontSize:10, fontWeight:600, marginBottom:4 }}>SECTEURS RECHERCHÉS</div>
                      <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
                        {p.secteurs_besoins.map((s, i) => (
                          <span key={i} style={{ background:"rgba(240,180,41,0.12)", border:"1px solid rgba(240,180,41,0.3)", borderRadius:6, padding:"2px 8px", color:"#F0B429", fontSize:10, fontWeight:600 }}>{s}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {p.role === "client" && Array.isArray(p.metiers_besoins) && p.metiers_besoins.length > 0 && (
                    <div style={{ marginTop:8 }}>
                      <div style={{ color:"rgba(255,255,255,0.6)", fontSize:10, fontWeight:600, marginBottom:4 }}>MÉTIERS RECHERCHÉS</div>
                      <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
                        {p.metiers_besoins.map((m, i) => (
                          <span key={i} style={{ background:"rgba(124,111,224,0.12)", border:"1px solid rgba(124,111,224,0.3)", borderRadius:6, padding:"2px 8px", color:C.violet, fontSize:10, fontWeight:600 }}>{m}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {p.role === "client" && Array.isArray(p.lieux_intervention) && p.lieux_intervention.length > 0 && (
                    <div style={{ marginTop:8 }}>
                      <div style={{ color:"rgba(255,255,255,0.6)", fontSize:10, fontWeight:600, marginBottom:4 }}>LIEUX D'INTERVENTION</div>
                      {p.lieux_intervention.map((l, i) => (
                        <div key={i} style={{ color:"rgba(255,255,255,0.7)", fontSize:11, marginBottom:2 }}>
                          📍 {[l.adresse, l.codePostal, l.ville].filter(Boolean).join(", ")}
                        </div>
                      ))}
                    </div>
                  )}
                  {!p.telephone && !p.rib && !p.societe_nom && !p.kbis && !p.secteur && !p.adresse && !p.frequence_besoins && (
                    <div style={{ color:"rgba(255,255,255,0.6)" }}>Aucune donnée supplémentaire</div>
                  )}
                </div>
              )}

              {/* ── Documents uploadés (prestataires uniquement) ── */}
              {p.role === "prestataire" && (
                <div style={{ marginTop:12, paddingTop:10, borderTop:"1px solid rgba(255,255,255,0.07)" }}>
                  {/* En-tête section docs */}
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
                    <span style={{ color:"rgba(255,255,255,0.6)", fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:0.5 }}>
                      📂 Documents
                      {docs[p.id] && ` (${docs[p.id].filter(d=>d.verified).length}/${docs[p.id].length} validés)`}
                    </span>
                    <div style={{ display:"flex", gap:6 }}>
                      {docsLoading[p.id] && <span style={{ fontSize:10, color:"rgba(255,255,255,0.6)" }}>Chargement…</span>}
                      {/* La photo de profil vient de user_metadata, pas de la table
                          `documents` : elle n'est pas validable. Sans l'exclure ici, le
                          bouton s'affichait alors qu'il n'y avait rien à valider, et un
                          clic ne produisait rien du tout. */}
                      {docs[p.id] && docs[p.id].some(d=>!d.verified && !d.isVirtual) && (
                        <button onClick={()=>handleVerifyAllDocs(p.id)} disabled={validatingAll===p.id} style={{ fontSize:10, color:C.success, fontWeight:700, background:`${C.success}15`, border:`1px solid ${C.success}44`, borderRadius:6, padding:"4px 10px", cursor:"pointer", fontFamily:"inherit", opacity:validatingAll===p.id?0.5:1 }}>
                          {validatingAll===p.id ? "Validation…" : "✓ Tout valider"}
                        </button>
                      )}
                      {docs[p.id] && <button onClick={()=>{ setDocs(d=>({...d,[p.id]:undefined})); loadDocs(p.id); }} style={{ fontSize:10, color:"rgba(255,255,255,0.6)", background:"none", border:"none", cursor:"pointer", fontFamily:"inherit" }}>🔄</button>}
                    </div>
                  </div>

                  {/* Checklist docs requis */}
                  {docs[p.id] && (() => {
                    const REQ = p.role === "client" && p.type_compte === "entreprise"
                      ? [
                          { type:"kbis",    label:"KBIS / Sirene",    icon:"🏢" },
                          { type:"rib",     label:"RIB entreprise",   icon:"🏦" },
                          { type:"cni",     label:"CNI du gérant",    icon:"🪪" },
                          { type:"tva",     label:"Attestation TVA",  icon:"📋" },
                        ]
                      : [
                          { type:"photo",   label:"Photo de profil",      icon:"📸" },
                          { type:"cni",     label:"Pièce d'identité",     icon:"🪪" },
                          { type:"kbis",    label:"KBIS / SIRET",         icon:"🏢" },
                          { type:"urssaf",  label:"Attestation URSSAF",   icon:"🏛️" },
                          { type:"rib",     label:"RIB / IBAN",           icon:"💳" },
                          { type:"domicile",label:"Justificatif domicile",icon:"🏠" },
                          { type:"rc_pro",  label:"RC Professionnelle",   icon:"🛡️" },
                        ];
                    const uploaded = docs[p.id].map(d=>d.type);
                    const missing = REQ.filter(r => !uploaded.includes(r.type));
                    if (!missing.length) return null;
                    return (
                      <div style={{ background:"rgba(240,180,41,0.06)", border:"1px solid rgba(240,180,41,0.2)", borderRadius:8, padding:"8px 12px", marginBottom:10 }}>
                        <div style={{ color:C.accentGold, fontSize:10, fontWeight:700, marginBottom:6 }}>⚠️ Documents manquants</div>
                        <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                          {missing.map(r => (
                            <span key={r.type} style={{ fontSize:10, color:"rgba(255,255,255,0.6)", background:"rgba(255,255,255,0.05)", borderRadius:6, padding:"2px 8px" }}>{r.icon} {r.label}</span>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                  {docs[p.id] && docs[p.id].length === 0 && <div style={{ fontSize:11, color:"rgba(255,255,255,0.6)", marginBottom:8 }}>Aucun document uploadé</div>}
                  {docs[p.id] && docs[p.id].map(doc => {
                    const DOC_ICON = DOC_ICONS;
                    const DOC_LABEL = DOC_LABELS;
                    const isImg = doc.signedUrl && /\.(png|jpe?g|gif|webp)(\?|$)/i.test(doc.signedUrl);
                    // Sur un écran de téléphone, le libellé était comprimé au point de se
                    // couper au milieu d'un mot (« RC » / « Pro ») juste à côté des
                    // boutons, rendant la ligne illisible. La ligne peut désormais passer
                    // à la ligne : les boutons descendent sous le libellé plutôt que de
                    // l'écraser, et le libellé s'abrège proprement.
                    return (
                      <div key={doc.id} onClick={doc.signedUrl ? ()=>setPreviewDoc({ url:doc.signedUrl, isImg, label:DOC_LABEL[doc.type]||doc.type, icon:DOC_ICON[doc.type]||"📄" }) : undefined} style={{ display:"flex", alignItems:"center", flexWrap:"wrap", rowGap:6, gap:8, padding:"8px 10px", background:"rgba(255,255,255,0.04)", borderRadius:8, marginBottom:5, border:`1px solid ${doc.verified?"rgba(34,197,94,0.2)":"rgba(255,255,255,0.06)"}`, cursor:doc.signedUrl?"pointer":"default" }}>
                        <span style={{ fontSize:16, flexShrink:0 }}>{DOC_ICON[doc.type]||"📄"}</span>
                        <div style={{ flex:"1 1 130px", minWidth:0 }}>
                          <div style={{ fontSize:11, color:"rgba(255,255,255,0.85)", fontWeight:600, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{DOC_LABEL[doc.type]||doc.type}</div>
                          <div style={{ fontSize:10, color: doc.verified ? C.success : C.accentGold, fontWeight:700, marginTop:1 }}>{doc.verified ? "✓ Vérifié" : "⏳ En attente"}</div>
                        </div>
                        <div onClick={e=>e.stopPropagation()} style={{ display:"flex", gap:5, flexShrink:0, marginLeft:"auto" }}>
                          {doc.signedUrl && (
                            <a href={doc.signedUrl} download target="_blank" rel="noopener noreferrer" style={{ fontSize:10, color:"rgba(255,255,255,0.6)", fontWeight:700, background:"rgba(255,255,255,0.07)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:6, padding:"4px 8px", cursor:"pointer", textDecoration:"none", display:"inline-block" }}>⬇</a>
                          )}
                          {!doc.verified && !doc.isVirtual && (
                            <button onClick={()=>handleVerifyDoc(p.id, doc.id, doc.type)} disabled={docVerifying===doc.id||validatingAll===p.id} style={{ fontSize:10, color:C.success, fontWeight:700, background:`${C.success}15`, border:`1px solid ${C.success}44`, borderRadius:6, padding:"4px 10px", cursor:"pointer", fontFamily:"inherit", opacity:(docVerifying===doc.id||validatingAll===p.id)?0.5:1 }}>
                              {docVerifying===doc.id ? "…" : "✓"}
                            </button>
                          )}
                          {!doc.isVirtual && (
                            <button title="Refuser ce document" onClick={()=>handleRejectDoc(p.id, doc.id, DOC_LABEL[doc.type]||doc.type)} disabled={docVerifying===doc.id||validatingAll===p.id} style={{ fontSize:10, color:C.danger, fontWeight:700, background:`${C.danger}15`, border:`1px solid ${C.danger}44`, borderRadius:6, padding:"4px 10px", cursor:"pointer", fontFamily:"inherit", opacity:(docVerifying===doc.id||validatingAll===p.id)?0.5:1 }}>
                              ✕
                            </button>
                          )}
                          {doc.verified && <span style={{ fontSize:14 }}>✅</span>}
                        </div>
                      </div>
                    );
                  })}
                  {/* Bouton valider l'accès aux prestations */}
                  <div style={{ marginTop:10, paddingTop:10, borderTop:"1px solid rgba(255,255,255,0.07)" }}>
                    {p.missions_enabled === true ? (
                      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                        <div style={{ padding:"9px 14px", borderRadius:10, background:`${C.success}15`, border:`1px solid ${C.success}44`, color:C.success, fontWeight:700, fontSize:12, display:"inline-block" }}>✅ Prestations activées</div>
                        <button onClick={()=>handleAction(p.id,"disable_missions")} disabled={!!actioning} style={{ padding:"7px 14px", borderRadius:10, border:`1px solid rgba(240,80,80,0.4)`, background:"rgba(240,80,80,0.1)", color:"#F25E5E", fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit", opacity:actioning?0.5:1 }}>
                          {actioning===p.id+"disable_missions" ? "…" : "🚫 Désactiver"}
                        </button>
                      </div>
                    ) : (
                      <button onClick={()=>handleAction(p.id,"enable_missions")} disabled={!!actioning} style={{ padding:"9px 18px", borderRadius:10, border:"none", background:C.success, color:"#fff", fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit", opacity:actioning?0.5:1 }}>
                        {actioning===p.id+"enable_missions" ? "…" : "✅ Activer l'accès aux prestations"}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* ── Vérification IBAN/SIRET ── */}
              {(p.rib || p.kbis) && (
                <div style={{ marginTop:10, paddingTop:10, borderTop:"1px solid rgba(255,255,255,0.07)" }}>
                  <button onClick={()=>handleVerify(p)} disabled={verifying===p.id} style={{ padding:"7px 14px", borderRadius:10, border:"1px solid rgba(124,111,224,0.4)", background:"rgba(124,111,224,0.1)", color:C.violet, fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit", opacity:verifying===p.id?0.6:1 }}>
                    {verifying===p.id ? "Vérification…" : "🔍 Vérifier IBAN / SIRET"}
                  </button>
                  {verifs[p.id] && (
                    <div style={{ marginTop:10, fontSize:12, lineHeight:1.8 }}>
                      {verifs[p.id].iban && (
                        <div style={{ marginBottom:4 }}>
                          <span style={{ color:verifs[p.id].iban.valid ? C.success : "#F25E5E", fontWeight:700 }}>
                            {verifs[p.id].iban.valid ? "✅" : "❌"} IBAN
                          </span>
                          {!verifs[p.id].iban.valid && <span style={{ color:"#F25E5E", marginLeft:6 }}>{verifs[p.id].iban.error}</span>}
                          {verifs[p.id].iban.valid && <span style={{ color:C.success, marginLeft:6 }}>Valide</span>}
                        </div>
                      )}
                      {verifs[p.id].siret && (
                        <div>
                          <span style={{ color:verifs[p.id].siret.valid && verifs[p.id].siret.exists !== false ? C.success : "#F25E5E", fontWeight:700 }}>
                            {verifs[p.id].siret.valid && verifs[p.id].siret.exists !== false ? "✅" : "❌"} SIRET
                          </span>
                          {verifs[p.id].siret.error && <span style={{ color:"#F25E5E", marginLeft:6 }}>{verifs[p.id].siret.error}</span>}
                          {verifs[p.id].siret.nom && <span style={{ color:C.success, marginLeft:6 }}>{verifs[p.id].siret.nom}</span>}
                          {verifs[p.id].siret.statut && <span style={{ color:verifs[p.id].siret.actif ? C.success : "#F25E5E", marginLeft:6 }}>— {verifs[p.id].siret.statut}</span>}
                          {verifs[p.id].siret.siege && <span style={{ color:"rgba(255,255,255,0.6)", marginLeft:6 }}>({verifs[p.id].siret.siege})</span>}
                          {verifs[p.id].siret.apiError && <span style={{ color:"rgba(255,255,255,0.6)", marginLeft:6 }}>{verifs[p.id].siret.apiError}</span>}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
            {p.status==="pending" && <>
              <button onClick={()=>handleAction(p.id,"approve")} disabled={!!actioning} style={{ flex:1, padding:"9px", borderRadius:10, border:"none", background:`${C.success}22`, color:C.success, fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit", opacity:actioning?0.5:1 }}>
                {actioning===p.id+"approve" ? "…" : "✅ Approuver"}
              </button>
              <button onClick={()=>handleAction(p.id,"reject")} disabled={!!actioning} style={{ flex:1, padding:"9px", borderRadius:10, border:"none", background:"rgba(242,94,94,0.12)", color:"#F25E5E", fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit", opacity:actioning?0.5:1 }}>
                {actioning===p.id+"reject" ? "…" : "❌ Refuser"}
              </button>
            </>}
            {p.status==="approved" && (<>
              <button onClick={async()=>{ const reason=await showPrompt("Motif de la suspension — OBLIGATOIRE, il est communiqué à l'intéressé qui doit pouvoir le contester (CGPS art. 16.2) :","Motif..."); if(reason===null) return; setActioning(p.id+"suspend"); await boFetch({ action:"suspend", profileId:p.id, reason:reason||"" }); setProfiles(ps=>ps.map(x=>x.id===p.id?{...x,status:"suspended"}:x)); setActioning(null); }} disabled={!!actioning} style={{ padding:"9px 14px", borderRadius:10, border:"1px solid rgba(255,165,0,0.3)", background:"rgba(255,165,0,0.08)", color:"#FFA500", fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit", opacity:actioning?0.5:1, whiteSpace:"nowrap" }}>
                {actioning===p.id+"suspend"?"…":"🔒 Suspendre"}
              </button>
              <button onClick={async()=>{
                // Résiliation à trente jours : le préavis du règlement P2B. Pour
                // écarter quelqu'un tout de suite, c'est la suspension qui sert.
                const motif=await showPrompt("Motif de la résiliation — OBLIGATOIRE, notifié à l'intéressé qui peut le contester. Le compte reste actif pendant 30 jours (CGPS art. 16.2) :","Motif...");
                if(motif===null) return;
                setActioning(p.id+"resil");
                const r=await boFetch({ action:"programmer_resiliation", profileId:p.id, reason:motif||"" });
                const j=await r.json().catch(()=>({}));
                if(r.ok) showToast(`Résiliation programmée au ${new Date(j.effet).toLocaleDateString("fr-FR")} — l'intéressé est notifié.`, "success");
                else showToast(j.error || `Erreur ${r.status}`, "error");
                setActioning(null);
              }} disabled={!!actioning} style={{ padding:"9px 14px", borderRadius:10, border:"1px solid rgba(230,126,34,0.3)", background:"rgba(230,126,34,0.08)", color:"#E67E22", fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit", opacity:actioning?0.5:1, whiteSpace:"nowrap" }}>
                ⏳ Résilier à 30j
              </button></>
            )}
            {p.role==="prestataire" && p.trial_exhausted && (
              <button onClick={async()=>{ if(!await showConfirm(`Réinitialiser le quota prestations de ${p.prenom||p.email} ? (trial_exhausted → false, compteur → 0)`)) return; setActioning(p.id+"reset_trial"); await boFetch({ action:"reset_trial", profileId:p.id }); setProfiles(ps=>ps.map(x=>x.id===p.id?{...x,trial_exhausted:false,missions_completed_month:0}:x)); setActioning(null); }} disabled={!!actioning} style={{ padding:"9px 14px", borderRadius:10, border:"1px solid rgba(16,217,143,0.35)", background:"rgba(16,217,143,0.08)", color:"#10D98F", fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit", opacity:actioning?0.5:1, whiteSpace:"nowrap" }}>
                {actioning===p.id+"reset_trial"?"…":"🔓 Débloquer quota"}
              </button>
            )}
            {p.status==="suspended" && (
              <button onClick={async()=>{ if(!await showConfirm("Réactiver ce compte ?")) return; setActioning(p.id+"unsuspend"); await boFetch({ action:"unsuspend", profileId:p.id }); setProfiles(ps=>ps.map(x=>x.id===p.id?{...x,status:"approved"}:x)); setActioning(null); }} disabled={!!actioning} style={{ padding:"9px 14px", borderRadius:10, border:`1px solid ${C.success}44`, background:`${C.success}12`, color:C.success, fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit", opacity:actioning?0.5:1, whiteSpace:"nowrap" }}>
                {actioning===p.id+"unsuspend"?"…":"🔓 Réactiver"}
              </button>
            )}
            <button onClick={()=>{ setDocModal({ profileId:p.id, name:`${p.prenom||""} ${p.nom||""}`.trim()||p.email }); if(!docs[p.id]) loadDocs(p.id); }} disabled={!!actioning} style={{ padding:"9px 14px", borderRadius:10, border:`1px solid rgba(255,255,255,0.15)`, background:"rgba(255,255,255,0.06)", color:"rgba(255,255,255,0.7)", fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit", opacity:actioning?0.5:1 }}>
              📂
            </button>
            <button onClick={()=>{ setContactSubject(""); setContactMessage(""); setContactResult(null); setContactModal({ profileId:p.id, name:`${p.prenom||""} ${p.nom||""}`.trim()||p.email, email:p.email }); }} disabled={!!actioning} style={{ padding:"9px 14px", borderRadius:10, border:`1px solid ${C.violet}44`, background:`${C.violet}15`, color:C.violet, fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit", opacity:actioning?0.5:1 }}>
              📧
            </button>
            <button onClick={()=>{ setDeleteReason(""); setDeleteModal({ profileId:p.id, name:`${p.prenom||""} ${p.nom||""}`.trim()||p.email, email:p.email }); }} disabled={!!actioning} style={{ padding:"9px 14px", borderRadius:10, border:"1px solid rgba(242,94,94,0.3)", background:"transparent", color:"rgba(242,94,94,0.7)", fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit", opacity:actioning?0.5:1 }}>
              {actioning===p.id+"delete" ? "…" : "🗑️"}
            </button>
          </div>
        </div>
      ))}

      {/* ── Modal prévisualisation document ── */}
      {previewDoc && (
        <div onClick={()=>setPreviewDoc(null)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.85)", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", zIndex:2000, padding:16 }}>
          <div onClick={e=>e.stopPropagation()} style={{ background:"#0D1B3E", borderRadius:16, width:"100%", maxWidth:700, maxHeight:"90vh", display:"flex", flexDirection:"column", overflow:"hidden", border:"1px solid rgba(255,255,255,0.1)" }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"14px 18px", borderBottom:"1px solid rgba(255,255,255,0.08)" }}>
              <div style={{ fontWeight:700, color:"#fff", fontSize:14 }}>{previewDoc.icon} {previewDoc.label}</div>
              <div style={{ display:"flex", gap:8 }}>
                {previewDoc.url && <a href={previewDoc.url} target="_blank" rel="noopener noreferrer" style={{ fontSize:11, color:C.violet, fontWeight:700, textDecoration:"none", padding:"5px 12px", border:`1px solid ${C.violet}44`, borderRadius:8 }}>↗ Ouvrir</a>}
                <button onClick={()=>setPreviewDoc(null)} style={{ background:"rgba(255,255,255,0.08)", border:"none", color:"#fff", borderRadius:8, padding:"5px 12px", cursor:"pointer", fontSize:13, fontFamily:"inherit", fontWeight:700 }}>✕</button>
              </div>
            </div>
            <div style={{ flex:1, overflow:"auto", padding:8, minHeight:300, display:"flex", alignItems:"center", justifyContent:"center" }}>
              {previewDoc.isDemo ? (
                <DemoDocPreview type={previewDoc.docType} />
              ) : previewDoc.isImg ? (
                <img src={previewDoc.url} alt={previewDoc.label} style={{ maxWidth:"100%", maxHeight:"75vh", display:"block", margin:"0 auto", borderRadius:8 }} />
              ) : (
                <div style={{ textAlign:"center", padding:40 }}>
                  <div style={{ fontSize:48, marginBottom:16 }}>📄</div>
                  <div style={{ color:"rgba(255,255,255,0.7)", fontSize:14, marginBottom:24 }}>Prévisualisation non disponible dans le navigateur</div>
                  <div style={{ display:"flex", gap:10, justifyContent:"center", flexWrap:"wrap" }}>
                    <a href={previewDoc.url} target="_blank" rel="noopener noreferrer" style={{ display:"inline-block", padding:"10px 20px", background:`${C.violet}22`, border:`1px solid ${C.violet}55`, color:C.violet, borderRadius:10, fontWeight:700, fontSize:13, textDecoration:"none" }}>↗ Ouvrir dans un nouvel onglet</a>
                    <a href={previewDoc.url} download style={{ display:"inline-block", padding:"10px 20px", background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.15)", color:"#fff", borderRadius:10, fontWeight:700, fontSize:13, textDecoration:"none" }}>⬇ Télécharger</a>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {docModal && (() => {
        const DOC_ICON = DOC_ICONS;
        const DOC_LABEL = DOC_LABELS;
        const p = profiles.find(x=>x.id===docModal.profileId)||{};
        const REQ = p.role === "client" && p.type_compte === "entreprise"
          ? [
              { type:"kbis",    label:"KBIS / Sirene",   icon:"🏢" },
              { type:"rib",     label:"RIB entreprise",  icon:"🏦" },
              { type:"cni",     label:"CNI du gérant",   icon:"🪪" },
              { type:"tva",     label:"Attestation TVA", icon:"📋" },
            ]
          : p.role === "client"
            ? [] // client particulier — pas de docs requis
            : [
                { type:"photo",    label:"Photo de profil",      icon:"📸" },
                { type:"cni",      label:"Pièce d'identité",     icon:"🪪" },
                { type:"kbis",     label:"KBIS / SIRET",         icon:"🏢" },
                { type:"urssaf",   label:"Attestation URSSAF",   icon:"🏛️" },
                { type:"rib",      label:"RIB / IBAN",           icon:"💳" },
                { type:"domicile", label:"Justif. domicile",     icon:"🏠" },
                { type:"rc_pro",   label:"RC Professionnelle",   icon:"🛡️" },
              ];
        const userDocs = docs[docModal.profileId];
        const isLoading = docsLoading[docModal.profileId];
        return (
          <div onClick={()=>setDocModal(null)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.82)", display:"flex", alignItems:"flex-end", justifyContent:"center", zIndex:1500, padding:"0" }}>
            <div onClick={e=>e.stopPropagation()} style={{ background:"#0D1B3E", borderRadius:"20px 20px 0 0", width:"100%", maxWidth:600, maxHeight:"88vh", display:"flex", flexDirection:"column", border:"1px solid rgba(255,255,255,0.1)", borderBottom:"none" }}>
              {/* Header */}
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"16px 18px", borderBottom:"1px solid rgba(255,255,255,0.08)", flexShrink:0 }}>
                <div>
                  <div style={{ fontWeight:800, color:"#fff", fontSize:15 }}>📂 Documents</div>
                  <div style={{ color:"rgba(255,255,255,0.6)", fontSize:12, marginTop:2 }}>{docModal.name}</div>
                </div>
                <div style={{ display:"flex", gap:8 }}>
                  <button onClick={async()=>{
                    if(!await showConfirm("Insérer 7 documents de démo (validés) pour ce profil ?")) return;
                    const r = await boFetch({ action:"seed_docs", profileId:docModal.profileId });
                    const j = await r.json();
                    if(j.ok){ setDocs(d=>({...d,[docModal.profileId]:undefined})); loadDocs(docModal.profileId); showToast("7 documents de démo insérés ✅"); }
                    else showToast("Erreur : " + (j.error||"?"), "error");
                  }} style={{ background:"rgba(124,111,224,0.15)", border:"1px solid rgba(124,111,224,0.3)", color:"rgba(124,111,224,0.9)", borderRadius:8, padding:"6px 10px", cursor:"pointer", fontSize:11, fontFamily:"inherit", fontWeight:700 }}>🌱 Seed démo</button>
                  <button onClick={()=>{ setDocs(d=>({...d,[docModal.profileId]:undefined})); loadDocs(docModal.profileId); }} style={{ background:"rgba(255,255,255,0.07)", border:"none", color:"rgba(255,255,255,0.6)", borderRadius:8, padding:"6px 10px", cursor:"pointer", fontSize:13, fontFamily:"inherit" }}>🔄</button>
                  <button onClick={()=>setDocModal(null)} style={{ background:"rgba(255,255,255,0.08)", border:"none", color:"#fff", borderRadius:8, padding:"6px 12px", cursor:"pointer", fontSize:14, fontFamily:"inherit", fontWeight:700 }}>✕</button>
                </div>
              </div>
              {/* Content */}
              <div style={{ flex:1, overflowY:"auto", padding:"16px 18px" }}>
                {isLoading && <div style={{ textAlign:"center", color:"rgba(255,255,255,0.6)", padding:"32px 0" }}>Chargement…</div>}
                {!isLoading && !userDocs && <div style={{ textAlign:"center", color:"rgba(255,255,255,0.6)", padding:"32px 0" }}>Aucun document</div>}
                {!isLoading && userDocs && (() => {
                  const uploaded = userDocs.map(d=>d.type);
                  const missing = REQ.filter(r=>!uploaded.includes(r.type));
                  return (
                    <>
                      {missing.length > 0 && (
                        <div style={{ background:"rgba(240,180,41,0.07)", border:"1px solid rgba(240,180,41,0.22)", borderRadius:10, padding:"10px 14px", marginBottom:14 }}>
                          <div style={{ color:"#F0B429", fontSize:11, fontWeight:700, marginBottom:6 }}>⚠️ Documents manquants ({missing.length})</div>
                          <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                            {missing.map(r=>(
                              <span key={r.type} style={{ fontSize:11, color:"rgba(255,255,255,0.6)", background:"rgba(255,255,255,0.05)", borderRadius:6, padding:"3px 9px" }}>{r.icon} {r.label}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {userDocs.length === 0 && (
                        <div style={{ textAlign:"center", color:"rgba(255,255,255,0.6)", padding:"16px 0", fontSize:13 }}>Aucun document uploadé</div>
                      )}
                      {userDocs.length > 0 && (
                        <div style={{ marginBottom:8 }}>
                          <div style={{ color:"rgba(255,255,255,0.6)", fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:0.5, marginBottom:10 }}>
                            Documents uploadés ({userDocs.filter(d=>d.verified).length}/{userDocs.length} validés)
                          </div>
                          {userDocs.map(doc => {
                            const isDemo = doc.storage_path?.startsWith("demo/");
                            const isImg = doc.signedUrl && (/\.(png|jpe?g|gif|webp)(\?|$)/i.test(doc.signedUrl) || doc.signedUrl.startsWith("data:image"));
                            const handleClick = doc.signedUrl
                              ? ()=>setPreviewDoc({ url:doc.signedUrl, isImg, label:DOC_LABEL[doc.type]||doc.type, icon:DOC_ICON[doc.type]||"📄" })
                              : isDemo
                                ? ()=>setPreviewDoc({ url:null, isImg:false, isDemo:true, docType:doc.type, label:DOC_LABEL[doc.type]||doc.type, icon:DOC_ICON[doc.type]||"📄" })
                                : undefined;
                            return (
                              <div key={doc.id} onClick={handleClick} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 12px", background:"rgba(255,255,255,0.04)", borderRadius:10, marginBottom:8, border:`1px solid ${doc.verified?"rgba(34,197,94,0.25)":"rgba(255,255,255,0.07)"}`, cursor:handleClick?"pointer":"default" }}>
                                <span style={{ fontSize:20 }}>{DOC_ICON[doc.type]||"📄"}</span>
                                <div style={{ flex:1, minWidth:0 }}>
                                  <div style={{ fontSize:13, color:"rgba(255,255,255,0.9)", fontWeight:600 }}>{DOC_LABEL[doc.type]||doc.type}</div>
                                  <div style={{ fontSize:11, color:doc.verified?C.success:"#F0B429", fontWeight:700, marginTop:2 }}>{doc.verified?"✓ Vérifié":"⏳ En attente"}{(doc.signedUrl||isDemo)?" · Appuyer pour voir":""}</div>
                                </div>
                                <div onClick={e=>e.stopPropagation()} style={{ display:"flex", gap:6 }}>
                                  {doc.signedUrl && !doc.isVirtual && (
                                    <a href={doc.signedUrl} download target="_blank" rel="noopener noreferrer" style={{ fontSize:11, color:"rgba(255,255,255,0.6)", fontWeight:700, background:"rgba(255,255,255,0.07)", border:"1px solid rgba(255,255,255,0.12)", borderRadius:7, padding:"5px 11px", cursor:"pointer", textDecoration:"none", display:"inline-block" }}>⬇</a>
                                  )}
                                  {!doc.verified && !doc.isVirtual && (
                                    <button onClick={()=>handleVerifyDoc(docModal.profileId, doc.id, doc.type)} disabled={docVerifying===doc.id||validatingAll===docModal.profileId} style={{ fontSize:11, color:C.success, fontWeight:700, background:`${C.success}15`, border:`1px solid ${C.success}44`, borderRadius:7, padding:"5px 11px", cursor:"pointer", fontFamily:"inherit", opacity:(docVerifying===doc.id)?0.5:1 }}>
                                      {docVerifying===doc.id ? "…" : "✓"}
                                    </button>
                                  )}
                                  {doc.verified && <span style={{ fontSize:16 }}>✅</span>}
                                </div>
                              </div>
                            );
                          })}
                          {userDocs.some(d=>!d.verified && !d.isVirtual) && (
                            <button onClick={()=>handleVerifyAllDocs(docModal.profileId)} disabled={validatingAll===docModal.profileId} style={{ width:"100%", marginTop:4, padding:"10px", borderRadius:10, border:`1px solid ${C.success}44`, background:`${C.success}15`, color:C.success, fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit", opacity:validatingAll===docModal.profileId?0.5:1 }}>
                              {validatingAll===docModal.profileId ? "Validation en cours…" : "✓ Tout valider"}
                            </button>
                          )}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
          </div>
        );
      })()}

      {contactModal && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000, padding:20 }}>
          <div style={{ background:"#0D1B3E", borderRadius:16, padding:24, width:"100%", maxWidth:440, border:`1px solid ${C.violet}44` }}>
            <h3 style={{ color:C.text, fontSize:15, fontWeight:800, margin:"0 0 4px" }}>📧 Contacter</h3>
            <p style={{ color:"rgba(255,255,255,0.6)", fontSize:12, margin:"0 0 16px" }}>
              À : <strong style={{ color:"rgba(255,255,255,0.8)" }}>{contactModal.name}</strong> · {contactModal.email}
            </p>
            <label style={{ color:"rgba(255,255,255,0.6)", fontSize:12, fontWeight:600, display:"block", marginBottom:6 }}>SUJET *</label>
            <input
              value={contactSubject}
              onChange={e=>setContactSubject(e.target.value)}
              placeholder="Ex : Votre inscription ALANE, Demande de documents..."
              style={{ width:"100%", background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.15)", borderRadius:10, padding:"10px 12px", color:"#fff", fontSize:13, fontFamily:"inherit", boxSizing:"border-box", marginBottom:12 }}
            />
            <label style={{ color:"rgba(255,255,255,0.6)", fontSize:12, fontWeight:600, display:"block", marginBottom:6 }}>MESSAGE *</label>
            <textarea
              value={contactMessage}
              onChange={e=>setContactMessage(e.target.value)}
              placeholder="Écrivez votre message ici…"
              style={{ width:"100%", minHeight:120, background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.15)", borderRadius:10, padding:"10px 12px", color:"#fff", fontSize:13, fontFamily:"inherit", resize:"vertical", boxSizing:"border-box" }}
            />
            {contactResult === "error" && <div style={{ color:"#F25E5E", fontSize:12, marginTop:8 }}>❌ Erreur lors de l'envoi. Réessayez.</div>}
            {contactResult === "ok"    && <div style={{ color:C.success, fontSize:12, marginTop:8 }}>✅ Email envoyé !</div>}
            <div style={{ display:"flex", gap:10, marginTop:14 }}>
              <button onClick={()=>setContactModal(null)} style={{ flex:1, padding:"10px", borderRadius:10, border:"1px solid rgba(255,255,255,0.15)", background:"transparent", color:"rgba(255,255,255,0.6)", fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>Annuler</button>
              <button onClick={handleContact} disabled={contactSending||!contactSubject.trim()||!contactMessage.trim()} style={{ flex:2, padding:"10px", borderRadius:10, border:"none", background:C.violet, color:"#fff", fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit", opacity:(contactSending||!contactSubject.trim()||!contactMessage.trim())?0.5:1 }}>
                {contactSending ? "Envoi…" : "Envoyer →"}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteModal && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000, padding:20 }}>
          <div style={{ background:"#0D1B3E", borderRadius:16, padding:24, width:"100%", maxWidth:400, border:"1px solid rgba(242,94,94,0.3)" }}>
            <h3 style={{ color:"#F25E5E", fontSize:15, fontWeight:800, margin:"0 0 8px" }}>Supprimer le compte</h3>
            <p style={{ color:"rgba(255,255,255,0.7)", fontSize:13, margin:"0 0 16px" }}>
              Vous allez supprimer définitivement le compte de <strong style={{ color:"#fff" }}>{deleteModal.name}</strong>. Un email sera envoyé à cette personne.
            </p>
            <label style={{ color:"rgba(255,255,255,0.6)", fontSize:12, fontWeight:600, display:"block", marginBottom:6 }}>RAISON (optionnelle)</label>
            <textarea
              value={deleteReason}
              onChange={e=>setDeleteReason(e.target.value)}
              placeholder="Ex : documents non conformes, comportement inapproprié..."
              style={{ width:"100%", minHeight:80, background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.15)", borderRadius:10, padding:"10px 12px", color:"#fff", fontSize:13, fontFamily:"inherit", resize:"vertical", boxSizing:"border-box" }}
            />
            <div style={{ display:"flex", gap:10, marginTop:16 }}>
              <button onClick={()=>setDeleteModal(null)} style={{ flex:1, padding:"10px", borderRadius:10, border:"1px solid rgba(255,255,255,0.15)", background:"transparent", color:"rgba(255,255,255,0.6)", fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>Annuler</button>
              <button onClick={handleDeleteConfirm} disabled={!!actioning} style={{ flex:1, padding:"10px", borderRadius:10, border:"none", background:"#F25E5E", color:"#fff", fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit", opacity:actioning?0.5:1 }}>
                {actioning ? "…" : "Supprimer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function BOSupport() {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState("open");
  const [actioning, setActioning] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await boFetch({ action:"list_tickets" });
      const data = await res.json();
      setTickets(Array.isArray(data) ? data : []);
    } catch { setTickets([]); }
    setLoading(false);
  };

  useEffect(()=>{ load(); },[]);

  const closeTicket = async (id) => {
    setActioning(id);
    await boFetch({ action:"close_ticket", profileId:id });
    setActioning(null);
    load();
  };

  const deleteTicket = async (id) => {
    setActioning(id + "_del");
    await boFetch({ action:"delete_ticket", profileId:id });
    setActioning(null);
    load();
  };

  const filtered = tickets.filter(t => filter==="all" || t.status===filter);

  return (
    <div style={{ padding:"16px 18px" }}>
      <h3 style={{ color:C.white, fontSize:15, fontWeight:800, margin:"0 0 14px" }}>Tickets support</h3>
      <div style={{ display:"flex", gap:6, marginBottom:16 }}>
        {[["open","🔴 Ouverts"],["closed","✅ Fermés"],["all","Tous"]].map(([val,label])=>(
          <button key={val} onClick={()=>setFilter(val)} style={{ padding:"6px 12px", borderRadius:20, border:`1px solid ${filter===val?C.violet:"rgba(255,255,255,0.15)"}`, background:filter===val?`${C.violet}33`:"transparent", color:filter===val?C.violet:"rgba(255,255,255,0.5)", fontSize:11, fontWeight:filter===val?700:400, cursor:"pointer", fontFamily:"inherit" }}>{label}</button>
        ))}
      </div>
      {loading ? (
        <div style={{ textAlign:"center", color:"rgba(255,255,255,0.6)", padding:"32px 0", fontSize:13 }}>Chargement…</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign:"center", color:"rgba(255,255,255,0.6)", padding:"32px 0", fontSize:13 }}>Aucun ticket</div>
      ) : filtered.map(t => (
        <div key={t.id} style={{ background:"#0D1B3E", border:`1px solid rgba(255,255,255,0.07)`, borderRadius:14, padding:"14px 16px", marginBottom:10 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:8 }}>
            <div>
              <div style={{ color:C.white, fontWeight:700, fontSize:13 }}>{t.subject}</div>
              <div style={{ color:"rgba(255,255,255,0.6)", fontSize:11, marginTop:2 }}>{t.user_name||"Anonyme"} · {t.user_email||""}</div>
              <div style={{ color:"rgba(255,255,255,0.6)", fontSize:10, marginTop:2 }}>{new Date(t.created_at).toLocaleString("fr-FR")}</div>
            </div>
            <div style={{ background:t.status==="open"?"rgba(242,94,94,0.15)":"rgba(34,197,94,0.1)", border:`1px solid ${t.status==="open"?"rgba(242,94,94,0.4)":"rgba(34,197,94,0.3)"}`, borderRadius:8, padding:"3px 10px", color:t.status==="open"?"#F25E5E":C.success, fontSize:10, fontWeight:700 }}>
              {t.status==="open"?"Ouvert":"Fermé"}
            </div>
          </div>
          <div style={{ color:"rgba(255,255,255,0.6)", fontSize:12, lineHeight:1.6, marginBottom:t.status==="open"?10:0, background:"rgba(255,255,255,0.03)", borderRadius:8, padding:"10px" }}>
            {t.message}
          </div>
          <div style={{ display:"flex", gap:8, marginTop:2 }}>
            {t.status==="open" && (
              <button onClick={()=>closeTicket(t.id)} disabled={!!actioning} style={{ padding:"8px 16px", borderRadius:10, border:"none", background:`${C.success}22`, color:C.success, fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit", opacity:actioning===t.id?0.5:1 }}>
                {actioning===t.id?"…":"✅ Marquer résolu"}
              </button>
            )}
            <button onClick={()=>deleteTicket(t.id)} disabled={!!actioning} style={{ padding:"8px 14px", borderRadius:10, border:"1px solid rgba(242,94,94,0.3)", background:"rgba(242,94,94,0.08)", color:"#F25E5E", fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit", opacity:actioning===t.id+"_del"?0.5:1 }}>
              {actioning===t.id+"_del"?"…":"🗑 Supprimer"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// Écran des versements — CGPS art. 7.4 (retenue) et 8B.3 (compensation).
//
// Il n'existait rien : le versement au prestataire était devenu un traitement
// automatique toutes les deux heures, sans aucune fenêtre pour voir ce qui
// passe, ce qui bloque, ni ce qui traîne. Un traitement qu'on ne regarde pas
// est un traitement dont on apprend la panne par le prestataire qui réclame.
const MOTIFS_RETENUE = [
  { id:"reclamation_client",  l:"Réclamation du client" },
  { id:"opposition_bancaire", l:"Opposition bancaire / rétrofacturation" },
  { id:"suspicion_fraude",    l:"Indices sérieux de fraude" },
  { id:"creance_alane",       l:"Créance ALANE (art. 8B.3)" },
  { id:"demande_autorite",    l:"Demande d'une autorité" },
];
const LIBELLE_MOTIF = Object.fromEntries(MOTIFS_RETENUE.map(m => [m.id, m.l]));

const ETAT_VERSEMENT = {
  pending:    { l:"En attente",  c:"#F39C12" },
  processing: { l:"En cours",    c:"#3498DB" },
  held:       { l:"Retenu",      c:"#E67E22" },
  failed:     { l:"Échoué",      c:"#E74C3C" },
};

export function BOVersements() {
  const [data, setData] = useState({ versements:[], creances:[], sansVersement:[], noms:{}, enRetard:0 });
  const [programme, setProgramme] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [filtre, setFiltre] = useState("tous");
  const [dac7EnCours, setDac7EnCours] = useState(false);

  // Export DAC7 de l'année écoulée. La déclaration porte sur l'année N-1 et se
  // dépose en janvier : c'est donc l'année précédente qu'on exporte par défaut.
  const exporterDac7 = async () => {
    const annee = new Date().getFullYear() - 1;
    setDac7EnCours(true);
    try {
      const r = await boFetch({ action:"export_dac7", annee });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { showToast(d.error || `Erreur ${r.status}`, "error"); setDac7EnCours(false); return; }
      if (!d.lignes?.length) { showToast(`Aucun versement en ${annee}.`); setDac7EnCours(false); return; }

      const champ = (v) => {
        const t = String(v ?? "");
        return /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
      };
      const cols = ["prestataire_id","nom","raison_sociale","email","adresse","siret","nif",
                    "residence_fiscale","iban","nombre_operations","montant_brut","retenues","donnees_manquantes"];
      const csv = "\uFEFF" + [
        cols.join(";"),
        ...d.lignes.map(l => cols.map(c => champ(l[c])).join(";")),
      ].join("\r\n");

      const url = URL.createObjectURL(new Blob([csv], { type:"text/csv;charset=utf-8;" }));
      const a = document.createElement("a");
      a.href = url; a.download = `alane-dac7-${annee}.csv`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // Le nombre de dossiers incomplets est l'information utile : c'est lui qui
      // dit s'il reste du travail avant de pouvoir déclarer.
      showToast(d.incomplets > 0
        ? `${d.lignes.length} prestataire(s) exporté(s) — ⚠️ ${d.incomplets} dossier(s) incomplet(s), colonne « donnees_manquantes ».`
        : `${d.lignes.length} prestataire(s) exporté(s), tous les dossiers sont complets.`,
        d.incomplets > 0 ? "error" : "success");
    } catch (e) { showToast(e?.message || "Erreur réseau", "error"); }
    setDac7EnCours(false);
  };

  const load = async () => {
    setLoading(true);
    try {
      const r = await boFetch({ action:"list_versements" });
      const d = await r.json();
      if (r.ok) setData({ versements:d.versements||[], creances:d.creances||[], sansVersement:d.sansVersement||[], noms:d.noms||{}, enRetard:d.enRetard||0 });
      // Une liste vide et une lecture impossible se ressemblent à l'écran : on
      // le dit, sinon l'administrateur conclut qu'il n'y a rien à traiter.
      else showToast(d.error || `Versements illisibles (${r.status})`, "error");
    } catch (e) { showToast(`Versements illisibles : ${e.message}`, "error"); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  // Le témoin de vie du traitement automatique. Il répond à la seule question
  // qui compte quand un virement traîne : l'horloge bat-elle encore ?
  const [dernierPassage, setDernierPassage] = useState(undefined);
  const [relance, setRelance] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const r = await boFetch({ action: "get_settings" });
        const d = await r.json();
        setDernierPassage(d?.cron_dernier_passage?.at || null);
      } catch (e) {
        console.error("[BO] témoin du traitement automatique illisible :", e.message);
        setDernierPassage(null);
      }
    })();
  }, []);

  const nom = (id) => data.noms[id] || (id ? `${id.slice(0,8)}…` : "—");
  const euro = (v) => `${Number(v||0).toFixed(2).replace(".", ",")} €`;
  const jour = (d) => d ? new Date(d).toLocaleDateString("fr-FR", { day:"numeric", month:"short", year:"numeric" }) : "—";

  const retenir = async (m) => {
    const choix = await showPrompt(
      `Retenir le versement de ${euro(m.payout_amount)} à ${nom(m.prestataire_id)} ?\n\n`
      + `Motif (obligatoire, il est notifié au prestataire par e-mail) :\n`
      + MOTIFS_RETENUE.map((x,i) => `${i+1}. ${x.l}`).join("\n")
      + `\n\nTapez le numéro :`
    );
    if (!choix) return;
    const motif = MOTIFS_RETENUE[Number(String(choix).trim()) - 1]?.id;
    if (!motif) return showToast("Motif non reconnu — retenue annulée.", "error");
    setBusyId(m.id);
    try {
      const r = await boFetch({ action:"retenir_versement", mission_id:m.id, motif });
      const d = await r.json();
      if (d.success) { showToast("Versement retenu — le prestataire a été notifié.", "success"); load(); }
      else showToast(d.error || "Retenue impossible", "error");
    } catch (e) { showToast(e.message || "Erreur réseau", "error"); }
    setBusyId(null);
  };

  const lever = async (m) => {
    if (!await showConfirm(`Lever la retenue sur le versement de ${euro(m.payout_amount)} à ${nom(m.prestataire_id)} ?`)) return;
    setBusyId(m.id);
    try {
      const r = await boFetch({ action:"lever_retenue", mission_id:m.id });
      const d = await r.json();
      if (d.success) { showToast("Retenue levée — le virement repartira au prochain traitement.", "success"); load(); }
      else showToast(d.error || "Levée impossible", "error");
    } catch (e) { showToast(e.message || "Erreur réseau", "error"); }
    setBusyId(null);
  };

  const creerCreance = async (m) => {
    const montant = await showPrompt(`Somme due par ${nom(m.prestataire_id)}, en euros (art. 8B.3) :`);
    if (!montant) return;
    const motif = await showPrompt("Motif — il est communiqué au prestataire par écrit (10 caractères minimum) :");
    if (!motif) return;
    setBusyId(m.id);
    try {
      const r = await boFetch({ action:"creer_creance", prestataire_id:m.prestataire_id,
                                montant:Number(String(montant).replace(",", ".")), motif, mission_id:m.id });
      const d = await r.json();
      if (d.success) { showToast("Créance enregistrée et notifiée. Elle sera retenue sur les versements à venir, moitié maximum.", "success"); load(); }
      else showToast(d.error || "Créance non enregistrée", "error");
    } catch (e) { showToast(e.message || "Erreur réseau", "error"); }
    setBusyId(null);
  };

  const statuer = async (c, decision, question) => {
    if (!await showConfirm(question)) return;
    setBusyId(c.id);
    try {
      const r = await boFetch({ action:"statuer_creance", creance_id:c.id, decision });
      const d = await r.json();
      if (d.success) { showToast("Créance mise à jour ✅", "success"); load(); }
      else showToast(d.error || "Mise à jour impossible", "error");
    } catch (e) { showToast(e.message || "Erreur réseau", "error"); }
    setBusyId(null);
  };

  const listee = data.versements.filter(v => filtre === "tous" || v.payout_status === filtre);
  const total  = listee.reduce((t,v) => t + Number(v.payout_amount||0), 0);

  if (loading) return <div style={{ color:C.gray, padding:20 }}>Chargement…</div>;

  return (
    <>
      <SectionHeader title="Versements aux prestataires" />
      {/* Export DAC7 — il ne déclare rien, il prépare la déclaration et rend
          visible ce qui manque. Une déclaration incomplète se répare ; une
          déclaration qu'on découvre incomplète le 31 janvier, non. */}
      <button onClick={exporterDac7} disabled={dac7EnCours} style={{
        width:"100%", marginBottom:12, padding:"11px", borderRadius:10,
        border:`1px solid ${C.violet}55`, background:`${C.violet}12`, color:C.violet,
        fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit", opacity:dac7EnCours?0.6:1,
      }}>
        {dac7EnCours ? "…" : `📑 Export fiscal DAC7 ${new Date().getFullYear() - 1} (CSV)`}
      </button>
      <div style={{ color:C.gray, fontSize:12, marginTop:-8, marginBottom:14 }}>Retenue (CGPS art. 7.4) et sommes dues (art. 8B.3)</div>

      {/* Prestations clôturées sans versement programmé.
          Elles n'apparaissaient nulle part : la liste des versements filtre sur
          `payout_status`, et celui de ces prestations est NULL. Le prestataire
          attendait donc un virement que rien n'émettrait. */}
      {data.sansVersement.length > 0 && (
        <Card style={{ borderLeft:"3px solid #E74C3C", marginBottom:14 }}>
          <div style={{ color:"#E74C3C", fontWeight:800, fontSize:14 }}>
            ⚠️ {data.sansVersement.length} prestation{data.sansVersement.length>1?"s":""} clôturée{data.sansVersement.length>1?"s":""} sans versement programmé
          </div>
          <div style={{ color:C.gray, fontSize:12, marginTop:6, lineHeight:1.6 }}>
            Le prestataire attend un virement que rien n'émettra. Le montant affiché est calculé
            par la même fonction que la clôture — il n'est pas recalculé ici.
          </div>
          {data.sansVersement.map(m => (
            <div key={m.id} style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap", marginTop:10, paddingTop:10, borderTop:"1px solid #E5E7EB" }}>
              <div style={{ flex:1, minWidth:180 }}>
                <div style={{ fontWeight:700, fontSize:13 }}>{nom(m.prestataire_id)} — {euro(m.montant_du)}</div>
                <div style={{ color:C.gray, fontSize:11 }}>
                  {m.metier || "Prestation"} · {m.date} · échéance {m.echeance ? new Date(m.echeance).toLocaleDateString("fr-FR") : "—"}
                </div>
              </div>
              <button disabled={programme === m.id} onClick={async () => {
                if (!await showConfirm(`Programmer le versement de ${euro(m.montant_du)} à ${nom(m.prestataire_id)} ?`)) return;
                setProgramme(m.id);
                try {
                  const r = await boFetch({ action:"programmer_versement", mission_id:m.id });
                  const j = await r.json();
                  if (j.success) { showToast("Versement programmé 💶", "success"); load(); }
                  else showToast(j.error || "Échec de la programmation");
                } catch { showToast("Erreur réseau"); }
                setProgramme(null);
              }} style={{ padding:"8px 14px", borderRadius:8, border:"none", background:C.violet, color:"#fff", fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>
                {programme === m.id ? "…" : "💶 Programmer"}
              </button>
            </div>
          ))}
        </Card>
      )}

      {data.enRetard > 0 && (
        <Card style={{ borderLeft:`3px solid #E74C3C`, marginBottom:14 }}>
          <div style={{ color:"#E74C3C", fontWeight:800, fontSize:14 }}>
            ⚠️ {data.enRetard} versement{data.enRetard>1?"s":""} en retard de plus de 6 h
          </div>
          {/* La bannière renvoyait aux journaux Vercel — c'est-à-dire qu'elle
              demandait à un non-développeur d'aller lire des journaux serveur
              pour savoir si une horloge battait. Elle le dit maintenant
              elle-même, à partir du témoin que chaque passage inscrit. */}
          <div style={{ color:C.gray, fontSize:12, marginTop:6, lineHeight:1.6 }}>
            L'échéance est passée mais le virement n'est pas parti. Le traitement automatique
            tourne toutes les deux heures et rattrape ce genre de retard.
          </div>
          {(() => {
            if (dernierPassage === undefined) return null;
            if (!dernierPassage) {
              return (
                <div style={{ marginTop:8, padding:"10px 12px", borderRadius:8, background:"rgba(231,76,60,0.12)", border:"1px solid rgba(231,76,60,0.35)", color:"#E74C3C", fontSize:12, lineHeight:1.6 }}>
                  <strong>Le traitement automatique n'a jamais signalé de passage.</strong> C'est lui
                  qui déclenche les virements, l'auto-validation, la clôture des prestations et le
                  dénouement des litiges. Vérifiez la variable <code>CRON_SECRET</code> dans Vercel :
                  une espace invisible suffit à faire refuser chaque appel.
                </div>
              );
            }
            const ecoule = Date.now() - new Date(dernierPassage).getTime();
            const heures = Math.floor(ecoule / 3600000);
            const enPanne = ecoule > 3 * 3600000;
            return (
              <div style={{ marginTop:8, padding:"10px 12px", borderRadius:8,
                background: enPanne ? "rgba(231,76,60,0.12)" : "rgba(16,217,143,0.1)",
                border: `1px solid ${enPanne ? "rgba(231,76,60,0.35)" : "rgba(16,217,143,0.3)"}`,
                color: enPanne ? "#E74C3C" : "#10D98F", fontSize:12, lineHeight:1.6 }}>
                Dernier passage : <strong>{new Date(dernierPassage).toLocaleString("fr-FR", { dateStyle:"long", timeStyle:"short" })}</strong>
                {heures >= 1 ? ` — il y a ${heures} h.` : " — il y a moins d'une heure."}
                {enPanne && <> Il devrait passer toutes les deux heures : <strong>il ne s'exécute plus</strong>.
                  Vérifiez la variable <code>CRON_SECRET</code> dans les réglages Vercel du projet.</>}
              </div>
            );
          })()}
          {/* Le bouton est ici, et pas seulement sur l'écran KPIs : c'est ici
              qu'on constate le retard, et un remède qu'il faut aller chercher
              ailleurs n'est pas un remède. */}
          <button disabled={relance} onClick={async () => {
            setRelance(true);
            try {
              let jeton = ""; try { jeton = sessionStorage.getItem("bo_token") || ""; } catch { /* session illisible */ }
              const r = await fetch("/api/cron-reset-monthly?action=reminders", { headers: { "Authorization": `Bearer ${jeton}` } });
              const d = await r.json();
              if (d.success) { showToast("Traitement lancé — les virements dus sont partis.", "success"); load(); }
              else showToast(d.error || `Le traitement a échoué (${r.status})`, "error");
            } catch (e) { showToast(`Traitement injoignable : ${e.message}`, "error"); }
            setRelance(false);
          }} style={{ marginTop:10, width:"100%", padding:"10px", borderRadius:8, border:"none", background:C.violet, color:"#fff", fontWeight:800, fontSize:12.5, cursor:relance?"default":"pointer", fontFamily:"inherit", opacity:relance?0.6:1 }}>
            {relance ? "Traitement en cours…" : "🔄 Lancer le traitement maintenant"}
          </button>
        </Card>
      )}

      <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:14 }}>
        {["tous","pending","held","failed","processing"].map(f => (
          <button key={f} onClick={()=>setFiltre(f)} style={{
            padding:"6px 12px", borderRadius:20, cursor:"pointer", fontFamily:"inherit", fontSize:12, fontWeight:700,
            border:`1px solid ${filtre===f?C.violet:"#E5E7EB"}`,
            background: filtre===f ? `${C.violet}18` : "#fff",
            color: filtre===f ? C.violet : C.gray,
          }}>
            {f === "tous" ? "Tous" : ETAT_VERSEMENT[f]?.l || f}
            {" "}({f==="tous" ? data.versements.length : data.versements.filter(v=>v.payout_status===f).length})
          </button>
        ))}
      </div>

      <div style={{ color:C.gray, fontSize:12, marginBottom:10 }}>
        {listee.length} versement{listee.length>1?"s":""} — {euro(total)} au total
      </div>

      {listee.length === 0 ? (
        <Card><div style={{ color:C.gray, fontSize:13 }}>Aucun versement dans cet état.</div></Card>
      ) : listee.map(m => {
        const etat = ETAT_VERSEMENT[m.payout_status] || { l:m.payout_status, c:C.gray };
        const echu = m.payout_status === "pending" && m.payout_due_at && new Date(m.payout_due_at) < new Date();
        return (
          <Card key={m.id} style={{ marginBottom:10 }}>
            <div style={{ display:"flex", gap:12, alignItems:"flex-start", flexWrap:"wrap" }}>
              <div style={{ flex:1, minWidth:220 }}>
                <div style={{ fontWeight:800, fontSize:14 }}>
                  {nom(m.prestataire_id)} — {euro(m.payout_amount)}
                  {m.payout_compensation > 0 && (
                    <span style={{ color:"#E67E22", fontWeight:700, fontSize:12 }}> (dont {euro(m.payout_compensation)} retenus)</span>
                  )}
                </div>
                <div style={{ color:C.gray, fontSize:12, marginTop:3 }}>
                  {SECTOR_LABELS[m.sector] || m.metier || "Prestation"} du {jour(m.date)}
                </div>
                <div style={{ color: echu ? "#E74C3C" : C.gray, fontSize:12, marginTop:3, fontWeight: echu ? 700 : 400 }}>
                  {m.payout_status === "held"
                    ? `Retenu pour « ${LIBELLE_MOTIF[m.payout_hold_reason] || m.payout_hold_reason} » — fin au plus tard le ${jour(m.payout_hold_until)}`
                    : `Échéance ${jour(m.payout_due_at)}${echu ? " — dépassée" : ""}`}
                </div>
              </div>
              <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
                <Badge color={etat.c}>{etat.l}</Badge>
                {m.payout_status === "held"
                  ? <Btn variant="secondary" style={{ padding:"6px 12px", fontSize:12 }} onClick={()=>lever(m)} disabled={busyId===m.id}>Lever</Btn>
                  : (m.payout_status === "pending" || m.payout_status === "failed") &&
                    <Btn variant="secondary" style={{ padding:"6px 12px", fontSize:12 }} onClick={()=>retenir(m)} disabled={busyId===m.id}>Retenir</Btn>}
                <Btn variant="secondary" style={{ padding:"6px 12px", fontSize:12 }} onClick={()=>creerCreance(m)} disabled={busyId===m.id}>Somme due</Btn>
              </div>
            </div>
          </Card>
        );
      })}

      <div style={{ marginTop:28 }}><SectionHeader title="Sommes dues par les prestataires" /></div>
      <div style={{ color:C.gray, fontSize:12, marginTop:-8, marginBottom:14 }}>Récupérées sur les versements à venir, moitié maximum (art. 8B.3)</div>
      {data.creances.length === 0 ? (
        <Card><div style={{ color:C.gray, fontSize:13 }}>Aucune somme due en cours.</div></Card>
      ) : data.creances.map(c => (
        <Card key={c.id} style={{ marginBottom:10 }}>
          <div style={{ display:"flex", gap:12, alignItems:"flex-start", flexWrap:"wrap" }}>
            <div style={{ flex:1, minWidth:220 }}>
              <div style={{ fontWeight:800, fontSize:14 }}>
                {nom(c.prestataire_id)} — reste {euro(c.montant_restant)} sur {euro(c.montant_initial)}
              </div>
              <div style={{ color:C.gray, fontSize:12, marginTop:3 }}>{c.motif}</div>
              <div style={{ color:C.gray, fontSize:12, marginTop:3 }}>
                Notifiée le {jour(c.notifiee_at)} · exigible le {jour(c.exigible_at)}
                {c.statut === "contestee" && " · contestée, compensation suspendue"}
              </div>
            </div>
            <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
              <Badge color={c.statut === "contestee" ? "#E67E22" : C.violet}>{c.statut}</Badge>
              {c.statut === "active"
                ? <Btn variant="secondary" style={{ padding:"6px 12px", fontSize:12 }} onClick={()=>statuer(c, "contestee", `Enregistrer une contestation de ${nom(c.prestataire_id)} ? La retenue sera suspendue.`)} disabled={busyId===c.id}>Contestée</Btn>
                : <Btn variant="secondary" style={{ padding:"6px 12px", fontSize:12 }} onClick={()=>statuer(c, "active", "Maintenir la somme due après examen ? La retenue reprendra.")} disabled={busyId===c.id}>Maintenir</Btn>}
              <Btn variant="secondary" style={{ padding:"6px 12px", fontSize:12 }} onClick={()=>statuer(c, "abandonnee", `Abandonner définitivement les ${euro(c.montant_restant)} restants ?`)} disabled={busyId===c.id}>Abandonner</Btn>
            </div>
          </div>
        </Card>
      ))}
    </>
  );
}

// Documents dont la validité est datée : sans cette date, rien ne suit
// l'expiration et l'article 19.1 des CGPS — renouvellement annuel de la RC Pro,
// suspension trente jours après l'échéance — reste une promesse sans effet.
const DOCS_A_ECHEANCE = ["rc_pro", "urssaf"];

async function demanderValidite(type) {
  if (!DOCS_A_ECHEANCE.includes(type)) return { ok: true };
  const saisie = await showPrompt(
    `Date de fin de validité de ce document (AAAA-MM-JJ).\n\n`
    + `Elle déclenche la relance du prestataire avant l'échéance, puis la suspension `
    + `de son accès trente jours après (CGPS art. 19.1).\n\n`
    + `Laissez vide si le document n'en porte pas.`
  );
  if (saisie === null) return { ok: false };
  const v = String(saisie).trim();
  if (!v) return { ok: true };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    showToast("Date invalide — attendu AAAA-MM-JJ. Vérification annulée.", "error");
    return { ok: false };
  }
  return { ok: true, expiresAt: v };
}

export function BOLitiges() {
  const [disputes, setDisputes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await boFetch({ action: "list_disputes" });
      const d = await r.json();
      if (Array.isArray(d)) setDisputes(d);
    // Sans trace, la liste reste vide et l'administrateur en conclut qu'il n'y a aucun litige.
    } catch (e) { console.error("[BO] liste des litiges illisible :", e.message); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // La proposition en cours de rédaction : quelle issue, quel montant, quel
  // motif. Un seul litige à la fois — on ne rédige pas deux propositions.
  const [brouillon, setBrouillon] = useState(null);

  // ALANE propose, elle ne décide pas (CGPS art. 17.1).
  //
  // Ces deux boutons remboursaient ou validaient dans la seconde. Ils ne font
  // plus que formuler une proposition, notifiée aux deux parties, exécutée par
  // le traitement automatique 48 heures plus tard si personne ne s'y oppose.
  // Aucun euro ne bouge ici.
  const proposer = async (m, resolution, motif, montant) => {
    setProcessingId(m.id);
    try {
      const r = await boFetch({ action: "proposer_resolution", mission_id: m.id, resolution, motif, montant });
      const d = await r.json();
      if (d.success) {
        showToast("Proposition notifiée aux deux parties 📩", "success");
        setBrouillon(null);
        load();
      } else {
        showToast(d.error || "La proposition n'a pas pu être enregistrée");
      }
    } catch { showToast("Erreur réseau"); }
    setProcessingId(null);
  };

  // Les deux autres causes de déblocage de l'article 17.1 : une décision de
  // justice, ou une procédure de l'établissement de paiement. Là, ALANE ne
  // propose pas — elle constate et transmet. D'où la justification obligatoire.
  const executer = async (m, resolution, cause) => {
    const quoi = resolution === "rembourser_client" ? "le remboursement du client" : "le versement au prestataire";
    const origine = cause === "justice" ? "d'une décision de justice" : "d'une procédure de l'établissement de paiement";
    const justification = await showPrompt(
      `Exécuter ${quoi} en application ${origine} ?\n\nCette action débloque les fonds sans l'accord des parties. Elle n'est légitime que si la décision existe réellement.`,
      "Référence de la décision ou du dossier…"
    );
    if (justification === null) return;
    setProcessingId(m.id);
    try {
      const r = await boFetch({ action: "executer_decision", mission_id: m.id, resolution, cause, justification });
      const d = await r.json();
      if (d.success) { showToast("Instruction transmise ⚖️", "success"); load(); }
      else showToast(d.error || "L'exécution a échoué");
    } catch { showToast("Erreur réseau"); }
    setProcessingId(null);
  };

  if (loading) return <div style={{ padding:24, textAlign:"center", color:"rgba(255,255,255,0.6)" }}>Chargement…</div>;
  if (!disputes.length) return (
    <div style={{ padding:24, textAlign:"center" }}>
      <div style={{ fontSize:32, marginBottom:8 }}>✅</div>
      <div style={{ color:"rgba(255,255,255,0.6)", fontSize:14 }}>Aucun litige en cours</div>
    </div>
  );

  return (
    <div style={{ padding:16 }}>
      <h3 style={{ color:C.white, fontSize:15, fontWeight:800, margin:"0 0 14px" }}>Litiges en cours ({disputes.length})</h3>
      {disputes.map(m => (
        <div key={m.id} style={{ background:"rgba(242,94,94,0.08)", border:"1px solid rgba(242,94,94,0.3)", borderRadius:12, padding:16, marginBottom:12 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:8 }}>
            <div>
              <div style={{ fontWeight:700, color:"#F25E5E", fontSize:14 }}>⚠️ {m.titre || m.metier || "Prestation"}</div>
              <div style={{ color:"rgba(255,255,255,0.6)", fontSize:12, marginTop:3 }}>📅 {m.date} · 💶 {m.montant_total || 0} €</div>
              {m.client_email && <div style={{ color:"rgba(255,255,255,0.6)", fontSize:11, marginTop:2 }}>Client : {m.client_email}</div>}
              {m.presta_email && <div style={{ color:"rgba(255,255,255,0.6)", fontSize:11, marginTop:2 }}>Prestataire : {m.presta_email}</div>}
            </div>
          </div>
          {m.dispute_reason && <div style={{ background:"rgba(255,255,255,0.04)", borderRadius:8, padding:"8px 12px", fontSize:12, color:"rgba(255,255,255,0.6)", marginBottom:10 }}>"{m.dispute_reason}"</div>}

          {/* Où en est la proposition. Sans cet état, on en formulerait une
              deuxième par-dessus, ou on croirait qu'il ne s'est rien passé. */}
          {m.resolution_proposee && (
            <div style={{ background:"rgba(255,255,255,0.05)", borderRadius:8, padding:"10px 12px", fontSize:12, color:"rgba(255,255,255,0.7)", marginBottom:10, lineHeight:1.6 }}>
              📩 Proposition en cours : <strong>{m.resolution_proposee === "rembourser_client"
                ? (m.resolution_montant != null
                    ? `rembourser ${Number(m.resolution_montant).toFixed(2).replace(".", ",")} € au client`
                    : "rembourser le client")
                : "payer le prestataire"}</strong>
              {m.resolution_motif && <div style={{ color:"rgba(255,255,255,0.6)", marginTop:3 }}>Motif : {m.resolution_motif}</div>}
              {m.resolution_opposition_at
                ? <div style={{ color:"#F25E5E", marginTop:5, fontWeight:700 }}>⛔ Opposition enregistrée — les fonds restent bloqués. Seul un accord, une décision de justice ou une procédure de l'établissement de paiement peut les débloquer.</div>
                : <div style={{ color:"rgba(255,255,255,0.6)", marginTop:5 }}>Sans opposition, exécutée le {m.resolution_echeance_at ? new Date(m.resolution_echeance_at).toLocaleString("fr-FR") : "—"}.</div>}
            </div>
          )}

          {/* ── Que faire de l'argent ? ────────────────────────────────
              L'écran disait « ALANE propose, elle ne décide pas : la
              proposition est notifiée aux deux parties, qui ont 48 h pour s'y
              opposer », suivi de deux boutons « Proposer le remboursement » /
              « Proposer le versement ». Exact juridiquement, illisible pour
              qui doit décider : la phrase énonce un principe sans dire ce qui
              va se passer, et « versement » ne dit pas à qui.

              Et il n'y avait aucun montant intermédiaire. Or la plupart des
              litiges réels sont partiels — deux heures sur trois faites, une
              partie du travail à refaire. Sans montant, il fallait choisir
              entre tout rendre et ne rien rendre. */}
          {!m.resolution_proposee && (() => {
            const b = brouillon?.id === m.id ? brouillon : null;
            const enCours = processingId === m.id;
            return (
              <>
                <div style={{ background:"rgba(255,255,255,0.04)", borderRadius:8, padding:"10px 12px", marginBottom:10, fontSize:11.5, color:"rgba(255,255,255,0.7)", lineHeight:1.65 }}>
                  Le client a payé <strong style={{ color:C.white }}>{Number(m.montant_total || 0).toFixed(2).replace(".", ",")} €</strong>. Cet argent est bloqué : ni chez lui, ni chez le prestataire.<br />
                  ALANE ne tranche pas le litige, elle <strong style={{ color:C.white }}>propose une issue</strong>. Les deux parties sont prévenues et ont 48 h pour dire non. Sans refus de l'une d'elles, l'issue s'applique automatiquement.
                </div>

                {!b && (
                  <div style={{ display:"flex", gap:8 }}>
                    <button disabled={enCours} onClick={() => setBrouillon({ id:m.id, resolution:"rembourser_client", montant:"", motif:"" })}
                      style={{ flex:1, padding:"10px", borderRadius:10, border:"none", background:"#10D98F", color:"#04231A", fontWeight:800, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>
                      💶 Rembourser le client
                    </button>
                    <button disabled={enCours} onClick={() => setBrouillon({ id:m.id, resolution:"verser_prestataire", montant:"", motif:"" })}
                      style={{ flex:1, padding:"10px", borderRadius:10, border:"1px solid rgba(242,94,94,0.4)", background:"transparent", color:"#F25E5E", fontWeight:800, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>
                      🤝 Payer le prestataire
                    </button>
                  </div>
                )}

                {b && (
                  <div style={{ background:"rgba(255,255,255,0.05)", borderRadius:10, padding:"12px", border:"1px solid rgba(255,255,255,0.1)" }}>
                    <div style={{ fontWeight:800, color:C.white, fontSize:12.5, marginBottom:8 }}>
                      {b.resolution === "rembourser_client" ? "💶 Rembourser le client" : "🤝 Payer le prestataire"}
                    </div>

                    {b.resolution === "rembourser_client" && (
                      <>
                        <label style={{ display:"block", color:"rgba(255,255,255,0.7)", fontSize:11, marginBottom:4 }}>Montant à rembourser (€)</label>
                        <input value={b.montant} inputMode="decimal"
                          onChange={e => setBrouillon(v => ({ ...v, montant:e.target.value }))}
                          placeholder="Laisser vide = remboursement complet"
                          style={{ width:"100%", padding:"9px 11px", borderRadius:8, border:"1px solid rgba(255,255,255,0.15)", background:"#0A1628", color:C.white, fontSize:13, fontFamily:"inherit", boxSizing:"border-box" }} />
                        {/* Le montant par défaut n'est pas recalculé ici : les frais
                            de service se calculent côté serveur, et une deuxième
                            formule dans le navigateur finirait par diverger. */}
                        <div style={{ color:"rgba(255,255,255,0.6)", fontSize:10.5, margin:"5px 0 10px", lineHeight:1.5 }}>
                          Vide = le prix de la prestation est rendu, les frais de service restant acquis à ALANE. Indiquez une somme pour un remboursement partiel — par exemple si une partie du travail a bien été faite.
                        </div>
                      </>
                    )}

                    <label style={{ display:"block", color:"rgba(255,255,255,0.7)", fontSize:11, marginBottom:4 }}>Motif (lu par le client ET par le prestataire)</label>
                    <textarea value={b.motif} rows={3}
                      onChange={e => setBrouillon(v => ({ ...v, motif:e.target.value }))}
                      placeholder="Ex : seule la première heure a été réalisée, le client a confirmé le départ anticipé du prestataire."
                      style={{ width:"100%", padding:"9px 11px", borderRadius:8, border:"1px solid rgba(255,255,255,0.15)", background:"#0A1628", color:C.white, fontSize:12.5, fontFamily:"inherit", boxSizing:"border-box", resize:"vertical" }} />
                    <div style={{ color: b.motif.trim().length >= 10 ? "rgba(255,255,255,0.6)" : "#F0B429", fontSize:10.5, margin:"4px 0 10px" }}>
                      {b.motif.trim().length >= 10 ? "Chacun pourra s'y opposer sans avoir à se justifier." : "10 caractères minimum — c'est sur ce texte que les parties décident de s'opposer ou non."}
                    </div>

                    <div style={{ display:"flex", gap:8 }}>
                      <button disabled={enCours} onClick={() => setBrouillon(null)}
                        style={{ flex:1, padding:"9px", borderRadius:9, border:"1px solid rgba(255,255,255,0.15)", background:"transparent", color:"rgba(255,255,255,0.7)", fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>
                        Annuler
                      </button>
                      <button disabled={enCours || b.motif.trim().length < 10}
                        onClick={() => proposer(m, b.resolution, b.motif.trim(), b.resolution === "rembourser_client" ? b.montant.trim() : undefined)}
                        style={{ flex:2, padding:"9px", borderRadius:9, border:"none", background: b.resolution === "rembourser_client" ? "#10D98F" : "#F25E5E", color:"#fff", fontWeight:800, fontSize:12, cursor:"pointer", fontFamily:"inherit", opacity: (enCours || b.motif.trim().length < 10) ? 0.5 : 1 }}>
                        {enCours ? "…" : "📩 Envoyer la proposition"}
                      </button>
                    </div>
                  </div>
                )}
              </>
            );
          })()}

          {/* Les deux autres causes de l'article 17.1. Volontairement discrètes :
              elles débloquent sans accord, et ne servent qu'adossées à une
              décision réelle. */}
          {m.resolution_opposition_at && (
            <div style={{ display:"flex", gap:8, marginTop:8, flexWrap:"wrap" }}>
              <button disabled={processingId === m.id} onClick={() => executer(m, "rembourser_client", "justice")}
                style={{ flex:1, minWidth:150, padding:"8px", borderRadius:10, border:"1px solid rgba(255,255,255,0.15)", background:"transparent", color:"rgba(255,255,255,0.6)", fontWeight:600, fontSize:11, cursor:"pointer", fontFamily:"inherit" }}>
                ⚖️ Rembourser sur décision
              </button>
              <button disabled={processingId === m.id} onClick={() => executer(m, "verser_prestataire", "justice")}
                style={{ flex:1, minWidth:150, padding:"8px", borderRadius:10, border:"1px solid rgba(255,255,255,0.15)", background:"transparent", color:"rgba(255,255,255,0.6)", fontWeight:600, fontSize:11, cursor:"pointer", fontFamily:"inherit" }}>
                ⚖️ Verser sur décision
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function BroadcastNotifSection() {
  const [title, setTitle] = useState("");
  const [body, setBody]   = useState("");
  const [target, setTarget] = useState("all");
  const [sending, setSending] = useState(false);
  const [result, setResult]   = useState(null);
  const send = async () => {
    if (!title.trim() || !body.trim()) return;
    setSending(true); setResult(null);
    try {
      const r = await boFetch({ action:"broadcast_notification", title:title.trim(), body:body.trim(), target });
      const j = await r.json();
      setResult(j.ok ? { ok:true, msg:`✅ Notification envoyée à ${j.sent} utilisateurs` } : { ok:false, msg:`❌ ${j.error}` });
      if (j.ok) { setTitle(""); setBody(""); }
    } catch { setResult({ ok:false, msg:"❌ Erreur réseau" }); }
    setSending(false);
    setTimeout(() => setResult(null), 5000);
  };
  return (
    <>
      <div style={{ fontWeight:800, color:C.text, fontSize:13, margin:"18px 0 10px" }}>📣 Notification in-app</div>
      <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:13, padding:"14px", marginBottom:14 }}>
        <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Titre de la notification" style={{ width:"100%", padding:"8px 10px", borderRadius:8, border:`1px solid ${C.border}`, background:"rgba(255,255,255,0.05)", color:C.text, fontSize:13, fontFamily:"inherit", marginBottom:8, boxSizing:"border-box" }} />
        <textarea value={body} onChange={e=>setBody(e.target.value)} placeholder="Message…" rows={2} style={{ width:"100%", padding:"8px 10px", borderRadius:8, border:`1px solid ${C.border}`, background:"rgba(255,255,255,0.05)", color:C.text, fontSize:13, fontFamily:"inherit", resize:"vertical", marginBottom:8, boxSizing:"border-box" }} />
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          <select value={target} onChange={e=>setTarget(e.target.value)} style={{ flex:1, padding:"8px 10px", borderRadius:8, border:`1px solid ${C.border}`, background:"#0D1B3E", color:C.text, fontSize:13, fontFamily:"inherit" }}>
            <option value="all">Tous les utilisateurs</option>
            <option value="clients">Clients uniquement</option>
            <option value="prestataires">Prestataires uniquement</option>
          </select>
          <button onClick={send} disabled={sending||!title.trim()||!body.trim()} style={{ padding:"8px 16px", borderRadius:8, border:"none", background:C.violet, color:"#fff", fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit", opacity:sending?0.5:1 }}>
            {sending?"Envoi…":"Envoyer 📣"}
          </button>
        </div>
        {result && <div style={{ marginTop:8, fontSize:12, color:result.ok?C.success:"#F25E5E", fontWeight:600 }}>{result.msg}</div>}
      </div>
    </>
  );
}

export function BORatings() {
  const [ratings, setRatings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(null);
  // Les avis reçus par les CLIENTS ne sont visibles qu'ici. Décision du
  // 18/08/2026 : ils étaient enregistrés et lus par personne, ce qui est une
  // collecte sans finalité. Les montrer au prestataire avant qu'il accepte
  // aurait été l'usage naturel, mais aurait fait de la note un critère de
  // sélection — donc un pouvoir sur le client, exercé par la plateforme qui
  // l'affiche. Le back-office suffit à repérer un client problématique.
  const [vue, setVue] = useState("prestataires");
  useEffect(() => {
    boFetch({ action:"list_ratings" }).then(r=>r.json()).then(d=>{ setRatings(Array.isArray(d)?d:[]); setLoading(false); }).catch(()=>setLoading(false));
  }, []);
  const handleDelete = async (id) => {
    if (!await showConfirm("Supprimer cet avis définitivement ?")) return;
    setDeleting(id);
    // L'avis n'est retiré de la liste que si le serveur l'a réellement supprimé :
    // il disparaissait de l'écran puis réapparaissait au rechargement.
    try {
      const r = await boFetch({ action:"delete_rating", ratingId:id });
      const j = await r.json().catch(()=>({}));
      if (r.ok) setRatings(rs => rs.filter(x=>x.id!==id));
      else showToast(j.error || `Erreur ${r.status}`, "error");
    } catch(e) { showToast(e?.message || "Erreur réseau", "error"); }
    setDeleting(null);
  };
  if (loading) return <div style={{ color:C.textSub, fontSize:13, padding:"20px 0" }}>Chargement…</div>;

  const surClients = ratings.filter(r => r.reviewee_role === "client");
  const surPrestas = ratings.filter(r => r.reviewee_role !== "client");
  const liste = vue === "clients" ? surClients : surPrestas;

  // Moyenne par client, pour repérer d'un coup d'œil ceux qui posent problème.
  // Affichée à partir de TROIS avis : en dessous, un seul prestataire mécontent
  // condamnerait quelqu'un, et le chiffre ne dirait rien de la réalité.
  const parClient = {};
  for (const r of surClients) {
    const c = (parClient[r.reviewee_id] ||= { nom: r.reviewee_name, notes: [] });
    c.notes.push(Number(r.rating) || 0);
  }
  const synthese = Object.entries(parClient)
    .map(([id, c]) => ({ id, nom: c.nom, nb: c.notes.length,
                         moyenne: c.notes.reduce((a, b) => a + b, 0) / c.notes.length }))
    .filter(c => c.nb >= 3)
    .sort((a, b) => a.moyenne - b.moyenne);

  return (
    <div>
      <div style={{ fontWeight:800, color:C.text, fontSize:16, marginBottom:12 }}>⭐ Gestion des avis</div>

      <div style={{ display:"flex", gap:8, marginBottom:14 }}>
        {[{ id:"prestataires", l:`Sur les prestataires (${surPrestas.length})` },
          { id:"clients",     l:`Sur les clients (${surClients.length})` }].map(o => (
          <button key={o.id} onClick={()=>setVue(o.id)} style={{
            flex:1, padding:"9px 6px", borderRadius:10, cursor:"pointer", fontFamily:"inherit", fontSize:12,
            border:`1px solid ${vue===o.id?C.violet:C.border}`,
            background: vue===o.id ? `${C.violet}18` : "transparent",
            color: vue===o.id ? C.violet : C.textSub, fontWeight: vue===o.id?700:500,
          }}>{o.l}</button>
        ))}
      </div>

      {vue === "clients" && (
        <div style={{ background:"rgba(124,111,224,0.07)", border:`1px solid ${C.border}`, borderRadius:12, padding:"12px 14px", marginBottom:14 }}>
          <div style={{ color:C.textSub, fontSize:11, lineHeight:1.6, marginBottom: synthese.length ? 10 : 0 }}>
            Ces avis sont déposés par les prestataires et ne sont visibles nulle part ailleurs :
            ni le client, ni les autres prestataires n'y ont accès. Ils servent à repérer un
            client à qui parler, pas à le classer.
          </div>
          {synthese.length > 0 && (
            <>
              <div style={{ color:C.accentGold, fontWeight:700, fontSize:12, marginBottom:6 }}>
                Clients avec au moins 3 avis, du moins bien noté au mieux noté
              </div>
              {synthese.map(c => (
                <div key={c.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"5px 0", borderBottom:`1px solid ${C.border}` }}>
                  <span style={{ color:C.text, fontSize:12 }}>{c.nom}</span>
                  <span style={{ color: c.moyenne < 3 ? C.danger : c.moyenne < 4 ? C.accentGold : C.success, fontSize:12, fontWeight:700 }}>
                    {c.moyenne.toFixed(1)} / 5 · {c.nb} avis
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {!liste.length && (
        <div style={{ color:C.textSub, fontSize:13, textAlign:"center", padding:"20px 0" }}>
          {vue === "clients" ? "Aucun avis sur un client pour l'instant" : "Aucun avis pour l'instant"}
        </div>
      )}
      {liste.map(r => (
        <div key={r.id} style={{ background:"#0D1B3E", borderRadius:12, padding:"12px 14px", marginBottom:8, border:`1px solid ${C.border}` }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:8 }}>
            <div style={{ flex:1 }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
                <span style={{ color:C.accentGold, fontSize:14 }}>{"⭐".repeat(r.rating)}</span>
                <span style={{ color:C.textSub, fontSize:11 }}>{new Date(r.created_at).toLocaleDateString("fr-FR")}</span>
              </div>
              <div style={{ color:C.textSub, fontSize:11, marginBottom:4 }}>
                <strong style={{ color:C.text }}>{r.reviewer_name}</strong> → <strong style={{ color:C.violet }}>{r.reviewee_name}</strong>
              </div>
              {r.comment && <div style={{ color:"rgba(255,255,255,0.65)", fontSize:12, lineHeight:1.5, fontStyle:"italic" }}>"{r.comment}"</div>}
            </div>
            <button onClick={()=>handleDelete(r.id)} disabled={deleting===r.id} style={{ padding:"5px 10px", borderRadius:8, border:"1px solid rgba(242,94,94,0.3)", background:"rgba(242,94,94,0.1)", color:"#F25E5E", fontSize:11, fontWeight:600, cursor:"pointer", fontFamily:"inherit", flexShrink:0 }}>
              {deleting===r.id?"…":"🗑 Supprimer"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export function BOModerationTab({ d }) {
  const [suspendEmail, setSuspendEmail]   = useState("");
  const [suspendReason, setSuspendReason] = useState("");
  const [suspending, setSuspending]       = useState(false);
  const [suspendResult, setSuspendResult] = useState(null);
  const [commMsg, setCommMsg]             = useState("");
  const [commSending, setCommSending]     = useState(false);
  const [commResult, setCommResult]       = useState(null);
  const [lastSync, setLastSync]           = useState(null);
  // Signaux de mise à disposition (CGPS art. 10B). Aucun n'est une preuve : ils
  // désignent les comptes à qui poser une question, première marche de l'escalade.
  const [signaux, setSignaux]             = useState(null);
  const [signauxErr, setSignauxErr]       = useState(null);
  const [traitement, setTraitement]       = useState({});   // clientId → { decision, note, envoi }
  const [historiques, setHistoriques]     = useState({});   // clientId → décisions passées

  const DECISIONS_CONFORMITE = [
    { id:"explications_demandees", l:"Explications demandées" },
    { id:"justificatifs_recus",    l:"Justificatifs reçus" },
    { id:"conforme",               l:"Vérifié — conforme" },
    { id:"suspendu",               l:"Mise en relation suspendue" },
    { id:"sans_suite",             l:"Classé sans suite" },
  ];

  const chargerHistorique = async (clientId) => {
    try {
      const r = await boFetch({ action:"historique_conformite", clientId });
      const j = await r.json().catch(() => []);
      setHistoriques(h => ({ ...h, [clientId]: Array.isArray(j) ? j : [] }));
    } catch (e) { console.error("[conformité] historique illisible :", e?.message); }
  };

  const traiterSignal = async (clientId) => {
    const t = traitement[clientId] || {};
    if (!t.decision) { showToast("Choisissez une décision.", "error"); return; }
    setTraitement(p2 => ({ ...p2, [clientId]: { ...t, envoi:true } }));
    try {
      const r = await boFetch({ action:"traiter_signal", clientId, decision:t.decision, note:t.note || "" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { showToast(j.error || `Erreur ${r.status}`, "error"); }
      else {
        showToast("Décision consignée.", "success");
        setTraitement(p2 => ({ ...p2, [clientId]: { decision:"", note:"", envoi:false } }));
        chargerHistorique(clientId);
        return;
      }
    } catch (e) { showToast(e?.message || "Erreur réseau", "error"); }
    setTraitement(p2 => ({ ...p2, [clientId]: { ...t, envoi:false } }));
  };

  useEffect(() => {
    let vivant = true;
    boFetch({ action:"signaux_mise_a_disposition" })
      .then(async r => {
        const j = await r.json().catch(() => null);
        if (!vivant) return;
        if (!r.ok) { setSignauxErr(j?.error || `Erreur ${r.status}`); setSignaux([]); return; }
        setSignaux(Array.isArray(j) ? j : []);
      })
      .catch(e => { if (vivant) { setSignauxErr(e?.message || "Erreur réseau"); setSignaux([]); } });
    return () => { vivant = false; };
  }, []);

  const handleSuspend = async () => {
    if(!suspendEmail.trim()) return;
    setSuspending(true); setSuspendResult(null);
    try {
      const r = await boFetch({ action:"list" });
      const users = await r.json();
      const user = (Array.isArray(users)?users:[]).find(u=>u.email===suspendEmail.trim());
      if(!user) { setSuspendResult({ ok:false, msg:"Email introuvable" }); setSuspending(false); return; }
      const r2 = await boFetch({ action:"suspend", profileId: user.id, reason: suspendReason.trim() });
      const j = await r2.json();
      setSuspendResult(j.success ? { ok:true, msg:`Compte ${suspendEmail} suspendu.` } : { ok:false, msg:"Erreur lors de la suspension" });
      if(j.success) { setSuspendEmail(""); setSuspendReason(""); }
    } catch(e) { setSuspendResult({ ok:false, msg:"Erreur réseau" }); }
    setSuspending(false);
  };

  const handleComm = async () => {
    if(!commMsg.trim()) return;
    setCommSending(true); setCommResult(null);
    try {
      const r = await boFetch({ action:"send_global_comm", message: commMsg });
      const j = await r.json();
      setCommResult(j.success ? { ok:true, msg:"Communication envoyée à tous les prestataires actifs." } : { ok:false, msg:"Erreur lors de l'envoi" });
      if(j.success) setCommMsg("");
    } catch { setCommResult({ ok:false, msg:"Erreur réseau" }); }
    setCommSending(false);
    setTimeout(()=>setCommResult(null), 4000);
  };

  const handleSync = () => setLastSync(new Date().toLocaleTimeString("fr-FR"));

  return (
    <>
      <div style={{ fontWeight:800, color:C.text, fontSize:13, marginBottom:12 }}>🚨 Alertes actives</div>
      {d.users.pending > 0 && <AlertRow a={{ icon:"📋", text:`${d.users.pending} compte(s) en attente de validation`, color:"#F39C12", urgent:true }} />}
      {d.tickets?.open > 0 && <AlertRow a={{ icon:"🎧", text:`${d.tickets.open} ticket(s) support non traités`, color:"#E74C3C", urgent:true }} />}
      {d.users.pending === 0 && !d.tickets?.open && <div style={{ color:C.textMuted, fontSize:12, textAlign:"center", padding:"12px 0" }}>✅ Aucune alerte active</div>}

      <div style={{ fontWeight:800, color:C.text, fontSize:13, margin:"18px 0 10px" }}>🕵️ Schémas de mise à disposition</div>
      <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:13, padding:"14px", marginBottom:14 }}>
        <div style={{ color:C.textSub, fontSize:11, lineHeight:1.6, marginBottom:10 }}>
          Intervenir chez un tiers est licite (CGPS art. 10B). Ce qui ne l'est pas, c'est de fournir
          une personne désignée, à l'heure, à un tiers qui la dirige. Ces signaux ne prouvent rien —
          ils indiquent à qui demander des explications.
        </div>
        {signaux === null && <div style={{ color:C.textMuted, fontSize:12 }}>Analyse en cours…</div>}
        {signauxErr && <div style={{ color:C.danger, fontSize:12 }}>Analyse impossible : {signauxErr}</div>}
        {signaux && signaux.length === 0 && !signauxErr && (
          <div style={{ color:C.textMuted, fontSize:12 }}>Aucun schéma récurrent détecté.</div>
        )}
        {signaux && signaux.map(sg => (
          <div key={sg.client_id} style={{ background:"rgba(240,180,41,0.06)", border:"1px solid rgba(240,180,41,0.25)", borderRadius:10, padding:"10px 12px", marginBottom:8 }}>
            <div style={{ color:C.accentGold, fontWeight:700, fontSize:12, marginBottom:4, display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
              {sg.client}
              {sg.presence_continue && (
                <span style={{ background:"rgba(242,94,94,0.15)", border:"1px solid rgba(242,94,94,0.45)", color:C.danger, borderRadius:6, padding:"2px 7px", fontSize:10, fontWeight:800, letterSpacing:0.3 }}>
                  PRÉSENCE CONTINUE
                </span>
              )}
            </div>
            <div style={{ color:C.textSub, fontSize:11, lineHeight:1.7 }}>
              {sg.occurrences_meme_lieu} interventions <strong style={{ color:C.text }}>non déclarées</strong> au même endroit, hors de sa ville
              {sg.ville_compte ? ` (compte déclaré à ${sg.ville_compte})` : ""}<br/>
              Lieu récurrent : <span style={{ color:C.text }}>{sg.lieu_recurrent || "—"}</span><br/>
              {/* L'axe de la durée. La récurrence dit qu'un endroit revient ;
                  la continuité dit s'il s'agit d'un renfort ponctuel ou d'une
                  place tenue mois après mois. Les chiffres sont donnés bruts,
                  jamais présentés comme un seuil à ne pas franchir : aucun
                  texte n'en fixe, et le prétendre fournirait à l'adversaire la
                  preuve qu'ALANE se croyait protégée. */}
              {sg.mois_distincts > 0 && (
                <>
                  Sur ce lieu : <span style={{ color:C.text }}>{sg.mois_consecutifs} mois consécutif{sg.mois_consecutifs > 1 ? "s" : ""}</span>
                  {sg.mois_distincts !== sg.mois_consecutifs ? ` (${sg.mois_distincts} mois au total)` : ""} ·
                  jusqu'à <span style={{ color:C.text }}>{sg.jours_max_par_mois} jour{sg.jours_max_par_mois > 1 ? "s" : ""}</span> dans un même mois
                  {sg.premiere_intervention ? ` · du ${sg.premiere_intervention} au ${sg.derniere_intervention}` : ""}<br/>
                </>
              )}
              {sg.prestataires_distincts} prestataire{sg.prestataires_distincts > 1 ? "s" : ""} distinct{sg.prestataires_distincts > 1 ? "s" : ""} ·
              durée moyenne {sg.duree_moyenne_h} h · {sg.interventions_hors_ville}/{sg.total_prestations} prestations concernées<br/>
              <span style={{ color: sg.declarations > 0 ? C.success : C.danger, fontWeight:700 }}>
                {sg.declarations > 0
                  ? `${sg.declarations} prestation(s) déclarée(s) par ailleurs — schéma probablement légitime`
                  : "Ce client n'a jamais déclaré le lieu d'aucune prestation"}
              </span>
            </div>
            {sg.exemple_declaration && (
              <div style={{ marginTop:8, paddingTop:8, borderTop:"1px solid rgba(255,255,255,0.08)", color:C.textMuted, fontSize:10.5, lineHeight:1.6 }}>
                <div><strong style={{ color:C.textSub }}>Bénéficiaire :</strong> {sg.exemple_declaration.beneficiaire}</div>
                <div><strong style={{ color:C.textSub }}>Service vendu :</strong> {sg.exemple_declaration.service_vendu}</div>
                <div><strong style={{ color:C.textSub }}>Livrable :</strong> {sg.exemple_declaration.livrable}</div>
                <div><strong style={{ color:C.textSub }}>Organise le travail :</strong> {sg.exemple_declaration.organisateur}</div>
              </div>
            )}
            {/* Une détection qu'on ne traite pas prouve qu'on savait. La décision et
                son motif sont consignés dans bo_logs, horodatés. */}
            <div style={{ marginTop:10, paddingTop:9, borderTop:"1px solid rgba(255,255,255,0.08)" }}>
              <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginBottom:7 }}>
                {DECISIONS_CONFORMITE.map(d => {
                  const actif = traitement[sg.client_id]?.decision === d.id;
                  return (
                    <button key={d.id}
                      onClick={()=>setTraitement(p2=>({ ...p2, [sg.client_id]: { ...(p2[sg.client_id]||{}), decision:d.id } }))}
                      style={{ padding:"5px 9px", borderRadius:7, cursor:"pointer", fontFamily:"inherit", fontSize:10.5, fontWeight:700,
                        border:`1px solid ${actif ? C.violet : C.border}`,
                        background: actif ? `${C.violet}22` : "transparent",
                        color: actif ? C.violet : C.textSub }}>
                      {d.l}
                    </button>
                  );
                })}
              </div>
              <input
                value={traitement[sg.client_id]?.note || ""}
                onChange={e=>setTraitement(p2=>({ ...p2, [sg.client_id]: { ...(p2[sg.client_id]||{}), note:e.target.value } }))}
                placeholder="Motif ou observation — obligatoire pour classer sans suite"
                style={{ width:"100%", background:"rgba(255,255,255,0.05)", border:`1px solid ${C.border}`, borderRadius:7, color:C.text, fontSize:11, padding:"7px 9px", fontFamily:"inherit", marginBottom:7, boxSizing:"border-box" }} />
              <div style={{ display:"flex", gap:7 }}>
                <button onClick={()=>traiterSignal(sg.client_id)} disabled={traitement[sg.client_id]?.envoi}
                  style={{ flex:1, padding:"8px", borderRadius:8, border:"none", background:C.violet, color:"#fff", fontWeight:700, fontSize:11.5, cursor:"pointer", fontFamily:"inherit", opacity:traitement[sg.client_id]?.envoi?0.5:1 }}>
                  {traitement[sg.client_id]?.envoi ? "Enregistrement…" : "Consigner la décision"}
                </button>
                <button onClick={()=>chargerHistorique(sg.client_id)}
                  style={{ padding:"8px 12px", borderRadius:8, border:`1px solid ${C.border}`, background:"transparent", color:C.textSub, fontWeight:700, fontSize:11.5, cursor:"pointer", fontFamily:"inherit" }}>
                  Historique
                </button>
              </div>
              {historiques[sg.client_id] && (
                <div style={{ marginTop:8, color:C.textMuted, fontSize:10.5, lineHeight:1.6 }}>
                  {historiques[sg.client_id].length === 0
                    ? "Aucune décision consignée à ce jour."
                    : historiques[sg.client_id].map((h,i) => (
                        <div key={i}>
                          {new Date(h.created_at).toLocaleDateString("fr-FR")} — {String(h.action).replace("conformite_","").replace(/_/g," ")}
                          {h.reason ? ` · ${h.reason}` : ""}
                        </div>
                      ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div style={{ fontWeight:800, color:C.text, fontSize:13, margin:"18px 0 10px" }}>🔒 Suspendre un compte</div>
      <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:13, padding:"14px", marginBottom:14 }}>
        <input value={suspendEmail} onChange={e=>setSuspendEmail(e.target.value)} placeholder="Email du compte à suspendre"
          style={{ width:"100%", background:"rgba(255,255,255,0.06)", border:`1px solid ${C.border}`, borderRadius:8, padding:"10px 12px", color:C.text, fontSize:13, fontFamily:"inherit", boxSizing:"border-box", marginBottom:8 }} />
        <input value={suspendReason} onChange={e=>setSuspendReason(e.target.value)} placeholder="Raison (optionnel)"
          style={{ width:"100%", background:"rgba(255,255,255,0.06)", border:`1px solid ${C.border}`, borderRadius:8, padding:"10px 12px", color:C.text, fontSize:13, fontFamily:"inherit", boxSizing:"border-box", marginBottom:10 }} />
        <button onClick={handleSuspend} disabled={suspending||!suspendEmail.trim()}
          style={{ padding:"10px 20px", borderRadius:10, border:"none", background:C.danger, color:C.white, fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit", opacity:suspending||!suspendEmail.trim()?0.5:1 }}>
          {suspending?"Suspension…":"🔒 Suspendre"}
        </button>
        {suspendResult && <div style={{ marginTop:8, fontSize:12, color:suspendResult.ok?C.success:C.accent, fontWeight:600 }}>{suspendResult.ok?"✅":"❌"} {suspendResult.msg}</div>}
      </div>

      <div style={{ fontWeight:800, color:C.text, fontSize:13, margin:"18px 0 10px" }}>📧 Communication globale</div>
      <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:13, padding:"14px", marginBottom:14 }}>
        <div style={{ color:C.gray, fontSize:11, lineHeight:1.6, marginBottom:10 }}>
          Cet envoi relève de la <strong>prospection commerciale</strong> : il ne part qu'aux prestataires
          ayant expressément consenti à en recevoir (art. L.34-5 du CPCE). Les messages liés à une
          prestation — confirmation, rappel, validation, versement — ne passent pas par ici et partent
          à tout le monde.
        </div>
        <textarea value={commMsg} onChange={e=>setCommMsg(e.target.value)} placeholder="Message commercial, envoyé aux seuls prestataires ayant donné leur accord…" rows={3}
          style={{ width:"100%", background:"rgba(255,255,255,0.06)", border:`1px solid ${C.border}`, borderRadius:8, padding:"10px 12px", color:C.text, fontSize:13, fontFamily:"inherit", boxSizing:"border-box", resize:"vertical", marginBottom:10 }} />
        <button onClick={handleComm} disabled={commSending||!commMsg.trim()}
          style={{ padding:"10px 20px", borderRadius:10, border:"none", background:C.violet, color:C.white, fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit", opacity:commSending||!commMsg.trim()?0.5:1 }}>
          {commSending?"Envoi…":"📧 Envoyer"}
        </button>
        {commResult && <div style={{ marginTop:8, fontSize:12, color:commResult.ok?C.success:C.accent, fontWeight:600 }}>{commResult.ok?"✅":"❌"} {commResult.msg}</div>}
      </div>

      <BroadcastNotifSection />

      <div style={{ fontWeight:800, color:C.text, fontSize:13, margin:"18px 0 10px" }}>🔧 Outils</div>
      <div onClick={handleSync} style={{ background:"#0D1B3E", borderRadius:13, padding:"12px 14px", marginBottom:8, display:"flex", alignItems:"center", gap:10, cursor:"pointer" }}
        onMouseEnter={e=>e.currentTarget.style.transform="translateX(4px)"}
        onMouseLeave={e=>e.currentTarget.style.transform="translateX(0)"}>
        <div style={{ width:38, height:38, borderRadius:11, background:`${C.indigo}15`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 }}>🔄</div>
        <div style={{ flex:1 }}>
          <div style={{ fontWeight:600, color:C.text, fontSize:13 }}>Synchroniser les données</div>
          {lastSync && <div style={{ color:C.textMuted, fontSize:11 }}>Dernier sync : {lastSync}</div>}
        </div>
        <span style={{ color:C.textSub, fontSize:16 }}>›</span>
      </div>
    </>
  );
}

function StripeStatsCard() {
  const [stats, setStats]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  useEffect(() => {
    boFetch({ action: "stripe_stats" })
      .then(r => r.json())
      .then(j => {
        if (j.error) { setError(j.error); }
        else { setStats(j); }
        setLoading(false);
      })
      .catch(() => { setError("Erreur réseau"); setLoading(false); });
  }, []);

  const fmt = (n) => typeof n === "number" ? n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";

  return (
    <div style={{ background:"#0D1B3E", border:"1px solid rgba(255,255,255,0.08)", borderRadius:16, padding:"16px", marginBottom:16, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
      <div style={{ fontWeight:800, color:C.text, fontSize:13, marginBottom:12 }}>💳 Données Stripe en temps réel</div>
      {loading && (
        <div style={{ textAlign:"center", color:"rgba(255,255,255,0.6)", padding:"20px 0", fontSize:13 }}>Chargement…</div>
      )}
      {!loading && error && (
        <div style={{ textAlign:"center", color:"rgba(255,255,255,0.6)", padding:"16px 0", fontSize:12 }}>
          ⚠️ {error === "Stripe non configuré" ? "Stripe n'est pas configuré sur ce projet." : error}
        </div>
      )}
      {!loading && !error && stats && (
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
          <div style={{ background:"rgba(255,255,255,0.04)", borderRadius:12, padding:"14px 12px" }}>
            <div style={{ fontSize:20, marginBottom:6 }}>💳</div>
            <div style={{ fontWeight:800, color:C.success, fontSize:18 }}>{fmt(stats.available)} €</div>
            <div style={{ color:C.textSub, fontSize:11, marginTop:2 }}>Solde disponible</div>
          </div>
          <div style={{ background:"rgba(255,255,255,0.04)", borderRadius:12, padding:"14px 12px" }}>
            <div style={{ fontSize:20, marginBottom:6 }}>⏳</div>
            <div style={{ fontWeight:800, color:C.accentGold, fontSize:18 }}>{fmt(stats.pending)} €</div>
            <div style={{ color:C.textSub, fontSize:11, marginTop:2 }}>En attente</div>
          </div>
          <div style={{ background:"rgba(255,255,255,0.04)", borderRadius:12, padding:"14px 12px" }}>
            <div style={{ fontSize:20, marginBottom:6 }}>📊</div>
            <div style={{ fontWeight:800, color:C.violet, fontSize:18 }}>{fmt(stats.last30days.volume)} €</div>
            <div style={{ color:C.textSub, fontSize:11, marginTop:2 }}>Volume 30 jours · <strong style={{ color:C.text }}>{stats.last30days.count}</strong> prestations</div>
          </div>
          <div style={{ background:"rgba(240,180,41,0.08)", border:"1px solid rgba(240,180,41,0.2)", borderRadius:12, padding:"14px 12px" }}>
            <div style={{ fontSize:20, marginBottom:6 }}>💰</div>
            <div style={{ fontWeight:800, color:"#F0B429", fontSize:18 }}>{fmt(stats.last30days.commission)} €</div>
            <div style={{ color:C.textSub, fontSize:11, marginTop:2 }}>Commission ALANE (20%)</div>
          </div>
        </div>
      )}
    </div>
  );
}

export function BOExportCSV({ d }) {
  const [exporting, setExporting] = useState(false);
  const doExport = async () => {
    setExporting(true);
    try {
      const r = await boFetch({ action:"list" });
      const users = await r.json();
      // L'IBAN complet ne figure plus dans l'export : un fichier de coordonnées
      // bancaires posé sur un poste de travail est le pire endroit où elles
      // puissent se trouver. Les quatre derniers caractères suffisent à
      // rapprocher une ligne d'un compte ; la valeur complète se consulte fiche
      // par fiche, et cette consultation est tracée.
      const rows = [["ID","Prénom","Nom","Email","Rôle","Statut","Date naissance","Téléphone","IBAN (4 derniers)","Type compte","Société","Créé le"]];
      (Array.isArray(users) ? users : []).forEach(u => {
        rows.push([u.id,u.prenom||"",u.nom||"",u.email||"",u.role||"",u.status||"",u.date_naissance||"",u.telephone||"",u.rib_fin?`••••${u.rib_fin}`:"",u.type_compte||"",u.societe_nom||"",u.created_at?.slice(0,10)||""]);
      });
      const csv = rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
      const blob = new Blob(["﻿"+csv], { type:"text/csv;charset=utf-8;" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href = url; a.download = `alane-comptes-${new Date().toISOString().slice(0,10)}.csv`;
      a.click(); URL.revokeObjectURL(url);
      // Journaliser l'export (piste d'audit — contient des données sensibles IBAN/KBIS)
      boFetch({ action:"bo_log_export", details:{ type:"csv_comptes", count:(Array.isArray(users)?users.length:0) } }).catch(()=>{});
    } catch (e) { console.error("[BO] export des comptes échoué :", e.message); }
    setExporting(false);
  };
  return (
    <button onClick={doExport} disabled={exporting} style={{ flex:1, padding:"13px", borderRadius:r, border:`1px solid ${C.border}`, background:"#0D1B3E", color:C.text, fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit", opacity:exporting?0.7:1 }}>
      {exporting?"⏳ Export…":"📊 Export CSV"}
    </button>
  );
}

export function BOExportMissions() {
  const [exporting, setExporting] = useState(false);
  const doExport = async () => {
    setExporting(true);
    try {
      const r = await boFetch({ action: "list_missions_export" });
      const prestations = await r.json();
      const COMMISSION = 0.20;
      const rows = [["ID","Date création","Date prestation","Secteur","Métier","Heures","Tarif/h (€)","Montant TTC (€)","Commission ALANE (€)","Net prestataire (€)","Statut","Stripe ID"]];
      (Array.isArray(prestations) ? prestations : []).forEach(m => {
        const montant = Number(m.montant_total) || 0;
        const comm    = Math.round(montant * COMMISSION * 100) / 100;
        const net     = Math.round((montant - comm) * 100) / 100;
        rows.push([m.id, m.created_at?.slice(0,10)||"", m.date||"", m.sector||"", m.metier||"", m.hours||"", m.tarif_horaire||"", montant, comm, net, m.status||"", m.stripe_payment_intent||""]);
      });
      const csv = rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
      const blob = new Blob(["﻿"+csv], { type:"text/csv;charset=utf-8;" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href = url; a.download = `alane-prestations-comptable-${new Date().toISOString().slice(0,10)}.csv`;
      a.click(); URL.revokeObjectURL(url);
    } catch (e) { console.error("[BO] export comptable échoué :", e.message); }
    setExporting(false);
  };
  return (
    <button onClick={doExport} disabled={exporting} style={{ flex:1, padding:"13px", borderRadius:r, border:`1px solid ${C.border}`, background:"#0D1B3E", color:C.text, fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit", opacity:exporting?0.7:1 }}>
      {exporting ? "⏳ Export…" : "🧾 Export comptable"}
    </button>
  );
}

export function BOExportPDF({ d }) {
  const doPDF = () => {
    const lines = [
      "RAPPORT FINANCIER ALANE",
      `Généré le : ${new Date().toLocaleDateString("fr-FR")}`,
      "",
      "── UTILISATEURS ──",
      `Clients : ${d.users?.clients || 0}`,
      `Prestataires : ${d.users?.prestataires || 0}`,
      `Total : ${d.users?.total || 0}`,
      `En attente validation : ${d.users?.pending || 0}`,
      "",
      "── MISSIONS ──",
      `Total : ${d.missions?.total || 0}`,
      `Ouvertes : ${d.missions?.open || 0}`,
      `Assignées : ${d.missions?.assigned || 0}`,
      `Terminées : ${d.missions?.terminees || 0}`,
      `Taux completion : ${d.missions?.tauxCompletion || 0}%`,
      "",
      "── FINANCE ──",
      `CA Total (prestations terminées) : ${d.finance?.caTotal || 0} €`,
      "",
      "── TICKETS SUPPORT ──",
      `Ouverts : ${d.tickets?.open || 0}`,
      `Total : ${d.tickets?.total || 0}`,
    ];
    const blob = new Blob([lines.join("\n")], { type:"text/plain;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = `alane-rapport-${new Date().toISOString().slice(0,10)}.txt`;
    a.click(); URL.revokeObjectURL(url);
  };
  return (
    <button onClick={doPDF} style={{ flex:1, padding:"13px", borderRadius:r, border:"none", background:`linear-gradient(135deg,${C.violet},${C.indigo})`, color:C.white, fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
      📄 Rapport
    </button>
  );
}

export function EmailTestButton() {
  const [status, setStatus] = useState("idle"); // idle | sending | ok | error
  const send = async () => {
    setStatus("sending");
    try {
      const r = await boFetch({ action:"send_test_email" });
      const j = await r.json();
      setStatus(j.success ? "ok" : "error");
    } catch { setStatus("error"); }
    setTimeout(()=>setStatus("idle"), 4000);
  };
  return (
    <button onClick={send} disabled={status==="sending"} style={{ padding:"10px 20px", borderRadius:r, border:"none", background:status==="ok"?C.success:status==="error"?"#E74C3C":C.violet, color:"#fff", fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit", opacity:status==="sending"?0.7:1 }}>
      {status==="sending"?"Envoi…":status==="ok"?"✅ Envoyé !":status==="error"?"❌ Erreur":"Envoyer email test"}
    </button>
  );
}

function ResetOnboardingButton() {
  const [done, setDone] = useState(false);
  const handle = () => {
    try { const keys = Object.keys(localStorage).filter(k => k.startsWith("alane_onboarded")); keys.forEach(k => localStorage.removeItem(k)); } catch(e) {}
    setDone(true);
    setTimeout(() => setDone(false), 3000);
  };
  return (
    <button onClick={handle} style={{ padding:"9px 16px", borderRadius:r, border:`1px solid ${done ? C.success : C.border}`, background:done ? `${C.success}18` : "transparent", color:done ? C.success : C.textSub, fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}>
      {done ? "✅ Tutoriel réinitialisé — retourne à l'accueil" : "🔄 Réinitialiser le tutoriel"}
    </button>
  );
}

export function BOTest({ onNavigate }) {
  const MOCK_P = {
    id:"bo-test-001", name:"Jean Demo", jobTitle:"Agent de démonstration", role:"Agent de démonstration",
    avatar:"🧪", color:C.violet, rating:4.8, reviews:42, hourlyRate:"20 €/h HT", rateNum:20, tarifNet:15,
    available:true, sector:"logistique", skills:["Test","Démo","Présentation"], experience:"5 ans",
    distance:"0,5 km", responseTime:"~2 min", prestations:42, bio:"Prestataire fictif pour les tests BO.",
  };

  const clientScreens = [
    { id:"home",              label:"Accueil client",          icon:"🏠" },
    { id:"catalogue",         label:"Catalogue secteurs",      icon:"🗂️" },
    { id:"search_filters",    label:"Recherche / filtres",     icon:"🔍" },
    { id:"dashboard",         label:"Dashboard client",        icon:"📊" },
    { id:"mission_history",   label:"Historique prestations",     icon:"📋" },
    { id:"cashback",          label:"Wallet cashback",         icon:"💰" },
    { id:"notifications",     label:"Notifications",           icon:"🔔" },
    { id:"favorites",         label:"Favoris",                 icon:"❤️" },
    { id:"mission_request",   label:"Créer une prestation",       icon:"➕" },
    { id:"team_booking",      label:"Réservation équipe",      icon:"👥" },
    { id:"settings",          label:"Paramètres",              icon:"⚙️" },
  ];

  const clientFlowScreens = [
    { id:"profile",     label:"Profil prestataire",   icon:"👤", data:MOCK_P },
    { id:"cv",          label:"Parcours prestataire",        icon:"📄", data:MOCK_P },
    { id:"booking",     label:"Réservation",           icon:"📅", data:MOCK_P },
    { id:"contract",    label:"Contrat",               icon:"✍️", data:MOCK_P },
    { id:"tracking",    label:"Suivi prestation",         icon:"📍", data:MOCK_P },
    { id:"validation",  label:"Validation prestation",    icon:"✅", data:MOCK_P },
    { id:"rating",      label:"Noter le prestataire",  icon:"⭐", data:MOCK_P },
    { id:"cancellation",label:"Annulation",            icon:"❌", data:MOCK_P },
    { id:"invoice",     label:"Facture",               icon:"🧾", data:MOCK_P },
    { id:"payslip",     label:"Facture prestataire",   icon:"🧾", data:MOCK_P },
  ];

  const prestaScreens = [
    { id:"p_home",              label:"Accueil prestataire",  icon:"🏠" },
    { id:"p_missions",          label:"Prestations disponibles", icon:"📦" },
    { id:"p_dashboard",         label:"Dashboard presta",     icon:"📊" },
    { id:"calendar",            label:"Calendrier",           icon:"📅" },
    { id:"abonnement_presta",   label:"Abonnement",           icon:"💳" },
    { id:"doc_upload",          label:"Documents",            icon:"📎" },
    { id:"presta_profile_edit", label:"Modifier profil",      icon:"✏️" },
  ];

  const sharedScreens = [
    { id:"faq",             label:"FAQ",                  icon:"❓" },
    { id:"legal",           label:"Mentions légales",     icon:"📜" },
    { id:"contact_support", label:"Support",              icon:"🎧" },
    { id:"referral",        label:"Parrainage",           icon:"🎁" },
    { id:"abonnement_presta",label:"Abonnement presta",  icon:"💎" },
  ];

  const NavBtn = ({ s, role }) => (
    <button onClick={()=>onNavigate(s.id, role, s.data||null)} style={{
      display:"flex", alignItems:"center", gap:8, padding:"10px 12px",
      background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:10,
      color:C.text, fontSize:12, cursor:"pointer", fontFamily:"inherit",
      fontWeight:500, textAlign:"left", width:"100%",
    }}>
      <span style={{ fontSize:15 }}>{s.icon}</span>
      <span style={{ flex:1 }}>{s.label}</span>
      <span style={{ fontSize:10, color:C.textMuted, fontFamily:"monospace" }}>{s.id} →</span>
    </button>
  );

  const Section = ({ title, color, screens, role, note }) => (
    <div style={{ marginBottom:20 }}>
      <div style={{ fontWeight:700, fontSize:12, color, marginBottom:6, display:"flex", alignItems:"center", gap:6, textTransform:"uppercase", letterSpacing:0.8 }}>
        <div style={{ width:3, height:12, background:color, borderRadius:2 }} />
        {title}
        {note && <span style={{ fontSize:10, color:C.textMuted, fontWeight:400, textTransform:"none", letterSpacing:0 }}>— {note}</span>}
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
        {screens.map(s => <NavBtn key={s.id+s.label} s={s} role={role} />)}
      </div>
    </div>
  );

  return (
    <div>
      <div style={{ background:`${C.violet}15`, border:`1px solid ${C.violet}30`, borderRadius:12, padding:"12px 14px", marginBottom:18 }}>
        <div style={{ fontWeight:700, color:C.violet, fontSize:13, marginBottom:4 }}>🧪 Mode test</div>
        <div style={{ fontSize:12, color:C.textSub, lineHeight:1.5 }}>
          Navigue vers n'importe quel écran sans compte. Les écrans du flux utilisent un prestataire fictif "Jean Demo".
        </div>
      </div>

      <Section title="Écrans client — navigation" color="#F0B429" screens={clientScreens} role="client" />
      <Section title="Flux client — avec prestataire" color="#F0B429" screens={clientFlowScreens} role="client" note="prestataire fictif injecté" />
      <Section title="Écrans prestataire" color={C.violet} screens={prestaScreens} role="prestataire" />
      <Section title="Écrans partagés" color={C.success} screens={sharedScreens} role="client" />

      <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"16px", marginTop:4 }}>
        <div style={{ fontWeight:700, color:C.text, fontSize:13, marginBottom:6 }}>📧 Test email</div>
        <p style={{ color:C.textSub, fontSize:12, margin:"0 0 12px" }}>Envoie un email test à direction@alane.fr pour vérifier Resend.</p>
        <EmailTestButton />
      </div>

      <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"16px", marginTop:12 }}>
        <div style={{ fontWeight:700, color:C.text, fontSize:13, marginBottom:6 }}>🎓 Tutoriel first-login</div>
        <p style={{ color:C.textSub, fontSize:12, margin:"0 0 12px" }}>Réinitialise le tutoriel pour qu'il se relance au prochain accès à l'accueil (efface la clé localStorage du navigateur actuel).</p>
        <ResetOnboardingButton />
      </div>

    </div>
  );
}

export function BOLogs() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterAction, setFilterAction] = useState("all");
  const [search, setSearch] = useState("");
  useEffect(()=>{
    let token = ""; try { token = sessionStorage.getItem("bo_token") || ""; } catch(e) {}
    fetch("/api/bo-action", {
      method:"POST",
      headers:{"Content-Type":"application/json","Authorization":`Bearer ${token}`},
      body: JSON.stringify({ action:"list_logs" }),
    }).then(r=>r.json()).then(d=>{ setLogs(Array.isArray(d)?d:[]); setLoading(false); }).catch(()=>setLoading(false));
  },[]);
  const ACTION_LABELS = { approve:"✅ Approuvé", reject:"❌ Refusé", delete:"🗑️ Supprimé" };
  const ACTION_COLORS = { approve:C.success, reject:"#F25E5E", delete:"#E67E22" };
  const filtered = logs.filter(l=>{
    if(filterAction !== "all" && l.action !== filterAction) return false;
    if(search && !(l.target_email||"").toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });
  return (
    <div>
      <h3 style={{ color:C.text, fontSize:16, fontWeight:700, margin:"0 0 12px" }}>📋 Journal des actions BO</h3>
      <div style={{ display:"flex", gap:8, marginBottom:14 }}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Rechercher un email…" style={{ flex:1, padding:"8px 12px", borderRadius:8, border:`1px solid ${C.border}`, background:"#0D1B3E", color:C.text, fontSize:12, fontFamily:"inherit", outline:"none" }} />
        <select value={filterAction} onChange={e=>setFilterAction(e.target.value)} style={{ padding:"8px 10px", borderRadius:8, border:`1px solid ${C.border}`, background:"#0D1B3E", color:C.text, fontSize:12, fontFamily:"inherit" }}>
          <option value="all">Toutes</option>
          <option value="approve">Approuvés</option>
          <option value="reject">Refusés</option>
          <option value="delete">Supprimés</option>
        </select>
      </div>
      {loading ? <div style={{ color:C.textMuted, fontSize:13 }}>Chargement…</div> :
      filtered.length === 0 ? <div style={{ color:C.textMuted, fontSize:13 }}>Aucune action trouvée.</div> :
      filtered.map(l=>(
        <div key={l.id} style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:10, padding:"10px 14px", marginBottom:8, display:"flex", alignItems:"center", gap:12 }}>
          <div style={{ width:8, height:8, borderRadius:"50%", background:ACTION_COLORS[l.action]||C.textMuted, flexShrink:0 }} />
          <div style={{ flex:1 }}>
            <div style={{ color:C.text, fontSize:13, fontWeight:600 }}>{ACTION_LABELS[l.action]||l.action}</div>
            <div style={{ color:C.textMuted, fontSize:11, marginTop:2 }}>{l.target_email||l.target_id||"—"}{l.reason?` · ${l.reason}`:""}</div>
          </div>
          <div style={{ color:C.textMuted, fontSize:11, flexShrink:0 }}>{l.created_at?new Date(l.created_at).toLocaleString("fr-FR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}):"—"}</div>
        </div>
      ))}
    </div>
  );
}


export function BOSettingsTab() {
  // All hooks at top — no early returns before this block
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState({});
  const [saved, setSaved]     = useState({});
  const [localPl,  setLocalPl]  = useState({ free:2, premium:10, elite:999 });
  const [localSp,  setLocalSp]  = useState({ premium:{ monthly:29, yearly:290 }, elite:{ monthly:79, yearly:790 } });
  const [localUs,  setLocalUs]  = useState("5");
  const [localFs,  setLocalFs]  = useState({ single:"4.90", range:"2.90", urgent:"9.90" });
  const [localDs,  setLocalDs]  = useState([]);
  // Ouverture forcée d'un secteur sous le seuil, et seuil lui-même (CGPS n/a —
  // règle produit). Voir api/_secteurs.js pour l'ordre de priorité.
  const [localFo,  setLocalFo]  = useState([]);
  const [localSeuil, setLocalSeuil] = useState("20");
  const [localCbr, setLocalCbr] = useState([{ id:"standard",min:0,max:2,rate:"0.5" },{ id:"silver",min:3,max:5,rate:"0.75" },{ id:"gold",min:6,max:9,rate:"1" },{ id:"platinum",min:10,max:999,rate:"1.5" }]);
  const [launchPhase, setLaunchPhase] = useState(true);
  const [sectorCounts, setSectorCounts] = useState({});

  useEffect(() => {
    boFetch({ action: "get_settings" }).then(r => r.json()).then(s => {
      if (s.plan_limits)             setLocalPl(s.plan_limits);
      if (s.subscription_prices)     setLocalSp(s.subscription_prices);
      if (s.urgency_surcharge != null) setLocalUs(String(s.urgency_surcharge));
      if (s.frais_service) setLocalFs({ single: String(s.frais_service.single ?? "4.90"), range: String(s.frais_service.range ?? "2.90"), urgent: String(s.frais_service.urgent ?? "9.90") });
      if (s.disabled_sectors)        setLocalDs(s.disabled_sectors);
      if (s.forced_open_sectors)     setLocalFo(s.forced_open_sectors);
      if (s.sector_min_prestataires != null) setLocalSeuil(String(s.sector_min_prestataires));
      // 2 décimales obligatoires : le palier silver vaut 0,75 %, qu'un arrondi à
      // une décimale transformait en 0,8 % à l'affichage — puis en base au premier
      // enregistrement, soit 0,8 % réellement crédité au client.
      if (s.cashback_rates)          setLocalCbr(s.cashback_rates.map(t => ({ ...t, rate: String(Math.round(t.rate * 10000) / 100) })));
      if (s.launch_phase != null)    setLaunchPhase(Boolean(s.launch_phase));
      setLoading(false);
    }).catch(() => setLoading(false));
    // Charger les compteurs par secteur
    fetch("/api/missions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "get_sector_status" }),
    }).then(r => r.json()).then(d => {
      if (d && typeof d === "object" && !d.error) setSectorCounts(d);
    }).catch(() => {});
  }, []);

  // `bouton` permet à un seul bouton d'enregistrer plusieurs clés : c'est lui
  // qui porte l'état « … » puis « ✓ Sauvé », pas la clé enregistrée.
  const save = async (key, value, bouton = key) => {
    setSaving(p => ({ ...p, [bouton]: true }));
    const r = await boFetch({ action: "save_settings", key, value });
    const j = await r.json();
    setSaving(p => ({ ...p, [bouton]: false }));
    if (j.ok) { setSaved(p => ({ ...p, [bouton]: true })); setTimeout(() => setSaved(p => ({ ...p, [bouton]: false })), 2000); }
    else showToast("Erreur : " + (j.error || "inconnue"));
    return !!j.ok;
  };

  const SectionTitle = ({ children }) => (
    <div style={{ fontWeight:800, color:C.text, fontSize:14, margin:"20px 0 10px", paddingBottom:6, borderBottom:`1px solid ${C.border}` }}>{children}</div>
  );
  const SaveBtn = ({ k, onClick }) => (
    <button onClick={onClick} disabled={saving[k]} style={{ background:saved[k]?C.success:C.violet, border:"none", color:"#fff", borderRadius:8, padding:"7px 14px", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit", minWidth:70, transition:"background 0.2s" }}>
      {saving[k] ? "…" : saved[k] ? "✓ Sauvé" : "Sauvegarder"}
    </button>
  );

  if (loading) return <div style={{ color:C.textSub, fontSize:13, padding:"30px 0", textAlign:"center" }}>Chargement des réglages…</div>;

  return (
    <div style={{ paddingBottom:40 }}>

      {/* ── Plans & Limites ── */}
      <SectionTitle>📦 Plans & Limites prestations/mois</SectionTitle>
      <div style={{ background:"#0D1B3E", borderRadius:12, padding:16, marginBottom:8 }}>
        {[["free","🆓 Gratuit"],["premium","⭐ Premium"],["elite","👑 Elite"]].map(([plan, label]) => (
          <div key={plan} style={{ display:"flex", alignItems:"center", gap:12, marginBottom:10 }}>
            <span style={{ color:C.text, fontSize:13, fontWeight:600, width:120 }}>{label}</span>
            <input type="number" min={1} max={9999} value={localPl[plan]} onChange={e => setLocalPl(p => ({ ...p, [plan]: Number(e.target.value) }))}
              style={{ width:80, padding:"7px 10px", borderRadius:8, border:`1px solid ${C.border}`, background:"rgba(255,255,255,0.06)", color:C.text, fontSize:13, fontFamily:"inherit", textAlign:"center" }} />
            <span style={{ color:C.textSub, fontSize:12 }}>prestations/mois</span>
          </div>
        ))}
        <SaveBtn k="plan_limits" onClick={() => save("plan_limits", localPl)} />
      </div>

      {/* ── Prix abonnements ── */}
      <SectionTitle>💳 Prix des abonnements (€)</SectionTitle>
      <div style={{ background:"#0D1B3E", borderRadius:12, padding:16, marginBottom:8 }}>
        {[["premium","⭐ Premium"],["elite","👑 Elite"]].map(([plan, label]) => (
          <div key={plan} style={{ marginBottom:14 }}>
            <div style={{ color:C.text, fontSize:13, fontWeight:600, marginBottom:8 }}>{label}</div>
            <div style={{ display:"flex", gap:12 }}>
              {[["monthly","Mensuel"],["yearly","Annuel"]].map(([period, plabel]) => (
                <div key={period} style={{ flex:1 }}>
                  <div style={{ color:C.textSub, fontSize:11, marginBottom:4 }}>{plabel}</div>
                  <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                    <input type="text" inputMode="decimal" value={localSp[plan]?.[period] ?? ""} onChange={e => setLocalSp(p => ({ ...p, [plan]: { ...p[plan], [period]: e.target.value } }))}
                      style={{ width:80, padding:"7px 10px", borderRadius:8, border:`1px solid ${C.border}`, background:"rgba(255,255,255,0.06)", color:C.text, fontSize:13, fontFamily:"inherit", textAlign:"center" }} />
                    <span style={{ color:C.textSub, fontSize:12 }}>€</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
        <SaveBtn k="subscription_prices" onClick={() => {
          const parsed = Object.fromEntries(Object.entries(localSp).map(([plan, periods]) => [
            plan, Object.fromEntries(Object.entries(periods).map(([period, v]) => [period, parseFloat(String(v).replace(",", ".")) || 0]))
          ]));
          save("subscription_prices", parsed);
        }} />
      </div>

      {/* ── Secteurs ── */}
      <SectionTitle>🗂️ Secteurs d&apos;activité</SectionTitle>
      <div style={{ background:"#0D1B3E", borderRadius:12, padding:16, marginBottom:8 }}>
        <div style={{ color:C.textSub, fontSize:12, marginBottom:14, lineHeight:1.6 }}>
          Un secteur s&apos;ouvre automatiquement dès qu&apos;il compte assez de prestataires
          approuvés et activés. Un secteur ouvert sans prestataire disponible est une promesse
          qu&apos;on ne peut pas tenir : le client commande, personne n&apos;accepte, il est
          remboursé et ne revient pas.
        </div>

        {/* Seuil */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, padding:"10px 12px", background:"rgba(255,255,255,0.04)", borderRadius:10, marginBottom:14 }}>
          <div style={{ flex:1 }}>
            <div style={{ color:C.text, fontSize:13, fontWeight:700 }}>Seuil d&apos;ouverture automatique</div>
            <div style={{ color:C.textMuted, fontSize:11, marginTop:2 }}>Nombre de prestataires requis. 0 = tous les secteurs ouverts.</div>
          </div>
          <input type="number" min="0" value={localSeuil} onChange={e => setLocalSeuil(e.target.value.replace(/[^0-9]/g, ""))}
            style={{ width:70, padding:"8px 10px", borderRadius:8, border:`1px solid ${C.border}`, background:"#0A1628", color:C.text, fontSize:14, fontWeight:700, textAlign:"center", fontFamily:"inherit" }} />
          <SaveBtn k="sector_min_prestataires" onClick={() => save("sector_min_prestataires", Number(localSeuil) || 0)} />
        </div>

        {/* État par secteur */}
        {Object.entries(SECTOR_LABELS).map(([id, label]) => {
          const ferme  = localDs.includes(id);
          const force  = localFo.includes(id);
          const nb     = sectorCounts[id]?.count ?? 0;
          const seuil  = Number(localSeuil) || 0;
          const atteint = nb >= seuil;
          const ouvert = !ferme && (force || atteint);

          const etiquette = ferme ? "Fermé (décision manuelle)"
                          : force ? `Ouvert de force — ${nb} prestataire${nb > 1 ? "s" : ""}`
                          : atteint ? `Ouvert — ${nb} prestataire${nb > 1 ? "s" : ""}`
                          : `Fermé — ${nb}/${seuil} prestataire${seuil > 1 ? "s" : ""}`;
          const couleur = ferme ? "#F25E5E" : ouvert ? C.success : C.accentGold;

          return (
            <div key={id} style={{ padding:"10px 0", borderBottom:`1px solid ${C.grayLight}` }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:6 }}>
                <span style={{ color: ouvert ? C.text : C.textMuted, fontSize:13, fontWeight:700 }}>
                  {SECTORS.find(sx => sx.id === id)?.icon} {label}
                </span>
                <span style={{ color:couleur, fontSize:11, fontWeight:700 }}>{etiquette}</span>
              </div>
              <div style={{ display:"flex", gap:16, alignItems:"center" }}>
                <label style={{ display:"flex", alignItems:"center", gap:6, cursor:"pointer" }}>
                  <input type="checkbox" checked={ferme}
                    onChange={() => setLocalDs(prev => ferme ? prev.filter(x => x !== id) : [...prev, id])} />
                  <span style={{ color:C.textSub, fontSize:11 }}>Fermer d&apos;autorité</span>
                </label>
                <label style={{ display:"flex", alignItems:"center", gap:6, cursor: ferme ? "not-allowed" : "pointer", opacity: ferme ? 0.4 : 1 }}>
                  <input type="checkbox" checked={force} disabled={ferme}
                    onChange={() => setLocalFo(prev => force ? prev.filter(x => x !== id) : [...prev, id])} />
                  <span style={{ color:C.textSub, fontSize:11 }}>Ouvrir malgré le seuil</span>
                </label>
              </div>
            </div>
          );
        })}

        <div style={{ color:C.textMuted, fontSize:11, lineHeight:1.6, margin:"12px 0" }}>
          « Fermer d&apos;autorité » l&apos;emporte sur tout le reste. « Ouvrir malgré le seuil »
          sert au démarrage : sans lui, il faudrait vingt prestataires pour accepter la première
          commande, et une première commande pour attirer des prestataires.
        </div>

        {/* Un seul bouton pour les deux réglages.
            Il y en avait deux, côte à côte, tous les deux libellés
            « Sauvegarder » : l'un enregistrait les fermetures d'autorité,
            l'autre les ouvertures forcées, et rien ne disait lequel. Cocher
            « Ouvrir malgré le seuil » puis cliquer le bouton de gauche
            enregistrait l'AUTRE réglage — la coche était perdue en silence, et
            le secteur restait invisible aux clients sans qu'on sache pourquoi.

            Les deux clés sont éditées par la même liste de cases : les séparer
            à l'enregistrement ne servait rien. */}
        <div style={{ display:"flex", gap:8 }}>
          <SaveBtn k="secteurs" onClick={async () => {
            // Le second enregistrement n'a lieu que si le premier a réussi :
            // une erreur suivie d'un « ✓ Sauvé » ferait croire que tout est
            // passé alors qu'un seul des deux réglages l'est.
            if (await save("disabled_sectors", localDs, "secteurs")) {
              await save("forced_open_sectors", localFo, "secteurs");
            }
          }} />
        </div>
        <div style={{ color:C.textMuted, fontSize:10, marginTop:8 }}>
          Une ouverture ou une fermeture prend effet immédiatement côté serveur. Seul le
          nombre de prestataires affiché est mis en cache 5 minutes, ainsi que l&apos;affichage
          côté client pendant une minute.
        </div>
      </div>

      {/* ── Frais de service & Urgence ── */}
      <SectionTitle>💶 Tarification plateforme</SectionTitle>
      <div style={{ background:"#0D1B3E", borderRadius:12, padding:16, marginBottom:8 }}>
        <div style={{ color:C.textSub, fontSize:11, marginBottom:12, lineHeight:1.5 }}>Frais de service facturés au client à chaque commande, en plus du tarif du prestataire.</div>
        {[
          { key:"single", label:"Commande standard" },
          { key:"range",  label:"Commande récurrente" },
          { key:"urgent", label:"Commande urgente" },
        ].map(({ key, label }) => (
          <div key={key} style={{ display:"flex", alignItems:"center", gap:12, marginBottom:10 }}>
            <span style={{ color:C.text, fontSize:13, fontWeight:600, width:180 }}>{label}</span>
            <input type="text" inputMode="decimal" value={localFs[key]} onChange={e => setLocalFs(p => ({ ...p, [key]: e.target.value }))}
              style={{ width:70, padding:"7px 10px", borderRadius:8, border:`1px solid ${C.border}`, background:"rgba(255,255,255,0.06)", color:C.text, fontSize:13, fontFamily:"inherit", textAlign:"center" }} />
            <span style={{ color:C.textSub, fontSize:12 }}>€</span>
          </div>
        ))}
        <div style={{ marginBottom:16 }}>
          <SaveBtn k="frais_service" onClick={() => {
            const toNum = v => parseFloat(String(v).replace(",", ".")) || 0;
            save("frais_service", { single: toNum(localFs.single), range: toNum(localFs.range), urgent: toNum(localFs.urgent) });
          }} />
        </div>
        <div style={{ borderTop:`1px solid ${C.border}`, paddingTop:14 }}>
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            <span style={{ color:C.text, fontSize:13, fontWeight:600, width:180 }}>Surcoût urgence</span>
            <input type="number" min={0} max={50} step={1} value={localUs} onChange={e => setLocalUs(e.target.value)}
              style={{ width:70, padding:"7px 10px", borderRadius:8, border:`1px solid ${C.border}`, background:"rgba(255,255,255,0.06)", color:C.text, fontSize:13, fontFamily:"inherit", textAlign:"center" }} />
            <span style={{ color:C.textSub, fontSize:12 }}>€/h</span>
            <SaveBtn k="urgency_surcharge" onClick={() => save("urgency_surcharge", Number(localUs))} />
          </div>
        </div>
      </div>

      {/* ── Ouverture secteurs ── */}
      <SectionTitle>🔓 Ouverture des secteurs aux clients</SectionTitle>
      <div style={{ background:"#0D1B3E", borderRadius:12, padding:16, marginBottom:8 }}>
        <div style={{ color:C.textSub, fontSize:12, marginBottom:12, lineHeight:1.5 }}>
          L'ouverture d'un secteur dépend uniquement des interrupteurs « Secteurs d'activité » ci-dessus.
          Un changement met jusqu'à 5 minutes à se propager aux clients.
        </div>
        <div style={{ borderTop:`1px solid ${C.border}`, paddingTop:12 }}>
          <div style={{ color:C.textSub, fontSize:11, marginBottom:8, fontWeight:600, textTransform:"uppercase", letterSpacing:.5 }}>État actuel des secteurs</div>
          {SECTORS.map(s => {
            const sc = sectorCounts[s.id];
            const count = sc?.count ?? 0;
            const isOpen = sc ? sc.open : !localDs.includes(s.id);
            return (
              <div key={s.id} style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
                <span style={{ fontSize:16, flexShrink:0 }}>{s.icon}</span>
                <span style={{ color:C.text, fontSize:12, fontWeight:600, width:110, flexShrink:0 }}>{s.label}</span>
                <div style={{ flex:1 }} />
                <span style={{ color:C.textSub, fontSize:11, fontWeight:700, textAlign:"right", flexShrink:0 }}>
                  {count} prestataire{count > 1 ? "s" : ""}
                </span>
                <span style={{ fontSize:11, fontWeight:700, color: isOpen ? "#4CAF8A" : "#F0B429", width:80, textAlign:"right", flexShrink:0 }}>{isOpen ? "✅ Ouvert" : "🔒 Fermé"}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Phase de lancement ── */}
      <SectionTitle>🚀 Phase de lancement</SectionTitle>
      <div style={{ background:"#0D1B3E", borderRadius:12, padding:16, marginBottom:8 }}>
        <div style={{ color:C.textSub, fontSize:12, marginBottom:12, lineHeight:1.5 }}>Active les badges "Offre de lancement" et la mention des 8 prestations gratuites sur toute la plateforme.</div>
        <div style={{ display:"flex", alignItems:"center", gap:16 }}>
          <button onClick={()=>setLaunchPhase(v=>!v)} style={{ width:48, height:28, borderRadius:99, border:"none", cursor:"pointer", background:launchPhase?"#4CC99B":"rgba(255,255,255,0.15)", transition:"background 0.2s", position:"relative" }}>
            <div style={{ position:"absolute", top:4, left:launchPhase?22:4, width:20, height:20, borderRadius:"50%", background:"#fff", transition:"left 0.2s" }} />
          </button>
          <span style={{ color:launchPhase?"#4CC99B":C.textSub, fontSize:13, fontWeight:600 }}>{launchPhase ? "Active" : "Désactivée"}</span>
          <SaveBtn k="launch_phase" onClick={() => save("launch_phase", launchPhase)} />
        </div>
      </div>

      {/* ── Cashback ── */}
      <SectionTitle>🎁 Taux de cashback par palier</SectionTitle>
      <div style={{ background:"#0D1B3E", borderRadius:12, padding:16, marginBottom:8 }}>
        {localCbr.map((tier, i) => (
          <div key={tier.id} style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
            <span style={{ color:C.text, fontSize:13, fontWeight:600, width:90 }}>{tier.id}</span>
            <span style={{ color:C.textSub, fontSize:11, width:80 }}>{tier.min}–{tier.max === 999 ? "∞" : tier.max} prestations</span>
            <input type="number" min={0} max={100} step={0.05} value={tier.rate} onChange={e => setLocalCbr(prev => prev.map((t, j) => j === i ? { ...t, rate: e.target.value } : t))}
              style={{ width:70, padding:"7px 10px", borderRadius:8, border:`1px solid ${C.border}`, background:"rgba(255,255,255,0.06)", color:C.text, fontSize:13, fontFamily:"inherit", textAlign:"center" }} />
            <span style={{ color:C.textSub, fontSize:12 }}>%</span>
          </div>
        ))}
        <SaveBtn k="cashback_rates" onClick={() => save("cashback_rates", localCbr.map(t => ({ ...t, rate: Number(t.rate) / 100 })))} />
      </div>

    </div>
  );
}

export function BOResetMonthly() {
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState(null);

  const handleReset = async () => {
    if (!await showConfirm("Remettre les compteurs de prestations à 0 pour tous les prestataires ?")) return;
    setLoading(true); setResult(null);
    try {
      let token = ""; try { token = sessionStorage.getItem("bo_token") || ""; } catch(e) {}
      const r = await fetch("/api/cron-reset-monthly", {
        headers: { "Authorization": `Bearer ${token}` },
      });
      const j = await r.json();
      setResult(j.success ? `✅ Compteurs remis à 0 (${j.downgrades} abonnement(s) expiré(s) downgradé(s))` : `❌ Erreur : ${j.error}`);
    } catch { setResult("❌ Erreur réseau"); }
    setLoading(false);
  };

  return (
    <div style={{ background:"#0D1B3E", borderRadius:12, padding:"12px 16px", marginBottom:10, display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, border:`1px solid ${C.border}` }}>
      <div>
        <div style={{ fontWeight:700, color:C.text, fontSize:13 }}>🔄 Reset compteurs mensuels</div>
        <div style={{ color:C.textSub, fontSize:11, marginTop:2 }}>Automatique le 1er du mois · Déclencher manuellement si besoin</div>
        {result && <div style={{ fontSize:12, marginTop:4, color: result.startsWith("✅") ? C.success : C.danger }}>{result}</div>}
      </div>
      <button onClick={handleReset} disabled={loading} style={{ background:"rgba(124,111,224,0.15)", border:`1px solid ${C.violet}`, color:C.violet, borderRadius:8, padding:"7px 14px", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit", whiteSpace:"nowrap" }}>
        {loading ? "…" : "Réinitialiser"}
      </button>
    </div>
  );
}

export function BODocuments() {
  const DOC_ICON = DOC_ICONS;
  const DOC_LABEL = DOC_LABELS;
  const [docs, setDocs]       = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter]   = useState("all");   // all | pending | verified
  const [typeFilter, setType] = useState("all");
  const [preview, setPreview] = useState(null);
  const [verifying, setVerifying] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/bo-action", { method:"POST", headers:{"Content-Type":"application/json","Authorization":`Bearer ${sessionStorage.getItem("bo_token")||""}`}, body:JSON.stringify({ action:"list_all_docs" }) });
      const data = await r.json();
      setDocs(Array.isArray(data) ? data : []);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const handleVerify = async (doc) => {
    const validite = await demanderValidite(doc.type);
    if (!validite.ok) return;
    setVerifying(doc.id);
    try {
      // Même précaution que dans l'onglet Comptes : l'écran affichait « vérifié »
      // sans regarder si le serveur avait accepté.
      const r = await fetch("/api/bo-action", { method:"POST", headers:{"Content-Type":"application/json","Authorization":`Bearer ${sessionStorage.getItem("bo_token")||""}`}, body:JSON.stringify({ action:"verify_doc", profileId:doc.prestataire_id, docId:doc.id, expiresAt: validite.expiresAt }) });
      const j = await r.json().catch(()=>({}));
      if (r.ok) setDocs(prev => prev.map(d => d.id===doc.id ? {...d, verified:true} : d));
      else showToast(j.error || `Erreur ${r.status}`, "error");
    } catch(e) { showToast(e?.message || "Erreur réseau", "error"); }
    finally { setVerifying(null); }
  };

  const displayed = docs.filter(d => {
    if (filter === "pending"  && d.verified)  return false;
    if (filter === "verified" && !d.verified) return false;
    if (typeFilter !== "all" && d.type !== typeFilter) return false;
    return true;
  });

  const types = [...new Set(docs.map(d => d.type))];
  const pendingCount = docs.filter(d => !d.verified).length;

  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16, gap:10, flexWrap:"wrap" }}>
        <div>
          <div style={{ fontWeight:800, fontSize:16, color:C.text }}>📂 Documents prestataires</div>
          <div style={{ fontSize:11, color:C.textSub, marginTop:2 }}>{docs.length} document{docs.length>1?"s":""} · {pendingCount} en attente de validation</div>
        </div>
        <button onClick={load} disabled={loading} style={{ fontSize:12, padding:"7px 14px", borderRadius:8, background:`${C.violet}15`, border:`1px solid ${C.violet}44`, color:C.violet, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
          {loading ? "Chargement…" : "🔄 Actualiser"}
        </button>
      </div>

      {/* Filtres */}
      <div style={{ display:"flex", gap:8, marginBottom:14, flexWrap:"wrap" }}>
        {["all","pending","verified"].map(f => (
          <button key={f} onClick={()=>setFilter(f)} style={{ fontSize:11, padding:"5px 12px", borderRadius:20, border:`1px solid ${filter===f?C.violet:C.border}`, background:filter===f?`${C.violet}20`:"transparent", color:filter===f?C.violet:C.textSub, fontWeight:filter===f?700:500, cursor:"pointer", fontFamily:"inherit" }}>
            {f==="all"?"Tous":f==="pending"?"⏳ En attente":"✅ Validés"}
          </button>
        ))}
        <select value={typeFilter} onChange={e=>setType(e.target.value)} style={{ fontSize:11, padding:"5px 10px", borderRadius:8, border:`1px solid ${C.border}`, background:"#112240", color:C.text, fontFamily:"inherit", cursor:"pointer" }}>
          <option value="all">Tous types</option>
          {types.map(t => <option key={t} value={t}>{DOC_LABEL[t]||t}</option>)}
        </select>
      </div>

      {loading && <div style={{ textAlign:"center", padding:30, color:C.textSub }}>Chargement…</div>}
      {!loading && displayed.length === 0 && <div style={{ textAlign:"center", padding:30, color:C.textSub }}>Aucun document{filter!=="all"?" dans ce filtre":""}</div>}

      {displayed.map(doc => {
        const isImg = doc.signedUrl && /\.(png|jpe?g|gif|webp)(\?|$)/i.test(doc.signedUrl);
        const name = [doc.prenom, doc.nom].filter(Boolean).join(" ") || doc.email || doc.prestataire_id?.slice(0,8);
        return (
          <div key={doc.id} style={{ background:"rgba(255,255,255,0.03)", border:`1px solid ${doc.verified?"rgba(34,197,94,0.2)":C.border}`, borderRadius:10, padding:"10px 14px", marginBottom:8, display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
            <span style={{ fontSize:22, flexShrink:0 }}>{DOC_ICON[doc.type]||"📄"}</span>
            <div style={{ flex:1, minWidth:120 }}>
              <div style={{ fontWeight:700, fontSize:13, color:C.text }}>{DOC_LABEL[doc.type]||doc.type}</div>
              <div style={{ fontSize:11, color:C.textSub, marginTop:2 }}>{name} · {new Date(doc.created_at).toLocaleDateString("fr-FR")}</div>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:6, flexShrink:0 }}>
              <span style={{ fontSize:10, fontWeight:700, color:doc.verified?C.success:C.accentGold }}>{doc.verified?"✅ Validé":"⏳ En attente"}</span>
              {doc.signedUrl && <>
                <button onClick={()=>setPreview({...doc, isImg, name})} style={{ fontSize:11, padding:"5px 10px", borderRadius:7, border:`1px solid ${C.violet}44`, background:`${C.violet}15`, color:C.violet, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
                  {isImg?"🖼 Voir":"📄 Voir"}
                </button>
                <a href={doc.signedUrl} download target="_blank" rel="noopener noreferrer" style={{ fontSize:11, padding:"5px 10px", borderRadius:7, border:`1px solid ${C.border}`, background:"rgba(255,255,255,0.05)", color:C.text, fontWeight:700, textDecoration:"none" }}>⬇ DL</a>
              </>}
              {!doc.verified && (
                <button onClick={()=>handleVerify(doc)} disabled={verifying===doc.id} style={{ fontSize:11, padding:"5px 10px", borderRadius:7, border:`1px solid ${C.success}44`, background:`${C.success}15`, color:C.success, fontWeight:700, cursor:"pointer", fontFamily:"inherit", opacity:verifying===doc.id?0.5:1 }}>
                  {verifying===doc.id?"…":"✓ Valider"}
                </button>
              )}
            </div>
          </div>
        );
      })}

      {/* Modal prévisualisation */}
      {preview && (
        <div onClick={()=>setPreview(null)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.9)", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", zIndex:9000, padding:16 }}>
          <div onClick={e=>e.stopPropagation()} style={{ background:"#0D1B3E", borderRadius:16, width:"100%", maxWidth:780, maxHeight:"92vh", display:"flex", flexDirection:"column", border:"1px solid rgba(255,255,255,0.1)" }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"12px 18px", borderBottom:"1px solid rgba(255,255,255,0.08)" }}>
              <div style={{ fontWeight:700, fontSize:14, color:C.text }}>{DOC_ICON[preview.type]||"📄"} {DOC_LABEL[preview.type]||preview.type} — {preview.name}</div>
              <div style={{ display:"flex", gap:8 }}>
                <a href={preview.signedUrl} download target="_blank" rel="noopener noreferrer" style={{ fontSize:11, padding:"5px 12px", borderRadius:8, border:`1px solid ${C.violet}44`, background:`${C.violet}15`, color:C.violet, fontWeight:700, textDecoration:"none" }}>⬇ Télécharger</a>
                <a href={preview.signedUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize:11, padding:"5px 12px", borderRadius:8, border:`1px solid ${C.border}`, color:C.text, fontWeight:700, textDecoration:"none" }}>↗ Ouvrir</a>
                <button onClick={()=>setPreview(null)} style={{ background:"rgba(255,255,255,0.08)", border:"none", color:"#fff", borderRadius:8, padding:"5px 12px", cursor:"pointer", fontSize:13, fontFamily:"inherit", fontWeight:700 }}>✕</button>
              </div>
            </div>
            <div style={{ flex:1, overflow:"auto", padding:8, minHeight:300 }}>
              {preview.isImg
                ? <img src={preview.signedUrl} alt={preview.name} style={{ maxWidth:"100%", maxHeight:"80vh", display:"block", margin:"0 auto", borderRadius:8 }} />
                : <div style={{ textAlign:"center", padding:40 }}>
                    <div style={{ fontSize:48, marginBottom:16 }}>📄</div>
                    <div style={{ color:"rgba(255,255,255,0.7)", fontSize:14, marginBottom:24 }}>Prévisualisation non disponible — ouvrez dans un nouvel onglet</div>
                    <div style={{ display:"flex", gap:10, justifyContent:"center", flexWrap:"wrap" }}>
                      <a href={preview.signedUrl} target="_blank" rel="noopener noreferrer" style={{ display:"inline-block", padding:"10px 20px", background:`${C.violet}22`, border:`1px solid ${C.violet}55`, color:C.violet, borderRadius:10, fontWeight:700, fontSize:13, textDecoration:"none" }}>↗ Ouvrir dans un nouvel onglet</a>
                      <a href={preview.signedUrl} download style={{ display:"inline-block", padding:"10px 20px", background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.15)", color:"#fff", borderRadius:10, fontWeight:700, fontSize:13, textDecoration:"none" }}>⬇ Télécharger</a>
                    </div>
                  </div>
              }
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function BOReminders() {
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState(null);

  const handleTrigger = async () => {
    setLoading(true); setResult(null);
    try {
      let token = ""; try { token = sessionStorage.getItem("bo_token") || ""; } catch(e) {}
      const r = await fetch("/api/cron-reset-monthly?action=reminders", {
        headers: { "Authorization": `Bearer ${token}` },
      });
      const j = await r.json();
      if (j.success) {
        const parts = [];
        if (j.versements)          parts.push(`${j.versements} virement(s) envoyé(s)`);
        if (j.inscriptions)        parts.push(`${j.inscriptions} inscription(s) signalée(s)`);
        if (j.reminders)           parts.push(`${j.reminders} rappel(s) J-1`);
        if (j.validationReminders) parts.push(`${j.validationReminders} relance(s) validation`);
        if (j.autoValidated)       parts.push(`${j.autoValidated} auto-validée(s)`);
        // « Aucun email à envoyer » laissait croire que le traitement ne fait
        // que des emails : on le lançait pour débloquer un virement et il
        // répondait à côté.
        setResult(`✅ ${parts.join(" · ") || "Rien à traiter — tout est à jour"}`);
      } else {
        setResult(`❌ Erreur : ${j.error||"inconnue"}`);
      }
    } catch { setResult("❌ Erreur réseau"); }
    setLoading(false);
  };

  return (
    <div style={{ background:"#0D1B3E", borderRadius:12, padding:"12px 16px", marginBottom:10, display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, border:`1px solid ${C.border}` }}>
      {/* Ce bouton s'appelait « Envoyer les relances » et disait ne faire que
          des rappels J-1. Il lance en réalité TOUT le traitement automatique —
          celui-là même qui passe toutes les deux heures. Le jour où le cron
          s'est arrêté, c'était le seul moyen de débloquer les virements, et
          personne ne pouvait le deviner sous ce nom. */}
      <div>
        <div style={{ fontWeight:700, color:C.text, fontSize:13 }}>🔄 Lancer le traitement automatique</div>
        <div style={{ color:C.textSub, fontSize:11, marginTop:2, lineHeight:1.5 }}>
          Le même passage que celui programmé toutes les deux heures : virements arrivés à
          échéance, auto-validation, clôture et remboursement des prestations sans prestataire,
          dénouement des litiges, alerte des inscriptions en attente, rappels J-1.
        </div>
        {result && <div style={{ fontSize:12, marginTop:4, color: result.startsWith("✅") ? C.success : C.danger }}>{result}</div>}
      </div>
      <button onClick={handleTrigger} disabled={loading} style={{ background:"rgba(240,180,41,0.15)", border:"1px solid rgba(240,180,41,0.5)", color:"#F0B429", borderRadius:8, padding:"7px 14px", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit", whiteSpace:"nowrap" }}>
        {loading ? "…" : "Lancer"}
      </button>
    </div>
  );
}

export function BOMissions() {
  const STATUS_LABELS = { open:"Ouverte", pending_acceptance:"En attente", assigned:"En cours", completed:"Terminée", closed:"Clôturée", rejected:"Refusée", refused:"Refusée", disputed:"En litige" };
  const STATUS_COLORS = { open:C.violet, pending_acceptance:"#F0B429", assigned:"#10D98F", completed:"#A29BFE", closed:C.textMuted, rejected:"#F25E5E", refused:"#F25E5E", disputed:"#F25E5E" };

  const [prestations, setMissions] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [filter, setFilter]     = useState("all");
  const [validating, setValidating] = useState(null);
  const [disputing, setDisputing] = useState(null);
  const [result, setResult]     = useState({});
  const [editingMission, setEditingMission] = useState(null);
  const [editMissionVals, setEditMissionVals] = useState({});
  const [reassignId, setReassignId] = useState(null);
  const [reassignEmail, setReassignEmail] = useState("");
  const [reassignReason, setReassignReason] = useState("");

  const load = async (status = filter) => {
    setLoading(true);
    try {
      const res = await boFetch({ action:"list_missions", status });
      const data = await res.json();
      setMissions(Array.isArray(data) ? data : []);
    } catch { setMissions([]); }
    setLoading(false);
  };

  useEffect(() => { load(filter); }, [filter]);

  const handleValidate = async (missionId, sansPointage = false) => {
    // Le montant facturé est calculé sur les heures prévues. Sans pointage, rien
    // ne prouve que la prestation a eu lieu : l'avertissement est explicite.
    const avertissement = sansPointage
      ? "⚠️ Le prestataire n'a JAMAIS signalé son arrivée ni démarré cette prestation.\n\n"
        + "Rien ne prouve qu'elle a eu lieu. En validant, vous facturez au client les heures prévues "
        + "et déclenchez le paiement du prestataire.\n\nConfirmez uniquement après vérification auprès des deux parties.\n\n"
      : "";
    if (!await showConfirm(avertissement + "Valider cette prestation manuellement ? Le cashback sera crédité et les deux parties notifiées.")) return;
    setValidating(missionId);
    try {
      const res = await boFetch({ action:"force_complete_mission", mission_id: missionId });
      const data = await res.json();
      if (data.success) {
        setResult(r => ({ ...r, [missionId]: `✅ Validée — ${data.montantTotal}€${data.cashback > 0 ? ` · cashback +${data.cashback}€` : ""}` }));
        setMissions(ms => ms.map(m => m.id === missionId ? { ...m, status:"completed" } : m));
      } else {
        setResult(r => ({ ...r, [missionId]: `❌ ${data.error}` }));
      }
    } catch { setResult(r => ({ ...r, [missionId]: "❌ Erreur réseau" })); }
    setValidating(null);
  };

  const handleCancel = async (missionId, withRefund) => {
    const reason = await showPrompt("Motif d'annulation (optionnel) :","Motif..."); if (reason === null) return;
    setDisputing(missionId + "_cancel");
    try {
      const res = await boFetch({ action:"cancel_mission", mission_id:missionId, refund:withRefund, reason });
      const data = await res.json();
      if (data.success) { setResult(r=>({...r,[missionId]:`🚫 Annulée${withRefund?" + remboursement initié":""}`})); setMissions(ms=>ms.map(m=>m.id===missionId?{...m,status:"cancelled"}:m)); }
      else setResult(r=>({...r,[missionId]:`❌ ${data.error}`}));
    } catch { setResult(r=>({...r,[missionId]:"❌ Erreur réseau"})); }
    setDisputing(null);
  };

  const handleReassign = async (missionId) => {
    if (!reassignEmail.trim()) return;
    setDisputing(missionId + "_reassign");
    try {
      const res = await boFetch({ action:"reassign_mission", mission_id:missionId, new_presta_email:reassignEmail.trim(), reason:reassignReason.trim()||undefined });
      const data = await res.json();
      if (data.success) { setResult(r=>({...r,[missionId]:`✅ Réassignée → ${data.new_presta_name}`})); setMissions(ms=>ms.map(m=>m.id===missionId?{...m,status:"assigned"}:m)); setReassignId(null); setReassignEmail(""); setReassignReason(""); }
      else setResult(r=>({...r,[missionId]:`❌ ${data.error}`}));
    } catch { setResult(r=>({...r,[missionId]:"❌ Erreur réseau"})); }
    setDisputing(null);
  };

  const handleUpdateMission = async (missionId) => {
    setDisputing(missionId + "_edit");
    try {
      const res = await boFetch({ action:"update_mission", mission_id:missionId, ...editMissionVals });
      const data = await res.json();
      if (data.success) { setResult(r=>({...r,[missionId]:"✅ Prestation mise à jour"})); setMissions(ms=>ms.map(m=>m.id===missionId?{...m,...editMissionVals}:m)); setEditingMission(null); setEditMissionVals({}); }
      else setResult(r=>({...r,[missionId]:`❌ ${data.error}`}));
    } catch { setResult(r=>({...r,[missionId]:"❌ Erreur réseau"})); }
    setDisputing(null);
  };

  const filtered = prestations;

  return (
    <div>
      <div style={{ fontWeight:800, color:C.text, fontSize:16, marginBottom:14 }}>📋 Gestion des prestations</div>

      {/* Filtres */}
      <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:16 }}>
        {["all","open","pending_acceptance","assigned","completed","disputed","closed"].map(s => (
          <button key={s} onClick={()=>setFilter(s)} style={{ padding:"6px 12px", borderRadius:8, border:`1px solid ${filter===s?C.violet:C.border}`, background:filter===s?`${C.violet}20`:"transparent", color:filter===s?C.violet:C.textSub, fontWeight:filter===s?700:500, fontSize:11, cursor:"pointer", fontFamily:"inherit" }}>
            {s==="all"?"Toutes":STATUS_LABELS[s]||s}
          </button>
        ))}
        <button onClick={()=>load(filter)} style={{ padding:"6px 12px", borderRadius:8, border:`1px solid ${C.border}`, background:"transparent", color:C.textMuted, fontSize:11, cursor:"pointer", fontFamily:"inherit" }}>🔄</button>
      </div>

      {loading && <div style={{ color:C.textSub, fontSize:13, padding:"20px 0" }}>Chargement…</div>}

      {!loading && filtered.length === 0 && (
        <div style={{ color:C.textSub, fontSize:13, padding:"20px 0", textAlign:"center" }}>Aucune prestation{filter!=="all"?` avec ce statut`:""}</div>
      )}

      {filtered.map(m => {
        const canValidate = ["assigned","pending_acceptance"].includes(m.status);
        // État du pointage : sans lui, l'administrateur validait sans savoir si le
        // prestataire s'était réellement présenté — or c'est précisément le cas
        // qui amène à valider manuellement.
        const pointage = m.started_at
          ? { txt:`Démarrée à ${new Date(m.started_at).toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"})}`, col:C.success }
          : m.arrived_at
            ? { txt:`Arrivée signalée à ${new Date(m.arrived_at).toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"})}, jamais démarrée`, col:C.accentGold }
            : { txt:"Aucun pointage du prestataire", col:C.danger };
        const montant = m.montant_total || Math.round((m.hours||0)*(m.tarif_horaire||0)*100)/100;
        return (
          <div key={m.id} style={{ background:"#0D1B3E", borderRadius:12, padding:"14px 16px", marginBottom:10, border:`1px solid ${(STATUS_COLORS[m.status]||C.border)}22` }}>
            <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:12 }}>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
                  <span style={{ background:`${STATUS_COLORS[m.status]||C.border}22`, color:STATUS_COLORS[m.status]||C.textMuted, fontSize:10, fontWeight:700, padding:"2px 8px", borderRadius:6, letterSpacing:0.5, textTransform:"uppercase", whiteSpace:"nowrap" }}>
                    {STATUS_LABELS[m.status]||m.status}
                  </span>
                  {m.recurrence && <span style={{ fontSize:10, color:C.violet, fontWeight:600 }}>🔄 {m.recurrence}</span>}
                </div>
                <div style={{ fontWeight:700, color:C.text, fontSize:14, marginBottom:4 }}>
                  {m.metier || m.sector} {m.ville ? `— ${m.ville}` : ""}
                </div>
                <div style={{ display:"flex", gap:12, flexWrap:"wrap", fontSize:12, color:C.textSub, marginBottom:4 }}>
                  <span>📅 {m.date||"—"}</span>
                  <span>⏱ {m.hours}h</span>
                  {montant > 0 && <span>💶 {montant}€</span>}
                </div>
                <div style={{ fontSize:12, color:C.textMuted }}>
                  👤 {m.client_name}{m.presta_name ? ` → 👷 ${m.presta_name}` : " → pas de prestataire"}
                </div>
                {m.status === "assigned" && (
                  <div style={{ fontSize:11, color:C.textMuted, marginTop:4 }}>
                    {m.validation_prestataire ? "✅ Prestataire a confirmé" : "⏳ Prestataire n'a pas encore confirmé"}
                    {" · "}
                    {m.validation_client ? "✅ Client a validé" : "⏳ Client n'a pas validé"}
                  </div>
                )}
                {canValidate && (
                  <div style={{ fontSize:11, marginTop:5, color:pointage.col, fontWeight:600 }}>📍 {pointage.txt}</div>
                )}
                {result[m.id] && <div style={{ fontSize:12, marginTop:6, color: result[m.id].startsWith("✅") ? C.success : "#F25E5E" }}>{result[m.id]}</div>}
              </div>
              {canValidate && !result[m.id]?.startsWith("✅") && (
                <button onClick={()=>handleValidate(m.id, !m.started_at)} disabled={validating===m.id} style={{ padding:"9px 14px", borderRadius:10, border:`1px solid ${C.success}44`, background:`${C.success}18`, color:C.success, fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit", whiteSpace:"nowrap", opacity:validating===m.id?0.5:1, flexShrink:0 }}>
                  {validating===m.id ? "…" : "✅ Valider"}
                </button>
              )}
            </div>
            {["completed","closed"].includes(m.status) && !result[m.id] && (
              <div style={{ marginTop:8 }}>
                <button onClick={async()=>{
                  const reason = await showPrompt("Motif du remboursement (optionnel) :","Motif...");
                  if (reason === null) return;
                  setDisputing(m.id+"_manual");
                  const res = await boFetch({ action:"manual_refund", mission_id:m.id, reason });
                  const j = await res.json();
                  setResult(r=>({...r,[m.id]:j.success?"💰 Remboursement initié":`❌ ${j.error||"Erreur"}`}));
                  if (j.success) setMissions(ms=>ms.map(x=>x.id===m.id?{...x,status:"closed"}:x));
                  setDisputing(null);
                }} disabled={!!disputing} style={{ padding:"7px 12px", borderRadius:8, border:"1px solid rgba(242,94,94,0.25)", background:"rgba(242,94,94,0.08)", color:"#F25E5E", fontWeight:600, fontSize:11, cursor:"pointer", fontFamily:"inherit", opacity:disputing===m.id+"_manual"?0.5:1 }}>
                  {disputing===m.id+"_manual"?"…":"↩ Rembourser"}
                </button>
              </div>
            )}
            {/* Les litiges se traitent depuis l'écran « Litiges », et nulle part
                ailleurs. Ces deux boutons débloquaient les fonds ici en un clic,
                sans proposition ni délai d'opposition — et en double du même
                geste ailleurs, deux chemins qui n'ont pas tardé à diverger. */}
            {m.status === "disputed" && !result[m.id] && (
              <div style={{ marginTop:8, padding:"8px 10px", borderRadius:8, background:"rgba(242,94,94,0.08)", border:"1px solid rgba(242,94,94,0.25)", color:"rgba(255,255,255,0.6)", fontSize:11, lineHeight:1.6 }}>
                ⚠️ Prestation en litige — le dénouement passe par l'écran <strong>Litiges</strong> : ALANE y formule une proposition, notifiée aux deux parties, qui disposent de 48 h pour s'y opposer.
              </div>
            )}
            {/* ── Actions admin : Annuler / Réassigner / Modifier ── */}
            {!["cancelled","closed","completed"].includes(m.status) && !result[m.id] && (
              <div style={{ marginTop:8, display:"flex", gap:6, flexWrap:"wrap" }}>
                <button onClick={async()=>{ const hasStripe=!!m.stripe_payment_intent; if(hasStripe){ const r=await showConfirm("Cette prestation a un paiement Stripe. Rembourser le client en même temps ?"); handleCancel(m.id,r); } else handleCancel(m.id,false); }} disabled={!!disputing} style={{ padding:"6px 11px", borderRadius:8, border:"1px solid rgba(242,94,94,0.3)", background:"rgba(242,94,94,0.08)", color:"#F25E5E", fontWeight:700, fontSize:11, cursor:"pointer", fontFamily:"inherit" }}>
                  {disputing===m.id+"_cancel"?"…":"🚫 Annuler"}
                </button>
                <button onClick={()=>{ setReassignId(reassignId===m.id?null:m.id); setReassignEmail(""); setReassignReason(""); }} disabled={!!disputing} style={{ padding:"6px 11px", borderRadius:8, border:"1px solid rgba(162,155,254,0.3)", background:"rgba(162,155,254,0.08)", color:C.violet, fontWeight:700, fontSize:11, cursor:"pointer", fontFamily:"inherit" }}>
                  🔄 Réassigner
                </button>
                <button onClick={()=>{ setEditingMission(editingMission===m.id?null:m.id); setEditMissionVals({ date:m.date||"", hours:m.hours||"", tarif_horaire:m.tarif_horaire||"", ville:m.ville||"", metier:m.metier||"" }); }} disabled={!!disputing} style={{ padding:"6px 11px", borderRadius:8, border:"1px solid rgba(255,255,255,0.15)", background:"rgba(255,255,255,0.05)", color:C.textSub, fontWeight:700, fontSize:11, cursor:"pointer", fontFamily:"inherit" }}>
                  ✏️ Modifier
                </button>
              </div>
            )}
            {/* Formulaire réassignation */}
            {reassignId===m.id && (
              <div style={{ marginTop:8, background:"rgba(162,155,254,0.06)", border:"1px solid rgba(162,155,254,0.2)", borderRadius:10, padding:"12px" }}>
                <div style={{ fontWeight:700, color:C.violet, fontSize:12, marginBottom:8 }}>🔄 Réassigner à un autre prestataire</div>
                <input value={reassignEmail} onChange={e=>setReassignEmail(e.target.value)} placeholder="Email du nouveau prestataire" style={{ width:"100%", background:"rgba(255,255,255,0.06)", border:`1px solid ${C.border}`, borderRadius:7, padding:"8px 10px", color:C.text, fontSize:12, fontFamily:"inherit", boxSizing:"border-box", marginBottom:6 }} />
                <input value={reassignReason} onChange={e=>setReassignReason(e.target.value)} placeholder="Motif (optionnel)" style={{ width:"100%", background:"rgba(255,255,255,0.06)", border:`1px solid ${C.border}`, borderRadius:7, padding:"8px 10px", color:C.text, fontSize:12, fontFamily:"inherit", boxSizing:"border-box", marginBottom:8 }} />
                <button onClick={()=>handleReassign(m.id)} disabled={!reassignEmail.trim()||!!disputing} style={{ padding:"7px 14px", borderRadius:8, border:"none", background:C.violet, color:"#fff", fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit", opacity:!reassignEmail.trim()||disputing?0.5:1 }}>
                  {disputing===m.id+"_reassign"?"…":"Confirmer la réassignation"}
                </button>
              </div>
            )}
            {/* Formulaire modification */}
            {editingMission===m.id && (
              <div style={{ marginTop:8, background:"rgba(255,255,255,0.03)", border:`1px solid ${C.border}`, borderRadius:10, padding:"12px" }}>
                <div style={{ fontWeight:700, color:C.text, fontSize:12, marginBottom:8 }}>✏️ Modifier la prestation</div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:8 }}>
                  {[["date","Date","date"],["hours","Heures","number"],["tarif_horaire","Tarif/h €","number"],["ville","Ville","text"],["metier","Métier","text"]].map(([k,label,type])=>(
                    <div key={k} style={{ gridColumn: k==="metier"?"1/-1":"auto" }}>
                      <div style={{ color:C.textMuted, fontSize:10, marginBottom:3 }}>{label}</div>
                      <input type={type} value={editMissionVals[k]||""} onChange={e=>setEditMissionVals(v=>({...v,[k]:e.target.value}))} style={{ width:"100%", background:"rgba(255,255,255,0.06)", border:`1px solid ${C.border}`, borderRadius:7, padding:"7px 9px", color:C.text, fontSize:12, fontFamily:"inherit", boxSizing:"border-box" }} />
                    </div>
                  ))}
                </div>
                <button onClick={()=>handleUpdateMission(m.id)} disabled={!!disputing} style={{ padding:"7px 14px", borderRadius:8, border:"none", background:C.success, color:"#fff", fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit", opacity:disputing?0.5:1 }}>
                  {disputing===m.id+"_edit"?"…":"Enregistrer"}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function BORefundSection() {
  const [prestations, setMissions] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [refunding, setRefunding] = useState(null);
  const [done, setDone]         = useState({});

  useEffect(() => {
    boFetch({ action: "list_paid_missions" })
      .then(r => r.json())
      .then(data => { setMissions(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const handleRefund = async (m) => {
    if (!await showConfirm(`Rembourser ${m.montant_total} € pour la prestation ${m.id.slice(0,8)} ?`)) return;
    setRefunding(m.id);
    let token = ""; try { token = sessionStorage.getItem("bo_token") || ""; } catch(e) {}
    const r = await fetch("/api/stripe-refund", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ paymentIntentId: m.stripe_payment_intent, missionId: m.id }),
    });
    const j = await r.json();
    setRefunding(null);
    if (j.ok) setDone(prev => ({ ...prev, [m.id]: true }));
    else showToast(`Erreur : ${j.error}`);
  };

  if (loading) return <div style={{ color:C.textSub, fontSize:13, padding:"12px 0" }}>Chargement remboursements…</div>;
  if (!prestations.length) return null;

  return (
    <div style={{ background:"#0D1B3E", borderRadius:16, padding:16, marginTop:4 }}>
      <div style={{ fontWeight:800, color:C.text, fontSize:13, marginBottom:12 }}>↩ Remboursements Stripe</div>
      {prestations.map(m => (
        <div key={m.id} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"8px 0", borderBottom:`1px solid ${C.grayLight}` }}>
          <div>
            <div style={{ color:C.text, fontSize:12, fontWeight:600 }}>{m.metier||m.sector} · {m.montant_total} €</div>
            <div style={{ color:C.textSub, fontSize:11 }}>{new Date(m.created_at).toLocaleDateString("fr-FR")} · {m.stripe_payment_intent?.slice(0,20)}…</div>
          </div>
          {done[m.id]
            ? <span style={{ color:C.success, fontSize:12, fontWeight:700 }}>✅ Remboursé</span>
            : <button onClick={() => handleRefund(m)} disabled={refunding === m.id} style={{ background:"rgba(242,94,94,0.15)", border:`1px solid ${C.danger}`, color:C.danger, borderRadius:8, padding:"5px 10px", fontSize:11, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
                {refunding === m.id ? "…" : "↩ Rembourser"}
              </button>
          }
        </div>
      ))}
    </div>
  );
}

export function BackofficeDashboard({ onBack, onNavigate }) {
  const [tab, setTab] = useState("dashboard");
  const { data: boData, loading: boLoading, visits: boVisits, authError: boAuthError } = useBoData();
  const d = boData || {
    users:    { clients:0, prestataires:0, total:0, pending:0 },
    missions: { total:0, open:0, assigned:0, terminees:0, closed:0, tauxCompletion:0 },
    finance:  { caTotal:0, caMoyen:0 },
    tickets:  { open:0, total:0 },
    sectors:  [],
    recentUsers: [],
    signupsByMonth: {},
    missionsByMonth: {},
    caByMonth: {},
    monthLabels: [],
  };

  const KPICard = ({ icon, label, value, sub, color=C.violet, onClick }) => (
    <div onClick={onClick} style={{ background:"#0D1B3E", borderRadius:16, padding:"16px 14px", boxShadow:"0 4px 16px rgba(0,0,0,0.5)", cursor:onClick?"pointer":"default" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:8 }}>
        <div style={{ width:38, height:38, borderRadius:12, background:`${color}18`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 }}>{icon}</div>
        {sub && <span style={{ fontSize:10, fontWeight:700, color:C.success, background:`${C.success}15`, borderRadius:6, padding:"2px 6px" }}>{sub}</span>}
      </div>
      <div style={{ fontSize:24, fontWeight:800, color:C.text }}>{value}</div>
      <div style={{ fontSize:12, color:C.textSub, marginTop:2 }}>{label}</div>
    </div>
  );

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg, #0A1628 0%, #0D1B3E 100%)`, paddingBottom:80 }}>
      {/* Header */}
      <div style={{ background:`linear-gradient(135deg,${C.navy},${C.navyMid})`, padding:"48px 22px 24px", borderRadius:"0 0 26px 26px" }}>
        <button onClick={onBack} style={{ background:"rgba(255,255,255,0.15)", border:"none", borderRadius:10, padding:"7px 14px", color:C.white, cursor:"pointer", fontSize:13, marginBottom:14 }}>← Retour app</button>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
          <div>
            <p style={{ color:"rgba(255,255,255,0.6)", fontSize:12, margin:"0 0 2px" }}>Administration</p>
            <h2 style={{ color:C.white, fontSize:20, fontWeight:800, margin:"0 0 2px", fontFamily:font.display }}>⚙️ Backoffice ALANE</h2>
            <p style={{ color:"rgba(255,255,255,0.6)", fontSize:12, margin:0 }}>Tableau de bord · Temps réel</p>
          </div>
          <div style={{ background:`${C.success}33`, borderRadius:8, padding:"4px 10px", color:C.success, fontSize:11, fontWeight:700 }}>● Actif</div>
        </div>
      </div>

      {/* Bannière erreur auth token */}
      {boAuthError && (
        <div style={{ margin:"12px 14px 0", background:"rgba(242,94,94,0.12)", border:"1px solid rgba(242,94,94,0.4)", borderRadius:10, padding:"10px 14px", display:"flex", gap:10, alignItems:"flex-start" }}>
          <span style={{ fontSize:16, flexShrink:0 }}>🔐</span>
          <div>
            <div style={{ color:"#F25E5E", fontWeight:700, fontSize:12, marginBottom:2 }}>Erreur d'authentification API — les données ne se chargent pas</div>
            <div style={{ color:"rgba(255,255,255,0.6)", fontSize:11, fontFamily:"monospace", wordBreak:"break-all" }}>{boAuthError}</div>
            <div style={{ color:"rgba(255,255,255,0.6)", fontSize:11, marginTop:4 }}>Vérifiez que BO_SESSION_SECRET est bien configuré dans Vercel (ou supprimez-le pour utiliser la dérivation automatique).</div>
          </div>
        </div>
      )}

      {/* Layout : sidebar gauche + contenu */}
      <div style={{ display:"flex", gap:0, padding:"18px 14px", alignItems:"flex-start" }}>

        {/* Sidebar onglets */}
        <div style={{ width:130, flexShrink:0, display:"flex", flexDirection:"column", gap:4, marginRight:14, position:"sticky", top:18 }}>
          {[
            {id:"dashboard",  l:"📊 KPIs"},
            {id:"comptes",    l:"✅ Comptes"},
            {id:"documents",  l:"📂 Documents"},
            {id:"prestations",   l:"📋 Prestations"},
            {id:"support",    l:"🎧 Support"},
            {id:"litiges",    l:"⚠️ Litiges"},
            {id:"versements", l:"💸 Versements"},
            {id:"sectors",    l:"🗂️ Secteurs"},
            {id:"users",      l:"👥 Utilisateurs"},
            {id:"finance",    l:"💶 Finance"},
            {id:"moderation", l:"⚠️ Modération"},
            {id:"ratings",    l:"⭐ Avis"},
            {id:"logs",       l:"📋 Logs"},
            {id:"reglages",   l:"⚙️ Réglages"},
            {id:"test",       l:"🧪 Test"},
          ].map(t => (
            <button key={t.id} onClick={()=>setTab(t.id)} style={{
              padding:"10px 10px", border:"none",
              borderRadius:10,
              borderLeft:`3px solid ${tab===t.id?C.violet:"transparent"}`,
              background: tab===t.id ? `${C.violet}18` : "transparent",
              color: tab===t.id ? C.violet : C.gray,
              fontWeight: tab===t.id ? 700 : 500,
              fontSize:12, cursor:"pointer", fontFamily:"inherit",
              textAlign:"left", transition:"all 0.15s",
              whiteSpace:"nowrap",
            }}>{t.l}</button>
          ))}
        </div>

        {/* Contenu */}
        <div style={{ flex:1, minWidth:0 }}>

        {/* ── COMPTES ── */}
        {tab==="comptes" && <BOComptes />}

        {/* ── DOCUMENTS ── */}
        {tab==="documents" && <BODocuments />}

        {/* ── MISSIONS ── */}
        {tab==="prestations" && <BOMissions />}

        {/* ── SUPPORT ── */}
        {tab==="support" && <BOSupport />}

        {/* ── LITIGES ── */}
        {tab==="litiges" && <BOLitiges />}

        {tab==="versements" && <BOVersements />}

        {/* ── TEST ── */}
        {tab==="test" && <BOTest onNavigate={onNavigate} />}

        {/* ── LOGS ── */}
        {tab==="logs" && <BOLogs />}

        {/* ── DASHBOARD ── */}
        {tab==="dashboard" && <>
          {boLoading && <div style={{ textAlign:"center", color:C.textSub, fontSize:13, padding:"30px 0" }}>Chargement des données…</div>}

          {/* Reset mensuel manuel + relances */}
          <BOResetMonthly />
          <BOReminders />


          {/* Alertes dynamiques */}
          {d.users.pending > 0 && (
            <div style={{ background:"#F39C1215", border:"1px solid #F39C1244", borderRadius:12, padding:"10px 14px", marginBottom:8, display:"flex", gap:10, alignItems:"center" }}>
              <span style={{ fontSize:18 }}>📋</span>
              <span style={{ fontSize:12, color:C.text, fontWeight:600, flex:1 }}>{d.users.pending} compte{d.users.pending>1?"s":""} en attente de validation</span>
              <span style={{ color:"#F39C12", fontSize:12, fontWeight:700, cursor:"pointer" }} onClick={()=>setTab("comptes")}>Traiter →</span>
            </div>
          )}
          {d.tickets?.open > 0 && (
            <div style={{ background:"#E74C3C15", border:"1px solid #E74C3C44", borderRadius:12, padding:"10px 14px", marginBottom:8, display:"flex", gap:10, alignItems:"center" }}>
              <span style={{ fontSize:18 }}>🎧</span>
              <span style={{ fontSize:12, color:C.text, fontWeight:600, flex:1 }}>{d.tickets.open} ticket{d.tickets.open>1?"s":""} support ouverts</span>
              <span style={{ color:"#E74C3C", fontSize:12, fontWeight:700, cursor:"pointer" }} onClick={()=>setTab("support")}>Traiter →</span>
            </div>
          )}

          {/* KPIs grid */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, margin:"14px 0" }}>
            <KPICard icon="👥" label="Utilisateurs total" value={d.users.total} sub={`${d.users.pending} en attente`} color={C.violet} />
            <KPICard icon="✅" label="Prestations terminées" value={d.missions.terminees} sub={`${d.missions.tauxCompletion}% de taux`} color={C.success} />
            <KPICard icon="💶" label="CA total (€)" value={d.finance.caTotal > 0 ? `${(d.finance.caTotal/1000).toFixed(1)}k` : `${d.finance.caTotal} €`} sub="Prestations complétées" color={C.accentGold} />
            <KPICard icon="📦" label="Prestations actives" value={d.missions.open + d.missions.assigned} sub={`${d.missions.open} ouvertes · ${d.missions.assigned} assignées`} color="#7C6FE0" />
          </div>

          {/* Visiteurs */}
          <div style={{ background:"#0D1B3E", borderRadius:16, padding:"16px", marginBottom:14, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
              <div style={{ fontWeight:800, color:C.text, fontSize:13 }}>👁️ Visiteurs</div>
              <button onClick={async ()=>{
                if(!await showConfirm("Remettre le compteur de visites à 0 ?")) return;
                await boFetch({ action:"reset_visits" }).catch(()=>{});
                window.location.reload();
              }} style={{ background:"rgba(231,76,60,0.12)", border:"1px solid rgba(231,76,60,0.3)", color:"#E74C3C", borderRadius:8, padding:"4px 10px", fontSize:11, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
                🗑️ Remettre à 0
              </button>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:8, marginBottom:16 }}>
              {[
                { l:"Aujourd'hui", v: boVisits?.today ?? "—", c: C.violet },
                { l:"7 jours",     v: boVisits?.week  ?? "—", c: "#7C6FE0" },
                { l:"Ce mois",     v: boVisits?.month  ?? "—", c: C.indigo },
                { l:"Total",       v: boVisits?.total  ?? "—", c: C.textSub },
              ].map(s => (
                <div key={s.l} style={{ textAlign:"center", background:`${s.c}12`, borderRadius:12, padding:"10px 4px" }}>
                  <div style={{ fontWeight:800, color:s.c, fontSize:18 }}>{s.v}</div>
                  <div style={{ color:C.textSub, fontSize:10, marginTop:2 }}>{s.l}</div>
                </div>
              ))}
            </div>
            {boVisits?.byDay && (() => {
              const days = Object.keys(boVisits.byDay).sort().slice(-14);
              const vals = days.map(d => boVisits.byDay[d] || 0);
              const max  = Math.max(...vals, 1);
              return (
                <div>
                  <div style={{ fontSize:11, color:C.textSub, marginBottom:6 }}>Visites / jour (14 derniers jours)</div>
                  <div style={{ display:"flex", gap:3, alignItems:"flex-end", height:48 }}>
                    {vals.map((v,i) => (
                      <div key={i} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
                        <div style={{ width:"100%", background: i===vals.length-1 ? C.violet : `${C.violet}55`, borderRadius:"3px 3px 0 0", height:`${(v/max)*44}px`, minHeight:3, transition:"height 0.3s" }} />
                      </div>
                    ))}
                  </div>
                  <div style={{ display:"flex", justifyContent:"space-between", marginTop:4 }}>
                    <span style={{ fontSize:9, color:C.textMuted }}>{days[0]?.slice(5)}</span>
                    <span style={{ fontSize:9, color:C.textMuted }}>{days[days.length-1]?.slice(5)}</span>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Prestations par statut */}
          <div style={{ background:"#0D1B3E", borderRadius:16, padding:"16px", marginBottom:14, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
            <div style={{ fontWeight:800, color:C.text, fontSize:13, marginBottom:14 }}>📋 Statut des prestations</div>
            <div style={{ display:"flex", gap:8, marginBottom:14, flexWrap:"wrap" }}>
              {[
                {l:"Ouvertes",  v:d.missions.open,      c:"#F0B429"},
                {l:"Assignées", v:d.missions.assigned,   c:C.violet},
                {l:"Terminées", v:d.missions.terminees,  c:C.success},
                {l:"Fermées",   v:d.missions.closed,     c:C.textMuted},
              ].map(s=>(
                <div key={s.l} style={{ flex:1, minWidth:60, textAlign:"center", background:`${s.c}12`, borderRadius:12, padding:"10px 6px" }}>
                  <div style={{ fontWeight:800, color:s.c, fontSize:20 }}>{s.v}</div>
                  <div style={{ color:C.textSub, fontSize:10, marginTop:2 }}>{s.l}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize:12, color:C.textSub, marginBottom:6 }}>Taux de complétion : <strong style={{ color:C.success }}>{d.missions.tauxCompletion}%</strong></div>
            <div style={{ height:8, background:"#162547", borderRadius:4, overflow:"hidden" }}>
              <div style={{ height:"100%", width:`${d.missions.tauxCompletion}%`, background:`linear-gradient(90deg,${C.success},#1e8449)`, borderRadius:4, transition:"width 1s" }} />
            </div>
          </div>

          {/* Prestations créées par mois */}
          {d.monthLabels.length > 0 && (() => {
            const vals = d.monthLabels.map((_,i) => Object.values(d.missionsByMonth)[i] || 0);
            const max = Math.max(...vals, 1);
            return (
              <div style={{ background:"#0D1B3E", borderRadius:16, padding:"16px", marginBottom:14, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
                <div style={{ fontWeight:800, color:C.text, fontSize:13, marginBottom:12 }}>📅 Prestations créées par mois</div>
                <div style={{ display:"flex", gap:6, alignItems:"flex-end", height:48, marginBottom:6 }}>
                  {vals.map((v,i) => (
                    <div key={i} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center" }}>
                      <div style={{ width:"100%", background: i===vals.length-1 ? C.success : `${C.success}55`, borderRadius:"3px 3px 0 0", height:`${Math.max((v/max)*44,3)}px`, transition:"height 0.3s" }} />
                    </div>
                  ))}
                </div>
                <div style={{ display:"flex", gap:6 }}>
                  {d.monthLabels.map((l,i) => (
                    <div key={i} style={{ flex:1, textAlign:"center", fontSize:9, color: i===d.monthLabels.length-1 ? C.success : C.textMuted }}>{l}</div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Répartition utilisateurs */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>
            {[
              {l:"Total",        v:d.users.total,        c:C.violet},
              {l:"Clients",      v:d.users.clients,      c:C.accentGold},
              {l:"Prestataires", v:d.users.prestataires, c:C.success},
            ].map(s=>(
              <div key={s.l} style={{ background:"#0D1B3E", borderRadius:r, padding:"12px 10px", textAlign:"center", boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
                <div style={{ fontWeight:800, color:s.c, fontSize:20 }}>{s.v}</div>
                <div style={{ color:C.textSub, fontSize:10, marginTop:2 }}>{s.l}</div>
              </div>
            ))}
          </div>
        </>}

        {/* ── SECTEURS ── */}
        {tab==="sectors" && <>
          <div style={{ display:"flex", gap:16, alignItems:"center", marginBottom:20 }}>
            <DonutChart sectors={d.sectors.length > 0 ? d.sectors : [{pct:100,color:"#162547"}]} />
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:800, color:C.text, fontSize:14, marginBottom:4 }}>Répartition des prestations</div>
              <div style={{ color:C.textSub, fontSize:12 }}>Total : {d.missions.total} prestations</div>
              {d.sectors[0] && <div style={{ marginTop:8 }}>
                <div style={{ fontSize:12, color:C.textSub }}>Secteur #1</div>
                <div style={{ fontWeight:800, color:C.text, fontSize:14 }}>{d.sectors[0].icon} {d.sectors[0].label} ({d.sectors[0].pct}%)</div>
              </div>}
              {d.sectors.length === 0 && <div style={{ marginTop:8, fontSize:12, color:C.textMuted }}>Aucune prestation pour l'instant</div>}
            </div>
          </div>
          {d.sectors.map((s,i) => (
            <div key={i} style={{ background:"#0D1B3E", borderRadius:r, padding:"13px 14px", marginBottom:9, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                  <div style={{ width:34, height:34, borderRadius:10, background:`${s.color}22`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 }}>{s.icon}</div>
                  <div>
                    <div style={{ fontWeight:700, color:C.text, fontSize:13 }}>{s.label}</div>
                    <div style={{ color:C.textSub, fontSize:11 }}>{s.missions} prestations</div>
                  </div>
                </div>
                <div style={{ fontWeight:800, color:s.color, fontSize:16 }}>{s.pct}%</div>
              </div>
              <div style={{ height:6, background:"#162547", borderRadius:3, overflow:"hidden" }}>
                <div style={{ height:"100%", width:`${s.pct}%`, background:s.color, borderRadius:3 }} />
              </div>
            </div>
          ))}
        </>}

        {/* ── UTILISATEURS ── */}
        {tab==="users" && <>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, marginBottom:18 }}>
            {[{l:"Total",v:d.users.total,c:C.violet},{l:"Clients",v:d.users.clients,c:C.indigo},{l:"Prestataires",v:d.users.prestataires,c:C.accent}].map(s=>(
              <div key={s.l} style={{ background:"#0D1B3E", borderRadius:r, padding:"13px 10px", textAlign:"center", boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
                <div style={{ fontWeight:800, color:s.c, fontSize:22 }}>{s.v}</div>
                <div style={{ color:C.textSub, fontSize:11, marginTop:2 }}>{s.l}</div>
              </div>
            ))}
          </div>

          {/* Croissance mensuelle */}
          {d.monthLabels.length > 0 && (() => {
            const vals = d.monthLabels.map((_,i) => Object.values(d.signupsByMonth)[i] || 0);
            const max = Math.max(...vals, 1);
            const thisMonth = vals[vals.length-1];
            const lastMonth = vals[vals.length-2] || 0;
            const delta = thisMonth - lastMonth;
            return (
              <div style={{ background:"#0D1B3E", borderRadius:16, padding:"16px", marginBottom:16, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
                  <div style={{ fontWeight:800, color:C.text, fontSize:13 }}>📈 Inscriptions par mois</div>
                  <div style={{ fontSize:12, fontWeight:700, color: delta>=0 ? C.success : C.danger }}>
                    {delta>=0?"+":""}{delta} vs mois préc.
                  </div>
                </div>
                <div style={{ display:"flex", gap:6, alignItems:"flex-end", height:60, marginBottom:8 }}>
                  {vals.map((v,i) => (
                    <div key={i} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
                      <div style={{ width:"100%", background: i===vals.length-1 ? C.violet : `${C.violet}55`, borderRadius:"3px 3px 0 0", height:`${Math.max((v/max)*56,3)}px`, transition:"height 0.3s", position:"relative" }}>
                        {v > 0 && <div style={{ position:"absolute", top:-16, left:"50%", transform:"translateX(-50%)", fontSize:9, color:C.text, fontWeight:700, whiteSpace:"nowrap" }}>{v}</div>}
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ display:"flex", gap:6 }}>
                  {d.monthLabels.map((l,i) => (
                    <div key={i} style={{ flex:1, textAlign:"center", fontSize:9, color: i===d.monthLabels.length-1 ? C.violet : C.textMuted, fontWeight: i===d.monthLabels.length-1 ? 700 : 400 }}>{l}</div>
                  ))}
                </div>
              </div>
            );
          })()}

          <div style={{ fontWeight:800, color:C.text, fontSize:13, margin:"18px 0 10px" }}>🕐 Dernières inscriptions</div>
          {d.recentUsers.length === 0 && <div style={{ color:C.textMuted, fontSize:12, textAlign:"center", padding:"20px 0" }}>Aucun utilisateur inscrit</div>}
          {d.recentUsers.map((u,i) => {
            const statusColor = u.status==="approved"?C.success : u.status==="rejected"?C.danger : C.accentGold;
            const statusLabel = u.status==="approved"?"Approuvé" : u.status==="rejected"?"Refusé" : "En attente";
            const dateStr = new Date(u.created_at).toLocaleDateString("fr-FR", { day:"numeric", month:"short" });
            return (
              <div key={i} style={{ background:"#0D1B3E", borderRadius:13, padding:"11px 14px", marginBottom:8, display:"flex", alignItems:"center", gap:10, boxShadow:"0 2px 6px rgba(0,0,0,0.04)" }}>
                <div style={{ width:36, height:36, borderRadius:10, background:`${u.role==="client"?C.violet:C.accent}18`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 }}>{u.role==="client"?"🏢":"👷"}</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:700, color:C.text, fontSize:13 }}>{u.prenom} {u.nom}</div>
                  <div style={{ color:C.textSub, fontSize:11 }}>{u.role==="client"?"Client":"Prestataire"} · {dateStr}</div>
                </div>
                <Badge color={statusColor} small>{statusLabel}</Badge>
              </div>
            );
          })}
        </>}

        {/* ── FINANCE ── */}
        {tab==="finance" && <>
          <StripeStatsCard />
          <div style={{ background:`linear-gradient(135deg,${C.violet},${C.indigo})`, borderRadius:18, padding:"20px", marginBottom:16, textAlign:"center" }}>
            <p style={{ color:"rgba(255,255,255,0.6)", fontSize:12, margin:"0 0 4px" }}>Chiffre d'affaires total plateforme</p>
            <div style={{ color:C.white, fontSize:36, fontWeight:900 }}>{d.finance.caTotal.toLocaleString()} €</div>
            <div style={{ color:"rgba(255,255,255,0.6)", fontSize:13, marginTop:4 }}>Prestations complétées : <strong style={{ color:C.accentGold }}>{d.missions.terminees}</strong></div>
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:16 }}>
            {[{l:"CA total",v:`${d.finance.caTotal.toLocaleString()} €`,c:C.accentGold,i:"💰"},{l:"Panier moyen",v:`${(d.finance.caMoyen||0).toLocaleString()} €`,c:C.violet,i:"📊"},{l:"Prestations terminées",v:d.missions.terminees,c:C.success,i:"✅"},{l:"Prestations actives",v:d.missions.open+d.missions.assigned,c:"#7C6FE0",i:"📦"}].map(s=>(
              <div key={s.l} style={{ background:"#0D1B3E", borderRadius:r, padding:"14px", boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
                <div style={{ fontSize:22, marginBottom:6 }}>{s.i}</div>
                <div style={{ fontWeight:800, color:s.c, fontSize:18 }}>{s.v}</div>
                <div style={{ color:C.textSub, fontSize:11, marginTop:2 }}>{s.l}</div>
              </div>
            ))}
          </div>

          {/* CA par mois */}
          {d.monthLabels.length > 0 && (() => {
            const vals = d.monthLabels.map((_,i) => Math.round(Object.values(d.caByMonth)[i] || 0));
            const max = Math.max(...vals, 1);
            const thisMonth = vals[vals.length-1];
            const lastMonth = vals[vals.length-2] || 0;
            const delta = thisMonth - lastMonth;
            return (
              <div style={{ background:"#0D1B3E", borderRadius:16, padding:"16px", marginBottom:16, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
                  <div style={{ fontWeight:800, color:C.text, fontSize:13 }}>💶 CA par mois</div>
                  <div style={{ fontSize:12, fontWeight:700, color: delta>=0 ? C.success : C.danger }}>
                    {delta>=0?"+":""}{delta.toLocaleString()} € vs mois préc.
                  </div>
                </div>
                <div style={{ display:"flex", gap:6, alignItems:"flex-end", height:64, marginBottom:8 }}>
                  {vals.map((v,i) => (
                    <div key={i} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center" }}>
                      <div style={{ width:"100%", background: i===vals.length-1 ? C.accentGold : `${C.accentGold}55`, borderRadius:"3px 3px 0 0", height:`${Math.max((v/max)*60,3)}px`, transition:"height 0.3s", position:"relative" }}>
                        {v > 0 && <div style={{ position:"absolute", top:-16, left:"50%", transform:"translateX(-50%)", fontSize:9, color:C.text, fontWeight:700, whiteSpace:"nowrap" }}>{v}€</div>}
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ display:"flex", gap:6 }}>
                  {d.monthLabels.map((l,i) => (
                    <div key={i} style={{ flex:1, textAlign:"center", fontSize:9, color: i===d.monthLabels.length-1 ? C.accentGold : C.textMuted, fontWeight: i===d.monthLabels.length-1 ? 700 : 400 }}>{l}</div>
                  ))}
                </div>
              </div>
            );
          })()}

          <div style={{ background:"#0D1B3E", borderRadius:16, padding:"16px", marginBottom:14, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
            <div style={{ fontWeight:800, color:C.text, fontSize:13, marginBottom:12 }}>Commission par secteur</div>
            {d.sectors.slice(0,5).map((s,i) => (
              <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 0", borderBottom:i<4?`1px solid ${C.grayLight}`:"none" }}>
                <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                  <span>{s.icon}</span>
                  <span style={{ fontSize:13, color:C.text, fontWeight:600 }}>{s.label}</span>
                </div>
                <div style={{ textAlign:"right" }}>
                  <div style={{ fontWeight:800, color:C.violet, fontSize:13 }}>{s.pct.toFixed(1)} %</div>
                  <div style={{ color:C.textSub, fontSize:10 }}>du volume total</div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ display:"flex", gap:10, marginBottom:16 }}>
            <BOExportCSV d={d} />
            <BOExportPDF d={d} />
            <BOExportMissions />
          </div>

          <BORefundSection />
        </>}

        {/* ── MODÉRATION ── */}
        {tab==="moderation" && <BOModerationTab d={d} />}
        {tab==="ratings"    && <BORatings />}

        {/* ── RÉGLAGES ── */}
        {tab==="reglages" && <BOSettingsTab />}
        </div>{/* fin contenu */}
      </div>{/* fin layout */}
    </div>
  );
}
