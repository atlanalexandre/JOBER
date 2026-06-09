import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase.js";
import { C, font, r, shadow } from "../constants/colors.js";
import { SECTOR_LABELS, SECTORS } from "../constants/data.js";
import { MARGES } from "../constants/plans.js";
import { Btn, Input, Badge, SectionHeader, Card, MiniBar, DonutChart, Stars } from "./ui.jsx";

// Helper centralisé pour tous les appels BO — injecte automatiquement le token signé
export function boFetch(body) {
  const token = sessionStorage.getItem("bo_token") || "";
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

  const fetchAll = () => Promise.all([
    boFetch({ action: "stats" }).then(r => r.json()).catch(() => null),
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

  return { data, loading, visits };
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
  const [error, setError]       = useState(false);
  const [checking, setChecking] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const locked = attempts >= 5;

  const handleSubmit = () => {
    if (!pwd.trim() || checking || locked) return;
    setChecking(true);
    fetch("/api/bo-verify-pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: pwd }),
    })
      .then(r => r.json())
      .then(j => {
        setChecking(false);
        if (j.ok) { sessionStorage.setItem("bo_token", j.token || ""); onLogin(); }
        else { setError(true); setPwd(""); setAttempts(a => a + 1); }
      })
      .catch(() => { setChecking(false); setError(true); setPwd(""); setAttempts(a => a + 1); });
  };

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(160deg,#050E20,#0A1628,#1E3A7B)`, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:32, position:"relative" }}>
      <button onClick={onBack} style={{ position:"absolute", top:54, left:22, background:"rgba(255,255,255,0.15)", border:"none", borderRadius:10, padding:"7px 14px", color:C.white, cursor:"pointer", fontSize:13 }}>← Retour</button>

      <div style={{ width:72, height:72, borderRadius:22, background:`${C.violet}44`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:32, marginBottom:20, border:`2px solid ${C.violet}66` }}>⚙️</div>
      <h2 style={{ color:C.white, fontSize:22, fontWeight:800, margin:"0 0 6px", fontFamily:font.display }}>Backoffice ALANE</h2>
      <p style={{ color:"rgba(255,255,255,0.5)", fontSize:14, margin:"0 0 36px" }}>Accès administrateur uniquement</p>

      {locked && <p style={{ color:C.accent, fontSize:13, marginBottom:16, fontWeight:600 }}>Accès bloqué — trop de tentatives</p>}
      {!locked && error && <p style={{ color:C.accent, fontSize:13, marginBottom:16, fontWeight:600 }}>Mot de passe incorrect — Réessayez</p>}
      {!locked && !error && <p style={{ color:"rgba(255,255,255,0.4)", fontSize:13, marginBottom:16 }}>{checking ? "Vérification…" : "Entrez votre mot de passe"}</p>}

      <div style={{ width:"100%", maxWidth:320, position:"relative", marginBottom:16 }}>
        <input
          type={show ? "text" : "password"}
          value={pwd}
          onChange={e => { setPwd(e.target.value); setError(false); }}
          onKeyDown={e => e.key === "Enter" && handleSubmit()}
          disabled={locked || checking}
          placeholder="Mot de passe administrateur"
          autoComplete="current-password"
          style={{ width:"100%", boxSizing:"border-box", background:"rgba(255,255,255,0.08)", border:`2px solid ${error ? C.danger : "rgba(255,255,255,0.15)"}`, borderRadius:14, padding:"15px 48px 15px 18px", color:C.white, fontSize:16, fontFamily:"inherit", outline:"none", transition:"border-color 0.2s" }}
        />
        <button onClick={() => setShow(s => !s)} style={{ position:"absolute", right:14, top:"50%", transform:"translateY(-50%)", background:"transparent", border:"none", color:"rgba(255,255,255,0.4)", cursor:"pointer", fontSize:18, lineHeight:1 }}>
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

export function BOComptes() {
  const [profiles, setProfiles]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [filter, setFilter]       = useState("pending");
  const [roleFilter, setRoleFilter] = useState("all");
  const [actioning, setActioning] = useState(null);
  const [expanded, setExpanded]   = useState(null);
  const [verifs, setVerifs]       = useState({});
  const [verifying, setVerifying] = useState(null);
  const [deleteModal, setDeleteModal] = useState(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [docs, setDocs]           = useState({});
  const [docsLoading, setDocsLoading] = useState({});
  const [docVerifying, setDocVerifying] = useState(null);
  const [editMode, setEditMode]   = useState(null);
  const [editVals, setEditVals]   = useState({});
  const [editSaving, setEditSaving] = useState(false);
  const [editResult, setEditResult] = useState(null);

  const handleVerify = async (p) => {
    setVerifying(p.id);
    try {
      const res = await fetch("/api/verify-docs", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ iban: p.rib||"", siret: p.kbis||"" }),
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

  const handleVerifyDoc = async (profileId, docId) => {
    setDocVerifying(docId);
    await boFetch({ action:"verify_doc", profileId, docId });
    setDocs(d => ({ ...d, [profileId]: (d[profileId]||[]).map(doc => doc.id===docId ? { ...doc, verified:true } : doc) }));
    setDocVerifying(null);
  };

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
    await boFetch({ action, profileId, reason });
    setActioning(null);
    load();
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
        <input type={type} value={editVals[field] || ""} onChange={e => setEditVals(v => ({ ...v, [field]: e.target.value }))}
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
  const filtered = profiles.filter(p =>
    (filter==="all" || p.status===filter) &&
    (roleFilter==="all" || p.role===roleFilter)
  );

  return (
    <div style={{ padding:"16px 18px" }}>
      <h3 style={{ color:C.white, fontSize:15, fontWeight:800, margin:"0 0 14px" }}>Validation des comptes</h3>

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
        <div style={{ textAlign:"center", color:"rgba(255,255,255,0.4)", padding:"32px 0", fontSize:13 }}>Chargement…</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign:"center", color:"rgba(255,255,255,0.3)", padding:"32px 0", fontSize:13 }}>Aucun compte dans cette catégorie</div>
      ) : filtered.map(p => (
        <div key={p.id} style={{ background:"#0D1B3E", border:`1px solid rgba(255,255,255,0.07)`, borderRadius:14, padding:"14px 16px", marginBottom:10 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ color:C.white, fontWeight:700, fontSize:14 }}>
                {p.prenom||p.nom ? `${p.prenom||""} ${p.nom||""}`.trim() : "Nom non renseigné"}
              </div>
              <div style={{ color:"rgba(255,255,255,0.45)", fontSize:11, marginTop:2 }}>
                {p.email || "Email non disponible"}
              </div>
              <div style={{ color:"rgba(255,255,255,0.3)", fontSize:10, marginTop:2 }}>
                {p.role==="prestataire"?"👷 Prestataire":"🏢 Client"} · {new Date(p.created_at).toLocaleDateString("fr-FR")}
              </div>
            </div>
            <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:6 }}>
              <div style={{ background:`${statusColor[p.status]||"#888"}22`, border:`1px solid ${statusColor[p.status]||"#888"}55`, borderRadius:8, padding:"3px 10px", color:statusColor[p.status]||"#888", fontSize:11, fontWeight:700 }}>
                {statusLabel[p.status]||p.status}
              </div>
              <button onClick={()=>setExpanded(expanded===p.id?null:p.id)} style={{ fontSize:10, color:"rgba(255,255,255,0.3)", background:"none", border:"none", cursor:"pointer", fontFamily:"inherit" }}>
                {expanded===p.id?"▲ Masquer":"▼ Détails"}
              </button>
            </div>
          </div>

          {/* Détails étendus */}
          {expanded===p.id && (
            <div style={{ background:"rgba(255,255,255,0.03)", borderRadius:10, padding:"14px", marginBottom:10 }}>

              {/* ── Header section avec bouton modifier ── */}
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12, paddingBottom:10, borderBottom:"1px solid rgba(255,255,255,0.07)" }}>
                <span style={{ color:"rgba(255,255,255,0.5)", fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:0.5 }}>📋 Informations complètes</span>
                {editMode === p.id ? (
                  <div style={{ display:"flex", gap:8 }}>
                    <button onClick={()=>{ setEditMode(null); setEditResult(null); }} style={{ padding:"5px 12px", borderRadius:8, border:"1px solid rgba(255,255,255,0.2)", background:"transparent", color:"rgba(255,255,255,0.5)", fontSize:11, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>Annuler</button>
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
                  <div style={{ color:"rgba(255,255,255,0.4)", fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:0.5, marginBottom:8 }}>Identité</div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:12 }}>
                    <FI label="Prénom" field="prenom" />
                    <FI label="Nom" field="nom" />
                  </div>

                  <div style={{ color:"rgba(255,255,255,0.4)", fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:0.5, marginBottom:8 }}>Contact & paiement</div>
                  <div style={{ marginBottom:12 }}>
                    <FI label="Téléphone" field="telephone" />
                    <FI label="IBAN / RIB" field="rib" />
                  </div>

                  <div style={{ color:"rgba(255,255,255,0.4)", fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:0.5, marginBottom:8 }}>Profil légal</div>
                  <div style={{ marginBottom:12 }}>
                    <FI label="Type de compte" field="type_compte" options={[["","— Non renseigné —"],["particulier","Particulier"],["professionnel","Professionnel"]]} />
                    <FI label="Nom de la société" field="societe_nom" />
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                      <FI label="KBIS / SIRET" field="kbis" />
                      <FI label="SIRET auto-entrepreneur" field="ae_siret" />
                    </div>
                  </div>

                  {p.role === "prestataire" && <>
                    <div style={{ color:"rgba(255,255,255,0.4)", fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:0.5, marginBottom:8 }}>Activité professionnelle</div>
                    <div style={{ marginBottom:12 }}>
                      <FI label="Secteur" field="secteur" options={[["","— Non renseigné —"],["logistique","Logistique"],["btp","BTP"],["restauration","Restauration"],["proprete","Propreté"],["commercial","Commercial"],["hotellerie","Hôtellerie"],["distribution","Distribution"],["divers","Divers"]]} />
                      <FI label="Métier / Poste" field="metier" />
                      <FI label="Tarif net (€/h)" field="tarif_net" type="number" />
                      <FI label="Bio / Présentation" field="bio" type="textarea" />
                    </div>
                  </>}

                  {p.role === "client" && <>
                    <div style={{ color:"rgba(255,255,255,0.4)", fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:0.5, marginBottom:8 }}>Besoins</div>
                    <div style={{ marginBottom:12 }}>
                      <FI label="Fréquence des besoins" field="frequence_besoins" options={[["","— Non renseigné —"],["occasionnel","Occasionnel"],["regulier","Régulier"],["permanent","Permanent"]]} />
                      <FI label="Volume horaire (h/mois)" field="volume_horaire" type="number" />
                    </div>
                  </>}

                  <div style={{ color:"rgba(255,255,255,0.4)", fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:0.5, marginBottom:8 }}>Adresse</div>
                  <div style={{ marginBottom:12 }}>
                    <FI label="Rue / Adresse" field="rue" />
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                      <FI label="Code postal" field="cp" />
                      <FI label="Ville" field="ville" />
                    </div>
                  </div>

                  <div style={{ color:"rgba(255,255,255,0.4)", fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:0.5, marginBottom:8 }}>Abonnement</div>
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
                    <InfoRow icon="🏦" label="IBAN" value={p.rib} mono />
                    <InfoRow icon="👤" label="Type" value={p.type_compte === "professionnel" ? "Professionnel" : p.type_compte === "particulier" ? "Particulier" : p.type_compte} />
                    <InfoRow icon="🏢" label="Société" value={p.societe_nom} />
                    <InfoRow icon="📄" label="KBIS/SIRET" value={p.kbis} />
                    <InfoRow icon="🪪" label="AE SIRET" value={p.ae_siret} />
                    {p.role === "prestataire" && <>
                      <InfoRow icon="🗂️" label="Secteur" value={p.secteur} />
                      <InfoRow icon="💼" label="Métier" value={p.metier} />
                      <InfoRow icon="💶" label="Tarif net" value={p.tarif_net ? `${p.tarif_net} €/h` : null} />
                      <InfoRow icon="📍" label="Adresse" value={[p.rue || p.adresse, p.cp || p.code_postal, p.ville].filter(Boolean).join(", ") || null} />
                      <InfoRow icon="🌐" label="Langues" value={Array.isArray(p.langues) ? p.langues.join(", ") : p.langues} />
                    </>}
                    {p.role === "client" && <>
                      <InfoRow icon="📍" label="Adresse" value={[p.adresse || p.rue, p.code_postal || p.cp, p.ville].filter(Boolean).join(", ") || null} />
                      <InfoRow icon="🔄" label="Fréquence" value={p.frequence_besoins} />
                      <InfoRow icon="⏱️" label="Volume" value={p.volume_horaire ? `${p.volume_horaire}h/mois` : null} />
                    </>}
                    <InfoRow icon="💳" label="Plan" value={p.plan_abonnement || "free"} />
                    <InfoRow icon="📅" label="Fin abonnement" value={p.subscription_end_date ? new Date(p.subscription_end_date).toLocaleDateString("fr-FR") : null} />
                  </div>
                  {p.role === "prestataire" && p.bio && (
                    <div style={{ marginTop:8, padding:"8px 10px", background:"rgba(255,255,255,0.04)", borderRadius:8 }}>
                      <div style={{ color:"rgba(255,255,255,0.4)", fontSize:10, fontWeight:600, marginBottom:4 }}>BIO</div>
                      <div style={{ color:"rgba(255,255,255,0.7)", lineHeight:1.6 }}>{p.bio}</div>
                    </div>
                  )}
                  {p.role === "prestataire" && Array.isArray(p.competences) && p.competences.length > 0 && (
                    <div style={{ marginTop:8 }}>
                      <div style={{ color:"rgba(255,255,255,0.4)", fontSize:10, fontWeight:600, marginBottom:4 }}>COMPÉTENCES</div>
                      <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
                        {p.competences.map((c, i) => (
                          <span key={i} style={{ background:"rgba(124,111,224,0.15)", border:"1px solid rgba(124,111,224,0.3)", borderRadius:6, padding:"2px 8px", color:C.violet, fontSize:10, fontWeight:600 }}>{c}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {p.role === "client" && Array.isArray(p.secteurs_besoins) && p.secteurs_besoins.length > 0 && (
                    <div style={{ marginTop:8 }}>
                      <div style={{ color:"rgba(255,255,255,0.4)", fontSize:10, fontWeight:600, marginBottom:4 }}>SECTEURS RECHERCHÉS</div>
                      <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
                        {p.secteurs_besoins.map((s, i) => (
                          <span key={i} style={{ background:"rgba(240,180,41,0.12)", border:"1px solid rgba(240,180,41,0.3)", borderRadius:6, padding:"2px 8px", color:"#F0B429", fontSize:10, fontWeight:600 }}>{s}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {p.role === "client" && Array.isArray(p.metiers_besoins) && p.metiers_besoins.length > 0 && (
                    <div style={{ marginTop:8 }}>
                      <div style={{ color:"rgba(255,255,255,0.4)", fontSize:10, fontWeight:600, marginBottom:4 }}>MÉTIERS RECHERCHÉS</div>
                      <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
                        {p.metiers_besoins.map((m, i) => (
                          <span key={i} style={{ background:"rgba(124,111,224,0.12)", border:"1px solid rgba(124,111,224,0.3)", borderRadius:6, padding:"2px 8px", color:C.violet, fontSize:10, fontWeight:600 }}>{m}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {p.role === "client" && Array.isArray(p.lieux_intervention) && p.lieux_intervention.length > 0 && (
                    <div style={{ marginTop:8 }}>
                      <div style={{ color:"rgba(255,255,255,0.4)", fontSize:10, fontWeight:600, marginBottom:4 }}>LIEUX D'INTERVENTION</div>
                      {p.lieux_intervention.map((l, i) => (
                        <div key={i} style={{ color:"rgba(255,255,255,0.7)", fontSize:11, marginBottom:2 }}>
                          📍 {[l.adresse, l.codePostal, l.ville].filter(Boolean).join(", ")}
                        </div>
                      ))}
                    </div>
                  )}
                  {!p.telephone && !p.rib && !p.societe_nom && !p.kbis && !p.secteur && !p.adresse && !p.frequence_besoins && (
                    <div style={{ color:"rgba(255,255,255,0.3)" }}>Aucune donnée supplémentaire</div>
                  )}
                </div>
              )}

              {/* ── Documents uploadés (prestataires uniquement) ── */}
              {p.role === "prestataire" && (
                <div style={{ marginTop:12, paddingTop:10, borderTop:"1px solid rgba(255,255,255,0.07)" }}>
                  <button onClick={()=>{ if(!docs[p.id]) loadDocs(p.id); }} style={{ padding:"6px 12px", borderRadius:8, border:`1px solid ${C.violet}44`, background:"transparent", color:C.violet, fontSize:11, fontWeight:700, cursor:"pointer", fontFamily:"inherit", marginBottom:8 }}>
                    {docsLoading[p.id] ? "Chargement…" : docs[p.id] ? `📂 ${docs[p.id].length} document(s)` : "📂 Voir les documents"}
                  </button>
                  {docs[p.id] && docs[p.id].length === 0 && <div style={{ fontSize:11, color:"rgba(255,255,255,0.3)", marginBottom:8 }}>Aucun document uploadé</div>}
                  {docs[p.id] && docs[p.id].map(doc => (
                    <div key={doc.id} style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 10px", background:"rgba(255,255,255,0.04)", borderRadius:8, marginBottom:5 }}>
                      <span style={{ fontSize:14 }}>{doc.type==="kbis"?"🏢":doc.type==="urssaf"?"🏛️":doc.type==="cni"?"🪪":doc.type==="rib"?"💳":doc.type==="rc_pro"||doc.type==="rcpro"?"🛡️":doc.type==="photo"?"📸":doc.type==="domicile"?"🏠":doc.type==="diplomes"?"🎓":"📄"}</span>
                      <span style={{ flex:1, fontSize:11, color:"rgba(255,255,255,0.7)", textTransform:"capitalize" }}>{doc.type}</span>
                      <span style={{ fontSize:10, color: doc.verified ? C.success : C.accentGold, fontWeight:700 }}>{doc.verified ? "✓ Vérifié" : "En attente"}</span>
                      {doc.signedUrl && <a href={doc.signedUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize:10, color:C.violet, fontWeight:700, textDecoration:"none", padding:"3px 8px", border:`1px solid ${C.violet}44`, borderRadius:6 }}>Voir</a>}
                      {!doc.verified && <button onClick={()=>handleVerifyDoc(p.id, doc.id)} disabled={docVerifying===doc.id} style={{ fontSize:10, color:C.success, fontWeight:700, background:`${C.success}15`, border:`1px solid ${C.success}44`, borderRadius:6, padding:"3px 8px", cursor:"pointer", fontFamily:"inherit", opacity:docVerifying===doc.id?0.5:1 }}>✓ Valider</button>}
                    </div>
                  ))}
                  {/* Bouton valider l'accès aux missions */}
                  <div style={{ marginTop:10, paddingTop:10, borderTop:"1px solid rgba(255,255,255,0.07)" }}>
                    {p.missions_enabled ? (
                      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                        <div style={{ padding:"9px 14px", borderRadius:10, background:`${C.success}15`, border:`1px solid ${C.success}44`, color:C.success, fontWeight:700, fontSize:12, display:"inline-block" }}>✅ Missions activées</div>
                        <button onClick={()=>handleAction(p.id,"disable_missions")} disabled={!!actioning} style={{ padding:"7px 14px", borderRadius:10, border:`1px solid rgba(240,80,80,0.4)`, background:"rgba(240,80,80,0.1)", color:"#F25E5E", fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit", opacity:actioning?0.5:1 }}>
                          {actioning===p.id+"disable_missions" ? "…" : "🚫 Désactiver"}
                        </button>
                      </div>
                    ) : (
                      <button onClick={()=>handleAction(p.id,"enable_missions")} disabled={!!actioning} style={{ padding:"9px 18px", borderRadius:10, border:"none", background:C.success, color:"#fff", fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit", opacity:actioning?0.5:1 }}>
                        {actioning===p.id+"enable_missions" ? "…" : "✅ Activer l'accès aux missions"}
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
                          {verifs[p.id].siret.siege && <span style={{ color:"rgba(255,255,255,0.4)", marginLeft:6 }}>({verifs[p.id].siret.siege})</span>}
                          {verifs[p.id].siret.apiError && <span style={{ color:"rgba(255,255,255,0.3)", marginLeft:6 }}>{verifs[p.id].siret.apiError}</span>}
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
            <button onClick={()=>{ setDeleteReason(""); setDeleteModal({ profileId:p.id, name:`${p.prenom||""} ${p.nom||""}`.trim()||p.email, email:p.email }); }} disabled={!!actioning} style={{ padding:"9px 14px", borderRadius:10, border:"1px solid rgba(242,94,94,0.3)", background:"transparent", color:"rgba(242,94,94,0.7)", fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit", opacity:actioning?0.5:1 }}>
              {actioning===p.id+"delete" ? "…" : "🗑️"}
            </button>
          </div>
        </div>
      ))}

      {deleteModal && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000, padding:20 }}>
          <div style={{ background:"#0D1B3E", borderRadius:16, padding:24, width:"100%", maxWidth:400, border:"1px solid rgba(242,94,94,0.3)" }}>
            <h3 style={{ color:"#F25E5E", fontSize:15, fontWeight:800, margin:"0 0 8px" }}>Supprimer le compte</h3>
            <p style={{ color:"rgba(255,255,255,0.7)", fontSize:13, margin:"0 0 16px" }}>
              Vous allez supprimer définitivement le compte de <strong style={{ color:"#fff" }}>{deleteModal.name}</strong>. Un email sera envoyé à cette personne.
            </p>
            <label style={{ color:"rgba(255,255,255,0.5)", fontSize:12, fontWeight:600, display:"block", marginBottom:6 }}>RAISON (optionnelle)</label>
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
        <div style={{ textAlign:"center", color:"rgba(255,255,255,0.4)", padding:"32px 0", fontSize:13 }}>Chargement…</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign:"center", color:"rgba(255,255,255,0.3)", padding:"32px 0", fontSize:13 }}>Aucun ticket</div>
      ) : filtered.map(t => (
        <div key={t.id} style={{ background:"#0D1B3E", border:`1px solid rgba(255,255,255,0.07)`, borderRadius:14, padding:"14px 16px", marginBottom:10 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:8 }}>
            <div>
              <div style={{ color:C.white, fontWeight:700, fontSize:13 }}>{t.subject}</div>
              <div style={{ color:"rgba(255,255,255,0.4)", fontSize:11, marginTop:2 }}>{t.user_name||"Anonyme"} · {t.user_email||""}</div>
              <div style={{ color:"rgba(255,255,255,0.25)", fontSize:10, marginTop:2 }}>{new Date(t.created_at).toLocaleString("fr-FR")}</div>
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

export function BOModerationTab({ d }) {
  const [suspendEmail, setSuspendEmail]   = useState("");
  const [suspendReason, setSuspendReason] = useState("");
  const [suspending, setSuspending]       = useState(false);
  const [suspendResult, setSuspendResult] = useState(null);
  const [commMsg, setCommMsg]             = useState("");
  const [commSending, setCommSending]     = useState(false);
  const [commResult, setCommResult]       = useState(null);
  const [lastSync, setLastSync]           = useState(null);

  const handleSuspend = async () => {
    if(!suspendEmail.trim()) return;
    setSuspending(true); setSuspendResult(null);
    try {
      const r = await boFetch({ action:"list" });
      const users = await r.json();
      const user = (Array.isArray(users)?users:[]).find(u=>u.email===suspendEmail.trim());
      if(!user) { setSuspendResult({ ok:false, msg:"Email introuvable" }); setSuspending(false); return; }
      const r2 = await boFetch({ action:"reject", profileId: user.id });
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
        <textarea value={commMsg} onChange={e=>setCommMsg(e.target.value)} placeholder="Message à envoyer à tous les prestataires actifs…" rows={3}
          style={{ width:"100%", background:"rgba(255,255,255,0.06)", border:`1px solid ${C.border}`, borderRadius:8, padding:"10px 12px", color:C.text, fontSize:13, fontFamily:"inherit", boxSizing:"border-box", resize:"vertical", marginBottom:10 }} />
        <button onClick={handleComm} disabled={commSending||!commMsg.trim()}
          style={{ padding:"10px 20px", borderRadius:10, border:"none", background:C.violet, color:C.white, fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit", opacity:commSending||!commMsg.trim()?0.5:1 }}>
          {commSending?"Envoi…":"📧 Envoyer"}
        </button>
        {commResult && <div style={{ marginTop:8, fontSize:12, color:commResult.ok?C.success:C.accent, fontWeight:600 }}>{commResult.ok?"✅":"❌"} {commResult.msg}</div>}
      </div>

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

export function BOExportCSV({ d }) {
  const [exporting, setExporting] = useState(false);
  const doExport = async () => {
    setExporting(true);
    try {
      const r = await boFetch({ action:"list" });
      const users = await r.json();
      const rows = [["ID","Prénom","Nom","Email","Rôle","Statut","Téléphone","IBAN","Type compte","Société","Créé le"]];
      (Array.isArray(users) ? users : []).forEach(u => {
        rows.push([u.id,u.prenom||"",u.nom||"",u.email||"",u.role||"",u.status||"",u.telephone||"",u.rib||"",u.type_compte||"",u.societe_nom||"",u.created_at?.slice(0,10)||""]);
      });
      const csv = rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
      const blob = new Blob(["﻿"+csv], { type:"text/csv;charset=utf-8;" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href = url; a.download = `alane-comptes-${new Date().toISOString().slice(0,10)}.csv`;
      a.click(); URL.revokeObjectURL(url);
    } catch(_) {}
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
      const missions = await r.json();
      const COMMISSION = 0.20;
      const rows = [["ID","Date création","Date mission","Secteur","Métier","Heures","Tarif/h (€)","Montant TTC (€)","Commission ALANE (€)","Net prestataire (€)","Statut","Stripe ID"]];
      (Array.isArray(missions) ? missions : []).forEach(m => {
        const montant = Number(m.montant_total) || 0;
        const comm    = Math.round(montant * COMMISSION * 100) / 100;
        const net     = Math.round((montant - comm) * 100) / 100;
        rows.push([m.id, m.created_at?.slice(0,10)||"", m.date||"", m.sector||"", m.metier||"", m.hours||"", m.tarif_horaire||"", montant, comm, net, m.status||"", m.stripe_payment_intent||""]);
      });
      const csv = rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
      const blob = new Blob(["﻿"+csv], { type:"text/csv;charset=utf-8;" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href = url; a.download = `alane-missions-comptable-${new Date().toISOString().slice(0,10)}.csv`;
      a.click(); URL.revokeObjectURL(url);
    } catch(_) {}
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
      `CA Total (missions terminées) : ${d.finance?.caTotal || 0} €`,
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
    const keys = Object.keys(localStorage).filter(k => k.startsWith("alane_onboarded"));
    keys.forEach(k => localStorage.removeItem(k));
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
    distance:"0,5 km", responseTime:"~2 min", missions:42, bio:"Prestataire fictif pour les tests BO.",
  };

  const clientScreens = [
    { id:"home",              label:"Accueil client",          icon:"🏠" },
    { id:"catalogue",         label:"Catalogue secteurs",      icon:"🗂️" },
    { id:"search_filters",    label:"Recherche / filtres",     icon:"🔍" },
    { id:"dashboard",         label:"Dashboard client",        icon:"📊" },
    { id:"mission_history",   label:"Historique missions",     icon:"📋" },
    { id:"cashback",          label:"Wallet cashback",         icon:"💰" },
    { id:"notifications",     label:"Notifications",           icon:"🔔" },
    { id:"favorites",         label:"Favoris",                 icon:"❤️" },
    { id:"mission_request",   label:"Créer une mission",       icon:"➕" },
    { id:"team_booking",      label:"Réservation équipe",      icon:"👥" },
    { id:"settings",          label:"Paramètres",              icon:"⚙️" },
  ];

  const clientFlowScreens = [
    { id:"profile",     label:"Profil prestataire",   icon:"👤", data:MOCK_P },
    { id:"cv",          label:"CV prestataire",        icon:"📄", data:MOCK_P },
    { id:"booking",     label:"Réservation",           icon:"📅", data:MOCK_P },
    { id:"contract",    label:"Contrat",               icon:"✍️", data:MOCK_P },
    { id:"tracking",    label:"Suivi mission",         icon:"📍", data:MOCK_P },
    { id:"validation",  label:"Validation mission",    icon:"✅", data:MOCK_P },
    { id:"rating",      label:"Noter le prestataire",  icon:"⭐", data:MOCK_P },
    { id:"cancellation",label:"Annulation",            icon:"❌", data:MOCK_P },
    { id:"invoice",     label:"Facture",               icon:"🧾", data:MOCK_P },
    { id:"payslip",     label:"Facture prestataire",   icon:"🧾", data:MOCK_P },
  ];

  const prestaScreens = [
    { id:"p_home",              label:"Accueil prestataire",  icon:"🏠" },
    { id:"p_missions",          label:"Missions disponibles", icon:"📦" },
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
    const token = sessionStorage.getItem("bo_token");
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
  const [localCbr, setLocalCbr] = useState([{ id:"standard",min:0,max:2,rate:"0.5" },{ id:"silver",min:3,max:5,rate:"0.75" },{ id:"gold",min:6,max:9,rate:"1" },{ id:"platinum",min:10,max:999,rate:"1.5" }]);
  const [localSmp, setLocalSmp] = useState("30");
  const [sectorCounts, setSectorCounts] = useState({});

  useEffect(() => {
    boFetch({ action: "get_settings" }).then(r => r.json()).then(s => {
      if (s.plan_limits)             setLocalPl(s.plan_limits);
      if (s.subscription_prices)     setLocalSp(s.subscription_prices);
      if (s.urgency_surcharge != null) setLocalUs(String(s.urgency_surcharge));
      if (s.frais_service) setLocalFs({ single: String(s.frais_service.single ?? "4.90"), range: String(s.frais_service.range ?? "2.90"), urgent: String(s.frais_service.urgent ?? "9.90") });
      if (s.disabled_sectors)        setLocalDs(s.disabled_sectors);
      if (s.cashback_rates)          setLocalCbr(s.cashback_rates.map(t => ({ ...t, rate: String(Math.round(t.rate * 1000) / 10) })));
      if (s.sector_min_prestataires != null) setLocalSmp(String(s.sector_min_prestataires));
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

  const save = async (key, value) => {
    setSaving(p => ({ ...p, [key]: true }));
    const r = await boFetch({ action: "save_settings", key, value });
    const j = await r.json();
    setSaving(p => ({ ...p, [key]: false }));
    if (j.ok) { setSaved(p => ({ ...p, [key]: true })); setTimeout(() => setSaved(p => ({ ...p, [key]: false })), 2000); }
    else alert("Erreur : " + (j.error || "inconnue"));
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
      <SectionTitle>📦 Plans & Limites missions/mois</SectionTitle>
      <div style={{ background:"#0D1B3E", borderRadius:12, padding:16, marginBottom:8 }}>
        {[["free","🆓 Gratuit"],["premium","⭐ Premium"],["elite","👑 Elite"]].map(([plan, label]) => (
          <div key={plan} style={{ display:"flex", alignItems:"center", gap:12, marginBottom:10 }}>
            <span style={{ color:C.text, fontSize:13, fontWeight:600, width:120 }}>{label}</span>
            <input type="number" min={1} max={9999} value={localPl[plan]} onChange={e => setLocalPl(p => ({ ...p, [plan]: Number(e.target.value) }))}
              style={{ width:80, padding:"7px 10px", borderRadius:8, border:`1px solid ${C.border}`, background:"rgba(255,255,255,0.06)", color:C.text, fontSize:13, fontFamily:"inherit", textAlign:"center" }} />
            <span style={{ color:C.textSub, fontSize:12 }}>missions/mois</span>
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
                    <input type="number" min={1} value={localSp[plan]?.[period] ?? ""} onChange={e => setLocalSp(p => ({ ...p, [plan]: { ...p[plan], [period]: Number(e.target.value) } }))}
                      style={{ width:80, padding:"7px 10px", borderRadius:8, border:`1px solid ${C.border}`, background:"rgba(255,255,255,0.06)", color:C.text, fontSize:13, fontFamily:"inherit", textAlign:"center" }} />
                    <span style={{ color:C.textSub, fontSize:12 }}>€</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
        <SaveBtn k="subscription_prices" onClick={() => save("subscription_prices", localSp)} />
      </div>

      {/* ── Secteurs ── */}
      <SectionTitle>🗂️ Secteurs d'activité</SectionTitle>
      <div style={{ background:"#0D1B3E", borderRadius:12, padding:16, marginBottom:8 }}>
        <div style={{ color:C.textSub, fontSize:12, marginBottom:12 }}>Les secteurs désactivés sont masqués pour les clients.</div>
        {Object.entries(SECTOR_LABELS).map(([id, label]) => {
          const disabled = localDs.includes(id);
          return (
            <div key={id} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"8px 0", borderBottom:`1px solid ${C.grayLight}` }}>
              <span style={{ color: disabled ? C.textMuted : C.text, fontSize:13, fontWeight:600 }}>{SECTORS.find(s => s.id === id)?.icon} {label}</span>
              <div onClick={() => setLocalDs(prev => disabled ? prev.filter(x => x !== id) : [...prev, id])}
                style={{ width:40, height:22, borderRadius:11, background:disabled?"rgba(242,94,94,0.4)":C.success, position:"relative", cursor:"pointer", transition:"background 0.2s", flexShrink:0 }}>
                <div style={{ position:"absolute", top:2, left:disabled?2:20, width:18, height:18, borderRadius:"50%", background:"#fff", transition:"left 0.2s" }} />
              </div>
            </div>
          );
        })}
        <div style={{ marginTop:12 }}>
          <SaveBtn k="disabled_sectors" onClick={() => save("disabled_sectors", localDs)} />
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
            <input type="number" min={0} step={0.1} value={localFs[key]} onChange={e => setLocalFs(p => ({ ...p, [key]: e.target.value }))}
              style={{ width:70, padding:"7px 10px", borderRadius:8, border:`1px solid ${C.border}`, background:"rgba(255,255,255,0.06)", color:C.text, fontSize:13, fontFamily:"inherit", textAlign:"center" }} />
            <span style={{ color:C.textSub, fontSize:12 }}>€</span>
          </div>
        ))}
        <div style={{ marginBottom:16 }}>
          <SaveBtn k="frais_service" onClick={() => save("frais_service", { single: Number(localFs.single), range: Number(localFs.range), urgent: Number(localFs.urgent) })} />
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
          Un secteur n'est visible et accessible aux clients que si le nombre minimum de prestataires approuvés est atteint.
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:16 }}>
          <span style={{ color:C.text, fontSize:13, fontWeight:600, width:220 }}>Minimum prestataires / secteur</span>
          <input type="number" min={1} max={9999} value={localSmp} onChange={e => setLocalSmp(e.target.value)}
            style={{ width:80, padding:"7px 10px", borderRadius:8, border:`1px solid ${C.border}`, background:"rgba(255,255,255,0.06)", color:C.text, fontSize:13, fontFamily:"inherit", textAlign:"center" }} />
          <SaveBtn k="sector_min_prestataires" onClick={() => save("sector_min_prestataires", Number(localSmp))} />
        </div>
        <div style={{ borderTop:`1px solid ${C.border}`, paddingTop:12 }}>
          <div style={{ color:C.textSub, fontSize:11, marginBottom:8, fontWeight:600, textTransform:"uppercase", letterSpacing:.5 }}>État actuel des secteurs</div>
          {SECTORS.map(s => {
            const sc = sectorCounts[s.id];
            const min = sc?.min ?? Number(localSmp);
            const count = sc?.count ?? 0;
            const isOpen = sc ? sc.open : false;
            const pct = Math.min(100, Math.round((count / min) * 100));
            return (
              <div key={s.id} style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
                <span style={{ fontSize:16, flexShrink:0 }}>{s.icon}</span>
                <span style={{ color:C.text, fontSize:12, fontWeight:600, width:110, flexShrink:0 }}>{s.label}</span>
                <div style={{ flex:1, height:6, borderRadius:99, background:"rgba(255,255,255,0.06)", overflow:"hidden" }}>
                  <div style={{ height:"100%", width:`${pct}%`, borderRadius:99, background: isOpen ? "#4CAF8A" : "#F0B429", transition:"width .3s" }} />
                </div>
                <span style={{ color: isOpen ? "#4CAF8A" : C.textMuted, fontSize:11, fontWeight:700, width:60, textAlign:"right", flexShrink:0 }}>{count}/{min}</span>
                <span style={{ fontSize:11, fontWeight:700, color: isOpen ? "#4CAF8A" : "#F0B429", width:80, flexShrink:0 }}>{isOpen ? "✅ Ouvert" : "🔒 Fermé"}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Cashback ── */}
      <SectionTitle>🎁 Taux de cashback par palier</SectionTitle>
      <div style={{ background:"#0D1B3E", borderRadius:12, padding:16, marginBottom:8 }}>
        {localCbr.map((tier, i) => (
          <div key={tier.id} style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
            <span style={{ color:C.text, fontSize:13, fontWeight:600, width:90 }}>{tier.id}</span>
            <span style={{ color:C.textSub, fontSize:11, width:80 }}>{tier.min}–{tier.max === 999 ? "∞" : tier.max} missions</span>
            <input type="number" min={0} max={100} step={0.1} value={tier.rate} onChange={e => setLocalCbr(prev => prev.map((t, j) => j === i ? { ...t, rate: e.target.value } : t))}
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
    if (!window.confirm("Remettre les compteurs de missions à 0 pour tous les prestataires ?")) return;
    setLoading(true); setResult(null);
    try {
      const token = sessionStorage.getItem("bo_token") || "";
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

export function BORefundSection() {
  const [missions, setMissions] = useState([]);
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
    if (!window.confirm(`Rembourser ${m.montant_total} € pour la mission ${m.id.slice(0,8)} ?`)) return;
    setRefunding(m.id);
    const token = sessionStorage.getItem("bo_token") || "";
    const r = await fetch("/api/stripe-refund", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ paymentIntentId: m.stripe_payment_intent, missionId: m.id }),
    });
    const j = await r.json();
    setRefunding(null);
    if (j.ok) setDone(prev => ({ ...prev, [m.id]: true }));
    else alert(`Erreur : ${j.error}`);
  };

  if (loading) return <div style={{ color:C.textSub, fontSize:13, padding:"12px 0" }}>Chargement remboursements…</div>;
  if (!missions.length) return null;

  return (
    <div style={{ background:"#0D1B3E", borderRadius:16, padding:16, marginTop:4 }}>
      <div style={{ fontWeight:800, color:C.text, fontSize:13, marginBottom:12 }}>↩ Remboursements Stripe</div>
      {missions.map(m => (
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
  const { data: boData, loading: boLoading, visits: boVisits } = useBoData();
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
            <p style={{ color:"rgba(255,255,255,0.5)", fontSize:12, margin:"0 0 2px" }}>Administration</p>
            <h2 style={{ color:C.white, fontSize:20, fontWeight:800, margin:"0 0 2px", fontFamily:font.display }}>⚙️ Backoffice ALANE</h2>
            <p style={{ color:"rgba(255,255,255,0.5)", fontSize:12, margin:0 }}>Tableau de bord · Temps réel</p>
          </div>
          <div style={{ background:`${C.success}33`, borderRadius:8, padding:"4px 10px", color:C.success, fontSize:11, fontWeight:700 }}>● Actif</div>
        </div>
      </div>

      {/* Layout : sidebar gauche + contenu */}
      <div style={{ display:"flex", gap:0, padding:"18px 14px", alignItems:"flex-start" }}>

        {/* Sidebar onglets */}
        <div style={{ width:130, flexShrink:0, display:"flex", flexDirection:"column", gap:4, marginRight:14, position:"sticky", top:18 }}>
          {[
            {id:"dashboard",  l:"📊 KPIs"},
            {id:"comptes",    l:"✅ Comptes"},
            {id:"support",    l:"🎧 Support"},
            {id:"sectors",    l:"🗂️ Secteurs"},
            {id:"users",      l:"👥 Utilisateurs"},
            {id:"finance",    l:"💶 Finance"},
            {id:"moderation", l:"⚠️ Modération"},
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

        {/* ── SUPPORT ── */}
        {tab==="support" && <BOSupport />}

        {/* ── TEST ── */}
        {tab==="test" && <BOTest onNavigate={onNavigate} />}

        {/* ── LOGS ── */}
        {tab==="logs" && <BOLogs />}

        {/* ── DASHBOARD ── */}
        {tab==="dashboard" && <>
          {boLoading && <div style={{ textAlign:"center", color:C.textSub, fontSize:13, padding:"30px 0" }}>Chargement des données…</div>}

          {/* Reset mensuel manuel */}
          <BOResetMonthly />


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
            <KPICard icon="✅" label="Missions terminées" value={d.missions.terminees} sub={`${d.missions.tauxCompletion}% de taux`} color={C.success} />
            <KPICard icon="💶" label="CA total (€)" value={d.finance.caTotal > 0 ? `${(d.finance.caTotal/1000).toFixed(1)}k` : `${d.finance.caTotal} €`} sub="Missions complétées" color={C.accentGold} />
            <KPICard icon="📦" label="Missions actives" value={d.missions.open + d.missions.assigned} sub={`${d.missions.open} ouvertes · ${d.missions.assigned} assignées`} color="#7C6FE0" />
          </div>

          {/* Visiteurs */}
          <div style={{ background:"#0D1B3E", borderRadius:16, padding:"16px", marginBottom:14, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
              <div style={{ fontWeight:800, color:C.text, fontSize:13 }}>👁️ Visiteurs</div>
              <button onClick={async ()=>{
                if(!window.confirm("Remettre le compteur de visites à 0 ?")) return;
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

          {/* Missions par statut */}
          <div style={{ background:"#0D1B3E", borderRadius:16, padding:"16px", marginBottom:14, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
            <div style={{ fontWeight:800, color:C.text, fontSize:13, marginBottom:14 }}>📋 Statut des missions</div>
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

          {/* Missions créées par mois */}
          {d.monthLabels.length > 0 && (() => {
            const vals = d.monthLabels.map((_,i) => Object.values(d.missionsByMonth)[i] || 0);
            const max = Math.max(...vals, 1);
            return (
              <div style={{ background:"#0D1B3E", borderRadius:16, padding:"16px", marginBottom:14, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
                <div style={{ fontWeight:800, color:C.text, fontSize:13, marginBottom:12 }}>📅 Missions créées par mois</div>
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
              <div style={{ fontWeight:800, color:C.text, fontSize:14, marginBottom:4 }}>Répartition des missions</div>
              <div style={{ color:C.textSub, fontSize:12 }}>Total : {d.missions.total} missions</div>
              {d.sectors[0] && <div style={{ marginTop:8 }}>
                <div style={{ fontSize:12, color:C.textSub }}>Secteur #1</div>
                <div style={{ fontWeight:800, color:C.text, fontSize:14 }}>{d.sectors[0].icon} {d.sectors[0].label} ({d.sectors[0].pct}%)</div>
              </div>}
              {d.sectors.length === 0 && <div style={{ marginTop:8, fontSize:12, color:C.textMuted }}>Aucune mission pour l'instant</div>}
            </div>
          </div>
          {d.sectors.map((s,i) => (
            <div key={i} style={{ background:"#0D1B3E", borderRadius:r, padding:"13px 14px", marginBottom:9, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                  <div style={{ width:34, height:34, borderRadius:10, background:`${s.color}22`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 }}>{s.icon}</div>
                  <div>
                    <div style={{ fontWeight:700, color:C.text, fontSize:13 }}>{s.label}</div>
                    <div style={{ color:C.textSub, fontSize:11 }}>{s.missions} missions</div>
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
          <div style={{ background:`linear-gradient(135deg,${C.violet},${C.indigo})`, borderRadius:18, padding:"20px", marginBottom:16, textAlign:"center" }}>
            <p style={{ color:"rgba(255,255,255,0.6)", fontSize:12, margin:"0 0 4px" }}>Chiffre d'affaires total plateforme</p>
            <div style={{ color:C.white, fontSize:36, fontWeight:900 }}>{d.finance.caTotal.toLocaleString()} €</div>
            <div style={{ color:"rgba(255,255,255,0.6)", fontSize:13, marginTop:4 }}>Missions complétées : <strong style={{ color:C.accentGold }}>{d.missions.terminees}</strong></div>
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:16 }}>
            {[{l:"CA total",v:`${d.finance.caTotal.toLocaleString()} €`,c:C.accentGold,i:"💰"},{l:"Panier moyen",v:`${(d.finance.caMoyen||0).toLocaleString()} €`,c:C.violet,i:"📊"},{l:"Missions terminées",v:d.missions.terminees,c:C.success,i:"✅"},{l:"Missions actives",v:d.missions.open+d.missions.assigned,c:"#7C6FE0",i:"📦"}].map(s=>(
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
            {d.sectors.slice(0,5).map((s,i) => {
              const comm = Math.round(d.finance.caTotal * (s.pct/100) * (MARGES[s.id]||0.20));
              return (
                <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 0", borderBottom:i<4?`1px solid ${C.grayLight}`:"none" }}>
                  <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                    <span>{s.icon}</span>
                    <span style={{ fontSize:13, color:C.text, fontWeight:600 }}>{s.label}</span>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontWeight:800, color:C.violet, fontSize:13 }}>{comm.toLocaleString()} €</div>
                    <div style={{ color:C.textSub, fontSize:10 }}>Marge {Math.round((MARGES[s.id]||0.20)*100)}%</div>
                  </div>
                </div>
              );
            })}
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

        {/* ── RÉGLAGES ── */}
        {tab==="reglages" && <BOSettingsTab />}
        </div>{/* fin contenu */}
      </div>{/* fin layout */}
    </div>
  );
}
