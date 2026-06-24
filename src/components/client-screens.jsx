import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase.js";
import { C, font, r, shadow } from "../constants/colors.js";
import { CASHBACK_TIERS, getCashbackTier, calcCashback, ABONNEMENTS_PRESTA, prixClient, tarifInterim, economiePct, formatE, isLaunchPhase, FRAIS_MER } from "../constants/plans.js";
import { SECTORS, METIERS, METIERS_TARIFS, CV_DATA, FR_CITY_COORDS, PROVIDERS_CACHE_TTL, cpToCoords, genMissionCode, DOCS_REQUIS_CLIENT_PRO } from "../constants/data.js";
import { Btn, Badge, Input, Card, SectionHeader, StepHeader, Stars, Select, Divider, AddressAutocomplete, LaunchBadge, formatPhone, IbanInput } from "./ui.jsx";
import { useResponsive } from "../hooks/useResponsive.js";
import { StripePaymentScreen } from "./payment.jsx";

function ContractModal({ title, contractText, onSign, onClose }) {
  const [accepted, setAccepted] = useState(false);
  return (
    <div style={{ position:"fixed", top:0, left:0, right:0, bottom:0, background:"rgba(0,0,0,0.85)", zIndex:9999, display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ background:"#0D1B3E", borderRadius:20, padding:24, margin:20, maxWidth:560, width:"100%", maxHeight:"80vh", display:"flex", flexDirection:"column" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16, flexShrink:0 }}>
          <h3 style={{ color:C.violet, fontSize:16, fontWeight:800, margin:0, fontFamily:font.display }}>{title}</h3>
          <button onClick={onClose} style={{ background:"transparent", border:"none", color:C.textSub, cursor:"pointer", fontSize:20, lineHeight:1, padding:"0 4px" }}>×</button>
        </div>
        <div style={{ overflowY:"auto", flex:1, marginBottom:16, WebkitOverflowScrolling:"touch" }}>
          <pre style={{ color:C.textSub, fontSize:13, lineHeight:1.7, whiteSpace:"pre-wrap", fontFamily:"inherit", margin:0 }}>{contractText}</pre>
        </div>
        <div style={{ flexShrink:0 }}>
          <label style={{ display:"flex", alignItems:"flex-start", gap:10, cursor:"pointer", marginBottom:16 }}>
            <div onClick={()=>setAccepted(v=>!v)} style={{ width:20, height:20, borderRadius:5, border:`2px solid ${accepted ? C.violet : "#334"}`, background: accepted ? C.violet : "transparent", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", transition:"all 0.15s", marginTop:1 }}>
              {accepted && <span style={{ color:"#fff", fontSize:13, fontWeight:800, lineHeight:1 }}>✓</span>}
            </div>
            <span style={{ color:C.textSub, fontSize:13, lineHeight:1.5 }}>J'ai lu et j'accepte les termes de ce contrat</span>
          </label>
          <button
            disabled={!accepted}
            onClick={()=>{ if(accepted) onSign(new Date().toISOString()); }}
            style={{ width:"100%", padding:"14px", borderRadius:12, border:"none", background:C.violet, color:"#fff", fontWeight:800, fontSize:15, cursor:accepted?"pointer":"not-allowed", opacity:accepted?1:0.4, fontFamily:"inherit", transition:"opacity 0.15s" }}>
            Signer électroniquement →
          </button>
        </div>
      </div>
    </div>
  );
}


// INITIAL_WALLET default (pre-existing)
const INITIAL_WALLET = { balance: 0, missionsThisMonth: 0 };

export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2-lat1)*Math.PI/180;
  const dLon = (lon2-lon1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return +(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))).toFixed(1);
}

export function travelTimeStr(km) {
  const mins = Math.round((km / 30) * 60 / 5) * 5;
  return mins < 60 ? `~${mins} min` : `~${Math.round(mins / 60)}h`;
}

export function ContactSupportScreen({ onBack }) {
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent]       = useState(false);
  const [error, setError]     = useState("");

  const SUBJECTS = [
    "Problème de connexion",
    "Bug dans l'application",
    "Question sur mon compte",
    "Problème de paiement",
    "Signaler un utilisateur",
    "Autre",
  ];

  const handleSend = async () => {
    if (!subject) { setError("Choisissez un sujet"); return; }
    if (!message.trim() || message.length < 20) { setError("Message trop court (20 caractères minimum)"); return; }
    setLoading(true); setError("");

    const { data } = await supabase.auth.getUser();
    const user = data?.user;

    try {
      const res = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject,
          message,
          userEmail: user?.email || "",
          userName:  user?.user_metadata?.prenom || user?.email || "Inconnu",
          userId:    user?.id || "",
        }),
      });
      if (!res.ok) throw new Error("Erreur serveur");
      setSent(true);
    } catch {
      setError("Envoi échoué. Réessayez dans quelques instants.");
    }
    setLoading(false);
  };

  return (
    <div style={{ minHeight:"100%", background:C.bg, paddingBottom:80 }}>
      <div style={{ background:`linear-gradient(135deg,#0A1628,#162547)`, padding:"52px 22px 24px", borderBottom:`1px solid ${C.border}` }}>
        <button onClick={onBack} style={{ background:"transparent", border:"none", color:C.textSub, cursor:"pointer", fontSize:13, marginBottom:14, fontFamily:"inherit" }}>← Retour</button>
        <h2 style={{ color:C.text, fontSize:22, fontWeight:800, margin:0, fontFamily:font.display }}>🎧 Contacter le support</h2>
        <p style={{ color:C.textSub, fontSize:13, margin:"6px 0 0" }}>Notre équipe répond sous 24h ouvrées</p>
      </div>

      <div style={{ padding:"24px 18px" }}>
        {sent ? (
          <div style={{ textAlign:"center", paddingTop:40 }}>
            <div style={{ fontSize:52, marginBottom:16 }}>✅</div>
            <div style={{ fontWeight:800, color:C.text, fontSize:20, marginBottom:8 }}>Message envoyé !</div>
            <div style={{ color:C.textSub, fontSize:14, lineHeight:1.6, marginBottom:24 }}>
              Notre équipe va traiter votre demande et vous répondre par email sous 24h ouvrées.
            </div>
            <Btn onClick={onBack} style={{ background:C.violet }}>← Retour aux réglages</Btn>
          </div>
        ) : (
          <>
            <div style={{ background:`${C.violet}12`, border:`1px solid ${C.violet}30`, borderRadius:r, padding:"13px 15px", marginBottom:20, display:"flex", gap:10 }}>
              <span style={{ fontSize:18 }}>💬</span>
              <p style={{ color:C.textSub, fontSize:12, lineHeight:1.6, margin:0 }}>
                Décrivez votre problème en détail. Votre email de compte sera joint automatiquement pour qu'on puisse vous répondre.
              </p>
            </div>

            <div style={{ marginBottom:16 }}>
              <label style={{ display:"block", fontSize:12, color:C.textSub, fontWeight:600, marginBottom:8, textTransform:"uppercase", letterSpacing:0.8 }}>Sujet *</label>
              <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
                {SUBJECTS.map(s=>(
                  <button key={s} onClick={()=>setSubject(s)} style={{ padding:"9px 14px", borderRadius:20, border:`2px solid ${subject===s?C.violet:C.border}`, background:subject===s?`${C.violet}20`:"transparent", color:subject===s?C.violet:C.textSub, fontWeight:subject===s?700:500, fontSize:12, cursor:"pointer", fontFamily:"inherit", transition:"all 0.2s" }}>
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom:20 }}>
              <label style={{ display:"block", fontSize:12, color:C.textSub, fontWeight:600, marginBottom:8, textTransform:"uppercase", letterSpacing:0.8 }}>Votre message *</label>
              <textarea
                value={message} onChange={e=>setMessage(e.target.value)}
                placeholder="Décrivez votre problème ou question en détail : ce qui s'est passé, quand, sur quel écran…"
                style={{ width:"100%", padding:"14px", borderRadius:r, border:`1px solid ${C.border}`, fontSize:14, fontFamily:"inherit", resize:"none", height:140, boxSizing:"border-box", outline:"none", color:C.text, background:"#0D1B3E", lineHeight:1.6 }}
              />
              <div style={{ textAlign:"right", color:C.textMuted, fontSize:11, marginTop:4 }}>{message.length} caractères</div>
            </div>

            {error && <div style={{ background:"#F25E5E22", border:"1px solid #F25E5E55", borderRadius:r, padding:"10px 14px", marginBottom:14, color:"#F25E5E", fontSize:13 }}>{error}</div>}

            <Btn full onClick={handleSend} disabled={loading} style={{ fontSize:15, padding:"16px", background:C.violet, boxShadow:`0 8px 24px ${C.violet}44` }}>
              {loading ? "Envoi en cours…" : "📤 Envoyer ma demande"}
            </Btn>
          </>
        )}
      </div>
    </div>
  );
}

function DeleteAccountSection({ onLogout }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  const handleDelete = async () => {
    setDeleting(true); setDeleteError(null);
    try {
      const { data:{ session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Session expirée");
      const r = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ action: "delete_account" }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Erreur suppression");
      await supabase.auth.signOut();
      onLogout?.();
    } catch(e) {
      setDeleteError(e.message);
      setDeleting(false);
    }
  };

  return (
    <div style={{ marginTop:24, borderTop:`1px solid ${C.border}`, paddingTop:20 }}>
      <div style={{ fontWeight:700, color:C.textSub, fontSize:12, marginBottom:10, textTransform:"uppercase", letterSpacing:1 }}>Zone de danger</div>
      {!confirmDelete ? (
        <button onClick={()=>setConfirmDelete(true)} style={{ width:"100%", padding:"13px", borderRadius:r, border:`1px solid ${C.danger}44`, background:"transparent", color:C.danger, fontWeight:600, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
          🗑️ Supprimer mon compte (RGPD art. 17)
        </button>
      ) : (
        <div style={{ background:`${C.danger}12`, border:`1px solid ${C.danger}44`, borderRadius:14, padding:"14px 16px" }}>
          <div style={{ fontWeight:700, color:C.danger, fontSize:13, marginBottom:8 }}>⚠️ Cette action est irréversible</div>
          <div style={{ color:C.textSub, fontSize:12, lineHeight:1.6, marginBottom:14 }}>
            Vos données personnelles seront supprimées conformément au RGPD art. 17 (droit à l'effacement). L'historique des prestations sera anonymisé. Cette action ne peut pas être annulée.
          </div>
          {deleteError && <div style={{ color:C.danger, fontSize:12, marginBottom:10, fontWeight:600 }}>⚠️ {deleteError}</div>}
          <div style={{ display:"flex", gap:10 }}>
            <button onClick={()=>{ setConfirmDelete(false); setDeleteError(null); }} disabled={deleting} style={{ flex:1, padding:"11px", borderRadius:r, border:`1px solid ${C.border}`, background:"transparent", color:C.textSub, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>Annuler</button>
            <button onClick={handleDelete} disabled={deleting} style={{ flex:1, padding:"11px", borderRadius:r, border:"none", background:C.danger, color:"#fff", fontWeight:700, fontSize:13, cursor:deleting?"not-allowed":"pointer", fontFamily:"inherit" }}>{deleting?"Suppression...":"Confirmer la suppression"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function SettingsScreen({ role, onNavigate, onBack, onLogout }) {
  const [userEmail, setUserEmail] = useState("");
  const [userName, setUserName]   = useState("");
  const [showPassModal, setShowPassModal] = useState(false);
  const [newPass, setNewPass]     = useState("");
  const [passMsg, setPassMsg]     = useState(null);
  const [passSaving, setPassSaving] = useState(false);
  const handleChangePassword = async () => {
    if (newPass.length < 8) { setPassMsg({ err: true, text: "8 caractères minimum" }); return; }
    setPassSaving(true); setPassMsg(null);
    const { error } = await supabase.auth.updateUser({ password: newPass });
    setPassSaving(false);
    if (error) { setPassMsg({ err: true, text: error.message }); }
    else { setPassMsg({ err: false, text: "Mot de passe modifié ✓" }); setNewPass(""); setTimeout(() => setShowPassModal(false), 1500); }
  };
  const [lightMode, setLightMode] = useState(()=>{ try { return localStorage.getItem("alane_light_mode")==="1"; } catch(e) { return false; } });
  const toggleTheme = (v) => {
    try { localStorage.setItem("alane_light_mode", v ? "1" : "0"); } catch(e) {}
    document.documentElement.setAttribute("data-alane-theme", v ? "light" : "dark");
    setLightMode(v);
  };
  const [clientMeta, setClientMeta] = useState(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const [cpAdresse, setCpAdresse]     = useState("");
  const [cpCodePostal, setCpCodePostal] = useState("");
  const [cpVille, setCpVille]         = useState("");
  const [cpVolume, setCpVolume]       = useState("");
  const [cpFrequence, setCpFrequence] = useState("");
  const [cpIban, setCpIban]           = useState("");
  const [cpSaving, setCpSaving]       = useState(false);
  const [savedCard, setSavedCard]     = useState(null); // { pmId, customerId, brand, last4 }
  const [addingCard, setAddingCard]   = useState(false);
  const [cardSaving, setCardSaving]   = useState(false);
  const [cardError, setCardError]     = useState(null);
  const cardMountRef                  = useRef(null);
  const stripeCardRef                 = useRef(null);
  const stripeRef                     = useRef(null);
  const [cpSaved, setCpSaved]         = useState(false);
  const [editingIdentite, setEditingIdentite] = useState(false);
  const [editPrenom, setEditPrenom]   = useState("");
  const [editNom, setEditNom]         = useState("");
  const [editTelephone, setEditTelephone] = useState("");
  const [identiteSaving, setIdentiteSaving] = useState(false);
  const [identiteSaved, setIdentiteSaved]   = useState(false);

  useEffect(()=>{
    supabase.auth.getUser().then(({ data })=>{
      const user = data?.user;
      if(!user) return;
      setUserEmail(user.email||"");
      const m = user.user_metadata || {};
      if(role === "client") {
        setClientMeta(m);
        setCpAdresse(m.adresse||"");
        setCpCodePostal(m.code_postal||"");
        setCpVille(m.ville||"");
        setCpVolume(m.volume_horaire||"");
        setCpFrequence(m.frequence_besoins||"");
        setCpIban(m.rib||"");
        if (m.stripe_pm_id) setSavedCard({ pmId: m.stripe_pm_id, customerId: m.stripe_customer_id, brand: m.card_brand||"card", last4: m.card_last4||"••••" });
      }
      supabase.from("profiles").select("prenom,nom").eq("id",user.id).single()
        .then(({ data:p })=>{ if(p){ setUserName(`${p.prenom||""} ${p.nom||""}`.trim()); setEditPrenom(p.prenom||""); setEditNom(p.nom||""); } });
      setEditTelephone(m.telephone||"");
    });
  },[]);

  const handleOpenCardForm = async () => {
    setAddingCard(true); setCardError(null);
    await new Promise(r => setTimeout(r, 100)); // laisser le DOM se mettre à jour
    const { loadStripe } = await import("@stripe/stripe-js");
    const pk = import.meta.env.VITE_STRIPE_PUBLIC_KEY;
    if (!pk || !cardMountRef.current) return;
    const stripe = await loadStripe(pk);
    stripeRef.current = stripe;
    const elements = stripe.elements();
    const cardEl = elements.create("card", {
      hidePostalCode: true,
      style: { base: { color:"#e2e8f0", fontFamily:"inherit", fontSize:"15px", "::placeholder":{ color:"#64748b" } }, invalid: { color:"#f87171" } },
    });
    stripeCardRef.current = cardEl;
    cardEl.mount(cardMountRef.current);
  };

  const handleSaveCard = async () => {
    if (!stripeRef.current || !stripeCardRef.current) return;
    setCardSaving(true); setCardError(null);
    try {
      const { data: sd } = await supabase.auth.getSession();
      const token = sd?.session?.access_token;
      const r = await fetch("/api/stripe-intent", {
        method: "POST",
        headers: { "Content-Type":"application/json", ...(token?{"Authorization":`Bearer ${token}`}:{}) },
        body: JSON.stringify({ action:"setup_card", customerId: savedCard?.customerId||null }),
      });
      const { clientSecret, customerId, error: apiErr } = await r.json();
      if (apiErr) { setCardError(apiErr); setCardSaving(false); return; }
      const { setupIntent, error: stripeErr } = await stripeRef.current.confirmCardSetup(clientSecret, {
        payment_method: { card: stripeCardRef.current },
      });
      if (stripeErr) { setCardError(stripeErr.message); setCardSaving(false); return; }
      const pmId = setupIntent.payment_method;
      // Récupérer last4 + brand
      const pr = await fetch("/api/stripe-intent", {
        method: "POST",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify({ action:"get_pm", pmId }),
      });
      const { brand="card", last4="••••" } = await pr.json();
      await supabase.auth.updateUser({ data: { stripe_pm_id: pmId, stripe_customer_id: customerId, card_brand: brand, card_last4: last4 } });
      setSavedCard({ pmId, customerId, brand, last4 });
      stripeCardRef.current.destroy(); stripeCardRef.current = null;
      setAddingCard(false);
    } catch(e) { setCardError("Erreur lors de l'enregistrement"); }
    setCardSaving(false);
  };

  const handleRemoveCard = async () => {
    await supabase.auth.updateUser({ data: { stripe_pm_id: null, stripe_customer_id: null, card_brand: null, card_last4: null } });
    setSavedCard(null);
  };

  const handleSaveClientProfile = async () => {
    setCpSaving(true);
    await supabase.auth.updateUser({ data: {
      adresse: cpAdresse, code_postal: cpCodePostal, ville: cpVille,
      volume_horaire: cpVolume, frequence_besoins: cpFrequence,
      rib: cpIban,
    }});
    setCpSaving(false); setCpSaved(true);
    setTimeout(()=>{ setCpSaved(false); setEditingProfile(false); }, 1200);
  };

  const handleSaveIdentite = async () => {
    setIdentiteSaving(true);
    const { data } = await supabase.auth.getUser();
    const uid = data?.user?.id;
    if(uid) {
      await Promise.all([
        supabase.from("profiles").update({ prenom:editPrenom, nom:editNom }).eq("id",uid),
        supabase.auth.updateUser({ data:{ prenom:editPrenom, nom:editNom, telephone:editTelephone } }),
      ]);
      setUserName(`${editPrenom} ${editNom}`.trim());
    }
    setIdentiteSaving(false); setIdentiteSaved(true);
    setTimeout(()=>{ setIdentiteSaved(false); setEditingIdentite(false); }, 1200);
  };

  const sections = [
    {
      title:"Mon compte",
      items:[
        { icon:"👤", label:"Nom", value:userName||"—" },
        { icon:"✉️", label:"Email", value:userEmail||"—" },
        { icon:"🔑", label:"Changer le mot de passe", action:()=>{ setNewPass(""); setPassMsg(null); setShowPassModal(true); }, chevron:true },
      ]
    },
    {
      title:"Application",
      items:[
        { icon:"🔔", label:"Notifications", value:"Activées" },
        { icon:"🌍", label:"Langue", value:"Français" },
        { icon:"📄", label:"CGU & Politique de confidentialité", action:()=>onNavigate("legal","cgu"), chevron:true },
        { icon:"⚖️", label:"Mentions légales", action:()=>onNavigate("legal","mentions_legales"), chevron:true },
      ]
    },
    {
      title:"Aide",
      items:[
        { icon:"🎧", label:"Contacter le support", action:()=>onNavigate("contact_support"), chevron:true, highlight:true },
        { icon:"📖", label:"FAQ", action:()=>onNavigate("faq"), chevron:true },
      ]
    },
  ];

  return (
    <div style={{ minHeight:"100%", background:C.bg, paddingBottom:100 }}>
      <div style={{ background:`linear-gradient(135deg,#0A1628,#162547)`, padding:"52px 22px 24px", borderBottom:`1px solid ${C.border}` }}>
        <button onClick={onBack} style={{ background:"transparent", border:"none", color:C.textSub, cursor:"pointer", fontSize:13, marginBottom:14, fontFamily:"inherit" }}>← Retour</button>
        <h2 style={{ color:C.text, fontSize:22, fontWeight:800, margin:0, fontFamily:font.display }}>⚙️ Réglages</h2>
      </div>

      <div style={{ padding:"20px 18px" }}>
        {/* Avatar */}
        <div style={{ display:"flex", alignItems:"center", gap:14, background:"#0D1B3E", borderRadius:r, padding:"16px", marginBottom:20, border:`1px solid ${C.border}` }}>
          <div style={{ width:52, height:52, borderRadius:"50%", background:`${C.violet}30`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:24 }}>
            {role==="prestataire"?"👷":"🏢"}
          </div>
          <div>
            <div style={{ fontWeight:700, color:C.text, fontSize:16 }}>{userName||"Mon compte"}</div>
            <div style={{ color:C.textSub, fontSize:12, marginTop:2 }}>{userEmail}</div>
            <div style={{ color:C.violet, fontSize:11, fontWeight:600, marginTop:4 }}>{role==="prestataire"?"Prestataire":"Client"} ALANE</div>
          </div>
        </div>

        {/* Profil client éditable */}
        {/* Édition identité */}
        <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"16px", marginBottom:20 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
            <div style={{ fontWeight:700, color:C.text, fontSize:14 }}>Mes informations</div>
            <button onClick={()=>setEditingIdentite(!editingIdentite)} style={{ background:`${C.violet}20`, border:`1px solid ${C.violet}44`, borderRadius:8, padding:"5px 12px", color:C.violet, fontSize:11, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>{editingIdentite?"Annuler":"✏️ Modifier"}</button>
          </div>
          {!editingIdentite ? (
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              <div style={{ display:"flex", gap:8, alignItems:"center" }}><span style={{ fontSize:14 }}>👤</span><span style={{ color:C.textSub, fontSize:13 }}>{userName||"—"}</span></div>
              <div style={{ display:"flex", gap:8, alignItems:"center" }}><span style={{ fontSize:14 }}>✉️</span><span style={{ color:C.textSub, fontSize:13 }}>{userEmail||"—"}</span></div>
              {editTelephone && <div style={{ display:"flex", gap:8, alignItems:"center" }}><span style={{ fontSize:14 }}>📱</span><span style={{ color:C.textSub, fontSize:13 }}>{editTelephone}</span></div>}
            </div>
          ) : (
            <div>
              <div style={{ display:"flex", gap:10 }}>
                <div style={{ flex:1 }}><Input label="Prénom" placeholder="Prénom" icon="👤" value={editPrenom} onChange={e=>setEditPrenom(e.target.value)} /></div>
                <div style={{ flex:1 }}><Input label="Nom" placeholder="Nom" value={editNom} onChange={e=>setEditNom(e.target.value)} /></div>
              </div>
              <Input label="Téléphone" placeholder="06 12 34 56 78" icon="📱" value={editTelephone} onChange={e=>setEditTelephone(formatPhone(e.target.value))} />
              <Btn full onClick={handleSaveIdentite} disabled={identiteSaving} style={{ background:C.violet, padding:"13px" }}>
                {identiteSaving?"Enregistrement…":identiteSaved?"✅ Sauvegardé !":"Enregistrer"}
              </Btn>
            </div>
          )}
        </div>

        {role === "client" && (<>
          <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"16px", marginBottom:20 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
              <div style={{ fontWeight:700, color:C.text, fontSize:14 }}>Mon profil client</div>
              <button onClick={()=>setEditingProfile(!editingProfile)} style={{ background:`${C.violet}20`, border:`1px solid ${C.violet}44`, borderRadius:8, padding:"5px 12px", color:C.violet, fontSize:11, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>{editingProfile?"Annuler":"✏️ Modifier"}</button>
            </div>
            {!editingProfile ? (
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {clientMeta?.adresse && <div style={{ display:"flex", gap:8, alignItems:"center" }}><span style={{ fontSize:14 }}>📍</span><span style={{ color:C.textSub, fontSize:13 }}>{clientMeta.adresse}, {clientMeta.code_postal} {clientMeta.ville}</span></div>}
                {clientMeta?.frequence_besoins && <div style={{ display:"flex", gap:8, alignItems:"center" }}><span style={{ fontSize:14 }}>🔄</span><span style={{ color:C.textSub, fontSize:13, textTransform:"capitalize" }}>{clientMeta.frequence_besoins}</span></div>}
                {clientMeta?.volume_horaire && <div style={{ display:"flex", gap:8, alignItems:"center" }}><span style={{ fontSize:14 }}>⏱️</span><span style={{ color:C.textSub, fontSize:13 }}>{clientMeta.volume_horaire} / semaine</span></div>}
                {clientMeta?.secteurs_besoins?.length > 0 && <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginTop:4 }}>{clientMeta.secteurs_besoins.map(sid=>{ const s=SECTORS.find(x=>x.id===sid); return s?<span key={sid} style={{ background:`${s.color}20`, border:`1px solid ${s.color}44`, borderRadius:6, padding:"2px 8px", color:s.color, fontSize:11, fontWeight:600 }}>{s.icon} {s.label}</span>:null; })}</div>}
                {clientMeta?.rib && <div style={{ display:"flex", gap:8, alignItems:"center" }}><span style={{ fontSize:14 }}>🏦</span><span style={{ color:C.textSub, fontSize:13 }}>{clientMeta.rib.slice(0,8)}••••••••••••••</span></div>}
                {!clientMeta?.adresse && !clientMeta?.frequence_besoins && !clientMeta?.rib && <div style={{ color:C.textSub, fontSize:12 }}>Aucune information de profil renseignée.</div>}
              </div>
            ) : (
              <div>
                <Input label="Adresse" placeholder="12 rue de la Paix" icon="📍" value={cpAdresse} onChange={e=>setCpAdresse(e.target.value)} />
                <div style={{ display:"flex", gap:10 }}>
                  <div style={{ flex:1 }}><Input label="Code postal" placeholder="75001" value={cpCodePostal} onChange={e=>setCpCodePostal(e.target.value)} /></div>
                  <div style={{ flex:2 }}><Input label="Ville" placeholder="Paris" value={cpVille} onChange={e=>setCpVille(e.target.value)} /></div>
                </div>
                <IbanInput label="IBAN (pour remboursements)" placeholder="FR76 XXXX XXXX XXXX XXXX XXXX XXX" value={cpIban} onChange={e=>setCpIban(e.target.value.toUpperCase())} />
                <label style={{ display:"block", fontSize:11, color:C.textSub, fontWeight:600, marginBottom:8, textTransform:"uppercase", letterSpacing:0.8 }}>Fréquence des besoins</label>
                <div style={{ display:"flex", gap:8, marginBottom:14 }}>
                  {[{id:"ponctuel",label:"⏱ Ponctuel"},{id:"regulier",label:"📅 Régulier"},{id:"les-deux",label:"🔄 Les deux"}].map(f=>(
                    <button key={f.id} onClick={()=>setCpFrequence(f.id)} style={{ flex:1, padding:"9px 6px", borderRadius:r, border:`2px solid ${cpFrequence===f.id?C.violet:C.border}`, background:cpFrequence===f.id?`${C.violet}20`:"transparent", color:cpFrequence===f.id?C.violet:C.textSub, fontSize:11, fontWeight:cpFrequence===f.id?700:400, cursor:"pointer", fontFamily:"inherit" }}>{f.label}</button>
                  ))}
                </div>
                <label style={{ display:"block", fontSize:11, color:C.textSub, fontWeight:600, marginBottom:8, textTransform:"uppercase", letterSpacing:0.8 }}>Volume horaire estimé</label>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:14 }}>
                  {[{id:"<8h",l:"< 8h"},{id:"8-20h",l:"8–20h"},{id:"20-40h",l:"20–40h"},{id:">40h",l:"> 40h"}].map(v=>(
                    <button key={v.id} onClick={()=>setCpVolume(v.id)} style={{ padding:"9px", borderRadius:r, border:`2px solid ${cpVolume===v.id?C.violet:C.border}`, background:cpVolume===v.id?`${C.violet}20`:"transparent", color:cpVolume===v.id?C.violet:C.textSub, fontSize:12, fontWeight:cpVolume===v.id?700:400, cursor:"pointer", fontFamily:"inherit" }}>{v.l}</button>
                  ))}
                </div>
                <Btn full onClick={handleSaveClientProfile} disabled={cpSaving} style={{ background:C.violet, padding:"13px" }}>
                  {cpSaving?"Enregistrement…":cpSaved?"✅ Sauvegardé !":"Enregistrer"}
                </Btn>
              </div>
            )}
          </div>

        {/* Carte bancaire enregistrée */}
          <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"16px", marginBottom:20 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom: addingCard||savedCard ? 12 : 0 }}>
              <div>
                <div style={{ fontWeight:700, color:C.text, fontSize:14 }}>💳 Ma carte bancaire</div>
                {savedCard && !addingCard && <div style={{ color:C.textSub, fontSize:12, marginTop:3, textTransform:"capitalize" }}>{savedCard.brand} ••••{savedCard.last4}</div>}
                {!savedCard && !addingCard && <div style={{ color:C.textSub, fontSize:12, marginTop:3 }}>Aucune carte enregistrée</div>}
              </div>
              <div style={{ display:"flex", gap:8 }}>
                {savedCard && !addingCard && <button onClick={handleRemoveCard} style={{ background:"transparent", border:`1px solid ${C.border}`, borderRadius:8, padding:"5px 10px", color:C.textSub, fontSize:11, cursor:"pointer", fontFamily:"inherit" }}>Supprimer</button>}
                {!addingCard && <button onClick={handleOpenCardForm} style={{ background:`${C.violet}20`, border:`1px solid ${C.violet}44`, borderRadius:8, padding:"5px 12px", color:C.violet, fontSize:11, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>{savedCard?"✏️ Changer":"+ Ajouter"}</button>}
                {addingCard && <button onClick={()=>{ stripeCardRef.current?.destroy(); stripeCardRef.current=null; setAddingCard(false); setCardError(null); }} style={{ background:"transparent", border:`1px solid ${C.border}`, borderRadius:8, padding:"5px 10px", color:C.textSub, fontSize:11, cursor:"pointer", fontFamily:"inherit" }}>Annuler</button>}
              </div>
            </div>
            {addingCard && (
              <div>
                <div style={{ borderRadius:11, border:`1px solid ${C.border}`, background:"#162547", overflow:"hidden", marginBottom:10 }}>
                  <div ref={cardMountRef} style={{ padding:"14px", minHeight:50 }} />
                </div>
                {cardError && <div style={{ color:"#f87171", fontSize:12, marginBottom:8 }}>⚠️ {cardError}</div>}
                <Btn full onClick={handleSaveCard} disabled={cardSaving} style={{ background:C.violet, padding:"13px" }}>
                  {cardSaving?"Enregistrement…":"🔒 Enregistrer la carte"}
                </Btn>
              </div>
            )}
          </div>
        </>)}

        {sections.map(section=>(
          <div key={section.title} style={{ marginBottom:20 }}>
            <div style={{ fontSize:11, color:C.textMuted, fontWeight:700, letterSpacing:1, textTransform:"uppercase", marginBottom:8, paddingLeft:4 }}>{section.title}</div>
            <div style={{ background:"#0D1B3E", borderRadius:r, border:`1px solid ${C.border}`, overflow:"hidden" }}>
              {section.items.map((item, i)=>(
                <div key={item.label} onClick={item.action} style={{ display:"flex", alignItems:"center", gap:12, padding:"14px 16px", borderBottom:i<section.items.length-1?`1px solid ${C.border}`:"none", cursor:item.action?"pointer":"default", background:item.highlight?`${C.violet}08`:"transparent" }}>
                  <div style={{ width:32, height:32, borderRadius:10, background:item.highlight?`${C.violet}20`:`${C.border}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, flexShrink:0 }}>{item.icon}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:600, color:item.highlight?C.violet:C.text, fontSize:14 }}>{item.label}</div>
                    {item.value && <div style={{ color:C.textSub, fontSize:12, marginTop:1 }}>{item.value}</div>}
                  </div>
                  {item.chevron && <span style={{ color:C.textMuted, fontSize:16 }}>›</span>}
                </div>
              ))}
            </div>
          </div>
        ))}

        {role === "client" && clientMeta?.type_compte === "entreprise" && (
          <div style={{ marginBottom:20 }}>
            <div style={{ fontSize:11, color:C.textMuted, fontWeight:700, letterSpacing:1, textTransform:"uppercase", marginBottom:8, paddingLeft:4 }}>Compte professionnel</div>
            <div style={{ background:"#0D1B3E", borderRadius:r, border:`1px solid ${C.border}`, overflow:"hidden" }}>
              <div onClick={()=>onNavigate("client_pro_docs")} style={{ display:"flex", alignItems:"center", gap:12, padding:"14px 16px", cursor:"pointer" }}>
                <div style={{ width:32, height:32, borderRadius:10, background:`${C.violet}20`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, flexShrink:0 }}>📂</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:600, color:C.violet, fontSize:14 }}>Documents entreprise</div>
                  <div style={{ color:C.textSub, fontSize:12, marginTop:1 }}>KBIS, RIB, CNI gérant, Attestation TVA</div>
                </div>
                <span style={{ color:C.textMuted, fontSize:16 }}>›</span>
              </div>
            </div>
          </div>
        )}

        {/* Thème */}
        <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"14px 16px", marginBottom:14 }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <span style={{ fontSize:18 }}>{lightMode?"☀️":"🌙"}</span>
              <div>
                <div style={{ fontWeight:600, color:C.text, fontSize:14 }}>Thème {lightMode?"clair":"sombre"}</div>
                <div style={{ color:C.textSub, fontSize:12 }}>Modifier l'apparence de l'application</div>
              </div>
            </div>
            <div onClick={()=>toggleTheme(!lightMode)} style={{ width:44, height:24, borderRadius:12, background:lightMode?C.violet:"rgba(255,255,255,0.15)", position:"relative", cursor:"pointer", transition:"background 0.2s", flexShrink:0 }}>
              <div style={{ position:"absolute", top:3, left:lightMode?22:3, width:18, height:18, borderRadius:"50%", background:"#fff", transition:"left 0.2s", boxShadow:"0 1px 4px rgba(0,0,0,0.3)" }} />
            </div>
          </div>
        </div>

        {/* Déconnexion */}
        <button onClick={onLogout} style={{ width:"100%", padding:"15px", borderRadius:r, border:`1px solid #F25E5E44`, background:"#F25E5E12", color:"#F25E5E", fontWeight:700, fontSize:15, cursor:"pointer", fontFamily:"inherit", marginTop:8 }}>
          🚪 Se déconnecter
        </button>

        {/* Suppression RGPD */}
        <DeleteAccountSection onLogout={onLogout} />

        <p style={{ textAlign:"center", color:C.textMuted, fontSize:11, marginTop:20 }}>ALANE v1.0 · Tous droits réservés</p>
      </div>

      {/* Modal changement de mot de passe */}
      {showPassModal && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000, padding:20 }}>
          <div style={{ background:"#0D1B3E", borderRadius:16, padding:24, width:"100%", maxWidth:400, border:"1px solid rgba(255,255,255,0.12)" }}>
            <h3 style={{ color:C.text, fontSize:16, fontWeight:800, margin:"0 0 16px" }}>🔑 Changer le mot de passe</h3>
            <Input label="Nouveau mot de passe" type="password" placeholder="8 caractères minimum" value={newPass} onChange={e=>setNewPass(e.target.value)} />
            {passMsg && <div style={{ fontSize:12, color:passMsg.err?C.danger:C.success, fontWeight:600, marginBottom:10 }}>{passMsg.text}</div>}
            <div style={{ display:"flex", gap:10, marginTop:4 }}>
              <button onClick={()=>setShowPassModal(false)} style={{ flex:1, padding:"11px", borderRadius:10, border:"1px solid rgba(255,255,255,0.15)", background:"transparent", color:"rgba(255,255,255,0.6)", fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>Annuler</button>
              <button onClick={handleChangePassword} disabled={passSaving} style={{ flex:2, padding:"11px", borderRadius:10, border:"none", background:C.violet, color:"#fff", fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit", opacity:passSaving?0.6:1 }}>{passSaving?"…":"Modifier"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function ResetPasswordScreen({ onDone }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm]   = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");
  const [done, setDone]         = useState(false);

  const handleReset = async () => {
    if(!password || password.length < 6){ setError("Minimum 6 caractères"); return; }
    if(password !== confirm){ setError("Les mots de passe ne correspondent pas"); return; }
    setLoading(true); setError("");
    const { error:err } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if(err){ setError(err.message); return; }
    setDone(true);
    setTimeout(()=>onDone(), 2000);
  };

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(160deg,#050E20,#0A1628)`, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:32 }}>
      {done ? (
        <div style={{ textAlign:"center" }}>
          <div style={{ fontSize:48, marginBottom:16 }}>✅</div>
          <div style={{ fontWeight:800, color:C.text, fontSize:20, marginBottom:8 }}>Mot de passe mis à jour !</div>
          <div style={{ color:C.textSub, fontSize:14 }}>Redirection en cours…</div>
        </div>
      ) : (
        <div style={{ width:"100%", maxWidth:380 }}>
          <div style={{ textAlign:"center", marginBottom:32 }}>
            <div style={{ fontSize:40, marginBottom:12 }}>🔑</div>
            <h2 style={{ color:C.text, fontSize:22, fontWeight:800, margin:"0 0 8px", fontFamily:font.display }}>Nouveau mot de passe</h2>
            <p style={{ color:C.textSub, fontSize:14, margin:0 }}>Choisissez un mot de passe sécurisé</p>
          </div>
          <Input label="Nouveau mot de passe" type="password" placeholder="••••••••" icon="🔒" value={password} onChange={e=>setPassword(e.target.value)} />
          <Input label="Confirmer le mot de passe" type="password" placeholder="••••••••" icon="🔒" value={confirm} onChange={e=>setConfirm(e.target.value)} />
          {error && <div style={{ background:"#F25E5E22", border:"1px solid #F25E5E55", borderRadius:r, padding:"10px 14px", marginBottom:14, color:"#F25E5E", fontSize:13 }}>{error}</div>}
          <Btn full onClick={handleReset} disabled={loading} style={{ fontSize:15, padding:"16px", background:C.violet, boxShadow:`0 8px 24px ${C.violet}44` }}>
            {loading ? "Mise à jour…" : "Confirmer →"}
          </Btn>
        </div>
      )}
    </div>
  );
}

export const TOUR_STEPS = [
  {
    icon:"👋",
    title:"Bienvenue sur ALANE !",
    desc:"ALANE vous met en relation avec des prestataires qualifiés dans de nombreux secteurs. Voici comment ça marche en 4 étapes.",
    color:"#7C6FE0",
  },
  {
    icon:"🗂️",
    title:"1. Trouvez votre prestataire",
    desc:"Parcourez les secteurs (Logistique, Restauration, Hôtellerie…), filtrez par disponibilité, tarif ou note, et consultez les profils.",
    color:"#4FC3F7",
  },
  {
    icon:"📅",
    title:"2. Réservez & payez",
    desc:"Choisissez la date, la durée et confirmez. Le paiement est sécurisé via Stripe — vous n'êtes pas débité définitivement tant que la prestation n'est pas validée.",
    color:"#F0B429",
  },
  {
    icon:"⏳",
    title:"3. Le prestataire confirme",
    desc:"Il dispose d'un délai (1h si c'est aujourd'hui, 4h sinon) pour accepter ou refuser. Vous êtes notifié immédiatement de sa réponse.",
    color:"#81C784",
  },
  {
    icon:"✅",
    title:"4. Validez la prestation",
    desc:"Une fois la prestation terminée, validez-la depuis votre espace. Les fonds sont libérés au prestataire et vous gagnez du cashback !",
    color:"#F06292",
  },
];

export function ClientTour({ onDone }) {
  const [step, setStep] = useState(0);
  const s = TOUR_STEPS[step];
  const isLast = step === TOUR_STEPS.length - 1;
  return (
    <div style={{ position:"fixed", inset:0, zIndex:9999, background:"rgba(5,14,32,0.92)", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"24px 28px" }}>
      <div style={{ width:"100%", maxWidth:360, background:"#0D1B3E", borderRadius:24, overflow:"hidden", boxShadow:"0 24px 80px rgba(0,0,0,0.7)" }}>
        {/* Progress dots */}
        <div style={{ display:"flex", gap:6, justifyContent:"center", padding:"18px 0 0" }}>
          {TOUR_STEPS.map((_,i) => (
            <div key={i} style={{ width:i===step?22:7, height:7, borderRadius:4, background:i===step?s.color:"rgba(255,255,255,0.15)", transition:"all 0.3s" }} />
          ))}
        </div>
        {/* Icon */}
        <div style={{ textAlign:"center", padding:"24px 28px 0" }}>
          <div style={{ width:84, height:84, borderRadius:"50%", background:s.color+"20", border:`2px solid ${s.color}44`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:40, margin:"0 auto 20px" }}>{s.icon}</div>
          <h2 style={{ color:"#fff", fontSize:20, fontWeight:800, margin:"0 0 12px", fontFamily:font.display, lineHeight:1.2 }}>{s.title}</h2>
          <p style={{ color:"rgba(255,255,255,0.65)", fontSize:14, lineHeight:1.7, margin:0 }}>{s.desc}</p>
        </div>
        {/* Actions */}
        <div style={{ padding:"24px 28px 28px", display:"flex", gap:10 }}>
          {step > 0 && (
            <button onClick={()=>setStep(s=>s-1)} style={{ flex:1, padding:"13px", border:"1px solid rgba(255,255,255,0.15)", borderRadius:14, background:"transparent", color:"rgba(255,255,255,0.6)", fontSize:14, cursor:"pointer", fontFamily:"inherit", fontWeight:600 }}>← Précédent</button>
          )}
          <button onClick={()=>{ if(isLast) onDone(); else setStep(s=>s+1); }} style={{ flex:2, padding:"13px", border:"none", borderRadius:14, background:s.color, color:"#fff", fontSize:14, fontWeight:800, cursor:"pointer", fontFamily:"inherit" }}>
            {isLast ? "C'est parti ! 🚀" : "Suivant →"}
          </button>
        </div>
        {/* Skip */}
        {!isLast && (
          <button onClick={onDone} style={{ display:"block", width:"100%", padding:"0 0 18px", background:"none", border:"none", color:"rgba(255,255,255,0.3)", fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>Passer</button>
        )}
      </div>
    </div>
  );
}

export function HomeScreen({ onNavigate, notifCount=0 }) {
  const [urgentMode, setUrgentMode] = useState(false);
  const [showPwaBanner, setShowPwaBanner] = useState(false);
  const [missionsToValidate, setMissionsToValidate] = useState([]);
  const [missionsInProgress, setMissionsInProgress] = useState([]);
  const [inProgressTick, setInProgressTick] = useState(Date.now());
  const [inProgressDismissed, setInProgressDismissed] = useState(false);
  useEffect(() => {
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
    let dismissed; try { dismissed = localStorage.getItem("alane_pwa_banner"); } catch(e) {}
    if (isIOS && !isStandalone && !dismissed) setShowPwaBanner(true);
  }, []);
  const [userName, setUserName] = useState("");
  const [walletMissions, setWalletMissions] = useState(0);
  const [walletBalance,  setWalletBalance]  = useState(0);
  const [showTour, setShowTour] = useState(false);
  const [liveStats, setLiveStats] = useState({ openMissions: null, dispoNow: null, completedMonth: null });
  const [notifAsked, setNotifAsked] = useState(false);
  const { isDesktop } = useResponsive();
  const { providers, loading: providersLoading } = useProviders();
  const sectorStatus = useSectorStatus();
  const [launchPhaseHome, setLaunchPhaseHome] = useState(isLaunchPhase());
  useEffect(() => {
    supabase.from("platform_settings").select("value").eq("key","launch_phase").single()
      .then(({ data }) => { if (data?.value != null) setLaunchPhaseHome(Boolean(data.value)); });
  }, []);
  const tier = getCashbackTier(walletMissions);
  const nextTier = CASHBACK_TIERS[CASHBACK_TIERS.indexOf(tier) + 1];
  const missionsToNext = nextTier ? nextTier.min - walletMissions : 0;
  const tierProgress = nextTier
    ? Math.min(100, Math.max(8, (walletMissions / nextTier.min) * 100))
    : 8;

  useEffect(()=>{
    let notifAskedFlag; try { notifAskedFlag = localStorage.getItem("alane_notif_asked"); } catch(e) {}
    if("Notification" in window && Notification.permission === "default" && !notifAskedFlag) {
      setNotifAsked(true);
    }
  },[]);

  useEffect(()=>{
    let mounted = true;
    supabase.auth.getUser().then(({ data })=>{
      const user = data?.user;
      if (!user || !mounted) return;
      const tourKey = `alane_tour_done_${user.id}`;
      let tourDone; try { tourDone = localStorage.getItem(tourKey); } catch(e) {}
      if (!tourDone) setShowTour(true);
      supabase.from("profiles").select("prenom,cashback_balance,missions_completed_month").eq("id", user.id).single()
        .then(({ data: p }) => {
          if (!p || !mounted) return;
          if (p.prenom) setUserName(p.prenom);
          setWalletBalance(p.cashback_balance || 0);
          setWalletMissions(p.missions_completed_month || 0);
        });
    });
    return ()=>{ mounted=false; };
  }, []);

  useEffect(()=>{
    let mounted = true;
    Promise.all([
      supabase.from("missions").select("id", { count:"exact", head:true }).eq("status","open"),
      supabase.from("missions").select("id", { count:"exact", head:true }).eq("status","completed"),
    ]).then(([open, completed])=>{
      if (!mounted) return;
      setLiveStats({
        openMissions: open.count ?? 0,
        dispoNow: providers.filter(p => p.dispo_immediat).length,
        completedMonth: completed.count ?? 0,
      });
    });
    return ()=>{ mounted=false; };
  }, [providers]);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getUser().then(({ data }) => {
      const user = data?.user;
      if (!user || !mounted) return;
      supabase.from("missions")
        .select("id,metier,sector,date,heure_debut,hours,validation_prestataire")
        .eq("client_id", user.id)
        .eq("status", "assigned")
        .eq("validation_prestataire", true)
        .then(({ data: ms }) => {
          if (mounted && Array.isArray(ms)) setMissionsToValidate(ms);
        });
    });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    let mounted = true;
    const load = () => supabase.auth.getUser().then(({ data }) => {
      const user = data?.user;
      if (!user || !mounted) return;
      supabase.from("missions")
        .select("id,metier,sector,date,heure_debut,hours,tarif_horaire,ville,prestataire_id")
        .eq("client_id", user.id)
        .eq("status", "assigned")
        .then(({ data: ms }) => {
          if (!mounted || !Array.isArray(ms)) return;
          const now = Date.now();
          const active = ms.filter(m => {
            const start = m.date ? new Date(`${m.date}T${m.heure_debut || "00:00"}`).getTime() : 0;
            const end   = start  ? start + Number(m.hours || 1) * 3600000 : 0;
            return start > 0 && start < now && end > now;
          });
          setMissionsInProgress(active);
        });
    });
    load();
    const t = setInterval(load, 60000);
    return () => { mounted = false; clearInterval(t); };
  }, []);

  useEffect(() => {
    if (missionsInProgress.length === 0) return;
    const t = setInterval(() => setInProgressTick(Date.now()), 30000);
    return () => clearInterval(t);
  }, [missionsInProgress.length]);

  const violetLite = "#A29BFE";

  const dismissTour = async () => {
    setShowTour(false);
    const { data } = await supabase.auth.getUser();
    const user = data?.user;
    if (user) { try { localStorage.setItem(`alane_tour_done_${user.id}`, "1"); } catch(e) {} }
  };

  return (
    <div style={{
      minHeight:"100%",
      background:`radial-gradient(120% 80% at 50% -10%, ${C.bgCard} 0%, ${C.bg} 55%, #06101F 100%)`,
      paddingBottom:90,
      position:"relative",
      overflow:"hidden",
    }}>
      {missionsToValidate.length > 0 && (
        <div style={{
          position:"fixed", top:0, left:0, right:0, zIndex:8000,
          background:"linear-gradient(135deg,#F0B429,#E09B10)",
          padding:"14px 18px",
          display:"flex", alignItems:"center", justifyContent:"space-between", gap:12,
          boxShadow:"0 4px 24px rgba(240,180,41,0.4)"
        }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, flex:1, minWidth:0 }}>
            <span style={{ fontSize:22, flexShrink:0 }}>✅</span>
            <div>
              <div style={{ color:"#fff", fontWeight:800, fontSize:13, lineHeight:1.3 }}>
                Prestation à valider ({missionsToValidate.length})
              </div>
              <div style={{ color:"rgba(255,255,255,0.85)", fontSize:11, marginTop:2 }}>
                {missionsToValidate[0].metier || "Prestation"} — le prestataire a confirmé la fin
              </div>
            </div>
          </div>
          <button
            onClick={() => onNavigate("mission_history")}
            style={{ background:"rgba(0,0,0,0.25)", border:"none", borderRadius:10, padding:"8px 14px", color:"#fff", fontWeight:800, fontSize:12, cursor:"pointer", fontFamily:"inherit", flexShrink:0 }}
          >
            Valider →
          </button>
        </div>
      )}
      {showTour && <ClientTour onDone={dismissTour} />}

      {/* ── Fenêtre prestations en cours ── */}
      {missionsInProgress.length > 0 && !inProgressDismissed && (
        <div style={{
          position:"fixed", bottom:80, left:12, right:12, zIndex:7500,
          background:"linear-gradient(135deg,#0D1B3E,#162547)",
          border:"1.5px solid rgba(16,217,143,0.45)",
          borderRadius:20,
          boxShadow:"0 8px 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(16,217,143,0.15)",
          overflow:"hidden",
        }}>
          {/* Barre verte animée en haut */}
          <div style={{ height:3, background:"linear-gradient(90deg,#10D98F,#0ABF7A)", position:"relative", overflow:"hidden" }}>
            <div style={{
              position:"absolute", top:0, left:"-100%", width:"60%", height:"100%",
              background:"linear-gradient(90deg,transparent,rgba(255,255,255,0.5),transparent)",
              animation:"shimmer 2s linear infinite",
            }} />
          </div>
          <div style={{ padding:"14px 16px" }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <div style={{ width:10, height:10, borderRadius:"50%", background:"#10D98F", boxShadow:"0 0 10px #10D98F", animation:"pulse 1.5s ease-in-out infinite", flexShrink:0 }} />
                <span style={{ color:"#10D98F", fontWeight:800, fontSize:13 }}>Prestation{missionsInProgress.length > 1 ? "s" : ""} en cours</span>
                <span style={{ background:"rgba(16,217,143,0.15)", border:"1px solid rgba(16,217,143,0.3)", borderRadius:20, padding:"1px 8px", color:"#10D98F", fontSize:11, fontWeight:700 }}>{missionsInProgress.length}</span>
              </div>
              <button onClick={() => setInProgressDismissed(true)} style={{ background:"rgba(255,255,255,0.07)", border:"none", borderRadius:8, width:26, height:26, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", color:"rgba(255,255,255,0.4)", fontSize:14, fontFamily:"inherit" }}>✕</button>
            </div>
            {missionsInProgress.map((m, idx) => {
              const mStart = new Date(`${m.date}T${m.heure_debut || "00:00"}`).getTime();
              const mEnd   = mStart + Number(m.hours || 1) * 3600000;
              const now2   = inProgressTick;
              const elapsed = Math.max(0, now2 - mStart);
              const remaining = Math.max(0, mEnd - now2);
              const elapsedH = Math.floor(elapsed / 3600000);
              const elapsedMin = Math.floor((elapsed % 3600000) / 60000);
              const remH = Math.floor(remaining / 3600000);
              const remMin = Math.floor((remaining % 3600000) / 60000);
              const pct = Math.min(100, Math.round(((now2 - mStart) / (mEnd - mStart)) * 100));
              const sector = SECTORS?.find?.(s => s.id === m.sector);
              return (
                <div key={m.id} style={{ marginBottom: idx < missionsInProgress.length - 1 ? 10 : 0 }}>
                  <div style={{ display:"flex", gap:10, alignItems:"center", marginBottom:8 }}>
                    <div style={{ width:38, height:38, borderRadius:11, background:`rgba(16,217,143,0.12)`, border:"1px solid rgba(16,217,143,0.2)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0 }}>{sector?.icon || "🏢"}</div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ color:"#fff", fontWeight:700, fontSize:13, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{m.metier || sector?.label || "Prestation"}</div>
                      <div style={{ color:"rgba(255,255,255,0.5)", fontSize:11 }}>
                        {elapsedH > 0 ? `${elapsedH}h ${elapsedMin}min` : `${elapsedMin}min`} écoulées
                        {" · "}
                        {remH > 0 ? `${remH}h ${remMin}min` : `${remMin}min`} restantes
                      </div>
                    </div>
                    <button onClick={() => onNavigate("mission_history")} style={{ background:"rgba(16,217,143,0.15)", border:"1px solid rgba(16,217,143,0.3)", borderRadius:10, padding:"6px 12px", color:"#10D98F", fontWeight:700, fontSize:11, cursor:"pointer", fontFamily:"inherit", flexShrink:0, whiteSpace:"nowrap" }}>
                      Voir →
                    </button>
                  </div>
                  {/* Barre de progression */}
                  <div style={{ height:5, background:"rgba(255,255,255,0.07)", borderRadius:10, overflow:"hidden" }}>
                    <div style={{ height:"100%", width:`${pct}%`, background:"linear-gradient(90deg,#10D98F,#0ABF7A)", borderRadius:10, transition:"width 1s linear" }} />
                  </div>
                  <div style={{ display:"flex", justifyContent:"space-between", marginTop:4 }}>
                    <span style={{ color:"rgba(255,255,255,0.35)", fontSize:10 }}>{m.heure_debut || "—"}</span>
                    <span style={{ color:"rgba(255,255,255,0.35)", fontSize:10 }}>
                      {(() => { const [h,min] = (m.heure_debut||"00:00").split(":").map(Number); const e=h*60+min+Math.round(Number(m.hours||1)*60); return `${String(Math.floor(e/60)%24).padStart(2,"0")}:${String(e%60).padStart(2,"0")}`; })()}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Halo violet ambiant */}
      <div style={{ position:"absolute", top:-120, right:-90, width:340, height:340, borderRadius:"50%", background:`radial-gradient(circle, ${C.violet}38 0%, transparent 65%)`, pointerEvents:"none" }} />

      {/* ── Header ── */}
      <div style={{ padding:missionsToValidate.length > 0 ? "98px 22px 8px" : "54px 22px 8px", display:"flex", alignItems:"center", justifyContent:"space-between", position:"relative", zIndex:2 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{
            width:38, height:38, borderRadius:12,
            background:`linear-gradient(135deg, ${C.violet}, ${C.violetDark})`,
            display:"flex", alignItems:"center", justifyContent:"center",
            fontFamily:font.display, fontWeight:800, fontSize:18, color:"#fff",
            boxShadow:`0 8px 22px ${C.violetGlow}`,
          }}>{userName?.charAt(0)?.toUpperCase()||"A"}</div>
          <div>
            <div style={{ fontSize:11, color:C.textMuted, letterSpacing:0.4, lineHeight:1.2 }}>Bonjour 👋</div>
            <div style={{ fontSize:14, fontWeight:600, color:C.text, lineHeight:1.2 }}>{userName || "Mon espace"}</div>
          </div>
        </div>
        <div style={{ display:"flex", gap:8 }}>
          <button onClick={()=>onNavigate("notifications")} style={{ width:38, height:38, borderRadius:12, background:"rgba(255,255,255,0.04)", border:`1px solid ${C.border}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:15, cursor:"pointer", position:"relative", color:C.text }}>
            🔔
            {notifCount > 0 && (
              <div style={{ position:"absolute", top:-4, right:-4, background:"#E74C3C", borderRadius:"50%", minWidth:18, height:18, fontSize:10, fontWeight:900, color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", padding:"0 3px", lineHeight:1 }}>{notifCount > 9 ? "9+" : notifCount}</div>
            )}
          </button>
          <button onClick={()=>onNavigate("favorites")} style={{ width:38, height:38, borderRadius:12, background:"rgba(255,255,255,0.04)", border:`1px solid ${C.border}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:15, cursor:"pointer", color:C.text }}>❤️</button>
          <button onClick={()=>onNavigate("bo_login")} style={{ width:30, height:30, borderRadius:8, background:"transparent", border:"none", display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, cursor:"pointer", opacity:0.25, marginTop:4 }}>⚙️</button>
        </div>
      </div>

      {/* ── Hero title ── */}
      <div style={{ padding:"14px 22px 18px", position:"relative", zIndex:2 }}>
        <h1 style={{
          fontFamily:font.display, fontSize:34, lineHeight:1.05, fontWeight:700,
          margin:0, color:C.text, letterSpacing:-0.5,
        }}>
          Trouvez le <em style={{ fontStyle:"italic", color:violetLite, fontWeight:600 }}>talent</em><br/>
          qu'il vous faut.
        </h1>
        <p style={{ marginTop:10, fontSize:13, color:C.textSub, lineHeight:1.5, maxWidth:300 }}>
          {providers.length > 0
            ? <>Plus de {providers.length} prestataire{providers.length > 1 ? "s" : ""} vérifié{providers.length > 1 ? "s" : ""}, prêt{providers.length > 1 ? "s" : ""} à intervenir.</>
            : <>Rejoignez la plateforme ALANE et accédez aux meilleurs prestataires.</>}
        </p>
      </div>

      {/* ── Live stats ── */}
      {(liveStats.openMissions !== null) && (
        <div style={{ padding:"0 22px 16px", position:"relative", zIndex:2 }}>
          <div style={{ display:"flex", gap:8 }}>
            {[
              { icon:"📋", value: liveStats.openMissions, label:"prestations ouvertes" },
              { icon:"🟢", value: liveStats.dispoNow ?? providers.filter(p=>p.dispo_immediat).length, label:"pros dispo maintenant" },
              { icon:"✅", value: liveStats.completedMonth, label:"prestations réalisées" },
            ].map((s,i)=>(
              <div key={i} style={{
                flex:1, background:"rgba(255,255,255,0.03)", border:`1px solid ${C.border}`,
                borderRadius:12, padding:"10px 8px", textAlign:"center",
              }}>
                <div style={{ fontSize:14, marginBottom:2 }}>{s.icon}</div>
                <div style={{ fontFamily:font.display, fontWeight:700, fontSize:16, color:C.text, lineHeight:1 }}>{s.value}</div>
                <div style={{ fontSize:9, color:C.textMuted, marginTop:3, lineHeight:1.2, letterSpacing:0.2 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Search bar ── */}
      <div style={{ padding:"0 22px 18px", position:"relative", zIndex:2 }}>
        <div onClick={()=>onNavigate("search_filters")} style={{
          background:"rgba(255,255,255,0.04)",
          border:`1px solid ${C.borderStrong}`,
          borderRadius:r, padding:"13px 16px",
          display:"flex", alignItems:"center", gap:12,
          backdropFilter:"blur(12px)", WebkitBackdropFilter:"blur(12px)", cursor:"pointer",
        }}>
          <span style={{ fontSize:15, opacity:0.6 }}>🔍</span>
          <span style={{ flex:1, color:C.textSub, fontSize:13.5 }}>Rechercher un service, un talent…</span>
          <span style={{ padding:"4px 10px", borderRadius:8, background:`${C.violet}25`, color:violetLite, fontSize:11, fontWeight:600, letterSpacing:0.3 }}>Filtres</span>
        </div>
      </div>

      {launchPhaseHome && <div style={{ padding:"0 22px" }}><LaunchBadge context="home" /></div>}

      {showPwaBanner && (
        <div style={{ margin:"0 22px 12px", background:"linear-gradient(135deg,#1a1060,#2d1b69)", border:"1px solid rgba(124,111,224,0.4)", borderRadius:14, padding:"13px 15px", display:"flex", gap:12, alignItems:"center" }}>
          <span style={{ fontSize:22, flexShrink:0 }}>📲</span>
          <div style={{ flex:1 }}>
            <div style={{ fontWeight:700, color:"#fff", fontSize:13 }}>Installer l'app</div>
            <div style={{ color:"rgba(255,255,255,0.6)", fontSize:11, marginTop:2 }}>Appuyez sur <strong style={{color:"#fff"}}>Partager</strong> puis "Sur l'écran d'accueil" pour activer les notifications.</div>
          </div>
          <button onClick={()=>{ try { localStorage.setItem("alane_pwa_banner","1"); } catch(e) {} setShowPwaBanner(false); }} style={{ background:"transparent", border:"none", color:"rgba(255,255,255,0.4)", fontSize:18, cursor:"pointer", padding:"4px", flexShrink:0 }}>✕</button>
        </div>
      )}

      {/* ── Demande notifications push ── */}
      {notifAsked && (
        <div style={{ margin:"0 22px 16px", background:`${C.violet}15`, border:`1px solid ${C.violet}44`, borderRadius:r, padding:"13px 15px", display:"flex", gap:12, alignItems:"center" }}>
          <span style={{ fontSize:20, flexShrink:0 }}>🔔</span>
          <div style={{ flex:1 }}>
            <div style={{ fontWeight:700, color:C.text, fontSize:13 }}>Activer les notifications</div>
            <div style={{ color:C.textSub, fontSize:11, marginTop:2 }}>Soyez alerté en temps réel des nouvelles prestations</div>
          </div>
          <div style={{ display:"flex", gap:6, flexShrink:0 }}>
            <button onClick={()=>{ try { localStorage.setItem("alane_notif_asked","1"); } catch(e) {} setNotifAsked(false); }} style={{ background:"transparent", border:"none", color:C.textSub, fontSize:11, cursor:"pointer", fontFamily:"inherit" }}>Plus tard</button>
            <button onClick={()=>{
              Notification.requestPermission().then(p=>{ try { localStorage.setItem("alane_notif_asked","1"); } catch(e) {} setNotifAsked(false); if(p==="granted") new Notification("ALANE",{body:"Notifications activées ! Vous serez alerté des nouvelles prestations.",icon:"/favicon.svg"}); });
            }} style={{ background:C.violet, border:"none", borderRadius:8, padding:"6px 12px", color:"#fff", fontWeight:700, fontSize:11, cursor:"pointer", fontFamily:"inherit" }}>Activer</button>
          </div>
        </div>
      )}

      {/* ── Wallet hero ── */}
      <div style={{ padding:"0 22px 18px", position:"relative", zIndex:2 }}>
        <div onClick={()=>onNavigate("cashback")} style={{
          position:"relative", borderRadius:22, padding:"20px 20px 18px",
          background:`linear-gradient(135deg, ${C.violetDark} 0%, #2D2173 55%, #1a1556 100%)`,
          overflow:"hidden", cursor:"pointer",
          boxShadow:`0 20px 40px -20px ${C.violetGlow}, 0 1px 0 rgba(255,255,255,0.05) inset`,
          border:`1px solid rgba(255,255,255,0.08)`,
        }}>
          <div style={{ position:"absolute", right:-30, top:-30, width:160, height:160, borderRadius:"50%", border:`1px solid rgba(255,255,255,0.08)` }} />
          <div style={{ position:"absolute", right:-60, top:-60, width:240, height:240, borderRadius:"50%", border:`1px solid rgba(255,255,255,0.05)` }} />
          <div style={{ position:"absolute", right:18, top:18, fontSize:28 }}>💎</div>

          <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:8 }}>
            <span style={{ fontSize:10, letterSpacing:1.6, textTransform:"uppercase", color:"rgba(255,255,255,0.55)", fontWeight:600 }}>Cashback wallet</span>
            <span style={{ padding:"2px 7px", borderRadius:999, background:`${C.accentGold}25`, color:C.accentGold, fontSize:9, fontWeight:700, letterSpacing:0.5 }}>{tier.icon} {tier.label.toUpperCase()}</span>
          </div>

          <div style={{ display:"flex", alignItems:"baseline", gap:6, marginBottom:14 }}>
            <span style={{ fontFamily:font.display, fontSize:38, fontWeight:700, color:"#fff", letterSpacing:-1, lineHeight:1 }}>
              {walletBalance.toFixed(2).replace(".", ",")}
            </span>
            <span style={{ fontSize:18, color:"rgba(255,255,255,0.7)", fontWeight:500 }}>€</span>
          </div>

          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:14 }}>
            <div style={{ flex:1 }}>
              <div style={{ height:5, borderRadius:99, background:"rgba(255,255,255,0.12)", overflow:"hidden" }}>
                <div style={{ width:`${tierProgress}%`, height:"100%", borderRadius:99, background:`linear-gradient(90deg, ${violetLite}, ${C.accentGold})` }} />
              </div>
              <div style={{ marginTop:6, fontSize:11, color:"rgba(255,255,255,0.6)" }}>
                {nextTier
                  ? <>{missionsToNext} prestation{missionsToNext>1?"s":""} avant le palier <strong style={{ color:C.accentGold }}>{nextTier.label}</strong></>
                  : <>Vous êtes au palier maximum 🎉</>}
              </div>
            </div>
            <div style={{
              background:"rgba(255,255,255,0.12)",
              border:`1px solid rgba(255,255,255,0.18)`,
              color:"#fff", fontSize:12, fontWeight:600,
              padding:"9px 14px", borderRadius:11,
            }}>Utiliser →</div>
          </div>
        </div>
      </div>

      {/* ── Mode urgence ── */}
      <div style={{ padding:"0 22px 24px", position:"relative", zIndex:2 }}>
        <div onClick={()=>setUrgentMode(!urgentMode)} style={{
          background: urgentMode ? `${C.accent}14` : "rgba(255,255,255,0.025)",
          border:`1px solid ${urgentMode ? `${C.accent}55` : C.border}`,
          borderRadius:r, padding:"12px 14px",
          display:"flex", alignItems:"center", gap:12, cursor:"pointer",
          transition:"all .25s",
          boxShadow: urgentMode ? `0 0 24px ${C.accent}22` : "none",
        }}>
          <div style={{ width:36, height:36, borderRadius:10, background: urgentMode ? `${C.accent}25` : `${C.accent}12`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:17, flexShrink:0 }}>🚨</div>
          <div style={{ flex:1 }}>
            <div style={{ fontWeight:600, fontSize:13.5, color: urgentMode ? C.accent : C.text, lineHeight:1.2 }}>Mode urgence</div>
            <div style={{ fontSize:11.5, color:C.textSub, marginTop:2 }}>
              {urgentMode ? "Actif — sous 1h · +2€ HT/h" : "Trouvez un prestataire dans l’heure"}
            </div>
          </div>
          <div style={{ width:42, height:24, borderRadius:99, padding:2, background: urgentMode ? C.accent : "rgba(255,255,255,0.1)", border:`1px solid ${urgentMode ? `${C.accent}55` : C.border}`, transition:"all .25s", flexShrink:0 }}>
            <div style={{ width:18, height:18, borderRadius:"50%", background:"#fff", transform:`translateX(${urgentMode ? 18 : 0}px)`, transition:"transform .25s", boxShadow:"0 2px 6px rgba(0,0,0,0.3)" }} />
          </div>
        </div>
      </div>

      {/* ── Secteurs ── */}
      <div style={{ padding:"0 22px 26px", position:"relative", zIndex:2 }}>
        <div style={{ display:"flex", alignItems:"flex-end", justifyContent:"space-between", marginBottom:12 }}>
          <h3 style={{ margin:0, fontFamily:font.display, fontWeight:700, fontSize:20, color:C.text, lineHeight:1.1, letterSpacing:-0.2 }}>Secteurs</h3>
          <span onClick={()=>onNavigate("catalogue")} style={{ fontSize:12, color:violetLite, fontWeight:600, cursor:"pointer" }}>Voir tout ›</span>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:isDesktop?"repeat(8,1fr)":"repeat(4,1fr)", gap:10 }}>
          {SECTORS.map(s=>{
            const ss = sectorStatus[s.id];
            const isOpen = !ss || ss.open;
            return (
              <div key={s.id} onClick={isOpen ? ()=>onNavigate("sector_detail",s) : undefined}
                className={isOpen ? "card-hover" : ""}
                style={{
                  background: isOpen ? "rgba(255,255,255,0.025)" : "rgba(255,255,255,0.01)",
                  border:`1px solid ${isOpen ? C.border : "rgba(255,255,255,0.04)"}`,
                  borderRadius:r, padding:"12px 6px 10px",
                  textAlign:"center", cursor: isOpen ? "pointer" : "default",
                  position:"relative", overflow:"hidden",
                  opacity: isOpen ? 1 : 0.45,
                }}>
                <div style={{ position:"absolute", top:0, left:0, right:0, height:34, background:`radial-gradient(60% 100% at 50% 0%, ${s.color}${isOpen?"25":"10"} 0%, transparent 100%)`, pointerEvents:"none" }} />
                <div style={{ fontSize:22, marginBottom:4, position:"relative" }}>{isOpen ? s.icon : "🔒"}</div>
                <div style={{ fontSize:9.5, fontWeight:600, color: isOpen ? C.text : C.textMuted, letterSpacing:0.3, textTransform:"uppercase", lineHeight:1.2, position:"relative" }}>{s.label}</div>
                <div style={{ fontSize:9, color:C.textMuted, marginTop:2, position:"relative" }}>
                  {isOpen ? `${providers.filter(p=>p.sector===s.id).length} pros` : ss ? `${ss.count}/${ss.min} presta` : "Bientôt"}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Top prestataires ── */}
      <div style={{ padding:"0 22px 22px", position:"relative", zIndex:2 }}>
        <div style={{ display:"flex", alignItems:"flex-end", justifyContent:"space-between", marginBottom:12 }}>
          <div>
            <h3 style={{ margin:0, fontFamily:font.display, fontWeight:700, fontSize:20, color:C.text, lineHeight:1.1, letterSpacing:-0.2 }}>Top prestataires</h3>
            <div style={{ fontSize:11.5, color:C.textSub, marginTop:3 }}>Disponibles maintenant</div>
          </div>
          <span onClick={()=>onNavigate("search_filters")} style={{ fontSize:12, color:violetLite, fontWeight:600, cursor:"pointer" }}>Voir tout ›</span>
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:11 }}>
          {providersLoading ? (
            <div style={{ background:`${C.bgCard}`, border:`1px solid ${C.border}`, borderRadius:16, padding:"28px 16px", textAlign:"center" }}>
              <div style={{ color:C.textMuted, fontSize:13 }}>Chargement…</div>
            </div>
          ) : providers.filter(p=>p.available).length === 0 ? (
            <div style={{ background:`linear-gradient(135deg, ${C.bgCard} 0%, ${C.bgCardAlt} 100%)`, border:`1px solid ${C.border}`, borderRadius:16, padding:"28px 20px", textAlign:"center" }}>
              <div style={{ fontSize:32, marginBottom:10 }}>👷</div>
              <div style={{ fontSize:14, fontWeight:600, color:C.text, marginBottom:6 }}>Bientôt disponible</div>
              <div style={{ fontSize:12, color:C.textSub, lineHeight:1.5 }}>Les premiers prestataires ALANE arrivent très prochainement.</div>
            </div>
          ) : (
            providers
              .filter(p=>p.available)
              .sort((a,b) => {
                const planDiff = (b.planRank||0) - (a.planRank||0);
                if (planDiff !== 0) return planDiff;
                const reviewsDiff = (b.reviews||0) - (a.reviews||0);
                if (reviewsDiff !== 0) return reviewsDiff;
                return (b.rating||0) - (a.rating||0);
              })
              .slice(0,3)
              .map((p,i)=>(
              <div key={p.id} onClick={()=>onNavigate("profile",p)}
                className="card-hover"
                style={{
                  background:`linear-gradient(135deg, ${C.bgCard} 0%, ${C.bgCardAlt} 100%)`,
                  border:`1px solid ${C.border}`,
                  borderRadius:16, padding:13,
                  display:"flex", gap:12, alignItems:"center",
                  cursor:"pointer", position:"relative", overflow:"hidden",
                  animationDelay:`${i*0.08}s`,
                }}>
                <div style={{
                  width:54, height:54, borderRadius:r,
                  background:`linear-gradient(135deg, ${p.color}40, ${p.color}15)`,
                  border:`1px solid ${p.color}40`,
                  display:"flex", alignItems:"center", justifyContent:"center",
                  fontSize:26, flexShrink:0, position:"relative",
                }}>
                  {p.avatar}
                  <div style={{ position:"absolute", bottom:-2, right:-2, width:14, height:14, borderRadius:"50%", background:C.success, border:`2.5px solid ${C.bgCard}`, boxShadow:`0 0 8px ${C.success}` }} />
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:2 }}>
                    <span style={{ fontSize:14, fontWeight:600, color:C.text, lineHeight:1.2 }}>{p.name}</span>
                    {p.plan==="elite"   && <span style={{ fontSize:10, fontWeight:700, color:"#F0B429" }}>👑</span>}
                    {p.plan==="premium" && <span style={{ fontSize:11, color:violetLite }}>✓</span>}
                    {(!p.plan||p.plan==="free") && <span style={{ fontSize:11, color:violetLite }}>✓</span>}
                  </div>
                  <div style={{ fontSize:11.5, color:C.textSub, marginBottom:5, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{p.jobTitle}</div>
                  <div style={{ display:"flex", alignItems:"center", gap:8, fontSize:11, color:C.textMuted }}>
                    <span style={{ display:"inline-flex", alignItems:"center", gap:3 }}>
                      <Stars rating={p.rating} size={10}/>
                      <span style={{ color:C.text, fontWeight:600 }}>{p.rating || "—"}</span>
                    </span>
                    {p.code_postal && <><span>·</span><span>📍 {p.code_postal}</span></>}
                  </div>
                </div>
                <div style={{ textAlign:"right", flexShrink:0 }}>
                  <div style={{ fontFamily:font.display, fontWeight:700, fontSize:15, color:violetLite, lineHeight:1 }}>{p.hourlyRate}</div>
                  <div style={{ fontSize:10, color:C.textMuted, marginTop:4 }}>HT/h</div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Parrainage ── */}
      <div style={{ padding:"0 22px 28px", position:"relative", zIndex:2 }}>
        <div onClick={()=>onNavigate("referral")} style={{
          background:`linear-gradient(120deg, ${C.bgCard} 0%, ${C.bgCardAlt} 100%)`,
          border:`1px solid ${C.accentGold}30`,
          borderRadius:16, padding:"15px 16px",
          display:"flex", alignItems:"center", gap:13,
          cursor:"pointer", overflow:"hidden", position:"relative",
        }}>
          <div style={{ position:"absolute", right:-10, bottom:-15, fontSize:80, opacity:0.06 }}>🎁</div>
          <div style={{ width:42, height:42, borderRadius:12, background:`${C.accentGold}1F`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>🎁</div>
          <div style={{ flex:1, position:"relative" }}>
            <div style={{ fontSize:13.5, fontWeight:600, color:C.text, marginBottom:2 }}>
              Parrainez & gagnez <span style={{ color:C.accentGold }}>1 mois Premium</span>
            </div>
            <div style={{ fontSize:11.5, color:C.textSub }}>3 filleuls abonnés = 1 mois offert</div>
          </div>
          <span style={{ color:C.accentGold, fontSize:18 }}>›</span>
        </div>
      </div>
    </div>
  );
}

export function CatalogueScreen({ onNavigate }) {
  const [activeSector, setActiveSector] = useState(null);
  const sectorRefs = useRef({});
  const { providers: realProviders } = useProviders();
  const sectorStatus = useSectorStatus();

  const scrollToSector = (id) => {
    setActiveSector(id);
    sectorRefs.current[id]?.scrollIntoView({ behavior:"smooth", block:"start" });
  };

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg, #0A1628 0%, #0D1B3E 100%)`, paddingBottom:80 }}>
      {/* Header */}
      <div style={{ background:"linear-gradient(135deg, #0A1628, #162547)", padding:"48px 22px 22px", borderRadius:"0 0 26px 26px" }}>
        <h2 style={{ color:C.white, fontSize:21, fontWeight:800, margin:"0 0 4px", fontFamily:font.display }}>Tous les secteurs</h2>
        <p style={{ color:"rgba(255,255,255,0.55)", fontSize:13, margin:0 }}>Trouvez le professionnel qu'il vous faut</p>
      </div>

      {/* Sticky sector pills */}
      <div style={{ position:"sticky", top:0, background:C.bg, zIndex:50, borderBottom:`1px solid ${C.border}`, padding:"10px 0", width:"100%", boxSizing:"border-box" }}>
        <div style={{ display:"flex", gap:8, overflowX:"auto", padding:"0 18px", scrollbarWidth:"none", WebkitOverflowScrolling:"touch" }}>
          {SECTORS.map(s=>{
            const ss = sectorStatus[s.id];
            const isOpen = !ss || ss.open;
            return (
              <button key={s.id} onClick={()=>scrollToSector(s.id)} style={{ display:"flex", alignItems:"center", gap:5, padding:"8px 14px", borderRadius:20, border:"none", cursor:"pointer", whiteSpace:"nowrap", background:activeSector===s.id?`linear-gradient(135deg,${C.violet},${C.indigo})`:C.offWhite, color:activeSector===s.id?C.white:C.gray, fontWeight:activeSector===s.id?700:500, fontSize:12, fontFamily:"inherit", transition:"all 0.2s", flexShrink:0, opacity:isOpen?1:0.5 }}>
                {isOpen ? s.icon : "🔒"} {s.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Sections par secteur */}
      <div style={{ padding:"8px 0" }}>
        {SECTORS.map(sector=>{
          const sectorProviders = realProviders.filter(p=>p.sector===sector.id);
          const ss = sectorStatus[sector.id];
          const isOpen = !ss || ss.open;
          return (
            <div key={sector.id} ref={el=>sectorRefs.current[sector.id]=el} style={{ marginBottom:8 }}>
              <div
                style={{ margin:"0 18px 14px", background: isOpen ? `linear-gradient(135deg,${sector.color}44,${sector.color}22)` : "rgba(255,255,255,0.03)", borderRadius:18, padding:"20px 18px", position:"relative", overflow:"hidden", cursor: isOpen ? "pointer" : "default", opacity: isOpen ? 1 : 0.5, border: isOpen ? "none" : `1px solid rgba(255,255,255,0.06)` }}
                onClick={isOpen ? ()=>onNavigate("sector_detail",sector) : undefined}>
                <div style={{ position:"absolute", right:-10, top:-10, fontSize:64, opacity:0.2 }}>{isOpen ? sector.banner : "🔒"}</div>
                <div style={{ position:"absolute", right:14, bottom:14, fontSize:36 }}>{isOpen ? sector.icon : ""}</div>
                <div style={{ fontWeight:800, color:C.text, fontSize:18 }}>{sector.label}</div>
                {isOpen ? (
                  <>
                    <div style={{ color:C.textSub, fontSize:13, marginTop:4 }}>{sectorProviders.length} prestataires · {sectorProviders.filter(p=>p.available).length} disponibles maintenant</div>
                    <div style={{ marginTop:10 }}><Badge color={sector.color} small>Voir tous les prestataires →</Badge></div>
                  </>
                ) : (
                  <div style={{ color:C.textMuted, fontSize:13, marginTop:6 }}>
                    🔒 Bientôt disponible · {ss ? `${ss.count} / ${ss.min} prestataires inscrits` : "Ouverture prochaine"}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

let _sectorStatusCache = null;
let _sectorStatusCacheTs = 0;

export function useSectorStatus() {
  const [status, setStatus] = useState(_sectorStatusCache || {});
  useEffect(() => {
    if (_sectorStatusCache && Date.now() - _sectorStatusCacheTs < 60_000) return;
    fetch("/api/prestations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "get_sector_status" }),
    })
      .then(r => r.json())
      .then(d => {
        if (d && typeof d === "object" && !d.error) {
          _sectorStatusCache = d;
          _sectorStatusCacheTs = Date.now();
          setStatus(d);
        }
      })
      .catch(() => {});
  }, []);
  return status;
}

let _providersCache = null;
let _providersCacheTs = 0;
let _providersCachePromise = null;

export function useProviders() {
  const [providers, setProviders] = useState([]);
  const [loading, setLoading]     = useState(true);
  useEffect(() => {
    const cacheValid = _providersCache && (Date.now() - _providersCacheTs < PROVIDERS_CACHE_TTL);
    if (cacheValid) { setProviders(_providersCache); setLoading(false); return; }
    if (!cacheValid) { _providersCachePromise = null; }
    if (!_providersCachePromise) {
      _providersCachePromise = fetch("/api/prestataires")
        .then(r => r.json())
        .then(({ prestataires = [] }) => {
          const PLAN_RANK = { elite: 2, premium: 1, free: 0 };
          const mapped = prestataires.map(p => {
            const sectorInfo = SECTORS.find(s => s.id === p.secteur);
            const rateNum    = prixClient(p.tarif_net || 12, p.secteur || "divers");
            return {
              id:           p.id,
              name:         p.name,
              prenom:       p.prenom,
              nom:          p.nom,
              sector:       p.secteur,
              jobTitle:     p.metier,
              rateNum,
              hourlyRate:   `${rateNum.toFixed(2).replace(".", ",")} € HT/h`,
              available:             p.dispo_immediat !== false,
              dispon_jours:          p.dispon_jours || [],
              dispon_jours_creneaux: p.dispon_jours_creneaux || null,
              code_postal:  p.code_postal,
              rating:       p.rating || 0,
              reviews:      p.reviews || 0,
              distance:     "—",
              responseTime: "—",
              avatar:       sectorInfo?.icon || "👷",
              color:        sectorInfo?.color || "#7C6FE0",
              niveau:       p.niveau,
              plan:         p.plan_abonnement || "free",
              planRank:     PLAN_RANK[p.plan_abonnement] ?? 0,
              cv:           p.cv || null,
              bio:          p.bio      || null,
              langues:      Array.isArray(p.langues) ? p.langues : [],
              role:         p.metier   || null,
              skills:       (p.metiers_list || []).flatMap(m =>
                (m.certifs || "").split(",").map(c => c.trim()).filter(Boolean)
              ),
              metiers_list: p.metiers_list || [],
              photo_url:       p.photo_url || null,
              missions_count:  p.missions_count || 0,
            };
          });
          _providersCache = mapped;
          _providersCacheTs = Date.now();
          return mapped;
        })
        .catch(() => { _providersCachePromise = null; return []; });
    }
    _providersCachePromise.then(mapped => { setProviders(mapped); setLoading(false); });
  }, []);
  return { providers, loading };
}

export function loadLeaflet() {
  return new Promise(resolve => {
    if (window.L) { resolve(window.L); return; }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    document.head.appendChild(link);
    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.onload = () => resolve(window.L);
    document.head.appendChild(script);
  });
}

export function cityCoords(ville) {
  if (!ville) return null;
  const key = ville.toLowerCase().trim();
  for (const [k, v] of Object.entries(FR_CITY_COORDS)) {
    if (Array.isArray(v) && (key === k || key.startsWith(k))) return v;
  }
  return null;
}

export function LeafletMap({ providers, onNavigate }) {
  const mapRef = useRef(null);
  const instanceRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    loadLeaflet().then(L => {
      if (cancelled || !mapRef.current || instanceRef.current) return;
      const map = L.map(mapRef.current, { zoomControl: true }).setView([46.603354, 1.8883335], 6);
      instanceRef.current = map;
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap",
        maxZoom: 18,
      }).addTo(map);

      providers.forEach(p => {
        const coords = cityCoords(p.ville || p.city);
        if (!coords) return;
        const icon = L.divIcon({
          className: "",
          html: `<div style="background:${p.available?"#10D98F":"#8B8FA8"};color:#fff;border-radius:50%;width:34px;height:34px;display:flex;align-items:center;justify-content:center;font-size:16px;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.4)">${p.avatar}</div>`,
          iconSize: [34, 34],
          iconAnchor: [17, 17],
        });
        const marker = L.marker(coords, { icon }).addTo(map);
        marker.bindPopup(`<div style="font-family:system-ui;min-width:140px"><strong>${p.name}</strong><br/><span style="color:#666;font-size:12px">${p.jobTitle||""}</span><br/><span style="color:#7C6FE0;font-weight:700">${p.hourlyRate}</span><br/><span style="color:${p.available?"#10D98F":"#888"};font-size:12px">${p.available?"● Disponible":"○ Occupé"}</span></div>`);
        marker.on("click", () => { setTimeout(() => onNavigate("profile", p), 300); });
      });
    });
    return () => {
      cancelled = true;
      if (instanceRef.current) { instanceRef.current.remove(); instanceRef.current = null; }
    };
  }, []);

  return (
    <div style={{ borderRadius:14, overflow:"hidden", border:`1px solid ${C.border}`, marginBottom:12 }}>
      <div ref={mapRef} style={{ height:400, width:"100%", background:"#0D1B3E" }} />
      <div style={{ background:"#0D1B3E", padding:"8px 12px", fontSize:11, color:C.textSub }}>
        ● Vert = disponible · ○ Gris = occupé · Cliquer sur un marqueur pour voir le profil
      </div>
    </div>
  );
}

export function SectorDetailScreen({ sector, onNavigate, clientCoords }) {
  const s = sector || SECTORS[0];
  const [selectedJob, setSelectedJob] = useState(null);
  const [urgentMode, setUrgentMode] = useState(false);
  const [filterDispo, setFilterDispo] = useState(false);
  const [filterTarifMax, setFilterTarifMax] = useState(50);
  const [filterNoteMin, setFilterNoteMin] = useState(0);
  const [filterCertified, setFilterCertified] = useState(false);
  const [sortBy, setSortBy] = useState("rating");
  const [showMap, setShowMap] = useState(false);
  const filterKey = `alane_filters_${s.id}`;
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(filterKey)||"{}");
      if(saved.selectedJob!==undefined) setSelectedJob(saved.selectedJob);
      if(saved.filterDispo!==undefined) setFilterDispo(saved.filterDispo);
      if(saved.filterTarifMax!==undefined) setFilterTarifMax(saved.filterTarifMax);
      if(saved.filterNoteMin!==undefined) setFilterNoteMin(saved.filterNoteMin);
      if(saved.filterCertified!==undefined) setFilterCertified(saved.filterCertified);
      if(saved.sortBy!==undefined) setSortBy(saved.sortBy);
    } catch(_) {}
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem(filterKey, JSON.stringify({ selectedJob, filterDispo, filterTarifMax, filterNoteMin, filterCertified, sortBy }));
    } catch(_) {}
  }, [selectedJob, filterDispo, filterTarifMax, filterNoteMin, filterCertified, sortBy]);
  const [showFilters, setShowFilters] = useState(false);
  const [jobSearch, setJobSearch] = useState("");
  const [missionDate, setMissionDate] = useState("");
  const [surcharge, setSurcharge] = useState(2);
  useEffect(() => {
    supabase.from("platform_settings").select("value").eq("key","urgency_surcharge").single()
      .then(({ data }) => { if (data?.value != null) setSurcharge(Number(data.value)); });
  }, []);
  const DAY_NAMES = ["Dimanche","Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi"];
  const selectedDay = missionDate ? DAY_NAMES[new Date(missionDate).getDay()] : null;
  const { providers } = useProviders();

  const allServices = (METIERS[s.id]||[]).map(name => {
    const count = providers.filter(p=>p.sector===s.id && p.jobTitle===name).length;
    const availCount = providers.filter(p=>p.sector===s.id && p.jobTitle===name && p.available).length;
    const tarif = METIERS_TARIFS[s.id]?.[name];
    const base = tarif ? prixClient(tarif.default, s.id) : 12;
    const price = urgentMode ? base + surcharge : base;
    return { name, rate:`${price.toFixed(2).replace(".",",")} € HT/h`, count, availCount, base, price };
  });

  const filteredProviders = providers
    .filter(p => p.sector===s.id && (!selectedJob || p.jobTitle===selectedJob))
    .filter(p => !filterDispo || p.available)
    .filter(p => !selectedDay || (p.dispon_jours||[]).includes(selectedDay))
    .filter(p => p.rateNum <= filterTarifMax)
    .filter(p => p.rating >= filterNoteMin)
    .filter(p => !filterCertified || p.plan === "premium" || p.plan === "elite")
    .sort((a,b) => {
      const planDiff = (b.planRank||0) - (a.planRank||0);
      if(planDiff !== 0) return planDiff;
      if(sortBy==="tarif")    return a.rateNum - b.rateNum;
      if(sortBy==="distance") return parseFloat(a.distance||"9") - parseFloat(b.distance||"9");
      return b.rating - a.rating;
    });

  const basePrice = selectedJob
    ? (() => { const t = METIERS_TARIFS[s.id]?.[selectedJob]; return t ? prixClient(t.default, s.id) : 12; })()
    : 0;
  const urgentPrice = basePrice + surcharge;

  // Bouton urgence réutilisable
  const UrgentToggle = ({ showBeforeJob=false }) => (
    <div onClick={()=>setUrgentMode(!urgentMode)} style={{
      background: urgentMode ? C.accent : C.white,
      border: `2px solid ${urgentMode ? C.accent : C.grayLight}`,
      borderRadius:r, padding:"13px 16px",
      marginBottom: showBeforeJob ? 20 : 16,
      cursor:"pointer", display:"flex", alignItems:"center", gap:12,
      transition:"all 0.25s",
      boxShadow: urgentMode ? `0 6px 20px ${C.accent}44` : "0 2px 8px rgba(0,0,0,0.05)",
    }}>
      <span style={{ fontSize:22 }}>🚨</span>
      <div style={{ flex:1 }}>
        <div style={{ fontWeight:800, color:urgentMode?C.white:C.accent, fontSize:14, display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
          Mode Urgence
          <span style={{
            background: urgentMode ? "rgba(255,255,255,0.25)" : `${C.accent}18`,
            color: urgentMode ? C.white : C.accent,
            borderRadius:6, padding:"1px 8px", fontSize:11, fontWeight:700,
          }}>+{surcharge},00 € HT/h</span>
        </div>
        <div style={{ fontSize:12, color:urgentMode?"rgba(255,255,255,0.75)":C.gray, marginTop:2 }}>
          {urgentMode
            ? "Actif — le 1er prestataire disponible accepte la prestation"
            : "Prestataire disponible dans l’heure · Surcoût affiché au récapitulatif"}
        </div>
      </div>
      <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:4, flexShrink:0 }}>
        <span style={{ fontWeight:700, color:urgentMode?C.white:C.accent, fontSize:11 }}>{urgentMode?"Actif ✓":"Activer"}</span>
        <div style={{ width:40, height:22, borderRadius:11, background:urgentMode?"rgba(255,255,255,0.3)":C.grayLight, position:"relative", transition:"all 0.25s" }}>
          <div style={{ width:18, height:18, borderRadius:"50%", background:urgentMode?C.white:C.gray, position:"absolute", top:2, left:urgentMode?20:2, transition:"left 0.25s", boxShadow:"0 1px 4px rgba(0,0,0,0.2)" }} />
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg, #0A1628 0%, #0D1B3E 100%)`, paddingBottom:80 }}>

      {/* Header secteur */}
      <div style={{ background:`linear-gradient(135deg,${s.color}88,${s.color}44)`, padding:"48px 22px 24px", borderRadius:"0 0 26px 26px", position:"relative", overflow:"hidden" }}>
        <button onClick={()=>{ onNavigate("catalogue"); }} style={{ background:"rgba(255,255,255,0.3)", border:"none", borderRadius:10, padding:"7px 14px", color:C.white, cursor:"pointer", fontSize:13, marginBottom:14 }}>← Retour</button>
        <div style={{ position:"absolute", right:-10, bottom:-20, fontSize:100, opacity:0.15 }}>{s.banner}</div>
        <div style={{ fontSize:40, marginBottom:8 }}>{s.icon}</div>
        <h2 style={{ color:C.white, fontSize:26, fontWeight:800, margin:"0 0 4px", fontFamily:font.display }}>{s.label}</h2>
        <p style={{ color:"rgba(255,255,255,0.75)", fontSize:14, margin:0 }}>
          {providers.filter(p=>p.sector===s.id).length} prestataires · {providers.filter(p=>p.sector===s.id&&p.available).length} disponibles · <strong>Prix HT</strong>
        </p>
      </div>

      <div style={{ padding:"20px 18px" }}>

        {/* ── PAS DE MÉTIER SÉLECTIONNÉ ── */}
        {!selectedJob && <>
          {/* Bouton urgence AVANT le choix du métier */}
          <UrgentToggle showBeforeJob={true} />

          <h4 style={{ margin:"0 0 12px", color:C.text, fontWeight:800 }}>Choisissez un métier pour commander</h4>
          <div style={{ position:"relative", marginBottom:14 }}>
            <span style={{ position:"absolute", left:13, top:"50%", transform:"translateY(-50%)", fontSize:15, opacity:0.5 }}>🔍</span>
            <input
              type="text"
              placeholder="Rechercher un métier…"
              value={jobSearch}
              onChange={e=>setJobSearch(e.target.value)}
              style={{ width:"100%", padding:"11px 14px 11px 40px", borderRadius:r, border:`1px solid ${C.border}`, fontSize:14, fontFamily:"inherit", color:C.text, background:"#112240", outline:"none", boxSizing:"border-box" }}
            />
            {jobSearch && (
              <button onClick={()=>setJobSearch("")} style={{ position:"absolute", right:12, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", color:C.textSub, cursor:"pointer", fontSize:16, lineHeight:1 }}>×</button>
            )}
          </div>

          {(jobSearch ? allServices.filter(s => s.name.toLowerCase().includes(jobSearch.toLowerCase())) : allServices).map((svc,i) => (
            <div key={i} onClick={()=>svc.availCount>0 && setSelectedJob(svc.name)} style={{
              background:"#0D1B3E", borderRadius:r, padding:"14px 16px", marginBottom:8,
              display:"flex", alignItems:"center", boxShadow:"0 2px 12px rgba(0,0,0,0.4)",
              cursor:svc.availCount>0?"pointer":"default", opacity:svc.count===0?0.5:1,
              transition:"transform 0.15s",
              border:`1.5px solid ${urgentMode && svc.availCount>0 ? C.accent+"44" : "transparent"}`,
            }}
              onMouseEnter={e=>{ if(svc.availCount>0) e.currentTarget.style.transform="translateX(4px)"; }}
              onMouseLeave={e=>e.currentTarget.style.transform="translateX(0)"}
            >
              <div style={{ flex:1 }}>
                <div style={{ fontWeight:700, color:C.text, fontSize:14 }}>{svc.name}</div>
                <div style={{ display:"flex", gap:8, marginTop:3, alignItems:"center", flexWrap:"wrap" }}>
                  <span style={{ color:urgentMode?C.accent:C.violet, fontWeight:700, fontSize:12 }}>{svc.rate}</span>
                  {urgentMode && <span style={{ color:C.textSub, fontSize:11, textDecoration:"line-through" }}>{`${svc.base.toFixed(2).replace(".",",")} €`}</span>}
                  <span style={{ color:C.textSub, fontSize:11 }}>· {svc.count} prestataire{svc.count>1?"s":""} ({svc.availCount} dispo)</span>
                </div>
              </div>
              <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:6 }}>
                <Badge color={svc.availCount>0?C.success:C.gray} small>{svc.availCount>0?"Disponible":"Indisponible"}</Badge>
                {svc.availCount>0 && <span style={{ fontSize:11, color:urgentMode?C.accent:C.violet, fontWeight:700 }}>Voir {svc.availCount} →</span>}
              </div>
            </div>
          ))}
        </>}

        {/* ── MÉTIER SÉLECTIONNÉ ── */}
        {selectedJob && <>

          {/* Lien retour */}
          <div onClick={()=>{ setSelectedJob(null); setUrgentMode(false); setShowFilters(false); }} style={{ display:"flex", alignItems:"center", gap:6, color:C.violet, fontWeight:700, fontSize:13, cursor:"pointer", marginBottom:14 }}>
            ← Tous les métiers
          </div>

          {/* Barre filtres */}
          <div style={{ marginBottom:14 }}>
            <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:showFilters?12:0 }}>
              <button onClick={()=>setShowFilters(!showFilters)} style={{ flex:1, padding:"10px 14px", borderRadius:r, border:`1.5px solid ${showFilters?s.color:C.border}`, background:showFilters?`${s.color}20`:"rgba(255,255,255,0.04)", color:showFilters?s.color:C.textSub, fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"inherit", display:"flex", alignItems:"center", gap:6, transition:"all 0.2s" }}>
                🎛️ Filtres {filterDispo||filterNoteMin>0||filterTarifMax<50?<span style={{ background:s.color, color:"#fff", borderRadius:"50%", width:16, height:16, fontSize:10, display:"inline-flex", alignItems:"center", justifyContent:"center", fontWeight:700 }}>!</span>:null}
              </button>
              <select value={sortBy} onChange={e=>setSortBy(e.target.value)} style={{ flex:1, padding:"10px 10px", borderRadius:r, border:`1.5px solid ${C.border}`, background:"rgba(255,255,255,0.04)", color:C.text, fontSize:12, fontFamily:"inherit", cursor:"pointer" }}>
                <option value="rating">⭐ Par note</option>
                <option value="tarif">💶 Par tarif</option>
                <option value="distance">📍 Par distance</option>
              </select>
            </div>
            {showFilters && (
              <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"14px 16px" }}>
                <div style={{ marginBottom:14 }}>
                  <div style={{ color:C.textSub, fontSize:12, marginBottom:6, fontWeight:600 }}>Date de la prestation</div>
                  <input type="date" value={missionDate} onChange={e=>setMissionDate(e.target.value)} min={new Date().toISOString().slice(0,10)} placeholder="AAAA-MM-JJ"
                    style={{ width:"100%", padding:"9px 12px", borderRadius:8, border:`1px solid ${C.border}`, background:"#0D1B3E", color:C.text, fontSize:13, fontFamily:"inherit", boxSizing:"border-box" }} />
                  {selectedDay && <div style={{ color:s.color, fontSize:11, fontWeight:700, marginTop:4 }}>📅 {selectedDay} — uniquement les prestataires disponibles ce jour</div>}
                </div>
                <div onClick={()=>setFilterDispo(!filterDispo)} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14, cursor:"pointer" }}>
                  <span style={{ color:C.text, fontSize:13, fontWeight:600 }}>Disponible maintenant uniquement</span>
                  <div style={{ width:40, height:22, borderRadius:11, background:filterDispo?s.color:"rgba(255,255,255,0.15)", position:"relative", transition:"background 0.2s", flexShrink:0 }}>
                    <div style={{ position:"absolute", top:2, left:filterDispo?20:2, width:18, height:18, borderRadius:"50%", background:"#fff", transition:"left 0.2s" }} />
                  </div>
                </div>
                <div style={{ marginBottom:14 }}>
                  <div style={{ color:C.textSub, fontSize:12, marginBottom:6 }}>Tarif max : <strong style={{ color:s.color }}>{filterTarifMax === 50 ? "Tous" : `${filterTarifMax} €/h`}</strong></div>
                  <input type="range" min={10} max={50} step={1} value={filterTarifMax} onChange={e=>setFilterTarifMax(Number(e.target.value))} style={{ width:"100%", accentColor:s.color }} />
                  <div style={{ display:"flex", justifyContent:"space-between", color:C.textMuted, fontSize:10, marginTop:2 }}><span>10 €/h</span><span>50 €/h</span></div>
                </div>
                <div style={{ marginBottom:14 }}>
                  <div style={{ color:C.textSub, fontSize:12, marginBottom:8 }}>Note minimum</div>
                  <div style={{ display:"flex", gap:8 }}>
                    {[0,3,4,4.5].map(n=>(
                      <button key={n} onClick={()=>setFilterNoteMin(n)} style={{ flex:1, padding:"7px 4px", borderRadius:8, border:`1.5px solid ${filterNoteMin===n?s.color:C.border}`, background:filterNoteMin===n?`${s.color}20`:"transparent", color:filterNoteMin===n?s.color:C.textSub, fontSize:11, fontWeight:filterNoteMin===n?700:400, cursor:"pointer", fontFamily:"inherit" }}>
                        {n===0?"Tous":`${n}★+`}
                      </button>
                    ))}
                  </div>
                </div>
                <div onClick={()=>setFilterCertified(!filterCertified)} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", cursor:"pointer" }}>
                  <span style={{ color:C.text, fontSize:13, fontWeight:600 }}>✓ Certifiés uniquement <span style={{ color:C.textMuted, fontSize:11, fontWeight:400 }}>(Premium & Elite)</span></span>
                  <div style={{ width:40, height:22, borderRadius:11, background:filterCertified?C.violet:"rgba(255,255,255,0.15)", position:"relative", transition:"background 0.2s", flexShrink:0 }}>
                    <div style={{ position:"absolute", top:2, left:filterCertified?20:2, width:18, height:18, borderRadius:"50%", background:"#fff", transition:"left 0.2s" }} />
                  </div>
                </div>
                {(filterDispo||filterNoteMin>0||filterTarifMax<50||missionDate||filterCertified) && (
                  <button onClick={()=>{ setFilterDispo(false); setFilterNoteMin(0); setFilterTarifMax(50); setMissionDate(""); setFilterCertified(false); }} style={{ width:"100%", marginTop:12, padding:"8px", borderRadius:8, border:`1px solid ${C.border}`, background:"transparent", color:C.textSub, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>Réinitialiser les filtres</button>
                )}
              </div>
            )}
          </div>

          {/* Bouton broadcast métier sélectionné */}
          <div onClick={()=>onNavigate("mission_request", { ...s, _preselectedJob: selectedJob })} style={{ background:`linear-gradient(135deg,${C.violet}22,${C.indigo}15)`, border:`2px solid ${C.violet}55`, borderRadius:r+4, padding:"16px 18px", marginBottom:14, cursor:"pointer", display:"flex", alignItems:"center", gap:14, transition:"all 0.2s" }}
            onMouseEnter={e=>e.currentTarget.style.borderColor=C.violet}
            onMouseLeave={e=>e.currentTarget.style.borderColor=`${C.violet}55`}
          >
            <div style={{ width:44, height:44, borderRadius:12, background:`${C.violet}25`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, flexShrink:0 }}>🚀</div>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:800, color:C.text, fontSize:14 }}>Ne pas choisir le prestataire</div>
              <div style={{ color:C.textSub, fontSize:12, marginTop:2 }}>Diffusez votre demande · Le premier disponible accepte la prestation</div>
            </div>
            <span style={{ color:C.violet, fontSize:20, fontWeight:300 }}>›</span>
          </div>

          {/* Bouton urgence APRÈS le choix du métier */}
          <UrgentToggle showBeforeJob={false} />

          {/* Récap métier sélectionné */}
          <div style={{ background:urgentMode?`${C.accent}10`:C.offWhite, border:`1.5px solid ${urgentMode?C.accent+"44":C.grayLight}`, borderRadius:12, padding:"12px 14px", marginBottom:16 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:urgentMode?6:0 }}>
              <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                <span style={{ fontWeight:800, color:C.text, fontSize:14 }}>{selectedJob}</span>
                {urgentMode && <Badge color={C.accent} small>🚨 Urgence</Badge>}
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontWeight:800, color:urgentMode?C.accent:C.violet, fontSize:14 }}>{urgentPrice.toFixed(2).replace(".",",")} € HT/h</div>
                {urgentMode && <div style={{ color:C.textSub, fontSize:11, textDecoration:"line-through" }}>{basePrice.toFixed(2).replace(".",",")} € HT/h</div>}
              </div>
            </div>
            {urgentMode && (
              <div style={{ background:`${C.accent}15`, borderRadius:8, padding:"8px 10px", fontSize:12, color:C.text, lineHeight:1.5 }}>
                🚀 <strong>Surcoût urgence : +{surcharge},00 € HT/h</strong> — visible et accepté lors du récapitulatif de réservation avant paiement.
              </div>
            )}
          </div>

          {/* ── MODE URGENCE ACTIF → pas de liste ── */}
          {urgentMode ? (
            <div style={{ background:"#0D1B3E", borderRadius:18, padding:"28px 20px", textAlign:"center", boxShadow:"0 4px 24px rgba(0,0,0,0.5)", border:`2px solid ${C.accent}33` }}>
              <div style={{ fontSize:52, marginBottom:12 }}>🚀</div>
              <h3 style={{ color:C.text, fontSize:18, fontWeight:800, margin:"0 0 8px" }}>Prestation envoyée à tous les prestataires</h3>
              <p style={{ color:C.textSub, fontSize:14, lineHeight:1.7, margin:"0 auto 20px", maxWidth:280 }}>
                Tous les <strong style={{ color:C.text }}>{filteredProviders.filter(p=>p.available).length} prestataires disponibles</strong> en <strong style={{ color:C.text }}>{selectedJob}</strong> reçoivent votre demande simultanément. <strong style={{ color:C.accent }}>Le premier qui accepte assure la prestation.</strong>
              </p>

              {/* Détail surcoût */}
              <div style={{ background:`${C.accentGold}15`, border:`1px solid ${C.accentGold}44`, borderRadius:12, padding:"12px 14px", marginBottom:20, textAlign:"left" }}>
                <div style={{ fontWeight:800, color:C.text, fontSize:13, marginBottom:6 }}>💶 Détail du tarif urgence</div>
                {[
                  ["Tarif standard", `${basePrice.toFixed(2).replace(".",",")} € HT/h`],
                  ["Surcoût urgence", `+${surcharge},00 € HT/h`],
                  ["Tarif urgence total", `${urgentPrice.toFixed(2).replace(".",",")} € HT/h`],
                ].map(([l,v],i)=>(
                  <div key={i} style={{ display:"flex", justifyContent:"space-between", padding:"5px 0", borderBottom:i<2?`1px solid ${C.grayLight}`:"none" }}>
                    <span style={{ fontSize:12, color:C.textSub }}>{l}</span>
                    <span style={{ fontSize:12, fontWeight: i===2?800:600, color: i===2?C.accent:C.text }}>{v}</span>
                  </div>
                ))}
                <div style={{ fontSize:11, color:C.textSub, marginTop:6 }}>Le surcoût sera affiché et confirmé avant le paiement.</div>
              </div>

              <Btn full onClick={()=>onNavigate("booking", { ...filteredProviders[0], urgentMode:true, urgentPrice, jobTitle:selectedJob })} style={{ fontSize:15, padding:"16px", marginBottom:10 }}>
                🚀 Envoyer la prestation maintenant
              </Btn>
              <button onClick={()=>setUrgentMode(false)} style={{ background:"none", border:"none", color:C.textSub, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
                Annuler — choisir un prestataire manuellement
              </button>
            </div>

          ) : (
            /* ── MODE NORMAL → liste des prestataires ── */
            <>
              {/* Toggle liste / carte */}
              <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:10 }}>
                <div style={{ display:"flex", background:"rgba(255,255,255,0.06)", borderRadius:10, padding:3, border:`1px solid ${C.border}` }}>
                  {[{id:false, label:"📋 Liste"},{id:true, label:"🗺️ Carte"}].map(v => (
                    <button key={String(v.id)} onClick={()=>setShowMap(v.id)} style={{ padding:"6px 14px", borderRadius:8, border:"none", background:showMap===v.id?C.violet:"transparent", color:showMap===v.id?"#fff":C.textSub, fontSize:12, fontWeight:showMap===v.id?700:400, cursor:"pointer", fontFamily:"inherit", transition:"all 0.15s" }}>{v.label}</button>
                  ))}
                </div>
              </div>

              {/* Vue carte */}
              {showMap && <LeafletMap providers={filteredProviders} onNavigate={onNavigate} />}

              {/* Vue liste */}
              {!showMap && (filteredProviders.length === 0 ? (
                <div style={{ background:"#0D1B3E", borderRadius:r, padding:"24px", textAlign:"center", border:`1px solid ${C.border}` }}>
                  <div style={{ fontSize:32, marginBottom:8 }}>😔</div>
                  <div style={{ fontWeight:700, color:C.text, marginBottom:4 }}>Aucun prestataire disponible</div>
                  <div style={{ color:C.textSub, fontSize:13 }}>Revenez plus tard ou activez le mode urgence</div>
                </div>
              ) : filteredProviders.map(p => {
                const hasCv = !!(p.cv || CV_DATA[p.id]);
                return (
                  <div key={p.id} style={{
                    background:"#0D1B3E", borderRadius:r, marginBottom:11,
                    border:`1px solid ${C.border}`,
                    opacity: p.available ? 1 : 0.6,
                    overflow:"hidden",
                  }}
                    className="card-hover"
                  >
                    {/* Infos principales */}
                    <div onClick={()=>onNavigate("profile", p)} style={{ padding:"14px", display:"flex", gap:12, alignItems:"center", cursor:"pointer" }}>
                      <div style={{ width:52, height:52, borderRadius:r, background:`${p.color}22`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:26, flexShrink:0, position:"relative" }}>
                        {p.avatar}
                        {p.available && <div style={{ position:"absolute", bottom:1, right:1, width:12, height:12, borderRadius:"50%", background:C.success, border:`2px solid #0D1B3E` }} />}
                      </div>
                      <div style={{ flex:1 }}>
                        <div style={{ display:"flex", gap:6, alignItems:"center", marginBottom:2 }}>
                          <span style={{ fontWeight:700, color:C.text, fontSize:14 }}>{p.name}</span>
                          {p.plan==="elite"   && <span style={{ fontSize:10, fontWeight:700, color:"#F0B429", background:"#F0B42918", borderRadius:6, padding:"1px 6px" }}>👑 Elite</span>}
                          {p.plan==="premium" && <span style={{ fontSize:10, fontWeight:700, color:"#7C6FE0", background:"#7C6FE018", borderRadius:6, padding:"1px 6px" }}>✓ Certifié</span>}
                          {hasCv && <Badge color={C.violet} small>CV</Badge>}
                        </div>
                        <div style={{ color:C.textSub, fontSize:12, marginBottom:3 }}>{p.jobTitle}</div>
                        <div style={{ display:"flex", gap:5, alignItems:"center" }}>
                          <Stars rating={p.rating} size={12}/>
                          <span style={{ color:C.textSub, fontSize:11 }}>{(()=>{ if(clientCoords && p.code_postal){ const coords=cpToCoords(p.code_postal); if(coords){ const km=haversineKm(clientCoords.lat,clientCoords.lng,coords[0],coords[1]); return `🚗 ${travelTimeStr(km)} · ${km} km`; } } return p.distance||"—"; })()}</span>
                        </div>
                      </div>
                      <div style={{ textAlign:"right", flexShrink:0 }}>
                        <div style={{ color:C.violet, fontWeight:800, fontSize:13 }}>{p.hourlyRate}</div>
                        <div style={{ marginTop:4, fontSize:11, fontWeight:600, color:p.available?C.success:C.textMuted }}>
                          {p.available ? "● Dispo" : "○ Occupé"}
                        </div>
                      </div>
                    </div>

                    {/* Boutons actions */}
                    <div style={{ display:"flex", gap:0, borderTop:`1px solid ${C.border}` }}>
                      {hasCv && (
                        <button onClick={()=>onNavigate("cv", p)} style={{ flex:1, padding:"10px", background:"transparent", border:"none", borderRight:`1px solid ${C.border}`, color:C.violet, fontWeight:600, fontSize:12, cursor:"pointer", fontFamily:"inherit", display:"flex", alignItems:"center", justifyContent:"center", gap:5 }}>
                          📄 Voir CV
                        </button>
                      )}
                      <button onClick={()=>onNavigate("profile", p)} style={{ flex:1, padding:"10px", background:"transparent", border:"none", borderRight: p.available ? `1px solid ${C.border}` : "none", color:C.textSub, fontWeight:600, fontSize:12, cursor:"pointer", fontFamily:"inherit", display:"flex", alignItems:"center", justifyContent:"center", gap:5 }}>
                        👤 Profil
                      </button>
                      {p.available && (
                        <button onClick={()=>onNavigate("booking", p)} style={{ flex:1, padding:"10px", background:`${C.violet}15`, border:"none", color:C.violet, fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit", display:"flex", alignItems:"center", justifyContent:"center", gap:5 }}>
                          📅 Réserver
                        </button>
                      )}
                    </div>
                  </div>
                );
              }))}
            </>
          )}

          {/* Note HT */}
          <div style={{ background:C.bg, border:`1px solid ${C.border}`, borderRadius:10, padding:"10px 14px", marginTop:8, fontSize:11, color:C.textSub, textAlign:"center" }}>
            💡 Tous les prix sont <strong>hors taxes (HT)</strong>. TVA 20% selon votre statut fiscal.
          </div>
        </>}

      </div>
    </div>
  );
}

export function SearchFiltersScreen({ onNavigate }) {
  const [search,setSearch]=useState("");
  const [ratingMin,setRatingMin]=useState(0);
  const [tarifMax,setTarifMax]=useState(50);
  const [distMax,setDistMax]=useState(20);
  const [dispoNow,setDispoNow]=useState(false);
  const [showFilters,setShowFilters]=useState(false);
  const [favs,setFavs]=useState([]);
  const [favUserId,setFavUserId]=useState(null);
  const { providers, loading } = useProviders();

  useEffect(()=>{
    supabase.auth.getUser().then(({data})=>{
      const uid=data?.user?.id; if(!uid) return;
      setFavUserId(uid);
      supabase.from("favorites").select("provider_id").eq("user_id",uid)
        .then(({data:fd})=>{ if(fd) setFavs(fd.map(f=>f.provider_id)); });
    });
  },[]);

  const toggleFavSearch = async (pid) => {
    if(!favUserId) return;
    const isFav = favs.includes(pid);
    if(isFav) {
      await supabase.from("favorites").delete().eq("user_id",favUserId).eq("provider_id",pid);
      setFavs(f=>f.filter(id=>id!==pid));
    } else {
      await supabase.from("favorites").upsert({user_id:favUserId,provider_id:pid});
      setFavs(f=>[...f,pid]);
    }
  };

  const filtered = providers.filter(p=>{
    if (search) {
      const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
      const fields = [p.name, p.prenom, p.nom, p.jobTitle, ...(p.skills||[])].map(f=>(f||"").toLowerCase());
      if (!terms.every(t => fields.some(f => f.includes(t)))) return false;
    }
    if(p.rating < ratingMin) return false;
    if(p.rateNum > tarifMax) return false;
    if(dispoNow && !p.available) return false;
    return true;
  }).sort((a,b) => (b.planRank||0) - (a.planRank||0));

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg, #0A1628 0%, #0D1B3E 100%)`, paddingBottom:80 }}>
      <div style={{ background:"linear-gradient(135deg, #0A1628, #162547)", padding:"48px 22px 22px", borderRadius:"0 0 26px 26px" }}>
        <h2 style={{ color:C.white, fontSize:21, fontWeight:800, margin:"0 0 14px", fontFamily:font.display }}>Rechercher</h2>
        <div style={{ position:"relative" }}>
          <span style={{ position:"absolute", left:13, top:"50%", transform:"translateY(-50%)" }}>🔍</span>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Nom, métier, secteur…" style={{ width:"100%", padding:"13px 44px 13px 40px", borderRadius:13, border:"none", fontSize:14, fontFamily:"inherit", background:"rgba(255,255,255,0.15)", color:C.white, outline:"none", boxSizing:"border-box" }} />
          <button onClick={()=>setShowFilters(!showFilters)} style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)", background:showFilters?C.white:"rgba(255,255,255,0.2)", border:"none", borderRadius:8, padding:"5px 10px", cursor:"pointer", fontSize:12, color:showFilters?C.violet:C.white, fontWeight:700 }}>⚙️</button>
        </div>
      </div>

      {showFilters && (
        <div style={{ background:"#0D1B3E", padding:"16px 18px", borderBottom:`1px solid ${C.border}`, boxShadow:"0 4px 16px rgba(0,0,0,0.08)" }}>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:14 }}>
            <span style={{ fontWeight:800, color:C.text, fontSize:14 }}>Filtres</span>
            <button onClick={()=>{setRatingMin(0);setTarifMax(50);setDispoNow(false);}} style={{ background:"none", border:"none", color:C.violet, fontWeight:700, fontSize:12, cursor:"pointer" }}>Réinitialiser</button>
          </div>
          <div style={{ marginBottom:12 }}>
            <label style={{ fontSize:12, color:C.textSub, fontWeight:600 }}>Note minimum : {ratingMin > 0 ? `${ratingMin}★` : "Toutes"}</label>
            <div style={{ display:"flex", gap:6, marginTop:6 }}>
              {[0,4,4.5,4.8].map(r=><button key={r} onClick={()=>setRatingMin(r)} style={{ padding:"6px 12px", borderRadius:20, border:"none", cursor:"pointer", background:ratingMin===r?C.violet:C.grayLight, color:ratingMin===r?C.white:C.text, fontSize:12, fontWeight:ratingMin===r?700:500, fontFamily:"inherit" }}>{r===0?"Toutes":`${r}+★`}</button>)}
            </div>
          </div>
          <div style={{ marginBottom:12 }}>
            <label style={{ fontSize:12, color:C.textSub, fontWeight:600 }}>Tarif max : {tarifMax} €/h</label>
            <input type="range" min={10} max={50} value={tarifMax} onChange={e=>setTarifMax(+e.target.value)} style={{ width:"100%", marginTop:6, accentColor:C.violet }} />
          </div>
          <div style={{ display:"flex", gap:10 }}>
            <button onClick={()=>setDispoNow(!dispoNow)} style={{ flex:1, padding:"10px", borderRadius:12, border:`2px solid ${dispoNow?C.success:C.grayLight}`, background:dispoNow?`${C.success}15`:C.white, color:dispoNow?C.success:C.gray, fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>● Dispo maintenant</button>
          </div>
        </div>
      )}

      <div style={{ padding:"14px 18px" }}>
        <p style={{ color:C.textSub, fontSize:12, marginBottom:14 }}>{filtered.length} prestataire(s) trouvé(s)</p>
        {filtered.map(p=>(
          <div key={p.id} style={{ background:"#0D1B3E", borderRadius:18, padding:"16px", marginBottom:12, boxShadow:"0 4px 20px rgba(0,0,0,0.5)", cursor:"pointer" }}>
            <div style={{ display:"flex", gap:12, marginBottom:10 }}>
              <div onClick={()=>onNavigate("profile",p)} style={{ width:56, height:56, borderRadius:17, background:`${p.color}22`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:28, flexShrink:0, overflow:"hidden" }}>
                {p.photo_url ? <img src={p.photo_url} alt={p.name} style={{ width:"100%", height:"100%", objectFit:"cover" }} /> : p.avatar}
              </div>
              <div style={{ flex:1 }} onClick={()=>onNavigate("profile",p)}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                  <div>
                    <div style={{ display:"flex", gap:5, alignItems:"center", marginBottom:1 }}>
                      <div style={{ fontWeight:800, color:C.text, fontSize:15 }}>{p.name}</div>
                      {p.plan==="elite"   && <span style={{ fontSize:10, fontWeight:700, color:"#F0B429", background:"#F0B42918", borderRadius:6, padding:"1px 6px" }}>👑 Elite</span>}
                      {p.plan==="premium" && <span style={{ fontSize:10, fontWeight:700, color:"#7C6FE0", background:"#7C6FE018", borderRadius:6, padding:"1px 6px" }}>✓ Certifié</span>}
                    </div>
                    <div style={{ color:C.textSub, fontSize:12 }}>{p.role}</div>
                  </div>
                  <div style={{ textAlign:"right" }}><div style={{ color:C.violet, fontWeight:800, fontSize:14 }}>{p.hourlyRate} HT</div><div style={{ fontSize:11, color:p.available?C.success:C.accent, fontWeight:600 }}>{p.available?"● Dispo":"○ Occupé"}</div></div>
                </div>
                <div style={{ marginTop:3, display:"flex", gap:6, alignItems:"center" }}><Stars rating={p.rating} /><span style={{ color:C.textSub, fontSize:11 }}>{p.rating} · {p.distance} · {p.responseTime}</span></div>
              </div>
            </div>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:10 }}>
              {(p.skills||[]).slice(0,3).map(sk=><Badge key={sk} color={p.color} small>{sk}</Badge>)}
            </div>
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={()=>toggleFavSearch(p.id)} style={{ padding:"9px 14px", borderRadius:12, border:`2px solid ${favs.includes(p.id)?C.accent:C.grayLight}`, background:favs.includes(p.id)?`${C.accent}15`:C.white, cursor:"pointer", fontSize:16 }}>{favs.includes(p.id)?"❤️":"🤍"}</button>
              {p.available && <button onClick={()=>onNavigate("profile",p)} style={{ flex:1, padding:"9px", borderRadius:12, border:"none", background:`linear-gradient(135deg,${C.violet},${C.indigo})`, color:C.white, fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>Réserver →</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function CVScreen({ provider, onBack, onNavigate }) {
  const p = provider;
  if (!p) return null;
  const cv = p.cv || CV_DATA[p.id];

  if(!cv) return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg,#0A1628,#0D1B3E)`, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:32, textAlign:"center" }}>
      <div style={{ fontSize:60, marginBottom:16 }}>📄</div>
      <h3 style={{ color:C.text, fontSize:18, fontWeight:700, margin:"0 0 10px", fontFamily:font.display }}>CV non disponible</h3>
      <p style={{ color:C.textSub, fontSize:14, lineHeight:1.7, maxWidth:260, margin:"0 auto 28px" }}>
        {p.name} n'a pas encore renseigné son CV sur ALANE.
      </p>
      <Btn onClick={onBack} variant="ghost">← Retour au profil</Btn>
    </div>
  );

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg,#0A1628,#0D1B3E)`, paddingBottom:40 }}>

      {/* Header */}
      <div style={{ background:`linear-gradient(135deg,${p.color}55,${p.color}22)`, padding:"52px 22px 28px", position:"relative", overflow:"hidden" }}>
        <div style={{ position:"absolute", top:-40, right:-40, width:200, height:200, borderRadius:"50%", background:`${p.color}15`, pointerEvents:"none" }} />
        <button onClick={onBack} style={{ background:"rgba(255,255,255,0.15)", border:"none", borderRadius:10, padding:"7px 14px", color:C.white, cursor:"pointer", fontSize:13, marginBottom:18 }}>← Retour</button>
        <div style={{ display:"flex", gap:14, alignItems:"center", marginBottom:16 }}>
          <div style={{ width:60, height:60, borderRadius:18, background:`${p.color}44`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:30, border:"2px solid rgba(255,255,255,0.2)" }}>{p.avatar}</div>
          <div>
            <h2 style={{ color:C.white, fontSize:20, fontWeight:700, margin:"0 0 3px", fontFamily:font.display }}>{p.name}</h2>
            <p style={{ color:"rgba(255,255,255,0.7)", fontSize:13, margin:0 }}>{cv.titre}</p>
          </div>
        </div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          <Badge color="rgba(255,255,255,0.9)" small>⭐ {p.rating}/5</Badge>
          <Badge color="rgba(255,255,255,0.9)" small>📋 {p.missions} prestations</Badge>
          <Badge color="rgba(255,255,255,0.9)" small>🕐 {p.experience}</Badge>
        </div>
      </div>

      <div style={{ padding:"20px 18px" }}>

        {/* Accroche */}
        <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"16px", marginBottom:14 }}>
          <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:10 }}>
            <div style={{ width:28, height:28, borderRadius:8, background:`${C.violet}20`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:14 }}>👤</div>
            <span style={{ fontWeight:700, color:C.text, fontSize:14 }}>Profil</span>
          </div>
          <p style={{ color:C.textSub, fontSize:13, lineHeight:1.7, margin:0 }}>{cv.accroche}</p>
        </div>

        {/* Expériences */}
        <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"16px", marginBottom:14 }}>
          <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:14 }}>
            <div style={{ width:28, height:28, borderRadius:8, background:`${C.violet}20`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:14 }}>💼</div>
            <span style={{ fontWeight:700, color:C.text, fontSize:14 }}>Expériences professionnelles</span>
          </div>
          {cv.experiences.map((e,i) => (
            <div key={i} style={{ paddingBottom:i<cv.experiences.length-1?16:0, marginBottom:i<cv.experiences.length-1?16:0, borderBottom:i<cv.experiences.length-1?`1px solid ${C.border}`:"none", position:"relative", paddingLeft:18 }}>
              {/* Timeline dot */}
              <div style={{ position:"absolute", left:0, top:4, width:8, height:8, borderRadius:"50%", background:C.violet, boxShadow:`0 0 8px ${C.violet}88` }} />
              {i < cv.experiences.length-1 && (
                <div style={{ position:"absolute", left:3, top:12, width:2, height:"calc(100% - 8px)", background:`${C.violet}30` }} />
              )}
              <div style={{ fontWeight:700, color:C.text, fontSize:13 }}>{e.poste}</div>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", margin:"3px 0 6px" }}>
                <span style={{ color:C.violet, fontSize:12, fontWeight:600 }}>{e.entreprise}</span>
                <span style={{ color:C.textMuted, fontSize:11, background:"rgba(255,255,255,0.05)", padding:"2px 8px", borderRadius:6 }}>{e.periode}</span>
              </div>
              <p style={{ color:C.textSub, fontSize:12, margin:0, lineHeight:1.6 }}>{e.desc}</p>
            </div>
          ))}
        </div>

        {/* Formations */}
        <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"16px", marginBottom:14 }}>
          <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:14 }}>
            <div style={{ width:28, height:28, borderRadius:8, background:`${C.accentGold}20`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:14 }}>🎓</div>
            <span style={{ fontWeight:700, color:C.text, fontSize:14 }}>Formations & Diplômes</span>
          </div>
          {cv.formations.map((f,i) => (
            <div key={i} style={{ display:"flex", gap:12, alignItems:"flex-start", marginBottom:i<cv.formations.length-1?12:0, paddingBottom:i<cv.formations.length-1?12:0, borderBottom:i<cv.formations.length-1?`1px solid ${C.border}`:"none" }}>
              <div style={{ width:36, height:36, borderRadius:10, background:`${C.accentGold}18`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, flexShrink:0 }}>📜</div>
              <div style={{ flex:1 }}>
                <div style={{ fontWeight:700, color:C.text, fontSize:13 }}>{f.diplome}</div>
                <div style={{ color:C.textSub, fontSize:12, marginTop:2 }}>{f.etablissement}</div>
              </div>
              <span style={{ color:C.textMuted, fontSize:11, fontWeight:600, flexShrink:0 }}>{f.annee}</span>
            </div>
          ))}
        </div>

        {/* Infos complémentaires */}
        <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"16px", marginBottom:20 }}>
          <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:12 }}>
            <div style={{ width:28, height:28, borderRadius:8, background:`${C.success}20`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:14 }}>ℹ️</div>
            <span style={{ fontWeight:700, color:C.text, fontSize:14 }}>Informations</span>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            <div style={{ display:"flex", gap:10, alignItems:"center" }}>
              <span style={{ fontSize:16 }}>🌍</span>
              <div>
                <div style={{ fontSize:11, color:C.textMuted, fontWeight:600, textTransform:"uppercase", letterSpacing:0.5 }}>Langues</div>
                <div style={{ color:C.text, fontSize:13 }}>{cv.langues.join(" · ")}</div>
              </div>
            </div>
            <div style={{ display:"flex", gap:10, alignItems:"center" }}>
              <span style={{ fontSize:16 }}>🚗</span>
              <div>
                <div style={{ fontSize:11, color:C.textMuted, fontWeight:600, textTransform:"uppercase", letterSpacing:0.5 }}>Mobilité</div>
                <div style={{ color:C.text, fontSize:13 }}>{cv.permis}</div>
              </div>
            </div>
            <div style={{ display:"flex", gap:10, alignItems:"center" }}>
              <span style={{ fontSize:16 }}>💼</span>
              <div>
                <div style={{ fontSize:11, color:C.textMuted, fontWeight:600, textTransform:"uppercase", letterSpacing:0.5 }}>Compétences clés</div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginTop:4 }}>
                  {(p.skills||[]).map(sk=><Badge key={sk} color={p.color} small>{sk}</Badge>)}
                </div>
              </div>
            </div>
          </div>
        </div>

        <Btn full onClick={()=>onNavigate("booking", p)} style={{ fontSize:15, padding:"16px" }}>📅 Réserver {p.name}</Btn>
      </div>
    </div>
  );
}

export function ProfileScreen({ provider, onNavigate, onBack }) {
  if (!provider) return null;
  const [fav,setFav]=useState(false);
  const [copied,setCopied]=useState(false);
  const [userId,setUserId]=useState(null);
  const [reviews,setReviews]=useState([]);
  const [enriched,setEnriched]=useState(null);

  const p = {
    rating: 0, reviews: 0, distance: "—", available: false,
    jobTitle: "", experience: "—", prestations: "—", responseTime: "—",
    bio: null, langues: [], skills: [], metiers_list: [], cv: null,
    avatar: "👷", color: "#7C6FE0", photo_url: null,
    ...provider,
    ...(enriched || {}),
  };
  const cv = p.cv || CV_DATA[p.id];

  useEffect(()=>{
    if (!provider?.id) return;
    // Si les données clés manquent (navigation depuis carte prestation), on les fetche
    if (!provider.hourlyRate && !provider.jobTitle) {
      fetch("/api/prestataires")
        .then(r=>r.json())
        .then(d=>{
          const found = (d.prestataires||[]).find(x=>x.id===provider.id);
          if (!found) return;
          const sectorInfo = SECTORS.find(s=>s.id===found.secteur);
          const rateNum = prixClient(found.tarif_net||12, found.secteur||"divers");
          setEnriched({
            jobTitle:    found.metier    || "",
            hourlyRate:  `${rateNum.toFixed(2).replace(".",",")} € HT/h`,
            rateNum,
            bio:         found.bio       || null,
            langues:     Array.isArray(found.langues) ? found.langues : [],
            skills:      (found.metiers_list||[]).flatMap(m=>(m.certifs||"").split(",").map(c=>c.trim()).filter(Boolean)),
            metiers_list:found.metiers_list||[],
            dispon_jours:found.dispon_jours||[],
            rating:          found.rating         || 0,
            reviews:         found.reviews        || 0,
            missions_count:  found.missions_count || 0,
            available:       found.dispo_immediat !== false,
            photo_url:   found.photo_url || provider.photo_url || null,
            color:       sectorInfo?.color || provider.color || "#7C6FE0",
            avatar:      sectorInfo?.icon  || provider.avatar || "👷",
            cv:          found.cv         || null,
          });
        })
        .catch(()=>{});
    }
    supabase.auth.getUser().then(({data})=>{
      const uid=data?.user?.id;
      if(!uid) return;
      setUserId(uid);
      supabase.from("favorites").select("id").eq("user_id",uid).eq("provider_id",provider.id).single()
        .then(({data:fd})=>setFav(!!fd));
    });
    supabase.from("ratings").select("rating,comment,created_at,reviewer_id").eq("reviewee_provider_id",provider.id).order("created_at",{ascending:false}).limit(10)
      .then(({data:rd})=>{ if(rd) setReviews(rd); });
  },[provider?.id]);
  const toggleFav=async()=>{
    if(!userId) return;
    if(fav) {
      await supabase.from("favorites").delete().eq("user_id",userId).eq("provider_id",p.id);
    } else {
      await supabase.from("favorites").upsert({user_id:userId,provider_id:p.id});
    }
    setFav(!fav);
  };
  const handleShare=()=>{
    const link=`${window.location.origin}?profil=${p.id}`;
    if(navigator.share) {
      navigator.share({ title:p.name, text:`Découvrez le profil de ${p.name} sur ALANE`, url:link });
    } else {
      navigator.clipboard.writeText(link).then(()=>{ setCopied(true); setTimeout(()=>setCopied(false),2000); });
    }
  };
  return (
    <div style={{ minHeight:"100%", background:C.bg, paddingBottom:100 }}>
      <div style={{ background:`linear-gradient(135deg, #0A1628, ${p.color}99)`, padding:"48px 22px 36px" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:22 }}>
          <button onClick={onBack} style={{ background:"rgba(255,255,255,0.2)", border:"none", borderRadius:10, padding:"7px 13px", color:C.white, cursor:"pointer", fontSize:13 }}>← Retour</button>
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={handleShare} style={{ background:"rgba(255,255,255,0.2)", border:"none", borderRadius:10, padding:"7px 13px", cursor:"pointer", fontSize:13, color:C.white, fontWeight:600 }}>{copied?"✓ Copié !":"🔗 Partager"}</button>
            <button onClick={toggleFav} style={{ background:"rgba(255,255,255,0.2)", border:"none", borderRadius:10, padding:"7px 13px", cursor:"pointer", fontSize:18 }}>{fav?"❤️":"🤍"}</button>
          </div>
        </div>
        <div style={{ display:"flex", gap:16, alignItems:"flex-end", marginBottom:18 }}>
          <div style={{ width:76, height:76, borderRadius:22, background:`${p.color}44`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:38, border:"3px solid rgba(255,255,255,0.25)", position:"relative", overflow:"hidden" }}>
            {p.photo_url
              ? <img src={p.photo_url} alt={p.name} style={{ width:"100%", height:"100%", objectFit:"cover" }} />
              : p.avatar}
            {p.available && <div style={{ position:"absolute", bottom:2, right:2, width:14, height:14, borderRadius:"50%", background:C.success, border:"2px solid white" }} />}
          </div>
          <div>
            <h2 style={{ color:C.white, fontSize:22, fontWeight:800, margin:"0 0 3px" }}>{p.name}</h2>
            <p style={{ color:"rgba(255,255,255,0.7)", margin:"0 0 8px", fontSize:13 }}>{p.jobTitle}</p>
            <Stars rating={p.rating} size={14} /> <span style={{ color:"rgba(255,255,255,0.7)", fontSize:12, marginLeft:5 }}>{p.rating} · {p.reviews} avis · {p.distance}</span>
          </div>
        </div>
        <div style={{ display:"flex", gap:8 }}>
          {[
            { v: p.missions_count > 0 ? `${p.missions_count}` : "—", l: "Prestations" },
            { v: p.reviews > 0 ? `${p.rating}/5` : "—", l: "Note" },
            { v: p.available ? "Oui" : "Non", l: "Dispo" },
          ].map((s,i)=>(
            <div key={i} style={{ background:"rgba(255,255,255,0.14)", borderRadius:12, padding:"10px 8px", flex:1, textAlign:"center" }}>
              <div style={{ color: i===2 ? (p.available ? "#10D98F" : "rgba(255,255,255,0.5)") : C.white, fontWeight:800, fontSize:13 }}>{s.v}</div>
              <div style={{ color:"rgba(255,255,255,0.55)", fontSize:10 }}>{s.l}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ padding:"22px 18px" }}>

        {/* Bouton CV si disponible */}
        {cv && (
          <div onClick={()=>onNavigate("cv",p)} style={{ background:`${C.violet}15`, border:`1px solid ${C.violet}40`, borderRadius:r, padding:"13px 16px", marginBottom:14, cursor:"pointer", display:"flex", alignItems:"center", gap:12, transition:"all 0.2s" }}
            className="card-hover">
            <div style={{ width:40, height:40, borderRadius:11, background:`${C.violet}25`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20 }}>📄</div>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:700, color:C.text, fontSize:14 }}>Voir le CV complet</div>
              <div style={{ color:C.textSub, fontSize:12, marginTop:1 }}>Expériences · Formations · Langues</div>
            </div>
            <span style={{ color:C.violet, fontSize:16, fontWeight:300 }}>›</span>
          </div>
        )}

        {p.bio && (
          <div style={{ background:"#0D1B3E", borderRadius:18, padding:"17px", marginBottom:14, border:`1px solid ${C.border}` }}>
            <h4 style={{ margin:"0 0 10px", color:C.text, fontSize:14, fontWeight:700 }}>À propos</h4>
            <p style={{ color:C.textSub, lineHeight:1.7, margin:0, fontSize:14 }}>{p.bio}</p>
          </div>
        )}
        {p.skills?.length > 0 && (
          <div style={{ background:"#0D1B3E", borderRadius:18, padding:"17px", marginBottom:14, border:`1px solid ${C.border}` }}>
            <h4 style={{ margin:"0 0 10px", color:C.text, fontSize:14, fontWeight:700 }}>Compétences & certifications</h4>
            <div style={{ display:"flex", gap:7, flexWrap:"wrap" }}>{p.skills.map(sk=><Badge key={sk} color={p.color}>{sk}</Badge>)}</div>
          </div>
        )}
        <div style={{ background:"#0D1B3E", borderRadius:18, padding:"17px", marginBottom:14, border:`1px solid ${C.border}` }}>
          <h4 style={{ margin:"0 0 10px", color:C.text, fontSize:14, fontWeight:700 }}>Tarif</h4>
          {p.hourlyRate
            ? <div style={{ fontSize:30, fontWeight:800, color:C.violet }}>{p.hourlyRate}</div>
            : <div style={{ fontSize:16, color:C.textMuted }}>Non renseigné</div>}
          <div style={{ color:C.textSub, fontSize:12, marginTop:2 }}>Taux horaire · Auto-entrepreneur</div>
        </div>
        {p.langues?.length > 0 && (
          <div style={{ background:"#0D1B3E", borderRadius:18, padding:"17px", marginBottom:14, border:`1px solid ${C.border}` }}>
            <h4 style={{ margin:"0 0 10px", color:C.text, fontSize:14, fontWeight:700 }}>🌐 Langues</h4>
            <div style={{ display:"flex", gap:7, flexWrap:"wrap" }}>{p.langues.map(l=><Badge key={l} color={C.violet} small>{l}</Badge>)}</div>
          </div>
        )}
        {p.dispon_jours?.length > 0 && (
          <div style={{ background:"#0D1B3E", borderRadius:18, padding:"17px", marginBottom:14, border:`1px solid ${C.border}` }}>
            <h4 style={{ margin:"0 0 10px", color:C.text, fontSize:14, fontWeight:700 }}>📅 Disponibilités</h4>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
              {p.dispon_jours.map(j=><span key={j} style={{ background:`${C.violet}20`, border:`1px solid ${C.violet}44`, borderRadius:8, padding:"5px 12px", color:C.violet, fontSize:12, fontWeight:600 }}>{j}</span>)}
            </div>
          </div>
        )}
        {/* ── Avis clients ── */}
        <div style={{ background:"#0D1B3E", borderRadius:18, padding:"17px", marginBottom:14, border:`1px solid ${C.border}` }}>
          <h4 style={{ margin:"0 0 12px", color:C.text, fontSize:14, fontWeight:700 }}>⭐ Avis clients ({reviews.length})</h4>
          {reviews.length === 0 ? (
            <p style={{ color:C.textSub, fontSize:13, margin:0 }}>Aucun avis pour le moment.</p>
          ) : reviews.map((rv,i)=>(
            <div key={i} style={{ paddingBottom:12, marginBottom:12, borderBottom: i<reviews.length-1?`1px solid ${C.border}`:"none" }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
                <div style={{ display:"flex", gap:2 }}>{[1,2,3,4,5].map(s=><span key={s} style={{ fontSize:12, color: s<=rv.rating?C.accentGold:"rgba(255,255,255,0.2)" }}>★</span>)}</div>
                <span style={{ color:C.textMuted, fontSize:11 }}>{rv.created_at ? new Date(rv.created_at).toLocaleDateString("fr-FR",{month:"short",year:"numeric"}) : ""}</span>
              </div>
              {rv.comment && <p style={{ color:C.textSub, fontSize:13, margin:0, lineHeight:1.6, fontStyle:"italic" }}>"{rv.comment}"</p>}
            </div>
          ))}
        </div>

        {/* ── Actions ── */}
        {p.available && <Btn full onClick={()=>onNavigate("booking",p)} style={{ fontSize:15, padding:"15px" }}>📅 Réserver maintenant</Btn>}
      </div>
    </div>
  );
}

export function BookingScreen({ provider, onNavigate, onBack }) {
  const p = provider;
  if (!p) return null;
  const isUrgent = p.urgentMode || false;
  const urgentPrice = p.urgentPrice || null;
  const [step,setStep]=useState(1);
  const [payMethod,setPayMethod]=useState("carte");
  const [hours,setHours]=useState(isUrgent ? 4 : 8);
  const [missionType, setMissionType] = useState("single");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [startTime, setStartTime] = useState("08:00");
  const [description, setDescription] = useState("");
  const [adresse, setAdresse]         = useState("");
  const [ville, setVille]             = useState("");
  const [cp, setCp]                   = useState("");
  const [instructions, setInstructions] = useState("");
  const [adresseError, setAdresseError] = useState(false);
  const [dateError, setDateError] = useState(false);
  const [availError, setAvailError] = useState("");
  const [breakMin, setBreakMin] = useState(isUrgent ? 0 : 20); // 20min par défaut car hours=8 au démarrage
  const [cvOpen, setCvOpen] = useState(false);
  const [showClientContract, setShowClientContract] = useState(false);
  const [clientContractSignedAt, setClientContractSignedAt] = useState(null);

  const [walletInfo, setWalletInfo] = useState({ balance: 0, missionsThisMonth: 0 });
  const [savedAddress, setSavedAddress] = useState(null);
  const [fraisSettings, setFraisSettings] = useState(FRAIS_MER);
  const [launchPhaseBooking, setLaunchPhaseBooking] = useState(isLaunchPhase());
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data?.user) return;
      supabase.from("profiles").select("cashback_balance,missions_completed_month").eq("id", data.user.id).single()
        .then(({ data: prof }) => { if (prof) setWalletInfo({ balance: prof.cashback_balance || 0, missionsThisMonth: prof.missions_completed_month || 0 }); });
      const meta = data.user.user_metadata || {};
      if (meta.adresse) setSavedAddress({ adresse: meta.adresse, ville: meta.ville || "", cp: meta.code_postal || "" });
    });
    supabase.from("platform_settings").select("value").eq("key","frais_service").single()
      .then(({ data }) => { if (data?.value) setFraisSettings(data.value); });
    supabase.from("platform_settings").select("value").eq("key","launch_phase").single()
      .then(({ data }) => { if (data?.value != null) setLaunchPhaseBooking(Boolean(data.value)); });
  }, []);


  const tarifHoraire = isUrgent && urgentPrice ? urgentPrice : (p?.rateNum || prixClient(p?.tarifNet||14, p?.sector||'divers'));

  // Calcul du nombre de jours et total
  const nbJours = (() => {
    if(missionType==="single" || !startDate || !endDate) return 1;
    const d1 = new Date(startDate);
    const d2 = new Date(endDate);
    const diff = Math.ceil((d2 - d1) / (1000*60*60*24)) + 1;
    return diff > 0 ? diff : 1;
  })();

  const fraisMission = isUrgent ? fraisSettings.urgent : (missionType === "range" ? fraisSettings.range : fraisSettings.single);
  const totalParJour = (tarifHoraire * hours).toFixed(0);
  const totalHT = tarifHoraire * hours * nbJours;
  const totalGlobal = (Math.round((totalHT + fraisMission) * 100) / 100).toFixed(2);

  // Urgence
  const now = new Date();
  now.setMinutes(now.getMinutes() + 30);
  const urgentStartTime = now.toLocaleTimeString("fr-FR", { hour:"2-digit", minute:"2-digit" });
  const urgentStartDate = now.toLocaleDateString("fr-FR");

  // Formatage date lisible
  const formatDate = (d) => {
    if(!d) return "—";
    return new Date(d).toLocaleDateString("fr-FR", { day:"numeric", month:"long", year:"numeric" });
  };

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg, #0A1628 0%, #0D1B3E 100%)`, paddingBottom:80 }}>
      {/* Contrat électronique client */}
      {showClientContract && (
        <ContractModal
          title="Contrat de prestation de services"
          contractText={`CONTRAT DE PRESTATION DE SERVICES

Parties :
ALANE (plateforme) · ${p.name || ""} (prestataire) · (client)

Prestation :
Métier : ${p.jobTitle || p.role || ""}
Date : ${isUrgent ? urgentStartDate : startDate || ""}
Durée : ${hours} heure(s)
Tarif horaire : ${tarifHoraire.toFixed(2)} €/h

En confirmant ce contrat, vous acceptez les Conditions Générales de Prestation de Services (CGPS) d'ALANE et vous engagez à honorer la prestation telle que définie ci-dessus.

Le paiement sera libéré au prestataire après validation mutuelle de la prestation.

Signé électroniquement le ${new Date().toLocaleDateString("fr-FR")}`}
          onSign={(ts) => {
            setClientContractSignedAt(ts);
            setShowClientContract(false);
            setStep(2);
          }}
          onClose={() => setShowClientContract(false)}
        />
      )}

      {/* Overlay CV */}
      {cvOpen && (() => {
        const cv = p.cv || CV_DATA[p.id];
        return (
          <div style={{ position:"fixed", inset:0, zIndex:9000, background:"rgba(5,14,32,0.96)", overflowY:"auto", paddingBottom:40, WebkitOverflowScrolling:"touch" }}>
            <div style={{ background:`linear-gradient(135deg,${p.color}55,${p.color}22)`, padding:"52px 22px 28px", position:"relative", overflow:"hidden" }}>
              <div style={{ position:"absolute", top:-40, right:-40, width:200, height:200, borderRadius:"50%", background:`${p.color}15`, pointerEvents:"none" }} />
              <button onClick={()=>setCvOpen(false)} style={{ background:"rgba(255,255,255,0.15)", border:"none", borderRadius:10, padding:"7px 14px", color:"#fff", cursor:"pointer", fontSize:13, marginBottom:18 }}>← Retour à la réservation</button>
              <div style={{ display:"flex", gap:14, alignItems:"center", marginBottom:16 }}>
                <div style={{ width:60, height:60, borderRadius:18, background:`${p.color}44`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:30, border:"2px solid rgba(255,255,255,0.2)" }}>{p.avatar}</div>
                <div>
                  <h2 style={{ color:"#fff", fontSize:20, fontWeight:700, margin:"0 0 3px", fontFamily:font.display }}>{p.name}</h2>
                  <p style={{ color:"rgba(255,255,255,0.7)", fontSize:13, margin:0 }}>{cv ? cv.titre : p.jobTitle||p.role}</p>
                </div>
              </div>
              <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                <Badge color="rgba(255,255,255,0.9)" small>⭐ {p.rating}/5</Badge>
                <Badge color="rgba(255,255,255,0.9)" small>📋 {p.missions} prestations</Badge>
                <Badge color="rgba(255,255,255,0.9)" small>🕐 {p.experience}</Badge>
              </div>
            </div>
            <div style={{ padding:"20px 18px" }}>
              {!cv ? (
                <div style={{ textAlign:"center", padding:"40px 20px", color:C.textSub, fontSize:14, lineHeight:1.7 }}>
                  <div style={{ fontSize:50, marginBottom:14 }}>📄</div>
                  <div style={{ fontWeight:700, color:C.text, fontSize:16, marginBottom:8 }}>CV en cours de rédaction</div>
                  {p.name} n'a pas encore renseigné son CV complet.<br/>Consultez son profil et ses avis pour vous décider.
                </div>
              ) : (<>
                <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"16px", marginBottom:14 }}>
                  <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:10 }}>
                    <div style={{ width:28, height:28, borderRadius:8, background:`${C.violet}20`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:14 }}>👤</div>
                    <span style={{ fontWeight:700, color:C.text, fontSize:14 }}>Profil</span>
                  </div>
                  <p style={{ color:C.textSub, fontSize:13, lineHeight:1.7, margin:0 }}>{cv.accroche}</p>
                </div>
                <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"16px", marginBottom:14 }}>
                  <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:14 }}>
                    <div style={{ width:28, height:28, borderRadius:8, background:`${C.violet}20`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:14 }}>💼</div>
                    <span style={{ fontWeight:700, color:C.text, fontSize:14 }}>Expériences</span>
                  </div>
                  {cv.experiences.map((e,i)=>(
                    <div key={i} style={{ paddingBottom:i<cv.experiences.length-1?16:0, marginBottom:i<cv.experiences.length-1?16:0, borderBottom:i<cv.experiences.length-1?`1px solid ${C.border}`:"none", paddingLeft:18, position:"relative" }}>
                      <div style={{ position:"absolute", left:0, top:4, width:8, height:8, borderRadius:"50%", background:C.violet }} />
                      <div style={{ fontWeight:700, color:C.text, fontSize:13 }}>{e.poste}</div>
                      <div style={{ color:p.color, fontSize:12, margin:"2px 0" }}>{e.entreprise} · {e.periode}</div>
                      <div style={{ color:C.textSub, fontSize:12, lineHeight:1.6 }}>{e.desc}</div>
                    </div>
                  ))}
                </div>
                <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"16px", marginBottom:14 }}>
                  <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:14 }}>
                    <div style={{ width:28, height:28, borderRadius:8, background:`${C.violet}20`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:14 }}>🎓</div>
                    <span style={{ fontWeight:700, color:C.text, fontSize:14 }}>Formations</span>
                  </div>
                  {cv.formations.map((f,i)=>(
                    <div key={i} style={{ marginBottom:i<cv.formations.length-1?10:0, paddingBottom:i<cv.formations.length-1?10:0, borderBottom:i<cv.formations.length-1?`1px solid ${C.border}`:"none" }}>
                      <div style={{ fontWeight:600, color:C.text, fontSize:13 }}>{f.diplome}</div>
                      <div style={{ color:C.textSub, fontSize:12 }}>{f.etablissement} · {f.annee}</div>
                    </div>
                  ))}
                </div>
                <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"14px 16px", display:"flex", gap:16, flexWrap:"wrap" }}>
                  {cv.langues?.length > 0 && <div><div style={{ color:C.textSub, fontSize:11, fontWeight:600, marginBottom:4 }}>LANGUES</div>{cv.langues.map((l,i)=><div key={i} style={{ color:C.text, fontSize:13 }}>🌐 {l}</div>)}</div>}
                  {cv.permis && <div><div style={{ color:C.textSub, fontSize:11, fontWeight:600, marginBottom:4 }}>PERMIS</div><div style={{ color:C.text, fontSize:13 }}>🚗 {cv.permis}</div></div>}
                </div>
                <div style={{ marginTop:14 }}>
                  <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                    {p.skills?.map((s,i)=><Badge key={i} color={p.color} small>{s}</Badge>)}
                  </div>
                </div>
              </>)}
            </div>
          </div>
        );
      })()}

      <StepHeader step={step} total={4}
        title={["Détails prestation","Localisation","Paiement","Confirmation"][step-1]}
        onBack={step===1?onBack:()=>setStep(s=>s-1)} />
      <div style={{ padding:"22px 18px" }}>

        {step===1 && <>
          {/* Carte prestataire */}
          <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"14px", marginBottom:16, display:"flex", gap:12, alignItems:"center" }}>
            <div style={{ width:44, height:44, borderRadius:12, background:`${p.color}22`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:24, flexShrink:0 }}>{p.avatar}</div>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:700, color:C.text, fontSize:14 }}>{p.name}</div>
              <div style={{ color:C.textSub, fontSize:12 }}>{p.jobTitle||p.role} · {tarifHoraire.toFixed(2)} € HT/h</div>
            </div>
            {isUrgent && <Badge color={C.accent} small>🚨 Urgence</Badge>}
          </div>

          {/* Bouton CV */}
          <button onClick={()=>setCvOpen(true)} style={{ width:"100%", background:`${p.color}14`, border:`1px solid ${p.color}44`, borderRadius:12, padding:"11px 16px", marginBottom:14, color:p.color, fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit", display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
            <span>📄</span> Consulter le CV de {p.name}
          </button>

          {launchPhaseBooking && <LaunchBadge context="booking" />}

          {/* Bandeau urgence */}
          {isUrgent && (
            <div style={{ background:`${C.accent}12`, border:`1px solid ${C.accent}44`, borderRadius:r, padding:"12px 14px", marginBottom:16, display:"flex", gap:10 }}>
              <span style={{ fontSize:20, flexShrink:0 }}>🚀</span>
              <div>
                <div style={{ fontWeight:700, color:C.accent, fontSize:13, marginBottom:3 }}>Mode Urgence actif</div>
                <div style={{ color:C.textSub, fontSize:12, lineHeight:1.6 }}>Date et heure automatiques · <strong style={{ color:C.text }}>Aujourd'hui à {urgentStartTime}</strong> · Seule la durée est modifiable</div>
              </div>
            </div>
          )}

          {!isUrgent && <>
            {/* Toggle prestation simple / plage de dates */}
            <div style={{ marginBottom:16 }}>
              <label style={{ display:"block", fontSize:11, color:C.textSub, marginBottom:8, fontWeight:600, letterSpacing:0.8, textTransform:"uppercase" }}>Type de prestation</label>
              <div style={{ display:"flex", background:"rgba(255,255,255,0.05)", borderRadius:12, padding:4, border:`1px solid ${C.border}` }}>
                {[
                  { id:"single", icon:"📅", label:"Date unique"      },
                  { id:"range",  icon:"📆", label:"Plage de dates"   },
                ].map(t => (
                  <button key={t.id} onClick={()=>setMissionType(t.id)} style={{
                    flex:1, padding:"10px 8px", border:"none", borderRadius:10, cursor:"pointer",
                    background: missionType===t.id ? C.violet : "transparent",
                    color: missionType===t.id ? C.white : C.textSub,
                    fontWeight: missionType===t.id ? 700 : 500,
                    fontSize:13, fontFamily:"inherit",
                    boxShadow: missionType===t.id ? `0 4px 14px ${C.violet}44` : "none",
                    transition:"all 0.2s",
                    display:"flex", alignItems:"center", justifyContent:"center", gap:6,
                  }}>
                    <span>{t.icon}</span>{t.label}
                  </button>
                ))}
              </div>
            </div>

            {missionType === "single" ? (
              /* ── Date unique ── */
              <div style={{ display:"flex", gap:10, marginBottom:16 }}>
                <div style={{ flex:2 }}>
                  <Input label="Date de début *" type="date" placeholder="AAAA-MM-JJ" value={startDate} onChange={e=>{ setStartDate(e.target.value); setDateError(false); }} />
                </div>
                <div style={{ flex:1 }}>
                  <Input label="Heure" type="time" placeholder="HH:MM" value={startTime} onChange={e=>setStartTime(e.target.value)} />
                </div>
              </div>
            ) : (
              /* ── Plage de dates ── */
              <>
                <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"16px", marginBottom:14 }}>
                  <label style={{ display:"block", fontSize:11, color:C.textSub, marginBottom:12, fontWeight:600, letterSpacing:0.8, textTransform:"uppercase" }}>Période de la prestation</label>

                  <div style={{ display:"flex", gap:10, marginBottom:14 }}>
                    <div style={{ flex:1 }}>
                      <label style={{ display:"block", fontSize:11, color:C.textMuted, marginBottom:6, fontWeight:600 }}>Du</label>
                      <input type="date" value={startDate} onChange={e=>{ setStartDate(e.target.value); setDateError(false); }} placeholder="AAAA-MM-JJ"
                        style={{ width:"100%", padding:"12px 14px", borderRadius:12, border:`1px solid ${C.border}`, fontSize:14, fontFamily:"inherit", color:C.text, background:"#112240", outline:"none", boxSizing:"border-box" }} />
                    </div>
                    <div style={{ display:"flex", alignItems:"flex-end", paddingBottom:12, color:C.textMuted, fontSize:18, fontWeight:300 }}>→</div>
                    <div style={{ flex:1 }}>
                      <label style={{ display:"block", fontSize:11, color:C.textMuted, marginBottom:6, fontWeight:600 }}>Au</label>
                      <input type="date" value={endDate} onChange={e=>{ setEndDate(e.target.value); setDateError(false); }} min={startDate} placeholder="AAAA-MM-JJ"
                        style={{ width:"100%", padding:"12px 14px", borderRadius:12, border:`1px solid ${C.border}`, fontSize:14, fontFamily:"inherit", color:C.text, background:"#112240", outline:"none", boxSizing:"border-box" }} />
                    </div>
                  </div>

                  {/* Heure de début quotidienne */}
                  <div style={{ display:"flex", gap:10, alignItems:"center" }}>
                    <div style={{ flex:1 }}>
                      <label style={{ display:"block", fontSize:11, color:C.textMuted, marginBottom:6, fontWeight:600 }}>Heure de début (chaque jour)</label>
                      <input type="time" value={startTime} onChange={e=>setStartTime(e.target.value)} placeholder="HH:MM"
                        style={{ width:"100%", padding:"12px 14px", borderRadius:12, border:`1px solid ${C.border}`, fontSize:14, fontFamily:"inherit", color:C.text, background:"#112240", outline:"none", boxSizing:"border-box" }} />
                    </div>
                  </div>

                  {/* Résumé plage sélectionnée */}
                  {startDate && endDate && nbJours > 0 && (
                    <div style={{ marginTop:14, background:`${C.violet}15`, border:`1px solid ${C.violet}30`, borderRadius:10, padding:"10px 12px" }}>
                      <div style={{ fontWeight:700, color:C.violet, fontSize:13, marginBottom:4 }}>
                        📅 {nbJours} jour{nbJours>1?"s":" "} · {formatDate(startDate)} → {formatDate(endDate)}
                      </div>
                      <div style={{ color:C.textSub, fontSize:12 }}>
                        {hours}h/jour × {nbJours} jour{nbJours>1?"s":""} = <strong style={{ color:C.text }}>{hours*nbJours}h au total</strong>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </>}

          {/* Mode urgence — date grisée */}
          {isUrgent && (
            <div style={{ display:"flex", gap:10, marginBottom:16, opacity:0.45 }}>
              <div style={{ flex:2 }}>
                <label style={{ display:"block", fontSize:11, color:C.textSub, marginBottom:7, fontWeight:600, textTransform:"uppercase" }}>Date <span style={{ color:C.accent }}>· Auto</span></label>
                <div style={{ padding:"13px 14px", borderRadius:r, border:`1px solid ${C.border}`, fontSize:14, color:C.textMuted, background:"rgba(255,255,255,0.03)" }}>🔒 {urgentStartDate}</div>
              </div>
              <div style={{ flex:1 }}>
                <label style={{ display:"block", fontSize:11, color:C.textSub, marginBottom:7, fontWeight:600, textTransform:"uppercase" }}>Heure <span style={{ color:C.accent }}>· Auto</span></label>
                <div style={{ padding:"13px 14px", borderRadius:r, border:`1px solid ${C.border}`, fontSize:14, color:C.textMuted, background:"rgba(255,255,255,0.03)" }}>🔒 {urgentStartTime}</div>
              </div>
            </div>
          )}

          {/* Durée par jour */}
          <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"14px 16px", marginBottom:14 }}>
            <label style={{ display:"block", fontSize:11, color:C.textSub, marginBottom:10, fontWeight:600, textTransform:"uppercase", letterSpacing:0.8 }}>
              {isUrgent ? "⏱️ Durée (mode urgence)" : missionType==="range" ? "Heures par jour" : "Durée de la prestation"}
            </label>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
              <span style={{ fontSize:22, fontWeight:800, color:C.violet }}>{hours}h{missionType==="range"?" / jour":""}</span>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontWeight:800, color:isUrgent?C.accent:C.violet, fontSize:16 }}>{totalParJour} € HT{missionType==="range"?"/jour":""}</div>
                <div style={{ color:C.textMuted, fontSize:11, marginTop:1 }}>+ {fraisMission.toFixed(2)} € frais = <span style={{ color:C.accentGold, fontWeight:700 }}>{missionType==="range"&&nbJours>1 ? (totalHT + fraisMission).toFixed(2) : totalGlobal} € total</span></div>
                {missionType==="range" && nbJours > 1 && (
                  <div style={{ color:C.accentGold, fontSize:12, fontWeight:700 }}>Total : {totalGlobal} € ({nbJours}j)</div>
                )}
              </div>
            </div>
            <input type="range" min={1} max={12} value={hours} onChange={e=>setHours(+e.target.value)}
              style={{ width:"100%", accentColor: isUrgent ? C.accent : C.violet }} />
            <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:C.textMuted, marginTop:4 }}>
              <span>1h min</span><span>12h max</span>
            </div>
            {isUrgent && (
              <div style={{ marginTop:10, background:`${C.accentGold}15`, borderRadius:8, padding:"8px 10px", fontSize:11, color:C.text }}>
                💶 Tarif urgence : <strong>{tarifHoraire.toFixed(2)} € HT/h</strong> (tarif standard + 2,00 € surcoût urgence)
              </div>
            )}
          </div>

          {/* Description */}
          <div style={{ marginBottom:16 }}>
            <label style={{ display:"block", fontSize:11, color:C.textSub, marginBottom:7, fontWeight:600, letterSpacing:0.8, textTransform:"uppercase" }}>Description de la prestation</label>
            <textarea value={description} onChange={e=>setDescription(e.target.value)}
              placeholder="Décrivez la prestation en détail…"
              style={{ width:"100%", padding:"13px 15px", borderRadius:r, border:`1px solid ${C.border}`, fontSize:14, fontFamily:"inherit", resize:"none", height:80, boxSizing:"border-box", outline:"none", background:"#112240", color:C.text, lineHeight:1.6 }} />
          </div>

          {dateError && <div style={{ background:"rgba(242,94,94,0.12)", border:"1px solid rgba(242,94,94,0.4)", borderRadius:10, padding:"10px 14px", marginBottom:10, fontSize:13, color:"#F25E5E" }}>⚠️ {missionType==="range" && !endDate ? "La date de fin est requise" : "La date de début est requise"}</div>}
          {availError && <div style={{ background:"rgba(242,94,94,0.12)", border:"1px solid rgba(242,94,94,0.4)", borderRadius:10, padding:"10px 14px", marginBottom:10, fontSize:13, color:"#F25E5E" }}>🚫 {availError}</div>}
          <Btn full onClick={()=>{
            if(!isUrgent){
              if(!startDate){ setDateError(true); return; }
              if(missionType==="range" && !endDate){ setDateError(true); return; }
              // Vérification disponibilité prestataire
              const JOURS_FR = ["Dimanche","Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi"];
              const [yr,mo,dy] = startDate.split("-").map(Number);
              const jourFr = JOURS_FR[new Date(yr, mo-1, dy).getDay()];
              const dispoDays = p.dispon_jours || [];
              if (dispoDays.length > 0 && !dispoDays.includes(jourFr)) {
                setAvailError(`${p.name} n'est pas disponible le ${jourFr}. Jours disponibles : ${dispoDays.join(", ")}.`);
                return;
              }
              const creneaux = p.dispon_jours_creneaux || {};
              const daySlots = creneaux[jourFr] || [];
              if (daySlots.length > 0 && startTime) {
                const h = parseInt(startTime.split(":")[0], 10);
                const slotOk = (daySlots.includes("Matin (6h-13h)") && h >= 6 && h < 13) ||
                               (daySlots.includes("Après-midi (13h-20h)") && h >= 13 && h < 20) ||
                               (daySlots.includes("Soir/Nuit (20h-6h)") && (h >= 20 || h < 6));
                if (!slotOk) {
                  setAvailError(`${p.name} n'est pas disponible sur ce créneau le ${jourFr}. Créneaux déclarés : ${daySlots.join(", ")}.`);
                  return;
                }
              }
            }
            setDateError(false); setAvailError("");
            if (!clientContractSignedAt) {
              setShowClientContract(true);
            } else {
              setStep(2);
            }
          }} style={{ fontSize:15, padding:"16px" }}>Continuer →</Btn>
        </>}

        {step===2 && <>
          <div style={{ background:"#0D1B3E", borderRadius:16, overflow:"hidden", marginBottom:14, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
            {(adresse || ville) ? (
              <a
                href={`https://maps.apple.com/?q=${encodeURIComponent([adresse, cp, ville].filter(Boolean).join(", "))}`}
                target="_blank" rel="noreferrer"
                style={{ display:"block", textDecoration:"none" }}
              >
                <img
                  alt="Carte"
                  width="100%"
                  height="150"
                  style={{ display:"block", objectFit:"cover" }}
                  src={`https://staticmap.openstreetmap.de/staticmap.php?center=${encodeURIComponent([ville||"Paris", "France"].join(", "))}&zoom=15&size=480x150&markers=${encodeURIComponent([adresse, ville].filter(Boolean).join(", "))},red`}
                  onError={e => { e.target.style.display="none"; e.target.nextSibling.style.display="flex"; }}
                />
                <div style={{ display:"none", background:`linear-gradient(135deg,${C.navy}18,${C.indigo}18)`, height:150, alignItems:"center", justifyContent:"center", flexDirection:"column", gap:6 }}>
                  <div style={{ fontSize:28 }}>📍</div>
                  <div style={{ color:C.textMuted, fontSize:12 }}>Appuyer pour ouvrir la carte</div>
                </div>
              </a>
            ) : (
              <div style={{ background:`linear-gradient(135deg,${C.navy}18,${C.indigo}18)`, height:150, display:"flex", alignItems:"center", justifyContent:"center" }}>
                <div style={{ textAlign:"center", color:C.textMuted }}>
                  <div style={{ fontSize:32, marginBottom:6 }}>📍</div>
                  <div style={{ fontSize:12 }}>Entrez l'adresse ci-dessous</div>
                </div>
              </div>
            )}
            <div style={{ padding:14, display:"flex", alignItems:"center", justifyContent:"space-between", gap:10 }}>
              <div>
                <div style={{ fontWeight:700, color:C.text, fontSize:14 }}>Lieu de la prestation</div>
                {(adresse || ville) && <div style={{ color:C.textSub, fontSize:12, marginTop:2 }}>{[adresse, ville, cp].filter(Boolean).join(", ")}</div>}
              </div>
              {(adresse || ville) && (
                <a href={`https://maps.apple.com/?q=${encodeURIComponent([adresse, cp, ville].filter(Boolean).join(", "))}`} target="_blank" rel="noreferrer"
                  style={{ background:`${C.violet}20`, border:`1px solid ${C.violet}44`, borderRadius:10, padding:"7px 12px", color:C.violet, fontWeight:700, fontSize:12, textDecoration:"none", whiteSpace:"nowrap", flexShrink:0 }}>
                  🗺 Ouvrir →
                </a>
              )}
            </div>
          </div>
          {savedAddress && (
            <button onClick={()=>{ setAdresse(savedAddress.adresse); setVille(savedAddress.ville); setCp(savedAddress.cp); setAdresseError(false); }} style={{ width:"100%", padding:"12px 16px", borderRadius:12, border:`1px solid ${C.indigo}55`, background:`${C.indigo}15`, color:C.text, fontSize:13, fontWeight:600, cursor:"pointer", fontFamily:"inherit", textAlign:"left", marginBottom:8, display:"flex", alignItems:"center", gap:10 }}>
              <span style={{ fontSize:16 }}>📍</span>
              <div>
                <div style={{ color:C.textSub, fontSize:11, marginBottom:2 }}>Même adresse qu'à l'inscription</div>
                <div>{savedAddress.adresse}{savedAddress.ville ? `, ${savedAddress.ville}` : ""}{savedAddress.cp ? ` ${savedAddress.cp}` : ""}</div>
              </div>
            </button>
          )}
          <AddressAutocomplete label="Adresse *" value={adresse} onChange={v=>{setAdresse(v);setAdresseError(false);}} onSelect={s=>{setAdresse(s.rue);setVille(s.ville);setCp(s.codePostal);}} />
          <Input label="Ville *" placeholder="Paris" value={ville} onChange={e=>setVille(e.target.value)} />
          <Input label="Code postal" placeholder="75001" value={cp} onChange={e=>setCp(e.target.value)} />
          <Input label="Informations complémentaires" placeholder="Digicode, étage, instructions…" value={instructions} onChange={e=>setInstructions(e.target.value)} />
          {adresseError && <div style={{ background:"rgba(242,94,94,0.12)", border:"1px solid rgba(242,94,94,0.4)", borderRadius:10, padding:"10px 14px", marginBottom:10, fontSize:13, color:"#F25E5E" }}>⚠️ L'adresse et la ville sont requises</div>}
          <Btn full onClick={()=>{ if(!adresse.trim()||!ville.trim()){ setAdresseError(true); return; } setStep(3); }}>Confirmer l'adresse →</Btn>
        </>}

        {step===3 && <>
          <div style={{ background:"#0D1B3E", borderRadius:16, padding:"16px", marginBottom:14, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
            <h4 style={{ margin:"0 0 12px", color:C.text, fontSize:14, fontWeight:800 }}>💳 Mode de paiement</h4>
            {[{id:"carte",label:"Carte bancaire",icon:"💳",sub:"Visa, Mastercard, Amex"},{id:"virement",label:"Virement bancaire",icon:"🏦",sub:"Délai 1-2 jours"}].map(m=>(
              <div key={m.id} onClick={()=>setPayMethod(m.id)} style={{ border:`1px solid ${payMethod===m.id?C.violet:C.border}`, borderRadius:r, padding:"13px 14px", marginBottom:8, cursor:"pointer", display:"flex", gap:12, alignItems:"center", background:payMethod===m.id?`${C.violet}15`:"#112240", transition:"all 0.2s" }}>
                <span style={{ fontSize:22 }}>{m.icon}</span>
                <div style={{ flex:1 }}><div style={{ fontWeight:700, color:C.text, fontSize:14 }}>{m.label}</div><div style={{ color:C.textSub, fontSize:11 }}>{m.sub}</div></div>
                <div style={{ width:18, height:18, borderRadius:"50%", border:`1px solid ${payMethod===m.id?C.violet:C.border}`, background:payMethod===m.id?C.violet:"transparent", display:"flex", alignItems:"center", justifyContent:"center" }}>{payMethod===m.id && <div style={{ width:8, height:8, borderRadius:"50%", background:C.white }} />}</div>
              </div>
            ))}
            {payMethod==="carte" && <div style={{ marginTop:12 }}><Input label="Numéro de carte" placeholder="4242 4242 4242 4242" icon="💳" /><div style={{ display:"flex", gap:10 }}><div style={{ flex:1 }}><Input label="Expiration" placeholder="MM/AA" /></div><div style={{ flex:1 }}><Input label="CVV" placeholder="•••" /></div></div></div>}
          </div>

          {/* Récapitulatif */}
          <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"16px", marginBottom:14 }}>
            <h4 style={{ margin:"0 0 12px", color:C.text, fontSize:15, fontWeight:700 }}>Récapitulatif</h4>
            {[
              ["Prestataire", p.name],
              ["Métier", p.jobTitle||p.role],
              ["Date", isUrgent ? `Aujourd’hui — ${urgentStartDate}` : missionType==="range" && startDate && endDate ? `${formatDate(startDate)} → ${formatDate(endDate)}` : formatDate(startDate)],
              ["Heure de début", isUrgent ? `${urgentStartTime} (~30 min)` : startTime||"—"],
              ...(missionType==="range" && nbJours>1 ? [["Durée totale", `${nbJours} jours × ${hours}h = ${hours*nbJours}h`]] : [["Durée", `${hours}h`]]),
              ...(!isUrgent && breakMin>0 ? [["Temps effectif", `${Math.floor((hours*60-breakMin)/60)}h${(hours*60-breakMin)%60>0?` ${(hours*60-breakMin)%60}min`:""}`]] : []),
              ["Tarif HT/h", `${tarifHoraire.toFixed(2)} €${isUrgent?" (urgence)":""}`],
              ...(isUrgent ? [["dont surcoût urgence","+2,00 € HT/h"]] : []),
              ["Lieu","Paris 75001"],
            ].map(([l,v])=>(
              <div key={l} style={{ display:"flex", justifyContent:"space-between", padding:"8px 0", borderBottom:`1px solid ${C.border}` }}>
                <span style={{ color:C.textSub, fontSize:13 }}>{l}</span>
                <span style={{ fontWeight:700, color: l.includes("surcoût")?C.accent:C.text, fontSize:13 }}>{v}</span>
              </div>
            ))}
            <div style={{ display:"flex", justifyContent:"space-between", padding:"8px 0", borderBottom:`1px solid ${C.border}` }}>
              <span style={{ color:C.textSub, fontSize:13 }}>Sous-total HT {missionType==="range" && nbJours>1 && <span style={{ color:C.textMuted, fontSize:11 }}>({nbJours}j)</span>}</span>
              <span style={{ fontWeight:600, color:C.text, fontSize:13 }}>{totalHT.toFixed(2)} €</span>
            </div>
            <div style={{ display:"flex", justifyContent:"space-between", padding:"8px 0", borderBottom:`1px solid ${C.border}` }}>
              <span style={{ color:C.textSub, fontSize:13 }}>Frais de service</span>
              <span style={{ fontWeight:600, color:C.accentGold, fontSize:13 }}>{fraisMission.toFixed(2)} €</span>
            </div>
            <div style={{ display:"flex", justifyContent:"space-between", padding:"12px 0 4px" }}>
              <span style={{ fontWeight:700, color:C.text, fontSize:15 }}>Total TTC</span>
              <span style={{ fontWeight:800, color:isUrgent?C.accent:C.violet, fontSize:18 }}>{totalGlobal} €</span>
            </div>

            {/* Cashback gagné sur cette prestation */}
            {(() => {
              const tier = getCashbackTier(walletInfo.missionsThisMonth);
              const earned = calcCashback(Number(totalGlobal), walletInfo.missionsThisMonth);
              return (
                <div style={{ display:"flex", justifyContent:"space-between", padding:"10px 0 0", alignItems:"center" }}>
                  <div style={{ display:"flex", gap:7, alignItems:"center" }}>
                    <span style={{ fontSize:15 }}>💰</span>
                    <div>
                      <div style={{ fontSize:12, fontWeight:700, color:C.success }}>Cashback gagné</div>
                      <div style={{ fontSize:10, color:C.textMuted }}>Palier {tier.icon} {tier.label} · {(tier.rate*100).toFixed(0)}% du total</div>
                    </div>
                  </div>
                  <span style={{ fontWeight:800, color:C.success, fontSize:15 }}>+{earned.toFixed(2)} €</span>
                </div>
              );
            })()}
          </div>

          {/* Solde cashback disponible */}
          {walletInfo.balance >= 10 && (
            <div style={{ background:`${C.success}10`, border:`1px solid ${C.success}30`, borderRadius:r, padding:"13px 15px", marginBottom:14, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div>
                <div style={{ fontWeight:700, color:C.success, fontSize:13, marginBottom:2 }}>💰 Cashback disponible</div>
                <div style={{ color:C.textSub, fontSize:12 }}>Vous avez {walletInfo.balance.toFixed(2)} € à utiliser</div>
              </div>
              <button style={{ background:`${C.success}25`, border:`1px solid ${C.success}44`, borderRadius:10, padding:"7px 14px", color:C.success, fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>
                Appliquer
              </button>
            </div>
          )}

          {isUrgent && (
            <div style={{ background:`${C.accent}10`, border:`1px solid ${C.accent}30`, borderRadius:r, padding:"11px 14px", marginBottom:14, fontSize:12, color:C.text, lineHeight:1.6 }}>
              🚨 <strong>Prestation urgente</strong> — Le premier prestataire disponible qui accepte assure la prestation. Intervention prévue dans l'heure.
            </div>
          )}

          <div style={{ background:`${C.success}10`, border:`1px solid ${C.success}25`, borderRadius:r, padding:"11px 14px", marginBottom:10, fontSize:12, color:C.textSub, lineHeight:1.6 }}>
            🔒 Paiement sécurisé — libéré uniquement après validation mutuelle de la prestation
          </div>
          <div style={{ background:"rgba(255,255,255,0.03)", border:`1px solid ${C.border}`, borderRadius:r, padding:"12px 14px", marginBottom:18 }}>
            <div style={{ fontWeight:700, color:C.text, fontSize:12, marginBottom:8 }}>📋 Politique d'annulation</div>
            {[
              ["Annulation prestataire", "Remboursement intégral", "#10D98F"],
              ["Annulation client < 24h", "Frais de service retenus uniquement", "#F0B429"],
              ["Annulation client ≥ 24h avant", "Remboursement intégral", "#10D98F"],
            ].map(([cas, regle, col]) => (
              <div key={cas} style={{ display:"flex", justifyContent:"space-between", padding:"5px 0", borderBottom:`1px solid rgba(255,255,255,0.05)` }}>
                <span style={{ color:C.textSub, fontSize:11 }}>{cas}</span>
                <span style={{ color:col, fontWeight:700, fontSize:11 }}>{regle}</span>
              </div>
            ))}
          </div>
          <Btn full onClick={()=>{ onNavigate("stripe_pay",{ amount: parseFloat(totalGlobal), hours, date: startDate||"", startTime: isUrgent ? urgentStartTime : (startTime||"08:00"), description: description.trim()||undefined, adresse: adresse.trim()||undefined, ville: ville.trim()||undefined, cp: cp.trim()||undefined }); }} style={{ background: isUrgent?C.accent:undefined }}>
            {isUrgent?"🚀":"✅"} Confirmer & payer {totalGlobal} €
          </Btn>
        </>}

        {step===4 && (
          <div style={{ textAlign:"center", paddingTop:10 }}>
            {/* Cashback gagné — confirmation */}
            {(() => {
              const earned = calcCashback(Number(totalGlobal), walletInfo.missionsThisMonth);
              const tier = getCashbackTier(walletInfo.missionsThisMonth);
              return (
                <div style={{ background:`${C.success}12`, border:`1px solid ${C.success}30`, borderRadius:r, padding:"16px", marginBottom:20, display:"flex", gap:12, alignItems:"center" }}>
                  <div style={{ width:44, height:44, borderRadius:12, background:`${C.success}20`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22 }}>💰</div>
                  <div style={{ flex:1, textAlign:"left" }}>
                    <div style={{ fontWeight:700, color:C.success, fontSize:14, marginBottom:2 }}>+{earned.toFixed(2)} € de cashback gagné !</div>
                    <div style={{ color:C.textSub, fontSize:12 }}>Crédit dans 24h · Palier {tier.icon} {tier.label} ({(tier.rate*100).toFixed(0)}%)</div>
                  </div>
                </div>
              );
            })()}
            <div style={{ fontSize:60, marginBottom:14 }}>{isUrgent?"🚀":"✅"}</div>
            <h3 style={{ color:C.text, fontSize:21, fontWeight:700, marginBottom:6, fontFamily:font.display }}>
              {isUrgent ? "Prestation urgente envoyée !" : "Réservation confirmée !"}
            </h3>
            <p style={{ color:C.textSub, fontSize:14, marginBottom:24, lineHeight:1.7 }}>
              {isUrgent
                ? <>Votre prestation a été envoyée à tous les prestataires disponibles. Le paiement de <strong style={{ color:C.accent }}>{totalGlobal} €</strong> est sécurisé via Stripe.</>
                : <>Le paiement de <strong style={{ color:C.violet }}>{totalGlobal} €</strong> est sécurisé via Stripe et sera libéré après validation mutuelle.</>
              }
            </p>
            <div style={{ background:"#0D1B3E", borderRadius:18, padding:"18px", marginBottom:18, boxShadow:"0 2px 12px rgba(0,0,0,0.4)", textAlign:"left" }}>
              <h4 style={{ margin:"0 0 12px", color:C.text, fontSize:14, fontWeight:800 }}>📋 Prochaines étapes</h4>
              {(isUrgent
                ? ["Un prestataire accepte la prestation","Vous recevez une notification immédiate","Suivez son arrivée en temps réel","Validation + paiement libéré"]
                : ["Le prestataire confirme sa venue","Suivez son arrivée en temps réel","Prestation effectuée → Validation mutuelle","Paiement libéré automatiquement"]
              ).map((s,i)=>(
                <div key={i} style={{ display:"flex", gap:10, alignItems:"center", padding:"8px 0", borderBottom:i<3?`1px solid ${C.grayLight}`:"none" }}>
                  <div style={{ width:24, height:24, borderRadius:"50%", background:`${isUrgent?C.accent:C.violet}18`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:800, color:isUrgent?C.accent:C.violet, flexShrink:0 }}>{i+1}</div>
                  <span style={{ color:C.textSub, fontSize:13 }}>{s}</span>
                </div>
              ))}
            </div>
            <Btn full onClick={()=>onNavigate("tracking",provider)}>📍 Suivre en temps réel</Btn>
            <button onClick={()=>onNavigate("home")} style={{ background:"none", border:"none", color:C.textSub, cursor:"pointer", marginTop:12, fontSize:13 }}>Retour à l'accueil</button>
          </div>
        )}
      </div>
    </div>
  );
}

export function TrackingScreen({ provider, missionId, onNavigate }) {
  const p = provider;
  if (!p) return null;
  const [timelineStatus, setTimelineStatus] = useState("enroute");
  const [eta, setEta] = useState(8);
  const statusMap = ["enroute","enroute","in_progress","done"];
  const [step, setStep] = useState(0);
  const [gpsPosition, setGpsPosition] = useState(null);

  // Poll prestation status + prestataire GPS every 20s
  useEffect(()=>{
    if(!missionId) return;
    let mounted = true;

    const poll = async () => {
      if(!mounted) return;
      // Poll prestation status
      const { data } = await supabase.from("missions").select("status").eq("id",missionId).single();
      if(!mounted || !data) return;
      if(data.status==="completed"||data.status==="closed"){ setStep(3); setTimelineStatus("done"); setEta(0); }
      else if(data.status==="in_progress"){ setStep(2); setTimelineStatus("in_progress"); setEta(0); }
      else if(data.status==="assigned"){ setStep(1); setTimelineStatus("enroute"); }

      // Poll GPS position
      const { data:{ session: posSession } } = await supabase.auth.getSession();
      const posRes = await fetch("/api/prestations", {
        method:"POST",
        headers:{"Content-Type":"application/json", ...(posSession?.access_token ? {"Authorization":`Bearer ${posSession.access_token}`} : {})},
        body: JSON.stringify({ action:"get_position", mission_id:missionId }),
      }).then(r=>r.json()).catch(()=>null);
      if(posRes?.lat != null && posRes?.lng != null && mounted) {
        // Show "arrived" indicator if close
        setGpsPosition({ lat:posRes.lat, lng:posRes.lng, updated_at:posRes.updated_at });
      }
    };

    poll();
    const iv = setInterval(poll, 20000);
    return ()=>{ mounted=false; clearInterval(iv); };
  },[missionId]);

  const statusLabels = ["En route vers vous","Arrivé sur place","Prestation en cours","Prestation terminée"];

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg, #0A1628 0%, #0D1B3E 100%)`, paddingBottom:80 }}>
      <div style={{ background:"linear-gradient(135deg,#0A1628,#162547)", borderBottom:`1px solid ${C.border}`, padding:"48px 22px 24px" }}>
        <h2 style={{ color:C.text, fontSize:20, fontWeight:700, margin:"0 0 4px", fontFamily:font.display }}>📍 Suivi en temps réel</h2>
        <div style={{ display:"flex", gap:8, alignItems:"center", marginTop:6 }}>
          <div style={{ width:8, height:8, borderRadius:"50%", background:C.success, boxShadow:`0 0 8px ${C.success}` }} />
          <p style={{ color:C.textSub, fontSize:13, margin:0 }}>{statusLabels[step]}</p>
        </div>
      </div>

      <div style={{ padding:"22px 18px" }}>
        {/* Map */}
        <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r+4, overflow:"hidden", marginBottom:16 }}>
          <div style={{ position:"relative", overflow:"hidden" }}>
            {gpsPosition ? (
              <a href={`https://maps.apple.com/?q=${gpsPosition.lat},${gpsPosition.lng}`} target="_blank" rel="noreferrer" style={{ display:"block", textDecoration:"none" }}>
                <img
                  alt="Position prestataire"
                  width="100%"
                  height="180"
                  style={{ display:"block", objectFit:"cover" }}
                  src={`https://staticmap.openstreetmap.de/staticmap.php?center=${gpsPosition.lat},${gpsPosition.lng}&zoom=15&size=480x180&markers=${gpsPosition.lat},${gpsPosition.lng},red`}
                  onError={e => { e.target.style.display="none"; e.target.nextSibling.style.display="flex"; }}
                />
                <div style={{ display:"none", height:180, background:`linear-gradient(135deg, #0A1628, #162547)`, alignItems:"center", justifyContent:"center", flexDirection:"column", gap:6 }}>
                  <div style={{ fontSize:36 }}>📍</div>
                  <div style={{ color:C.textMuted, fontSize:12 }}>Appuyer pour ouvrir la carte</div>
                </div>
              </a>
            ) : (
              <div style={{ height:180, background:`linear-gradient(135deg, #0A1628, #162547)`, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
                <div style={{ fontSize:36, marginBottom:6 }}>📍</div>
                <div style={{ color:C.textMuted, fontSize:12 }}>Localisation en attente…</div>
              </div>
            )}
            <div style={{ position:"absolute", bottom:12, right:12, background:C.violet, borderRadius:20, padding:"5px 12px", color:C.white, fontSize:11, fontWeight:700 }}>
              {p.name} {step===0 && eta>0 ? `· ~${eta} min` : step===0 ? "· En route" : "· Sur place"}
            </div>
          </div>
          <div style={{ padding:"13px 16px", display:"flex", gap:12, alignItems:"center", borderTop:`1px solid ${C.border}` }}>
            <div style={{ width:40, height:40, borderRadius:12, background:`${p.color}22`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22 }}>{p.avatar}</div>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:700, color:C.text, fontSize:14 }}>{p.name}</div>
              <div style={{ color:C.textSub, fontSize:12 }}>{p.jobTitle||p.role}</div>
            </div>
            <button onClick={()=>onNavigate("chat",p)} style={{ background:`${C.violet}15`, border:`1px solid ${C.violet}30`, borderRadius:12, padding:"9px 14px", cursor:"pointer", color:C.violet, fontWeight:700, fontSize:13, fontFamily:"inherit" }}>💬 Chat</button>
          </div>
        </div>

        {/* Timeline */}
        <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"18px", marginBottom:16 }}>
          <div style={{ fontWeight:700, color:C.text, fontSize:14, marginBottom:4 }}>Progression de la prestation</div>
          <MissionTimeline status={timelineStatus} />
        </div>

        {/* Codes de présence — communiquer au prestataire sur place */}
        <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"18px", marginBottom:16 }}>
          <div style={{ fontWeight:700, color:C.text, fontSize:14, marginBottom:14 }}>🔐 Codes de présence</div>
          <p style={{ color:C.textSub, fontSize:12, margin:"0 0 14px", lineHeight:1.6 }}>Communiquez ces codes au prestataire uniquement lorsqu'il est physiquement sur place.</p>
          <div style={{ display:"flex", gap:10 }}>
            <div style={{ flex:1, background:`${C.success}12`, border:`1px solid ${C.success}44`, borderRadius:r, padding:"14px", textAlign:"center" }}>
              <div style={{ color:C.textSub, fontSize:10, fontWeight:700, letterSpacing:1, textTransform:"uppercase", marginBottom:6 }}>Arrivée</div>
              <div style={{ fontSize:28, fontWeight:900, color:C.success, letterSpacing:6, fontFamily:"monospace" }}>{genMissionCode(p.id,"in")}</div>
            </div>
            <div style={{ flex:1, background:`${C.accentGold}12`, border:`1px solid ${C.accentGold}44`, borderRadius:r, padding:"14px", textAlign:"center" }}>
              <div style={{ color:C.textSub, fontSize:10, fontWeight:700, letterSpacing:1, textTransform:"uppercase", marginBottom:6 }}>Départ</div>
              <div style={{ fontSize:28, fontWeight:900, color:C.accentGold, letterSpacing:6, fontFamily:"monospace" }}>{genMissionCode(p.id,"out")}</div>
            </div>
          </div>
          <div style={{ marginTop:10, background:"rgba(255,165,0,0.08)", border:"1px solid rgba(255,165,0,0.25)", borderRadius:8, padding:"8px 12px", fontSize:11, color:"#FFA500" }}>
            ⚠️ Ces codes changent chaque jour. Ne les partagez qu'en présence du prestataire.
          </div>
        </div>

        {step===3 && (
          <Btn full variant="success" onClick={()=>onNavigate("validation",provider)} style={{ fontSize:15, padding:"16px" }}>
            ✅ Valider la prestation
          </Btn>
        )}
      </div>
    </div>
  );
}

export function ValidationScreen({ provider, role, missionId, onNavigate }) {
  const p = provider;
  if (!p) return null;
  const [clientValidated,setClientValidated]=useState(false);
  const [prestaValidated,setPrestaValidated]=useState(false);
  const [clientRating,setClientRating]=useState(0);
  const [prestaRating,setPrestaRating]=useState(0);
  const [clientComment,setClientComment]=useState("");
  const [prestaComment,setPrestaComment]=useState("");
  const [hoursActual,setHoursActual]=useState(8);
  const [missionHours,setMissionHours]=useState(12); // plafond chargé depuis DB
  const [dispute,setDispute]=useState(false);

  useEffect(()=>{
    if(!missionId) return;
    supabase.from("missions").select("hours").eq("id",missionId).single().then(({data})=>{
      if(data?.hours) { setMissionHours(Number(data.hours)); setHoursActual(Number(data.hours)); }
    });
  },[missionId]);
  const [disputeMsg,setDisputeMsg]=useState("");
  const [disputeSending,setDisputeSending]=useState(false);
  const [disputeDone,setDisputeDone]=useState(false);
  const [paid,setPaid]=useState(false);

  const bothValidated = clientValidated && prestaValidated;
  const totalClientPrice = (p.rateNum * hoursActual).toFixed(0);
  const totalNetPresta   = (p.tarifNet * hoursActual).toFixed(0);

  const persistValidation = async (side, rating, comment) => {
    if (!missionId) return;
    const patch = side === "client"
      ? { validation_client: true, client_rating: rating, client_comment: comment }
      : { validation_prestataire: true, presta_rating: rating, presta_comment: comment };
    await supabase.from("missions").update(patch).eq("id", missionId);
  };

  useEffect(()=>{
    if(!bothValidated || paid) return;
    let mounted = true;
    const finalize = async () => {
      if (missionId) {
        await supabase.from("missions").update({ status:"completed" }).eq("id", missionId);
        const { data:{ user } } = await supabase.auth.getUser();
        if (user && mounted) {
          const montant = Number(totalClientPrice);
          const { data:prof } = await supabase.from("profiles").select("cashback_balance,missions_completed_month").eq("id",user.id).single();
          const currentBalance = prof?.cashback_balance || 0;
          const currentMonth   = prof?.missions_completed_month || 0;
          const cashback = calcCashback(montant, currentMonth);
          await supabase.from("profiles").update({
            cashback_balance: Math.round((currentBalance + cashback)*100)/100,
            missions_completed_month: currentMonth + 1,
          }).eq("id", user.id);
          await supabase.from("notifications").insert({
            user_id: user.id, type:"payment",
            title:"Paiement libéré", body:`Prestation validée — ${totalNetPresta} € versés à ${p.name}.`, read:false,
          });
        }
      }
      if (mounted) setPaid(true);
    };
    const t = setTimeout(finalize, 1500);
    return ()=>{ mounted=false; clearTimeout(t); };
  },[bothValidated, paid]);

  if(paid) return (
    <div style={{ minHeight:"100%", background:`linear-gradient(160deg,${C.success},#1e8449)`, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:32, textAlign:"center" }}>
      <div style={{ fontSize:80, marginBottom:20 }}>💶</div>
      <h2 style={{ color:C.white, fontSize:28, fontWeight:800, margin:"0 0 12px", fontFamily:font.display }}>Paiement libéré !</h2>
      <p style={{ color:"rgba(255,255,255,0.8)", fontSize:15, lineHeight:1.8, maxWidth:280, margin:"0 auto 12px" }}>Les <strong>{totalNetPresta} €</strong> ont été virés sur le compte de {p.name}.</p>
      <div style={{ background:"rgba(255,255,255,0.2)", borderRadius:18, padding:"18px", marginBottom:28, width:"100%", maxWidth:280 }}>
        {["✅ Prestation validée par les deux parties","💶 Virement initié vers le prestataire","🧾 Facture générée automatiquement","⭐ Avis publiés sur les deux profils"].map((s,i)=>(
          <div key={i} style={{ color:"rgba(255,255,255,0.85)", fontSize:13, padding:"6px 0", borderBottom:i<3?`1px solid rgba(255,255,255,0.2)`:"none", textAlign:"left" }}>{s}</div>
        ))}
      </div>
      <Btn full variant="secondary" onClick={()=>onNavigate("home")} style={{ color:C.success }}>Retour à l'accueil</Btn>
      <button onClick={()=>onNavigate("rating",p)} style={{ background:"rgba(255,255,255,0.15)", border:"1px solid rgba(255,255,255,0.3)", borderRadius:12, padding:"11px 24px", color:"rgba(255,255,255,0.9)", cursor:"pointer", marginTop:10, fontSize:13, fontFamily:"inherit", width:"100%", fontWeight:600 }}>⭐ Noter {p.name}</button>
    </div>
  );

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg, #0A1628 0%, #0D1B3E 100%)`, paddingBottom:80 }}>
      <StepHeader title="Validation de prestation" subtitle="Les deux parties doivent valider pour déclencher le paiement" onBack={()=>onNavigate("home")} />
      <div style={{ padding:"22px 18px" }}>
        {/* Info prestation */}
        <div style={{ background:"#0D1B3E", borderRadius:16, padding:"16px", marginBottom:16, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
          <div style={{ display:"flex", gap:12, alignItems:"center", marginBottom:12 }}>
            <div style={{ fontSize:32 }}>{p.avatar}</div>
            <div><div style={{ fontWeight:800, color:C.text }}>{p.name}</div><div style={{ color:C.textSub, fontSize:13 }}>{p.role}</div></div>
          </div>
          <div style={{ marginBottom:10 }}>
            <label style={{ fontSize:12, color:C.textSub, fontWeight:600, marginBottom:5, display:"block" }}>Heures réelles effectuées : {hoursActual}h (max : {missionHours}h prévues)</label>
            <input type="range" min={1} max={missionHours} value={hoursActual} onChange={e=>setHoursActual(+e.target.value)} style={{ width:"100%", accentColor:C.violet }} />
          </div>
          <div style={{ background:`${C.accentGold}15`, borderRadius:10, padding:"10px 12px", fontSize:12, color:C.text }}>
            💳 Montant client : <strong>{totalClientPrice} €</strong>
          </div>
        </div>

        {/* Validation CLIENT */}
        <div style={{ background:"#0D1B3E", borderRadius:16, padding:"16px", marginBottom:14, boxShadow:"0 2px 12px rgba(0,0,0,0.4)", border:`2px solid ${clientValidated?C.success:C.grayLight}`, transition:"border 0.3s" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
            <div style={{ display:"flex", gap:8, alignItems:"center" }}>
              <span style={{ fontSize:20 }}>🏢</span>
              <div>
                <div style={{ fontWeight:800, color:C.text, fontSize:14 }}>Validation Client</div>
                <div style={{ color:C.textSub, fontSize:11 }}>Confirmez que la prestation est terminée</div>
              </div>
            </div>
            {clientValidated ? <Badge color={C.success} small>✓ Validé</Badge> : <Badge color={C.gray} small>En attente</Badge>}
          </div>
          {!clientValidated ? <>
            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:12, color:C.textSub, fontWeight:600, marginBottom:8 }}>Notez le prestataire :</div>
              <div style={{ display:"flex", gap:6, justifyContent:"center" }}>
                {[1,2,3,4,5].map(i=><span key={i} onClick={()=>setClientRating(i)} style={{ fontSize:32, cursor:"pointer", color:i<=clientRating?C.accentGold:"#ddd", transition:"color 0.2s" }}>★</span>)}
              </div>
            </div>
            <textarea value={clientComment} onChange={e=>setClientComment(e.target.value)} placeholder="Commentaire sur la prestation…" style={{ width:"100%", padding:"10px 12px", borderRadius:10, border:`1px solid ${C.border}`, fontSize:13, fontFamily:"inherit", resize:"none", height:70, boxSizing:"border-box", outline:"none", marginBottom:12 }} />
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={()=>setDispute(true)} style={{ flex:1, padding:"10px", borderRadius:12, border:`2px solid ${C.accent}`, background:"transparent", color:C.accent, fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>⚠️ Signaler</button>
              <Btn variant="success" disabled={clientRating===0} onClick={()=>{ persistValidation("client",clientRating,clientComment); setClientValidated(true); }} style={{ flex:2, padding:"10px", fontSize:13 }}>✓ Valider</Btn>
            </div>
          </> : (
            <div style={{ textAlign:"center", padding:"8px 0", color:C.success, fontWeight:700 }}>✅ Prestation validée — Note : {"★".repeat(clientRating)}</div>
          )}
        </div>

        {/* Validation PRESTATAIRE */}
        <div style={{ background:"#0D1B3E", borderRadius:16, padding:"16px", marginBottom:14, boxShadow:"0 2px 12px rgba(0,0,0,0.4)", border:`2px solid ${prestaValidated?C.success:C.grayLight}`, transition:"border 0.3s" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
            <div style={{ display:"flex", gap:8, alignItems:"center" }}>
              <span style={{ fontSize:20 }}>👷</span>
              <div>
                <div style={{ fontWeight:800, color:C.text, fontSize:14 }}>Validation Prestataire</div>
                <div style={{ color:C.textSub, fontSize:11 }}>Confirmez les heures effectuées</div>
              </div>
            </div>
            {prestaValidated ? <Badge color={C.success} small>✓ Validé</Badge> : <Badge color={C.gray} small>En attente</Badge>}
          </div>
          {!prestaValidated ? <>
            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:12, color:C.textSub, fontWeight:600, marginBottom:8 }}>Notez le client :</div>
              <div style={{ display:"flex", gap:6, justifyContent:"center" }}>
                {[1,2,3,4,5].map(i=><span key={i} onClick={()=>setPrestaRating(i)} style={{ fontSize:32, cursor:"pointer", color:i<=prestaRating?C.accentGold:"#ddd", transition:"color 0.2s" }}>★</span>)}
              </div>
            </div>
            <textarea value={prestaComment} onChange={e=>setPrestaComment(e.target.value)} placeholder="Commentaire sur la prestation…" style={{ width:"100%", padding:"10px 12px", borderRadius:10, border:`1px solid ${C.border}`, fontSize:13, fontFamily:"inherit", resize:"none", height:70, boxSizing:"border-box", outline:"none", marginBottom:12 }} />
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={()=>setDispute(true)} style={{ flex:1, padding:"10px", borderRadius:12, border:`2px solid ${C.accent}`, background:"transparent", color:C.accent, fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>⚠️ Litige</button>
              <Btn variant="success" disabled={prestaRating===0} onClick={()=>{ persistValidation("presta",prestaRating,prestaComment); setPrestaValidated(true); }} style={{ flex:2, padding:"10px", fontSize:13 }}>✓ Confirmer</Btn>
            </div>
          </> : (
            <div style={{ textAlign:"center", padding:"8px 0", color:C.success, fontWeight:700 }}>✅ Confirmé — Note : {"★".repeat(prestaRating)}</div>
          )}
        </div>

        {/* Statut paiement */}
        <div style={{ background: bothValidated?`${C.success}15`:`${C.accentGold}15`, border:`2px solid ${bothValidated?C.success:C.accentGold}55`, borderRadius:16, padding:"16px", textAlign:"center" }}>
          {bothValidated ? (
            <div>
              <div style={{ fontSize:32, marginBottom:8 }}>🚀</div>
              <div style={{ fontWeight:800, color:C.success, fontSize:15 }}>Les deux parties ont validé !</div>
              <div style={{ color:C.textSub, fontSize:13, marginTop:4 }}>Virement de {totalNetPresta} € en cours vers {p.name}…</div>
            </div>
          ) : (
            <div>
              <div style={{ fontWeight:700, color:C.text, fontSize:14, marginBottom:4 }}>⏳ En attente de validation</div>
              <div style={{ color:C.textSub, fontSize:12 }}>
                {!clientValidated && !prestaValidated ? "Les deux parties doivent valider" : !clientValidated ? "En attente du client" : "En attente du prestataire"}
              </div>
              <div style={{ color:C.textSub, fontSize:11, marginTop:6 }}>Si aucune réponse sous 48h → validation automatique</div>            </div>
          )}
        </div>

        {/* Litige */}
        {dispute && (
          <div style={{ marginTop:16, background:`${C.accent}10`, border:`2px solid ${C.accent}44`, borderRadius:16, padding:"16px" }}>
            {disputeDone ? (
              <div style={{ textAlign:"center", padding:"8px 0" }}>
                <div style={{ fontSize:36, marginBottom:10 }}>✅</div>
                <div style={{ fontWeight:800, color:C.success, fontSize:15, marginBottom:6 }}>Litige transmis</div>
                <div style={{ color:C.textSub, fontSize:13, lineHeight:1.6 }}>Notre équipe de médiation vous contactera sous 24h ouvrées.</div>
              </div>
            ) : <>
              <div style={{ fontWeight:800, color:C.danger, fontSize:14, marginBottom:8 }}>⚠️ Signalement de litige</div>
              <textarea
                value={disputeMsg}
                onChange={e=>setDisputeMsg(e.target.value)}
                placeholder="Décrivez le problème rencontré…"
                style={{ width:"100%", padding:"10px 12px", borderRadius:10, border:`2px solid ${C.accent}44`, fontSize:13, fontFamily:"inherit", resize:"none", height:80, boxSizing:"border-box", outline:"none", marginBottom:12, background:"rgba(255,255,255,0.04)", color:C.text }}
              />
              <Btn full variant="danger" disabled={!disputeMsg.trim() || disputeSending}
                onClick={async () => {
                  if (!disputeMsg.trim()) return;
                  setDisputeSending(true);
                  const { data:authData } = await supabase.auth.getUser();
                  const user = authData?.user;
                  const refNum = "LIT-" + new Date().getFullYear() + "-" + Math.floor(Math.random()*9000+1000);
                  await supabase.from("support_tickets").insert({
                    subject: `Litige prestation — ${refNum}`,
                    message: `Prestation avec ${p.name}${missionId ? ` (ID: ${missionId})` : ""}.\n\n${disputeMsg.trim()}`,
                    user_id: user?.id || null,
                    user_email: user?.email || null,
                    user_name: user?.user_metadata?.prenom || null,
                    status: "open",
                  });
                  try {
                    await fetch("/api/support", {
                      method:"POST", headers:{"Content-Type":"application/json"},
                      body: JSON.stringify({ subject:`Litige ${refNum} — ${p.name}`, message: disputeMsg.trim(), userEmail: user?.email, userName: user?.user_metadata?.prenom }),
                    });
                  } catch(_) {}
                  setDisputeSending(false);
                  setDisputeDone(true);
                }}
                style={{ fontSize:13, padding:"12px" }}
              >
                {disputeSending ? "Envoi…" : "📞 Contacter la médiation ALANE"}
              </Btn>
            </>}
          </div>
        )}
      </div>
    </div>
  );
}

export function ChatScreen({ provider, onBack, chatClientId }) {
  if (!provider) return <div style={{ padding:40, textAlign:"center", color:C.textSub }}><button onClick={onBack} style={{ background:"transparent", border:"none", color:C.textSub, cursor:"pointer", fontSize:13, display:"block", marginBottom:16 }}>← Retour</button>Conversation introuvable.</div>;
  const p = provider;
  const [msg, setMsg] = useState("");
  const [msgs, setMsgs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState(null);
  const [senderTag, setSenderTag] = useState("client");
  const [sending, setSending] = useState(false);
  const endRef = useRef(null);

  const fmtTime = (iso) => new Date(iso).toLocaleTimeString("fr", { hour:"2-digit", minute:"2-digit" });

  // convKey : identique des deux côtés — basé sur providerId + clientId
  const buildKey = (uid) => {
    const providerId = chatClientId ? uid : p.id; // si chatClientId fourni → user courant est le prestataire
    const clientId   = chatClientId ? chatClientId : uid;
    return `prov${providerId}-user${clientId}`;
  };

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const uid = data?.user?.id || null;
      setUserId(uid);
      setSenderTag(chatClientId ? "prestataire" : "client");
    });
  }, [chatClientId]);

  const loadMsgs = async (uid) => {
    const key = buildKey(uid);
    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_key", key)
      .order("created_at", { ascending: true });
    if (!error) setMsgs(data || []);
    setLoading(false);
  };

  useEffect(() => {
    if (!userId) return;
    loadMsgs(userId);
    const key = buildKey(userId);
    const channel = supabase
      .channel(`chat:${key}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `conversation_key=eq.${key}` },
        ({ new: newMsg }) => {
          setMsgs(prev => {
            if (prev.some(m => m.id === newMsg.id)) return prev;
            if (newMsg.sender_id === userId) {
              const idx = prev.findIndex(m => String(m.id).startsWith("opt-") && m.content === newMsg.content);
              if (idx !== -1) { const next = [...prev]; next[idx] = newMsg; return next; }
            }
            return [...prev, newMsg];
          });
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior:"smooth" }); }, [msgs]);

  const send = async () => {
    if (!msg.trim() || sending || !userId) return;
    const content = msg.trim();
    const key = buildKey(userId);
    setMsg("");
    setSending(true);
    const optimistic = { id:`opt-${Date.now()}`, sender_tag:senderTag, sender_id:userId, conversation_key:key, content, created_at:new Date().toISOString() };
    setMsgs(m => [...m, optimistic]);
    try {
      await supabase.from("messages").insert({ conversation_key:key, sender_id:userId, sender_tag:senderTag, content });
      // Notifier le destinataire (in-app + SMS)
      const recipientId = chatClientId ? chatClientId : p.id;
      const { data: meData } = await supabase.auth.getUser();
      const meMeta = meData?.user?.user_metadata || {};
      const senderDisplayName = `${meMeta.prenom || ""} ${meMeta.nom || ""}`.trim() || (senderTag === "client" ? "Un client" : "Un prestataire");
      supabase.auth.getSession().then(({ data: sd }) => {
        const token = sd?.session?.access_token;
        fetch("/api/prestations", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(token ? { "Authorization": `Bearer ${token}` } : {}) },
          body: JSON.stringify({ action: "chat_notify", recipient_id: recipientId, sender_name: senderDisplayName, message_preview: content }),
        }).catch(() => {});
      });
    } catch (_) {}
    setSending(false);
  };

  const isClient = (m) => m.sender_tag === "client" || m.from === "client";
  // "mine" = le message vient de l'utilisateur courant
  const isMine = (m) => m.sender_id === userId || (!m.sender_id && isClient(m) && senderTag === "client");

  return (
    <div style={{ minHeight:"100%", background:C.bg, display:"flex", flexDirection:"column" }}>
      <div style={{ background:"linear-gradient(135deg, #0A1628, #162547)", padding:"48px 22px 18px", borderRadius:"0 0 22px 22px" }}>
        <button onClick={onBack} style={{ background:"rgba(255,255,255,0.15)", border:"none", borderRadius:10, padding:"7px 14px", color:C.white, cursor:"pointer", fontSize:13, marginBottom:14 }}>← Retour</button>
        <div style={{ display:"flex", gap:12, alignItems:"center" }}>
          <div style={{ width:44, height:44, borderRadius:r, background:`${p.color}44`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22 }}>{p.avatar}</div>
          <div>
            <div style={{ color:C.white, fontWeight:700, fontSize:15 }}>{p.name}</div>
            <div style={{ color:C.success, fontSize:12, fontWeight:600 }}>● En ligne</div>
          </div>
        </div>
      </div>
      <div style={{ flex:1, overflowY:"auto", padding:"16px 18px", minHeight:200, WebkitOverflowScrolling:"touch" }}>
        {loading && <div style={{ textAlign:"center", color:C.textMuted, fontSize:13, paddingTop:40 }}>Chargement…</div>}
        {!loading && msgs.length === 0 && (
          <div style={{ textAlign:"center", padding:"40px 20px" }}>
            <div style={{ fontSize:36, marginBottom:12 }}>💬</div>
            <div style={{ color:C.text, fontWeight:700, fontSize:14, marginBottom:6 }}>Démarrez la conversation</div>
            <div style={{ color:C.textMuted, fontSize:12 }}>Envoyez un message à {p.name}</div>
          </div>
        )}
        {msgs.map((m, i) => {
          const mine = isMine(m);
          return (
            <div key={m.id || i} style={{ display:"flex", justifyContent:mine?"flex-end":"flex-start", marginBottom:12 }}>
              {!mine && (
                <div style={{ width:28, height:28, borderRadius:9, background:`${p.color}33`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, marginRight:8, flexShrink:0 }}>{p.avatar||"👤"}</div>
              )}
              <div style={{ maxWidth:"75%" }}>
                <div style={{ background:mine?`linear-gradient(135deg,${C.violet},${C.indigo})`:"#1a2d4a", color:C.white, borderRadius:mine?"18px 18px 4px 18px":"18px 18px 18px 4px", padding:"10px 14px", fontSize:14 }}>
                  {m.content || m.text}
                </div>
                <div style={{ fontSize:10, color:C.textSub, marginTop:3, textAlign:mine?"right":"left" }}>
                  {fmtTime(m.created_at || new Date().toISOString())}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
      <div style={{ padding:"12px 18px 24px", background:"#0D1B3E", borderTop:`1px solid ${C.border}` }}>
        <div style={{ display:"flex", gap:10, alignItems:"center" }}>
          <input
            value={msg}
            onChange={e => setMsg(e.target.value)}
            onKeyDown={e => e.key === "Enter" && send()}
            placeholder="Votre message…"
            style={{ flex:1, padding:"12px 16px", borderRadius:24, border:`1px solid ${C.border}`, fontSize:14, fontFamily:"inherit", outline:"none", background:"#112240", color:C.text }}
          />
          <button onClick={send} disabled={sending || !msg.trim()} style={{ width:44, height:44, borderRadius:"50%", background:`linear-gradient(135deg,${C.violet},${C.indigo})`, border:"none", cursor:"pointer", fontSize:18, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, opacity:(!msg.trim()||sending)?0.5:1 }}>➤</button>
        </div>
      </div>
    </div>
  );
}

export function FavoritesScreen({ onNavigate, onBack }) {
  const { providers, loading } = useProviders();
  const [favIds, setFavIds] = useState([]);
  const [userId, setUserId] = useState(null);
  useEffect(()=>{
    supabase.auth.getUser().then(({data})=>{
      const uid=data?.user?.id;
      if(!uid) return;
      setUserId(uid);
      supabase.from("favorites").select("provider_id").eq("user_id",uid)
        .then(({data:fd})=>{ if(fd) setFavIds(fd.map(f=>f.provider_id)); });
    });
  },[]);
  const removeFav=async(pid)=>{
    if(!userId) return;
    await supabase.from("favorites").delete().eq("user_id",userId).eq("provider_id",pid);
    setFavIds(ids=>ids.filter(id=>id!==pid));
  };
  const favProviders=providers.filter(p=>favIds.includes(p.id));
  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg, #0A1628 0%, #0D1B3E 100%)`, paddingBottom:80 }}>
      <div style={{ background:"linear-gradient(135deg, #0A1628, #162547)", padding:"48px 22px 22px", borderRadius:"0 0 26px 26px" }}>
        <button onClick={onBack} style={{ background:"rgba(255,255,255,0.15)", border:"none", borderRadius:10, padding:"7px 14px", color:C.white, cursor:"pointer", fontSize:13, marginBottom:14 }}>← Retour</button>
        <h2 style={{ color:C.white, fontSize:21, fontWeight:800, margin:0 }}>❤️ Mes favoris</h2>
        {favProviders.length>0 && <p style={{ color:"rgba(255,255,255,0.6)", margin:"6px 0 0", fontSize:13 }}>{favProviders.length} prestataire{favProviders.length>1?"s":""} sauvegardé{favProviders.length>1?"s":""}</p>}
      </div>
      <div style={{ padding:"18px" }}>
        {loading ? (
          <div style={{ textAlign:"center", color:C.textMuted, padding:40, fontSize:13 }}>Chargement…</div>
        ) : favProviders.length===0 ? (
          <div style={{ background:"rgba(255,255,255,0.04)", border:`1px solid ${C.border}`, borderRadius:16, padding:"36px 20px", textAlign:"center" }}>
            <div style={{ fontSize:44, marginBottom:14 }}>❤️</div>
            <div style={{ color:C.text, fontWeight:700, fontSize:15, marginBottom:8 }}>Aucun favori pour l'instant</div>
            <div style={{ color:C.textMuted, fontSize:13, lineHeight:1.6 }}>Les prestataires que vous mettez en favoris apparaîtront ici.</div>
          </div>
        ) : favProviders.map(p=>(
          <div key={p.id} style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:16, padding:"14px 16px", marginBottom:10, display:"flex", alignItems:"center", gap:12 }}>
            <div onClick={()=>onNavigate("profile",p)} style={{ width:46, height:46, borderRadius:13, background:`${p.color}33`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:24, cursor:"pointer", flexShrink:0 }}>{p.avatar}</div>
            <div onClick={()=>onNavigate("profile",p)} style={{ flex:1, cursor:"pointer" }}>
              <div style={{ fontWeight:700, color:C.text, fontSize:14 }}>{p.name}</div>
              <div style={{ color:C.textSub, fontSize:12, marginTop:2 }}>{p.jobTitle||p.role} · {p.hourlyRate}</div>
              <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:4 }}>
                <div style={{ width:7, height:7, borderRadius:"50%", background:p.available?C.success:"#666" }} />
                <span style={{ fontSize:11, color:p.available?C.success:C.textMuted }}>{p.available?"Disponible":"Indisponible"}</span>
              </div>
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:6, alignItems:"flex-end" }}>
              <Btn onClick={()=>onNavigate("profile",p)} style={{ padding:"7px 12px", fontSize:12 }}>Voir profil</Btn>
              <button onClick={()=>removeFav(p.id)} style={{ background:"transparent", border:"none", color:"#E74C3C", fontSize:18, cursor:"pointer", padding:0, lineHeight:1 }}>❤️</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function FAQScreen({ onBack, role }) {
  const [open, setOpen] = useState(null);
  const faqs = role === "prestataire" ? [
    { q:"Comment fonctionne ALANE ?", a:"ALANE vous met en relation avec des clients qui ont besoin de prestataires dans votre secteur. Vous recevez des propositions de prestations correspondant à votre profil et vous choisissez d'accepter ou non." },
    { q:"Comment recevoir ma rémunération ?", a:"Votre rémunération est versée directement sur votre IBAN après validation de la prestation par le client. Le délai habituel est de 3 à 5 jours ouvrés." },
    { q:"Quels documents dois-je fournir ?", a:"Pour être validé sur ALANE vous devez fournir : un KBIS ou extrait D1 (auto-entrepreneur), une attestation URSSAF à jour, une RC Professionnelle, et un RIB." },
    { q:"Comment changer ou upgrader mon abonnement ?", a:"Rendez-vous dans l'onglet Abonnement de votre espace prestataire. Vous pouvez changer de plan à tout moment, le changement est immédiat." },
    { q:"Que se passe-t-il si je refuse une prestation ?", a:"Aucun problème, vous êtes libre de refuser. ALANE proposera la prestation à un autre prestataire disponible dans votre secteur. Trop de refus répétés peuvent cependant affecter votre visibilité." },
    { q:"Comment fonctionne le parrainage ?", a:"Partagez votre code de parrainage à d'autres prestataires. Dès que 3 de vos filleuls souscrivent un abonnement Premium, vous recevez 1 mois Premium offert automatiquement." },
    { q:"Comment contacter le support ?", a:"Via la rubrique Support dans les réglages. Notre équipe répond sous 24h ouvrées." },
  ] : [
    { q:"Comment fonctionne ALANE ?", a:"ALANE vous permet de trouver et réserver des prestataires qualifiés dans votre secteur, vérifiés et assurés. Vous choisissez le profil, la date et l'horaire — ALANE s'occupe du reste." },
    { q:"Comment réserver un prestataire ?", a:"Parcourez les profils disponibles, sélectionnez celui qui correspond à vos besoins, choisissez le créneau et confirmez la réservation. Vous recevez une confirmation immédiate." },
    { q:"Le prix affiché est-il le prix final ?", a:"Oui. ALANE applique un tarif transparent : le prix affiché est le prix réel, sans frais cachés ni commission supplémentaire." },
    { q:"Puis-je recourir à un auto-entrepreneur sans risque juridique ?", a:"Oui, dans le cadre d'ALANE. La loi (art. L8221-6 du Code du travail) présume qu'un auto-entrepreneur immatriculé n'est pas salarié. Le risque de requalification en contrat de travail n'existe que si un lien de subordination est caractérisé — ce qu'ALANE est précisément conçu pour éviter.\n\nEn pratique : chaque prestation est encadrée par un contrat de prestation signé électroniquement, le prestataire travaille pour plusieurs clients, et ALANE vérifie que tous les prestataires sont à jour de leurs obligations URSSAF." },
    { q:"Qu'est-ce qui me protège contre une requalification ?", a:"Trois éléments vous protègent :\n\n① Le contrat ALANE — signé électroniquement, il établit explicitement l'absence de lien de subordination et cite les critères jurisprudentiels de la Cour de Cassation.\n\n② La multi-clientèle — nos prestataires travaillent pour plusieurs entreprises via ALANE, ce qui exclut tout état de dépendance économique exclusive, critère clé dans les décisions de requalification.\n\n③ La vérification des documents — ALANE s'assure que chaque prestataire est immatriculé et à jour de ses cotisations URSSAF (attestation de vigilance).\n\nBon réflexe complémentaire : évitez de faire appel au même prestataire de manière répétée et exclusive sur le long terme." },
    { q:"Comment fonctionne le contrat de prestation ALANE ?", a:"Un contrat de prestation est automatiquement généré et signé électroniquement à chaque prestation. Il a la même valeur juridique qu'une signature manuscrite (règlement eIDAS n°910/2014 et loi du 13 mars 2000).\n\nIl précise : la nature de la prestation, les obligations de chaque partie, l'indépendance du prestataire, les modalités de paiement et de litige. Vous pouvez le consulter et le télécharger depuis votre historique de prestations." },
    { q:"Que faire si le prestataire ne se présente pas ?", a:"Contactez immédiatement le support ALANE. Nous vous trouvons un remplaçant dans les meilleurs délais et vous n'êtes pas facturé pour la prestation annulée." },
    { q:"Comment annuler une réservation ?", a:"Vous pouvez annuler une prestation depuis votre espace client. Les frais de service engagés restent dus. Aucune retenue n'est appliquée sur le montant de la prestation." },
    { q:"Comment payer ?", a:"Le paiement s'effectue par carte bancaire sécurisée via Stripe au moment de la confirmation de réservation. Votre carte n'est débitée qu'après validation de la prestation." },
    { q:"Comment contacter le support ?", a:"Via la rubrique Support dans les réglages. Notre équipe répond sous 24h ouvrées." },
  ];

  return (
    <div style={{ minHeight:"100%", background:C.bg, paddingBottom:80 }}>
      <div style={{ background:"linear-gradient(135deg,#0A1628,#162547)", padding:"52px 22px 24px", borderBottom:`1px solid ${C.border}` }}>
        <button onClick={onBack} style={{ background:"transparent", border:"none", color:C.textSub, cursor:"pointer", fontSize:13, marginBottom:14, fontFamily:"inherit" }}>← Retour</button>
        <h2 style={{ color:C.text, fontSize:22, fontWeight:800, margin:0, fontFamily:font.display }}>📖 FAQ</h2>
        <p style={{ color:C.textSub, fontSize:13, margin:"6px 0 0" }}>Questions fréquentes</p>
      </div>
      <div style={{ padding:"20px 18px" }}>
        {faqs.map((f,i) => (
          <div key={i} onClick={()=>setOpen(open===i?null:i)} style={{ background:"#0D1B3E", borderRadius:r, marginBottom:9, border:`1px solid ${open===i?C.violet+"66":C.border}`, overflow:"hidden", cursor:"pointer", transition:"border-color 0.2s" }}>
            <div style={{ padding:"14px 16px", display:"flex", justifyContent:"space-between", alignItems:"center", gap:12 }}>
              <span style={{ fontWeight:600, color:open===i?C.violet:C.text, fontSize:13, flex:1, lineHeight:1.4 }}>{f.q}</span>
              <span style={{ color:C.textMuted, fontSize:16, flexShrink:0, transform:open===i?"rotate(180deg)":"none", transition:"transform 0.2s" }}>▾</span>
            </div>
            {open===i && (
              <div style={{ padding:"0 16px 16px", color:C.textSub, fontSize:13, lineHeight:1.7, borderTop:`1px solid ${C.border}`, paddingTop:12 }}>
                {f.a}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ReferralScreen({ onBack }) {
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [code, setCode] = useState("ALANE-…");
  const [filleuls, setFilleuls] = useState(0);
  const [userId, setUserId] = useState(null);
  const [filleulsList, setFilleulsList] = useState([]);

  useEffect(()=>{
    supabase.auth.getUser().then(({data})=>{
      const uid = data?.user?.id;
      if(!uid) return;
      setUserId(uid);
      const c = "ALANE-" + uid.slice(0,6).toUpperCase();
      setCode(c);
      supabase.from("profiles").select("referral_count").eq("id",uid).single()
        .then(({data:pd})=>{ if(pd?.referral_count) setFilleuls(pd.referral_count); });
      supabase.from("profiles").select("prenom,nom,created_at,plan_abonnement").eq("referred_by",uid).order("created_at",{ascending:false})
        .then(({data:fl})=>{ if(Array.isArray(fl)) setFilleulsList(fl); });
    });
  },[]);

  const referralLink = userId ? `${window.location.origin}?ref=${userId}` : "";

  const handleCopyCode = () => {
    navigator.clipboard.writeText(code).then(()=>{
      setCopiedCode(true);
      setTimeout(()=>setCopiedCode(false), 2000);
    });
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(referralLink).then(()=>{
      setCopiedLink(true);
      setTimeout(()=>setCopiedLink(false), 2000);
    });
  };

  const handleShare = () => {
    if(navigator.share) {
      navigator.share({ title:"Rejoignez ALANE", text:`Utilisez mon lien de parrainage et inscrivez-vous sur ALANE ! Code : ${code}`, url:referralLink });
    } else {
      handleCopyLink();
    }
  };

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg, #0A1628 0%, #0D1B3E 100%)`, paddingBottom:80 }}>
      <div style={{ background:`linear-gradient(135deg,${C.accentGold},#e67e22)`, padding:"48px 22px 36px", borderRadius:"0 0 28px 28px", textAlign:"center" }}>
        <button onClick={onBack} style={{ background:"rgba(255,255,255,0.2)", border:"none", borderRadius:10, padding:"7px 14px", color:C.white, cursor:"pointer", fontSize:13, marginBottom:20, display:"block" }}>← Retour</button>
        <div style={{ fontSize:52, marginBottom:10 }}>🎁</div>
        <h2 style={{ color:C.white, fontSize:24, fontWeight:800, margin:"0 0 8px", fontFamily:font.display }}>Parrainez & gagnez</h2>
        <p style={{ color:"rgba(255,255,255,0.8)", fontSize:15, margin:0 }}>1 mois Premium offert pour 3 filleuls abonnés</p>
        <div style={{ marginTop:14, display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
          {[0,1,2].map(i=>(
            <div key={i} style={{ width:32, height:32, borderRadius:"50%", background:i<filleuls?"rgba(255,255,255,0.9)":"rgba(255,255,255,0.25)", border:"2px solid rgba(255,255,255,0.5)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:14 }}>
              {i<filleuls?"✓":""}
            </div>
          ))}
          <span style={{ color:"rgba(255,255,255,0.8)", fontSize:13, marginLeft:6 }}>{filleuls}/3 filleuls</span>
        </div>
      </div>
      <div style={{ padding:"24px 18px" }}>
        {/* Récompense */}
        <div style={{ background:`linear-gradient(135deg,${C.violet}22,${C.accentGold}15)`, border:`1px solid ${C.accentGold}55`, borderRadius:18, padding:"18px 16px", marginBottom:16, textAlign:"center" }}>
          <div style={{ fontSize:32, marginBottom:6 }}>👑</div>
          <div style={{ color:C.text, fontWeight:800, fontSize:15, marginBottom:4 }}>1 mois Premium offert</div>
          <div style={{ color:C.textSub, fontSize:12, lineHeight:1.6 }}>Dès que 3 de vos filleuls souscrivent un abonnement Premium, vous recevez 1 mois Premium gratuit.</div>
        </div>
        {/* Code */}
        <div style={{ background:"#0D1B3E", borderRadius:18, padding:"20px", marginBottom:16, textAlign:"center" }}>
          <p style={{ color:C.textSub, fontSize:13, margin:"0 0 12px" }}>Votre code de parrainage</p>
          <div style={{ background:`${C.accentGold}15`, border:`2px dashed ${C.accentGold}`, borderRadius:r, padding:"16px", marginBottom:14 }}>
            <div style={{ fontSize:24, fontWeight:800, color:C.text, letterSpacing:3 }}>{code}</div>
          </div>
          <div style={{ display:"flex", gap:10, marginBottom:0 }}>
            <Btn full variant="gold" onClick={handleCopyCode} style={{ fontSize:13 }}>
              {copiedCode ? "✓ Copié !" : "📋 Copier le code"}
            </Btn>
            <Btn full onClick={handleShare} style={{ fontSize:13 }}>
              📤 Partager
            </Btn>
          </div>
        </div>
        {/* Lien */}
        <div style={{ background:"#0D1B3E", borderRadius:18, padding:"16px 20px", marginBottom:16 }}>
          <p style={{ color:C.textSub, fontSize:13, margin:"0 0 10px" }}>Lien de parrainage</p>
          <div style={{ background:"rgba(255,255,255,0.05)", borderRadius:r, padding:"10px 12px", marginBottom:12, wordBreak:"break-all", fontSize:12, color:C.text, fontFamily:"monospace" }}>
            {referralLink || "Chargement…"}
          </div>
          <Btn full onClick={handleCopyLink} style={{ fontSize:13 }}>
            {copiedLink ? "✓ Lien copié !" : "🔗 Copier le lien"}
          </Btn>
        </div>
        <div style={{ background:`${C.accentGold}12`, border:`1px solid ${C.accentGold}33`, borderRadius:r, padding:"12px 14px", marginBottom:16, fontSize:12, color:C.textSub, lineHeight:1.6 }}>
          💡 Votre filleul utilise votre code ou votre lien à l’inscription. Le mois offert est crédité dès que le 3ème filleul passe en Premium.
        </div>
        {/* Filleuls list */}
        {filleulsList.length > 0 && (
          <div style={{ background:"#0D1B3E", borderRadius:18, padding:"16px 20px", marginBottom:16 }}>
            <p style={{ color:C.textSub, fontSize:13, margin:"0 0 12px", fontWeight:700 }}>Vos filleuls ({filleulsList.length})</p>
            {filleulsList.map((f,i)=>(
              <div key={i} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 0", borderBottom: i<filleulsList.length-1 ? `1px solid rgba(255,255,255,0.06)` : "none" }}>
                <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <div style={{ width:34, height:34, borderRadius:"50%", background:`${C.accentGold}25`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, fontWeight:800, color:C.accentGold }}>
                    {(f.prenom||"?")[0].toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontSize:13, fontWeight:700, color:C.text }}>{f.prenom} {f.nom}</div>
                    <div style={{ fontSize:11, color:C.textSub }}>{new Date(f.created_at).toLocaleDateString("fr-FR")}</div>
                  </div>
                </div>
                <div style={{ fontSize:11, padding:"3px 8px", borderRadius:8, background: f.plan_abonnement==="premium"||f.plan_abonnement==="elite" ? `${C.accentGold}25` : "rgba(255,255,255,0.07)", color: f.plan_abonnement==="premium"||f.plan_abonnement==="elite" ? C.accentGold : C.textSub, fontWeight:700 }}>
                  {f.plan_abonnement==="premium"?"Premium":f.plan_abonnement==="elite"?"Elite":"Gratuit"}
                </div>
              </div>
            ))}
          </div>
        )}
        {[
          {i:"🔗", t:"Partagez votre lien", s:"Via SMS, email ou réseaux sociaux"},
          {i:"✅", t:"3 filleuls passent Premium", s:"Ils utilisent votre code ou lien à l’inscription"},
          {i:"👑", t:"1 mois Premium offert", s:"Crédité automatiquement sur votre compte"},
        ].map((s,i)=>(
          <div key={i} style={{ background:"#0D1B3E", borderRadius:r, padding:"14px", marginBottom:9, display:"flex", gap:12, alignItems:"center" }}>
            <div style={{ width:42, height:42, borderRadius:12, background:`${C.accentGold}18`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20 }}>{s.i}</div>
            <div><div style={{ fontWeight:700, color:C.text, fontSize:13 }}>{s.t}</div><div style={{ color:C.textSub, fontSize:11 }}>{s.s}</div></div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function CalendarScreen() {
  const DAYS_HEADER = ["L","M","M","J","V","S","D"];
  const DAYS_FULL   = ["Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi","Dimanche"];
  // dow: 0=Lundi … 6=Dimanche pour correspondre à JOURS
  const JOURS_TO_DOW = { "Lundi":0, "Mardi":1, "Mercredi":2, "Jeudi":3, "Vendredi":4, "Samedi":5, "Dimanche":6 };

  const today = new Date();
  const [viewYear,  setViewYear]  = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth()); // 0-based
  const [meta, setMeta]           = useState(null);
  const [prestations, setMissions]   = useState([]);
  const [selected, setSelected]   = useState(null);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      const u = data?.user; if (!u) return;
      setMeta(u.user_metadata || {});
      // Charger les prestations depuis la DB
      const { data: m } = await supabase
        .from("prestations")
        .select("id,titre,client_nom,date_debut,date_fin,status,montant_total")
        .eq("prestataire_id", u.id)
        .in("status", ["assigned","open","completed"])
        .order("date_debut", { ascending: true });
      if (m) setMissions(m);
    });
  }, []);

  const prevMonth = () => {
    if(viewMonth === 0) { setViewMonth(11); setViewYear(y=>y-1); }
    else setViewMonth(m=>m-1);
  };
  const nextMonth = () => {
    if(viewMonth === 11) { setViewMonth(0); setViewYear(y=>y+1); }
    else setViewMonth(m=>m+1);
  };

  // Construire la grille du mois
  const firstDay = new Date(viewYear, viewMonth, 1);
  const lastDay  = new Date(viewYear, viewMonth+1, 0);
  const startDow = (firstDay.getDay() + 6) % 7; // 0=Lundi
  const daysInMonth = lastDay.getDate();

  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i+7));

  // Jours disponibles selon profil (par day-of-week)
  const availDow = new Set(
    (meta?.dispon_jours || []).map(j => JOURS_TO_DOW[j]).filter(x => x !== undefined)
  );

  // Prestations sur ce mois
  const missionsByDay = {};
  prestations.forEach(m => {
    if (!m.date_debut) return;
    const d = new Date(m.date_debut);
    if (d.getFullYear() === viewYear && d.getMonth() === viewMonth) {
      const day = d.getDate();
      if (!missionsByDay[day]) missionsByDay[day] = [];
      missionsByDay[day].push(m);
    }
  });

  const isToday = (d) => d === today.getDate() && viewMonth === today.getMonth() && viewYear === today.getFullYear();
  const dow = (d) => (new Date(viewYear, viewMonth, d).getDay() + 6) % 7;

  const MONTH_NAMES = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
  const moisLabel = `${MONTH_NAMES[viewMonth]} ${viewYear}`;

  // Prestations du mois sélectionné à afficher
  const moisMissions = prestations.filter(m => {
    if (!m.date_debut) return false;
    const d = new Date(m.date_debut);
    return d.getFullYear() === viewYear && d.getMonth() === viewMonth;
  });

  const selectedMissions = selected ? (missionsByDay[selected] || []) : [];

  const statusColor = { assigned:C.violet, open:C.accentGold, completed:C.success };
  const statusLabel = { assigned:"Confirmée", open:"En attente", completed:"Terminée" };

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg, #0A1628 0%, #0D1B3E 100%)`, paddingBottom:80 }}>
      <div style={{ background:"linear-gradient(135deg, #0A1628, #162547)", padding:"48px 22px 22px", borderRadius:"0 0 26px 26px" }}>
        <h2 style={{ color:C.white, fontSize:21, fontWeight:800, margin:"0 0 4px" }}>Planning</h2>
        <p style={{ color:"rgba(255,255,255,0.55)", fontSize:13, margin:0 }}>Vos disponibilités et prestations</p>
      </div>

      <div style={{ padding:"18px 18px 0" }}>
        {/* Légende disponibilités */}
        {meta && (
          <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:12, padding:"10px 14px", marginBottom:14, display:"flex", gap:16, flexWrap:"wrap" }}>
            <div style={{ display:"flex", alignItems:"center", gap:6 }}>
              <div style={{ width:10, height:10, borderRadius:3, background:`${C.violet}60` }} />
              <span style={{ color:C.textSub, fontSize:11 }}>Disponible</span>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:6 }}>
              <div style={{ width:10, height:10, borderRadius:3, background:C.violet }} />
              <span style={{ color:C.textSub, fontSize:11 }}>Prestation</span>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:6 }}>
              <div style={{ width:10, height:10, borderRadius:"50%", background:C.accentGold }} />
              <span style={{ color:C.textSub, fontSize:11 }}>Aujourd'hui</span>
            </div>
            {availDow.size === 0 && (
              <span style={{ color:C.accent, fontSize:11 }}>⚠️ Configurez vos disponibilités dans votre profil</span>
            )}
          </div>
        )}

        {/* Calendrier */}
        <div style={{ background:"#0D1B3E", borderRadius:18, padding:"18px", marginBottom:16, boxShadow:"0 4px 16px rgba(0,0,0,0.5)" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
            <button onClick={prevMonth} style={{ background:"#162547", border:"none", borderRadius:8, padding:"5px 14px", cursor:"pointer", color:C.text, fontSize:16 }}>‹</button>
            <span style={{ fontWeight:800, color:C.text, fontSize:15 }}>{moisLabel}</span>
            <button onClick={nextMonth} style={{ background:"#162547", border:"none", borderRadius:8, padding:"5px 14px", cursor:"pointer", color:C.text, fontSize:16 }}>›</button>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:3, textAlign:"center", marginBottom:8 }}>
            {DAYS_HEADER.map((d,i)=><div key={i} style={{ color:C.textMuted, fontSize:11, fontWeight:700, paddingBottom:4 }}>{d}</div>)}
          </div>
          {weeks.map((week,wi)=>(
            <div key={wi} style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:3, marginBottom:3 }}>
              {week.map((day,di)=>{
                if (!day) return <div key={di} />;
                const hasMission = !!missionsByDay[day];
                const isAvail = availDow.has(dow(day));
                const isTod = isToday(day);
                const isSel = selected === day;
                let bg = "transparent";
                if (hasMission) bg = C.violet;
                else if (isTod) bg = C.accentGold;
                else if (isAvail) bg = `${C.violet}28`;
                return (
                  <div key={di} onClick={()=>setSelected(isSel ? null : day)}
                    style={{ aspectRatio:"1", borderRadius:9, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:isTod||hasMission?800:500,
                      background: isSel ? `${C.violet}88` : bg,
                      color: hasMission||isTod ? C.white : isAvail ? C.violet : C.textSub,
                      cursor:"pointer", border: isSel ? `2px solid ${C.violet}` : "2px solid transparent",
                      position:"relative" }}>
                    {day}
                    {hasMission && <div style={{ position:"absolute", bottom:2, right:2, width:4, height:4, borderRadius:"50%", background:C.accentGold }} />}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Détail jour sélectionné */}
        {selected && (
          <div style={{ background:"#0D1B3E", border:`1px solid ${C.violet}44`, borderRadius:14, padding:"14px", marginBottom:14 }}>
            <div style={{ fontWeight:700, color:C.text, fontSize:13, marginBottom:10 }}>
              {DAYS_FULL[dow(selected)]} {selected} {MONTH_NAMES[viewMonth]}
            </div>
            {selectedMissions.length > 0 ? selectedMissions.map((m,i) => (
              <div key={i} style={{ display:"flex", gap:10, alignItems:"center", padding:"8px 0", borderTop:i>0?`1px solid ${C.border}`:"none" }}>
                <div style={{ width:4, height:36, borderRadius:2, background:statusColor[m.status]||C.violet, flexShrink:0 }} />
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:600, color:C.text, fontSize:12 }}>{m.titre || "Prestation"}</div>
                  <div style={{ color:C.textSub, fontSize:11 }}>{m.client_nom || "Client"}</div>
                </div>
                <Badge color={statusColor[m.status]||C.violet} small>{statusLabel[m.status]||m.status}</Badge>
              </div>
            )) : (
              <div style={{ color:C.textMuted, fontSize:12 }}>
                {availDow.has(dow(selected)) ? "✅ Disponible — aucune prestation prévue" : "❌ Non disponible selon vos préférences"}
              </div>
            )}
          </div>
        )}

        {/* Prestations du mois */}
        {moisMissions.length > 0 ? (
          <>
            <div style={{ fontWeight:700, color:C.text, fontSize:13, marginBottom:10 }}>Prestations de {MONTH_NAMES[viewMonth]}</div>
            {moisMissions.map((m,i) => {
              const d = new Date(m.date_debut);
              const label = `${DAYS_FULL[(d.getDay()+6)%7]} ${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
              return (
                <div key={i} style={{ background:"#0D1B3E", borderRadius:r, padding:"13px", marginBottom:9, boxShadow:"0 2px 12px rgba(0,0,0,0.4)", display:"flex", gap:12, alignItems:"center" }}>
                  <div style={{ width:4, height:44, borderRadius:2, background:statusColor[m.status]||C.violet, flexShrink:0 }} />
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:700, color:C.text, fontSize:13 }}>{m.titre || "Prestation"}</div>
                    <div style={{ color:C.textSub, fontSize:11 }}>{m.client_nom || "Client"}</div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontWeight:700, color:C.text, fontSize:12 }}>{label}</div>
                    <Badge color={statusColor[m.status]||C.violet} small>{statusLabel[m.status]||m.status}</Badge>
                  </div>
                </div>
              );
            })}
          </>
        ) : (
          <div style={{ background:"rgba(255,255,255,0.03)", border:`1px solid ${C.border}`, borderRadius:14, padding:"28px", textAlign:"center" }}>
            <div style={{ fontSize:32, marginBottom:10 }}>📅</div>
            <div style={{ color:C.text, fontWeight:700, fontSize:14, marginBottom:6 }}>Aucune prestation ce mois</div>
            <div style={{ color:C.textMuted, fontSize:12, lineHeight:1.6 }}>Vos prestations confirmées apparaîtront ici une fois planifiées.</div>
          </div>
        )}
      </div>
    </div>
  );
}

export function TeamBookingScreen({ onNavigate, onBack }) {
  const [sector, setSector] = useState("");
  const [date, setDate] = useState("");
  const [timeStart, setTimeStart] = useState("");
  const [hours, setHours] = useState(8);
  const [basket, setBasket] = useState([]);
  const [step, setStep] = useState("select"); // select | configure | payment
  const { providers: allRealProviders, loading: teamLoading } = useProviders();

  const filteredProviders = allRealProviders.filter(p =>
    p.available && (!sector || p.sector === sector)
  );

  const toggleBasket = (p) => setBasket(prev =>
    prev.find(x=>x.id===p.id) ? prev.filter(x=>x.id!==p.id) : [...prev, p]
  );

  const totalTeam = basket.reduce((sum, p) => sum + p.rateNum * hours, 0);

  if(step==="payment") return (
    <StripePaymentScreen
      amount={Math.round(totalTeam)}
      teamMode={true}
      teamProviders={basket}
      onSuccess={()=>onNavigate("home")}
      onBack={()=>setStep("configure")}
    />
  );

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg, #0A1628 0%, #0D1B3E 100%)`, paddingBottom:80 }}>
      <div style={{ background:"linear-gradient(135deg, #0A1628, #162547)", padding:"48px 22px 24px", borderRadius:"0 0 26px 26px" }}>
        <button onClick={onBack} style={{ background:"rgba(255,255,255,0.15)", border:"none", borderRadius:10, padding:"7px 14px", color:C.white, cursor:"pointer", fontSize:13, marginBottom:14 }}>← Retour</button>
        <h2 style={{ color:C.white, fontSize:20, fontWeight:800, margin:"0 0 4px" }}>👥 Réservation d'équipe</h2>
        <p style={{ color:"rgba(255,255,255,0.55)", fontSize:13, margin:0 }}>Réservez plusieurs prestataires en une fois</p>
      </div>

      <div style={{ padding:"20px 18px" }}>
        {step==="select" && <>
          {/* Filtres */}
          <div style={{ background:"#0D1B3E", borderRadius:16, padding:"16px", marginBottom:16, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
            <div style={{ fontWeight:800, color:C.text, fontSize:13, marginBottom:10 }}>🔍 Filtrer les prestataires</div>
            <div style={{ display:"flex", gap:8, overflowX:"auto", paddingBottom:4, scrollbarWidth:"none", WebkitOverflowScrolling:"touch" }}>
              <button onClick={()=>setSector("")} style={{ padding:"7px 14px", borderRadius:20, border:"none", cursor:"pointer", background:sector===""?C.violet:C.grayLight, color:sector===""?C.white:C.gray, fontWeight:sector===""?700:500, fontSize:12, fontFamily:"inherit", whiteSpace:"nowrap" }}>Tous</button>
              {SECTORS.map(s => (
                <button key={s.id} onClick={()=>setSector(s.id)} style={{ padding:"7px 14px", borderRadius:20, border:"none", cursor:"pointer", background:sector===s.id?C.violet:C.grayLight, color:sector===s.id?C.white:C.gray, fontWeight:sector===s.id?700:500, fontSize:12, fontFamily:"inherit", whiteSpace:"nowrap" }}>{s.icon} {s.label}</button>
              ))}
            </div>
          </div>

          {/* Liste prestataires */}
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
            <span style={{ fontWeight:800, color:C.text, fontSize:14 }}>{filteredProviders.length} disponible{filteredProviders.length>1?"s":""}</span>
            {basket.length > 0 && <Badge color={C.violet} small>{basket.length} sélectionné{basket.length>1?"s":""}</Badge>}
          </div>

          {teamLoading ? (
            <div style={{ textAlign:"center", color:C.textSub, padding:40 }}>Chargement…</div>
          ) : filteredProviders.length === 0 ? (
            <div style={{ background:"rgba(255,255,255,0.04)", border:`1px solid ${C.border}`, borderRadius:16, padding:"32px 20px", textAlign:"center" }}>
              <div style={{ fontSize:40, marginBottom:12 }}>👷</div>
              <div style={{ color:C.text, fontWeight:700, fontSize:14, marginBottom:6 }}>Aucun prestataire disponible</div>
              <div style={{ color:C.textMuted, fontSize:12, lineHeight:1.6 }}>Des prestataires rejoignent la plateforme chaque semaine. Revenez bientôt !</div>
            </div>
          ) : filteredProviders.map(p => {
            const inBasket = basket.find(x=>x.id===p.id);
            return (
              <div key={p.id} style={{ background:"#0D1B3E", borderRadius:16, padding:"14px", marginBottom:10, boxShadow:"0 2px 12px rgba(0,0,0,0.4)", border:`2px solid ${inBasket?C.violet:C.grayLight}`, transition:"border 0.2s" }}>
                <div style={{ display:"flex", gap:12, alignItems:"center" }}>
                  <div style={{ width:50, height:50, borderRadius:15, background:`${p.color}22`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:24, flexShrink:0 }}>{p.avatar}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:700, color:C.text, fontSize:14 }}>{p.name}</div>
                    <div style={{ color:C.textSub, fontSize:12 }}>{p.role} · {p.distance}</div>
                    <div style={{ marginTop:3 }}><Stars rating={p.rating} size={12}/></div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ color:C.violet, fontWeight:800, fontSize:13 }}>{p.hourlyRate} HT</div>
                    <button onClick={()=>toggleBasket(p)} style={{ marginTop:6, padding:"6px 12px", borderRadius:10, border:"none", cursor:"pointer", background:inBasket?C.violet:C.grayLight, color:inBasket?C.white:C.text, fontWeight:700, fontSize:12, fontFamily:"inherit", transition:"all 0.2s" }}>
                      {inBasket ? "✓ Ajouté" : "+ Ajouter"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          {basket.length > 0 && (
            <div style={{ position:"sticky", bottom:90, background:"#0D1B3E", borderRadius:16, padding:"14px 16px", boxShadow:"0 -4px 20px rgba(0,0,0,0.12)", border:`2px solid ${C.violet}`, marginTop:8 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                <div>
                  <div style={{ fontWeight:800, color:C.text, fontSize:14 }}>Équipe sélectionnée</div>
                  <div style={{ color:C.textSub, fontSize:12 }}>{basket.length} prestataire{basket.length>1?"s":""}</div>
                </div>
                <div style={{ textAlign:"right" }}>
                  <div style={{ fontSize:11, color:C.textSub }}>Estimation {hours}h</div>
                  <div style={{ fontWeight:800, color:C.violet, fontSize:18 }}>{totalTeam.toFixed(0)} €</div>
                </div>
              </div>
              <Btn full onClick={()=>setStep("configure")} style={{ padding:"13px", fontSize:14 }}>
                Configurer la prestation →
              </Btn>
            </div>
          )}
        </>}

        {step==="configure" && <>
          <div style={{ background:`${C.violet}08`, border:`1px solid ${C.violet}22`, borderRadius:r, padding:"14px", marginBottom:16 }}>
            <div style={{ fontWeight:800, color:C.text, fontSize:13, marginBottom:10 }}>👥 Équipe ({basket.length} prestataires)</div>
            {basket.map(p => (
              <div key={p.id} style={{ display:"flex", gap:8, alignItems:"center", padding:"6px 0", borderBottom:`1px solid ${C.border}` }}>
                <span style={{ fontSize:18 }}>{p.avatar}</span>
                <span style={{ flex:1, fontSize:13, fontWeight:600, color:C.text }}>{p.name}</span>
                <span style={{ color:C.violet, fontWeight:700, fontSize:12 }}>{p.hourlyRate} HT</span>
                <button onClick={()=>toggleBasket(p)} style={{ background:"none", border:"none", color:C.accent, cursor:"pointer", fontSize:16 }}>×</button>
              </div>
            ))}
          </div>

          <div style={{ background:"#0D1B3E", borderRadius:16, padding:"16px", marginBottom:16, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
            <div style={{ fontWeight:800, color:C.text, fontSize:13, marginBottom:12 }}>📅 Détails de la prestation</div>
            <div style={{ marginBottom:14 }}>
              <label style={{ display:"block", fontSize:12, color:C.textSub, fontWeight:600, marginBottom:5 }}>Date</label>
              <input type="date" value={date} onChange={e=>setDate(e.target.value)} placeholder="AAAA-MM-JJ" style={{ width:"100%", padding:"12px 14px", borderRadius:11, border:`1px solid ${C.border}`, fontSize:14, fontFamily:"inherit", outline:"none", boxSizing:"border-box" }} />
            </div>
            <div style={{ marginBottom:14 }}>
              <label style={{ display:"block", fontSize:12, color:C.textSub, fontWeight:600, marginBottom:5 }}>Heure de début</label>
              <input type="time" value={timeStart} onChange={e=>setTimeStart(e.target.value)} placeholder="HH:MM" style={{ width:"100%", padding:"12px 14px", borderRadius:11, border:`1px solid ${C.border}`, fontSize:14, fontFamily:"inherit", outline:"none", boxSizing:"border-box" }} />
            </div>
            <div>
              <label style={{ display:"block", fontSize:12, color:C.textSub, fontWeight:600, marginBottom:5 }}>Durée : {hours}h</label>
              <input type="range" min={1} max={12} value={hours} onChange={e=>setHours(+e.target.value)} style={{ width:"100%", accentColor:C.violet }} />
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:C.textSub, marginTop:2 }}><span>1h</span><span>12h</span></div>
            </div>
          </div>

          {/* Récap total */}
          <div style={{ background:"#0D1B3E", borderRadius:16, padding:"16px", marginBottom:16, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
            <div style={{ fontWeight:800, color:C.text, fontSize:13, marginBottom:10 }}>💶 Récapitulatif financier</div>
            {basket.map(p => (
              <div key={p.id} style={{ display:"flex", justifyContent:"space-between", padding:"6px 0", borderBottom:`1px solid ${C.border}` }}>
                <span style={{ color:C.textSub, fontSize:13 }}>{p.name} ({hours}h)</span>
                <span style={{ fontWeight:700, color:C.text, fontSize:13 }}>{(p.rateNum*hours).toFixed(0)} €</span>
              </div>
            ))}
            <div style={{ display:"flex", justifyContent:"space-between", paddingTop:10 }}>
              <span style={{ fontWeight:800, color:C.text, fontSize:15 }}>Total équipe</span>
              <span style={{ fontWeight:800, color:C.violet, fontSize:20 }}>{totalTeam.toFixed(0)} €</span>
            </div>
            <div style={{ marginTop:8, fontSize:11, color:C.textSub }}>🔒 Sécurisé via Stripe jusqu'à validation de chaque prestataire</div>
          </div>

          <Btn full onClick={()=>setStep("payment")} disabled={!date||!timeStart} style={{ fontSize:15, padding:"16px" }}>
            💳 Procéder au paiement {totalTeam.toFixed(0)} €
          </Btn>
        </>}
      </div>
    </div>
  );
}

export function HowItWorksScreen({ role, onNext, onBack }) {
  const [step, setStep] = useState(0);
  const [planSettings, setPlanSettings] = useState({ limits: null, prices: null, launchPhase: true });
  useEffect(() => {
    Promise.all([
      supabase.from("platform_settings").select("value").eq("key","plan_limits").single(),
      supabase.from("platform_settings").select("value").eq("key","subscription_prices").single(),
      supabase.from("platform_settings").select("value").eq("key","launch_phase").single(),
    ]).then(([l, p, lp]) => {
      setPlanSettings({ limits: l.data?.value || null, prices: p.data?.value || null, launchPhase: lp.data?.value != null ? Boolean(lp.data.value) : true });
    });
  }, []);
  const effectivePlanCards = ABONNEMENTS_PRESTA.map(p => {
    const price = planSettings.prices?.[p.id]?.monthly ?? p.price;
    const prestations = planSettings.limits?.[p.id] ?? p.missions;
    return { ...p, price, prestations };
  });

  const clientSteps = [
    { icon:"🔍", title:"Cherchez", desc:"Parcourez notre catalogue de prestataires par secteur. Filtrez par note, tarif, distance et disponibilité.", color:C.violet },
    { icon:"📅", title:"Réservez", desc:"Choisissez votre prestataire, sélectionnez la date, l’heure et la durée. Décrivez votre prestation en détail.", color:C.indigo },
    { icon:"💳", title:"Payez en sécurité", desc:"Votre paiement est sécurisé via Stripe. Aucun débit définitif avant que la prestation soit validée par les deux parties.", color:C.accentGold },
    { icon:"✅", title:"Validez & notez", desc:"Une fois la prestation terminée, validez-la. Le paiement est libéré et vous pouvez noter le prestataire.", color:C.success },
    { icon:"⚖️", title:"Bien travailler avec un auto-entrepreneur", lines:["✅ Le bon réflexe : variez les prestataires selon vos besoins — c’est ce qui rend la plateforme utile.","⚠️ À éviter : utiliser le même prestataire comme seule ressource de façon répétée sur le long terme."], color:"#4FC3F7" },
  ];

  const prestaSteps = [
    { icon:"📝", title:"Inscrivez-vous", desc:"Créez votre profil auto-entrepreneur en quelques minutes. Renseignez vos métiers, vos documents et vos disponibilités.", color:C.accent },
    { icon:"✅", title:"Faites valider votre compte", desc:"Notre équipe vérifie votre dossier sous 24-48h. Une fois validé, vous commencez à recevoir des propositions de prestations.", color:C.accentGold },
    { icon:"📋", title:"Acceptez des prestations", desc:"Recevez des propositions correspondant à votre profil. Acceptez celles qui vous conviennent, refusez les autres.", color:C.violet },
    { icon:"💶", title:"Encaissez", desc:"Après validation mutuelle de la prestation, votre paiement net est viré directement sur votre compte bancaire.", color:C.success },
  ];

  const steps = role === "prestataire" ? prestaSteps : clientSteps;
  const current = steps[step];

  return (
    <div style={{ minHeight:"100%", background:C.bg, display:"flex", flexDirection:"column" }}>
      <div style={{ background:"linear-gradient(135deg, #0A1628, #162547)", padding:"48px 22px 32px", borderRadius:"0 0 28px 28px" }}>
        <button onClick={onBack} style={{ background:"rgba(255,255,255,0.15)", border:"none", borderRadius:10, padding:"7px 14px", color:C.white, cursor:"pointer", fontSize:13, marginBottom:16 }}>← Retour</button>
        <h2 style={{ color:C.white, fontSize:22, fontWeight:800, margin:"0 0 4px", fontFamily:font.display }}>Comment ça marche ?</h2>
        <p style={{ color:"rgba(255,255,255,0.55)", fontSize:13, margin:0 }}>{role==="prestataire" ? "Votre parcours prestataire" : "Votre parcours client"}</p>
      </div>

      <div style={{ flex:1, padding:"28px 22px", display:"flex", flexDirection:"column" }}>
        {planSettings.launchPhase && (
          <div style={{
            background:"linear-gradient(135deg, rgba(16,217,143,0.12), rgba(16,217,143,0.06))",
            border:"1px solid rgba(16,217,143,0.35)",
            borderRadius:r, padding:"12px 14px", marginBottom:20,
            display:"flex", gap:10, alignItems:"center",
          }}>
            <span style={{ fontSize:18, flexShrink:0 }}>🎁</span>
            <div>
              <div style={{ fontWeight:700, color:"#10D98F", fontSize:12, marginBottom:2 }}>Offre de lancement</div>
              <div style={{ color:C.textSub, fontSize:11, lineHeight:1.5 }}>
                {role==="prestataire" ? "10 prestations gratuites · Réservé aux 100 premiers prestataires inscrits" : "Tarif transparent · le prix affiché est le vrai prix de la prestation"}
              </div>
            </div>
          </div>
        )}

        {role==="prestataire" && (
          <div style={{ marginBottom:20 }}>
            <div style={{ background:`linear-gradient(135deg,${C.violet}18,${C.indigo}10)`, border:`1px solid ${C.violet}40`, borderRadius:r+4, padding:"14px 16px", marginBottom:10 }}>
              <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:6 }}>
                <span style={{ fontSize:16 }}>💎</span>
                <div style={{ fontWeight:800, color:C.text, fontSize:13 }}>Abonnements ALANE</div>
              </div>
              <div style={{ color:C.textSub, fontSize:11, lineHeight:1.5, marginBottom:12 }}>
                Tarif transparent, prix affiché = prix réel. Choisissez le plan adapté à votre activité.
              </div>
              <div style={{ display:"flex", gap:8 }}>
                {effectivePlanCards.map(plan => (
                  <div key={plan.id} style={{ flex:1, background:"#0D1B3E", borderRadius:12, padding:"10px 8px", textAlign:"center", border:`1px solid ${plan.color}33` }}>
                    <div style={{ fontSize:18, marginBottom:4 }}>{plan.icon}</div>
                    <div style={{ fontWeight:700, color:plan.color, fontSize:12 }}>{plan.label}</div>
                    <div style={{ color:C.text, fontSize:13, fontWeight:800, marginTop:2 }}>
                      {plan.price===0 ? "Gratuit" : `${plan.price}€`}
                    </div>
                    {plan.price>0 && <div style={{ color:C.textSub, fontSize:10 }}>/mois</div>}
                    <div style={{ color:C.textSub, fontSize:10, marginTop:4 }}>
                      {plan.missions>=999 ? "Illimité" : `${plan.missions} prestations`}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ background:`${C.success}12`, border:`1px solid ${C.success}30`, borderRadius:r, padding:"10px 14px", display:"flex", gap:8, alignItems:"center" }}>
              <span style={{ fontSize:14 }}>✅</span>
              <div style={{ color:C.textSub, fontSize:11, lineHeight:1.5 }}>Votre plan sera sélectionné lors de l'inscription. Changez-le à tout moment depuis votre profil.</div>
            </div>
          </div>
        )}

        {role==="client" && (
          <div style={{ background:`linear-gradient(135deg,${C.violet}12,${C.indigo}08)`, border:`1px solid ${C.violet}35`, borderRadius:r+4, padding:"13px 15px", marginBottom:20, display:"flex", gap:10, alignItems:"flex-start" }}>
            <span style={{ fontSize:20, flexShrink:0 }}>💡</span>
            <div>
              <div style={{ fontWeight:800, color:C.text, fontSize:13, marginBottom:4 }}>Tarification transparente</div>
              <div style={{ color:C.textSub, fontSize:11, lineHeight:1.6 }}>
                Les prestataires ALANE sont abonnés — aucune commission cachée. Le tarif affiché est le vrai tarif de la prestation.
              </div>
            </div>
          </div>
        )}

        {/* Progress dots */}
        <div style={{ display:"flex", gap:8, justifyContent:"center", marginBottom:36 }}>
          {steps.map((_,i) => (
            <div key={i} onClick={()=>setStep(i)} style={{ width: i===step?28:8, height:8, borderRadius:4, background: i===step?current.color:C.grayLight, transition:"all 0.3s", cursor:"pointer" }} />
          ))}
        </div>

        {/* Card */}
        <div style={{ background:"#0D1B3E", borderRadius:24, padding:"36px 24px", marginBottom:24, boxShadow:"0 8px 32px rgba(0,0,0,0.1)", textAlign:"center", flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
          <div style={{ width:100, height:100, borderRadius:28, background:`${current.color}18`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:48, marginBottom:24 }}>{current.icon}</div>
          <div style={{ fontSize:13, fontWeight:700, color:current.color, textTransform:"uppercase", letterSpacing:2, marginBottom:10 }}>Étape {step+1}/{steps.length}</div>
          <h3 style={{ fontSize:24, fontWeight:800, color:C.text, margin:"0 0 16px", fontFamily:font.display }}>{current.title}</h3>
          {current.lines ? (
            <div style={{ color:C.textSub, fontSize:15, lineHeight:1.8, maxWidth:280, textAlign:"left" }}>
              {current.lines.map((l,i) => <p key={i} style={{ margin:"0 0 12px" }}>{l}</p>)}
            </div>
          ) : (
            <p style={{ color:C.textSub, fontSize:15, lineHeight:1.8, maxWidth:280, margin:0 }}>{current.desc}</p>
          )}
        </div>

        {/* Navigation */}
        <div style={{ display:"flex", gap:10 }}>
          {step > 0 && <Btn variant="secondary" onClick={()=>setStep(s=>s-1)} style={{ flex:1, padding:"14px", fontSize:14 }}>← Précédent</Btn>}
          {step < steps.length-1
            ? <Btn onClick={()=>setStep(s=>s+1)} style={{ flex:2, padding:"14px", fontSize:14 }}>Suivant →</Btn>
            : <Btn variant="success" onClick={onNext} style={{ flex:2, padding:"14px", fontSize:15 }}>C'est parti ! →</Btn>
          }
        </div>
      </div>
    </div>
  );
}

export function ClientOnboarding({ onComplete, onBack }) {
  const [step, setStep] = useState(1);
  const TOTAL = 3;
  const [infos, setInfos] = useState({ prenom:"", nom:"", email:"", tel:"", password:"" });
  const [societe, setSociete] = useState({ type:"entreprise", nom:"", siret:"", tva:"", adresse:"", ville:"", cp:"" });
  const [facturation, setFacturation] = useState({ mode:"carte", iban:"", titulaire:"", cgu:false });

  const stepValid = () => {
    if(step===1) return infos.prenom && infos.nom && infos.email && infos.tel && infos.password;
    if(step===2) return societe.nom && societe.adresse && societe.ville && societe.cp;
    if(step===3) return facturation.cgu;
    return true;
  };

  return (
    <div style={{ minHeight:"100%", background:C.bg, paddingBottom:100 }}>
      <StepHeader step={step} total={TOTAL}
        title={["Vos informations","Votre société","Facturation & CGU"][step-1]}
        subtitle={["Créez votre compte client","Informations de facturation","Mode de paiement et acceptation"][step-1]}
        onBack={step===1?onBack:()=>setStep(s=>s-1)} />

      <div style={{ padding:"22px 18px" }}>
        {step===1 && <>
          <div style={{ display:"flex", gap:10 }}>
            <div style={{ flex:1 }}><Input label="Prénom *" placeholder="Jean" value={infos.prenom} onChange={e=>setInfos({...infos,prenom:e.target.value})} /></div>
            <div style={{ flex:1 }}><Input label="Nom *" placeholder="Dupont" value={infos.nom} onChange={e=>setInfos({...infos,nom:e.target.value})} /></div>
          </div>
          <Input label="Email professionnel *" type="email" placeholder="jean@societe.fr" icon="✉️" value={infos.email} onChange={e=>setInfos({...infos,email:e.target.value})} />
          <Input label="Téléphone *" placeholder="06 12 34 56 78" icon="📱" value={infos.tel} onChange={e=>setInfos({...infos,tel:formatPhone(e.target.value)})} />
          <Input label="Mot de passe *" type="password" placeholder="Minimum 8 caractères" icon="🔒" value={infos.password} onChange={e=>setInfos({...infos,password:e.target.value})} />
        </>}

        {step===2 && <>
          <div style={{ display:"flex", background:"#162547", borderRadius:12, padding:4, marginBottom:16 }}>
            {["entreprise","particulier"].map(t=>(
              <button key={t} onClick={()=>setSociete({...societe,type:t})} style={{ flex:1, padding:"10px", border:"none", borderRadius:10, cursor:"pointer", background:societe.type===t?C.white:"transparent", color:societe.type===t?C.navy:C.gray, fontWeight:societe.type===t?700:500, fontSize:13, fontFamily:"inherit", transition:"all 0.2s" }}>{t==="entreprise"?"🏢 Entreprise":"👤 Particulier"}</button>
            ))}
          </div>
          <Input label="Nom de la société *" placeholder="Mon Entreprise SAS" icon="🏢" value={societe.nom} onChange={e=>setSociete({...societe,nom:e.target.value})} />
          {societe.type==="entreprise" && <>
            <Input label="N° SIRET" placeholder="XXX XXX XXX XXXXX" value={societe.siret} onChange={e=>setSociete({...societe,siret:e.target.value})} hint="Pour la facturation et les justificatifs" />
            <Input label="N° TVA intracommunautaire" placeholder="FR XX XXXXXXXXX" value={societe.tva} onChange={e=>setSociete({...societe,tva:e.target.value})} />
          </>}
          <Input label="Adresse de facturation *" placeholder="12 rue de la Paix" icon="📍" value={societe.adresse} onChange={e=>setSociete({...societe,adresse:e.target.value})} />
          <div style={{ display:"flex", gap:10 }}>
            <div style={{ flex:2 }}><Input label="Ville *" placeholder="Paris" value={societe.ville} onChange={e=>setSociete({...societe,ville:e.target.value})} /></div>
            <div style={{ flex:1 }}><Input label="CP *" placeholder="75001" value={societe.cp} onChange={e=>setSociete({...societe,cp:e.target.value})} /></div>
          </div>
        </>}

        {step===3 && <>
          <div style={{ background:"#0D1B3E", borderRadius:r, padding:"16px", marginBottom:14, border:`1px solid ${C.border}` }}>
            <div style={{ fontWeight:700, color:C.text, fontSize:14, marginBottom:12, letterSpacing:0.2 }}>💳 Mode de paiement préféré</div>
            {[
              {id:"carte",      icon:"💳", label:"Carte bancaire",          sub:"Visa, Mastercard, Amex"          },
              {id:"virement",   icon:"🏦", label:"Virement SEPA",            sub:"Délai 1-2 jours"                 },
              {id:"prelevement",icon:"🔄", label:"Prélèvement automatique",  sub:"Pour les prestations récurrentes"   },
            ].map(m=>(
              <div key={m.id} onClick={()=>setFacturation({...facturation,mode:m.id})} style={{
                border:`1px solid ${facturation.mode===m.id ? C.violet+"88" : C.border}`,
                borderRadius:r, padding:"13px 14px", marginBottom:8,
                cursor:"pointer", display:"flex", gap:12, alignItems:"center",
                background: facturation.mode===m.id ? `${C.violet}18` : "#162547",
                transition:"all 0.2s",
              }}>
                <div style={{ width:40, height:40, borderRadius:10, background:`${C.violet}15`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>{m.icon}</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:700, color:C.text, fontSize:14 }}>{m.label}</div>
                  <div style={{ color:C.textSub, fontSize:12, marginTop:2 }}>{m.sub}</div>
                </div>
                <div style={{
                  width:20, height:20, borderRadius:"50%",
                  border:`2px solid ${facturation.mode===m.id ? C.violet : C.borderStrong}`,
                  background: facturation.mode===m.id ? C.violet : "transparent",
                  display:"flex", alignItems:"center", justifyContent:"center",
                  flexShrink:0,
                }}>
                  {facturation.mode===m.id && <div style={{ width:8, height:8, borderRadius:"50%", background:C.white }} />}
                </div>
              </div>
            ))}
          </div>
          {facturation.mode==="virement" && <IbanInput label="IBAN" placeholder="FR76 XXXX XXXX XXXX XXXX XXXX XXX" value={facturation.iban} onChange={e=>setFacturation({...facturation,iban:e.target.value.toUpperCase()})} />}

          {/* CGU */}
          <div style={{ background:"#0D1B3E", borderRadius:r, padding:"16px", marginBottom:14, border:`1px solid ${C.border}` }}>
            <div style={{ fontWeight:700, color:C.text, fontSize:14, marginBottom:12 }}>📜 Documents légaux</div>
            {[{label:"Conditions Générales d’Utilisation",icon:"📋"},{label:"Politique de confidentialité",icon:"🔒"},{label:"Politique de cookies",icon:"🍪"}].map((d,i)=>(
              <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 0", borderBottom:i<2?`1px solid ${C.border}`:"none" }}>
                <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                  <span>{d.icon}</span>
                  <span style={{ fontSize:13, color:C.text, fontWeight:600 }}>{d.label}</span>
                </div>
                <span style={{ color:C.violet, fontSize:12, fontWeight:700, cursor:"pointer" }}>Lire →</span>
              </div>
            ))}
          </div>
          <label style={{ display:"flex", gap:10, alignItems:"flex-start", cursor:"pointer", marginBottom:18 }}>
            <input type="checkbox" checked={facturation.cgu} onChange={e=>setFacturation({...facturation,cgu:e.target.checked})} style={{ marginTop:3, accentColor:C.violet }} />
            <span style={{ fontSize:13, color:C.textSub, lineHeight:1.6 }}>J'accepte les <strong style={{ color:C.violet }}>CGU</strong>, la <strong style={{ color:C.violet }}>Politique de confidentialité</strong> et je certifie que les informations fournies sont exactes.</span>
          </label>
        </>}

        <Btn full onClick={step===TOTAL?onComplete:()=>setStep(s=>s+1)} disabled={!stepValid()} style={{ fontSize:16, padding:"17px" }}>
          {step===TOTAL ? "Créer mon compte →" : "Continuer →"}
        </Btn>
      </div>
    </div>
  );
}

export function ContractScreen({ provider, amount, hours, date, missionId, onSign, onBack }) {
  const p = provider;
  if (!p) return null;
  const [clientSigned, setClientSigned] = useState(false);
  const [prestaSigned, setPrestaSigned] = useState(false);
  const [prestaSignedAt, setPrestaSignedAt] = useState(null);
  const [finalised, setFinalised] = useState(false);
  const [activeTab, setActiveTab] = useState("contrat");
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const bothSigned = clientSigned && prestaSigned;
  const [contractNum] = useState(`CTR-ALANE-${new Date().getFullYear()}-${Math.floor(Math.random()*90000+10000)}`);
  useEffect(()=>{
    supabase.auth.getUser().then(({ data })=>{
      const u = data?.user;
      if (!u) return;
      const meta = u.user_metadata || {};
      setClientName([meta.prenom, meta.nom].filter(Boolean).join(" ") || u.email);
      setClientEmail(u.email || "");
    });
  },[]);
  useEffect(()=>{
    if (!missionId) return;
    supabase.from("missions").select("status,contrat_presta_signe_at").eq("id", missionId).single()
      .then(({ data }) => {
        if (!data) return;
        if (data.contrat_presta_signe_at || data.status === "assigned") {
          setPrestaSigned(true);
          setPrestaSignedAt(data.contrat_presta_signe_at || null);
        }
      });
  },[missionId]);
  const today = new Date().toLocaleDateString("fr-FR");
  const missionDate = date || today;
  const missionHours = hours || 8;
  const totalAmount = (typeof amount === 'object' ? amount?.amount : amount) || 124;
  const prestaNet = (p.tarifNet * missionHours).toFixed(2);

  useEffect(()=>{
    if(!bothSigned) return;
    let mounted = true;
    (async ()=>{
      if (!mounted) return;
      try {
        const { data:{ user } } = await supabase.auth.getUser();
        if (user) {
          await supabase.from("contracts").insert({
            mission_id: missionId || null,
            contract_number: contractNum,
            client_id: user.id,
            prestataire_name: p.name,
            prestataire_role: p.role || p.jobTitle,
            nb_heures: missionHours,
            montant: totalAmount,
            client_signed: true,
            prestataire_signed: true,
            client_signed_at: new Date().toISOString(),
            prestataire_signed_at: new Date().toISOString(),
          });
        }
      } catch(_) {}
      if (mounted) { setFinalised(true); onSign && onSign(); }
    })();
    return ()=>{ mounted=false; };
  },[bothSigned]);

  if(finalised) return (
    <div style={{ minHeight:"100%", background:`linear-gradient(160deg,${C.success},#1a7a40)`, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:32, textAlign:"center" }}>
      <div style={{ width:80, height:80, borderRadius:"50%", background:"rgba(255,255,255,0.2)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:36, marginBottom:20 }}>✍️</div>
      <h2 style={{ color:C.white, fontSize:24, fontWeight:800, margin:"0 0 10px", fontFamily:font.display }}>Contrat signé !</h2>
      <p style={{ color:"rgba(255,255,255,0.8)", fontSize:14, lineHeight:1.8, maxWidth:280, margin:"0 auto 24px" }}>
        Le contrat <strong>{contractNum}</strong> est signé électroniquement et archivé. La prestation peut démarrer.
      </p>
      <div style={{ background:"rgba(255,255,255,0.15)", borderRadius:16, padding:"16px 20px", marginBottom:28, width:"100%", maxWidth:300, textAlign:"left" }}>
        {[
          "📧 Copies envoyées aux deux parties",
          "📁 Archivé dans vos espaces respectifs",
          "⏱️ Horodaté et certifié",
          "🔒 Fonds sécurisés via Stripe",
          "✅ Prestation autorisée à démarrer",
        ].map((s,i)=>(
          <div key={i} style={{ color:"rgba(255,255,255,0.85)", fontSize:12, padding:"5px 0", borderBottom:i<4?"1px solid rgba(255,255,255,0.15)":"none" }}>{s}</div>
        ))}
      </div>
      <Btn full variant="secondary" onClick={onBack} style={{ color:C.success }}>Continuer →</Btn>
    </div>
  );

  const articles = [
    {
      title:"Article 1 — Objet du contrat",
      content:`Le présent contrat a pour objet de définir les conditions dans lesquelles ${p.name}, auto-entrepreneur (ci-après "le Prestataire"), fournit ses services à la société cliente (ci-après "le Client"), dans le cadre d'une prestation de services réalisée via la plateforme ALANE.\n\nNature de la prestation : ${p.role}\nDate de la prestation : ${missionDate}\nDurée estimée : ${missionHours} heures\nLieu : Paris, France (selon adresse renseignée lors de la réservation)`
    },
    {
      title:"Article 2 — Indépendance du prestataire",
      content:`Le Prestataire intervient en tant que travailleur indépendant au sens de l'article L8221-6 du Code du travail, lequel établit une présomption de non-salariat pour les personnes immatriculées en tant qu'auto-entrepreneur.\n\nConformément aux critères jurisprudentiels de la Chambre Sociale de la Cour de Cassation (notamment Cass. Soc. 13 novembre 1996 et Cass. Soc. 25 février 2003), la qualification de contrat de travail requiert la réunion cumulative de trois conditions : l'exécution d'un travail, le versement d'une rémunération, et l'existence d'un lien de subordination juridique caractérisé. Ce dernier élément, seul discriminant, est expressément exclu du présent accord.\n\n• Le Prestataire n'est soumis à aucune directive du Client sur les moyens d'exécution, uniquement sur les résultats attendus.\n• Le Prestataire organise librement son intervention dans le cadre horaire de la prestation.\n• Le Prestataire exerce son activité auprès de plusieurs clients via la plateforme ALANE, ce qui exclut tout état de dépendance économique exclusive.\n• Le Prestataire est immatriculé et à jour de ses cotisations URSSAF (attestation de vigilance fournie à ALANE).\n• ALANE intervient en qualité de plateforme d'intermédiation et ne saurait être qualifiée d'employeur au sens du Code du travail.\n\nAucune requalification en contrat de travail ne saurait résulter du présent accord. Les parties reconnaissent expressément que leur relation est exclusivement de nature commerciale.`
    },
    {
      title:"Article 3 — Rémunération et paiement",
      content:`Taux horaire net prestataire : ${p.tarifNet ? p.tarifNet.toFixed(2) : "14,00"} €/h\nDurée : ${missionHours}h\nMontant net dû au Prestataire : ${prestaNet} €\nMontant total facturé au Client : ${totalAmount} € (incluant les frais de service)\n\nLe paiement est sécurisé via Stripe : les fonds sont bloqués dès la réservation et libérés automatiquement au Prestataire dans un délai de 24h après validation mutuelle de la prestation par les deux parties.\n\nEn cas de litige non résolu, ALANE intervient en médiateur et arbitre le déblocage des fonds sous 72h ouvrées.`
    },
    {
      title:"Article 4 — Obligations du prestataire",
      content:`Le Prestataire s'engage à :\n• Exécuter la prestation avec sérieux, professionnalisme et compétence\n• Respecter scrupuleusement les horaires et le lieu convenus\n• Informer le Client et ALANE de tout empêchement dans un délai minimum de 4h avant la prestation\n• Maintenir la confidentialité sur toute information relative à l'activité du Client\n• Respecter les consignes de sécurité applicables sur le lieu de prestation\n• Posséder et maintenir à jour tous les diplômes, certifications et habilitations nécessaires à l'exercice de sa prestation\n• Être à jour de ses cotisations URSSAF et déclarations fiscales`
    },
    {
      title:"Article 5 — Obligations du client",
      content:`Le Client s'engage à :\n• Fournir au Prestataire toutes les informations nécessaires à la bonne exécution de la prestation\n• Préparer les conditions matérielles requises pour l'exécution de la prestation\n• Valider ou contester la prestation dans un délai de 48h suivant son achèvement\n• Traiter le Prestataire avec respect et dans le respect de la dignité humaine\n• Ne pas demander au Prestataire d'effectuer des tâches sortant du cadre défini dans le présent contrat\n• Ne pas tenter de court-circuiter la plateforme ALANE pour des prestations futures avec le même prestataire`
    },
    {
      title:"Article 6 — Politique d’annulation",
      content:`Annulation par le Client :\n• Plus de 48h avant la prestation : remboursement intégral\n• Entre 24h et 48h avant : 50% du montant retenu\n• Moins de 24h avant : 100% du montant retenu\n\nAnnulation par le Prestataire :\n• Plus de 48h avant : aucune pénalité, ALANE propose un remplaçant\n• Entre 4h et 48h avant : pénalité de 15% sur la prochaine prestation\n• Moins de 4h avant : suspension temporaire du compte prestataire\n\nEn cas d'annulation par le Prestataire, ALANE s'engage à proposer un prestataire remplaçant dans les meilleurs délais. En l'absence de remplaçant, le Client est remboursé intégralement.`
    },
    {
      title:"Article 7 — Responsabilité et assurance",
      content:`Le Prestataire est seul responsable des dommages causés dans le cadre de l'exécution de sa prestation et doit disposer d'une assurance Responsabilité Civile Professionnelle (RC Pro) en cours de validité.\n\nALANE agit en qualité de simple intermédiaire et ne saurait être tenu responsable des dommages résultant d'une inexécution ou mauvaise exécution de la prestation.\n\nLe Client est responsable des conditions matérielles d'accueil et de sécurité du lieu de prestation. En cas d'accident du travail survenant chez le Client, la responsabilité incombe au Client en sa qualité de donneur d'ordre.`
    },
    {
      title:"Article 8 — Confidentialité",
      content:`Le Prestataire s'engage à maintenir strictement confidentielle toute information relative à l'activité, aux clients, aux procédés, aux données ou à la stratégie du Client dont il aurait connaissance dans le cadre de la prestation.\n\nCette obligation de confidentialité s'applique pendant toute la durée de la prestation et pendant une période de 2 ans suivant sa fin, sans limitation géographique.\n\nEn cas de violation de cette clause, le Client pourra réclamer des dommages et intérêts proportionnels au préjudice subi.`
    },
    {
      title:"Article 9 — Propriété intellectuelle",
      content:`Toute création, production ou livrable réalisé par le Prestataire dans le cadre de la prestation appartient intégralement au Client, sauf accord contraire stipulé par écrit.\n\nLe Prestataire cède au Client l'intégralité des droits patrimoniaux sur les œuvres créées dans le cadre de la prestation, pour toute exploitation, sur tous supports, pour le monde entier et pour toute la durée légale de protection.`
    },
    {
      title:"Article 10 — Règlement des litiges",
      content:`En cas de différend relatif à l'exécution ou à l'interprétation du présent contrat, les parties s'engagent à recourir en premier lieu à une tentative de règlement amiable directement entre elles.\n\nÀ défaut d'accord amiable dans un délai de 15 jours, les parties pourront faire appel à un médiateur indépendant ou au médiateur de la consommation compétent.\n\nLe présent contrat est soumis au droit français. En cas de litige judiciaire, les tribunaux compétents seront seuls compétents.`
    },
    {
      title:"Article 11 — Protection des données",
      content:`Les données personnelles collectées dans le cadre du présent contrat sont traitées par ALANE SAS conformément au Règlement Général sur la Protection des Données (RGPD) et à la loi Informatique et Libertés.\n\nCes données sont utilisées exclusivement pour la gestion de la relation contractuelle et ne sont pas transmises à des tiers sans consentement explicite.\n\nChaque partie dispose d'un droit d'accès, de rectification, d'effacement et de portabilité de ses données en contactant : rgpd@alane.fr`
    },
  ];

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg, #0A1628 0%, #0D1B3E 100%)`, paddingBottom:40 }}>
      {/* Header */}
      <div className="no-print" style={{ background:"linear-gradient(135deg, #0A1628, #162547)", padding:"48px 22px 24px", borderRadius:"0 0 26px 26px" }}>
        <button onClick={onBack} style={{ background:"rgba(255,255,255,0.15)", border:"none", borderRadius:10, padding:"7px 14px", color:C.white, cursor:"pointer", fontSize:13, marginBottom:14 }}>← Retour</button>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
          <div>
            <h2 style={{ color:C.white, fontSize:20, fontWeight:800, margin:"0 0 4px" }}>✍️ Contrat de prestation</h2>
            <p style={{ color:"rgba(255,255,255,0.5)", fontSize:11, margin:0 }}>{contractNum} · Généré le {today}</p>
          </div>
          <div style={{ textAlign:"right" }}>
            {bothSigned
              ? <div style={{ background:`${C.success}33`, borderRadius:8, padding:"4px 10px", color:C.success, fontSize:11, fontWeight:700 }}>✓ Signé</div>
              : <div style={{ background:"rgba(255,255,255,0.1)", borderRadius:8, padding:"4px 10px", color:"rgba(255,255,255,0.5)", fontSize:11 }}>En attente</div>
            }
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="no-print" style={{ display:"flex", gap:0, padding:"16px 18px 0", borderBottom:`1px solid ${C.border}` }}>
        {[{id:"contrat",label:"📋 Contrat"},{id:"parties",label:"👥 Parties"},{id:"signature",label:"✍️ Signature"}].map(t=>(
          <button key={t.id} onClick={()=>setActiveTab(t.id)} style={{ padding:"8px 14px", border:"none", borderBottom:`2px solid ${activeTab===t.id?C.violet:"transparent"}`, background:"transparent", color:activeTab===t.id?C.violet:C.gray, fontWeight:activeTab===t.id?700:500, fontSize:12, cursor:"pointer", fontFamily:"inherit", transition:"all 0.2s" }}>{t.label}</button>
        ))}
      </div>

      <div style={{ padding:"18px 18px" }}>

        {/* Tab: Contrat */}
        {activeTab==="contrat" && (
          <div>
            {/* En-tête officiel */}
            <div style={{ background:"#0D1B3E", borderRadius:16, padding:"20px", marginBottom:14, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
              <div style={{ textAlign:"center", paddingBottom:16, borderBottom:`1px solid ${C.border}`, marginBottom:16 }}>
                <div style={{ fontSize:24, fontWeight:800, color:C.violet, fontFamily:font.display, marginBottom:4 }}>ALANE</div>
                <div style={{ fontSize:13, fontWeight:700, color:C.text }}>CONTRAT DE PRESTATION DE SERVICES</div>
                <div style={{ fontSize:11, color:C.textSub, marginTop:4 }}>Régi par les articles 1710 et suivants du Code Civil français</div>
                <div style={{ fontSize:11, color:C.textSub }}>N° {contractNum} · Établi le {today}</div>
              </div>

              {/* Résumé prestation */}
              <div style={{ background:C.bg, borderRadius:12, padding:"14px", marginBottom:16 }}>
                <div style={{ fontSize:11, color:C.textSub, fontWeight:700, textTransform:"uppercase", letterSpacing:0.5, marginBottom:10 }}>Résumé de la prestation</div>
                {[
                  ["Type de prestation", p.role],
                  ["Date", missionDate],
                  ["Durée", `${missionHours} heures`],
                  ["Montant client total", `${totalAmount} €`],
                  ["Montant net prestataire", `${prestaNet} €`],
                ].map(([l,v])=>(
                  <div key={l} style={{ display:"flex", justifyContent:"space-between", padding:"5px 0", borderBottom:`1px solid ${C.border}` }}>
                    <span style={{ fontSize:12, color:C.textSub }}>{l}</span>
                    <span style={{ fontSize:12, fontWeight:700, color:C.text }}>{v}</span>
                  </div>
                ))}
              </div>

              {/* Articles */}
              {articles.map((a,i)=>(
                <div key={i} style={{ marginBottom:16, paddingBottom:16, borderBottom:i<articles.length-1?`1px solid ${C.grayLight}`:"none" }}>
                  <div style={{ fontSize:13, fontWeight:800, color:C.text, marginBottom:6 }}>{a.title}</div>
                  <div style={{ fontSize:12, color:C.textSub, lineHeight:1.75, whiteSpace:"pre-line" }}>{a.content}</div>
                </div>
              ))}
            </div>
            <div className="no-print" style={{ marginTop:4 }}>
              <Btn full onClick={()=>window.print()} style={{ padding:"14px", fontSize:14, fontWeight:700 }}>
                🖨️ Télécharger / Imprimer PDF
              </Btn>
            </div>
          </div>
        )}

        {/* Tab: Parties */}
        {activeTab==="parties" && (
          <div>
            {/* Client */}
            <div style={{ background:"#0D1B3E", borderRadius:16, padding:"18px", marginBottom:14, boxShadow:"0 2px 12px rgba(0,0,0,0.4)", border:`2px solid ${C.violet}22` }}>
              <div style={{ fontSize:11, color:C.violet, fontWeight:700, textTransform:"uppercase", letterSpacing:0.5, marginBottom:12 }}>Le Client</div>
              <div style={{ display:"flex", gap:12, alignItems:"center", marginBottom:14 }}>
                <div style={{ width:46, height:46, borderRadius:13, background:`${C.violet}15`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22 }}>🏢</div>
                <div>
                  <div style={{ fontWeight:800, color:C.text, fontSize:15 }}>{clientName || "—"}</div>
                  <div style={{ color:C.textSub, fontSize:12 }}>Client · {clientEmail || "—"}</div>
                </div>
              </div>
              {[["Email", clientEmail || "—"]].map(([l,v])=>(
                <div key={l} style={{ display:"flex", justifyContent:"space-between", padding:"7px 0", borderBottom:`1px solid ${C.border}` }}>
                  <span style={{ fontSize:12, color:C.textSub }}>{l}</span>
                  <span style={{ fontSize:12, fontWeight:600, color:C.text }}>{v}</span>
                </div>
              ))}
            </div>

            {/* Prestataire */}
            <div style={{ background:"#0D1B3E", borderRadius:16, padding:"18px", marginBottom:14, boxShadow:"0 2px 12px rgba(0,0,0,0.4)", border:`2px solid ${C.accent}22` }}>
              <div style={{ fontSize:11, color:C.accent, fontWeight:700, textTransform:"uppercase", letterSpacing:0.5, marginBottom:12 }}>Le Prestataire</div>
              <div style={{ display:"flex", gap:12, alignItems:"center", marginBottom:14 }}>
                <div style={{ width:46, height:46, borderRadius:13, background:`${p.color}15`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22 }}>{p.avatar}</div>
                <div>
                  <div style={{ fontWeight:800, color:C.text, fontSize:15 }}>{p.name}</div>
                  <div style={{ color:C.textSub, fontSize:12 }}>Auto-entrepreneur · {p.role}</div>
                </div>
              </div>
              {[["SIRET","XXX XXX XXX XXXXX"],["Activité déclarée","Prestation de services"],["URSSAF","À jour de cotisations ✓"],["RC Pro","Attestation validée ✓"],["Taux horaire net",`${p.tarifNet?p.tarifNet.toFixed(2):"14,00"} €/h`]].map(([l,v])=>(
                <div key={l} style={{ display:"flex", justifyContent:"space-between", padding:"7px 0", borderBottom:`1px solid ${C.border}` }}>
                  <span style={{ fontSize:12, color:C.textSub }}>{l}</span>
                  <span style={{ fontSize:12, fontWeight:600, color:C.text }}>{v}</span>
                </div>
              ))}
            </div>

            {/* ALANE */}
            <div style={{ background:"#0D1B3E", borderRadius:16, padding:"18px", boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
              <div style={{ fontSize:11, color:C.textSub, fontWeight:700, textTransform:"uppercase", letterSpacing:0.5, marginBottom:12 }}>Plateforme intermédiaire</div>
              <div style={{ display:"flex", gap:12, alignItems:"center", marginBottom:14 }}>
                <div style={{ width:46, height:46, borderRadius:13, background:`${C.violet}15`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22 }}>💎</div>
                <div>
                  <div style={{ fontWeight:800, color:C.text, fontSize:15 }}>ALANE SAS</div>
                  <div style={{ color:C.textSub, fontSize:12 }}>Plateforme de mise en relation</div>
                </div>
              </div>
              <div style={{ background:`${C.accentGold}15`, borderRadius:10, padding:"10px 12px", fontSize:12, color:C.text, lineHeight:1.6 }}>
                💡 ALANE agit en qualité d'intermédiaire. Les fonds de <strong>{totalAmount} €</strong> sont sécurisés via Stripe jusqu'à validation mutuelle de la prestation.
              </div>
            </div>
          </div>
        )}

        {/* Tab: Signature */}
        {activeTab==="signature" && (
          <div>
            {/* Avertissement légal */}
            <div style={{ background:`${C.violet}10`, border:`1px solid ${C.violet}25`, borderRadius:r, padding:"14px 16px", marginBottom:18, fontSize:12, color:C.text, lineHeight:1.6 }}>
              ⚖️ <strong>Valeur juridique</strong><br/>
              <span style={{ color:C.textSub }}>En signant électroniquement, vous reconnaissez avoir lu et accepté l'intégralité du contrat. Cette signature a la même valeur juridique qu'une signature manuscrite conformément au règlement <strong>eIDAS n°910/2014</strong> et à la <strong>loi n°2000-230</strong> du 13 mars 2000.</span>
            </div>

            {/* Bloc signature CLIENT */}
            <div style={{ background:"#0D1B3E", borderRadius:16, padding:"18px", marginBottom:14, border:`2px solid ${clientSigned?C.success:C.grayLight}`, boxShadow:"0 2px 12px rgba(0,0,0,0.4)", transition:"border 0.3s" }}>
              <div style={{ display:"flex", gap:12, alignItems:"center", marginBottom:14 }}>
                <div style={{ width:48, height:48, borderRadius:r, background:clientSigned?`${C.success}18`:`${C.violet}12`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:24 }}>🏢</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:800, color:C.text, fontSize:14 }}>Client</div>
                  <div style={{ color:C.textSub, fontSize:12 }}>{clientName||"Client"}</div>
                </div>
                {clientSigned && <div style={{ background:`${C.success}15`, borderRadius:20, padding:"4px 12px", color:C.success, fontSize:12, fontWeight:700 }}>✓ Signé</div>}
              </div>
              {clientSigned ? (
                <div style={{ background:`${C.success}10`, borderRadius:10, padding:"10px 14px" }}>
                  <div style={{ fontSize:12, color:C.success, fontWeight:700 }}>✓ Signature électronique apposée</div>
                  <div style={{ fontSize:11, color:C.textSub, marginTop:3 }}>Le {today} à {new Date().toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"})} · IP masquée · Horodatée</div>
                </div>
              ) : (
                <div>
                  <div style={{ background:C.bg, borderRadius:10, padding:"12px 14px", marginBottom:12, fontSize:12, color:C.textSub, lineHeight:1.6 }}>
                    En signant, je confirme avoir pris connaissance de l'intégralité du contrat de prestation n° <strong>{contractNum}</strong> et en accepte toutes les clauses sans réserve.
                  </div>
                  <Btn full onClick={()=>setClientSigned(true)} style={{ fontSize:14, padding:"14px" }}>
                    ✍️ Signer électroniquement
                  </Btn>
                </div>
              )}
            </div>

            {/* Bloc signature PRESTATAIRE — lecture seule côté client */}
            <div style={{ background:"#0D1B3E", borderRadius:16, padding:"18px", marginBottom:14, border:`2px solid ${prestaSigned?C.success:C.grayLight}`, boxShadow:"0 2px 12px rgba(0,0,0,0.4)", opacity: prestaSigned ? 1 : 0.75 }}>
              <div style={{ display:"flex", gap:12, alignItems:"center", marginBottom:14 }}>
                <div style={{ width:48, height:48, borderRadius:r, background:prestaSigned?`${C.success}18`:`${C.accent}12`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:24 }}>{p.avatar}</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:800, color:C.text, fontSize:14 }}>Prestataire</div>
                  <div style={{ color:C.textSub, fontSize:12 }}>{p.name}</div>
                </div>
                {prestaSigned && <div style={{ background:`${C.success}15`, borderRadius:20, padding:"4px 12px", color:C.success, fontSize:12, fontWeight:700 }}>✓ Signé</div>}
              </div>
              {prestaSigned ? (
                <div style={{ background:`${C.success}10`, borderRadius:10, padding:"10px 14px" }}>
                  <div style={{ fontSize:12, color:C.success, fontWeight:700 }}>✓ Signature électronique apposée</div>
                  <div style={{ fontSize:11, color:C.textSub, marginTop:3 }}>
                    {prestaSignedAt
                      ? `Le ${new Date(prestaSignedAt).toLocaleDateString("fr-FR")} à ${new Date(prestaSignedAt).toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"})} · IP masquée · Horodatée`
                      : "Signé lors de l'acceptation de la prestation · IP masquée · Horodatée"}
                  </div>
                </div>
              ) : (
                <div style={{ background:`${C.accentGold}12`, border:`1px solid ${C.accentGold}33`, borderRadius:10, padding:"12px 14px", display:"flex", gap:10, alignItems:"center" }}>
                  <span style={{ fontSize:18 }}>⏳</span>
                  <div>
                    <div style={{ fontSize:12, color:C.accentGold, fontWeight:700 }}>En attente de la signature prestataire</div>
                    <div style={{ fontSize:11, color:C.textSub, marginTop:2 }}>Le prestataire signera lors de l'acceptation de la prestation</div>
                  </div>
                </div>
              )}
            </div>

            {/* Statut global */}
            <div style={{ background:"#0D1B3E", borderRadius:r, padding:"16px", boxShadow:"0 2px 12px rgba(0,0,0,0.4)", textAlign:"center" }}>
              {bothSigned ? (
                <div>
                  <div style={{ fontSize:28, marginBottom:8 }}>🚀</div>
                  <div style={{ fontWeight:800, color:C.violet, fontSize:14 }}>Finalisation en cours…</div>
                  <div style={{ color:C.textSub, fontSize:12, marginTop:4 }}>Archivage et envoi des copies par email</div>
                </div>
              ) : (
                <div>
                  <div style={{ fontSize:24, marginBottom:8 }}>⏳</div>
                  <div style={{ fontWeight:700, color:C.text, fontSize:13 }}>
                    {!clientSigned && !prestaSigned ? "Les deux parties doivent signer" :
                     !clientSigned ? "En attente de la signature client" :
                     "En attente de la signature prestataire"}
                  </div>
                  <div style={{ color:C.textSub, fontSize:11, marginTop:4 }}>La prestation ne peut démarrer qu'après signature des deux parties</div>
                </div>
              )}
            </div>

            {/* Info paiement sécurisé */}
            <div style={{ background:`${C.accentGold}15`, border:`1px solid ${C.accentGold}44`, borderRadius:r, padding:"14px 16px", marginTop:14, fontSize:12, color:C.text, lineHeight:1.6 }}>
              🔒 <strong>Paiement sécurisé :</strong> Les <strong>{totalAmount} €</strong> sont actuellement sécurisés via Stripe et seront libérés vers {p.name} (<strong>{prestaNet} €</strong>) après validation mutuelle de la prestation.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function LegalScreen({ type, onBack }) {
  const content = {
    cgu: {
      title:"Conditions Générales d’Utilisation",
      icon:"📋",
      sections:[
        { title:"1. Objet", text:"Les présentes CGU régissent l’utilisation de la plateforme ALANE, service de mise en relation entre clients et prestataires de services. En utilisant ALANE, vous acceptez sans réserve les présentes conditions." },
        { title:"2. Inscription", text:"L’inscription est gratuite. Vous devez fournir des informations exactes et à jour. Les prestataires doivent être auto-entrepreneurs en règle avec l’URSSAF et fournir les documents requis." },
        { title:"3. Responsabilités", text:"ALANE agit en qualité d’intermédiaire. La responsabilité de l’exécution de la prestation incombe au prestataire. ALANE ne peut être tenu responsable des dommages résultant d’une mauvaise exécution." },
        { title:"4. Paiements", text:"Les paiements sont sécurisés via Stripe. Les fonds sont bloqués lors de la réservation et libérés après validation mutuelle. Des frais de service fixes (Prestation ponctuelle : 4,90 € ; Multi-jours : 2,90 €/j ; Urgente : 9,90 €) s’ajoutent au montant de la prestation et couvrent les coûts de traitement et de la plateforme." },
        { title:"5. Annulations", text:"En cas d’annulation, les frais de service engagés (Prestation ponctuelle : 4,90 € ; Multi-jours : 2,90 €/j ; Urgente : 9,90 €) restent dus. Aucune retenue n’est appliquée sur le montant de la prestation." },
        { title:"6. Litiges", text:"En cas de litige, les parties s’engagent à contacter la médiation ALANE en premier recours. À défaut de résolution amiable, les tribunaux de Paris seront compétents." },
        { title:"7. Données personnelles", text:"Vos données sont traitées conformément à notre Politique de confidentialité et au RGPD. Vous disposez d’un droit d’accès, de rectification et de suppression de vos données." },
      ]
    },
    privacy: {
      title:"Politique de confidentialité",
      icon:"🔒",
      sections:[
        { title:"1. Responsable du traitement", text:"ALANE SAS, dont le siège social est en France. Contact : direction@alane.fr — Pour toute question relative à vos données personnelles, contactez notre délégué à la protection des données à cette adresse." },
        { title:"2. Données collectées", text:"Nous collectons : données d’identité (prénom, nom), coordonnées (email, téléphone), données professionnelles (secteur, métier, tarifs, IBAN pour les prestataires), données de connexion (logs, dates), données de paiement (traitées exclusivement par Stripe — nous ne stockons jamais vos coordonnées bancaires complètes), avis et évaluations, historique des prestations." },
        { title:"3. Finalités et bases légales", text:"Vos données sont traitées pour : (a) l’exécution du contrat de mise en relation — base légale : exécution du contrat (art. 6.1.b RGPD) ; (b) la gestion des paiements et de la facturation — base légale : exécution du contrat ; (c) la lutte contre la fraude et la sécurité — base légale : intérêt légitime (art. 6.1.f RGPD) ; (d) les communications transactionnelles (confirmation de prestation, paiement) — base légale : exécution du contrat ; (e) l’amélioration du service et les statistiques anonymisées — base légale : intérêt légitime." },
        { title:"4. Durée de conservation", text:"Comptes actifs : données conservées pendant toute la durée de la relation contractuelle. Comptes supprimés : données effacées sous 30 jours, à l’exception des données comptables obligatoires conservées 10 ans (art. L123-22 Code de commerce). Logs de connexion : 12 mois. Données de paiement : conservées par Stripe selon leurs propres politiques." },
        { title:"5. Destinataires des données", text:"Vos données peuvent être partagées avec : Supabase Inc. (USA) — hébergement base de données, couvert par les Clauses Contractuelles Types CE ; Stripe Inc. (USA) — traitement des paiements, certifié PCI-DSS, couvert par les CCT ; Resend Inc. (USA) — envoi d’emails transactionnels, couvert par les CCT. Aucune vente de données à des tiers à des fins commerciales." },
        { title:"6. Transferts hors Union Européenne", text:"Certains sous-traitants sont établis aux États-Unis (Supabase, Stripe, Resend). Ces transferts sont encadrés par les Clauses Contractuelles Types approuvées par la Commission Européenne, offrant un niveau de protection adéquat à vos données." },
        { title:"7. Vos droits", text:"Conformément au RGPD, vous disposez des droits suivants : droit d’accès à vos données (art. 15), droit de rectification (art. 16), droit à l’effacement (art. 17) — exercez-le via Paramètres → Supprimer mon compte, droit à la limitation du traitement (art. 18), droit à la portabilité (art. 20), droit d’opposition (art. 21). Pour exercer ces droits : direction@alane.fr. Réponse sous 30 jours. Vous pouvez également introduire une réclamation auprès de la CNIL (www.cnil.fr)." },
        { title:"8. Cookies et traceurs", text:"ALANE utilise uniquement des cookies strictement nécessaires au fonctionnement du service : cookie de session Supabase (authentification, durée de session) et préférences locales (thème, notifications). Ces cookies ne nécessitent pas votre consentement car ils sont indispensables à la fourniture du service demandé (art. 82 loi Informatique et Libertés). Aucun cookie publicitaire ou de tracking tiers n’est utilisé." },
        { title:"9. Sécurité", text:"Vos données sont protégées par : chiffrement TLS en transit, chiffrement au repos (Supabase), authentification par token signé HMAC pour l’administration, séparation stricte des clés API (clé service uniquement côté serveur). Les mots de passe ne sont jamais stockés en clair (gestion déléguée à Supabase Auth)." },
        { title:"10. Modifications", text:"Cette politique peut être mise à jour. En cas de modification substantielle, vous serez notifié par email. La date de dernière mise à jour est indiquée en bas de cette page. Dernière mise à jour : janvier 2026." },
      ]
    },
    cgps: {
      title:"Conditions Générales de Prestation de Services",
      icon:"📋",
      sections:[
        { title:"1. Objet", text:"Les présentes CGPS régissent les relations entre ALANE (la plateforme), les clients et les prestataires auto-entrepreneurs inscrits. ALANE agit en tant qu'intermédiaire de mise en relation et ne prend pas part à l'exécution des prestations." },
        { title:"2. Statut des prestataires", text:"Les prestataires interviennent en qualité d'auto-entrepreneurs indépendants (art. L8221-6 Code du travail). ALANE n'est pas une entreprise de mise à disposition de personnel ni d'intérim au sens des art. L8241-1 et L1251-1 CT. Les prestations conclues via ALANE ne constituent pas des contrats de travail. Aucun lien de subordination n'existe entre vous (le client) et ALANE. Le contrat de prestation est conclu directement entre vous et le prestataire." },
        { title:"3. Utilisation de la plateforme", text:"En tant que client, vous vous engagez à décrire honnêtement vos besoins, à respecter les prestataires et à valider les prestations dans les délais prévus. Toute utilisation frauduleuse entraîne la résiliation immédiate du compte." },
        { title:"4. Paiements", text:"Les paiements sont sécurisés via Stripe. ALANE ne détient pas les fonds — ils sont réglés directement entre les parties. ALANE prélève une commission de mise en relation selon les conditions tarifaires en vigueur." },
        { title:"5. Annulations", text:"En cas d'annulation avant le début de la prestation, les frais de service engagés restent dus. Aucune retenue n'est appliquée sur le montant net de la prestation. Pour les litiges sur la qualité, voir l'article 9." },
        { title:"6. Responsabilité", text:"ALANE ne peut être tenu responsable des dommages résultant de l'exécution des prestations, des retards, ou de tout différend entre client et prestataire. ALANE est un intermédiaire de mise en relation uniquement." },
        { title:"7. Données personnelles", text:"Vos données sont traitées conformément au RGPD. Elles ne sont jamais vendues à des tiers. Voir la Politique de confidentialité pour le détail complet." },
        { title:"8. Résiliation", text:"Vous pouvez clôturer votre compte à tout moment depuis les Réglages. ALANE se réserve le droit de suspendre ou supprimer un compte en cas de manquement grave aux présentes CGPS." },
        { title:"9. Litiges et qualité des prestations", text:"En cas de contestation sur la qualité d'une prestation, le client dispose de 48 heures après la date de fin de la prestation pour signaler un problème via la plateforme (bouton « Signaler un problème » dans l'historique des prestations).\n\nALANE examine le litige sous 72 heures ouvrées sur la base des éléments fournis par les deux parties (échanges via le tchat, contrat signé, description initiale de la prestation). ALANE peut décider de :\n\n• Valider la prestation et libérer les fonds au prestataire si elle est jugée conforme\n• Procéder à un remboursement partiel ou total du client\n• Suspendre le compte du prestataire en cas de manquement grave\n\nAu-delà du délai de 48 heures sans signalement, la validation est réputée définitivement acquise et les fonds libérés. Aucune contestation ne pourra être acceptée après ce délai.\n\nLes fonds sont conservés par ALANE jusqu'à résolution du litige. ALANE agit en tant qu'arbitre neutre et sa décision est définitive dans le cadre des présentes CGPS." },
      ]
    },
    mentions_legales: {
      title:"Mentions légales",
      icon:"⚖️",
      sections:[
        { title:"Éditeur du site", text:"Raison sociale : [À REMPLIR — ex. ALANE SAS]\nForme juridique : [À REMPLIR — ex. SAS]\nCapital social : [À REMPLIR — ex. 1 000 €]\nSIRET : [À REMPLIR]\nSiège social : [À REMPLIR — ex. 75001 Paris, France]\nEmail : direction@alane.fr\nDirecteur de la publication : [À REMPLIR]" },
        { title:"Hébergeur", text:"Vercel Inc.\n340 Pine Street, Suite 200\nSan Francisco, CA 94104, États-Unis\nhttps://vercel.com\n\nBase de données : Supabase Inc.\n970 Toa Payoh N, Singapour\nhttps://supabase.com" },
        { title:"Propriété intellectuelle", text:"L'ensemble du contenu de la plateforme ALANE (textes, graphismes, logotype, code source) est protégé par le droit d'auteur. Toute reproduction, même partielle, est interdite sans autorisation préalable écrite de l'éditeur." },
        { title:"Médiation de la consommation", text:"Conformément aux articles L.612-1 et suivants du Code de la consommation, vous avez le droit de recourir à un médiateur de la consommation en vue de la résolution amiable d'un litige.\n\nMédiateur désigné : [À REMPLIR — ex. Médiateur du e-commerce de la FEVAD]\nAdresse : [À REMPLIR]\nSite : [À REMPLIR]\n\nVous pouvez également recourir à la plateforme européenne de règlement en ligne des litiges : https://ec.europa.eu/consumers/odr" },
        { title:"Données personnelles", text:"Conformément au Règlement Général sur la Protection des Données (RGPD) et à la loi Informatique et Libertés, vous disposez d'un droit d'accès, de rectification et de suppression de vos données personnelles. Pour exercer ces droits : direction@alane.fr\n\nResponsable de traitement : [À REMPLIR]\nDélégué à la Protection des Données : [À REMPLIR — si applicable]" },
      ]
    }
  };

  const doc = content[type] || content.cgu;

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg, #0A1628 0%, #0D1B3E 100%)`, paddingBottom:40 }}>
      <div style={{ background:"linear-gradient(135deg, #0A1628, #162547)", padding:"48px 22px 24px", borderRadius:"0 0 26px 26px" }}>
        <button onClick={onBack} style={{ background:"rgba(255,255,255,0.15)", border:"none", borderRadius:10, padding:"7px 14px", color:C.white, cursor:"pointer", fontSize:13, marginBottom:14 }}>← Retour</button>
        <div style={{ fontSize:28, marginBottom:8 }}>{doc.icon}</div>
        <h2 style={{ color:C.white, fontSize:19, fontWeight:800, margin:0, lineHeight:1.3 }}>{doc.title}</h2>
        <p style={{ color:"rgba(255,255,255,0.5)", fontSize:12, margin:"6px 0 0" }}>Mise à jour : juin 2026</p>
      </div>
      <div style={{ padding:"20px 18px" }}>
        {doc.sections.map((s,i)=>(
          <div key={i} style={{ background:"#0D1B3E", borderRadius:r, padding:"16px", marginBottom:10, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
            <div style={{ fontWeight:800, color:C.text, fontSize:14, marginBottom:8 }}>{s.title}</div>
            <div style={{ color:C.textSub, fontSize:13, lineHeight:1.7 }}>{s.text}</div>
          </div>
        ))}
        <div style={{ background:`${C.violet}10`, border:`1px solid ${C.violet}22`, borderRadius:r, padding:"14px 16px", marginTop:8, fontSize:12, color:C.textSub, textAlign:"center", lineHeight:1.6 }}>
          Pour toute question : <strong style={{ color:C.violet }}>direction@alane.fr</strong>
        </div>
      </div>
    </div>
  );
}

export function PayslipScreen({ provider, prestation, onBack }) {
  const p = provider;
  if (!p) return null;
  const m = prestation || { role:"Cariste CACES 1", client:"Entrepôt XYZ", date:"12/05/2025", hours:8, tarifNet:14 };
  const brut = m.tarifNet * m.hours;
  const num = `FP-2025-${Math.floor(Math.random()*90000+10000)}`;
  const [downloaded, setDownloaded] = useState(false);
  const [sendEmail, setSendEmail]   = useState("");
  const [sent, setSent]             = useState(false);
  const [showSendForm, setShowSendForm] = useState(false);
  const [caReel, setCaReel] = useState(null);
  const [caPlafond] = useState(77700);
  useEffect(()=>{
    supabase.auth.getUser().then(({data})=>{
      if(!data?.user) return;
      supabase.from("missions").select("montant_total,tarif_horaire,nb_heures").eq("prestataire_id",data.user.id).eq("status","completed")
        .then(({data:ms})=>{
          if(!Array.isArray(ms)) return;
          const total=ms.reduce((s,m)=>s+Number(m.montant_total||(m.tarif_horaire&&m.nb_heures?Number(m.tarif_horaire)*Number(m.nb_heures):0)),0);
          setCaReel(Math.round(total*100)/100);
        });
    });
  },[]);

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg, #0A1628 0%, #0D1B3E 100%)`, paddingBottom:40 }}>
      <div style={{ background:"linear-gradient(135deg, #0A1628, #162547)", padding:"48px 22px 24px", borderRadius:"0 0 26px 26px" }}>
        <button onClick={onBack} style={{ background:"rgba(255,255,255,0.15)", border:"none", borderRadius:10, padding:"7px 14px", color:C.white, cursor:"pointer", fontSize:13, marginBottom:14 }}>← Retour</button>
        <h2 style={{ color:C.white, fontSize:20, fontWeight:800, margin:"0 0 4px" }}>📄 Attestation de prestation</h2>
        <p style={{ color:"rgba(255,255,255,0.5)", fontSize:12, margin:0 }}>{num}</p>
      </div>

      <div style={{ padding:"20px 18px" }}>
        <div style={{ background:"#0D1B3E", borderRadius:16, padding:"20px", marginBottom:14, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
          {/* En-tête */}
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:16, paddingBottom:16, borderBottom:`1px solid ${C.border}` }}>
            <div>
              <div style={{ fontSize:20, fontWeight:800, color:C.violet, fontFamily:font.display }}>ALANE</div>
              <div style={{ fontSize:10, color:C.textSub }}>Attestation de prestation</div>
            </div>
            <div style={{ textAlign:"right" }}>
              <div style={{ fontSize:11, fontWeight:700, color:C.text }}>{num}</div>
              <div style={{ fontSize:10, color:C.textSub }}>{new Date().toLocaleDateString("fr-FR")}</div>
            </div>
          </div>

          {/* Prestataire */}
          <div style={{ background:C.bg, borderRadius:12, padding:"14px", marginBottom:14 }}>
            <div style={{ fontSize:11, color:C.textSub, fontWeight:600, marginBottom:8 }}>PRESTATAIRE</div>
            <div style={{ display:"flex", gap:10, alignItems:"center" }}>
              <div style={{ fontSize:28 }}>{p.avatar}</div>
              <div>
                <div style={{ fontWeight:800, color:C.text, fontSize:15 }}>{p.name}</div>
                <div style={{ color:C.textSub, fontSize:12 }}>Auto-entrepreneur · {p.role}</div>
                <div style={{ color:C.textSub, fontSize:11 }}>SIRET : XXX XXX XXX XXXXX</div>
              </div>
            </div>
          </div>

          {/* Détails prestation */}
          <div style={{ marginBottom:14 }}>
            <div style={{ fontSize:11, color:C.textSub, fontWeight:600, marginBottom:10 }}>DÉTAILS DE LA MISSION</div>
            {[
              ["Client",m.client],["Prestation",m.role],["Date",m.date],["Durée",`${m.hours} heures`],["Lieu","Paris, France"],
            ].map(([l,v])=>(
              <div key={l} style={{ display:"flex", justifyContent:"space-between", padding:"7px 0", borderBottom:`1px solid ${C.border}` }}>
                <span style={{ color:C.textSub, fontSize:13 }}>{l}</span>
                <span style={{ fontWeight:700, color:C.text, fontSize:13 }}>{v}</span>
              </div>
            ))}
          </div>

          {/* Rémunération */}
          <div style={{ background:`${C.success}10`, border:`1px solid ${C.success}22`, borderRadius:12, padding:"14px" }}>
            <div style={{ fontSize:11, color:C.textSub, fontWeight:600, marginBottom:10 }}>RÉMUNÉRATION NETTE</div>
            {[
              ["Taux horaire net",`${m.tarifNet.toFixed(2)} €/h`],
              ["Nombre d’heures",`${m.hours}h`],
              ["Montant net total",`${brut.toFixed(2)} €`],
              ["Statut","✅ Virement effectué"],
            ].map(([l,v],i)=>(
              <div key={l} style={{ display:"flex", justifyContent:"space-between", padding:"7px 0", borderBottom:i<3?`1px solid ${C.success}22`:"none" }}>
                <span style={{ color:C.textSub, fontSize:13 }}>{l}</span>
                <span style={{ fontWeight:i===2||i===3?800:600, color:i===2?C.success:i===3?C.success:C.text, fontSize:i===2?16:13 }}>{v}</span>
              </div>
            ))}
          </div>

          <div style={{ marginTop:12, fontSize:11, color:C.textSub, textAlign:"center", lineHeight:1.6 }}>
            En tant qu'auto-entrepreneur, vous êtes responsable de la déclaration de ce revenu auprès de l'URSSAF.
          </div>
        </div>

        {/* Alerte plafond CA */}
        <div style={{ background:`${C.accentGold}15`, border:`2px solid ${C.accentGold}44`, borderRadius:r, padding:"14px 16px", marginBottom:14 }}>
          <div style={{ fontWeight:800, color:C.text, fontSize:13, marginBottom:6 }}>📊 Suivi plafond auto-entrepreneur</div>
          <div style={{ color:C.textSub, fontSize:12, marginBottom:10 }}>Plafond annuel : <strong style={{ color:C.text }}>77 700 €</strong></div>
          <div style={{ height:8, background:"#162547", borderRadius:4, overflow:"hidden", marginBottom:6 }}>
            <div style={{ height:"100%", width:`${caReel!==null?Math.min(Math.round((caReel/caPlafond)*100),100):0}%`, background:`linear-gradient(90deg,${C.success},${C.accentGold})`, borderRadius:4, transition:"width 1s" }} />
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:C.textSub }}>
            <span>CA réalisé : <strong style={{ color:C.success }}>{caReel!==null?caReel.toLocaleString("fr-FR")+"€":"—"}</strong></span>
            <span>Restant : <strong style={{ color:C.text }}>{caReel!==null?(caPlafond-caReel).toLocaleString("fr-FR")+"€":"—"}</strong></span>
          </div>
        </div>

        <div style={{ display:"flex", gap:10 }}>
          <Btn variant="ghost" onClick={()=>setDownloaded(true)} style={{ flex:1, padding:"13px", fontSize:13, color:downloaded?C.success:undefined }}>{downloaded?"✓ Téléchargé":"⬇️ Télécharger"}</Btn>
          <Btn onClick={()=>setShowSendForm(v=>!v)} style={{ flex:1, padding:"13px", fontSize:13 }}>📧 Envoyer</Btn>
        </div>
        {showSendForm && (
          <div style={{ background:"#0D1B3E", borderRadius:12, padding:"14px", marginTop:10, border:`1px solid ${C.border}` }}>
            {sent ? (
              <div style={{ textAlign:"center", color:C.success, fontWeight:700, fontSize:13, padding:"6px 0" }}>✅ Attestation envoyée</div>
            ) : (
              <div style={{ display:"flex", gap:8 }}>
                <input value={sendEmail} onChange={e=>setSendEmail(e.target.value)} placeholder="Adresse email" type="email" style={{ flex:1, background:"#162547", border:`1px solid ${C.border}`, borderRadius:8, padding:"9px 12px", color:C.text, fontSize:13, fontFamily:"inherit", outline:"none" }} />
                <button onClick={()=>{ if(sendEmail.includes("@")){ setSent(true); setShowSendForm(false); } }} style={{ padding:"9px 14px", borderRadius:8, border:"none", background:C.violet, color:"#fff", fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>Envoyer</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function MissionHistoryScreen({ onNavigate, onBack }) {
  const { providers } = useProviders();
  const [tab, setTab]             = useState("all");
  const [prestations, setMissions]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [selected, setSelected]   = useState(null);
  const [candidatures, setCandidatures] = useState([]);
  const [actioning, setActioning] = useState(null);
  const [completing, setCompleting] = useState(false);
  const [completedResult, setCompletedResult] = useState(null);
  const [userId, setUserId]       = useState(null);
  const [ratedMissions, setRatedMissions] = useState(new Set());
  const [prestaName, setPrestaName] = useState("");
  const [prestaDetails, setPrestaDetails] = useState(null); // { initials, avgRating }
  const [prestaHistoire, setPrestaHistoire] = useState([]);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [accessToken, setAccessToken] = useState(null);
  const [showDisputeModal, setShowDisputeModal] = useState(null);
  const [disputeMsg, setDisputeMsg] = useState("");
  const [disputing, setDisputing] = useState(false);
  const [prestaPosition, setPrestaPosition] = useState(null);
  const [clientCoords, setClientCoords] = useState(null);
  const trackingPollRef = useRef(null);
  const approachNotifSentRef = useRef(new Set());

  useEffect(()=>{ supabase.auth.getUser().then(({data})=>{ if(data?.user) setUserId(data.user.id); }); }, []);

  useEffect(() => {
    Promise.all([supabase.auth.getUser(), supabase.auth.getSession()]).then(async ([{ data }, { data: sd }]) => {
      const user = data?.user; if (!user) return;
      const token = sd?.session?.access_token;
      if (token) setAccessToken(token);
      const res = await fetch("/api/prestations", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { "Authorization": `Bearer ${token}` } : {}) },
        body: JSON.stringify({ action: "list_client" }),
      });
      const data2 = await res.json();
      setMissions(Array.isArray(data2) ? data2 : []);
      setLoading(false);
      const { data: rData } = await supabase.from("ratings").select("mission_id").eq("reviewer_id", user.id);
      if (Array.isArray(rData)) setRatedMissions(new Set(rData.map(r=>r.mission_id).filter(Boolean)));
    });
  }, []);

  useEffect(() => {
    if (selected?.prestataire_id) {
      // Priority 1: accepted candidature (candidature-based assignments)
      const acceptedCand = (selected.candidatures || []).find(c => c.status === "accepted");
      const prenom = acceptedCand?.prenom || selected.prestataire_prenom || "";
      const nom    = acceptedCand?.nom    || selected.prestataire_nom    || "";
      const fullProv = providers.find(p => p.id === selected.prestataire_id);
      if (prenom || nom) {
        const name = [prenom, nom].filter(Boolean).join(" ");
        const initials = [prenom[0], nom[0]].filter(Boolean).join("").toUpperCase() || "P";
        setPrestaName(name);
        setPrestaDetails({ initials, avgRating: 0, photo_url: fullProv?.photo_url || null });
      } else {
        setPrestaDetails(prev => prev || { initials: "P", avgRating: 0, photo_url: fullProv?.photo_url || null });
      }
      // Enrich with ratings (no RLS issue — public read)
      supabase.from("ratings").select("rating").eq("reviewee_provider_id", selected.prestataire_id)
        .then(({ data: ratingRows }) => {
          const ratings = Array.isArray(ratingRows) ? ratingRows.map(r => r.rating).filter(Boolean) : [];
          const avgRating = ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : 0;
          setPrestaDetails(prev => prev ? { ...prev, avgRating } : { initials: "P", avgRating });
        });
    } else {
      setPrestaName("");
      setPrestaDetails(null);
    }
  }, [selected?.id]);

  useEffect(() => {
    const poll = async () => {
      const [{ data }, { data: sd }] = await Promise.all([supabase.auth.getUser(), supabase.auth.getSession()]);
      const user = data?.user; if (!user) return;
      const token = sd?.session?.access_token;
      const res = await fetch("/api/prestations", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { "Authorization": `Bearer ${token}` } : {}) },
        body: JSON.stringify({ action: "list_client" }),
      });
      const data2 = await res.json();
      if (Array.isArray(data2)) setMissions(data2);
    };
    const t = setInterval(poll, 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (trackingPollRef.current) { clearInterval(trackingPollRef.current); trackingPollRef.current = null; }
    setPrestaPosition(null);
    if (!selected || selected.status !== "assigned" || !selected.prestataire_id) return;
    if (navigator.geolocation) navigator.geolocation.getCurrentPosition(p => setClientCoords({ lat: p.coords.latitude, lng: p.coords.longitude }), () => {});
    const pollPosition = async () => {
      const { data: sd } = await supabase.auth.getSession();
      const token = sd?.session?.access_token;
      const r = await fetch("/api/missions", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { "Authorization": `Bearer ${token}` } : {}) },
        body: JSON.stringify({ action: "get_position", mission_id: selected.id }),
      }).catch(() => null);
      if (!r?.ok) return;
      const d = await r.json().catch(() => null);
      if (d?.lat && d?.lng) {
        setPrestaPosition({ lat: d.lat, lng: d.lng, updated_at: d.updated_at });
        // "Arrive bientôt" notification quand distance < 500m (Notification API, fonctionne onglet arrière-plan)
        setClientCoords(prev => {
          if (prev && !approachNotifSentRef.current.has(selected.id)) {
            const dLat = (d.lat - prev.lat) * Math.PI / 180;
            const dLon = (d.lng - prev.lng) * Math.PI / 180;
            const a = Math.sin(dLat/2)**2 + Math.cos(prev.lat*Math.PI/180)*Math.cos(d.lat*Math.PI/180)*Math.sin(dLon/2)**2;
            const dist = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
            if (dist < 0.5 && "Notification" in window && Notification.permission === "granted") {
              approachNotifSentRef.current.add(selected.id);
              new Notification("🏃 Votre prestataire arrive !", { body: "Il est à moins de 500 m de chez vous.", icon: "/icon-192.png" });
            }
          }
          return prev;
        });
      }
    };
    pollPosition();
    trackingPollRef.current = setInterval(pollPosition, 15000);
    return () => { if (trackingPollRef.current) { clearInterval(trackingPollRef.current); trackingPollRef.current = null; } };
  }, [selected?.id, selected?.status]);

  useEffect(() => {
    if (tab !== "prestataires") return;
    const withPresta = prestations.filter(m => m.prestataire_id && ["pending_acceptance","assigned","completed","closed"].includes(m.status));
    const byPresta = {};
    for (const m of withPresta) {
      if (!byPresta[m.prestataire_id]) byPresta[m.prestataire_id] = { prestataire_id: m.prestataire_id, prestations: [] };
      byPresta[m.prestataire_id].missions.push(m);
    }
    const ids = Object.keys(byPresta);
    if (!ids.length) { setPrestaHistoire([]); return; }
    const nameMap = {};
    for (const id of ids) {
      const m = byPresta[id].missions[0];
      const acceptedCand = (m?.candidatures || []).find(c => c.status === "accepted");
      const prenom = acceptedCand?.prenom || m.prestataire_prenom || "";
      const nom    = acceptedCand?.nom    || m.prestataire_nom    || "";
      nameMap[id] = {
        prenom,
        nom,
        name:     [prenom, nom].filter(Boolean).join(" ") || "Prestataire",
        initials: [prenom[0], nom[0]].filter(Boolean).join("").toUpperCase() || "P",
      };
    }
    setPrestaHistoire(ids.map(id => ({ ...byPresta[id], ...(nameMap[id]||{name:"Prestataire",initials:"P"}) })).sort((a,b)=>b.missions.length-a.missions.length));
  }, [tab, prestations]);

  const openCandidatures = async (prestation) => {
    setSelected(prestation);
    setCompletedResult(null);
    const { data: sd } = await supabase.auth.getSession();
    const token = sd?.session?.access_token;
    const res = await fetch("/api/prestations", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { "Authorization": `Bearer ${token}` } : {}) },
      body: JSON.stringify({ action: "get_candidatures", mission_id: prestation.id }),
    });
    const data = await res.json();
    const cands = Array.isArray(data) ? data : [];
    setCandidatures(cands);
    // Mettre à jour le nom prestataire depuis get_candidatures, avec fallback sur prestataire_prenom/nom
    if (prestation.prestataire_id) {
      const accepted = cands.find(c => c.status === "accepted");
      const prenom = accepted?.prenom || prestation.prestataire_prenom || "";
      const nom    = accepted?.nom    || prestation.prestataire_nom    || "";
      if (prenom || nom) {
        const name = [prenom, nom].filter(Boolean).join(" ");
        const initials = [prenom?.[0], nom?.[0]].filter(Boolean).join("").toUpperCase() || "P";
        setPrestaName(name);
        setPrestaDetails(prev => prev ? { ...prev, initials } : { initials, avgRating: 0 });
      }
    }
  };

  const handleAccept = async (c) => {
    setActioning(c.id);
    try {
      const { data: sd } = await supabase.auth.getSession();
      const token = sd?.session?.access_token;
      const res = await fetch("/api/prestations", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { "Authorization": `Bearer ${token}` } : {}) },
        body: JSON.stringify({ action: "accept", candidature_id: c.id, mission_id: selected.id, prestataire_id: c.prestataire_id }),
      });
      const data = await res.json();
      if (data.payment_required) {
        onNavigate("stripe_pay", { amount: data.amount, clientSecret: data.client_secret, pendingCandidature: c, pendingMissionId: selected.id });
        setActioning(null);
        return;
      }
      if (!res.ok) throw new Error();
      setMissions(ms => ms.map(m => m.id === selected.id ? { ...m, status: "assigned", prestataire_id: c.prestataire_id } : m));
      setCandidatures(cs => cs.map(x => ({ ...x, status: x.id === c.id ? "accepted" : "rejected" })));
      setSelected(s => s ? { ...s, status: "assigned" } : s);
    } catch { alert("Erreur lors de l'acceptation. Réessayez."); }
    setActioning(null);
  };

  const handleComplete = async () => {
    if (!selected || !userId) return;
    setCompleting(true);
    try {
      const { data: sd } = await supabase.auth.getSession();
      const token = sd?.session?.access_token;
      const res = await fetch("/api/prestations", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { "Authorization": `Bearer ${token}` } : {}) },
        body: JSON.stringify({ action: "complete", mission_id: selected.id }),
      });
      const data = await res.json();
      if (data.success) {
        setMissions(ms => ms.map(m => m.id === selected.id ? { ...m, status: "completed" } : m));
        setSelected(s => s ? { ...s, status: "completed" } : s);
        setCompletedResult(data);
      } else {
        alert(data.error || "Erreur lors de la validation. Réessayez.");
      }
    } catch { alert("Erreur lors de la validation. Réessayez."); }
    setCompleting(false);
  };

  const handleReject = async (c) => {
    setActioning(c.id);
    try {
      const { data: sd } = await supabase.auth.getSession();
      const token = sd?.session?.access_token;
      const res = await fetch("/api/prestations", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { "Authorization": `Bearer ${token}` } : {}) },
        body: JSON.stringify({ action: "reject", candidature_id: c.id }),
      });
      if (!res.ok) throw new Error();
      setCandidatures(cs => cs.map(x => x.id === c.id ? { ...x, status: "rejected" } : x));
    } catch { alert("Erreur lors du refus. Réessayez."); }
    setActioning(null);
  };

  const handleClose = async (missionId) => {
    try {
      const { data: sd } = await supabase.auth.getSession();
      const token = sd?.session?.access_token;
      const res = await fetch("/api/prestations", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { "Authorization": `Bearer ${token}` } : {}) },
        body: JSON.stringify({ action: "close", mission_id: missionId }),
      });
      if (!res.ok) throw new Error();
      setMissions(ms => ms.map(m => m.id === missionId ? { ...m, status: "closed" } : m));
    } catch { alert("Erreur lors de la fermeture. Réessayez."); }
  };

  const handleCancel = async () => {
    if (!selected) return;
    setCancelling(true);
    try {
      const { data: sd } = await supabase.auth.getSession();
      const token = sd?.session?.access_token;
      const missionDate = selected.date ? new Date(selected.date + "T" + (selected.heure_debut || "00:00")) : null;
      const hoursUntil = missionDate ? (missionDate - Date.now()) / 3600000 : Infinity;
      const penalty = !selected.stripe_payment_intent ? 0 : hoursUntil >= 24 ? 0 : 100;
      const res = await fetch("/api/prestations", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { "Authorization": `Bearer ${token}` } : {}) },
        body: JSON.stringify({ action: "cancel_client", mission_id: selected.id, penalty }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur");
      setMissions(ms => ms.map(m => m.id === selected.id ? { ...m, status: "cancelled" } : m));
      setSelected(null);
      setShowCancelConfirm(false);
    } catch(e) { alert(e.message || "Erreur lors de l'annulation. Réessayez."); }
    setCancelling(false);
  };

  const handleStopInProgress = async () => {
    if (!selected) return;
    setStopping(true);
    try {
      const { data: sd } = await supabase.auth.getSession();
      const token = sd?.session?.access_token;
      const res = await fetch("/api/prestations", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { "Authorization": `Bearer ${token}` } : {}) },
        body: JSON.stringify({ action: "cancel_in_progress", mission_id: selected.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur");
      setMissions(ms => ms.map(m => m.id === selected.id ? { ...m, status: "cancelled" } : m));
      setSelected(null);
      setShowStopConfirm(false);
    } catch(e) { alert(e.message || "Erreur lors de l'arrêt. Réessayez."); }
    setStopping(false);
  };

  const statusLabel  = { open:"Ouverte", assigned:"Assignée", completed:"Terminée", closed:"Fermée", needs_replacement:"Remplaçant cherché", cancelled:"Annulée" };
  const statusColor  = { open:C.success, assigned:C.violet, completed:C.accentGold, closed:C.textMuted, needs_replacement:"#F59E0B", cancelled:"#F25E5E" };
  const filtered = tab === "all" ? prestations : tab === "open" ? prestations.filter(m => m.status === "open" || m.status === "needs_replacement") : prestations.filter(m => m.status === tab);

  if (selected) {
    const sector = SECTORS.find(s => s.id === selected.sector);
    return (
      <div style={{ minHeight:"100%", background:`linear-gradient(180deg,#0A1628,#0D1B3E)`, paddingBottom:80 }}>
        <div style={{ background:"linear-gradient(135deg,#0A1628,#162547)", padding:"48px 22px 20px", borderRadius:"0 0 26px 26px" }}>
          <button onClick={()=>setSelected(null)} style={{ background:"rgba(255,255,255,0.15)", border:"none", borderRadius:10, padding:"7px 14px", color:C.white, cursor:"pointer", fontSize:13, marginBottom:14 }}>← Retour</button>
          <div style={{ display:"flex", alignItems:"flex-start", gap:14, marginBottom:12 }}>
            <div style={{ width:52, height:52, borderRadius:14, background:`${sector?.color||C.violet}30`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:26, flexShrink:0 }}>{sector?.icon||"📋"}</div>
            <div>
              <h2 style={{ color:C.white, fontSize:18, fontWeight:800, margin:"0 0 4px" }}>{selected.metier || sector?.label}</h2>
              <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
                {selected.date && <span style={{ color:"rgba(255,255,255,0.6)", fontSize:12 }}>📅 {selected.date}</span>}
                {selected.heure_debut && <span style={{ color:"rgba(255,255,255,0.6)", fontSize:12 }}>🕐 {selected.heure_debut}</span>}
                {selected.hours && <span style={{ color:"rgba(255,255,255,0.6)", fontSize:12 }}>⏱ {selected.hours}h</span>}
                {selected.ville && <span style={{ color:"rgba(255,255,255,0.6)", fontSize:12 }}>📍 {selected.ville}</span>}
                {selected.tarif_horaire > 0 && <span style={{ color:"rgba(255,255,255,0.6)", fontSize:12 }}>💶 {selected.tarif_horaire} €/h</span>}
              </div>
            </div>
          </div>
          {selected.adresse && <div style={{ background:"rgba(255,255,255,0.07)", borderRadius:10, padding:"8px 12px", fontSize:12, color:"rgba(255,255,255,0.6)", marginBottom:4 }}>🏢 {selected.adresse}</div>}
          {selected.description && <div style={{ background:"rgba(255,255,255,0.07)", borderRadius:10, padding:"8px 12px", fontSize:12, color:"rgba(255,255,255,0.7)", lineHeight:1.5 }}>📝 {selected.description}</div>}
        </div>
        <div style={{ padding:"18px" }}>
          {/* Carte prestataire assigné */}
          {(["assigned","pending_acceptance","completed","closed"].includes(selected.status)) && selected.prestataire_id && prestaDetails && (() => {
            const fullProvider = providers.find(p => p.id === selected.prestataire_id);
            const navToProfile = () => {
              const p = fullProvider || { id: selected.prestataire_id, name: prestaName || "Prestataire", prenom: selected.prestataire_prenom || "", nom: selected.prestataire_nom || "", avatar: "👷", color: C.violet, photo_url: prestaDetails.photo_url || null };
              onNavigate("profile", p);
            };
            return (
            <div style={{ background:"linear-gradient(135deg,#162547,#1a2d5a)", borderRadius:16, padding:"16px", marginBottom:16, border:`1px solid ${C.violet}55` }}>
              <div style={{ fontSize:11, color:C.textMuted, fontWeight:700, letterSpacing:1, textTransform:"uppercase", marginBottom:12 }}>Prestataire assigné</div>
              <div onClick={navToProfile} style={{ display:"flex", alignItems:"center", gap:14, cursor:"pointer" }}>
                <div onClick={navToProfile} style={{ width:54, height:54, borderRadius:"50%", background:`linear-gradient(135deg,${C.violet},#A29BFE)`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, fontWeight:800, color:"#fff", flexShrink:0, overflow:"hidden", cursor:"pointer" }}>
                  {prestaDetails.photo_url
                    ? <img src={prestaDetails.photo_url} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} />
                    : prestaDetails.initials}
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:800, color:C.text, fontSize:16 }}>{prestaName}</div>
                  <div style={{ color:C.textSub, fontSize:12, marginTop:2 }}>{selected.metier || sector?.label}{selected.tarif_horaire > 0 ? ` · ${selected.tarif_horaire} €/h` : ""}</div>
                  {prestaDetails.avgRating > 0 && (
                    <div style={{ color:C.accentGold, fontSize:12, fontWeight:700, marginTop:3 }}>
                      {"⭐".repeat(Math.round(prestaDetails.avgRating))} {prestaDetails.avgRating}/5
                    </div>
                  )}
                  <div style={{ color:C.violet, fontSize:11, marginTop:3 }}>Voir le profil →</div>
                </div>
                <button onClick={(e)=>{ e.stopPropagation(); if(selected.prestataire_id) onNavigate("chat", { id:selected.prestataire_id, name:prestaName||"Prestataire", avatar:"👷", color:C.violet }); }}
                  style={{ padding:"8px 14px", borderRadius:10, border:`1px solid ${C.violet}55`, background:`${C.violet}20`, color:C.violet, fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>
                  💬 Chat
                </button>
              </div>
            </div>
            );
          })()}
          {selected.status === "assigned" && (() => {
            const haversine = (lat1, lon1, lat2, lon2) => {
              const R = 6371, dLat = (lat2-lat1)*Math.PI/180, dLon = (lon2-lon1)*Math.PI/180;
              const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
              return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
            };
            const dist = (prestaPosition && clientCoords) ? haversine(clientCoords.lat, clientCoords.lng, prestaPosition.lat, prestaPosition.lng) : null;
            return prestaPosition ? (
              <div style={{ background:"linear-gradient(135deg,rgba(16,217,143,0.08),rgba(16,217,143,0.04))", border:"1.5px solid rgba(16,217,143,0.35)", borderRadius:16, padding:"14px 16px", marginBottom:16 }}>
                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
                  <div style={{ width:8, height:8, borderRadius:"50%", background:"#10D98F", boxShadow:"0 0 8px #10D98F", animation:"pulse 1.5s ease-in-out infinite", flexShrink:0 }} />
                  <span style={{ color:"#10D98F", fontWeight:700, fontSize:13 }}>Localisation en direct</span>
                  {prestaPosition.updated_at && (() => {
                    const ago = Math.floor((Date.now() - new Date(prestaPosition.updated_at).getTime()) / 60000);
                    return <span style={{ color:"rgba(255,255,255,0.4)", fontSize:11 }}>· il y a {ago < 1 ? "< 1 min" : `${ago} min`}</span>;
                  })()}
                </div>
                {dist != null && (
                  <div style={{ color:"rgba(255,255,255,0.7)", fontSize:12, marginBottom:10 }}>
                    🏃 À environ <strong style={{ color:"#fff" }}>{dist < 1 ? `${Math.round(dist*1000)} m` : `${dist.toFixed(1)} km`}</strong> de vous
                  </div>
                )}
                <a href={`https://www.google.com/maps?q=${prestaPosition.lat},${prestaPosition.lng}`} target="_blank" rel="noopener noreferrer"
                  style={{ display:"block", padding:"9px", borderRadius:10, background:"rgba(16,217,143,0.15)", border:"1px solid rgba(16,217,143,0.3)", color:"#10D98F", fontWeight:700, fontSize:12, textDecoration:"none", textAlign:"center" }}>
                  🗺 Voir sur Google Maps
                </a>
              </div>
            ) : (
              <div style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:16, padding:"12px 16px", marginBottom:16, display:"flex", alignItems:"center", gap:10 }}>
                <span style={{ fontSize:16 }}>📍</span>
                <span style={{ color:"rgba(255,255,255,0.4)", fontSize:12 }}>Le prestataire n'a pas encore activé le partage de position</span>
              </div>
            );
          })()}
          {(selected.status === "open" || selected.status === "needs_replacement") && (<>
          <p style={{ color:C.text, fontWeight:700, fontSize:14, marginBottom:12 }}>
            {candidatures.length === 0 ? "Aucune candidature reçue" : `${candidatures.length} candidature${candidatures.length > 1 ? "s" : ""} reçue${candidatures.length > 1 ? "s" : ""}`}
          </p>
          {candidatures.map(c => (
            <div key={c.id} style={{ background:"#0D1B3E", borderRadius:14, padding:"14px", marginBottom:10, border:`1px solid ${c.status==="accepted"?C.success:c.status==="rejected"?"rgba(242,94,94,0.3)":C.border}` }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:c.message?8:0 }}>
                <div>
                  <div style={{ fontWeight:700, color:C.text, fontSize:14 }}>{c.prenom} {c.nom}</div>
                  <div style={{ color:C.textMuted, fontSize:11 }}>{new Date(c.created_at).toLocaleDateString("fr-FR")}</div>
                </div>
                {c.status === "accepted" && <span style={{ color:C.success, fontWeight:700, fontSize:12 }}>✅ Accepté</span>}
                {c.status === "rejected" && <span style={{ color:"#F25E5E", fontWeight:700, fontSize:12 }}>❌ Refusé</span>}
              </div>
              {c.message && <p style={{ color:C.textSub, fontSize:13, margin:"0 0 10px", fontStyle:"italic" }}>"{c.message}"</p>}
              {c.status === "pending" && selected.status === "open" && (
                <div style={{ display:"flex", gap:8, marginTop:8 }}>
                  <button onClick={()=>handleReject(c)} disabled={!!actioning} style={{ flex:1, padding:"9px", borderRadius:10, border:"1px solid rgba(242,94,94,0.3)", background:"transparent", color:"#F25E5E", fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>
                    {actioning===c.id?"…":"❌ Refuser"}
                  </button>
                  <button onClick={()=>handleAccept(c)} disabled={!!actioning} style={{ flex:2, padding:"9px", borderRadius:10, border:"none", background:C.success, color:"#fff", fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>
                    {actioning===c.id?"…":"✅ Accepter"}
                  </button>
                </div>
              )}
            </div>
          ))}
          {candidatures.length === 0 && (
            <div style={{ background:"rgba(255,255,255,0.04)", border:`1px solid ${C.border}`, borderRadius:16, padding:"28px", textAlign:"center" }}>
              <div style={{ fontSize:32, marginBottom:8 }}>📭</div>
              <div style={{ color:C.textSub, fontSize:13 }}>En attente de candidatures…</div>
            </div>
          )}
          {selected.status === "needs_replacement" && (
            <div style={{ marginTop:20, background:"rgba(245,158,11,0.08)", border:"1px solid rgba(245,158,11,0.35)", borderRadius:14, padding:"16px" }}>
              <div style={{ fontWeight:700, color:"#F59E0B", fontSize:14, marginBottom:6 }}>🔄 Prestataire désisté</div>
              <div style={{ color:C.textSub, fontSize:13, lineHeight:1.6 }}>
                Votre paiement est conservé et sécurisé. Nous recherchons un remplaçant parmi les prestataires disponibles. Vous serez notifié(e) dès qu'un nouveau prestataire accepte la prestation.
              </div>
              <div style={{ marginTop:10, color:C.textMuted, fontSize:11 }}>⚠️ Aucune nouvelle facturation ne sera effectuée.</div>
            </div>
          )}
          </>)}
          {selected.status === "assigned" && !completedResult && (
            selected.validation_prestataire ? (
              <div style={{ marginTop:20, background:`${C.accentGold}12`, border:`1px solid ${C.accentGold}40`, borderRadius:14, padding:"16px" }}>
                <div style={{ fontWeight:700, color:C.text, fontSize:14, marginBottom:4 }}>Prestation terminée ?</div>
                <div style={{ color:C.textSub, fontSize:12, marginBottom:12, lineHeight:1.5 }}>
                  Le prestataire a confirmé la fin de prestation. En validant, vous confirmez que la prestation s'est bien déroulée. Le cashback sera crédité sur votre wallet.
                </div>
                <button onClick={handleComplete} disabled={completing} style={{ width:"100%", padding:"13px", borderRadius:10, border:"none", background:C.accentGold, color:"#fff", fontWeight:700, fontSize:14, cursor:"pointer", fontFamily:"inherit" }}>
                  {completing ? "Validation…" : "✅ Valider la prestation"}
                </button>
              </div>
            ) : (
              <div style={{ marginTop:20, background:"rgba(124,111,224,0.08)", border:"1px solid rgba(124,111,224,0.3)", borderRadius:14, padding:"16px" }}>
                <div style={{ fontWeight:700, color:"#A29BFE", fontSize:14, marginBottom:4 }}>⏳ En attente de confirmation</div>
                <div style={{ color:C.textSub, fontSize:13, lineHeight:1.5 }}>
                  Le prestataire n'a pas encore confirmé la fin de prestation. Vous pourrez valider dès qu'il aura confirmé de son côté. La prestation est automatiquement validée sous 24h si le prestataire a confirmé.
                </div>
              </div>
            )
          )}

          {completedResult && (
            <div style={{ marginTop:20 }}>
              <div style={{ background:`${C.success}12`, border:`1px solid ${C.success}40`, borderRadius:14, padding:"20px", textAlign:"center", marginBottom:12 }}>
                <div style={{ fontSize:32, marginBottom:8 }}>🎉</div>
                <div style={{ fontWeight:700, color:C.text, fontSize:15, marginBottom:4 }}>Prestation validée !</div>
                <div style={{ color:C.textSub, fontSize:13, marginBottom:12 }}>
                  Montant : <strong style={{ color:C.text }}>{completedResult.montantTotal?.toFixed(2).replace(".",",")} € HT</strong>
                </div>
                <div style={{ background:`${C.accentGold}20`, border:`1px solid ${C.accentGold}40`, borderRadius:10, padding:"12px" }}>
                  <div style={{ color:C.accentGold, fontWeight:700, fontSize:16 }}>+{completedResult.cashbackEarned?.toFixed(2).replace(".",",")} € cashback</div>
                  <div style={{ color:C.textMuted, fontSize:11, marginTop:2 }}>crédité sur votre wallet</div>
                </div>
              </div>
              {selected.prestataire_id && !ratedMissions.has(selected.id) && (
                <button onClick={()=>onNavigate("rating", { id:selected.prestataire_id, name:prestaName||"Prestataire", avatar:"👷", color:C.violet, jobTitle:selected.metier||"Prestataire", _missionId:selected.id, _fromHistory:true })}
                  style={{ width:"100%", padding:"14px", borderRadius:r, border:"none", background:`linear-gradient(135deg,${C.accentGold},#e67e22)`, color:"#fff", fontWeight:700, fontSize:14, cursor:"pointer", fontFamily:"inherit" }}>
                  ⭐ Noter le prestataire
                </button>
              )}
            </div>
          )}

          {selected.status === "completed" && !completedResult && (
            <div style={{ marginTop:20 }}>
              <div style={{ background:`${C.success}12`, border:`1px solid ${C.success}30`, borderRadius:14, padding:"14px", textAlign:"center", marginBottom:10 }}>
                <div style={{ color:C.success, fontWeight:700, fontSize:14 }}>✅ Prestation terminée et validée</div>
                {selected.montant_total > 0 && <div style={{ color:C.textSub, fontSize:12, marginTop:4 }}>Montant : {Number(selected.montant_total).toFixed(2).replace(".",",")} € HT</div>}
              </div>
              {selected.prestataire_id && !ratedMissions.has(selected.id) && (
                <button onClick={()=>onNavigate("rating", { id:selected.prestataire_id, name:prestaName||"Prestataire", avatar:"👷", color:C.violet, jobTitle:selected.metier||"Prestataire", _missionId:selected.id, _fromHistory:true })}
                  style={{ width:"100%", padding:"13px", borderRadius:r, border:"none", background:`linear-gradient(135deg,${C.accentGold},#e67e22)`, color:"#fff", fontWeight:700, fontSize:14, cursor:"pointer", fontFamily:"inherit" }}>
                  ⭐ Noter le prestataire
                </button>
              )}
              {ratedMissions.has(selected.id) && (
                <div style={{ textAlign:"center", color:C.accentGold, fontSize:12, fontWeight:600, padding:"8px 0" }}>✓ Vous avez déjà noté cette prestation</div>
              )}
            </div>
          )}

          {selected.status === "completed" && (() => {
            const mEnd = selected.date ? new Date(`${selected.date}T${selected.heure_fin || "23:59"}`) : null;
            const hoursElapsed = mEnd ? (Date.now() - mEnd.getTime()) / 3600000 : 999;
            if (hoursElapsed > 48) return null;
            return (
              <div style={{ marginTop:8 }}>
                <button onClick={()=>setShowDisputeModal(selected.id)} style={{ width:"100%", padding:"11px", borderRadius:r, border:"1px solid rgba(242,94,94,0.3)", background:"rgba(242,94,94,0.08)", color:"#F25E5E", fontWeight:600, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>
                  ⚠️ Signaler un problème
                </button>
              </div>
            );
          })()}

          {(selected.status === "completed" || selected.status === "closed") && (
            <div style={{ display:"flex", flexDirection:"column", gap:8, marginTop:12 }}>
              <button
                onClick={async () => {
                  let tok = accessToken;
                  if (!tok) {
                    const { data: sd } = await supabase.auth.getSession();
                    tok = sd?.session?.access_token;
                    if (tok) setAccessToken(tok);
                  }
                  if (tok) {
                    window.open(`/api/invoice?mission_id=${encodeURIComponent(selected.id)}&token=${encodeURIComponent(tok)}`, "_blank");
                  }
                }}
                style={{ width:"100%", padding:"13px", borderRadius:r, border:`1px solid ${C.violet}55`, background:`${C.violet}15`, color:C.violet, fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}
              >
                📄 Télécharger la facture
              </button>
              <button onClick={()=>onNavigate("invoice", selected)} style={{ width:"100%", padding:"11px", borderRadius:r, border:`1px solid ${C.border}`, background:"transparent", color:C.textSub, fontWeight:600, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>
                Voir la facture dans l'app
              </button>
            </div>
          )}

          {selected.status === "open" && (
            <button onClick={()=>handleClose(selected.id)} style={{ width:"100%", marginTop:16, padding:"11px", borderRadius:10, border:"1px solid rgba(255,255,255,0.15)", background:"transparent", color:C.textSub, fontWeight:600, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
              Clôturer la prestation
            </button>
          )}

          {(() => {
            const mStart = selected.date ? new Date(`${selected.date}T${selected.heure_debut || "00:00"}`) : null;
            const mEnd   = mStart ? new Date(mStart.getTime() + Number(selected.hours || 1) * 3600000) : null;
            const now2   = Date.now();
            const isStarted = mStart && mStart.getTime() < now2;
            const isEnded   = mEnd   && mEnd.getTime()   < now2;
            const elapsedH  = mStart && isStarted ? (now2 - mStart.getTime()) / 3600000 : 0;
            const billedH   = Math.min(Math.ceil(elapsedH), Number(selected.hours || 1));
            const prorata   = billedH * Number(selected.tarif_horaire || 0);

            return (<>
              {/* Prestation pas encore démarrée : annulation classique */}
              {(selected.status === "open" || selected.status === "pending_acceptance" ||
                (selected.status === "assigned" && !isStarted && !isEnded)) && (
                <button onClick={()=>setShowCancelConfirm(true)} style={{ width:"100%", marginTop:10, padding:"11px", borderRadius:10, border:"1px solid rgba(242,94,94,0.35)", background:"transparent", color:"#F25E5E", fontWeight:600, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
                  ✕ Annuler la prestation
                </button>
              )}

              {/* Prestation en cours : interrompre avec prorata */}
              {selected.status === "assigned" && isStarted && !isEnded && (
                <button onClick={()=>setShowStopConfirm(true)} style={{ width:"100%", marginTop:10, padding:"12px", borderRadius:10, border:"1px solid rgba(242,94,94,0.5)", background:"rgba(242,94,94,0.1)", color:"#F25E5E", fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
                  ⏹ Interrompre la prestation en cours
                </button>
              )}

              {/* Modal annulation classique */}
              {showCancelConfirm && (
                <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", zIndex:9000, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
                  <div style={{ background:"#0D1B3E", borderRadius:"20px 20px 0 0", padding:"28px 22px 36px", width:"100%", maxWidth:480 }}>
                    <div style={{ fontSize:28, textAlign:"center", marginBottom:10 }}>⚠️</div>
                    <div style={{ fontWeight:800, color:"#F25E5E", fontSize:17, textAlign:"center", marginBottom:8 }}>Annuler la prestation ?</div>
                    {selected.stripe_payment_intent ? (
                      (() => {
                        const hoursUntil = mStart ? (mStart.getTime() - Date.now()) / 3600000 : Infinity;
                        return hoursUntil >= 24
                          ? <div style={{ color:"rgba(255,255,255,0.65)", fontSize:13, textAlign:"center", lineHeight:1.6, marginBottom:20 }}>Annulation à plus de 24h → <strong style={{ color:"#10D98F" }}>remboursement intégral</strong> (hors frais de service).</div>
                          : <div style={{ color:"rgba(255,255,255,0.65)", fontSize:13, textAlign:"center", lineHeight:1.6, marginBottom:20 }}>Annulation à moins de 24h → <strong style={{ color:"#F0B429" }}>les frais de service sont retenus</strong>. Le reste sera remboursé.</div>;
                      })()
                    ) : (
                      <div style={{ color:"rgba(255,255,255,0.65)", fontSize:13, textAlign:"center", lineHeight:1.6, marginBottom:20 }}>Cette prestation sera supprimée. Aucun paiement n'a été effectué.</div>
                    )}
                    <div style={{ display:"flex", gap:10 }}>
                      <button onClick={()=>setShowCancelConfirm(false)} disabled={cancelling} style={{ flex:1, padding:"12px", borderRadius:10, border:"1px solid rgba(255,255,255,0.15)", background:"transparent", color:"rgba(255,255,255,0.6)", fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>Garder</button>
                      <button onClick={handleCancel} disabled={cancelling} style={{ flex:1, padding:"12px", borderRadius:10, border:"none", background:"#F25E5E", color:"#fff", fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
                        {cancelling ? "Annulation…" : "Confirmer"}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Modal arrêt en cours — prorata */}
              {showStopConfirm && (
                <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", zIndex:9000, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
                  <div style={{ background:"#0D1B3E", borderRadius:"20px 20px 0 0", padding:"28px 22px 36px", width:"100%", maxWidth:480 }}>
                    <div style={{ fontSize:28, textAlign:"center", marginBottom:10 }}>⏹</div>
                    <div style={{ fontWeight:800, color:"#F25E5E", fontSize:17, textAlign:"center", marginBottom:6 }}>Interrompre la prestation ?</div>
                    <div style={{ color:"rgba(255,255,255,0.55)", fontSize:12, textAlign:"center", marginBottom:16 }}>La prestation est en cours depuis {elapsedH.toFixed(1).replace(".",",")}h</div>
                    <div style={{ background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.12)", borderRadius:12, padding:"16px", marginBottom:18 }}>
                      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
                        <span style={{ color:"rgba(255,255,255,0.55)", fontSize:13 }}>Durée effectuée</span>
                        <span style={{ color:"#fff", fontWeight:700, fontSize:13 }}>{elapsedH.toFixed(1).replace(".",",")}h</span>
                      </div>
                      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
                        <span style={{ color:"rgba(255,255,255,0.55)", fontSize:13 }}>Heures facturées</span>
                        <span style={{ color:"#7C6FE0", fontWeight:800, fontSize:15 }}>{billedH}h <span style={{ fontSize:11, fontWeight:400 }}>(arrondi supérieur)</span></span>
                      </div>
                      <div style={{ display:"flex", justifyContent:"space-between", paddingTop:8, borderTop:"1px solid rgba(255,255,255,0.1)" }}>
                        <span style={{ color:"rgba(255,255,255,0.55)", fontSize:13 }}>Montant prestataire</span>
                        <span style={{ color:"#10D98F", fontWeight:800, fontSize:16 }}>{prorata.toFixed(2).replace(".",",")} € HT</span>
                      </div>
                    </div>
                    <div style={{ color:"rgba(255,255,255,0.5)", fontSize:11, textAlign:"center", marginBottom:18, lineHeight:1.5 }}>
                      Le prestataire sera averti par email et SMS. L'équipe ALANE traitera le remboursement partiel sous 48h.
                    </div>
                    <div style={{ display:"flex", gap:10 }}>
                      <button onClick={()=>setShowStopConfirm(false)} disabled={stopping} style={{ flex:1, padding:"12px", borderRadius:10, border:"1px solid rgba(255,255,255,0.15)", background:"transparent", color:"rgba(255,255,255,0.6)", fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>Continuer</button>
                      <button onClick={handleStopInProgress} disabled={stopping} style={{ flex:1, padding:"12px", borderRadius:10, border:"none", background:"#F25E5E", color:"#fff", fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
                        {stopping ? "Arrêt…" : "Interrompre"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>);
          })()}
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg,#0A1628,#0D1B3E)`, paddingBottom:80 }}>
      <div style={{ background:"linear-gradient(135deg,#0A1628,#162547)", padding:"48px 22px 24px", borderRadius:"0 0 26px 26px" }}>
        <button onClick={onBack} style={{ background:"rgba(255,255,255,0.15)", border:"none", borderRadius:10, padding:"7px 14px", color:C.white, cursor:"pointer", fontSize:13, marginBottom:14 }}>← Retour</button>
        <h2 style={{ color:C.white, fontSize:21, fontWeight:800, margin:"0 0 4px" }}>📋 Mes prestations</h2>
        <p style={{ color:"rgba(255,255,255,0.55)", fontSize:13, margin:0 }}>{prestations.length} prestation{prestations.length!==1?"s":""} au total</p>
      </div>
      <div style={{ padding:"16px 18px 0" }}>
        <div style={{ display:"flex", background:"#162547", borderRadius:12, padding:4, marginBottom:16 }}>
          {[{id:"all",l:"Toutes"},{id:"open",l:"Ouvertes"},{id:"assigned",l:"Assignées"},{id:"completed",l:"Terminées"},{id:"prestataires",l:"Prestataires"}].map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} style={{ flex:1, padding:"8px 4px", border:"none", borderRadius:10, cursor:"pointer", background:tab===t.id?C.white:"transparent", color:tab===t.id?C.navy:C.gray, fontWeight:tab===t.id?700:500, fontSize:11, fontFamily:"inherit" }}>{t.l}</button>
          ))}
        </div>
        {loading && <div style={{ textAlign:"center", color:C.textSub, padding:40 }}>Chargement…</div>}
        {!loading && tab !== "prestataires" && filtered.length === 0 && (
          <div style={{ background:"rgba(255,255,255,0.04)", border:`1px solid ${C.border}`, borderRadius:16, padding:"32px", textAlign:"center" }}>
            <div style={{ fontSize:36, marginBottom:10 }}>📭</div>
            <div style={{ color:C.text, fontWeight:600, fontSize:13, marginBottom:6 }}>Aucune prestation</div>
            <div style={{ color:C.textMuted, fontSize:12 }}>Publiez votre première prestation depuis un secteur.</div>
          </div>
        )}
        {tab === "prestataires" && (
          <div>
            {prestaHistoire.length === 0 && !loading && (
              <div style={{ background:"rgba(255,255,255,0.04)", border:`1px solid ${C.border}`, borderRadius:16, padding:"32px", textAlign:"center" }}>
                <div style={{ fontSize:36, marginBottom:10 }}>👤</div>
                <div style={{ color:C.text, fontWeight:600, fontSize:13, marginBottom:6 }}>Aucun prestataire</div>
                <div style={{ color:C.textMuted, fontSize:12 }}>Vos prestataires apparaîtront ici après vos premières prestations terminées.</div>
              </div>
            )}
            {prestaHistoire.map((ph) => {
              const fullProv = providers.find(fp => fp.id === ph.prestataire_id);
              const navProv  = fullProv || { id: ph.prestataire_id, name: ph.name, prenom: ph.prenom || "", nom: ph.nom || "", avatar:"👷", color:C.violet };
              const photoUrl = fullProv?.photo_url || null;
              const metier   = fullProv?.jobTitle || ph.missions[0]?.metier || "";
              const sortedM  = [...ph.missions].sort((a,b) => (b.date||"") > (a.date||"") ? 1 : -1);
              const lastDate = sortedM[0]?.date || "—";
              const nbMissions = ph.missions.length;
              return (
              <div key={ph.prestataire_id} style={{ background:"#0D1B3E", borderRadius:16, padding:"16px", marginBottom:12, border:`1px solid ${C.border}` }}>
                <div style={{ display:"flex", alignItems:"center", gap:14 }}>
                  <div
                    onClick={() => onNavigate("profile", navProv)}
                    style={{ width:54, height:54, borderRadius:"50%", background:`linear-gradient(135deg,${C.violet},#A29BFE)`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, fontWeight:800, color:"#fff", flexShrink:0, overflow:"hidden", cursor:"pointer" }}>
                    {photoUrl ? <img src={photoUrl} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} /> : ph.initials}
                  </div>
                  <div style={{ flex:1, minWidth:0 }} onClick={() => onNavigate("profile", navProv)} >
                    <div style={{ fontWeight:800, color:C.text, fontSize:15 }}>{ph.name}</div>
                    {metier && <div style={{ color:C.textSub, fontSize:12, marginTop:1 }}>{metier}</div>}
                    <div style={{ color:C.textMuted, fontSize:12, marginTop:2 }}>
                      {nbMissions} prestation{nbMissions > 1 ? "s" : ""} · Dernière : {lastDate}
                    </div>
                    <div style={{ color:C.violet, fontSize:11, fontWeight:600, marginTop:2 }}>Voir le profil →</div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); onNavigate("chat", { id: ph.prestataire_id, name: ph.name, avatar:"👷", color:C.violet }); }}
                    style={{ padding:"8px 12px", borderRadius:10, border:`1px solid ${C.violet}55`, background:`${C.violet}20`, color:C.violet, fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit", whiteSpace:"nowrap" }}>
                    💬
                  </button>
                </div>
              </div>
              );
            })}
          </div>
        )}
        {tab !== "prestataires" && filtered.map(m => {
          const sector = SECTORS.find(s => s.id === m.sector);
          const pending = (m.candidatures||[]).filter(c=>c.status==="pending").length;
          const acceptedCandidature = m.candidatures?.find(c=>c.status==="accepted");
          const heureDebut = m.heure_debut || "";
          const heureFin = (() => {
            if (!heureDebut || !m.hours) return "";
            const [h,min] = heureDebut.split(":").map(Number);
            const e = h*60+min+Math.round(Number(m.hours)*60);
            return `${String(Math.floor(e/60)%24).padStart(2,"0")}:${String(e%60).padStart(2,"0")}`;
          })();
          const borderColor = pending>0 ? C.violet : m.status==="assigned" ? C.violet : m.status==="completed" ? C.accentGold : m.status==="cancelled" ? "#F25E5E" : C.border;
          return (
            <div key={m.id} onClick={()=>openCandidatures(m)}
              style={{ background:"#0D1B3E", borderRadius:16, marginBottom:12, cursor:"pointer", overflow:"hidden",
                border:`1px solid ${borderColor}44` }}>
              {/* Bande de statut en haut */}
              <div style={{ background:`${statusColor[m.status]||C.textMuted}18`, borderBottom:`1px solid ${statusColor[m.status]||C.textMuted}22`, padding:"7px 14px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                <span style={{ color:statusColor[m.status]||C.textMuted, fontSize:11, fontWeight:800, letterSpacing:0.5, textTransform:"uppercase" }}>
                  {pending>0 ? `🔔 ${pending} candidature${pending>1?"s":""} en attente` : statusLabel[m.status]||m.status}
                </span>
                {m.recurrence && <span style={{ fontSize:10, color:C.violet, fontWeight:700 }}>🔄 {m.recurrence==="weekly"?"Hebdo":m.recurrence==="biweekly"?"Bi-mens.":"Mensuel"}</span>}
              </div>
              {/* Corps de la carte */}
              <div style={{ padding:"13px 14px", display:"flex", gap:12, alignItems:"flex-start" }}>
                <div style={{ width:46, height:46, borderRadius:13, background:`${sector?.color||C.violet}22`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, flexShrink:0 }}>{sector?.icon||"📋"}</div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontWeight:800, color:C.text, fontSize:15, marginBottom:5 }}>{m.metier || sector?.label || "Prestation"}</div>
                  <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
                    {m.date && (
                      <div style={{ display:"flex", alignItems:"center", gap:6, color:C.textSub, fontSize:12 }}>
                        <span style={{ width:14, textAlign:"center" }}>📅</span>
                        <span>{m.date}</span>
                      </div>
                    )}
                    {(heureDebut || m.hours) && (
                      <div style={{ display:"flex", alignItems:"center", gap:6, color:C.textSub, fontSize:12 }}>
                        <span style={{ width:14, textAlign:"center" }}>🕐</span>
                        <span>{heureDebut && heureFin ? `${heureDebut} – ${heureFin}` : heureDebut || `${m.hours}h`}</span>
                      </div>
                    )}
                    {m.ville && (
                      <div style={{ display:"flex", alignItems:"center", gap:6, color:C.textSub, fontSize:12 }}>
                        <span style={{ width:14, textAlign:"center" }}>📍</span>
                        <span>{m.ville}</span>
                      </div>
                    )}
                    {m.status==="assigned" && acceptedCandidature && (
                      <div style={{ display:"flex", alignItems:"center", gap:6, color:C.success, fontSize:12, fontWeight:700, marginTop:2 }}>
                        <span style={{ width:14, textAlign:"center" }}>✓</span>
                        <span>{[acceptedCandidature.prenom, acceptedCandidature.nom].filter(Boolean).join(" ") || "Prestataire assigné"}</span>
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ color:C.textMuted, fontSize:18, alignSelf:"center", paddingLeft:4 }}>›</div>
              </div>
            </div>
          );
        })}
      </div>

      {showDisputeModal && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", zIndex:200, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
          <div style={{ background:"#0D1B3E", borderRadius:"20px 20px 0 0", padding:"24px 20px 40px", width:"100%", maxWidth:480 }}>
            <div style={{ fontWeight:800, color:"#F25E5E", fontSize:16, marginBottom:6 }}>⚠️ Signaler un problème</div>
            <div style={{ color:C.textSub, fontSize:12, marginBottom:16, lineHeight:1.5 }}>Décrivez le problème rencontré. ALANE examinera votre dossier sous 72h ouvrées et vous contactera.</div>
            <textarea value={disputeMsg} onChange={e=>setDisputeMsg(e.target.value)} placeholder="Ex : Le prestataire n'a pas respecté les termes convenus, travail incomplet..." style={{ width:"100%", minHeight:100, background:"rgba(255,255,255,0.05)", border:"1px solid rgba(242,94,94,0.3)", borderRadius:10, color:C.text, fontSize:13, padding:"10px 12px", fontFamily:"inherit", resize:"vertical", boxSizing:"border-box" }} />
            <div style={{ display:"flex", gap:10, marginTop:16 }}>
              <button onClick={()=>{setShowDisputeModal(null);setDisputeMsg("");}} style={{ flex:1, padding:"12px", borderRadius:10, border:`1px solid ${C.border}`, background:"transparent", color:C.textSub, fontWeight:600, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>Annuler</button>
              <button disabled={disputing || !disputeMsg.trim()} onClick={async()=>{
                setDisputing(true);
                try {
                  const { data:sd } = await supabase.auth.getSession();
                  const tok = sd?.session?.access_token;
                  const res = await fetch("/api/missions", { method:"POST", headers:{"Content-Type":"application/json","Authorization":`Bearer ${tok}`}, body: JSON.stringify({ action:"dispute", mission_id: showDisputeModal, message: disputeMsg.trim() }) });
                  const j = await res.json();
                  if (j.ok) {
                    setShowDisputeModal(null); setDisputeMsg("");
                    setMissions(ms => ms.map(m => m.id === showDisputeModal ? { ...m, status:"disputed" } : m));
                    if (selected?.id === showDisputeModal) setSelected(s => s ? { ...s, status:"disputed" } : s);
                    alert("Votre signalement a été transmis à ALANE. Vous serez contacté sous 72h ouvrées.");
                  } else {
                    alert(j.error || "Erreur lors de l'envoi du signalement.");
                  }
                } catch { alert("Erreur réseau, réessayez."); }
                setDisputing(false);
              }} style={{ flex:2, padding:"12px", borderRadius:10, border:"none", background:"#F25E5E", color:"#fff", fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit", opacity:disputing||!disputeMsg.trim()?0.5:1 }}>
                {disputing ? "Envoi…" : "Envoyer le signalement"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function CashbackWalletScreen({ onBack, onNavigate }) {
  const [walletData, setWalletData] = useState({ balance: 0, missionsThisMonth: 0 });
  const [history, setHistory]       = useState([]);
  const [wLoading, setWLoading]     = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      const user = data?.user;
      if (!user) { setWLoading(false); return; }

      const [{ data: profile }, { data: completedMissions }] = await Promise.all([
        supabase.from("profiles").select("cashback_balance,missions_completed_month").eq("id", user.id).single(),
        supabase.from("missions").select("id,metier,sector,date,hours,tarif_horaire,montant_total,status")
          .eq("client_id", user.id).eq("status", "completed").order("created_at", { ascending: false }),
      ]);

      setWalletData({
        balance: profile?.cashback_balance || 0,
        missionsThisMonth: profile?.missions_completed_month || 0,
      });

      if (Array.isArray(completedMissions)) {
        setHistory(completedMissions.map(m => {
          const sector = SECTORS.find(s => s.id === m.sector);
          const montant = m.montant_total || ((m.hours||0) * (m.tarif_horaire||0));
          const rate = getCashbackTier(profile?.missions_completed_month || 0).rate;
          const cashback = Math.round(montant * rate * 100) / 100;
          return {
            prestation: m.metier || sector?.label || "Prestation",
            date: m.date ? new Date(m.date).toLocaleDateString("fr-FR") : "—",
            amount: montant,
            cashback,
            status: "disponible",
          };
        }));
      }
      setWLoading(false);
    });
  }, []);

  const w = walletData;
  const tier = getCashbackTier(w.missionsThisMonth);
  const nextTier = CASHBACK_TIERS[CASHBACK_TIERS.indexOf(tier) + 1];
  const missionsToNext = nextTier ? nextTier.min - w.missionsThisMonth : 0;
  const progressPct = nextTier
    ? Math.min(100, ((w.missionsThisMonth - tier.min) / (nextTier.min - tier.min)) * 100)
    : 100;

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg, #0A1628 0%, #0D1B3E 100%)`, paddingBottom:40 }}>
      {/* Header */}
      <div style={{ background:"#0D1B3E", borderBottom:`1px solid ${C.border}`, padding:"52px 22px 28px" }}>
        <button onClick={onBack} style={{ background:"transparent", border:"none", color:C.textSub, cursor:"pointer", fontSize:13, marginBottom:16, display:"flex", alignItems:"center", gap:6 }}>← Retour</button>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
          <div>
            <p style={{ color:C.textMuted, fontSize:11, letterSpacing:1, textTransform:"uppercase", margin:"0 0 4px" }}>Mon wallet</p>
            <h2 style={{ color:C.text, fontSize:26, fontWeight:700, margin:0, fontFamily:font.display }}>Cashback</h2>
          </div>
          <Badge color={tier.color} small>{tier.icon} {tier.label}</Badge>
        </div>
      </div>

      <div style={{ padding:"20px 18px" }}>
        {/* Solde principal */}
        <div style={{
          background:`linear-gradient(135deg, rgba(124,111,224,0.20), rgba(91,79,207,0.12))`,
          border:`1px solid ${C.violet}40`,
          borderRadius:r+4, padding:"24px 20px", marginBottom:16,
          position:"relative", overflow:"hidden",
        }}>
          <div style={{ position:"absolute", top:-30, right:-30, width:140, height:140, borderRadius:"50%", background:`${C.violet}12`, pointerEvents:"none" }} />
          <p style={{ color:C.textSub, fontSize:11, letterSpacing:1, textTransform:"uppercase", marginBottom:8 }}>Solde disponible</p>
          <div style={{ fontSize:44, fontWeight:800, color:C.text, fontFamily:font.display, letterSpacing:-1, marginBottom:4 }}>
            {wLoading ? "—" : Number(w.balance).toFixed(2)} <span style={{ fontSize:22, color:C.textSub }}>€</span>
          </div>
          <p style={{ color:C.textMuted, fontSize:12, margin:"0 0 16px" }}>
            {w.balance >= 10 ? <span style={{ color:C.accentGold }}>Disponible à l'utilisation</span> : "Minimum 10 € pour utiliser votre cashback"}
          </p>
          <Btn onClick={()=>onNavigate("search_filters")} style={{ fontSize:13, padding:"10px 20px" }}>
            Utiliser mon cashback →
          </Btn>
        </div>

        {/* Stats rapides */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:20 }}>
          {[
            { label:"Solde wallet",  value:`${Number(w.balance).toFixed(2)} €`,        color:C.success, icon:"💰" },
            { label:"Ce mois",       value:`${w.missionsThisMonth} prestation${w.missionsThisMonth>1?"s":""}`, color:C.violet, icon:"📋" },
          ].map(s=>(
            <div key={s.label} style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"14px", display:"flex", gap:10, alignItems:"center" }}>
              <div style={{ width:36, height:36, borderRadius:10, background:`${s.color}15`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:17 }}>{s.icon}</div>
              <div>
                <div style={{ fontWeight:700, color:C.text, fontSize:15 }}>{s.value}</div>
                <div style={{ color:C.textMuted, fontSize:11, marginTop:1 }}>{s.label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Palier fidélité */}
        <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"16px", marginBottom:16 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
            <div style={{ fontWeight:700, color:C.text, fontSize:14 }}>Votre statut fidélité</div>
            <Badge color={tier.color} small>{tier.icon} {tier.label} — {(tier.rate*100).toFixed(0)}%</Badge>
          </div>

          {/* Barre de progression */}
          <div style={{ height:6, background:"#162547", borderRadius:3, overflow:"hidden", marginBottom:8 }}>
            <div style={{ height:"100%", width:`${Math.min(progressPct,100)}%`, background:`linear-gradient(90deg,${tier.color},${nextTier?.color||tier.color})`, borderRadius:3, transition:"width 1s cubic-bezier(0.22,1,0.36,1)" }} />
          </div>

          {nextTier ? (
            <p style={{ color:C.textSub, fontSize:12 }}>
              Encore <strong style={{ color:C.text }}>{missionsToNext} prestation{missionsToNext>1?"s":""}</strong> ce mois pour atteindre le palier{" "}
              <strong style={{ color:nextTier.color }}>{nextTier.icon} {nextTier.label} ({(nextTier.rate*100).toFixed(0)}%)</strong>
            </p>
          ) : (
            <p style={{ color:C.accentGold, fontSize:12, fontWeight:700 }}>💎 Vous êtes au palier maximum — félicitations !</p>
          )}

          {/* Tous les paliers */}
          <div style={{ display:"flex", gap:6, marginTop:14 }}>
            {CASHBACK_TIERS.map((t,i)=>(
              <div key={t.id} style={{
                flex:1, padding:"8px 4px", borderRadius:10, textAlign:"center",
                background: t.id===tier.id ? `${t.color}20` : C.bgSurface,
                border:`1px solid ${t.id===tier.id ? t.color+"55" : C.border}`,
              }}>
                <div style={{ fontSize:16, marginBottom:2 }}>{t.icon}</div>
                <div style={{ fontSize:9, fontWeight:700, color:t.id===tier.id?t.color:C.textMuted, textTransform:"uppercase", letterSpacing:0.3 }}>{t.label}</div>
                <div style={{ fontSize:11, fontWeight:800, color:t.id===tier.id?t.color:C.textMuted, marginTop:1 }}>{(t.rate*100).toFixed(0)}%</div>
              </div>
            ))}
          </div>
        </div>

        {/* Historique */}
        <div style={{ fontWeight:700, color:C.text, fontSize:14, marginBottom:12 }}>Historique des gains</div>
        {!wLoading && history.length === 0 && (
          <div style={{ background:"rgba(255,255,255,0.04)", border:`1px solid ${C.border}`, borderRadius:r, padding:"24px", textAlign:"center", marginBottom:12 }}>
            <div style={{ fontSize:28, marginBottom:8 }}>💸</div>
            <div style={{ color:C.textSub, fontSize:13 }}>Validez votre première prestation pour gagner du cashback.</div>
          </div>
        )}
        {history.map((h,i)=>(
          <div key={i} style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"13px 15px", marginBottom:8, display:"flex", alignItems:"center", gap:12, opacity:h.status==="expiré"?0.5:1 }}>
            <div style={{ width:38, height:38, borderRadius:10, background:h.status==="disponible"?`${C.success}15`:h.status==="utilisé"?`${C.violet}15`:`${C.textMuted}15`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:17, flexShrink:0 }}>
              {h.status==="disponible"?"💰":h.status==="utilisé"?"✓":"⌛"}
            </div>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:600, color:C.text, fontSize:13, marginBottom:2 }}>{h.prestation}</div>
              <div style={{ color:C.textMuted, fontSize:11 }}>{h.date} · Prestation {h.amount} €</div>
            </div>
            <div style={{ textAlign:"right", flexShrink:0 }}>
              <div style={{ fontWeight:700, color:h.status==="disponible"?C.success:h.status==="utilisé"?C.violet:C.textMuted, fontSize:14 }}>
                +{h.cashback.toFixed(2)} €
              </div>
              <Badge color={h.status==="disponible"?C.success:h.status==="utilisé"?C.violet:C.textMuted} small>
                {h.status}
              </Badge>
            </div>
          </div>
        ))}

        {/* Info expiration */}
        <div style={{ background:"#162547", border:`1px solid ${C.border}`, borderRadius:r, padding:"12px 14px", marginTop:8, fontSize:12, color:C.textSub, lineHeight:1.6 }}>
          ℹ️ Le cashback est crédité <strong style={{ color:C.text }}>24h après validation</strong> de chaque prestation. Il expire <strong style={{ color:C.text }}>6 mois</strong> après son crédit. Montant minimum d'utilisation : <strong style={{ color:C.text }}>10 €</strong>.
        </div>
      </div>
    </div>
  );
}

export const NOTIF_ICONS = { payment:"💶", prestation:"📋", urgent:"🚨", cashback:"💰", rating:"⭐", reminder:"⏰", contract:"✍️", system:"🔔" };
export const NOTIF_COLORS = { payment:C.success, prestation:C.violet, urgent:C.accent, cashback:C.accentGold, rating:C.accentGold, reminder:C.textSub, contract:C.violet, system:C.textMuted };

export function timeAgo(ts) {
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if(diff < 60) return "À l’instant";
  if(diff < 3600) return `Il y a ${Math.floor(diff/60)} min`;
  if(diff < 86400) return `Il y a ${Math.floor(diff/3600)}h`;
  return `Il y a ${Math.floor(diff/86400)}j`;
}

export function NotificationsScreen({ onBack, onNavigate, role }) {
  const [notifs, setNotifs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(()=>{
    let mounted = true;
    let channel;
    (async()=>{
      const { data:authData, error:authErr } = await supabase.auth.getUser();
      const user = authData?.user;
      if(!mounted){ return; }
      if(authErr || !user){ setLoading(false); return; }

      const { data:notifData } = await supabase.from("notifications").select("*").eq("user_id", user.id).order("created_at",{ascending:false}).limit(50);
      if(!mounted) return;
      setNotifs(notifData||[]);
      setLoading(false);

      channel = supabase.channel("notifs_"+user.id)
        .on("postgres_changes",{ event:"INSERT", schema:"public", table:"notifications", filter:`user_id=eq.${user.id}` },
          payload => { if(mounted) setNotifs(prev=>[payload.new, ...prev]); }
        ).subscribe();
    })();
    return ()=>{ mounted=false; if(channel) supabase.removeChannel(channel); };
  },[]);

  const unread = notifs.filter(n=>!n.read).length;

  const markAllRead = async () => {
    const { data } = await supabase.auth.getUser();
    const user = data?.user;
    if(user) await supabase.from("notifications").update({read:true}).eq("user_id",user.id).eq("read",false);
    setNotifs(ns=>ns.map(n=>({...n,read:true})));
  };

  const markOneRead = async (id) => {
    await supabase.from("notifications").update({read:true}).eq("id",id);
    setNotifs(ns=>ns.map(n=>n.id===id?{...n,read:true}:n));
  };

  const handleNotifClick = async (n) => {
    await markOneRead(n.id);
    if (!onNavigate) return;
    const isPresta = role === "prestataire";
    if (n.type === "system" && n.ref_id) {
      // Notification chat → ouvrir directement la conversation
      if (isPresta) {
        // Le prestataire voit un message du client : ref_id = client_id
        onNavigate("chat", { id: n.ref_id, name: n.title?.replace("💬 Nouveau message de ", "") || "Client", avatar: "👤", color: "#4F46E5", clientId: n.ref_id });
      } else {
        // Le client voit un message du prestataire : ref_id = prestataire_id
        onNavigate("chat", { id: n.ref_id, name: n.title?.replace("💬 Nouveau message de ", "") || "Prestataire", avatar: "👤", color: "#4F46E5" });
      }
    } else if (n.type === "prestation") {
      onNavigate(isPresta ? "p_missions" : "mission_history");
    } else if (n.type === "system") {
      onNavigate(isPresta ? "p_missions" : "search_filters");
    } else if (n.type === "cashback") {
      onNavigate(isPresta ? "p_home" : "cashback");
    }
  };

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg,#0A1628,#0D1B3E)`, paddingBottom:40 }}>
      <div style={{ background:"linear-gradient(135deg,#0A1628,#162547)", borderBottom:`1px solid ${C.border}`, padding:"52px 22px 20px" }}>
        <button onClick={onBack} style={{ background:"transparent", border:"none", color:C.textSub, cursor:"pointer", fontSize:13, marginBottom:14 }}>← Retour</button>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <h2 style={{ color:C.text, fontSize:22, fontWeight:700, margin:0, fontFamily:font.display }}>Notifications</h2>
            {unread > 0 && <p style={{ color:C.textSub, fontSize:12, margin:"4px 0 0" }}>{unread} non lue{unread>1?"s":""}</p>}
          </div>
          {unread > 0 && (
            <button onClick={markAllRead} style={{ background:"transparent", border:`1px solid ${C.border}`, borderRadius:10, padding:"6px 12px", color:C.textSub, cursor:"pointer", fontSize:12, fontFamily:"inherit" }}>
              Tout marquer lu
            </button>
          )}
        </div>
      </div>

      <div style={{ padding:"16px 18px" }}>
        {loading && <div style={{ textAlign:"center", color:C.textSub, padding:40 }}>Chargement…</div>}
        {!loading && notifs.length===0 && (
          <div style={{ textAlign:"center", color:C.textSub, padding:40 }}>
            <div style={{ fontSize:40, marginBottom:12 }}>🔔</div>
            <div>Aucune notification pour l'instant</div>
          </div>
        )}
        {notifs.map(n => {
          const color = NOTIF_COLORS[n.type] || C.textMuted;
          const icon  = NOTIF_ICONS[n.type]  || "🔔";
          return (
            <div key={n.id} onClick={()=>handleNotifClick(n)} style={{
              background: n.read ? "#0D1B3E" : `${color}12`,
              border: `1px solid ${n.read ? C.border : color+"35"}`,
              borderRadius:r, padding:"14px 15px", marginBottom:8,
              cursor:"pointer", display:"flex", gap:12, alignItems:"flex-start",
              transition:"all 0.2s", position:"relative",
            }}>
              {!n.read && <div style={{ position:"absolute", top:14, right:14, width:8, height:8, borderRadius:"50%", background:color, boxShadow:`0 0 6px ${color}` }} />}
              <div style={{ width:40, height:40, borderRadius:12, background:`${color}20`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>{icon}</div>
              <div style={{ flex:1, paddingRight:16 }}>
                <div style={{ fontWeight:n.read?600:700, color:C.text, fontSize:13, marginBottom:3 }}>{n.title}</div>
                <div style={{ color:C.textSub, fontSize:12, lineHeight:1.5 }}>{n.body}</div>
                <div style={{ color:C.textMuted, fontSize:10, marginTop:5 }}>{timeAgo(n.created_at)}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function MissionTimeline({ status="in_progress" }) {
  const steps = [
    { id:"booked",    label:"Réservé",       icon:"📋", desc:"Prestation confirmée"          },
    { id:"signed",    label:"Contrat signé", icon:"✍️", desc:"Les deux parties ont signé" },
    { id:"enroute",   label:"En route",      icon:"🚗", desc:"Le prestataire arrive"       },
    { id:"in_progress",label:"En cours",    icon:"🔄", desc:"Prestation en cours"            },
    { id:"done",      label:"Terminé",       icon:"✅", desc:"Prestation effectuée"           },
    { id:"paid",      label:"Payé",          icon:"💶", desc:"Paiement libéré"             },
  ];
  const activeIdx = steps.findIndex(s=>s.id===status);

  return (
    <div style={{ padding:"16px 0" }}>
      {steps.map((s,i) => {
        const done    = i < activeIdx;
        const active  = i === activeIdx;
        const pending = i > activeIdx;
        return (
          <div key={s.id} style={{ display:"flex", gap:12, marginBottom: i<steps.length-1?0:0, position:"relative" }}>
            {/* Vertical line */}
            {i < steps.length-1 && (
              <div style={{ position:"absolute", left:19, top:40, width:2, height:28, background: done?C.violet:C.border, borderRadius:1, transition:"background 0.3s" }} />
            )}
            <div style={{ width:40, height:40, borderRadius:"50%", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18,
              background: active ? C.violet : done ? `${C.violet}30` : C.bgSurface,
              border: `2px solid ${active ? C.violet : done ? C.violet+"60" : C.border}`,
              boxShadow: active ? `0 0 16px ${C.violet}55` : "none",
              transition:"all 0.3s",
            }}>
              {done ? "✓" : s.icon}
            </div>
            <div style={{ paddingBottom:28, flex:1 }}>
              <div style={{ fontWeight: active?700:600, color: active?C.text:done?C.textSub:C.textMuted, fontSize:13 }}>{s.label}</div>
              <div style={{ color:C.textMuted, fontSize:11, marginTop:2 }}>{s.desc}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function RatingScreen({ provider, missionId, onSubmit, onBack }) {
  if (!provider) return <div style={{ padding:40, textAlign:"center", color:C.textSub }}><button onClick={onBack} style={{ background:"transparent", border:"none", color:C.textSub, cursor:"pointer", fontSize:13, display:"block", marginBottom:16 }}>← Retour</button>Prestataire introuvable.</div>;
  const p = provider;
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [tags, setTags] = useState([]);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ratingError, setRatingError] = useState(null);
  const [userId, setUserId] = useState(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data?.user?.id || null));
  }, []);

  const TAGS_POS = ["Ponctuel","Efficace","Professionnel","Communicatif","Excellent travail","Je recommande"];
  const TAGS_NEG = ["En retard","Qualité insuffisante","Communication difficile"];

  if(submitted) return (
    <div style={{ minHeight:"100%", background:`linear-gradient(160deg,${C.violet}33,#0A1628)`, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:32, textAlign:"center" }}>
      <div style={{ fontSize:72, marginBottom:16 }}>⭐</div>
      <h2 style={{ color:C.text, fontSize:24, fontWeight:700, margin:"0 0 10px", fontFamily:font.display }}>Merci pour votre avis !</h2>
      <p style={{ color:C.textSub, fontSize:14, lineHeight:1.8, maxWidth:280, margin:"0 auto 28px" }}>Votre note de <strong style={{ color:C.accentGold }}>{"★".repeat(rating)}</strong> a été publiée sur le profil de <strong style={{ color:C.text }}>{p.name}</strong>.</p>
      <Btn full onClick={onSubmit}>Retour à l'accueil</Btn>
    </div>
  );

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg,#0A1628,#0D1B3E)`, paddingBottom:40 }}>
      <div style={{ background:"linear-gradient(135deg,#0A1628,#162547)", borderBottom:`1px solid ${C.border}`, padding:"52px 22px 24px" }}>
        <button onClick={onBack} style={{ background:"transparent", border:"none", color:C.textSub, cursor:"pointer", fontSize:13, marginBottom:14 }}>← Retour</button>
        <h2 style={{ color:C.text, fontSize:22, fontWeight:700, margin:0, fontFamily:font.display }}>Noter la prestation</h2>
        <p style={{ color:C.textSub, fontSize:13, margin:"6px 0 0" }}>Votre avis aide la communauté ALANE</p>
      </div>

      <div style={{ padding:"22px 18px" }}>
        {/* Carte prestataire */}
        <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"16px", marginBottom:20, display:"flex", gap:12, alignItems:"center" }}>
          <div style={{ width:52, height:52, borderRadius:r, background:`${p.color}22`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:26 }}>{p.avatar}</div>
          <div>
            <div style={{ fontWeight:700, color:C.text, fontSize:15 }}>{p.name}</div>
            <div style={{ color:C.textSub, fontSize:12, marginTop:2 }}>{p.jobTitle || p.role}</div>
          </div>
        </div>

        {/* Étoiles géantes */}
        <div style={{ textAlign:"center", marginBottom:24 }}>
          <p style={{ color:C.textSub, fontSize:13, marginBottom:14, letterSpacing:0.3 }}>Comment s'est passée la prestation ?</p>
          <div style={{ display:"flex", gap:10, justifyContent:"center", marginBottom:10 }}>
            {[1,2,3,4,5].map(i => (
              <span key={i}
                onClick={()=>setRating(i)}
                onMouseEnter={()=>setHover(i)}
                onMouseLeave={()=>setHover(0)}
                style={{
                  fontSize:44, cursor:"pointer",
                  color: i<=(hover||rating) ? C.accentGold : "rgba(255,255,255,0.12)",
                  transition:"all 0.15s",
                  transform: i<=(hover||rating) ? "scale(1.15)" : "scale(1)",
                  display:"inline-block",
                }}>★</span>
            ))}
          </div>
          {rating > 0 && (
            <p style={{ color:C.accentGold, fontSize:13, fontWeight:700 }}>
              {["","😞 Très décevant","😕 Décevant","😐 Correct","😊 Bien","🤩 Excellent !"][rating]}
            </p>
          )}
        </div>

        {/* Tags */}
        {rating > 0 && (
          <div style={{ marginBottom:20 }}>
            <p style={{ color:C.textSub, fontSize:12, marginBottom:10, letterSpacing:0.5, textTransform:"uppercase" }}>Points forts</p>
            <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
              {(rating >= 3 ? TAGS_POS : TAGS_NEG).map(t => (
                <button key={t} onClick={()=>setTags(ts=>ts.includes(t)?ts.filter(x=>x!==t):[...ts,t])} style={{
                  padding:"7px 14px", borderRadius:100, fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"inherit",
                  background: tags.includes(t) ? C.violet : "rgba(255,255,255,0.06)",
                  color: tags.includes(t) ? C.white : C.textSub,
                  border: `1px solid ${tags.includes(t) ? C.violet : C.border}`,
                  transition:"all 0.2s",
                }}>{t}</button>
              ))}
            </div>
          </div>
        )}

        {/* Commentaire */}
        <div style={{ marginBottom:20 }}>
          <label style={{ display:"block", color:C.textSub, fontSize:11, letterSpacing:0.8, textTransform:"uppercase", marginBottom:8, fontWeight:600 }}>Commentaire (optionnel)</label>
          <textarea
            value={comment}
            onChange={e=>setComment(e.target.value)}
            placeholder="Décrivez votre expérience avec ce prestataire…"
            style={{ width:"100%", padding:"13px 15px", borderRadius:r, border:`1px solid ${C.border}`, fontSize:13, fontFamily:"inherit", resize:"none", height:90, boxSizing:"border-box", outline:"none", background:"#112240", color:C.text, lineHeight:1.6 }}
          />
        </div>

        <Btn full disabled={rating===0||saving} onClick={async()=>{
          setSaving(true);
          setRatingError(null);
          try {
            if(userId && p.id) {
              const { data: mCheck } = await supabase.from("missions")
                .select("id").eq("client_id", userId).eq("prestataire_id", p.id).eq("status","completed").limit(1);
              if(!mCheck?.length) {
                setRatingError("Vous ne pouvez noter un prestataire qu'après une prestation complétée ensemble.");
                setSaving(false); return;
              }
            }
            const { error: insertErr } = await supabase.from("ratings").insert({
              reviewer_id: userId,
              reviewee_provider_id: p.id,
              reviewee_name: p.name,
              rating,
              tags,
              comment: comment.trim()||null,
              mission_id: missionId||null,
            });
            if (insertErr) throw insertErr;
          } catch(e) {
            setRatingError("Une erreur est survenue. Veuillez réessayer.");
            setSaving(false);
            return;
          }
          setSaving(false);
          setSubmitted(true);
        }} style={{ fontSize:15, padding:"16px" }}>
          {saving ? "Envoi…" : "⭐ Publier mon avis"}
        </Btn>
        {ratingError && <p style={{ textAlign:"center", color:"#FF6B6B", fontSize:13, marginTop:10, fontWeight:600 }}>{ratingError}</p>}
        {rating===0 && !ratingError && <p style={{ textAlign:"center", color:C.textMuted, fontSize:12, marginTop:8 }}>Sélectionnez une note pour continuer</p>}
      </div>
    </div>
  );
}

export function DocUploadScreen({ onBack }) {
  const DOC_DEFS = [
    { id:"photo",    label:"Photo de profil",              icon:"📸", required:true,  accept:"image/*" },
    { id:"kbis",     label:"Extrait KBIS / Avis INSEE",    icon:"📋", required:true  },
    { id:"urssaf",   label:"Attestation URSSAF",           icon:"🏛️", required:true  },
    { id:"cni",      label:"Pièce d’identité",             icon:"🪪", required:true  },
    { id:"domicile", label:"Justificatif de domicile",     icon:"🏠", required:true  },
    { id:"rib",      label:"RIB / IBAN",                   icon:"💳", required:true  },
    { id:"rc_pro",   label:"Attestation RC Pro",           icon:"🛡️", required:true  },
    { id:"diplomes", label:"Diplômes & Certifications",    icon:"🎓", required:false },
  ];

  const [userId, setUserId]   = useState(null);
  const [dbDocs, setDbDocs]   = useState([]);  // [{type, storage_path, created_at}]
  const [uploading, setUploading] = useState(null);
  const [uploadOk, setUploadOk]   = useState(null);
  const fileRefs = useRef({});

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      const u = data?.user; if(!u) return;
      setUserId(u.id);
      const { data: rows } = await supabase.from("documents").select("type,storage_path,created_at").eq("prestataire_id", u.id);
      setDbDocs(rows || []);
    });
  }, []);

  const handleUpload = async (docId) => {
    const input = fileRefs.current[docId];
    if(!input) return;
    input.click();
  };

  const handleFileChange = async (docId, e) => {
    const file = e.target.files?.[0]; if(!file||!userId) return;
    const allowedImages = ["image/jpeg","image/png","image/webp"];
    const allowedAll = ["application/pdf",...allowedImages];
    const allowed = docId === "photo" ? allowedImages : allowedAll;
    if(!allowed.includes(file.type)){ alert(docId==="photo" ? "Format invalide. Utilisez JPG ou PNG." : "Format invalide. Utilisez PDF, JPG ou PNG."); e.target.value=""; return; }
    setUploading(docId); setUploadOk(null);
    const ext = file.name.split(".").pop();
    const path = `${userId}/${docId}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("documents").upload(path, file, { upsert:true });
    if(!error) {
      await supabase.from("documents").upsert({ prestataire_id:userId, type:docId, storage_path:path, created_at:new Date().toISOString() });
      setDbDocs(prev => { const filtered = prev.filter(d=>d.type!==docId); return [...filtered, { type:docId, storage_path:path, created_at:new Date().toISOString() }]; });
      setUploadOk(docId);
      setTimeout(()=>setUploadOk(null), 3000);
    }
    setUploading(null);
    e.target.value = "";
  };

  const docs = DOC_DEFS.map(def => {
    const saved = dbDocs.find(d=>d.type===def.id);
    return {
      ...def,
      status: saved ? "valid" : "missing",
      info:   saved ? `Envoyé le ${new Date(saved.created_at).toLocaleDateString("fr-FR")}` : (def.required ? "Document requis" : "Recommandé"),
    };
  });

  const statusColors = { valid:C.success, missing:C.accent };
  const statusLabels = { valid:"✓ Envoyé", missing:"Manquant" };

  const handleUploadLegacy = (id) => handleUpload(id);

  const valid   = docs.filter(d=>d.status==="valid").length;
  const total   = docs.length;
  const pct     = Math.round((valid/total)*100);

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg,#0A1628,#0D1B3E)`, paddingBottom:40 }}>
      <div style={{ background:"linear-gradient(135deg,#0A1628,#162547)", borderBottom:`1px solid ${C.border}`, padding:"52px 22px 24px" }}>
        <button onClick={onBack} style={{ background:"transparent", border:"none", color:C.textSub, cursor:"pointer", fontSize:13, marginBottom:14 }}>← Retour</button>
        <h2 style={{ color:C.text, fontSize:22, fontWeight:700, margin:0, fontFamily:font.display }}>Mes documents</h2>
        <p style={{ color:C.textSub, fontSize:13, margin:"6px 0 0" }}>Maintenez vos documents à jour pour rester actif</p>
      </div>

      <div style={{ padding:"20px 18px" }}>
        {/* Progression */}
        <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"16px", marginBottom:16 }}>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:10 }}>
            <span style={{ fontWeight:700, color:C.text, fontSize:14 }}>Dossier complet</span>
            <span style={{ fontWeight:800, color: pct===100?C.success:C.accentGold, fontSize:14 }}>{pct}%</span>
          </div>
          <div style={{ height:6, background:C.bgSurface, borderRadius:3, overflow:"hidden" }}>
            <div style={{ height:"100%", width:`${pct}%`, background:`linear-gradient(90deg,${C.violet},${C.success})`, borderRadius:3, transition:"width 0.5s" }} />
          </div>
          <p style={{ color:C.textMuted, fontSize:11, marginTop:8 }}>{valid}/{total} documents validés</p>
        </div>

        {/* Inputs fichiers cachés */}
        {DOC_DEFS.map(def => (
          <input key={def.id} type="file" accept={def.accept || ".pdf,.jpg,.jpeg,.png"} ref={el=>fileRefs.current[def.id]=el}
            onChange={e=>handleFileChange(def.id,e)} style={{ display:"none" }} />
        ))}

        {/* Liste documents */}
        {docs.map((d,i) => (
          <div key={d.id} style={{ background:"#0D1B3E", border:`1px solid ${d.status==="valid" ? C.border : statusColors[d.status]+"40"}`, borderRadius:r, padding:"14px 15px", marginBottom:10, display:"flex", gap:12, alignItems:"center" }}>
            <div style={{ width:42, height:42, borderRadius:12, background:`${statusColors[d.status]}18`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>{d.icon}</div>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:600, color:C.text, fontSize:13, marginBottom:2 }}>{d.label}</div>
              <div style={{ color:C.textMuted, fontSize:11 }}>{d.info}</div>
            </div>
            <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:6 }}>
              <Badge color={statusColors[d.status]} small>{uploadOk===d.id?"✅ Envoyé !":statusLabels[d.status]}</Badge>
              <button onClick={()=>handleUploadLegacy(d.id)} disabled={uploading===d.id}
                style={{ background:d.status==="valid"?"rgba(255,255,255,0.08)":C.violet, border:"none", borderRadius:8, padding:"5px 12px", color:C.white, fontSize:11, fontWeight:700, cursor:"pointer", fontFamily:"inherit", opacity:uploading===d.id?0.6:1 }}>
                {uploading===d.id?"⏳…":d.status==="valid"?"🔄 Remplacer":"📤 Charger"}
              </button>
            </div>
          </div>
        ))}

        <div style={{ background:`${C.violet}12`, border:`1px solid ${C.violet}30`, borderRadius:r, padding:"12px 14px", marginTop:8, fontSize:12, color:C.textSub, lineHeight:1.6 }}>
          💡 Les documents sont vérifiés par notre équipe sous <strong style={{ color:C.text }}>24h ouvrées</strong>. Formats acceptés : PDF, JPG, PNG.
        </div>
      </div>
    </div>
  );
}

export function ClientProDocScreen({ onBack }) {
  const DOC_DEFS = DOCS_REQUIS_CLIENT_PRO;

  const [userId, setUserId]   = useState(null);
  const [dbDocs, setDbDocs]   = useState([]);
  const [uploading, setUploading] = useState(null);
  const [uploadOk, setUploadOk]   = useState(null);
  const fileRefs = useRef({});

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      const u = data?.user; if(!u) return;
      setUserId(u.id);
      const { data: rows } = await supabase.from("documents").select("type,storage_path,created_at").eq("prestataire_id", u.id);
      setDbDocs(rows || []);
    });
  }, []);

  const handleUpload = (docId) => { const input = fileRefs.current[docId]; if(input) input.click(); };

  const handleFileChange = async (docId, e) => {
    const file = e.target.files?.[0]; if(!file||!userId) return;
    const allowedAll = ["application/pdf","image/jpeg","image/png","image/webp"];
    if(!allowedAll.includes(file.type)){ alert("Format invalide. Utilisez PDF, JPG ou PNG."); e.target.value=""; return; }
    setUploading(docId); setUploadOk(null);
    const ext = file.name.split(".").pop();
    const path = `${userId}/${docId}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("documents").upload(path, file, { upsert:true });
    if(!error) {
      await supabase.from("documents").upsert({ prestataire_id:userId, type:docId, storage_path:path, created_at:new Date().toISOString() });
      setDbDocs(prev => [...prev.filter(d=>d.type!==docId), { type:docId, storage_path:path, created_at:new Date().toISOString() }]);
      setUploadOk(docId);
      setTimeout(()=>setUploadOk(null), 3000);
    }
    setUploading(null);
    e.target.value = "";
  };

  const docs = DOC_DEFS.map(def => {
    const saved = dbDocs.find(d=>d.type===def.id);
    return { ...def, status:saved?"valid":"missing", info:saved?`Envoyé le ${new Date(saved.created_at).toLocaleDateString("fr-FR")}`:def.info };
  });

  const valid = docs.filter(d=>d.status==="valid").length;
  const pct   = Math.round((valid/docs.length)*100);

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg,#0A1628,#0D1B3E)`, paddingBottom:40 }}>
      <div style={{ background:"linear-gradient(135deg,#0A1628,#162547)", borderBottom:`1px solid ${C.border}`, padding:"52px 22px 24px" }}>
        <button onClick={onBack} style={{ background:"transparent", border:"none", color:C.textSub, cursor:"pointer", fontSize:13, marginBottom:14 }}>← Retour</button>
        <h2 style={{ color:C.text, fontSize:22, fontWeight:700, margin:0, fontFamily:font.display }}>Documents entreprise</h2>
        <p style={{ color:C.textSub, fontSize:13, margin:"6px 0 0" }}>Documents requis pour les clients professionnels</p>
      </div>

      <div style={{ padding:"20px 18px" }}>
        <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"16px", marginBottom:16 }}>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:10 }}>
            <span style={{ fontWeight:700, color:C.text, fontSize:14 }}>Dossier complet</span>
            <span style={{ fontWeight:800, color:pct===100?C.success:C.accentGold, fontSize:14 }}>{pct}%</span>
          </div>
          <div style={{ height:6, background:C.bgSurface||"#162547", borderRadius:3, overflow:"hidden" }}>
            <div style={{ height:"100%", width:`${pct}%`, background:`linear-gradient(90deg,${C.violet},${C.success})`, borderRadius:3, transition:"width 0.5s" }} />
          </div>
          <p style={{ color:C.textMuted, fontSize:11, marginTop:8 }}>{valid}/{docs.length} documents fournis</p>
        </div>

        {DOC_DEFS.map(def => (
          <input key={def.id} type="file" accept=".pdf,.jpg,.jpeg,.png" ref={el=>fileRefs.current[def.id]=el}
            onChange={e=>handleFileChange(def.id,e)} style={{ display:"none" }} />
        ))}

        {docs.map(d => (
          <div key={d.id} style={{ background:"#0D1B3E", border:`1px solid ${d.status==="valid"?C.border:"#F0B42940"}`, borderRadius:r, padding:"14px 15px", marginBottom:10, display:"flex", gap:12, alignItems:"center" }}>
            <div style={{ width:42, height:42, borderRadius:12, background:d.status==="valid"?"rgba(34,197,94,0.15)":"rgba(240,180,41,0.12)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>{d.icon}</div>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:600, color:C.text, fontSize:13, marginBottom:2 }}>{d.label}</div>
              <div style={{ color:C.textMuted, fontSize:11 }}>{d.info}</div>
            </div>
            <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:6 }}>
              <Badge color={d.status==="valid"?C.success:C.accentGold} small>{uploadOk===d.id?"✅ Envoyé !":d.status==="valid"?"✓ Envoyé":"Manquant"}</Badge>
              <button onClick={()=>handleUpload(d.id)} disabled={uploading===d.id}
                style={{ background:d.status==="valid"?"rgba(255,255,255,0.08)":C.violet, border:"none", borderRadius:8, padding:"5px 12px", color:C.white, fontSize:11, fontWeight:700, cursor:"pointer", fontFamily:"inherit", opacity:uploading===d.id?0.6:1 }}>
                {uploading===d.id?"⏳…":d.status==="valid"?"🔄 Remplacer":"📤 Charger"}
              </button>
            </div>
          </div>
        ))}

        <div style={{ background:`${C.violet}12`, border:`1px solid ${C.violet}30`, borderRadius:r, padding:"12px 14px", marginTop:8, fontSize:12, color:C.textSub, lineHeight:1.6 }}>
          💡 Les documents sont vérifiés par notre équipe sous <strong style={{ color:C.text }}>24h ouvrées</strong>. Formats acceptés : PDF, JPG, PNG.
        </div>
      </div>
    </div>
  );
}

export function AbonnementPrestaScreen({ onBack }) {
  const [current,setCurrent]=useState("free");
  const [billing,setBilling]=useState("monthly");
  const [saving,setSaving]=useState(false);
  const [loaded,setLoaded]=useState(false);
  const [missionsUsed,setMissionsUsed]=useState(0);
  const [pendingPlan,setPendingPlan]=useState(null);
  const [endDate,setEndDate]=useState(null);
  const [planLimits,setPlanLimits]=useState(null);
  const [subPrices,setSubPrices]=useState(null);
  const [launchActive,setLaunchActive]=useState(isLaunchPhase());

  useEffect(()=>{
    supabase.auth.getUser().then(async ({data})=>{
      const u=data?.user; if(!u) return;
      setCurrent(u.user_metadata?.plan_abonnement||"free");
      setEndDate(u.user_metadata?.subscription_end_date||null);
      setLoaded(true);
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      supabase.from("missions").select("id",{count:"exact",head:true})
        .eq("prestataire_id",u.id).gte("created_at",startOfMonth)
        .then(({count})=>{ if(count!=null) setMissionsUsed(count); });
    });
    supabase.from("platform_settings").select("value").eq("key","plan_limits").single()
      .then(({data})=>{ if(data?.value) setPlanLimits(data.value); });
    supabase.from("platform_settings").select("value").eq("key","subscription_prices").single()
      .then(({data})=>{ if(data?.value) setSubPrices(data.value); });
    supabase.from("platform_settings").select("value").eq("key","launch_phase").single()
      .then(({data})=>{ if(data?.value != null) setLaunchActive(Boolean(data.value)); });
  },[]);

  const effectivePlans = ABONNEMENTS_PRESTA.map(p => {
    const limit = planLimits?.[p.id];
    const monthlyPrice = subPrices?.[p.id]?.monthly;
    const features = [...p.features];
    if (limit != null) {
      if (p.id === "elite") {
        features[0] = limit >= 999 ? "Prestations illimitées" : `${limit} prestations/mois`;
      } else {
        const launchSuffix = p.id === "free" && launchActive ? " (10 pendant le lancement)" : "";
        features[0] = `${limit} prestation${limit > 1 ? "s" : ""}/mois${launchSuffix}`;
      }
    }
    return {
      ...p,
      ...(limit != null ? { prestations: limit } : {}),
      ...(monthlyPrice != null ? { price: monthlyPrice } : {}),
      features,
    };
  });

  const handleChangePlan = async (planId) => {
    if(planId === current) return;
    const plan = effectivePlans.find(p=>p.id===planId);
    if(plan?.price === 0) {
      // Downgrade to free: direct update
      await supabase.auth.updateUser({ data: { plan_abonnement: planId, subscription_end_date: null } });
      setCurrent(planId);
      return;
    }
    setPendingPlan(planId);
  };
  const confirmChangePlan = async () => {
    if(!pendingPlan) return;
    setSaving(true);
    try {
      const { data:sd } = await supabase.auth.getSession();
      const token = sd?.session?.access_token;
      const r = await fetch("/api/stripe-subscription", {
        method:"POST",
        headers:{ "Content-Type":"application/json", ...(token?{"Authorization":`Bearer ${token}`}:{}) },
        body: JSON.stringify({ plan: pendingPlan, billing }),
      });
      const d = await r.json();
      if(d.url) {
        window.location.href = d.url;
        return;
      }
      // Fallback if Stripe prices not configured
      alert(d.error || "Erreur Stripe");
    } catch(e) {
      alert("Erreur lors de la redirection vers Stripe");
    }
    setSaving(false);
    setPendingPlan(null);
  };

  return (
    <div style={{ minHeight:"100%", background:C.bg, paddingBottom:40 }}>
      {pendingPlan && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", zIndex:200, display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
          <div style={{ background:"#0D1B3E", borderRadius:20, padding:28, maxWidth:320, width:"100%", textAlign:"center" }}>
            <div style={{ fontSize:36, marginBottom:12 }}>🔄</div>
            <div style={{ fontWeight:800, color:C.text, fontSize:16, marginBottom:8 }}>Changer de plan ?</div>
            <div style={{ color:C.textSub, fontSize:13, marginBottom:20 }}>Passer au plan <strong style={{ color:C.violet }}>{effectivePlans.find(p=>p.id===pendingPlan)?.label}</strong> ?</div>
            <div style={{ display:"flex", gap:10 }}>
              <button onClick={()=>setPendingPlan(null)} style={{ flex:1, padding:"12px", borderRadius:12, border:`1px solid ${C.border}`, background:"transparent", color:C.textSub, cursor:"pointer", fontFamily:"inherit", fontWeight:600 }}>Annuler</button>
              <Btn onClick={confirmChangePlan} disabled={saving} style={{ flex:2 }}>{saving?"…":"Confirmer"}</Btn>
            </div>
          </div>
        </div>
      )}
      <div style={{ background:`linear-gradient(135deg,#0A1628,#162547)`, borderBottom:`1px solid ${C.border}`, padding:"52px 22px 24px" }}>
        <button onClick={onBack} style={{ background:"transparent", border:"none", color:C.textSub, cursor:"pointer", fontSize:13, marginBottom:14 }}>← Retour</button>
        <h2 style={{ color:C.text, fontSize:22, fontWeight:700, margin:"0 0 4px", fontFamily:font.display }}>Mon abonnement</h2>
        <p style={{ color:C.textSub, fontSize:13, margin:0 }}>Tarif transparent · prix affiché = prix réel</p>
        {endDate && current !== "free" && (
          <div style={{ marginTop:10, display:"inline-flex", alignItems:"center", gap:6, background: new Date(endDate)<new Date() ? "rgba(242,94,94,0.15)" : "rgba(76,201,155,0.12)", border:`1px solid ${new Date(endDate)<new Date()?"#F25E5E44":"#4CC99B44"}`, borderRadius:8, padding:"5px 12px" }}>
            <span style={{ fontSize:11, color: new Date(endDate)<new Date() ? "#F25E5E" : C.success, fontWeight:600 }}>
              {new Date(endDate)<new Date() ? "⚠️ Expiré le " : "✓ Valide jusqu'au "}
              {new Date(endDate).toLocaleDateString("fr-FR",{day:"2-digit",month:"long",year:"numeric"})}
            </span>
          </div>
        )}
      </div>
      <div style={{ padding:"20px 18px" }}>
        {launchActive && (
          <div style={{ background:`${C.violet}18`, border:`1px solid ${C.violet}50`, borderRadius:r, padding:"13px 15px", marginBottom:20 }}>
            <div style={{ display:"flex", gap:10, alignItems:"flex-start" }}>
              <span style={{ fontSize:20 }}>🚀</span>
              <div>
                <div style={{ fontWeight:700, color:C.violetLight, fontSize:13 }}>Offre de lancement exclusive</div>
                <div style={{ color:C.textSub, fontSize:12, marginTop:3, lineHeight:1.5 }}>Les <strong style={{ color:C.white }}>100 premiers prestataires inscrits</strong> bénéficient de <strong style={{ color:C.accentGold }}>10 prestations/mois gratuites</strong>.<br/>Plan Gratuit : 2 prestations/mois ensuite pour tous.</div>
              </div>
            </div>
          </div>
        )}
        <div style={{ display:"flex", justifyContent:"center", marginBottom:18 }}>
          <div style={{ display:"flex", background:"rgba(255,255,255,0.05)", borderRadius:12, padding:4 }}>
            {[{id:"monthly",label:"Mensuel"},{id:"yearly",label:"Annuel -20%"}].map(b=>(
              <button key={b.id} onClick={()=>setBilling(b.id)} style={{ padding:"9px 18px", border:"none", borderRadius:10, cursor:"pointer", fontFamily:"inherit", fontSize:13, fontWeight:billing===b.id?700:500, background:billing===b.id?C.violet:"transparent", color:billing===b.id?C.white:C.textSub }}>
                {b.label}
              </button>
            ))}
          </div>
        </div>
        {effectivePlans.map(plan=>{
          const price=billing==="yearly"?Math.round(plan.price*0.8):plan.price;
          const active=current===plan.id;
          return (
            <div key={plan.id} style={{ background:active?plan.color+"15":"#0D1B3E", border:`2px solid ${active?plan.color:C.border}`, borderRadius:r+4, padding:"16px", marginBottom:12, position:"relative" }}>
              {plan.popular&&<div style={{ position:"absolute", top:12, right:12, background:plan.color, borderRadius:8, padding:"3px 10px", color:"#fff", fontSize:11, fontWeight:700 }}>Populaire</div>}
              <div style={{ display:"flex", gap:12, alignItems:"center", marginBottom:10 }}>
                <div style={{ width:42, height:42, borderRadius:12, background:plan.color+"20", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20 }}>{plan.icon}</div>
                <div>
                  <div style={{ fontWeight:700, color:C.text, fontSize:15 }}>{plan.label}</div>
                  <div style={{ fontWeight:800, color:plan.color, fontSize:20 }}>{price===0?"Gratuit":price+" €"}{price>0&&<span style={{ fontSize:12, color:C.textSub, fontWeight:400 }}>/mois</span>}</div>
                </div>
              </div>
              {plan.features.map((f,i)=>(
                <div key={i} style={{ display:"flex", gap:8, padding:"3px 0" }}>
                  <span style={{ color:plan.color, fontSize:13 }}>✓</span>
                  <span style={{ color:C.text, fontSize:12 }}>{f}</span>
                </div>
              ))}
              {plan.note && <p style={{ color:C.textMuted, fontSize:10, margin:"8px 0 0", lineHeight:1.5, fontStyle:"italic" }}>{plan.note}</p>}
              {price > 0 && (
                <div style={{ marginTop:10, background:plan.color+"10", border:`1px solid ${plan.color}30`, borderRadius:10, padding:"9px 12px" }}>
                  <div style={{ fontSize:11, color:C.textSub, marginBottom:4 }}>💡 Rentabilité estimée</div>
                  <div style={{ fontSize:12, color:C.text, lineHeight:1.6 }}>
                    Abonnement couvert dès <strong style={{ color:plan.color }}>la 1ère prestation</strong><br/>
                    <span style={{ color:C.textSub, fontSize:11 }}>
                      {plan.id==="premium"
                        ? `1 prestation ≈ 96€ net · Abonnement = ${price}€ · Bénéfice net dès prestation 1 : +${96-price}€`
                        : `1 prestation ≈ 96€ net · Abonnement = ${price}€ · Bénéfice net dès prestation 1 : +${96-price}€ · Position #1 + Manager dédié`
                      }
                    </span>
                  </div>
                </div>
              )}
              {plan.missions < 999 && active && (
                <div style={{ marginTop:8 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:C.textSub, marginBottom:4 }}>
                    <span>Prestations ce mois</span>
                    <span style={{ color: missionsUsed >= plan.missions ? C.danger : C.success }}>{missionsUsed} / {plan.missions}</span>
                  </div>
                  <div style={{ background:"rgba(255,255,255,0.08)", borderRadius:99, height:4 }}>
                    <div style={{ width:`${Math.min(100,(missionsUsed/plan.missions)*100)}%`, height:"100%", background: missionsUsed >= plan.missions ? C.danger : C.success, borderRadius:99, transition:"width 0.5s" }} />
                  </div>
                </div>
              )}
              <button onClick={()=>handleChangePlan(plan.id)} disabled={saving} style={{ width:"100%", padding:"11px", border:"none", borderRadius:r, cursor:saving?"not-allowed":"pointer", fontFamily:"inherit", fontWeight:700, fontSize:13, marginTop:12, background:active?plan.color+"30":plan.price===0?C.bgSurface:`linear-gradient(135deg,${plan.color},${plan.color}cc)`, color:active?plan.color:plan.price===0?C.textSub:"#fff", opacity:saving?0.7:1 }}>
                {active?"✓ Plan actuel":plan.price===0?"Utiliser gratuitement":"Choisir "+plan.label}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function MissionRequestScreen({ sector, onSubmit, onBack }) {
  const s = sector || {};
  const preselectedJob = s._preselectedJob || null;
  const jobs = METIERS[s.id] || [];
  const [metier, setMetier]       = useState(preselectedJob || "");
  const [metierSearch, setMetierSearch] = useState(preselectedJob || "");
  const [date, setDate]           = useState("");
  const [startTime, setStartTime] = useState("08:00");
  const [hours, setHours]         = useState(8);
  const [description, setDesc]    = useState("");
  const [adresse, setAdresse]     = useState("");
  const [ville, setVille]         = useState("");
  const [recurrence, setRecurrence] = useState(null);
  const [sending, setSending]     = useState(false);
  const isValid = date && adresse && ville;
  const { providers:allProviders } = useProviders();
  const matchCount = allProviders.filter(p => p.sector===s.id && (!metier || p.jobTitle===metier) && p.available).length;

  const handleSend = async () => {
    setSending(true);
    const prestation = { sector:s, metier, date, hours, description, adresse, ville, recurrence };
    try {
      const { data:_ud2 } = await supabase.auth.getUser();
      const user = _ud2?.user;
      if(user){
        const { data } = await supabase.from("missions").insert({
          client_id: user.id, sector: s.id, metier, date, hours,
          ville, adresse, description, status: "open",
          heure_debut: startTime || null,
          recurrence: recurrence || null,
        }).select().single();
        if(data) prestation.id = data.id;
      }
    } catch(e){ console.error("prestation insert error", e); }
    setSending(false);
    onSubmit(prestation);
  };

  return (
    <div style={{ minHeight:"100%", background:C.bg, paddingBottom:100 }}>
      <div style={{ background:`linear-gradient(135deg,#0A1628,#162547)`, padding:"52px 22px 24px", borderBottom:`1px solid ${C.border}` }}>
        <button onClick={onBack} style={{ background:"transparent", border:"none", color:C.textSub, cursor:"pointer", fontSize:13, marginBottom:14 }}>← Retour</button>
        <div style={{ fontSize:32, marginBottom:6 }}>{s.icon||"📢"}</div>
        <h2 style={{ color:C.text, fontSize:20, fontWeight:800, margin:"0 0 4px", fontFamily:font.display }}>Commander une prestation</h2>
        <p style={{ color:C.textSub, fontSize:13, margin:0 }}>{s.label}{preselectedJob ? ` · ${preselectedJob}` : ""} · {matchCount} prestataire{matchCount>1?"s":""} disponible{matchCount>1?"s":""}</p>
      </div>

      <div style={{ padding:"20px 18px" }}>
        <div style={{ background:`${C.violet}12`, border:`1px solid ${C.violet}30`, borderRadius:r, padding:"13px 15px", marginBottom:20, display:"flex", gap:10, alignItems:"flex-start" }}>
          <span style={{ fontSize:18, flexShrink:0 }}>📢</span>
          <div>
            <div style={{ fontWeight:700, color:C.text, fontSize:13 }}>Diffusion à tous les prestataires disponibles</div>
            <div style={{ color:C.textSub, fontSize:11, marginTop:2, lineHeight:1.5 }}>Votre demande est envoyée à tous les prestataires du secteur. Vous choisissez parmi ceux qui acceptent.</div>
          </div>
        </div>

        {jobs.length > 0 && (
          <div style={{ marginBottom:16 }}>
            <label style={{ display:"block", fontSize:11, color:C.textSub, marginBottom:7, fontWeight:600, letterSpacing:0.8, textTransform:"uppercase" }}>Métier recherché</label>
            {preselectedJob ? (
              <div style={{ background:`${C.violet}15`, border:`1.5px solid ${C.violet}55`, borderRadius:r, padding:"12px 14px", display:"flex", alignItems:"center", gap:10 }}>
                <span style={{ fontSize:16 }}>✓</span>
                <span style={{ fontWeight:700, color:C.text, fontSize:14 }}>{preselectedJob}</span>
                <span style={{ color:C.textSub, fontSize:12, marginLeft:"auto" }}>Pré-sélectionné</span>
              </div>
            ) : (
              <>
                <div style={{ position:"relative" }}>
                  <span style={{ position:"absolute", left:13, top:"50%", transform:"translateY(-50%)", fontSize:15, opacity:0.5 }}>🔍</span>
                  <input type="text" placeholder="Tapez pour filtrer…" value={metierSearch||""} onChange={e=>{ setMetierSearch(e.target.value); if(!e.target.value) setMetier(""); }}
                    style={{ width:"100%", padding:"11px 14px 11px 40px", borderRadius:r, border:`1px solid ${C.border}`, fontSize:14, fontFamily:"inherit", color:C.text, background:"#112240", outline:"none", boxSizing:"border-box", marginBottom:metierSearch&&jobs.filter(j=>j.toLowerCase().includes(metierSearch.toLowerCase())).length>0?0:undefined }} />
                </div>
                {metierSearch && jobs.filter(j=>j.toLowerCase().includes(metierSearch.toLowerCase())).length > 0 && (
                  <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, overflow:"hidden", boxShadow:"0 4px 16px rgba(0,0,0,0.3)", marginTop:2, maxHeight:200, overflowY:"auto", WebkitOverflowScrolling:"touch" }}>
                    {jobs.filter(j=>j.toLowerCase().includes(metierSearch.toLowerCase())).map((j,i,arr)=>(
                      <button key={i} onMouseDown={()=>{ setMetier(j); setMetierSearch(j); }}
                        style={{ width:"100%", padding:"10px 14px", background:"transparent", border:"none", borderBottom:i<arr.length-1?`1px solid ${C.border}`:"none", color:C.text, fontSize:13, textAlign:"left", cursor:"pointer", fontFamily:"inherit" }}>
                        {j}
                      </button>
                    ))}
                  </div>
                )}
                {metier && <p style={{ fontSize:11, color:C.violet, margin:"5px 0 0 2px", fontWeight:600 }}>✓ {metier}</p>}
              </>
            )}
          </div>
        )}

        <Input label="Date de la prestation *" type="date" placeholder="AAAA-MM-JJ" value={date} onChange={e=>setDate(e.target.value)} />
        <Input label="Heure de début *" type="time" placeholder="HH:MM" value={startTime} onChange={e=>setStartTime(e.target.value)} />

        <div style={{ marginBottom:16 }}>
          <label style={{ display:"block", fontSize:12, color:C.textSub, fontWeight:600, marginBottom:8 }}>Durée estimée : <strong style={{ color:C.text }}>{hours}h</strong></label>
          <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
            {[4,6,8,10,12].map(h=>(
              <button key={h} onClick={()=>setHours(h)} style={{ padding:"9px 18px", borderRadius:20, border:"none", cursor:"pointer", background:hours===h?C.violet:C.grayLight, color:hours===h?C.white:C.text, fontWeight:700, fontSize:13, fontFamily:"inherit" }}>{h}h</button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom:16 }}>
          <label style={{ display:"block", fontSize:12, color:C.textSub, fontWeight:600, marginBottom:8 }}>Récurrence <span style={{ fontWeight:400 }}>(optionnel)</span></label>
          <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
            {[
              { value: null, label: "Unique" },
              { value: "weekly", label: "Hebdomadaire" },
              { value: "biweekly", label: "Bi-mensuelle" },
              { value: "monthly", label: "Mensuelle" },
            ].map(opt => (
              <button key={String(opt.value)} onClick={() => setRecurrence(opt.value)}
                style={{ padding:"9px 18px", borderRadius:20, border:"none", cursor:"pointer", background:recurrence===opt.value?C.violet:C.grayLight, color:recurrence===opt.value?C.white:C.text, fontWeight:700, fontSize:13, fontFamily:"inherit" }}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <AddressAutocomplete label="Adresse de la prestation *" value={adresse} onChange={v=>setAdresse(v)} onSelect={s=>{setAdresse(s.rue);setVille(s.ville);}} />
        <Input label="Ville *" placeholder="Paris" value={ville} onChange={e=>setVille(e.target.value)} />

        <div style={{ marginBottom:20 }}>
          <label style={{ display:"block", fontSize:12, color:C.textSub, fontWeight:600, marginBottom:6 }}>Description de la prestation <span style={{ fontWeight:400 }}>(optionnel)</span></label>
          <textarea placeholder="Tâches attendues, matériel fourni, accès, consignes…" value={description} onChange={e=>setDesc(e.target.value)}
            style={{ width:"100%", padding:"13px", borderRadius:12, border:`1px solid ${C.border}`, fontSize:14, fontFamily:"inherit", resize:"none", height:90, boxSizing:"border-box", outline:"none", color:C.text, background:"#0D1B3E" }} />
        </div>

        <Btn full disabled={!isValid||sending} onClick={handleSend} style={{ fontSize:16, padding:"17px" }}>
          {sending ? "Envoi…" : "📢 Envoyer aux prestataires →"}
        </Btn>
      </div>
    </div>
  );
}

export function MissionBroadcastScreen({ prestation, onChoose, onCancel }) {
  const m = prestation || {};
  const { providers } = useProviders();
  const [notifiedCount, setNotifiedCount] = useState(0);
  const [candidatures, setCandidatures]   = useState([]);
  const [broadcasted, setBroadcasted]     = useState(false);
  const [loading, setLoading]             = useState(true);

  // Spinner CSS
  useEffect(()=>{
    const style = document.getElementById("alane-spin-style");
    if(!style){
      const s=document.createElement("style");
      s.id="alane-spin-style";
      s.textContent="@keyframes alaneSpin{to{transform:rotate(360deg)}}";
      document.head.appendChild(s);
    }
  },[]);

  // Broadcast real notifications on mount
  useEffect(()=>{
    if(!m.id || broadcasted) return;
    setBroadcasted(true);
    supabase.auth.getSession().then(({ data:sd }) => {
      const token = sd?.session?.access_token;
      fetch("/api/prestations", {
        method:"POST",
        headers:{ "Content-Type":"application/json", ...(token?{"Authorization":`Bearer ${token}`}:{}) },
        body: JSON.stringify({ action:"broadcast", mission_id:m.id, sector:m.sector?.id||m.sector }),
      })
      .then(r=>r.json())
      .then(d=>{ if(d.notified) setNotifiedCount(d.notified); })
      .catch(()=>{});
    });
  },[m.id]);

  // Poll real candidatures every 5s
  useEffect(()=>{
    if(!m.id) return;
    const poll = async () => {
      const { data } = await supabase.from("candidatures")
        .select("id,prestataire_id,status,created_at")
        .eq("mission_id", m.id)
        .eq("status","pending");
      if(Array.isArray(data)){
        // Enrich with provider info from providers list
        const enriched = data.map(c => {
          const prov = providers.find(p=>p.id===c.prestataire_id);
          return prov ? { provider:prov, candidature_id:c.id } : null;
        }).filter(Boolean);
        setCandidatures(enriched);
      }
      setLoading(false);
    };
    poll();
    const iv = setInterval(poll, 5000);
    return ()=>clearInterval(iv);
  },[m.id, providers]);

  const accepted = candidatures;
  const waiting  = Math.max(0, notifiedCount - accepted.length);
  const tarifLabel = p => formatE(p.rateNum || 0);

  return (
    <div style={{ minHeight:"100%", background:C.bg, paddingBottom:100 }}>
      <style>{`@keyframes alaneSpin{to{transform:rotate(360deg)}}`}</style>

      {/* Header */}
      <div style={{ background:`linear-gradient(135deg,#0A1628,#162547)`, padding:"52px 22px 20px", borderBottom:`1px solid ${C.border}` }}>
        <button onClick={onCancel} style={{ background:"transparent", border:"none", color:C.textSub, cursor:"pointer", fontSize:13, marginBottom:14 }}>← Annuler la demande</button>
        <h2 style={{ color:C.text, fontSize:20, fontWeight:800, margin:"0 0 4px", fontFamily:font.display }}>📢 Demande diffusée</h2>
        <p style={{ color:C.textSub, fontSize:12, margin:0 }}>
          {m.sector?.label}{m.metier?" · "+m.metier:""} · {m.date}{m.heure_debut ? ` · ${m.heure_debut}${(() => { const [h,min] = m.heure_debut.split(":").map(Number); const e = h*60+min+Math.round(Number(m.hours)*60); return ` – ${String(Math.floor(e/60)%24).padStart(2,"0")}:${String(e%60).padStart(2,"0")}`; })()}` : ` · ${m.hours}h`} · {m.ville}
        </p>
      </div>

      <div style={{ padding:"20px 18px" }}>
        {/* Compteurs */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, marginBottom:18 }}>
          {[
            { label:"Notifiés",   value:notifiedCount,   color:C.violet   },
            { label:"Candidats",  value:accepted.length, color:C.success  },
            { label:"En attente", value:waiting,         color:C.textSub  },
          ].map(s=>(
            <div key={s.label} style={{ background:"#0D1B3E", borderRadius:12, padding:"12px 8px", textAlign:"center", border:`1px solid ${s.color}33` }}>
              <div style={{ fontWeight:800, color:s.color, fontSize:20 }}>{s.value}</div>
              <div style={{ color:C.textSub, fontSize:9, marginTop:2 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Indicateur attente */}
        {waiting > 0 && (
          <div style={{ background:"#0D1B3E", borderRadius:r, padding:"14px 16px", marginBottom:16, display:"flex", gap:12, alignItems:"center", border:`1px solid ${C.border}` }}>
            <div style={{ width:32, height:32, borderRadius:"50%", border:`3px solid ${C.violet}`, borderTopColor:"transparent", animation:"alaneSpin 0.9s linear infinite", flexShrink:0 }} />
            <div>
              <div style={{ fontWeight:700, color:C.text, fontSize:13 }}>{loading ? "Diffusion en cours…" : `En attente de réponses (${notifiedCount} notifié${notifiedCount>1?"s":""})`}</div>
              <div style={{ color:C.textSub, fontSize:11, marginTop:2 }}>Les candidatures apparaissent dès que des prestataires postulent.</div>
            </div>
          </div>
        )}

        {/* Liste des acceptants */}
        {accepted.length > 0 && (
          <>
            <div style={{ fontWeight:800, color:C.text, fontSize:14, marginBottom:12 }}>
              ✅ {accepted.length} candidature{accepted.length>1?"s":""} reçue{accepted.length>1?"s":""}
              {waiting===0 && <span style={{ fontWeight:500, color:C.textSub, fontSize:12 }}> — choisissez maintenant</span>}
            </div>
            {accepted.map(({provider:p})=>(
              <div key={p.id} style={{ background:"#0D1B3E", borderRadius:16, padding:"16px", marginBottom:10, border:`2px solid ${C.success}55`, boxShadow:"0 4px 16px rgba(0,0,0,0.4)" }}>
                <div style={{ display:"flex", gap:12, alignItems:"center", marginBottom:12 }}>
                  <div style={{ width:48, height:48, borderRadius:14, background:`${p.color}22`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:26, flexShrink:0 }}>{p.avatar}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:800, color:C.text, fontSize:15 }}>{p.name}</div>
                    <div style={{ color:C.textSub, fontSize:12 }}>{p.jobTitle}</div>
                    <div style={{ display:"flex", gap:8, marginTop:4, flexWrap:"wrap" }}>
                      <span style={{ fontSize:12, color:C.accentGold, fontWeight:700 }}>★ {p.rating}</span>
                      <span style={{ color:C.textMuted, fontSize:11 }}>·</span>
                      <span style={{ fontSize:12, color:C.textSub }}>{p.experience}</span>
                      <span style={{ color:C.textMuted, fontSize:11 }}>·</span>
                      <span style={{ fontSize:12, color:C.textSub }}>{p.distance}</span>
                    </div>
                  </div>
                  <div>
                    <div style={{ fontWeight:800, color:C.success, fontSize:16 }}>{tarifLabel(p)}</div>
                    <div style={{ color:C.textSub, fontSize:10, textAlign:"right" }}>{m.hours}h = {((p.rateNum||0)*m.hours).toFixed(2).replace(".",",")} €</div>
                  </div>
                </div>
                <div style={{ display:"flex", gap:8 }}>
                  <Btn full variant="success" onClick={()=>onChoose(p)} style={{ padding:"12px", fontSize:14 }}>
                    Choisir {p.name.split(" ")[0]} →
                  </Btn>
                </div>
              </div>
            ))}
          </>
        )}


        {/* État vide initial */}
        {accepted.length===0 && (
          <div style={{ textAlign:"center", padding:"48px 20px" }}>
            <div style={{ fontSize:52, marginBottom:16 }}>📱</div>
            <div style={{ fontWeight:700, color:C.text, fontSize:16, marginBottom:8 }}>
              {loading ? "Diffusion en cours…" : "En attente de candidatures"}
            </div>
            <div style={{ color:C.textSub, fontSize:13, lineHeight:1.7 }}>
              {notifiedCount > 0
                ? `${notifiedCount} prestataire${notifiedCount>1?"s":""} notifié${notifiedCount>1?"s":""}. Les candidatures apparaissent ici dès réception.`
                : "Envoi des notifications aux prestataires disponibles…"
              }
            </div>
          </div>
        )}

        {/* Plus personne en attente, aucun acceptant */}
        {!loading && waiting===0 && accepted.length===0 && notifiedCount > 0 && (
          <div style={{ background:`${C.accent}12`, border:`1px solid ${C.accent}30`, borderRadius:r, padding:"14px 16px", marginTop:8, textAlign:"center" }}>
            <div style={{ fontSize:32, marginBottom:8 }}>😔</div>
            <div style={{ fontWeight:700, color:C.text, fontSize:14, marginBottom:4 }}>Aucun prestataire disponible</div>
            <div style={{ color:C.textSub, fontSize:12 }}>Essayez en mode urgence ou changez de date.</div>
            <Btn onClick={onCancel} style={{ marginTop:14 }}>Modifier la demande</Btn>
          </div>
        )}
      </div>
    </div>
  );
}

export function OnboardingScreen({ role, onDone, onNavigate }) {
  const [step, setStep] = useState(0);

  const clientSteps = [
    { icon:"🔍", title:"Trouvez le bon prestataire", desc:"Parcourez notre catalogue par secteur d'activité. Filtrez par note, tarif, ville et disponibilité pour trouver exactement qui il vous faut.", color:C.violet },
    { icon:"📋", title:"Publiez votre prestation", desc:"Décrivez votre besoin en quelques clics. Les prestataires disponibles vous répondent rapidement ou vous pouvez en sélectionner un directement.", color:C.accentGold },
    { icon:"🔒", title:"Payez en toute sécurité", desc:"Votre paiement est sécurisé via Stripe. L'argent ne sera libéré qu'après validation mutuelle de la prestation. Zéro risque.", color:C.success },
    { icon:"⭐", title:"Validez et notez", desc:"Une fois la prestation terminée, validez-la pour libérer le paiement et laissez un avis pour aider la communauté.", color:"#F06292" },
    { icon:"⚖️", title:"Bien travailler avec un auto-entrepreneur", lines:["✅ Le bon réflexe : variez les prestataires selon vos besoins — c'est ce qui rend la plateforme utile.","⚠️ À éviter : utiliser le même prestataire comme seule ressource de façon répétée sur le long terme."], color:"#4FC3F7" },
  ];
  const prestaSteps = [
    { icon:"📝", title:"Complétez votre profil", desc:"Renseignez vos compétences, tarifs, disponibilités et uploadez votre CV. Un profil complet reçoit 3× plus de prestations.", color:C.violet },
    { icon:"✅", title:"Validation par notre équipe", desc:"Notre équipe vérifie votre profil sous 24-48h. Vous recevrez un email de confirmation dès que votre compte est activé.", color:C.accentGold },
    { icon:"📦", title:"Recevez des prestations", desc:"Les clients vous sélectionnent directement selon votre profil. Acceptez ou refusez chaque prestation proposée. Votre plan définit votre quota mensuel.", color:C.success },
    { icon:"💶", title:"Gérez votre agenda & revenus", desc:"Acceptez les prestations proposées, suivez vos paiements et développez votre activité sur ALANE.", color:"#4FC3F7" },
  ];

  const steps = role === "prestataire" ? prestaSteps : clientSteps;
  const s = steps[step];
  const isLast = step === steps.length - 1;

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(5,14,32,0.97)", zIndex:9999, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:28 }}>
      <div style={{ width:"100%", maxWidth:400 }}>
        <div style={{ display:"flex", justifyContent:"center", gap:8, marginBottom:40 }}>
          {steps.map((_,i)=>(
            <div key={i} style={{ width: i===step?24:8, height:8, borderRadius:4, background:i===step?s.color:"rgba(255,255,255,0.15)", transition:"all 0.3s" }} />
          ))}
        </div>
        <div style={{ textAlign:"center", marginBottom:40 }}>
          <div style={{ fontSize:72, marginBottom:20, lineHeight:1 }}>{s.icon}</div>
          <div style={{ width:56, height:4, borderRadius:2, background:s.color, margin:"0 auto 24px" }} />
          <h2 style={{ color:C.text, fontSize:24, fontWeight:800, margin:"0 0 14px", fontFamily:font.display, lineHeight:1.3 }}>{s.title}</h2>
          {s.lines ? (
            <div style={{ color:C.textSub, fontSize:14, lineHeight:1.7, maxWidth:320, marginLeft:"auto", marginRight:"auto", textAlign:"left" }}>
              {s.lines.map((l,i) => <p key={i} style={{ margin:"0 0 10px" }}>{l}</p>)}
              {isLast && (
                <button onClick={()=>{ onDone(); onNavigate?.("faq"); }} style={{ marginTop:8, background:"transparent", border:"1px solid rgba(79,195,247,0.4)", borderRadius:8, padding:"10px 14px", color:"#4FC3F7", fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"inherit", width:"100%", display:"block" }}>
                  📖 En savoir plus dans la FAQ →
                </button>
              )}
            </div>
          ) : (
            <p style={{ color:C.textSub, fontSize:15, lineHeight:1.75, margin:0, maxWidth:320, marginLeft:"auto", marginRight:"auto" }}>{s.desc}</p>
          )}
        </div>
        <div style={{ display:"flex", gap:12 }}>
          {step > 0 && (
            <button onClick={()=>setStep(s=>s-1)} style={{ flex:1, padding:"14px", borderRadius:r, border:`1px solid ${C.border}`, background:"transparent", color:C.textSub, fontSize:15, fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}>
              ← Précédent
            </button>
          )}
          <button onClick={()=>{ if(isLast) onDone(); else setStep(s=>s+1); }} style={{ flex:2, padding:"14px", borderRadius:r, border:"none", background:s.color, color:C.white, fontSize:15, fontWeight:800, cursor:"pointer", fontFamily:"inherit" }}>
            {isLast ? "C'est parti ! 🚀" : "Suivant →"}
          </button>
        </div>
        <button onClick={onDone} style={{ display:"block", margin:"16px auto 0", background:"none", border:"none", color:C.textMuted, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
          Passer le tutoriel
        </button>
      </div>
    </div>
  );
}

