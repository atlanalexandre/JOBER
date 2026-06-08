import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase.js";
import { C, font, r } from "../constants/colors.js";
import { ABONNEMENTS_PRESTA, isLaunchPhase, prixClient, formatE } from "../constants/plans.js";
import { SECTORS, METIERS, METIERS_TARIFS, COMPETENCES_PAR_SECTEUR, COMPETENCES_PAR_METIER, JOURS, PLAGES, NIVEAUX, LANGUES_LIST } from "../constants/data.js";
import { Btn, Input, IbanInput, PasswordStrength, EmailInput, Select, StepHeader, Badge, AddressAutocomplete, formatPhone, checkIban } from "./ui.jsx";

export function PrestaRegisterFlow({ onRegister, onBack, accentColor }) {
  const TOTAL = 7;
  const [step, setStep] = useState(1);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [prenom, setPrenom] = useState("");
  const [nom, setNom] = useState("");
  const [telephone, setTelephone] = useState("");
  const [metiers, setMetiers] = useState([]);
  const [newMetier, setNewMetier] = useState({sector:"", metier:"", niveau:"Confirmé", tarifNet:12, certifs:""});
  const [justAdded, setJustAdded] = useState(false);
  const [niveau, setNiveau] = useState("Confirmé");
  const [experienceAns, setExperienceAns] = useState(2);
  const [competences, setCompetences] = useState([]);
  const [langues, setLangues] = useState(["Français"]);
  const [dispos, setDispos] = useState({});
  const [dispoImmediat, setDispoImmediat] = useState(true);
  const [ribIban, setRibIban] = useState("");
  const [statutPro, setStatutPro] = useState("auto-entrepreneur");
  const [planChoisi, setPlanChoisi] = useState("free");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [rcProConfirmed, setRcProConfirmed] = useState(false);
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);
  const [cgpsAccepted, setCgpsAccepted] = useState(false);
  const [showCgpsModal, setShowCgpsModal] = useState(false);
  const [acreEnabled, setAcreEnabled] = useState(false);
  const [showAcreInfo, setShowAcreInfo] = useState(false);
  const [villeBase, setVilleBase] = useState("");
  const [rayonKm, setRayonKm] = useState(20);
  const [adresseRue, setAdresseRue] = useState("");
  const [codePostal, setCodePostal] = useState("");

  const toggleItem = (arr, setArr, item) =>
    setArr(prev => prev.includes(item) ? prev.filter(x => x !== item) : [...prev, item]);

  const validateStep = () => {
    if (step === 1) {
      if (!prenom.trim() || !nom.trim()) return "Prénom et nom obligatoires";
      if (telephone.replace(/[\s.\-]/g,"").length < 10) return "Numéro de téléphone obligatoire";
      if (!adresseRue.trim()) return "Indiquez votre adresse";
      if (!codePostal.trim() || codePostal.replace(/\s/g,"").length < 5) return "Code postal invalide";
      if (!villeBase.trim()) return "Indiquez votre ville";
    }
    if (step === 2) {
      if (metiers.length === 0) return "Ajoutez au moins un métier";
    }
    if (step === 3) { if (!niveau) return "Sélectionnez votre niveau"; }
    if (step === 4) {
      if (!Object.values(dispos).some(cr => cr?.length > 0)) return "Sélectionnez au moins un créneau";
    }
    if (step === 5) {
      if (ribIban.trim()) {
        const clean = ribIban.replace(/[\s\-]/g,"").toUpperCase();
        if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(clean)) return "Format IBAN invalide (ex: FR76 3000 4028 0000 0000 0000 000)";
      }
      if (!rcProConfirmed) return "Vous devez confirmer disposer d'une RC Pro en cours de validité";
    }
    if (step === 7) {
      if (!email || !password)  return "Email et mot de passe requis";
      if (password.length < 6)  return "Mot de passe minimum 6 caractères";
      if (!cgpsAccepted)        return "Vous devez accepter les CGPS pour créer votre compte";
    }
    return null;
  };

  const handleNext = () => {
    const err = validateStep();
    if (err) { setError(err); return; }
    setError(""); setStep(s => s + 1);
  };

  const handleSubmit = async () => {
    const err = validateStep();
    if (err) { setError(err); return; }
    setLoading(true); setError("");
    const { data, error: signUpErr } = await supabase.auth.signUp({
      email, password,
      options: { data: {
        role: "prestataire", prenom: prenom.trim(), nom: nom.trim(),
        telephone: telephone.replace(/[\s.\-]/g,""),
        adresse: adresseRue.trim(), code_postal: codePostal.trim(),
        ville: villeBase.trim(), zone_km: rayonKm,
        secteur: metiers[0]?.sector || "", metier: metiers[0]?.metier || "",
        tarif_net: metiers[0]?.tarifNet || 12, metiers_list: metiers,
        niveau, experience_ans: experienceAns, competences, langues,
        dispon_jours: JOURS.filter(j => (dispos[j]||[]).length > 0), dispon_jours_creneaux: dispos, dispo_immediat: dispoImmediat,
        statut_pro: statutPro, rib: ribIban.replace(/\s/g,"") || null,
        plan_abonnement: planChoisi,
      }},
    });
    if (signUpErr) {
      setLoading(false);
      setError(signUpErr.message.includes("already") || signUpErr.message.includes("registered")
        ? "Un compte existe déjà avec cet email. Connectez-vous à la place."
        : signUpErr.message);
      return;
    }
    if (data?.user) {
      await supabase.from("profiles").upsert({
        id: data.user.id, role: "prestataire", prenom: prenom.trim(), nom: nom.trim(), status: "pending",
      });
      await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "notify_signup", prenom: prenom.trim(), nom: nom.trim(), email, role: "prestataire" }),
      }).catch(() => {});
      await fetch("/api/welcome-email", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ email, prenom: prenom.trim(), nom: nom.trim(), role:"prestataire" }) }).catch(()=>{});
      const referrerUUID = sessionStorage.getItem("alane_referrer");
      if (referrerUUID && referrerUUID !== data.user.id) {
        await fetch("/api/support", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "track_referral", newUserId: data.user.id, referrerUUID }),
        }).catch(() => {});
        sessionStorage.removeItem("alane_referrer");
      }
      // Ne pas signOut : garder la session pour que le polling PendingApprovalScreen fonctionne
      sessionStorage.setItem("alane_session_active", "1");
    }
    setLoading(false);
    onRegister();
  };

  const addMetier = () => {
    if (!newMetier.sector || !newMetier.metier) return;
    setMetiers(prev => [...prev, {...newMetier, id: Date.now()}]);
    setNewMetier({sector:"", metier:"", niveau:"Confirmé", tarifNet:12, certifs:""});
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 1500);
  };
  const allCompListe = [...new Set((metiers).flatMap(m => COMPETENCES_PAR_METIER[m.metier] || COMPETENCES_PAR_SECTEUR[m.sector] || []))];

  const STEP_TITLES = ["Votre identité","Vos métiers","Expérience","Disponibilités","Statut & Paiement","Votre abonnement","Récapitulatif"];
  const STEP_ICONS  = ["👤","🏗️","⭐","📅","💶","⚡","✅"];

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(160deg,#050E20,#0A1628,#162547)`, display:"flex", flexDirection:"column" }}>
      {/* Header */}
      <div style={{ padding:"54px 24px 16px" }}>
        <button onClick={step===1 ? onBack : ()=>{setError("");setStep(s=>s-1)}} style={{ background:"transparent", border:"none", color:C.textSub, cursor:"pointer", fontSize:13, marginBottom:16, display:"flex", alignItems:"center", gap:6, fontFamily:"inherit" }}>
          ← {step===1 ? "Retour à la connexion" : "Étape précédente"}
        </button>
        <div style={{ display:"flex", gap:4, marginBottom:16 }}>
          {Array.from({length:TOTAL},(_,i) => (
            <div key={i} style={{ flex:1, height:3, borderRadius:2, background:i<step?accentColor:`${accentColor}25`, transition:"background 0.3s" }} />
          ))}
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:38, height:38, borderRadius:10, background:`${accentColor}20`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20 }}>{STEP_ICONS[step-1]}</div>
          <div>
            <div style={{ color:C.textMuted, fontSize:11, letterSpacing:1, textTransform:"uppercase" }}>Étape {step}/{TOTAL} — Inscription Prestataire</div>
            <div style={{ color:C.text, fontSize:18, fontWeight:700, fontFamily:font.display }}>{STEP_TITLES[step-1]}</div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex:1, padding:"8px 24px 16px", overflowY:"auto" }}>
        {error && <div style={{ background:"#F25E5E22", border:"1px solid #F25E5E55", borderRadius:r, padding:"10px 14px", marginBottom:14, color:"#F25E5E", fontSize:13 }}>{error}</div>}

        {step === 1 && <>
          <div style={{ display:"flex", gap:10 }}>
            <div style={{ flex:1 }}><Input label="Prénom *" placeholder="Jean" icon="👤" value={prenom} onChange={e=>setPrenom(e.target.value)} /></div>
            <div style={{ flex:1 }}><Input label="Nom *" placeholder="Dupont" icon="👤" value={nom} onChange={e=>setNom(e.target.value)} /></div>
          </div>
          <Input label="Téléphone *" type="tel" placeholder="06 12 34 56 78" icon="📱" value={telephone} onChange={e=>setTelephone(formatPhone(e.target.value))} />
          <Input label="Adresse *" placeholder="12 rue de la Paix" icon="🏠" value={adresseRue} onChange={e=>setAdresseRue(e.target.value)} />
          <div style={{ display:"flex", gap:10 }}>
            <div style={{ flex:"0 0 120px" }}><Input label="Code postal *" placeholder="75001" value={codePostal} onChange={e=>setCodePostal(e.target.value.replace(/\D/g,"").slice(0,5))} inputMode="numeric" /></div>
            <div style={{ flex:1 }}><Input label="Ville de base *" placeholder="Paris" icon="📍" value={villeBase} onChange={e=>setVilleBase(e.target.value)} hint="Ville de départ en mission" /></div>
          </div>
          <div style={{ marginBottom:14 }}>
            <label style={{ display:"block", fontSize:12, color:C.textSub, fontWeight:600, marginBottom:10 }}>
              📡 Rayon d'intervention : <span style={{ color:accentColor, fontWeight:800 }}>{rayonKm} km</span>
            </label>
            <input type="range" min={5} max={100} step={5} value={rayonKm} onChange={e=>setRayonKm(Number(e.target.value))}
              style={{ width:"100%", accentColor, marginBottom:6 }} />
            <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:C.textMuted }}>
              <span>5 km</span><span>50 km</span><span>100 km</span>
            </div>
          </div>
          <div style={{ background:`${accentColor}12`, border:`1px solid ${accentColor}30`, borderRadius:r, padding:"13px 15px", marginTop:4, display:"flex", gap:10 }}>
            <span style={{ fontSize:18 }}>💡</span>
            <p style={{ color:C.textSub, fontSize:12, lineHeight:1.6, margin:0 }}>Votre numéro ne sera communiqué au client qu'après confirmation d'une mission.</p>
          </div>
        </>}

        {step === 2 && <>
          {/* Liste des métiers ajoutés */}
          {metiers.length > 0 && (
            <div style={{ marginBottom:16 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                <p style={{ fontWeight:800, color:C.text, fontSize:13, margin:0 }}>Vos métiers ({metiers.length})</p>
                <span style={{ background:`${C.success}20`, color:C.success, fontSize:11, fontWeight:700, borderRadius:8, padding:"3px 10px" }}>✓ {metiers.length} ajouté{metiers.length>1?"s":""}</span>
              </div>
              {metiers.map((m,i) => (
                <div key={m.id} style={{ background:"#0D1B3E", borderRadius:r, padding:"13px 14px", marginBottom:8, border:`1px solid ${C.border}`, display:"flex", alignItems:"center", gap:10 }}>
                  <div style={{ width:36, height:36, borderRadius:10, background:`${accentColor}15`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, flexShrink:0 }}>
                    {SECTORS.find(s=>s.id===m.sector)?.icon||"💼"}
                  </div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:700, color:C.text, fontSize:13 }}>{m.metier}</div>
                    <div style={{ color:C.textSub, fontSize:11, marginTop:1 }}>{SECTORS.find(s=>s.id===m.sector)?.label} · {m.niveau}</div>
                    <div style={{ display:"flex", gap:10, marginTop:4, alignItems:"center" }}>
                      <span style={{ fontSize:13, fontWeight:800, color:C.success }}>Vous : {formatE(m.tarifNet)}</span>
                      <span style={{ fontSize:11, color:C.textMuted }}>→ Client : {formatE(prixClient(m.tarifNet, m.sector||"divers"))}</span>
                    </div>
                  </div>
                  <button onClick={()=>setMetiers(prev=>prev.filter((_,j)=>j!==i))} style={{ background:"rgba(242,94,94,0.1)", border:"none", borderRadius:8, width:30, height:30, color:"#F25E5E", cursor:"pointer", fontSize:16, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>×</button>
                </div>
              ))}
            </div>
          )}
          {/* Formulaire ajout métier */}
          <div style={{ background:"#0D1B3E", borderRadius:14, padding:"16px", marginBottom:8, border:`1px dashed ${C.border}` }}>
            <p style={{ fontWeight:800, color:C.text, fontSize:13, margin:"0 0 2px" }}>
              {metiers.length===0 ? "+ Ajouter un métier" : "+ Ajouter un autre métier"}
            </p>
            <p style={{ color:C.textSub, fontSize:12, margin:"0 0 14px" }}>
              {metiers.length===0 ? "Indiquez votre secteur et métier principal" : "Chaque métier peut avoir son propre taux horaire"}
            </p>
            <Select label="Secteur" options={SECTORS.map(s=>s.label)} value={SECTORS.find(s=>s.id===newMetier.sector)?.label||""} onChange={e=>{const s=SECTORS.find(x=>x.label===e.target.value);setNewMetier({...newMetier,sector:s?.id||"",metier:""});}} />
            {newMetier.sector && <Select label="Métier" options={METIERS[newMetier.sector]||[]} value={newMetier.metier} onChange={e=>{
              const tarif=METIERS_TARIFS[newMetier.sector]?.[e.target.value];
              setNewMetier({...newMetier, metier:e.target.value, tarifNet:tarif?.default||tarif?.min||12});
            }} />}
            {newMetier.sector && newMetier.metier && (()=>{
              const t=METIERS_TARIFS[newMetier.sector]?.[newMetier.metier];
              const net=newMetier.tarifNet||t?.default||t?.min||12;
              return (
                <div style={{ background:`${accentColor}08`, border:`1px solid ${accentColor}22`, borderRadius:r, padding:"14px", marginBottom:14 }}>
                  {t && <div style={{ background:`${C.accentGold}15`, border:`1px solid ${C.accentGold}44`, borderRadius:8, padding:"8px 12px", marginBottom:12, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                    <span style={{ fontSize:12, color:C.text, fontWeight:600 }}>📊 Moyenne prestataire</span>
                    <span style={{ fontSize:13, color:C.accentGold, fontWeight:800 }}>{formatE(Math.round(((t.min + t.max) / 2) * 10) / 10)}</span>
                  </div>}
                  <label style={{ display:"block", fontSize:12, color:C.textSub, fontWeight:600, marginBottom:8 }}>Taux horaire souhaité</label>
                  <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
                    <div style={{ flex:1, position:"relative" }}>
                      <input type="number" min={1} step={0.1} value={net}
                        onChange={e=>setNewMetier({...newMetier, tarifNet:Math.max(1, Math.round(+(e.target.value||1)*100)/100)})}
                        style={{ width:"100%", padding:"12px 44px 12px 16px", borderRadius:10, border:`2px solid ${accentColor}`, fontSize:18, fontWeight:800, color:accentColor, fontFamily:"inherit", outline:"none", boxSizing:"border-box", textAlign:"center", background:"#162547" }} />
                      <span style={{ position:"absolute", right:12, top:"50%", transform:"translateY(-50%)", color:C.textSub, fontSize:13, fontWeight:600 }}>€/h</span>
                    </div>
                    <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                      <button onClick={()=>setNewMetier({...newMetier,tarifNet:Math.round((net+0.1)*100)/100})} style={{ width:34, height:28, borderRadius:7, border:`1px solid ${C.border}`, background:"#162547", cursor:"pointer", fontSize:14, display:"flex", alignItems:"center", justifyContent:"center", color:C.text }}>＋</button>
                      <button onClick={()=>setNewMetier({...newMetier,tarifNet:Math.max(1,Math.round((net-0.1)*100)/100)})} style={{ width:34, height:28, borderRadius:7, border:`1px solid ${C.border}`, background:"#162547", cursor:"pointer", fontSize:14, display:"flex", alignItems:"center", justifyContent:"center", color:C.text }}>－</button>
                    </div>
                  </div>
                  <div style={{ background:"#162547", borderRadius:10, padding:"10px 14px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                    <div><div style={{ fontSize:10, color:C.textSub }}>Vous encaissez</div><div style={{ fontSize:18, fontWeight:800, color:C.success }}>{formatE(net)}</div></div>
                    <span style={{ color:C.grayLight }}>→</span>
                    <div style={{ textAlign:"right" }}><div style={{ fontSize:10, color:C.textSub }}>Affiché clients</div><div style={{ fontSize:18, fontWeight:800, color:C.text }}>{formatE(prixClient(net,newMetier.sector||"divers"))}</div></div>
                  </div>
                  {/* Simulateur de charges auto-entrepreneur */}
                  {(()=>{
                    const taux = acreEnabled ? 0.11 : 0.22;
                    const charges = Math.round(net * taux * 100) / 100;
                    const netApres = Math.round((net - charges) * 100) / 100;
                    const scenarios = [
                      { label:"Mission 4h",      gain: Math.round(netApres * 4 * 10) / 10 },
                      { label:"Mission 8h",      gain: Math.round(netApres * 8 * 10) / 10 },
                      { label:"4 missions/mois", gain: Math.round(netApres * 8 * 4 * 10) / 10 },
                    ];
                    return (
                      <>
                        {/* Modal info ACRE */}
                        {showAcreInfo && (
                          <div onClick={()=>setShowAcreInfo(false)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", zIndex:1000, display:"flex", alignItems:"flex-end", padding:"0 0 0 0" }}>
                            <div onClick={e=>e.stopPropagation()} style={{ background:"#0D1B3E", borderRadius:"20px 20px 0 0", padding:"24px 20px 36px", width:"100%", maxHeight:"80vh", overflowY:"auto" }}>
                              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
                                <div style={{ fontWeight:800, color:C.text, fontSize:16 }}>🎁 L'ACRE — Exonération de charges</div>
                                <button onClick={()=>setShowAcreInfo(false)} style={{ background:"rgba(255,255,255,0.1)", border:"none", borderRadius:8, width:32, height:32, color:C.text, cursor:"pointer", fontSize:16 }}>×</button>
                              </div>
                              <div style={{ color:C.textSub, fontSize:13, lineHeight:1.7, marginBottom:14 }}>
                                L'ACRE (Aide aux Créateurs et Repreneurs d'Entreprise) réduit de <strong style={{ color:"#10D98F" }}>50%</strong> tes cotisations sociales pendant les <strong style={{ color:C.text }}>12 premiers mois</strong> d'activité, soit <strong style={{ color:"#10D98F" }}>11% au lieu de 22%</strong>.
                              </div>
                              <div style={{ fontWeight:700, color:C.text, fontSize:13, marginBottom:8 }}>✅ Tu y as droit si tu es :</div>
                              {[
                                "Demandeur d'emploi indemnisé (ARE ou ASS)",
                                "Moins de 26 ans (ou moins de 30 ans sans condition de chômage)",
                                "Bénéficiaire du RSA",
                                "En création dans une zone prioritaire (QPV)",
                                "Salarié ou licencié d'une entreprise en sauvegarde/redressement",
                                "Créateur dans un quartier politique de la ville",
                              ].map((c,i)=>(
                                <div key={i} style={{ display:"flex", gap:10, alignItems:"flex-start", padding:"7px 0", borderBottom:`1px solid rgba(255,255,255,0.06)` }}>
                                  <span style={{ color:"#10D98F", fontSize:14, flexShrink:0 }}>•</span>
                                  <span style={{ color:C.textSub, fontSize:13, lineHeight:1.5 }}>{c}</span>
                                </div>
                              ))}
                              <div style={{ background:"rgba(240,180,41,0.1)", border:"1px solid rgba(240,180,41,0.3)", borderRadius:10, padding:"12px 14px", marginTop:14 }}>
                                <div style={{ fontWeight:700, color:"#F0B429", fontSize:12, marginBottom:4 }}>⚠️ Important</div>
                                <div style={{ color:C.textSub, fontSize:12, lineHeight:1.6 }}>La demande d'ACRE doit être faite dans les <strong style={{ color:C.text }}>45 jours</strong> suivant la création de l'auto-entreprise sur autoentrepreneur.urssaf.fr. Elle n'est pas automatique.</div>
                              </div>
                            </div>
                          </div>
                        )}
                        <div style={{ background:"rgba(16,217,143,0.06)", border:`1px solid rgba(16,217,143,0.2)`, borderRadius:10, padding:"12px 14px", marginTop:10 }}>
                          <div style={{ fontWeight:800, color:C.text, fontSize:12, marginBottom:8 }}>🧮 Simulateur de charges auto-entrepreneur</div>
                          {/* Toggle ACRE */}
                          <div onClick={()=>setAcreEnabled(v=>!v)} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", background:"rgba(255,255,255,0.04)", borderRadius:8, padding:"8px 10px", marginBottom:10, cursor:"pointer" }}>
                            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                              <span style={{ fontSize:12, color:C.text, fontWeight:600 }}>Je bénéficie de l'ACRE</span>
                              <button onClick={e=>{e.stopPropagation();setShowAcreInfo(true);}} style={{ background:"rgba(255,255,255,0.15)", border:"none", borderRadius:"50%", width:18, height:18, color:C.text, cursor:"pointer", fontSize:11, fontWeight:800, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"inherit", flexShrink:0 }}>?</button>
                            </div>
                            <div style={{ width:36, height:20, borderRadius:10, background:acreEnabled?"#10D98F":"rgba(255,255,255,0.15)", transition:"background 0.2s", position:"relative", flexShrink:0 }}>
                              <div style={{ position:"absolute", top:2, left:acreEnabled?18:2, width:16, height:16, borderRadius:"50%", background:"#fff", transition:"left 0.2s" }} />
                            </div>
                          </div>
                          {acreEnabled && <div style={{ fontSize:11, color:"#10D98F", fontWeight:600, marginBottom:8, textAlign:"center" }}>✓ Taux réduit ACRE : 11% (12 premiers mois)</div>}
                          <div style={{ display:"flex", justifyContent:"space-between", padding:"4px 0", borderBottom:`1px solid rgba(255,255,255,0.06)` }}>
                            <span style={{ fontSize:11, color:C.textSub }}>Cotisations URSSAF ({acreEnabled?"11%":"22%"})</span>
                            <span style={{ fontSize:11, fontWeight:700, color:"#F25E5E" }}>− {formatE(charges)}</span>
                          </div>
                          <div style={{ display:"flex", justifyContent:"space-between", padding:"6px 0 8px", borderBottom:`1px solid rgba(255,255,255,0.06)` }}>
                            <span style={{ fontSize:12, color:C.textSub, fontWeight:700 }}>Net après charges</span>
                            <span style={{ fontSize:13, fontWeight:800, color:"#10D98F" }}>{formatE(netApres)}/h</span>
                          </div>
                          <div style={{ display:"flex", gap:6, marginTop:8 }}>
                            {scenarios.map(s=>(
                              <div key={s.label} style={{ flex:1, background:"#162547", borderRadius:7, padding:"6px 4px", textAlign:"center" }}>
                                <div style={{ fontSize:10, color:C.textSub, marginBottom:2 }}>{s.label}</div>
                                <div style={{ fontSize:12, fontWeight:800, color:"#10D98F" }}>{formatE(s.gain)}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </>
                    );
                  })()}
                </div>
              );
            })()}
            {newMetier.sector && newMetier.metier && <Select label="Niveau" options={["Débutant","Confirmé","Expert"]} value={newMetier.niveau} onChange={e=>setNewMetier({...newMetier,niveau:e.target.value})} />}
            <Btn full onClick={addMetier} disabled={!newMetier.sector||!newMetier.metier} variant={justAdded?"success":"primary"} style={{ padding:"12px", fontSize:14 }}>
              {justAdded ? "✓ Métier ajouté !" : metiers.length===0 ? "+ Ajouter ce métier" : "+ Ajouter un autre métier"}
            </Btn>
          </div>
        </>}

        {step === 3 && <>
          <p style={{ color:C.textSub, fontSize:13, marginTop:0, marginBottom:12 }}>Quel est votre niveau général ?</p>
          <div style={{ display:"flex", gap:8, marginBottom:20 }}>
            {NIVEAUX.map(n => (
              <button key={n} onClick={()=>setNiveau(n)} style={{ flex:1, padding:"13px 8px", borderRadius:r, border:`2px solid ${niveau===n?accentColor:C.border}`, background:niveau===n?`${accentColor}20`:"rgba(255,255,255,0.03)", cursor:"pointer", fontFamily:"inherit", textAlign:"center", transition:"all 0.2s" }}>
                <div style={{ fontSize:22, marginBottom:4 }}>{n==="Débutant"?"🌱":n==="Confirmé"?"💪":"🏆"}</div>
                <div style={{ color:niveau===n?accentColor:C.textSub, fontWeight:niveau===n?700:500, fontSize:12 }}>{n}</div>
              </button>
            ))}
          </div>
          <label style={{ display:"block", fontSize:12, color:C.textSub, fontWeight:600, marginBottom:10, textTransform:"uppercase", letterSpacing:0.8 }}>
            Années d'expérience : <span style={{ color:accentColor, fontWeight:800 }}>{experienceAns} an{experienceAns>1?"s":""}</span>
          </label>
          <input type="range" min={0} max={20} value={experienceAns} onChange={e=>setExperienceAns(Number(e.target.value))} style={{ width:"100%", accentColor, marginBottom:20 }} />
          {allCompListe.length > 0 && <>
            <label style={{ display:"block", fontSize:12, color:C.textSub, fontWeight:600, marginBottom:4, textTransform:"uppercase", letterSpacing:0.8 }}>Vos spécialités</label>
            <p style={{ fontSize:11, color:C.textSub, margin:"0 0 10px", lineHeight:1.5 }}>Ces tags apparaissent sur votre profil et aident les clients à vous trouver</p>
            <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:20 }}>
              {allCompListe.map(c => (
                <button key={c} onClick={()=>toggleItem(competences,setCompetences,c)} style={{ padding:"7px 12px", borderRadius:100, border:`1px solid ${competences.includes(c)?accentColor:C.border}`, background:competences.includes(c)?`${accentColor}25`:"transparent", color:competences.includes(c)?accentColor:C.textSub, fontSize:12, fontWeight:competences.includes(c)?700:400, cursor:"pointer", fontFamily:"inherit", transition:"all 0.2s" }}>{c}</button>
              ))}
            </div>
          </>}
          <label style={{ display:"block", fontSize:12, color:C.textSub, fontWeight:600, marginBottom:10, textTransform:"uppercase", letterSpacing:0.8 }}>Langues parlées</label>
          <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
            {LANGUES_LIST.map(l => (
              <button key={l} onClick={()=>{
                if (l === "Français") return;
                toggleItem(langues, setLangues, l);
              }} style={{ padding:"7px 12px", borderRadius:100, border:`1px solid ${langues.includes(l)?accentColor:C.border}`, background:langues.includes(l)?`${accentColor}25`:"transparent", color:langues.includes(l)?accentColor:C.textSub, fontSize:12, fontWeight:langues.includes(l)?700:400, cursor:l==="Français"?"default":"pointer", fontFamily:"inherit", transition:"all 0.2s", opacity:l==="Français"?0.6:1 }}>
                {l}{l==="Français" ? " ✓" : ""}
              </button>
            ))}
          </div>
          <div style={{ fontSize:11, color:"rgba(255,255,255,0.3)", marginTop:6, paddingLeft:2 }}>Le français est sélectionné par défaut</div>
        </>}

        {step === 4 && <>
          <p style={{ color:C.textSub, fontSize:13, marginTop:0, marginBottom:14 }}>Indiquez vos créneaux disponibles jour par jour.</p>
          {JOURS.map(jour => {
            const sel = dispos[jour] || [];
            const hasSel = sel.length > 0;
            return (
              <div key={jour} style={{ marginBottom:10, borderRadius:12, border:`2px solid ${hasSel?accentColor:C.border}`, overflow:"hidden", transition:"border-color 0.2s" }}>
                <div style={{ padding:"10px 14px", background:hasSel?`${accentColor}10`:"rgba(255,255,255,0.03)", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                  <span style={{ fontWeight:700, color:hasSel?accentColor:C.text, fontSize:14 }}>{jour}</span>
                  {hasSel
                    ? <span style={{ fontSize:11, color:accentColor, fontWeight:600 }}>{sel.map(c=>c.split(" ")[0]).join(" · ")}</span>
                    : <span style={{ color:C.textSub, fontSize:11 }}>Non disponible</span>}
                </div>
                <div style={{ padding:"8px 14px", display:"flex", gap:6, flexWrap:"wrap", borderTop:`1px solid ${C.border}`, background:"rgba(0,0,0,0.15)" }}>
                  {PLAGES.map(plage => {
                    const active = sel.includes(plage);
                    return (
                      <button key={plage} onClick={()=>setDispos(prev=>{ const cur=prev[jour]||[]; return {...prev,[jour]:active?cur.filter(x=>x!==plage):[...cur,plage]}; })}
                        style={{ padding:"7px 13px", borderRadius:10, border:"none", cursor:"pointer", fontFamily:"inherit", fontSize:12, fontWeight:active?700:500, background:active?accentColor:"rgba(255,255,255,0.07)", color:active?C.white:C.textSub, transition:"all 0.15s" }}>
                        {plage.split(" ")[0]}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          <div onClick={()=>setDispoImmediat(!dispoImmediat)} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", background:"rgba(255,255,255,0.04)", border:`1px solid ${C.border}`, borderRadius:r, padding:"14px 16px", cursor:"pointer", marginTop:6 }}>
            <div>
              <div style={{ color:C.text, fontWeight:600, fontSize:14 }}>Disponible immédiatement</div>
              <div style={{ color:C.textSub, fontSize:12 }}>Apparaissez dans les résultats urgents</div>
            </div>
            <div style={{ width:44, height:24, borderRadius:12, background:dispoImmediat?accentColor:"rgba(255,255,255,0.15)", position:"relative", transition:"background 0.2s", flexShrink:0 }}>
              <div style={{ position:"absolute", top:2, left:dispoImmediat?22:2, width:20, height:20, borderRadius:"50%", background:"#fff", transition:"left 0.2s", boxShadow:"0 1px 4px rgba(0,0,0,0.3)" }} />
            </div>
          </div>
        </>}

        {step === 5 && <>
          <label style={{ display:"block", fontSize:12, color:C.textSub, fontWeight:600, marginBottom:10, textTransform:"uppercase", letterSpacing:0.8 }}>Statut professionnel *</label>
          <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:20 }}>
            {[
              { id:"auto-entrepreneur", label:"Auto-entrepreneur / Micro-entreprise", icon:"🧾" },
            ].map(s => (
              <button key={s.id} onClick={()=>setStatutPro(s.id)} style={{ padding:"13px 16px", borderRadius:r, border:`2px solid ${statutPro===s.id?accentColor:C.border}`, background:statutPro===s.id?`${accentColor}20`:"rgba(255,255,255,0.03)", cursor:"pointer", fontFamily:"inherit", textAlign:"left", display:"flex", gap:10, alignItems:"center", transition:"all 0.2s" }}>
                <span style={{ fontSize:18 }}>{s.icon}</span>
                <span style={{ color:statutPro===s.id?accentColor:C.text, fontWeight:statutPro===s.id?700:500, fontSize:13 }}>{s.label}</span>
              </button>
            ))}
          </div>
          <IbanInput label="IBAN / RIB *" placeholder="FR76 3000 4028 0000 0000 0000 000" value={ribIban} onChange={e=>setRibIban(e.target.value.toUpperCase())} />
          <div style={{ fontSize:11, color:"rgba(255,255,255,0.35)", marginTop:-10, marginBottom:20, paddingLeft:4 }}>Requis pour recevoir le paiement de vos missions</div>

          {/* RC Pro */}
          <div onClick={()=>setRcProConfirmed(v=>!v)} style={{ display:"flex", alignItems:"flex-start", gap:12, background:rcProConfirmed?"rgba(16,217,143,0.08)":"rgba(255,255,255,0.03)", border:`1.5px solid ${rcProConfirmed?"#10D98F":C.border}`, borderRadius:r, padding:"13px 14px", cursor:"pointer", marginBottom:16, transition:"all 0.2s" }}>
            <div style={{ width:20, height:20, borderRadius:5, border:`2px solid ${rcProConfirmed?"#10D98F":C.border}`, background:rcProConfirmed?"#10D98F":"transparent", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, marginTop:1, transition:"all 0.2s" }}>
              {rcProConfirmed && <span style={{ color:"#fff", fontSize:12, fontWeight:800 }}>✓</span>}
            </div>
            <span style={{ fontSize:13, color:rcProConfirmed?C.text:C.textSub, lineHeight:1.5 }}>
              Je certifie disposer d'une <strong style={{ color:rcProConfirmed?"#10D98F":C.text }}>assurance RC Professionnelle</strong> en cours de validité, couvrant mon activité de prestataire de services.
            </span>
          </div>

          {/* Documents obligatoires */}
          <div style={{ background:"rgba(240,180,41,0.08)", border:"1.5px solid rgba(240,180,41,0.35)", borderRadius:r, padding:"14px 16px" }}>
            <div style={{ fontWeight:800, color:"#F0B429", fontSize:13, marginBottom:8 }}>📎 Documents obligatoires pour recevoir des missions</div>
            <p style={{ color:C.textSub, fontSize:12, lineHeight:1.6, margin:"0 0 10px" }}>
              Une fois votre compte approuvé, vous devrez envoyer les documents suivants depuis votre espace pour débloquer l'accès aux missions :
            </p>
            {[
              "Photo d'identité récente (selfie ou portrait)",
              "Justificatif d'immatriculation (KBIS ou extrait INSEE)",
              "Attestation de vigilance URSSAF (moins de 6 mois)",
              "Carte nationale d'identité ou passeport (recto-verso)",
              "Justificatif de domicile (moins de 3 mois)",
              "RIB / Relevé d'Identité Bancaire",
            ].map((doc,i) => (
              <div key={i} style={{ display:"flex", gap:8, alignItems:"flex-start", padding:"5px 0", borderBottom:i<5?"1px solid rgba(255,255,255,0.05)":"none" }}>
                <span style={{ color:"#F0B429", fontSize:13, flexShrink:0, marginTop:1 }}>•</span>
                <span style={{ color:C.textSub, fontSize:12, lineHeight:1.5 }}>{doc}</span>
              </div>
            ))}
          </div>

        </>}

        {step === 6 && <>
          <div style={{ marginBottom:8 }}>
            <p style={{ color:C.textSub, fontSize:13, margin:"0 0 16px", lineHeight:1.6 }}>Choisissez votre formule. Vous pouvez changer à tout moment depuis votre espace.</p>
            {ABONNEMENTS_PRESTA.map(plan => {
              const active = planChoisi === plan.id;
              return (
                <div key={plan.id} onClick={() => setPlanChoisi(plan.id)}
                  style={{ background: active ? `${plan.color}18` : "#0D1B3E", border: `2px solid ${active ? plan.color : C.border}`, borderRadius: r + 4, padding:"16px", marginBottom:10, cursor:"pointer", position:"relative", transition:"all 0.2s" }}>
                  {plan.popular && <div style={{ position:"absolute", top:-10, right:14, background:plan.color, color:"#fff", fontSize:10, fontWeight:800, borderRadius:99, padding:"3px 10px", letterSpacing:0.5 }}>POPULAIRE</div>}
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                      <span style={{ fontSize:22 }}>{plan.icon}</span>
                      <div>
                        <div style={{ fontWeight:800, color: active ? plan.color : C.text, fontSize:15 }}>{plan.label}</div>
                        <div style={{ color:C.textSub, fontSize:12 }}>{plan.price === 0 ? "Gratuit" : `${plan.price} €/mois`}</div>
                      </div>
                    </div>
                    <div style={{ width:22, height:22, borderRadius:"50%", border:`2px solid ${active ? plan.color : C.border}`, background: active ? plan.color : "transparent", display:"flex", alignItems:"center", justifyContent:"center", transition:"all 0.2s" }}>
                      {active && <div style={{ width:8, height:8, borderRadius:"50%", background:"#fff" }} />}
                    </div>
                  </div>
                  <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                    {plan.features.map(f => (
                      <span key={f} style={{ fontSize:11, color: active ? plan.color : C.textSub, background: active ? `${plan.color}18` : "rgba(255,255,255,0.05)", borderRadius:99, padding:"3px 9px", fontWeight:600 }}>✓ {f}</span>
                    ))}
                    {plan.locked.map(f => (
                      <span key={f} style={{ fontSize:11, color:C.textMuted, background:"rgba(255,255,255,0.03)", borderRadius:99, padding:"3px 9px" }}>🔒 {f}</span>
                    ))}
                  </div>
                  {plan.note && <p style={{ color:C.textMuted, fontSize:10, margin:"8px 0 0", lineHeight:1.5, fontStyle:"italic" }}>{plan.note}</p>}
                </div>
              );
            })}
            {isLaunchPhase() && (
              <div style={{ background:`${C.violet}15`, border:`1px solid ${C.violet}44`, borderRadius:r, padding:"11px 14px", marginTop:6, fontSize:12, color:C.text }}>
                🚀 <strong>Offre de lancement</strong> — Les <strong style={{ color:C.violetLight }}>100 premiers inscrits</strong> → <strong style={{ color:C.accentGold }}>10 missions/mois gratuites</strong> !<br/>
                <span style={{ color:C.textSub }}>2 missions/mois ensuite pour le plan Gratuit.</span>
              </div>
            )}
          </div>
        </>}

        {step === 7 && <>
          <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"14px", marginBottom:20 }}>
            <div style={{ fontWeight:700, color:C.text, fontSize:14, marginBottom:12 }}>📋 Récapitulatif de votre profil</div>
            {[
              { l:"Nom",           v:`${prenom} ${nom}` },
              { l:"Téléphone",     v:telephone },
              { l:"Adresse",       v:`${adresseRue.trim()}, ${codePostal.trim()} ${villeBase.trim()}`.replace(/^, /,"") || "—" },
              { l:"Rayon",         v:`${rayonKm} km autour de ${villeBase || "votre ville"}` },
              { l:"Métiers",       v:metiers.map(m=>`${m.metier} (${formatE(m.tarifNet)}/h)`).join(", ") || "—" },
              { l:"Niveau",        v:niveau },
              { l:"Expérience",    v:`${experienceAns} an${experienceAns>1?"s":""}` },
              { l:"Disponibilités",v:JOURS.filter(j=>(dispos[j]||[]).length>0).map(j=>`${j.slice(0,3)}: ${(dispos[j]||[]).map(c=>c.split(" ")[0]).join(", ")}`).join(" · ") || "—" },
              { l:"Langues",       v:langues.join(", ") },
              { l:"Statut",        v:statutPro },
              { l:"Abonnement",    v:(ABONNEMENTS_PRESTA.find(p=>p.id===planChoisi)||ABONNEMENTS_PRESTA[0]).label },
            ].map(({l,v}) => (
              <div key={l} style={{ display:"flex", justifyContent:"space-between", fontSize:12, marginBottom:6 }}>
                <span style={{ color:C.textSub }}>{l}</span>
                <span style={{ color:C.text, fontWeight:600, maxWidth:"60%", textAlign:"right" }}>{v}</span>
              </div>
            ))}
          </div>
          <EmailInput label="Adresse email *" value={email} onChange={e=>setEmail(e.target.value)} />
          <div style={{ position:"relative" }}>
            <Input label="Mot de passe *" type={showPass?"text":"password"} placeholder="••••••••  (min. 6 caractères)" icon="🔒" value={password} onChange={e=>setPassword(e.target.value)} />
            <button onClick={()=>setShowPass(!showPass)} style={{ position:"absolute", right:14, top:34, background:"none", border:"none", color:C.textSub, cursor:"pointer", fontSize:12, fontFamily:"inherit" }}>{showPass?"Cacher":"Voir"}</button>
          </div>
          <PasswordStrength password={password} />
          <div onClick={()=>setCgpsAccepted(v=>!v)} style={{ display:"flex", gap:10, alignItems:"flex-start", padding:"12px 14px", borderRadius:r, border:`1.5px solid ${cgpsAccepted?accentColor:C.grayLight}`, background:cgpsAccepted?`${accentColor}10`:"transparent", cursor:"pointer", marginBottom:6 }}>
            <div style={{ width:20, height:20, borderRadius:5, border:`2px solid ${cgpsAccepted?accentColor:C.grayLight}`, background:cgpsAccepted?accentColor:"transparent", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, marginTop:1 }}>
              {cgpsAccepted && <span style={{ color:"#fff", fontSize:12, fontWeight:900 }}>✓</span>}
            </div>
            <span style={{ color:C.text, fontSize:12, lineHeight:1.6 }}>
              J'ai lu et j'accepte les{" "}
              <span onClick={e=>{e.stopPropagation();setShowCgpsModal(true);}} style={{ color:accentColor, textDecoration:"underline", cursor:"pointer" }}>Conditions Générales de Prestation de Services (CGPS)</span>
              {" "}et la{" "}
              <span onClick={e=>{e.stopPropagation();setShowPrivacyModal(true);}} style={{ color:accentColor, textDecoration:"underline", cursor:"pointer" }}>Politique de confidentialité</span>
            </span>
          </div>
        </>}
      </div>

      {/* Bottom nav */}
      <div style={{ padding:"16px 24px 40px", display:"flex", gap:10 }}>
        {step > 1 && <Btn variant="ghost" onClick={()=>{setError("");setStep(s=>s-1)}} style={{ flex:1 }}>← Retour</Btn>}
        <Btn onClick={step===TOTAL?handleSubmit:handleNext} disabled={loading} style={{ flex:2, background:accentColor, boxShadow:`0 8px 24px ${accentColor}44`, padding:"14px" }}>
          {step===TOTAL ? (loading?"Création…":"Créer mon compte →") : "Continuer →"}
        </Btn>
      </div>

      {/* Modal CGPS */}
      {showCgpsModal && (
        <div onClick={()=>setShowCgpsModal(false)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", zIndex:1000, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
          <div onClick={e=>e.stopPropagation()} style={{ background:"#0D1B3E", borderRadius:"20px 20px 0 0", padding:"24px 20px 40px", width:"100%", maxWidth:520, maxHeight:"80vh", overflowY:"auto" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
              <span style={{ fontWeight:800, color:C.text, fontSize:16 }}>📋 CGPS — Conditions Générales de Prestation de Services</span>
              <button onClick={()=>setShowCgpsModal(false)} style={{ background:"transparent", border:"none", color:C.textSub, fontSize:20, cursor:"pointer" }}>✕</button>
            </div>
            {[
              { title:"1. Objet", text:"Les présentes CGPS régissent les relations entre ALANE (la plateforme), les clients et les prestataires auto-entrepreneurs inscrits. ALANE agit en tant qu'intermédiaire de mise en relation et ne prend pas part à l'exécution des missions." },
              { title:"2. Statut prestataire & indépendance", text:"Vous intervenez en qualité d'auto-entrepreneur indépendant (art. L8221-6 Code du travail). Aucun lien de subordination n'existe entre ALANE et vous. ALANE agit exclusivement comme intermédiaire de mise en relation et n'est pas une entreprise de mise à disposition de personnel au sens de l'art. L8241-1 CT. Pour préserver votre statut d'indépendant, il est fortement recommandé de ne pas réaliser plus de 75 % de votre chiffre d'affaires via ALANE (principe de multi-clientèle). Vous êtes seul responsable du respect de vos obligations légales, fiscales et sociales." },
              { title:"3. Missions", text:"Les missions sont proposées par les clients via la plateforme. Vous postulez librement et acceptez les conditions définies par le client. Le contrat de prestation est conclu directement entre vous et le client." },
              { title:"4. Paiements", text:"Les paiements sont sécurisés via Stripe. ALANE ne détient pas les fonds — ils sont directement réglés entre les parties selon les conditions convenues. ALANE prélève une commission de mise en relation selon les conditions de votre abonnement." },
              { title:"5. Annulations", text:"Politique d'annulation : gratuit au-delà de 48h, 50% entre 24-48h, 100% en dessous de 24h. En cas de litige, ALANE propose une médiation. Tout remboursement est traité manuellement par l'équipe ALANE." },
              { title:"6. Responsabilité", text:"ALANE ne peut être tenu responsable des dommages résultant de l'exécution des missions, des retards, ou de tout différend entre client et prestataire. Vous êtes couvert par votre propre assurance RC Pro (obligatoire)." },
              { title:"7. Plafond de chiffre d'affaires", text:"Le statut auto-entrepreneur est soumis à un plafond annuel de chiffre d'affaires (77 700 € pour les prestations de services en 2024, seuil révisé chaque année). Au-delà de ce seuil, vous perdez automatiquement le bénéfice du régime micro-entreprise. ALANE ne peut être tenu responsable du dépassement de ce plafond. Il vous appartient de suivre vos revenus et de consulter l'URSSAF ou un expert-comptable en cas de doute." },
              { title:"8. Résiliation", text:"Vous pouvez clôturer votre compte à tout moment depuis les Réglages. ALANE se réserve le droit de suspendre ou supprimer un compte en cas de manquement grave aux présentes CGPS." },
            ].map((s,i)=>(
              <div key={i} style={{ background:"#162547", borderRadius:10, padding:"12px 14px", marginBottom:8 }}>
                <div style={{ fontWeight:700, color:C.text, fontSize:13, marginBottom:4 }}>{s.title}</div>
                <div style={{ color:C.textSub, fontSize:12, lineHeight:1.6 }}>{s.text}</div>
              </div>
            ))}
            <div style={{ marginTop:16, textAlign:"center" }}>
              <button onClick={()=>{setCgpsAccepted(true);setShowCgpsModal(false);}} style={{ background:accentColor, border:"none", borderRadius:r, padding:"12px 24px", color:"#fff", fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>✓ J'accepte les CGPS</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal politique de confidentialité */}
      {showPrivacyModal && (
        <div onClick={()=>setShowPrivacyModal(false)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", zIndex:1000, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
          <div onClick={e=>e.stopPropagation()} style={{ background:"#0D1B3E", borderRadius:"20px 20px 0 0", padding:"24px 20px 40px", width:"100%", maxWidth:520, maxHeight:"75vh", overflowY:"auto" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
              <span style={{ fontWeight:800, color:C.text, fontSize:16 }}>🔒 Politique de confidentialité</span>
              <button onClick={()=>setShowPrivacyModal(false)} style={{ background:"transparent", border:"none", color:C.textSub, fontSize:20, cursor:"pointer" }}>✕</button>
            </div>
            {[
              { title:"Données collectées", text:"Identité (nom, email, téléphone), documents professionnels (SIRET, pièce d'identité), données de paiement (via Stripe), géolocalisation (avec votre consentement)." },
              { title:"Utilisation", text:"Gestion de votre compte, mise en relation client/prestataire, traitement des paiements, amélioration des services, lutte contre la fraude." },
              { title:"Conservation", text:"Durée de votre inscription + 3 ans pour les données de facturation (obligation légale). Documents d'identité supprimés après vérification." },
              { title:"Vos droits (RGPD)", text:"Accès, rectification, suppression, portabilité, opposition. Contact : privacy@alane.fr" },
              { title:"Partage", text:"Vos données ne sont jamais vendues. Partagées uniquement avec Stripe (paiements) et sur réquisition judiciaire." },
            ].map((s,i)=>(
              <div key={i} style={{ background:"#162547", borderRadius:10, padding:"12px 14px", marginBottom:8 }}>
                <div style={{ fontWeight:700, color:C.text, fontSize:13, marginBottom:4 }}>{s.title}</div>
                <div style={{ color:C.textSub, fontSize:12, lineHeight:1.6 }}>{s.text}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function ClientRegisterFlow({ onRegister, onBack, accentColor }) {
  const TOTAL = 3;
  const [step, setStep] = useState(1);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [prenom, setPrenom] = useState("");
  const [nom, setNom] = useState("");
  const [telephone, setTelephone] = useState("");
  const [typeCompte, setTypeCompte] = useState("particulier");
  const [societeNom, setSocieteNom] = useState("");
  const [kbisNum, setKbisNum] = useState("");
  const [secteursBesoins, setSecteursBesoins] = useState([]);
  const [metiersBesoins, setMetiersBesoins] = useState([]);
  const [frequence, setFrequence] = useState("");
  const [adresse, setAdresse] = useState("");
  const [codePostal, setCodePostal] = useState("");
  const [ville, setVille] = useState("");
  const [lieuxIntervention, setLieuxIntervention] = useState([{ adresse:"", codePostal:"", ville:"" }]);
  const [volumeHoraire, setVolumeHoraire] = useState("");
  const [rib, setRib] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);
  const [cgpsAccepted, setCgpsAccepted] = useState(false);
  const [showCgpsModal, setShowCgpsModal] = useState(false);

  const toggleSecteur = id => {
    setSecteursBesoins(prev => {
      const next = prev.includes(id) ? prev.filter(x=>x!==id) : [...prev, id];
      const metiersValides = next.flatMap(s => Object.keys(METIERS_TARIFS[s] || {}));
      setMetiersBesoins(m => m.filter(x => metiersValides.includes(x)));
      return next;
    });
  };

  const toggleMetier = id =>
    setMetiersBesoins(prev => prev.includes(id) ? prev.filter(x=>x!==id) : [...prev, id]);

  const validateStep = () => {
    if (step === 1) {
      if (!prenom.trim() || !nom.trim()) return "Prénom et nom obligatoires";
      if (telephone.replace(/[\s.\-]/g,"").length < 10) return "Numéro de téléphone obligatoire";
      if (typeCompte === "professionnel") {
        if (!societeNom.trim()) return "Nom de société obligatoire";
        if (!kbisNum.trim())    return "Numéro SIRET/KBIS obligatoire";
      }
    }
    if (step === 2) {
      if (!secteursBesoins.length) return "Sélectionnez au moins un secteur";
      if (!frequence)              return "Indiquez la fréquence de vos besoins";
      if (!ville.trim())           return "Indiquez votre ville";
      if (!codePostal.trim())      return "Indiquez votre code postal";
      if (!volumeHoraire)          return "Indiquez votre volume horaire estimé";
      if (lieuxIntervention.some(l => !l.adresse.trim() || !l.ville.trim())) return "Remplissez tous les lieux d'intervention (adresse et ville)";
    }
    if (step === 3) {
      if (!email || !password) return "Email et mot de passe requis";
      if (password.length < 6) return "Mot de passe minimum 6 caractères";
      if (!cgpsAccepted)       return "Vous devez accepter les CGPS pour créer votre compte";
    }
    return null;
  };

  const handleNext = () => {
    const err = validateStep();
    if (err) { setError(err); return; }
    setError(""); setStep(s => s + 1);
  };

  const handleSubmit = async () => {
    const err = validateStep();
    if (err) { setError(err); return; }
    setLoading(true); setError("");
    const { data, error: signUpErr } = await supabase.auth.signUp({
      email, password,
      options: { data: {
        role: "client", prenom: prenom.trim(), nom: nom.trim(),
        telephone: telephone.replace(/[\s.\-]/g,""),
        type_compte: typeCompte, societe_nom: societeNom||null, kbis: kbisNum||null,
        secteurs_besoins: secteursBesoins, metiers_besoins: metiersBesoins, frequence_besoins: frequence,
        lieux_intervention: lieuxIntervention.filter(l=>l.adresse.trim()||l.ville.trim()),
        adresse: adresse||null, code_postal: codePostal||null, ville,
        volume_horaire: volumeHoraire,
        rib: rib.replace(/\s/g,"") || null,
      }},
    });
    if (signUpErr) {
      setLoading(false);
      setError(signUpErr.message.includes("already") || signUpErr.message.includes("registered")
        ? "Un compte existe déjà avec cet email. Connectez-vous à la place."
        : signUpErr.message);
      return;
    }
    if (data?.user) {
      await supabase.from("profiles").upsert({
        id: data.user.id, role: "client", prenom: prenom.trim(), nom: nom.trim(), status: "pending",
      });
      await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "notify_signup", prenom: prenom.trim(), nom: nom.trim(), email, role: "client" }),
      }).catch(() => {});
      await fetch("/api/welcome-email", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ email, prenom: prenom.trim(), nom: nom.trim(), role:"client" }) }).catch(()=>{});
      const referrerUUID = sessionStorage.getItem("alane_referrer");
      if (referrerUUID && referrerUUID !== data.user.id) {
        await fetch("/api/support", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "track_referral", newUserId: data.user.id, referrerUUID }),
        }).catch(() => {});
        sessionStorage.removeItem("alane_referrer");
      }
      // Ne pas signOut : garder la session pour que le polling PendingApprovalScreen fonctionne
      sessionStorage.setItem("alane_session_active", "1");
    }
    setLoading(false);
    onRegister();
  };

  const STEP_TITLES = ["Votre identité","Vos besoins","Votre compte"];
  const STEP_ICONS  = ["👤","🎯","🔐"];

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(160deg,#050E20,#0A1628,#162547)`, display:"flex", flexDirection:"column" }}>
      <div style={{ padding:"54px 24px 16px" }}>
        <button onClick={step===1 ? onBack : ()=>{setError("");setStep(s=>s-1)}} style={{ background:"transparent", border:"none", color:C.textSub, cursor:"pointer", fontSize:13, marginBottom:16, display:"flex", alignItems:"center", gap:6, fontFamily:"inherit" }}>
          ← {step===1 ? "Retour à la connexion" : "Étape précédente"}
        </button>
        <div style={{ display:"flex", gap:4, marginBottom:16 }}>
          {Array.from({length:TOTAL},(_,i) => (
            <div key={i} style={{ flex:1, height:3, borderRadius:2, background:i<step?accentColor:`${accentColor}25`, transition:"background 0.3s" }} />
          ))}
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:38, height:38, borderRadius:10, background:`${accentColor}20`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20 }}>{STEP_ICONS[step-1]}</div>
          <div>
            <div style={{ color:C.textMuted, fontSize:11, letterSpacing:1, textTransform:"uppercase" }}>Étape {step}/{TOTAL} — Inscription Client</div>
            <div style={{ color:C.text, fontSize:18, fontWeight:700, fontFamily:font.display }}>{STEP_TITLES[step-1]}</div>
          </div>
        </div>
      </div>

      <div style={{ flex:1, padding:"8px 24px 16px", overflowY:"auto" }}>
        {error && <div style={{ background:"#F25E5E22", border:"1px solid #F25E5E55", borderRadius:r, padding:"10px 14px", marginBottom:14, color:"#F25E5E", fontSize:13 }}>{error}</div>}

        {step === 1 && <>
          <div style={{ display:"flex", gap:10 }}>
            <div style={{ flex:1 }}><Input label="Prénom *" placeholder="Jean" icon="👤" value={prenom} onChange={e=>setPrenom(e.target.value)} /></div>
            <div style={{ flex:1 }}><Input label="Nom *" placeholder="Dupont" icon="👤" value={nom} onChange={e=>setNom(e.target.value)} /></div>
          </div>
          <Input label="Téléphone *" type="tel" placeholder="06 12 34 56 78" icon="📱" value={telephone} onChange={e=>setTelephone(formatPhone(e.target.value))} />
          <label style={{ display:"block", fontSize:12, color:C.textSub, fontWeight:600, marginBottom:10, textTransform:"uppercase", letterSpacing:0.8 }}>Type de compte *</label>
          <div style={{ display:"flex", gap:8, marginBottom:16 }}>
            {[{id:"particulier",label:"👤 Particulier"},{id:"professionnel",label:"🏢 Professionnel"}].map(t=>(
              <button key={t.id} onClick={()=>setTypeCompte(t.id)} style={{ flex:1, padding:"12px", borderRadius:r, border:`2px solid ${typeCompte===t.id?accentColor:C.border}`, background:typeCompte===t.id?`${accentColor}20`:"transparent", color:typeCompte===t.id?accentColor:C.textSub, fontWeight:typeCompte===t.id?700:500, fontSize:13, cursor:"pointer", fontFamily:"inherit", transition:"all 0.2s" }}>{t.label}</button>
            ))}
          </div>
          {typeCompte === "professionnel" && <>
            <Input label="Nom de société *" placeholder="ACME SARL" icon="🏢" value={societeNom} onChange={e=>setSocieteNom(e.target.value)} />
            <Input label="N° SIRET / KBIS *" placeholder="123 456 789 00010" icon="📄" value={kbisNum} onChange={e=>setKbisNum(e.target.value)} inputMode="numeric" />
          </>}
        </>}

        {step === 2 && <>
          <p style={{ color:C.textSub, fontSize:13, marginTop:0, marginBottom:12 }}>
            Dans quels secteurs avez-vous besoin de main-d'œuvre ? <span style={{ color:C.textMuted }}>(plusieurs choix possibles)</span>
          </p>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:20 }}>
            {SECTORS.map(s => (
              <button key={s.id} onClick={()=>toggleSecteur(s.id)} style={{ padding:"13px 10px", borderRadius:r, border:`2px solid ${secteursBesoins.includes(s.id)?s.color:C.border}`, background:secteursBesoins.includes(s.id)?`${s.color}20`:"rgba(255,255,255,0.03)", cursor:"pointer", fontFamily:"inherit", textAlign:"center", transition:"all 0.2s", position:"relative" }}>
                {secteursBesoins.includes(s.id) && <div style={{ position:"absolute", top:6, right:8, width:16, height:16, borderRadius:"50%", background:s.color, display:"flex", alignItems:"center", justifyContent:"center" }}><span style={{ color:"#fff", fontSize:10, fontWeight:900 }}>✓</span></div>}
                <div style={{ fontSize:22, marginBottom:5 }}>{s.icon}</div>
                <div style={{ color:secteursBesoins.includes(s.id)?s.color:C.textSub, fontWeight:secteursBesoins.includes(s.id)?700:500, fontSize:12 }}>{s.label}</div>
              </button>
            ))}
          </div>
          {secteursBesoins.length > 0 && <>
            <label style={{ display:"block", fontSize:12, color:C.textSub, fontWeight:600, marginBottom:10, textTransform:"uppercase", letterSpacing:0.8 }}>Métiers recherchés <span style={{ color:C.textMuted, textTransform:"none", letterSpacing:0 }}>(plusieurs choix possibles)</span></label>
            {secteursBesoins.map(sid => {
              const s = SECTORS.find(x=>x.id===sid);
              const metiers = Object.keys(METIERS_TARIFS[sid] || {});
              if (!metiers.length) return null;
              return (
                <div key={sid} style={{ marginBottom:14 }}>
                  <div style={{ color:s?.color||accentColor, fontSize:12, fontWeight:700, marginBottom:6 }}>{s?.icon} {s?.label}</div>
                  <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
                    {metiers.map(m => (
                      <button key={m} onClick={()=>toggleMetier(m)} style={{ padding:"8px 14px", borderRadius:20, border:`1.5px solid ${metiersBesoins.includes(m)?(s?.color||accentColor):C.border}`, background:metiersBesoins.includes(m)?`${s?.color||accentColor}20`:"rgba(255,255,255,0.03)", color:metiersBesoins.includes(m)?(s?.color||accentColor):C.textSub, fontWeight:metiersBesoins.includes(m)?700:400, fontSize:12, cursor:"pointer", fontFamily:"inherit", transition:"all 0.2s" }}>
                        {metiersBesoins.includes(m) && "✓ "}{m}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
            <div style={{ height:8 }} />
          </>}
          <label style={{ display:"block", fontSize:12, color:C.textSub, fontWeight:600, marginBottom:10, textTransform:"uppercase", letterSpacing:0.8 }}>Fréquence de vos besoins *</label>
          <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:20 }}>
            {[
              { id:"ponctuel",  label:"Ponctuel",           desc:"Missions occasionnelles selon les besoins",  icon:"⚡" },
              { id:"regulier",  label:"Régulier",           desc:"Besoin récurrent chaque semaine ou mois",    icon:"📅" },
              { id:"les-deux",  label:"Ponctuel & Régulier",desc:"Mix de missions récurrentes et ponctuelles", icon:"🔄" },
            ].map(f => (
              <button key={f.id} onClick={()=>setFrequence(f.id)} style={{ padding:"13px 16px", borderRadius:r, border:`2px solid ${frequence===f.id?accentColor:C.border}`, background:frequence===f.id?`${accentColor}20`:"rgba(255,255,255,0.03)", cursor:"pointer", fontFamily:"inherit", textAlign:"left", display:"flex", gap:12, alignItems:"center", transition:"all 0.2s" }}>
                <span style={{ fontSize:20 }}>{f.icon}</span>
                <div>
                  <div style={{ color:frequence===f.id?accentColor:C.text, fontWeight:frequence===f.id?700:500, fontSize:13 }}>{f.label}</div>
                  <div style={{ color:C.textSub, fontSize:11 }}>{f.desc}</div>
                </div>
              </button>
            ))}
          </div>
          <AddressAutocomplete label="Adresse *" value={adresse} onChange={v=>setAdresse(v)} onSelect={s=>{setAdresse(s.rue);setCodePostal(s.codePostal);setVille(s.ville);}} />
          <div style={{ display:"flex", gap:10 }}>
            <div style={{ flex:1, minWidth:0 }}><Input label="Code postal *" placeholder="75001" value={codePostal} onChange={e=>setCodePostal(e.target.value)} autoComplete="off" inputMode="numeric" /></div>
            <div style={{ flex:2, minWidth:0 }}><Input label="Ville *" placeholder="Paris" value={ville} onChange={e=>setVille(e.target.value)} autoComplete="off" /></div>
          </div>
          <label style={{ display:"block", fontSize:12, color:C.textSub, fontWeight:600, marginBottom:10, textTransform:"uppercase", letterSpacing:0.8 }}>Volume horaire estimé *</label>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
            {[
              { id:"<8h",   label:"Moins de 8h",  desc:"Quelques heures / semaine",    icon:"🕐" },
              { id:"8-20h", label:"8 à 20h",       desc:"1 à 3 jours / semaine",       icon:"📆" },
              { id:"20-40h",label:"20 à 40h",      desc:"Mi-temps à temps plein",      icon:"💼" },
              { id:">40h",  label:"Plus de 40h",   desc:"Plusieurs personnes / sites",  icon:"🏢" },
            ].map(v => (
              <button key={v.id} onClick={()=>setVolumeHoraire(v.id)} style={{ padding:"12px 10px", borderRadius:r, border:`2px solid ${volumeHoraire===v.id?accentColor:C.border}`, background:volumeHoraire===v.id?`${accentColor}20`:"rgba(255,255,255,0.03)", cursor:"pointer", fontFamily:"inherit", textAlign:"center", transition:"all 0.2s" }}>
                <div style={{ fontSize:20, marginBottom:4 }}>{v.icon}</div>
                <div style={{ color:volumeHoraire===v.id?accentColor:C.text, fontWeight:volumeHoraire===v.id?700:500, fontSize:13 }}>{v.label}</div>
                <div style={{ color:C.textSub, fontSize:11, marginTop:2 }}>{v.desc}</div>
              </button>
            ))}
          </div>

          <label style={{ display:"block", fontSize:12, color:C.textSub, fontWeight:600, marginBottom:10, marginTop:20, textTransform:"uppercase", letterSpacing:0.8 }}>Lieux d'intervention *</label>
          <p style={{ color:C.textMuted, fontSize:12, margin:"0 0 12px" }}>Indiquez où le prestataire devra intervenir (plusieurs adresses possibles).</p>
          {lieuxIntervention.map((lieu, i) => (
            <div key={i} style={{ background:"rgba(255,255,255,0.03)", border:`1px solid ${C.border}`, borderRadius:r, padding:"12px 14px", marginBottom:10, position:"relative" }}>
              {lieuxIntervention.length > 1 && (
                <button onClick={()=>setLieuxIntervention(prev=>prev.filter((_,j)=>j!==i))} style={{ position:"absolute", top:10, right:10, background:"transparent", border:"none", color:"rgba(242,94,94,0.7)", fontSize:16, cursor:"pointer", lineHeight:1 }}>✕</button>
              )}
              <AddressAutocomplete label={`Adresse ${lieuxIntervention.length > 1 ? i+1 : ""}`}
                value={lieu.adresse} onChange={v=>setLieuxIntervention(prev=>prev.map((l,j)=>j===i?{...l,adresse:v}:l))}
                onSelect={s=>setLieuxIntervention(prev=>prev.map((l,j)=>j===i?{...l,adresse:s.rue,codePostal:s.codePostal,ville:s.ville}:l))} />
              <div style={{ display:"flex", gap:10 }}>
                <div style={{ flex:1, minWidth:0 }}><Input label="Code postal" placeholder="75001"
                  value={lieu.codePostal} onChange={e=>{ const v=e.target.value; setLieuxIntervention(prev=>prev.map((l,j)=>j===i?{...l,codePostal:v}:l)); }} autoComplete="off" inputMode="numeric" /></div>
                <div style={{ flex:2, minWidth:0 }}><Input label="Ville" placeholder="Paris"
                  value={lieu.ville} onChange={e=>{ const v=e.target.value; setLieuxIntervention(prev=>prev.map((l,j)=>j===i?{...l,ville:v}:l)); }} autoComplete="off" /></div>
              </div>
            </div>
          ))}
          <button onClick={()=>setLieuxIntervention(prev=>[...prev,{adresse:"",codePostal:"",ville:""}])} style={{ width:"100%", padding:"11px", borderRadius:r, border:`1.5px dashed ${accentColor}60`, background:"transparent", color:accentColor, fontWeight:600, fontSize:13, cursor:"pointer", fontFamily:"inherit", marginBottom:8 }}>
            + Ajouter un lieu
          </button>
        </>}

        {step === 3 && <>
          <div style={{ background:`${accentColor}12`, border:`1px solid ${accentColor}30`, borderRadius:r, padding:"13px 15px", marginBottom:20, display:"flex", gap:10 }}>
            <span style={{ fontSize:18 }}>🏦</span>
            <div>
              <div style={{ fontWeight:700, color:C.text, fontSize:13, marginBottom:3 }}>IBAN / RIB (optionnel)</div>
              <p style={{ color:C.textSub, fontSize:12, lineHeight:1.5, margin:0 }}>Non obligatoire à l'inscription, mais nécessaire pour confirmer vos commandes.</p>
            </div>
          </div>
          <IbanInput label="IBAN / RIB" placeholder="FR76 3000 4028 0000 0000 0000 000" value={rib} onChange={e=>setRib(e.target.value.toUpperCase())} />
          <EmailInput label="Adresse email *" value={email} onChange={e=>setEmail(e.target.value)} />
          <div style={{ position:"relative" }}>
            <Input label="Mot de passe *" type={showPass?"text":"password"} placeholder="••••••••  (min. 6 caractères)" icon="🔒" value={password} onChange={e=>setPassword(e.target.value)} />
            <button onClick={()=>setShowPass(!showPass)} style={{ position:"absolute", right:14, top:34, background:"none", border:"none", color:C.textSub, cursor:"pointer", fontSize:12, fontFamily:"inherit" }}>{showPass?"Cacher":"Voir"}</button>
          </div>
          <PasswordStrength password={password} />
          <div onClick={()=>setCgpsAccepted(v=>!v)} style={{ display:"flex", gap:10, alignItems:"flex-start", padding:"12px 14px", borderRadius:r, border:`1.5px solid ${cgpsAccepted?accentColor:C.grayLight}`, background:cgpsAccepted?`${accentColor}10`:"transparent", cursor:"pointer", marginBottom:6 }}>
            <div style={{ width:20, height:20, borderRadius:5, border:`2px solid ${cgpsAccepted?accentColor:C.grayLight}`, background:cgpsAccepted?accentColor:"transparent", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, marginTop:1 }}>
              {cgpsAccepted && <span style={{ color:"#fff", fontSize:12, fontWeight:900 }}>✓</span>}
            </div>
            <span style={{ color:C.text, fontSize:12, lineHeight:1.6 }}>
              J'ai lu et j'accepte les{" "}
              <span onClick={e=>{e.stopPropagation();setShowCgpsModal(true);}} style={{ color:accentColor, textDecoration:"underline", cursor:"pointer" }}>Conditions Générales de Prestation de Services (CGPS)</span>
              {" "}et la{" "}
              <span onClick={e=>{e.stopPropagation();setShowPrivacyModal(true);}} style={{ color:accentColor, textDecoration:"underline", cursor:"pointer" }}>Politique de confidentialité</span>
            </span>
          </div>
        </>}
      </div>

      <div style={{ padding:"16px 24px 40px", display:"flex", gap:10 }}>
        {step > 1 && <Btn variant="ghost" onClick={()=>{setError("");setStep(s=>s-1)}} style={{ flex:1 }}>← Retour</Btn>}
        <Btn onClick={step===TOTAL?handleSubmit:handleNext} disabled={loading} style={{ flex:2, background:accentColor, boxShadow:`0 8px 24px ${accentColor}44`, padding:"14px" }}>
          {step===TOTAL ? (loading?"Création…":"Créer mon compte →") : "Continuer →"}
        </Btn>
      </div>

      {/* Modal CGPS */}
      {showCgpsModal && (
        <div onClick={()=>setShowCgpsModal(false)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", zIndex:1000, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
          <div onClick={e=>e.stopPropagation()} style={{ background:"#0D1B3E", borderRadius:"20px 20px 0 0", padding:"24px 20px 40px", width:"100%", maxWidth:520, maxHeight:"80vh", overflowY:"auto" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
              <span style={{ fontWeight:800, color:C.text, fontSize:16 }}>📋 CGPS — Conditions Générales de Prestation de Services</span>
              <button onClick={()=>setShowCgpsModal(false)} style={{ background:"transparent", border:"none", color:C.textSub, fontSize:20, cursor:"pointer" }}>✕</button>
            </div>
            {[
              { title:"1. Objet", text:"Les présentes CGPS régissent les relations entre ALANE (la plateforme), les clients et les prestataires auto-entrepreneurs inscrits. ALANE agit en tant qu'intermédiaire de mise en relation et ne prend pas part à l'exécution des missions." },
              { title:"2. Statut des prestataires", text:"Les prestataires interviennent en qualité d'auto-entrepreneurs indépendants (art. L8221-6 Code du travail). ALANE n'est pas une entreprise de mise à disposition de personnel ni d'intérim au sens des art. L8241-1 et L1251-1 CT. Les missions conclues via ALANE ne constituent pas des contrats de travail. Aucun lien de subordination n'existe entre vous (le client) et ALANE. Le contrat de prestation est conclu directement entre vous et le prestataire." },
              { title:"3. Utilisation de la plateforme", text:"En tant que client, vous vous engagez à décrire honnêtement vos besoins, à respecter les prestataires et à valider les missions dans les délais prévus. Toute utilisation frauduleuse entraîne la résiliation immédiate du compte." },
              { title:"4. Paiements", text:"Les paiements sont sécurisés via Stripe. ALANE ne détient pas les fonds — ils sont réglés directement entre les parties. ALANE prélève une commission de mise en relation selon les conditions tarifaires en vigueur." },
              { title:"5. Annulations", text:"Gratuit au-delà de 48h avant la mission, 50% de frais entre 24h et 48h, 100% de frais en dessous de 24h. En cas de litige, ALANE propose une médiation. Tout remboursement est traité manuellement par l'équipe ALANE." },
              { title:"6. Responsabilité", text:"ALANE ne peut être tenu responsable des dommages résultant de l'exécution des missions, des retards, ou de tout différend entre client et prestataire. ALANE est un intermédiaire de mise en relation uniquement." },
              { title:"7. Données personnelles", text:"Vos données sont traitées conformément au RGPD. Elles ne sont jamais vendues à des tiers. Voir la Politique de confidentialité pour le détail complet." },
              { title:"8. Résiliation", text:"Vous pouvez clôturer votre compte à tout moment depuis les Réglages. ALANE se réserve le droit de suspendre ou supprimer un compte en cas de manquement grave aux présentes CGPS." },
            ].map((s,i)=>(
              <div key={i} style={{ background:"#162547", borderRadius:10, padding:"12px 14px", marginBottom:8 }}>
                <div style={{ fontWeight:700, color:C.text, fontSize:13, marginBottom:4 }}>{s.title}</div>
                <div style={{ color:C.textSub, fontSize:12, lineHeight:1.6 }}>{s.text}</div>
              </div>
            ))}
            <div style={{ marginTop:16, textAlign:"center" }}>
              <button onClick={()=>{setCgpsAccepted(true);setShowCgpsModal(false);}} style={{ background:accentColor, border:"none", borderRadius:r, padding:"12px 24px", color:"#fff", fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>✓ J'accepte les CGPS</button>
            </div>
          </div>
        </div>
      )}

      {showPrivacyModal && (
        <div onClick={()=>setShowPrivacyModal(false)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", zIndex:1000, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
          <div onClick={e=>e.stopPropagation()} style={{ background:"#0D1B3E", borderRadius:"20px 20px 0 0", padding:"24px 20px 40px", width:"100%", maxWidth:520, maxHeight:"75vh", overflowY:"auto" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
              <span style={{ fontWeight:800, color:C.text, fontSize:16 }}>🔒 Politique de confidentialité</span>
              <button onClick={()=>setShowPrivacyModal(false)} style={{ background:"transparent", border:"none", color:C.textSub, fontSize:20, cursor:"pointer" }}>✕</button>
            </div>
            {[
              { title:"Données collectées", text:"Identité (nom, email, téléphone), données de facturation (IBAN), géolocalisation (avec votre consentement)." },
              { title:"Utilisation", text:"Gestion de votre compte, mise en relation avec les prestataires, traitement des paiements." },
              { title:"Conservation", text:"Durée de votre inscription + 3 ans pour les données de facturation (obligation légale)." },
              { title:"Vos droits (RGPD)", text:"Accès, rectification, suppression, portabilité. Contact : privacy@alane.fr" },
            ].map((s,i)=>(
              <div key={i} style={{ background:"#162547", borderRadius:10, padding:"12px 14px", marginBottom:8 }}>
                <div style={{ fontWeight:700, color:C.text, fontSize:13, marginBottom:4 }}>{s.title}</div>
                <div style={{ color:C.textSub, fontSize:12, lineHeight:1.6 }}>{s.text}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


export function AuthScreen({ role, onLogin, onRegister, onBack }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSent, setForgotSent] = useState(false);
  const [stayLoggedIn, setStayLoggedIn] = useState(false);
  const [prenom, setPrenom] = useState("");
  const [nom, setNom] = useState("");
  const [typeCompte, setTypeCompte] = useState("particulier");
  const [societeNom, setSocieteNom] = useState("");
  const [kbisNum, setKbisNum] = useState("");
  const [rib, setRib] = useState("");
  const [telephone, setTelephone] = useState("");

  const isClient = role === "client";
  const accentColor = isClient ? C.violet : C.accentGold;
  const emoji = isClient ? "🏢" : "👷";
  const roleLabel = isClient ? "Client" : "Prestataire";

  const handleLogin = async () => {
    if (!email || !password) { setError("Email et mot de passe requis"); return; }
    setLoading(true); setError("");
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) {
      setLoading(false);
      setError(err.message === "Email not confirmed"
        ? "Email non confirmé. Vérifiez votre boîte mail et cliquez sur le lien de confirmation avant de vous connecter."
        : err.message);
      return;
    }

    const { data:{ user } } = await supabase.auth.getUser();
    const { data: profile } = await supabase.from("profiles").select("role,status").eq("id", user.id).single();
    setLoading(false);

    if (!profile?.role || profile.role !== role) {
      setError(`Ce compte est un compte ${profile?.role === "prestataire" ? "Prestataire" : "Client"}. Utilisez l'espace correspondant.`);
      await supabase.auth.signOut();
      return;
    }
    if (!profile?.status || profile.status === "pending") {
      setError("Votre compte est en attente de validation par notre équipe. Vous serez notifié par email.");
      await supabase.auth.signOut();
      return;
    }
    if (profile?.status === "rejected") {
      setError("Votre compte a été refusé. Contactez le support pour plus d'informations.");
      await supabase.auth.signOut();
      return;
    }
    if (stayLoggedIn) {
      localStorage.setItem("alane_stay_logged_in", "1");
      sessionStorage.removeItem("alane_session_active");
    } else {
      sessionStorage.setItem("alane_session_active", "1");
      localStorage.removeItem("alane_stay_logged_in");
    }
    onLogin();
  };

  const handleRegister = async () => {
    if (!email || !password) { setError("Email et mot de passe requis"); return; }
    if (password.length < 6) { setError("Mot de passe minimum 6 caractères"); return; }
    if (!prenom.trim() || !nom.trim()) { setError("Prénom et nom obligatoires"); return; }
    const telClean = telephone.replace(/[\s.\-]/g,"");
    if (!telClean || telClean.length < 10) { setError("Numéro de téléphone obligatoire"); return; }
    if (isClient && typeCompte === "professionnel") {
      if (!societeNom.trim()) { setError("Nom de société obligatoire"); return; }
      if (!kbisNum.trim()) { setError("Numéro KBIS obligatoire"); return; }
    }
    const ribClean = rib.replace(/\s/g,"");
    setLoading(true); setError("");
    const { data, error: err } = await supabase.auth.signUp({
      email, password,
      options: { data: { role, prenom, nom, telephone: telClean, type_compte: isClient ? typeCompte : null, societe_nom: societeNom||null, kbis: kbisNum||null, rib: ribClean||null } },
    });
    if (err) {
      setLoading(false);
      if (err.message.includes("already") || err.message.includes("registered")) {
        setError("Un compte existe déjà avec cet email. Connectez-vous à la place.");
      } else {
        setError(err.message);
      }
      return;
    }
    if (data?.user) {
      await supabase.from("profiles").upsert({
        id: data.user.id, role, prenom: prenom.trim(), nom: nom.trim(), status: "pending",
      });
      await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "notify_signup", prenom: prenom.trim(), nom: nom.trim(), email, role }),
      }).catch(() => {});
      sessionStorage.setItem("alane_session_active", "1");
    }
    setLoading(false);
    onRegister();
  };

  if (mode === "register") {
    if (isClient) return <ClientRegisterFlow onRegister={onRegister} onBack={onBack} accentColor={accentColor} />;
    return <PrestaRegisterFlow onRegister={onRegister} onBack={onBack} accentColor={accentColor} />;
  }

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(160deg,#050E20,#0A1628,#162547)`, display:"flex", flexDirection:"column", position:"relative", overflow:"hidden" }}>

      {/* Ambient glow */}
      <div style={{ position:"absolute", top:-100, right:-100, width:300, height:300, borderRadius:"50%", background:`radial-gradient(circle,${accentColor}18 0%,transparent 65%)`, pointerEvents:"none" }} />

      {/* Header */}
      <div style={{ padding:"54px 24px 28px" }}>
        <button onClick={onBack} style={{ background:"transparent", border:"none", color:C.textSub, cursor:"pointer", fontSize:13, marginBottom:24, display:"flex", alignItems:"center", gap:6, fontFamily:"inherit" }}>← Retour</button>

        <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:20 }}>
          <div style={{ width:48, height:48, borderRadius:r, background:`${accentColor}20`, border:`1px solid ${accentColor}35`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:24 }}>{emoji}</div>
          <div>
            <p style={{ color:C.textMuted, fontSize:11, letterSpacing:1, textTransform:"uppercase", margin:"0 0 3px" }}>Espace {roleLabel}</p>
            <h2 style={{ color:C.text, fontSize:26, fontWeight:700, margin:0, fontFamily:font.display }}>
              {mode==="login" ? "Bon retour 👋" : "Rejoignez ALANE"}
            </h2>
          </div>
        </div>

        {/* Toggle connexion / inscription */}
        <div style={{ display:"flex", background:"rgba(255,255,255,0.05)", borderRadius:12, padding:4, border:`1px solid ${C.border}` }}>
          {[
            { id:"login",    label:"Connexion"   },
            { id:"register", label:"Inscription" },
          ].map(m => (
            <button key={m.id} onClick={()=>setMode(m.id)} style={{
              flex:1, padding:"10px", border:"none", borderRadius:10, cursor:"pointer",
              background: mode===m.id ? accentColor : "transparent",
              color: mode===m.id ? C.white : C.textSub,
              fontWeight: mode===m.id ? 700 : 500,
              fontSize:14, fontFamily:"inherit",
              boxShadow: mode===m.id ? `0 4px 16px ${accentColor}44` : "none",
              transition:"all 0.2s",
            }}>{m.label}</button>
          ))}
        </div>
      </div>

      {isLaunchPhase() && (
        <div style={{ padding:"0 24px 8px" }}>
          <div style={{
            background:"linear-gradient(135deg, rgba(16,217,143,0.10), rgba(16,217,143,0.04))",
            border:"1px solid rgba(16,217,143,0.30)",
            borderRadius:r, padding:"11px 14px",
            display:"flex", gap:10, alignItems:"center",
          }}>
            <span style={{ fontSize:16, flexShrink:0 }}>🎉</span>
            <div style={{ flex:1 }}>
              <span style={{ fontWeight:700, color:"#10D98F", fontSize:12 }}>Offre de lancement</span>
              <div style={{ color:"rgba(255,255,255,0.45)", fontSize:11, marginTop:2 }}>
                {role==="client" ? "Tarif transparent · le prix affiché est le vrai prix de la mission" : "10 missions gratuites · Réservé aux 100 premiers prestataires inscrits"}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Form */}
      <div style={{ padding:"0 24px 40px", flex:1 }}>
        {mode === "login" ? (
          /* ── CONNEXION ── */
          <>
            <Input label="Adresse email" type="email" placeholder="votre@email.fr" icon="✉️" value={email} onChange={e=>setEmail(e.target.value)} />
            <div style={{ position:"relative" }}>
              <Input label="Mot de passe" type={showPass?"text":"password"} placeholder="••••••••" icon="🔒" value={password} onChange={e=>setPassword(e.target.value)} />
              <button onClick={()=>setShowPass(!showPass)} style={{ position:"absolute", right:14, top:34, background:"none", border:"none", color:C.textSub, cursor:"pointer", fontSize:12, fontFamily:"inherit" }}>
                {showPass?"Cacher":"Voir"}
              </button>
            </div>
            <div style={{ textAlign:"right", marginTop:-8, marginBottom:20 }}>
              <button onClick={()=>{ setForgotMode(true); setError(""); }} style={{ background:"none", border:"none", color:accentColor, fontSize:13, cursor:"pointer", fontFamily:"inherit", fontWeight:600 }}>
                Mot de passe oublié ?
              </button>
            </div>

            {forgotMode && (
              <div style={{ background:`${accentColor}12`, border:`1px solid ${accentColor}30`, borderRadius:r, padding:"16px", marginBottom:16 }}>
                {forgotSent ? (
                  <div style={{ textAlign:"center" }}>
                    <div style={{ fontSize:28, marginBottom:8 }}>📧</div>
                    <div style={{ fontWeight:700, color:C.text, fontSize:14, marginBottom:4 }}>Email envoyé !</div>
                    <div style={{ color:C.textSub, fontSize:12 }}>Vérifiez votre boîte mail et cliquez sur le lien pour réinitialiser votre mot de passe.</div>
                    <button onClick={()=>{ setForgotMode(false); setForgotSent(false); }} style={{ marginTop:12, background:"none", border:"none", color:accentColor, fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>← Retour à la connexion</button>
                  </div>
                ) : (
                  <>
                    <div style={{ fontWeight:700, color:C.text, fontSize:13, marginBottom:10 }}>Réinitialiser le mot de passe</div>
                    <Input label="Votre email" type="email" placeholder="votre@email.fr" icon="✉️" value={forgotEmail} onChange={e=>setForgotEmail(e.target.value)} />
                    {error && <div style={{ color:"#F25E5E", fontSize:12, marginBottom:8 }}>{error}</div>}
                    <div style={{ display:"flex", gap:8 }}>
                      <Btn onClick={()=>setForgotMode(false)} style={{ flex:1, fontSize:13, padding:"11px", background:"transparent", border:`1px solid ${C.border}` }}>Annuler</Btn>
                      <Btn onClick={async()=>{
                        if(!forgotEmail){ setError("Email requis"); return; }
                        setLoading(true); setError("");
                        const { error:err } = await supabase.auth.resetPasswordForEmail(forgotEmail, {
                          redirectTo: window.location.origin,
                        });
                        setLoading(false);
                        if(err){ setError(err.message); return; }
                        setForgotSent(true);
                      }} disabled={loading} style={{ flex:1, fontSize:13, padding:"11px", background:accentColor }}>
                        {loading ? "Envoi…" : "Envoyer →"}
                      </Btn>
                    </div>
                  </>
                )}
              </div>
            )}

            <label style={{ display:"flex", alignItems:"center", gap:10, marginBottom:18, cursor:"pointer" }}>
              <div onClick={()=>setStayLoggedIn(!stayLoggedIn)} style={{ width:20, height:20, borderRadius:6, border:`2px solid ${stayLoggedIn?accentColor:C.border}`, background:stayLoggedIn?accentColor:"transparent", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, transition:"all 0.15s" }}>
                {stayLoggedIn && <span style={{ color:"#fff", fontSize:12, fontWeight:900, lineHeight:1 }}>✓</span>}
              </div>
              <span onClick={()=>setStayLoggedIn(!stayLoggedIn)} style={{ color:C.textSub, fontSize:13 }}>Rester connecté</span>
            </label>

            {error && <div style={{ background:"#F25E5E22", border:"1px solid #F25E5E55", borderRadius:r, padding:"10px 14px", marginBottom:14, color:"#F25E5E", fontSize:13 }}>{error}</div>}
            <Btn full onClick={handleLogin} disabled={loading} style={{ fontSize:15, padding:"16px", background:accentColor, boxShadow:`0 8px 24px ${accentColor}44`, marginBottom:20 }}>
              {loading ? "Connexion…" : "Se connecter →"}
            </Btn>

            {/* Social login */}
            <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:20 }}>
              <div style={{ flex:1, height:1, background:C.border }} />
              <span style={{ color:C.textMuted, fontSize:12 }}>ou continuer avec</span>
              <div style={{ flex:1, height:1, background:C.border }} />
            </div>
            <div style={{ display:"flex", gap:10 }}>
              {[{icon:"🍎",label:"Apple"},{icon:"G",label:"Google"}].map(s=>(
                <button key={s.label} style={{ flex:1, padding:"13px", border:`1px solid ${C.border}`, borderRadius:r, background:"rgba(255,255,255,0.04)", fontSize:13, cursor:"pointer", fontFamily:"inherit", fontWeight:600, color:C.text, display:"flex", gap:8, alignItems:"center", justifyContent:"center" }}>
                  <span>{s.icon}</span>{s.label}
                </button>
              ))}
            </div>

            <p style={{ textAlign:"center", color:C.textSub, fontSize:13, marginTop:24 }}>
              Pas encore de compte ?{" "}
              <button onClick={()=>setMode("register")} style={{ background:"none", border:"none", color:accentColor, fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
                S'inscrire
              </button>
            </p>
          </>
        ) : (
          /* ── INSCRIPTION ── */
          <>
            <div style={{ background:`${accentColor}12`, border:`1px solid ${accentColor}30`, borderRadius:r, padding:"13px 15px", marginBottom:20, display:"flex", gap:10, alignItems:"center" }}>
              <span style={{ fontSize:18 }}>ℹ️</span>
              <p style={{ color:C.textSub, fontSize:12, lineHeight:1.6, margin:0 }}>
                Vous allez créer un compte <strong style={{ color:C.text }}>{roleLabel} ALANE</strong>.
                {isClient
                  ? " Renseignez vos informations et commencez à réserver en quelques minutes."
                  : " Vous serez guidé à travers les étapes de validation de votre dossier."
                }
              </p>
            </div>

            {/* Prénom / Nom */}
            <div style={{ display:"flex", gap:10 }}>
              <div style={{ flex:1 }}><Input label="Prénom *" placeholder="Jean" icon="👤" value={prenom} onChange={e=>setPrenom(e.target.value)} /></div>
              <div style={{ flex:1 }}><Input label="Nom *" placeholder="Dupont" icon="👤" value={nom} onChange={e=>setNom(e.target.value)} /></div>
            </div>

            <Input label="Téléphone *" type="tel" placeholder="06 12 34 56 78" icon="📱" value={telephone} onChange={e=>setTelephone(formatPhone(e.target.value))} />

            {/* Type de compte — client seulement */}
            {isClient && (
              <div style={{ marginBottom:16 }}>
                <label style={{ display:"block", fontSize:12, color:C.textSub, fontWeight:600, marginBottom:8, textTransform:"uppercase", letterSpacing:0.8 }}>Type de compte *</label>
                <div style={{ display:"flex", gap:8 }}>
                  {[{id:"particulier",label:"👤 Particulier"},{id:"professionnel",label:"🏢 Professionnel"}].map(t=>(
                    <button key={t.id} onClick={()=>setTypeCompte(t.id)} style={{ flex:1, padding:"11px", borderRadius:r, border:`2px solid ${typeCompte===t.id?accentColor:C.border}`, background:typeCompte===t.id?`${accentColor}20`:"transparent", color:typeCompte===t.id?accentColor:C.textSub, fontWeight:typeCompte===t.id?700:500, fontSize:13, cursor:"pointer", fontFamily:"inherit", transition:"all 0.2s" }}>{t.label}</button>
                  ))}
                </div>
              </div>
            )}

            {/* Champs professionnel */}
            {isClient && typeCompte === "professionnel" && (
              <>
                <Input label="Nom de société *" placeholder="ACME SARL" icon="🏢" value={societeNom} onChange={e=>setSocieteNom(e.target.value)} />
                <Input label="N° KBIS / SIRET *" placeholder="123 456 789 00010" icon="📄" value={kbisNum} onChange={e=>setKbisNum(e.target.value)} inputMode="numeric" />
              </>
            )}

            <IbanInput label="IBAN / RIB (optionnel)" placeholder="FR76 3000 4028 0000 0000 0000 000" value={rib} onChange={e=>setRib(e.target.value.toUpperCase())} />
            <div style={{ fontSize:11, color:"rgba(255,255,255,0.35)", marginTop:-10, marginBottom:14, paddingLeft:4 }}>Requis pour passer des commandes ou accepter des missions</div>

            <EmailInput label="Adresse email *" value={email} onChange={e=>setEmail(e.target.value)} />
            <div style={{ position:"relative" }}>
              <Input label="Mot de passe *" type={showPass?"text":"password"} placeholder="••••••••  (min. 6 caractères)" icon="🔒" value={password} onChange={e=>setPassword(e.target.value)} />
              <button onClick={()=>setShowPass(!showPass)} style={{ position:"absolute", right:14, top:34, background:"none", border:"none", color:C.textSub, cursor:"pointer", fontSize:12, fontFamily:"inherit" }}>
                {showPass?"Cacher":"Voir"}
              </button>
            </div>
            <PasswordStrength password={password} />

            {error && <div style={{ background:"#F25E5E22", border:"1px solid #F25E5E55", borderRadius:r, padding:"10px 14px", marginBottom:14, color:"#F25E5E", fontSize:13 }}>{error}</div>}
            <Btn full onClick={handleRegister} disabled={loading} style={{ fontSize:15, padding:"16px", background:accentColor, boxShadow:`0 8px 24px ${accentColor}44`, marginBottom:14 }}>
              {loading ? "Création…" : "Créer mon compte →"}
            </Btn>

            <p style={{ color:C.textMuted, fontSize:12, textAlign:"center", lineHeight:1.6 }}>
              En créant un compte vous acceptez nos{" "}
              <span style={{ color:accentColor, cursor:"pointer" }}>CGU</span>{" "}et notre{" "}
              <span style={{ color:accentColor, cursor:"pointer" }}>Politique de confidentialité</span>
            </p>

            <p style={{ textAlign:"center", color:C.textSub, fontSize:13, marginTop:20 }}>
              Déjà un compte ?{" "}
              <button onClick={()=>setMode("login")} style={{ background:"none", border:"none", color:accentColor, fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
                Se connecter
              </button>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
