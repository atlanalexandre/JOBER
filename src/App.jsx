import { useState, useEffect, useRef, Component } from "react";
import { supabase } from "./lib/supabase.js";
import { pathForScreen, screenForPath, NEEDS_DATA, PUBLIC_SCREENS, AUTH_SCREENS } from "./lib/routes.js";
import { C, font, r } from "./constants/colors.js";
import { isLaunchPhase, getCashbackTier } from "./constants/plans.js";
import { useResponsive } from "./hooks/useResponsive.js";
import { Badge, Btn, ToastContainer, ConfirmModal, PromptModal, showConfirm, fetchPrestaCount } from "./components/ui.jsx";
import { AuthScreen } from "./components/auth.jsx";
import { BackofficeLogin, BackofficeDashboard } from "./components/backoffice.jsx";
import { MissionPendingScreen, StripePaymentScreen, InvoiceScreen, CancellationScreen, setUseProviders } from "./components/payment.jsx";
import { PrestaOnboarding, PrestaProfileEditScreen, PrestaPointageScreen, PrestaDashboard, MicroEntrepriseScreen } from "./components/presta-screens.jsx";
import { ContactSupportScreen, SettingsScreen, ResetPasswordScreen, HomeScreen, CatalogueScreen, SectorDetailScreen, SearchFiltersScreen, CVScreen, ProfileScreen, BookingScreen, TrackingScreen, ValidationScreen, ChatScreen, FavoritesScreen, FAQScreen, ReferralScreen, CalendarScreen, TeamBookingScreen, HowItWorksScreen, ClientOnboarding, ContractScreen, LegalScreen, PayslipScreen, MissionHistoryScreen, CashbackWalletScreen, NotificationsScreen, RatingScreen, DocUploadScreen, ClientProDocScreen, AbonnementPrestaScreen, MissionRequestScreen, MissionBroadcastScreen, OnboardingScreen, useProviders } from "./components/client-screens.jsx";
setUseProviders(useProviders);

export class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  componentDidCatch(error, info) { console.error("ErrorBoundary:", error, info); }
  render() {
    if (!this.state.hasError) return this.props.children;
    const errMsg = this.state.error ? (this.state.error.message || String(this.state.error)) : "Erreur inconnue";
    return (
      <div style={{ minHeight:"100vh", background:"#050E20", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:32, textAlign:"center" }}>
        <div style={{ fontSize:64, marginBottom:16 }}>&#128565;</div>
        <h2 style={{ color:"#fff", fontSize:22, fontWeight:800, margin:"0 0 12px", fontFamily:"'Playfair Display',serif" }}>Oups, quelque chose s'est cassé</h2>
        <div style={{ background:"rgba(242,94,94,0.1)", border:"1px solid rgba(242,94,94,0.3)", borderRadius:10, padding:"10px 16px", maxWidth:400, width:"100%", marginBottom:20 }}>
          <p style={{ color:"#F25E5E", fontSize:12, fontFamily:"monospace", wordBreak:"break-all", margin:0, textAlign:"left" }}>{errMsg}</p>
        </div>
        <button aria-label="Recharger la page" onClick={()=>window.location.reload()} style={{ background:"#7C6FE0", border:"none", color:"#fff", borderRadius:12, padding:"13px 28px", fontSize:14, fontWeight:700, cursor:"pointer", fontFamily:"inherit", marginBottom:12 }}>
          &#128260; Recharger la page
        </button>
        <button aria-label="Réessayer sans recharger la page" onClick={()=>{ this.setState({ hasError:false, error:null }); }} style={{ background:"transparent", border:"1px solid rgba(255,255,255,0.2)", color:"rgba(255,255,255,0.5)", borderRadius:12, padding:"11px 24px", fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
          Réessayer sans recharger
        </button>
      </div>
    );
  }
}

// ── Logo ALANE — Variation A : cercles pleins avec halo lumineux ─────
function ALANELogo({ size = "md" }) {
  const cfg = {
    sm: { svgW:36, svgH:24, vW:160, fs:17, gap:7  },
    md: { svgW:44, svgH:30, vW:160, fs:18, gap:9  },
    lg: { svgW:60, svgH:40, vW:160, fs:28, gap:12 },
  }[size] || { svgW:44, svgH:30, vW:160, fs:18, gap:9 };
  return (
    <div style={{ display:"flex", alignItems:"center", gap:cfg.gap }}>
      <svg width={cfg.svgW} height={cfg.svgH} viewBox="0 0 160 110" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="al-line" x1="52" y1="55" x2="108" y2="55" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#7C6FE0"/>
            <stop offset="100%" stopColor="#F0B429"/>
          </linearGradient>
          <filter id="al-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" result="blur"/>
            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>
        {/* Left node — violet */}
        <circle cx="40" cy="55" r="28" fill="#7C6FE0" opacity="0.15"/>
        <circle cx="40" cy="55" r="18" fill="#7C6FE0" filter="url(#al-glow)"/>
        <circle cx="40" cy="55" r="7" fill="#fff"/>
        {/* Connector */}
        <line x1="58" y1="55" x2="102" y2="55" stroke="url(#al-line)" strokeWidth="3" strokeLinecap="round"/>
        {/* Right node — gold */}
        <circle cx="120" cy="55" r="28" fill="#F0B429" opacity="0.15"/>
        <circle cx="120" cy="55" r="18" fill="#F0B429" filter="url(#al-glow)"/>
        <circle cx="120" cy="55" r="7" fill="#fff"/>
      </svg>
      <span style={{ color:"#FFFFFF", fontSize:cfg.fs, fontWeight:700, letterSpacing:-0.3, fontFamily:"inherit" }}>ALANE</span>
    </div>
  );
}

function AlaneIcon({ size = 18 }) {
  const s = size;
  return (
    <svg width={s * 1.45} height={s} viewBox="0 0 160 110" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display:"inline-block", verticalAlign:"middle" }}>
      <defs>
        <linearGradient id="ai-line" x1="52" y1="55" x2="108" y2="55" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#7C6FE0"/>
          <stop offset="100%" stopColor="#F0B429"/>
        </linearGradient>
      </defs>
      <circle cx="40" cy="55" r="18" fill="#7C6FE0"/>
      <circle cx="40" cy="55" r="7" fill="#fff"/>
      <line x1="58" y1="55" x2="102" y2="55" stroke="url(#ai-line)" strokeWidth="3" strokeLinecap="round"/>
      <circle cx="120" cy="55" r="18" fill="#F0B429"/>
      <circle cx="120" cy="55" r="7" fill="#fff"/>
    </svg>
  );
}


// ── Design System, plans, hooks → imported from separate modules ─

// Met à jour les counts dynamiquement après chargement des PROVIDERS
// (sera appelé après la définition de PROVIDERS)

// ── Primitives ────────────────────────────────────────────────────
// ── UI Primitives — Premium Dark ─────────────────────────────────

// ── SCREENS ───────────────────────────────────────────────────────

function SplashScreen({ onNext }) {
  const [v,setV]=useState(false);
  const [prestaCount,setPrestaCount]=useState(null);
  useEffect(()=>{ const t=setTimeout(()=>setV(true),100); return ()=>clearTimeout(t); },[]);
  useEffect(()=>{
    fetchPrestaCount().then(c=>{ if(c!=null) setPrestaCount(c); });
  },[]);
  const MAX_LAUNCH = 100;
  const spotsLeft = prestaCount != null ? Math.max(0, MAX_LAUNCH - prestaCount) : null;
  const offerActive = isLaunchPhase() && (spotsLeft == null || spotsLeft > 0);
  return (
    <div style={{
      minHeight:"100%",
      background: `linear-gradient(160deg, #050E20 0%, #0A1628 40%, #162547 70%, #1E3A7B 100%)`,
      display:"flex", flexDirection:"column",
      padding:"0 28px 48px",
      position:"relative", overflow:"hidden",
    }}>
      {/* Ambient glow effects */}
      <div style={{ position:"absolute", top:-160, right:-160, width:420, height:420, borderRadius:"50%", background:`radial-gradient(circle, rgba(124,111,224,0.25) 0%, transparent 65%)`, pointerEvents:"none" }} />
      <div style={{ position:"absolute", bottom:-100, left:-100, width:320, height:320, borderRadius:"50%", background:`radial-gradient(circle, rgba(30,58,123,0.4) 0%, transparent 65%)`, pointerEvents:"none" }} />
      <div style={{ position:"absolute", top:"40%", left:"50%", transform:"translate(-50%,-50%)", width:500, height:500, borderRadius:"50%", background:`radial-gradient(circle, rgba(124,111,224,0.10) 0%, transparent 60%)`, pointerEvents:"none" }} />

      {/* Logo aligné à gauche */}
      <div style={{ paddingTop:64, marginBottom:"auto" }}>
        <div onClick={onNext} style={{ cursor:"pointer", display:"inline-flex" }}>
          <ALANELogo size="lg" />
        </div>
      </div>

      {/* Hero content */}
      <div style={{
        flex:1, display:"flex", flexDirection:"column",
        justifyContent:"flex-end", paddingBottom:48,
        opacity:v?1:0, transform:v?"translateY(0)":"translateY(24px)",
        transition:"all 0.8s cubic-bezier(0.22,1,0.36,1)",
      }}>
        {/* Tag */}
        <div style={{ marginBottom:20 }}>
          <Badge color={C.violet}>Plateforme de services à la demande</Badge>
        </div>

        {/* Headline */}
        <h1 style={{
          color:C.text, fontSize:42, fontWeight:800,
          margin:"0 0 16px", lineHeight:1.1,
          fontFamily:font.display, letterSpacing:-1,
        }}>
          Le bon pro,<br/>
          <span style={{
            background:`linear-gradient(135deg, ${C.violet}, ${C.violetLight})`,
            WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent",
          }}>au bon moment.</span>
        </h1>

        <p style={{ color:C.textSub, fontSize:15, lineHeight:1.7, marginBottom:48, maxWidth:300 }}>
          Trouvez des prestataires qualifiés et vérifiés pour vos prestations ponctuelles — en quelques minutes.
        </p>

        {/* Stats pills */}
        <div style={{ display:"flex", gap:8, marginBottom:36, flexWrap:"wrap" }}>
          {[
            { v: prestaCount != null ? `${prestaCount}+` : "88+", l:"Prestataires" },
            { v:"7", l:"Secteurs" },
            { v:"<10min", l:"Réponse" },
          ].map(s=>(
            <div key={s.l} style={{
              background:"rgba(255,255,255,0.04)",
              border:`1px solid ${C.border}`,
              borderRadius:100, padding:"8px 16px",
              display:"flex", gap:8, alignItems:"center",
            }}>
              <span style={{ color:C.violet, fontWeight:800, fontSize:14 }}>{s.v}</span>
              <span style={{ color:C.textSub, fontSize:12 }}>{s.l}</span>
            </div>
          ))}
        </div>

        {offerActive && (
          <div style={{
            background:"linear-gradient(135deg, rgba(16,217,143,0.12), rgba(16,217,143,0.06))",
            border:"1px solid rgba(16,217,143,0.35)",
            borderRadius:r, padding:"12px 16px", marginBottom:20,
            display:"flex", gap:12, alignItems:"center",
          }}>
            <div style={{ width:36, height:36, borderRadius:10, background:"rgba(16,217,143,0.15)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0 }}>🎉</div>
            <div>
              <div style={{ fontWeight:700, color:"#10D98F", fontSize:13, marginBottom:2 }}>Offre de lancement</div>
              <div style={{ color:"rgba(255,255,255,0.5)", fontSize:11, lineHeight:1.5 }}>
                10 prestations gratuites · {spotsLeft != null ? `Plus que ${spotsLeft} place${spotsLeft>1?"s":""} sur 100` : "Réservé aux 100 premiers prestataires"}
              </div>
            </div>
          </div>
        )}

        <Btn full onClick={onNext} style={{ fontSize:16, padding:"17px", borderRadius:r+4, letterSpacing:0.3 }}>
          Commencer →
        </Btn>
        <p style={{ color:C.textMuted, fontSize:12, textAlign:"center", marginTop:14, letterSpacing:0.3 }}>
          Gratuit · Sans engagement · Résultats immédiats
        </p>
      </div>
    </div>
  );
}

function RoleScreen({ onSelect, onBack, notice }) {
  const [hov,setHov]=useState(null);
  const [showCGU,setShowCGU]=useState(false);
  const [prestaCount,setPrestaCount]=useState(null);
  useEffect(()=>{
    fetchPrestaCount().then(c=>{ if(c!=null) setPrestaCount(c); });
  },[]);
  const MAX_LAUNCH = 100;
  const spotsLeft = prestaCount != null ? Math.max(0, MAX_LAUNCH - prestaCount) : null;
  const offerActive = isLaunchPhase() && (spotsLeft == null || spotsLeft > 0);
  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(160deg, #050E20 0%, #0A1628 50%, #162547 100%)`, display:"flex", flexDirection:"column", padding:"60px 24px 48px", position:"relative", overflow:"hidden" }}>
      <div style={{ position:"absolute", top:-80, right:-80, width:280, height:280, borderRadius:"50%", background:`radial-gradient(circle, rgba(124,111,224,0.20) 0%, transparent 65%)`, pointerEvents:"none" }} />

      <div style={{ marginBottom:48 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:32 }}>
          <div onClick={onBack} style={{ cursor:"pointer" }}>
            <ALANELogo size="sm" />
          </div>
        </div>
        <p style={{ color:C.textMuted, fontSize:11, letterSpacing:1.5, textTransform:"uppercase", fontWeight:600, marginBottom:10 }}>Bienvenue</p>
        <h2 style={{ color:C.text, fontSize:32, fontWeight:800, margin:0, lineHeight:1.15, fontFamily:font.display }}>Vous êtes ?</h2>
        <p style={{ color:C.textSub, fontSize:14, marginTop:8 }}>Choisissez votre profil pour commencer</p>
      </div>

      {/* Une déconnexion ne doit jamais être muette : l'utilisateur se retrouvait
          ici sans savoir pourquoi, et le support n'avait aucune piste. */}
      {notice && (
        <div style={{ background:"rgba(242,94,94,0.12)", border:"1px solid rgba(242,94,94,0.45)", borderRadius:12, padding:"12px 14px", marginBottom:20 }}>
          <div style={{ color:"#F25E5E", fontWeight:700, fontSize:13, marginBottom:4 }}>Vous avez été déconnecté</div>
          <div style={{ color:C.textSub, fontSize:12, lineHeight:1.5 }}>{notice}</div>
        </div>
      )}

      <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
        {[
          { role:"client",      label:"Je suis client",          sub:"Je cherche des prestataires qualifiés", emoji:"🏢", color:C.violet },
          { role:"prestataire", label:"Je suis prestataire",     sub:"Je propose mes services",               emoji:"👷", color:C.accentGold },
        ].map(({ role, label, sub, emoji, color }) => (
          <div
            key={role}
            onClick={() => onSelect(role)}
            onMouseEnter={() => setHov(role)}
            onMouseLeave={() => setHov(null)}
            className="card-hover"
            style={{
              background: hov===role ? C.bgSurface : C.bgCard,
              border: `1px solid ${hov===role ? color+"55" : C.border}`,
              borderRadius: r+4,
              padding:"22px 20px",
              cursor:"pointer",
              display:"flex", alignItems:"center", gap:16,
              transition:"all 0.2s",
            }}
          >
            <div style={{
              width:56, height:56, borderRadius:r,
              background:`${color}15`,
              border:`1px solid ${color}25`,
              display:"flex", alignItems:"center", justifyContent:"center",
              fontSize:26, flexShrink:0,
            }}>{emoji}</div>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:700, color:C.text, fontSize:15, marginBottom:3 }}>{label}</div>
              <div style={{ color:C.textSub, fontSize:12, lineHeight:1.5 }}>{sub}</div>
            </div>
            <div style={{ color:C.textMuted, fontSize:18, fontWeight:300 }}>›</div>
          </div>
        ))}
      </div>

      {offerActive && (
        <div style={{
          background:"linear-gradient(135deg, rgba(16,217,143,0.10), rgba(16,217,143,0.04))",
          border:"1px solid rgba(16,217,143,0.30)",
          borderRadius:r, padding:"12px 16px", marginTop:24,
          display:"flex", gap:10, alignItems:"center",
        }}>
          <span style={{ fontSize:20, flexShrink:0 }}>🚀</span>
          <div>
            <div style={{ fontWeight:700, color:"#10D98F", fontSize:12, marginBottom:2 }}>Offre de lancement</div>
            <div style={{ color:"rgba(255,255,255,0.45)", fontSize:11, lineHeight:1.5 }}>
              10 prestations gratuites · {spotsLeft != null ? `Plus que ${spotsLeft} place${spotsLeft>1?"s":""} disponible${spotsLeft>1?"s":""}` : "Réservé aux 100 premiers prestataires"}
            </div>
          </div>
        </div>
      )}

      <p style={{ color:C.textMuted, fontSize:11, textAlign:"center", marginTop:16 }}>
        En continuant, vous acceptez nos <span onClick={()=>setShowCGU(true)} style={{ color:C.violet, cursor:"pointer", textDecoration:"underline" }}>CGU</span>
      </p>
      <div style={{ textAlign:"center", marginTop:12 }}>
        <button onClick={()=>onSelect("contact")} style={{ background:"transparent", border:"none", color:C.textSub, fontSize:12, cursor:"pointer", fontFamily:"inherit", textDecoration:"underline" }}>
          📩 Nous contacter sans créer de compte
        </button>
      </div>
      {showCGU && (
        <div onClick={()=>setShowCGU(false)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", zIndex:1000, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
          <div onClick={e=>e.stopPropagation()} style={{ background:"#0D1B3E", borderRadius:"20px 20px 0 0", padding:"24px 22px 40px", width:"100%", maxWidth:540, maxHeight:"80vh", overflowY:"auto", WebkitOverflowScrolling:"touch" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:18 }}>
              <div style={{ fontWeight:800, color:C.text, fontSize:16 }}>📋 Conditions Générales</div>
              <button onClick={()=>setShowCGU(false)} style={{ background:"transparent", border:"none", color:C.textSub, fontSize:20, cursor:"pointer", lineHeight:1 }}>✕</button>
            </div>
            {[
              { title:"1. Objet", text:"ALANE est une plateforme de mise en relation entre clients professionnels et prestataires qualifiés. L'utilisation de la plateforme implique l'acceptation des présentes conditions." },
              { title:"2. Inscription", text:"L'accès aux services nécessite la création d'un compte. Les informations fournies doivent être exactes et à jour. ALANE se réserve le droit de refuser ou suspendre tout compte." },
              { title:"3. Prestations", text:"Les prestations sont conclues directement entre clients et prestataires via la plateforme. ALANE agit en tant qu'intermédiaire et n'est pas partie au contrat de prestation." },
              { title:"4. Paiements", text:"Les paiements sont sécurisés via Stripe. Les fonds sont retenus jusqu'à validation mutuelle de la prestation. Toute contestation doit être soumise sous 48h en contactant le support." },
              { title:"5. Responsabilité", text:"ALANE ne peut être tenu responsable des dommages résultant de l'inexécution ou de la mauvaise exécution des prestations. Chaque prestataire est couvert par sa propre RC Professionnelle." },
              { title:"6. Données personnelles", text:"Les données sont traitées conformément au RGPD. Vous disposez d'un droit d'accès, de rectification et de suppression. Contact : direction@alane.fr" },
            ].map((s,i)=>(
              <div key={i} style={{ marginBottom:14 }}>
                <div style={{ fontWeight:700, color:C.text, fontSize:13, marginBottom:4 }}>{s.title}</div>
                <div style={{ color:C.textSub, fontSize:12, lineHeight:1.7 }}>{s.text}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}



// ── CONTACT PUBLIC (sans compte) ──────────────────────────────────
function PublicContactScreen({ onBack }) {
  const [name, setName]       = useState("");
  const [email, setEmail]     = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [hp, setHp]           = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent]       = useState(false);
  const [error, setError]     = useState("");

  const SUBJECTS = ["Question générale","Problème technique","Question commerciale","Partenariat","Presse / Médias","Autre"];

  const handleSend = async () => {
    if (!name.trim())    { setError("Votre nom est requis"); return; }
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError("Adresse email invalide"); return; }
    if (!subject)        { setError("Choisissez un sujet"); return; }
    if (!message.trim() || message.length < 20) { setError("Message trop court (20 caractères minimum)"); return; }
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, message, userEmail: email.trim(), userName: name.trim(), userId: "", _hp: hp }),
      });
      if (!res.ok) {
        const d = await res.json().catch(()=>({}));
        throw new Error(d.error || "Erreur serveur");
      }
      setSent(true);
    } catch(e) {
      setError(e.message || "Envoi échoué. Réessayez dans quelques instants.");
    }
    setLoading(false);
  };

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(160deg, #050E20 0%, #0A1628 60%, #162547 100%)`, display:"flex", flexDirection:"column" }}>
      <div style={{ padding:"52px 22px 24px", borderBottom:`1px solid rgba(255,255,255,0.07)` }}>
        <button onClick={onBack} aria-label="Retour à l'accueil" style={{ background:"transparent", border:"none", color:C.textSub, cursor:"pointer", fontSize:13, marginBottom:16, fontFamily:"inherit" }}>
          ← Retour
        </button>
        <div style={{ marginBottom:14 }}><ALANELogo size="sm" /></div>
        <h1 style={{ color:C.text, fontSize:24, fontWeight:800, margin:"0 0 6px", fontFamily:font.display }}>Nous contacter</h1>
        <p style={{ color:C.textSub, fontSize:13, margin:0, lineHeight:1.6 }}>Pas besoin de compte — notre équipe répond sous 24h ouvrées.</p>
      </div>

      <div style={{ flex:1, padding:"28px 22px 60px", overflowY:"auto" }}>
        {sent ? (
          <div style={{ textAlign:"center", paddingTop:48 }}>
            <div aria-hidden="true" style={{ fontSize:64, marginBottom:20 }}>✅</div>
            <h2 style={{ color:C.text, fontSize:22, fontWeight:800, margin:"0 0 10px" }}>Message envoyé !</h2>
            <p style={{ color:C.textSub, fontSize:14, lineHeight:1.7, maxWidth:300, margin:"0 auto 32px" }}>
              Nous vous répondrons à <strong style={{ color:C.white }}>{email}</strong> sous 24h ouvrées.
            </p>
            <button onClick={onBack} style={{ background:C.violet, color:"#fff", border:"none", borderRadius:r, padding:"14px 28px", fontSize:15, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
              ← Retour à l'accueil
            </button>
          </div>
        ) : (
          <>
            <div style={{ background:`${C.violet}12`, border:`1px solid ${C.violet}30`, borderRadius:r, padding:"13px 15px", marginBottom:24, display:"flex", gap:10 }}>
              <span aria-hidden="true" style={{ fontSize:18 }}>💬</span>
              <p style={{ color:C.textSub, fontSize:12, lineHeight:1.6, margin:0 }}>Question, partenariat, problème technique… remplissez le formulaire et nous vous répondrons par email.</p>
            </div>

            {/* Champ honeypot anti-spam — invisible pour les humains, rempli uniquement par les bots */}
            <input aria-hidden="true" tabIndex={-1} name="_hp" value={hp} onChange={e=>setHp(e.target.value)} style={{ position:"absolute", left:"-9999px", width:1, height:1, overflow:"hidden" }} />

            <div style={{ marginBottom:16 }}>
              <label htmlFor="pc-name" style={{ display:"block", fontSize:11, color:C.textSub, fontWeight:600, marginBottom:7, textTransform:"uppercase", letterSpacing:0.8 }}>Votre nom *</label>
              <input id="pc-name" type="text" value={name} onChange={e=>setName(e.target.value)} placeholder="Prénom Nom" autoComplete="name"
                style={{ width:"100%", padding:"13px 16px", borderRadius:r, border:`1px solid ${C.border}`, fontSize:14, fontFamily:"inherit", color:C.text, background:"#112240", boxSizing:"border-box", outline:"none" }} />
            </div>

            <div style={{ marginBottom:16 }}>
              <label htmlFor="pc-email" style={{ display:"block", fontSize:11, color:C.textSub, fontWeight:600, marginBottom:7, textTransform:"uppercase", letterSpacing:0.8 }}>Votre email *</label>
              <input id="pc-email" type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="vous@exemple.com" autoComplete="email"
                style={{ width:"100%", padding:"13px 16px", borderRadius:r, border:`1px solid ${C.border}`, fontSize:14, fontFamily:"inherit", color:C.text, background:"#112240", boxSizing:"border-box", outline:"none" }} />
            </div>

            <div style={{ marginBottom:20 }}>
              <label style={{ display:"block", fontSize:11, color:C.textSub, fontWeight:600, marginBottom:8, textTransform:"uppercase", letterSpacing:0.8 }}>Sujet *</label>
              <div role="group" aria-label="Choix du sujet" style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
                {SUBJECTS.map(s=>(
                  <button key={s} onClick={()=>setSubject(s)} aria-pressed={subject===s}
                    style={{ padding:"9px 14px", borderRadius:20, border:`2px solid ${subject===s?C.violet:C.border}`, background:subject===s?`${C.violet}20`:"transparent", color:subject===s?C.violet:C.textSub, fontWeight:subject===s?700:500, fontSize:12, cursor:"pointer", fontFamily:"inherit", transition:"all 0.2s" }}>
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom:24 }}>
              <label htmlFor="pc-msg" style={{ display:"block", fontSize:11, color:C.textSub, fontWeight:600, marginBottom:8, textTransform:"uppercase", letterSpacing:0.8 }}>Votre message *</label>
              <textarea id="pc-msg" value={message} onChange={e=>setMessage(e.target.value)}
                placeholder="Décrivez votre demande en détail…"
                style={{ width:"100%", padding:"14px", borderRadius:r, border:`1px solid ${C.border}`, fontSize:14, fontFamily:"inherit", resize:"none", height:140, boxSizing:"border-box", outline:"none", color:C.text, background:"#112240", lineHeight:1.6 }}
              />
              <div style={{ textAlign:"right", color:C.textMuted, fontSize:11, marginTop:4 }}>{message.length} / 5000</div>
            </div>

            {error && <div role="alert" style={{ background:"#F25E5E22", border:"1px solid #F25E5E55", borderRadius:r, padding:"10px 14px", marginBottom:16, color:"#F25E5E", fontSize:13 }}>{error}</div>}

            <button onClick={handleSend} disabled={loading} aria-busy={loading}
              style={{ width:"100%", background:loading?"rgba(124,111,224,0.5)":C.violet, color:"#fff", border:"none", borderRadius:r, padding:"16px", fontSize:15, fontWeight:700, cursor:loading?"not-allowed":"pointer", fontFamily:"inherit", boxShadow:loading?"none":`0 8px 24px ${C.violet}44`, transition:"all 0.2s" }}>
              {loading ? "Envoi en cours…" : "📤 Envoyer mon message"}
            </button>

            <p style={{ textAlign:"center", color:C.textMuted, fontSize:11, marginTop:20, lineHeight:1.7 }}>
              Vos données sont utilisées uniquement pour répondre à votre demande et ne sont pas partagées.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

// ── EN ATTENTE DE VALIDATION ──────────────────────────────────────
function PendingApprovalScreen({ onLogout, onApproved }) {
  const [userEmail, setUserEmail] = useState("");
  const [checking, setChecking] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [manualChecking, setManualChecking] = useState(false);
  const [manualMsg, setManualMsg] = useState("");

  useEffect(()=>{
    supabase.auth.getUser().then(({ data })=>{
      if(data?.user){ setUserEmail(data.user.email||""); setHasSession(true); }
    });
  },[]);

  // Polling uniquement si session active (login avec statut pending)
  useEffect(()=>{
    const onApprovedRef = { current: onApproved };
    onApprovedRef.current = onApproved;
    const interval = setInterval(async () => {
      const { data: sd } = await supabase.auth.getSession();
      const user = sd?.session?.user;
      if (!user) { clearInterval(interval); return; }
      const { data: profile } = await supabase.from("profiles").select("status,role").eq("id", user.id).single();
      if (profile?.status === "approved") {
        clearInterval(interval);
        setChecking(true);
        onApprovedRef.current(profile.role);
      }
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleManualCheck = async () => {
    setManualChecking(true); setManualMsg("");
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setManualMsg("Session expirée. Déconnectez-vous puis reconnectez-vous.");
      setManualChecking(false); return;
    }
    const { data: profile } = await supabase.from("profiles").select("status,role").eq("id", user.id).single();
    if (profile?.status === "approved") {
      setChecking(true);
      onApproved(profile.role);
    } else if (profile?.status === "rejected") {
      setManualMsg("Votre compte a été refusé. Contactez le support.");
    } else {
      setManualMsg("Votre compte est toujours en cours de vérification.");
    }
    setManualChecking(false);
  };

  const steps = [
    { icon:"✅", label:"Inscription reçue",      sub:"Votre dossier a bien été enregistré",          done:true,  active:false },
    { icon:"🔍", label:"Vérification en cours",  sub:"Délai habituel : 24 à 48h ouvrés",            done:false, active:true  },
    { icon:"🎉", label:"Accès accordé",           sub:"Vous recevrez un email de confirmation",      done:false, active:false },
  ];

  return (
    <div style={{ minHeight:"100vh", background:"linear-gradient(160deg,#050E20,#0A1628,#162547)", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"32px 24px", textAlign:"center" }}>
      <div style={{ width:80, height:80, borderRadius:24, background:checking?"rgba(16,217,143,0.15)":"rgba(124,111,224,0.15)", border:`2px solid ${checking?"#10D98F":"rgba(124,111,224,0.4)"}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:36, marginBottom:24, transition:"all 0.4s" }}>{checking?"🎉":"⏳"}</div>
      <h2 style={{ color:"#fff", fontSize:24, fontWeight:800, fontFamily:"'Playfair Display',serif", margin:"0 0 10px" }}>{checking ? "Compte approuvé !" : "Compte en attente"}</h2>
      <p style={{ color:"rgba(255,255,255,0.55)", fontSize:14, lineHeight:1.7, maxWidth:300, margin:"0 0 28px" }}>
        {checking ? "Votre compte a été validé. Redirection en cours…" : "Vos informations sont en cours de vérification. Notre équipe reviendra vers vous très rapidement."}
      </p>

      {/* Timeline */}
      <div style={{ width:"100%", maxWidth:320, marginBottom:28, textAlign:"left" }}>
        {steps.map((step, i) => (
          <div key={i} style={{ display:"flex", alignItems:"flex-start", gap:12 }}>
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", flexShrink:0 }}>
              <div style={{ width:38, height:38, borderRadius:"50%", background:step.done?"rgba(16,217,143,0.2)":step.active?"rgba(124,111,224,0.2)":"rgba(255,255,255,0.06)", border:`2px solid ${step.done?"#10D98F":step.active?"#7C6FE0":"rgba(255,255,255,0.12)"}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 }}>{step.icon}</div>
              {i < steps.length-1 && <div style={{ width:2, height:26, background:step.done?"rgba(16,217,143,0.35)":"rgba(255,255,255,0.08)", margin:"4px 0" }} />}
            </div>
            <div style={{ paddingTop:9, paddingBottom:i<steps.length-1?0:0 }}>
              <div style={{ color:step.done?"#10D98F":step.active?"#fff":"rgba(255,255,255,0.3)", fontWeight:step.active||step.done?700:400, fontSize:13 }}>{step.label}</div>
              <div style={{ color:"rgba(255,255,255,0.35)", fontSize:11, marginTop:1, marginBottom:i<steps.length-1?16:0 }}>{step.sub}</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ background:"rgba(124,111,224,0.1)", border:"1px solid rgba(124,111,224,0.25)", borderRadius:14, padding:"14px 20px", marginBottom:24, width:"100%", maxWidth:320 }}>
        <div style={{ fontSize:11, color:"rgba(255,255,255,0.4)", marginBottom:4 }}>Notification envoyée à</div>
        <div style={{ fontSize:14, fontWeight:700, color:"#fff" }}>{userEmail||"votre email"}</div>
        <div style={{ fontSize:11, color:"rgba(255,255,255,0.3)", marginTop:6 }}>Vérifiez vos spams si vous ne recevez rien</div>
      </div>

      {/* URSSAF nudge pendant l'attente */}
      <a href="https://procedures.inpi.fr/?/" target="_blank" rel="noopener noreferrer" style={{ display:"flex", alignItems:"center", gap:12, background:"rgba(255,210,80,0.06)", border:"1px solid rgba(255,210,80,0.2)", borderRadius:14, padding:"14px 16px", marginBottom:20, textDecoration:"none", width:"100%", maxWidth:320, boxSizing:"border-box" }}>
        <div style={{ width:40, height:40, borderRadius:12, background:"#FFD250", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, flexShrink:0 }}>🏛️</div>
        <div style={{ flex:1, textAlign:"left" }}>
          <div style={{ color:"#FFD250", fontWeight:700, fontSize:13, marginBottom:3 }}>Profitez de l'attente !</div>
          <div style={{ color:"rgba(255,255,255,0.5)", fontSize:11, lineHeight:1.5 }}>Créez votre auto-entreprise gratuitement sur le guichet officiel de l'INPI →</div>
        </div>
      </a>

      <button onClick={handleManualCheck} disabled={manualChecking || checking} style={{ background:"rgba(124,111,224,0.15)", border:"1px solid rgba(124,111,224,0.4)", borderRadius:12, padding:"12px 28px", color:"#fff", fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"inherit", marginBottom:10, width:"100%", maxWidth:320 }}>
        {manualChecking ? "Vérification…" : "🔄 Vérifier mon statut"}
      </button>
      {manualMsg && <div style={{ fontSize:12, color: manualMsg.includes("refusé") ? "#F25E5E" : "rgba(255,255,255,0.5)", marginBottom:14, maxWidth:300 }}>{manualMsg}</div>}
      {!hasSession && <div style={{ fontSize:12, color:"rgba(255,255,255,0.4)", marginBottom:14, maxWidth:300, lineHeight:1.6, textAlign:"center" }}>
        Déconnectez-vous puis reconnectez-vous pour vérifier votre statut.
      </div>}
      <button onClick={onLogout} style={{ background:"transparent", border:"1px solid rgba(255,255,255,0.15)", borderRadius:12, padding:"12px 28px", color:"rgba(255,255,255,0.5)", fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
        Se déconnecter
      </button>
    </div>
  );
}

// ── RÉGLAGES ──────────────────────────────────────────────────────
// ── RESET PASSWORD ────────────────────────────────────────────────
// ── HOME ─────────────────────────────────────────────────────────
// Refonte hi-fi v12 — Playfair Display + DM Sans, palette navy/violet

// ── CATALOGUE style Uber Eats ─────────────────────────────────────
// ── HOOK : vrais prestataires depuis Supabase ─────────────────────
// ── LEAFLET MAP ───────────────────────────────────────────────────
// ── SECTOR DETAIL ─────────────────────────────────────────────────
// ── PROFILE ───────────────────────────────────────────────────────
// ── BOOKING ───────────────────────────────────────────────────────

// ── SUIVI EN TEMPS RÉEL ───────────────────────────────────────────


// ── DOUBLE VALIDATION ─────────────────────────────────────────────
// ── MESSAGERIE ────────────────────────────────────────────────────

// ── NOTIFICATIONS ─────────────────────────────────────────────────

// ── FAVORIS ───────────────────────────────────────────────────────
// ── FAQ ──────────────────────────────────────────────────────────
// ── PARRAINAGE ────────────────────────────────────────────────────

// ── NAV BARS ──────────────────────────────────────────────────────
function ClientNav({ active, onNavigate, unreadCount }) {
  const tabs = [
    {id:"home",            icon:"🏠", label:"Accueil" },
    {id:"mission_history", icon:"📋", label:"Prestations"},
    {id:"search_filters",  icon:"🔍", label:"Chercher"},
    {id:"dashboard",       icon:"👤", label:"Compte"  },
    {id:"settings",        icon:"⚙️", label:"Réglages"},
  ];
  return (
    <nav aria-label="Navigation client" style={{
      position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)",
      width:"100%", maxWidth:430,
      background:"#0D1B3E",
      borderTop:`1px solid ${C.border}`,
      display:"flex", padding:"10px 0 20px",
      zIndex:100,
      backdropFilter:"blur(20px)",
      WebkitBackdropFilter:"blur(20px)",
    }}>
      {tabs.map(t=>{
        const active2 = active===t.id;
        const badgeCount = t.id==="mission_history" && unreadCount > 0 ? unreadCount : 0;
        return (
          <button key={t.id} onClick={()=>onNavigate(t.id)}
            aria-current={active2 ? "page" : undefined}
            aria-label={badgeCount > 0 ? `${t.label} (${badgeCount > 9 ? "9+" : badgeCount} non lu${badgeCount > 1 ? "s" : ""})` : t.label}
            style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:4, background:"none", border:"none", cursor:"pointer", padding:"2px 0", fontFamily:"inherit" }}>
            <span aria-hidden="true" style={{ fontSize:20, opacity:active2?1:0.35, transition:"opacity 0.2s", position:"relative" }}>
              {t.icon}
              {badgeCount > 0 && (
                <div aria-hidden="true" style={{ position:"absolute", top:-2, right:-2, background:"#E74C3C", borderRadius:"50%", width:16, height:16, fontSize:9, fontWeight:900, color:"#fff", display:"flex", alignItems:"center", justifyContent:"center" }}>{badgeCount > 9 ? "9+" : badgeCount}</div>
              )}
            </span>
            <span style={{ fontSize:9, fontWeight:active2?700:400, color:active2?C.violet:C.textMuted, letterSpacing:0.4, textTransform:"uppercase", transition:"color 0.2s" }}>{t.label}</span>
            {active2 && <div aria-hidden="true" style={{ width:20, height:2, borderRadius:1, background:C.violet, marginTop:1 }} />}
          </button>
        );
      })}
    </nav>
  );
}

function PrestaNav({ active, onNavigate, unreadCount }) {
  const tabs = [
    {id:"p_home",          icon:"🏠", label:"Accueil"   },
    {id:"p_missions",      icon:"📋", label:"Prestations"  },
    {id:"abonnement_presta",icon:"💎", label:"Abonnement"},
    {id:"p_dashboard",     icon:"👤", label:"Profil"    },
    {id:"settings",        icon:"⚙️", label:"Réglages"  },
  ];
  return (
    <nav aria-label="Navigation prestataire" style={{
      position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)",
      width:"100%", maxWidth:430,
      background:"#0D1B3E",
      borderTop:`1px solid ${C.border}`,
      display:"flex", padding:"10px 0 20px",
      zIndex:100,
    }}>
      {tabs.map(t=>{
        const active2 = active===t.id;
        const badgeCount = t.id==="p_missions" && unreadCount > 0 ? unreadCount : 0;
        return (
          <button key={t.id} onClick={()=>onNavigate(t.id)}
            aria-current={active2 ? "page" : undefined}
            aria-label={badgeCount > 0 ? `${t.label} (${badgeCount > 9 ? "9+" : badgeCount} non lu${badgeCount > 1 ? "s" : ""})` : t.label}
            style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:4, background:"none", border:"none", cursor:"pointer", padding:"2px 0", fontFamily:"inherit" }}>
            <span aria-hidden="true" style={{ fontSize:20, opacity:active2?1:0.35, transition:"opacity 0.2s", position:"relative" }}>
              {t.icon}
              {badgeCount > 0 && (
                <div aria-hidden="true" style={{ position:"absolute", top:-2, right:-2, background:"#E74C3C", borderRadius:"50%", width:16, height:16, fontSize:9, fontWeight:900, color:"#fff", display:"flex", alignItems:"center", justifyContent:"center" }}>{badgeCount > 9 ? "9+" : badgeCount}</div>
              )}
            </span>
            <span style={{ fontSize:9, fontWeight:active2?700:400, color:active2?C.accent:C.textMuted, letterSpacing:0.4, textTransform:"uppercase", transition:"color 0.2s" }}>{t.label}</span>
            {active2 && <div aria-hidden="true" style={{ width:20, height:2, borderRadius:1, background:C.accent, marginTop:1 }} />}
          </button>
        );
      })}
    </nav>
  );
}

// ── MODE ÉQUIPE ───────────────────────────────────────────────────
// ── MINI COMPOSANTS (évite useState dans .map) ───────────────────


// ── COMMENT ÇA MARCHE ────────────────────────────────────────────
// ── ONBOARDING CLIENT COMPLET ─────────────────────────────────────
// ── CONTRAT DE MISSION ────────────────────────────────────────────

// ── CGU & POLITIQUE ───────────────────────────────────────────────
// ── FICHE DE PAIE ─────────────────────────────────────────────────
// ── HISTORIQUE MISSIONS CLIENT ────────────────────────────────────
// ── STATUT EN LIGNE PRESTATAIRE ───────────────────────────────────
function OnlineStatusWidget({ online, onToggle }) {
  return (
    <div onClick={onToggle} style={{ display:"flex", alignItems:"center", gap:10, background: online?`${C.success}18`:`${C.gray}15`, border:`2px solid ${online?C.success:C.grayLight}`, borderRadius:r, padding:"12px 16px", cursor:"pointer", transition:"all 0.3s", marginBottom:14 }}>
      <div style={{ width:14, height:14, borderRadius:"50%", background:online?C.success:C.gray, boxShadow:online?`0 0 8px ${C.success}`:"none", transition:"all 0.3s" }} />
      <div style={{ flex:1 }}>
        <div style={{ fontWeight:800, color:online?C.success:C.gray, fontSize:14 }}>{online?"En ligne — Je reçois des prestations":"Hors ligne — Je ne reçois pas de prestations"}</div>
        <div style={{ color:C.textSub, fontSize:11, marginTop:1 }}>{online?"Vous apparaissez dans les recherches clients":"Activez pour recevoir des propositions"}</div>
      </div>
      <div style={{ width:44, height:24, borderRadius:12, background:online?C.success:C.grayLight, position:"relative", transition:"background 0.3s" }}>
        <div style={{ width:20, height:20, borderRadius:"50%", background:"#0D1B3E", position:"absolute", top:2, left:online?22:2, transition:"left 0.3s", boxShadow:"0 1px 4px rgba(0,0,0,0.2)" }} />
      </div>
    </div>
  );
}

// ── DESKTOP SIDEBAR ───────────────────────────────────────────────
function DesktopSidebar({ screen, role, onNavigate, onlineStatus, onToggleOnline }) {
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");

  useEffect(()=>{
    supabase.auth.getUser().then(({ data })=>{
      const user = data?.user;
      if(!user) return;
      setUserEmail(user.email||"");
      supabase.from("profiles").select("prenom,nom").eq("id",user.id).single()
        .then(({ data:p })=>{ if(p) setUserName(`${p.prenom||""} ${p.nom||""}`.trim()); });
    });
  },[]);

  const clientNav = [
    { id:"home",           icon:"🏠", label:"Accueil"         },
    { id:"mission_history",icon:"📋", label:"Mes prestations"    },
    { id:"search_filters", icon:"🔍", label:"Rechercher"      },
    { id:"team_booking",   icon:"👥", label:"Équipe"          },
    { id:"favorites",      icon:"❤️", label:"Favoris"         },
    { id:"notifications",  icon:"🔔", label:"Notifications"   },
    { id:"referral",       icon:"🎁", label:"Parrainage"      },
    { id:"dashboard",      icon:"👤", label:"Mon compte"      },
  ];
  const prestaNav = [
    { id:"p_home",     icon:"🏠", label:"Accueil"      },
    { id:"p_missions", icon:"📋", label:"Prestations"     },
    { id:"calendar",   icon:"📅", label:"Planning"     },
    { id:"notifications",icon:"🔔",label:"Notifications"},
    { id:"p_dashboard",icon:"👤", label:"Mon profil"   },
  ];
  const nav = role === "prestataire" ? prestaNav : clientNav;
  const accentColor = role === "prestataire" ? C.accent : C.violet;

  return (
    <nav aria-label="Navigation principale" style={{
      width: 240, flexShrink: 0,
      background: `linear-gradient(180deg, ${C.navy} 0%, ${C.navyMid} 100%)`,
      height: "100vh", display: "flex", flexDirection: "column",
      borderRight: `1px solid rgba(255,255,255,0.06)`,
      boxShadow: "4px 0 24px rgba(0,0,0,0.15)",
    }}>
      {/* Logo */}
      <div style={{ padding: "28px 24px 20px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        <button onClick={()=>onNavigate(role==="prestataire"?"p_home":"home")} aria-label="Aller à l'accueil" style={{ cursor:"pointer", display:"inline-flex", background:"none", border:"none", padding:0 }}>
          <ALANELogo size="sm" />
        </button>
        {role && (
          <div style={{ marginTop:12, background:"rgba(255,255,255,0.07)", borderRadius:10, padding:"8px 12px", display:"flex", alignItems:"center", gap:8 }}>
            <div style={{ fontSize:18 }}>{role==="prestataire"?"👷":"🏢"}</div>
            <div style={{ minWidth:0 }}>
              <div style={{ color:C.white, fontSize:12, fontWeight:700, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{userName||userEmail||"Mon compte"}</div>
              <div style={{ color:"rgba(255,255,255,0.4)", fontSize:10 }}>{role==="prestataire"?"Prestataire":"Client"}</div>
            </div>
          </div>
        )}
      </div>

      {/* Navigation */}
      <ul role="list" style={{ flex:1, padding:"16px 12px", overflowY:"auto", WebkitOverflowScrolling:"touch", margin:0, listStyle:"none" }}>
        {nav.map(item => {
          const active = screen === item.id;
          return (
            <li key={item.id}>
              <button
                onClick={() => onNavigate(item.id)}
                aria-current={active ? "page" : undefined}
                aria-label={item.label}
                style={{
                  width:"100%", display:"flex", alignItems:"center", gap:10, padding:"11px 14px",
                  borderRadius:12, marginBottom:4, cursor:"pointer",
                  background: active ? `${accentColor}22` : "transparent",
                  border: `1px solid ${active ? accentColor+"44" : "transparent"}`,
                  transition:"all 0.18s", fontFamily:"inherit",
                }}
                onMouseEnter={e=>{ if(!active) e.currentTarget.style.background="rgba(255,255,255,0.06)"; }}
                onMouseLeave={e=>{ if(!active) e.currentTarget.style.background="transparent"; }}
              >
                <span aria-hidden="true" style={{ fontSize:17 }}>{item.icon}</span>
                <span style={{ fontSize:13, fontWeight:active?700:400, color:active?C.white:"rgba(255,255,255,0.55)", transition:"color 0.18s" }}>{item.label}</span>
                {active && <div style={{ marginLeft:"auto", width:5, height:5, borderRadius:"50%", background:accentColor }} />}
              </button>
            </li>
          );
        })}
      </ul>

      {/* Bottom actions */}
      <div style={{ padding:"12px", borderTop:"1px solid rgba(255,255,255,0.07)" }}>
        {role==="prestataire" && (
          <button onClick={onToggleOnline} aria-pressed={onlineStatus} aria-label={onlineStatus ? "Passer hors ligne" : "Passer en ligne"} style={{ width:"100%", display:"flex", alignItems:"center", gap:8, padding:"10px 14px", borderRadius:12, cursor:"pointer", background:onlineStatus?`${C.success}22`:"rgba(255,255,255,0.05)", border:`1px solid ${onlineStatus?C.success+"44":"rgba(255,255,255,0.1)"}`, marginBottom:8, transition:"all 0.2s", fontFamily:"inherit" }}>
            <div style={{ width:9, height:9, borderRadius:"50%", background:onlineStatus?C.success:C.gray, boxShadow:onlineStatus?`0 0 6px ${C.success}`:"none" }} />
            <span style={{ fontSize:12, color:onlineStatus?C.success:"rgba(255,255,255,0.4)", fontWeight:600 }}>{onlineStatus?"En ligne":"Hors ligne"}</span>
            <div aria-hidden="true" style={{ marginLeft:"auto", width:32, height:18, borderRadius:9, background:onlineStatus?C.success:C.gray, position:"relative", transition:"all 0.3s" }}>
              <div style={{ width:14, height:14, borderRadius:"50%", background:"#0D1B3E", position:"absolute", top:2, left:onlineStatus?16:2, transition:"left 0.3s" }} />
            </div>
          </button>
        )}
        <button onClick={()=>onNavigate("settings")}
          aria-current={screen==="settings" ? "page" : undefined}
          aria-label="Réglages"
          style={{ width:"100%", display:"flex", alignItems:"center", gap:10, padding:"10px 14px", borderRadius:12, cursor:"pointer", marginBottom:6,
            background: screen==="settings" ? `${accentColor}22` : "rgba(255,255,255,0.05)",
            border: `1px solid ${screen==="settings" ? accentColor+"55" : "rgba(255,255,255,0.1)"}`,
            transition:"all 0.18s", fontFamily:"inherit" }}
          onMouseEnter={e=>{ if(screen!=="settings") e.currentTarget.style.background="rgba(255,255,255,0.1)"; }}
          onMouseLeave={e=>{ if(screen!=="settings") e.currentTarget.style.background="rgba(255,255,255,0.05)"; }}
        >
          <span aria-hidden="true" style={{ fontSize:16 }}>⚙️</span>
          <span style={{ fontSize:13, fontWeight: screen==="settings"?700:500, color: screen==="settings"?C.white:"rgba(255,255,255,0.75)" }}>Réglages</span>
          {screen==="settings" && <div style={{ marginLeft:"auto", width:5, height:5, borderRadius:"50%", background:accentColor }} />}
        </button>
        <button onClick={async()=>{ await supabase.auth.signOut(); onNavigate("role"); }} aria-label="Se déconnecter" style={{ width:"100%", display:"flex", alignItems:"center", gap:8, padding:"9px 14px", borderRadius:10, cursor:"pointer", background:"rgba(242,94,94,0.08)", border:"1px solid rgba(242,94,94,0.2)", fontFamily:"inherit" }}
          onMouseEnter={e=>e.currentTarget.style.background="rgba(242,94,94,0.18)"}
          onMouseLeave={e=>e.currentTarget.style.background="rgba(242,94,94,0.08)"}
        >
          <span aria-hidden="true" style={{ fontSize:14 }}>🚪</span>
          <span style={{ fontSize:11, color:"#F25E5E", fontWeight:600 }}>Se déconnecter</span>
        </button>
      </div>
    </nav>
  );
}

// ── RESPONSIVE LAYOUT WRAPPER ─────────────────────────────────────
function ResponsiveLayout({ children, screen, role, isLoggedIn, onNavigate, showClientNav, showPrestaNav, onlineStatus, onToggleOnline, unreadCount }) {
  const { isMobile } = useResponsive();

  const hybridBanner = !["bo_login","bo_dashboard"].includes(screen) && (
    <div style={{ background:"linear-gradient(90deg,#4F46E5,#7C3AED)", padding:"6px 16px", display:"flex", alignItems:"center", justifyContent:"center", gap:8, flexShrink:0 }}>
      <AlaneIcon size={16}/>
      <span style={{ fontSize:11, fontWeight:700, color:"#fff", letterSpacing:0.5 }}>ALANE · Tarif transparent · Prix affiché = Prix réel</span>
    </div>
  );



  if (isMobile) {
    return (
      <div style={{ width:"100%", height:"100vh", display:"flex", flexDirection:"column", fontFamily:"’DM Sans’,system-ui,sans-serif", background:C.bg, position:"relative", overflow:"hidden" }}>
        {hybridBanner}
        {(showClientNav || showPrestaNav) && (
          <div style={{ flexShrink:0, padding:"10px 18px", borderBottom:`1px solid rgba(255,255,255,0.06)`, display:"flex", alignItems:"center", background:"#050E20" }}>
            <button onClick={()=>onNavigate(role==="prestataire"?"p_home":"home")} aria-label="Aller à l'accueil" style={{ cursor:"pointer", background:"none", border:"none", padding:0 }}>
              <ALANELogo size="sm" />
            </button>
          </div>
        )}
        <div style={{ flex:1, overflowY:"auto", overflowX:"hidden", WebkitOverflowScrolling:"touch" }}>
          {children}
        </div>
        {showClientNav && <ClientNav active={screen} onNavigate={onNavigate} unreadCount={unreadCount} />}
        {showPrestaNav && <PrestaNav active={screen} onNavigate={onNavigate} unreadCount={unreadCount} />}
      </div>
    );
  }

  // Desktop layout
  const showSidebar = isLoggedIn && !["splash","role","auth_client","auth_presta","how_client","how_presta","client_onboarding","presta_onboarding","presta_pending","pending_approval","bo_login","bo_dashboard","reset_password"].includes(screen);

  const isPreLogin = !["bo_login","bo_dashboard"].includes(screen) && !showSidebar;

  // Two-column layout for pre-login screens on desktop
  if (isPreLogin) {
    return (
      <div style={{ display:"flex", height:"100vh", background:C.bg, fontFamily:"’Segoe UI’,system-ui,sans-serif", position:"relative" }}>
        {/* Left panel — branding */}
        <div style={{ width:"42%", minWidth:380, background:"linear-gradient(160deg,#050E20 0%,#0D1B3E 40%,#1E3A7B 100%)", display:"flex", flexDirection:"column", justifyContent:"space-between", padding:"52px 48px", position:"relative", overflow:"hidden", flexShrink:0 }}>
          {/* Decorative circles */}
          <div style={{ position:"absolute", top:-80, right:-80, width:320, height:320, borderRadius:"50%", background:"rgba(124,111,224,0.08)" }} />
          <div style={{ position:"absolute", bottom:-60, left:-60, width:240, height:240, borderRadius:"50%", background:"rgba(240,180,41,0.06)" }} />

          {/* Logo */}
          <div>
            <div style={{ fontSize:32, fontWeight:900, letterSpacing:2, marginBottom:8 }}>
              <span style={{ color:C.violet }}>A</span>
              <span style={{ color:C.white }}>LAN</span>
              <span style={{ color:C.accentGold }}>E</span>
            </div>
            <div style={{ color:"rgba(255,255,255,0.4)", fontSize:12, letterSpacing:2, textTransform:"uppercase", fontWeight:600 }}>Plateforme de services à la demande</div>
          </div>

          {/* Tagline */}
          <div>
            <h1 style={{ color:C.white, fontSize:38, fontWeight:900, lineHeight:1.2, margin:"0 0 20px", fontFamily:"’DM Sans’,system-ui,sans-serif" }}>
              Le bon pro,<br/>
              <span style={{ color:C.accentGold }}>au bon moment.</span>
            </h1>
            <p style={{ color:"rgba(255,255,255,0.6)", fontSize:15, lineHeight:1.7, margin:"0 0 36px", maxWidth:320 }}>
              Trouvez des prestataires qualifiés et vérifiés pour vos prestations ponctuelles — en quelques minutes.
            </p>
            {/* Value props */}
            {[
              { icon:"✅", text:"Prestataires vérifiés et approuvés" },
              { icon:"🔒", text:"Paiement sécurisé via Stripe" },
              { icon:"⭐", text:"Notes et avis après chaque prestation" },
              { icon:<AlaneIcon size={15}/>, text:"Tarif transparent — prix affiché = prix réel" },
            ].map((v,i) => (
              <div key={i} style={{ display:"flex", gap:12, alignItems:"center", marginBottom:14 }}>
                <div style={{ width:32, height:32, borderRadius:10, background:"rgba(255,255,255,0.07)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:15, flexShrink:0 }}>{v.icon}</div>
                <span style={{ color:"rgba(255,255,255,0.75)", fontSize:13, fontWeight:500 }}>{v.text}</span>
              </div>
            ))}
          </div>

          {/* Stats */}
          <div style={{ display:"flex", gap:24 }}>
            {[["88+","Prestataires"],["7","Secteurs"],["<10min","Réponse"]].map(([v,l])=>(
              <div key={l}>
                <div style={{ color:C.white, fontWeight:900, fontSize:22 }}>{v}</div>
                <div style={{ color:"rgba(255,255,255,0.4)", fontSize:11, marginTop:2 }}>{l}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Right panel — form */}
        <div style={{ flex:1, overflowY:"auto", overflowX:"hidden", display:"flex", flexDirection:"column", WebkitOverflowScrolling:"touch" }}>
          {hybridBanner}
          <div style={{ flex:1, display:"flex", flexDirection:"column", maxWidth:560, width:"100%", margin:"0 auto", padding:"0 48px" }}>
            {children}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display:"flex", height:"100vh", background:C.bg, fontFamily:"’Segoe UI’,system-ui,sans-serif", position:"relative" }}>
      {showSidebar && (
        <DesktopSidebar screen={screen} role={role} onNavigate={onNavigate} onlineStatus={onlineStatus} onToggleOnline={onToggleOnline} />
      )}
      <div style={{ flex:1, overflowY:"auto", overflowX:"hidden", display:"flex", flexDirection:"column", WebkitOverflowScrolling:"touch" }}>
        {hybridBanner}
        {/* Desktop content wrapper */}
        <div style={{
          maxWidth: showSidebar ? 900 : screen === "bo_dashboard" ? "none" : 480,
          width:"100%",
          margin: "0 auto",
          flex:1,
          padding: showSidebar ? "0 0 40px" : "0",
        }}>
          {children}
        </div>
      </div>
    </div>
  );
}



// ── NOTIFICATIONS VIVANTES ───────────────────────────────────────
// ── TIMELINE DE MISSION ───────────────────────────────────────────
// ── ÉCRAN NOTATION ────────────────────────────────────────────────
// ── UPLOAD DOCUMENTS ─────────────────────────────────────────────

// ── OFFRE DE LANCEMENT ───────────────────────────────────────────

// ── ABONNEMENT PRESTATAIRE ────────────────────────────────────────
// ── MISSION BROADCAST SCREEN ─────────────────────────────────────
// ── APP ROOT ──────────────────────────────────────────────────────
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export default function App() {
  const [screen,setScreen]=useState(()=>{
    try {
      // Flux custom reset (reset_token dans la query string)
      const sp = new URLSearchParams(window.location.search);
      if(sp.get("reset_token")) return "reset_password";
      // Flux Supabase implicit (type=recovery dans le hash)
      const hp = new URLSearchParams(window.location.hash.slice(1));
      if(hp.get("type")==="recovery") return "reset_password";
      // L'URL décide de l'écran, sauf pour ceux qui attendent un objet en mémoire
      // (prestataire, mission…) : ceux-là ne sont pas reconstructibles depuis un chemin seul.
      const fromPath = screenForPath(window.location.pathname);
      if(fromPath && !NEEDS_DATA.has(fromPath)) return fromPath;
    } catch{}
    return "splash";
  });
  // Passe à true dès que Supabase a tranché sur la session (event INITIAL_SESSION).
  // Les gardes d'accès attendent ce signal, sinon un utilisateur connecté qui ouvre
  // /dashboard serait renvoyé vers la connexion avant que sa session soit résolue.
  // Écran d'origine avant une réservation. J'avais conclu à tort en #566 que ce
  // mécanisme était mort : le parcours de diffusion (mission_broadcast) lui donne
  // bien une autre valeur, et le retirer laissait un appel vers une fonction
  // inexistante — donc un plantage au clic.
  const [bookingSource,setBookingSource]=useState("profile");
  const [authReady,setAuthReady]=useState(false);
  // Raison de la dernière déconnexion involontaire, affichée sur l'écran de choix.
  const [authNotice,setAuthNotice]=useState(null);
  // undefined = profil pas encore résolu (aucune décision à prendre) ; une chaîne = résolu.
  const [profileStatus,setProfileStatus]=useState(undefined);
  const [role,setRole]=useState(null);
  const [supaUser,setSupaUser]=useState(null);
  const [trialExhausted,setTrialExhausted]=useState(false);
  const [profileLoaded,setProfileLoaded]=useState(false);
  const [prestaPlan,setPrestaPlan]=useState("free");
  const [selectedProvider,setSelectedProvider]=useState(null);
  const [pendingProvider,setPendingProvider]=useState(null);
  const [selectedSector,setSelectedSector]=useState(null);
  const [selectedMissionId,setSelectedMissionId]=useState(null);
  const [notifOpenMissionId,setNotifOpenMissionId]=useState(null);
  const [chatClientId,setChatClientId]=useState(null);
  const [paymentAmount,setPaymentAmount]=useState(0);
  const [paymentHours,setPaymentHours]=useState(8);
  const [paymentIsUrgent,setPaymentIsUrgent]=useState(false);
  const [paymentDate,setPaymentDate]=useState("");
  const [paymentDescription,setPaymentDescription]=useState("");
  const [paymentAdresse,setPaymentAdresse]=useState("");
  const [paymentVille,setPaymentVille]=useState("");
  const [paymentStartTime,setPaymentStartTime]=useState("08:00");
  const [bookingError,setBookingError]=useState(null);
  const [boUnlocked,setBoUnlocked]=useState(false);
  const [boTestMode,setBoTestMode]=useState(false);
  const [legalType,setLegalType]=useState("cgu");
  const [payslipData,setPayslipData]=useState(null);
  const [onlineStatus,setOnlineStatus]=useState(true);
  const handleToggleOnline = async () => {
    const next = !onlineStatus;
    setOnlineStatus(next);
    try { await supabase.auth.updateUser({ data: { is_online: next } }); } catch {}
  };
  const [pendingMission,setPendingMission]=useState(null);
  const [invoiceMission,setInvoiceMission]=useState(null);
  const [unreadCount,setUnreadCount]=useState(0);
  const [notifCount,setNotifCount]=useState(0);
  const [clientCoords,setClientCoords]=useState(null);
  const [showOnboarding,setShowOnboarding]=useState(false);
  const [bookingDraftBanner,setBookingDraftBanner]=useState(null); // { prestataireName, metier, montant }
  const [docsRefreshKey,setDocsRefreshKey]=useState(0);
  const [cookieNotice,setCookieNotice]=useState(()=>{ try { return !localStorage.getItem("alane_cookie_ok"); } catch(e) { return false; } });
  const [clientCashback,setClientCashback]=useState(null);
  const initSessionRef = useRef(undefined); // cache INITIAL_SESSION pour éviter getSession() réseau au clic "Commencer"
  const initProfileRef = useRef(undefined); // cache profil préchargé dès INITIAL_SESSION
  const isRecoveryRef  = useRef(false);     // true dès que PASSWORD_RECOVERY event est reçu
  const [resetToken]   = useState(()=>{ try { return new URLSearchParams(window.location.search).get("reset_token")||null; } catch{ return null; } });

  // Capture ?ref=, ?profil=, ?bo= URL params
  useEffect(()=>{
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    if(ref && ref.length > 10) {
      try { sessionStorage.setItem("alane_referrer", ref); } catch(e) {}
    }
    const profil = params.get("profil");
    if(profil && profil.length > 30) {
      try { sessionStorage.setItem("alane_public_profil", profil); } catch(e) {}
    }
    if(window.location.hostname === "admin.alane.fr") {
      setScreen("bo_login");
    }
    if(ref || profil) window.history.replaceState({}, "", window.location.pathname);
  },[]);

  // Public profil navigation — déclenché après que l'app est chargée
  useEffect(()=>{
    let profilId; try { profilId = sessionStorage.getItem("alane_public_profil"); } catch(e) {}
    if(!profilId) return;
    try { sessionStorage.removeItem("alane_public_profil"); } catch(e) {}
    fetch("/api/prestataires").then(r=>r.json()).then(d=>{
      const prov = (d.prestataires||[]).find(p=>p.id===profilId);
      if(prov) { setSelectedProvider(prov); setScreen("profile"); }
    }).catch(()=>{});
  },[]);

  // Handle Stripe subscription return
  useEffect(()=>{
    const params = new URLSearchParams(window.location.search);
    const subSuccess = params.get("sub_success");
    const plan = params.get("plan");
    if(subSuccess === "1" && plan) {
      window.history.replaceState({}, "", window.location.pathname);
      // Petit délai pour laisser le webhook Stripe mettre à jour user_metadata avant getUser()
      setTimeout(async()=>{
        try {
          const { data:{ user } } = await supabase.auth.getUser();
          if(user){
            const {data:pr}=await supabase.from("profiles").select("trial_exhausted,plan_abonnement").eq("id",user.id).single();
            const _plan = pr?.plan_abonnement || "free";
            setPrestaPlan(_plan);
            // Invariant : plan payant → jamais trial_exhausted
            setTrialExhausted(_plan !== "free" ? false : !!pr?.trial_exhausted);
          }
        } catch {}
      }, 2000);
    }
    if(params.get("sub_cancel") === "1") {
      window.history.replaceState({}, "", window.location.pathname);
    }
  },[]);

  // Recharge le plan prestataire via getUser() — appel réseau garanti, jamais en cache
  useEffect(()=>{
    if(!supaUser || role!=="prestataire") return;
    (async()=>{
      try {
        await supabase.auth.getUser();
        // profiles est la source de vérité pour plan_abonnement (le webhook Stripe y écrit en priorité)
        const { data:pr } = await supabase.from("profiles").select("trial_exhausted,plan_abonnement").eq("id",supaUser.id).single();
        const plan = pr?.plan_abonnement || "free";
        setPrestaPlan(plan);
        // Invariant : plan payant → jamais trial_exhausted
        setTrialExhausted(plan !== "free" ? false : !!pr?.trial_exhausted);
        setProfileLoaded(true);
      } catch {}
    })();
  },[supaUser, role]);

  // Tracking visiteur — une seule fois par session
  useEffect(()=>{
    try { if(sessionStorage.getItem("visit_tracked")) return; sessionStorage.setItem("visit_tracked","1"); } catch(e) { return; }
    const sessionId = Math.random().toString(36).slice(2)+Date.now().toString(36);
    supabase.from("visits").insert({ session_id: sessionId }).then(()=>{}).catch(()=>{});
  },[]);

  // Reset badge messages non lus quand le chat est ouvert
  useEffect(()=>{
    if(screen==="chat"){
      try { localStorage.setItem("alane_msg_last_seen", new Date().toISOString()); } catch(e) {}
      setUnreadCount(0);
    }
    if(screen==="notifications") setNotifCount(0);
  },[screen]);

  // Géolocalisation au montage
  useEffect(()=>{
    if(navigator.geolocation){
      navigator.geolocation.getCurrentPosition(
        pos=>setClientCoords({ lat:pos.coords.latitude, lng:pos.coords.longitude }),
        ()=>{}
      );
    }
  },[]);

  // Tracking GPS prestataire — envoie la position toutes les 60s quand prestation assignée
  useEffect(()=>{
    if(!supaUser || role !== "prestataire" || !navigator.geolocation) return;
    const consentKey = `alane_gps_consent_${supaUser.id}`;
    let hasConsent = false; try { hasConsent = !!localStorage.getItem(consentKey); } catch(e) {}
    let watchId = null;
    let iv = null;
    const startGps = () => {
      let currentPos = null;
      watchId = navigator.geolocation.watchPosition(
        pos=>{ currentPos = { lat:pos.coords.latitude, lng:pos.coords.longitude }; },
        ()=>{}, { enableHighAccuracy:true }
      );
      const sendPos = async () => {
        if(!currentPos) return;
        try {
          const { data:ms } = await supabase.from("missions")
            .select("id").eq("prestataire_id", supaUser.id).eq("status","assigned").limit(1);
          if(!Array.isArray(ms) || !ms.length) return;
          const { data:sd } = await supabase.auth.getSession();
          const token = sd?.session?.access_token;
          fetch("/api/missions", {
            method:"POST",
            headers:{"Content-Type":"application/json", ...(token?{"Authorization":`Bearer ${token}`}:{})},
            body: JSON.stringify({ action:"update_position", mission_id:ms[0].id, lat:currentPos.lat, lng:currentPos.lng }),
          }).catch(()=>{});
        } catch {}
      };
      iv = setInterval(sendPos, 30000);
      sendPos();
    };
    if(hasConsent) {
      startGps();
    } else {
      showConfirm("ALANE utilise votre position GPS uniquement pendant une prestation assignée, pour permettre au client de suivre votre arrivée en temps réel. Votre position n'est jamais partagée en dehors d'une prestation active.\n\nAutoriser la géolocalisation ?")
        .then(ok => { if(!ok) return; try { localStorage.setItem(consentKey, "1"); } catch(e) {} startGps(); });
    }
    return ()=>{ if(watchId!==null) navigator.geolocation.clearWatch(watchId); if(iv!==null) clearInterval(iv); };
  },[supaUser, role]);

  // Poll messages non lus toutes les 10 secondes
  useEffect(()=>{
    if(!supaUser) return;
    let mounted = true;
    const userId = supaUser.id;
    const poll = async()=>{
      let lastSeen; try { lastSeen = localStorage.getItem("alane_msg_last_seen"); } catch(e) {}
      // Fallback borné : sans repère, ne pas balayer tout l'historique depuis 1970
      lastSeen = lastSeen || new Date(Date.now() - 30*24*3600*1000).toISOString();
      // head:true → seul le compteur est renvoyé, pas les lignes
      const { count, error } = await supabase
        .from("messages")
        .select("id", { count:"exact", head:true })
        .ilike("conversation_key", `%${userId}%`)
        .neq("sender_tag","client")
        .gt("created_at", lastSeen);
      if(!error && mounted) setUnreadCount(count || 0);
    };
    poll();
    const interval = setInterval(poll, 10000);
    return ()=>{ mounted=false; clearInterval(interval); };
  },[supaUser?.id]);

  // Onboarding : affiché une seule fois après le premier login
  useEffect(()=>{
    if(!supaUser) return;
    if(screen !== "home" && screen !== "p_home") return;
    const key = `alane_onboarded_${supaUser.id}`;
    let onboarded; try { onboarded = localStorage.getItem(key); } catch(e) {}
    if(!onboarded) setShowOnboarding(true);
  },[screen, supaUser]);

  // Bannière de reprise — brouillon de réservation abandonné (option A : localStorage)
  useEffect(()=>{
    if(screen !== "home" || role !== "client") return;
    try {
      const raw = localStorage.getItem("alane_booking_draft");
      if (!raw) return;
      const draft = JSON.parse(raw);
      // Afficher uniquement si le brouillon a plus de 10 min
      if (!draft?.timestamp || Date.now() - draft.timestamp < 10 * 60 * 1000) return;
      setBookingDraftBanner(draft);
    } catch {}
  },[screen, role]);

  // Charger le cashback du client quand on arrive sur le dashboard
  useEffect(()=>{
    if(!supaUser || role !== "client" || screen !== "dashboard") return;
    supabase.from("profiles").select("cashback_balance,missions_completed_month").eq("id",supaUser.id).single()
      .then(({ data })=>{ if(data) setClientCashback(data); });
  },[supaUser, role, screen]);

  // Poll notifications non lues toutes les 30 secondes
  useEffect(()=>{
    if(!supaUser) return;
    let mounted = true;
    const pollNotifs = async()=>{
      const { count } = await supabase.from("notifications").select("id",{count:"exact",head:true}).eq("user_id",supaUser.id).eq("read",false);
      if(mounted) setNotifCount(count||0);
    };
    pollNotifs();
    const iv = setInterval(pollNotifs,30000);
    return ()=>{ mounted=false; clearInterval(iv); };
  },[supaUser?.id]);

  // Synchroniser onlineStatus depuis user_metadata quand le prestataire se connecte
  useEffect(()=>{
    if (!supaUser) return;
    const isOnline = supaUser.user_metadata?.is_online;
    if (typeof isOnline === "boolean") setOnlineStatus(isOnline);
  },[supaUser?.id]);

  // Écouter les changements de session (déconnexion, reset password)
  // Ne pas auto-naviguer au démarrage : l'utilisateur passe toujours par le splash
  useEffect(()=>{
    let initialized = false;
    const { data:{ subscription } } = supabase.auth.onAuthStateChange((event,session)=>{
      // INITIAL_SESSION : on met à jour supaUser silencieusement, sans naviguer
      if(event==="INITIAL_SESSION"){
        initSessionRef.current = session || null;
        setSupaUser(session?.user||null);
        initialized=true;
        setAuthReady(true);
        // Précharger le profil en arrière-plan pour que le clic "Commencer" soit instantané.
        // setTimeout : supabase-js détient un verrou pendant onAuthStateChange, une requête
        // PostgREST lancée ici partirait sans Authorization valide (donc en rôle anon).
        if(session?.user){
          setTimeout(()=>{
            supabase.from("profiles").select("role,status,trial_exhausted,plan_abonnement").eq("id",session.user.id).single()
              .then(({data,error})=>{
                if(error || !data){ setProfileStatus("unknown"); return; }
                initProfileRef.current = data;
                // Nécessaire à l'entrée directe par URL : sans ça, `role` n'était résolu
                // qu'au clic sur "Commencer" et les gardes d'accès ne pouvaient rien trancher.
                if(data.role) setRole(data.role);
                setProfileStatus(data.status || "unknown");
                if(data.role==="prestataire"){
                  const p = data.plan_abonnement || "free";
                  setPrestaPlan(p);
                  setTrialExhausted(p !== "free" ? false : !!data.trial_exhausted);
                  setProfileLoaded(true);
                }
              });
          },0);
        } else {
          initProfileRef.current = null;
        }
        return;
      }
      // TOKEN_REFRESHED : simple mise à jour du user, jamais de navigation
      if(event==="TOKEN_REFRESHED"){ setSupaUser(session?.user||null); return; }

      setSupaUser(session?.user||null);
      if(event==="PASSWORD_RECOVERY") { isRecoveryRef.current=true; setScreen("reset_password"); return; }
      if(event==="SIGNED_OUT") {
        // Ignorer le SIGNED_OUT si on est déjà sur un écran pre-login (évite les sauts au démarrage)
        if(!initialized) return;
        try { localStorage.removeItem("alane_stay_logged_in"); } catch(e) {}
        try { sessionStorage.removeItem("alane_session_active"); sessionStorage.removeItem("bo_token"); } catch(e) {}
        let ecranAuMomentDeLaDeconnexion = null;
        // Vider le profil préchargé : sans ça, une reconnexion sans rechargement
        // de page retrouverait l'ancien rôle et rejouerait la redirection
        // prématurée que l'on vient de corriger.
        initProfileRef.current = null;
        setProfileStatus(undefined);
        setBoUnlocked(false);
        setBoTestMode(false);
        setProfileLoaded(false);
        setTrialExhausted(false);
        setClientCashback(null);
        setRole(null);
        setSelectedProvider(null);
        setSelectedSector(null);
        setSelectedMissionId(null);
        setChatClientId(null);
        setPendingMission(null);
        setPaymentAmount(0);
        setPaymentHours(8);
        setPaymentDate("");
        setPaymentDescription("");
        setPaymentAdresse("");
        setPaymentVille("");
        setPaymentStartTime("08:00");
        const preLoginScreens = ["splash","role","auth_client","auth_presta","how_client","how_presta","client_onboarding","presta_onboarding","presta_pending","pending_approval","reset_password","bo_login","bo_dashboard"];
        // Calculé hors du updater : appeler un setState dans le updater d'un
        // autre le ferait exécuter deux fois en mode strict.
        setScreen(prev => {
          if (preLoginScreens.includes(prev)) return prev;
          ecranAuMomentDeLaDeconnexion = prev;
          return "role";
        });
        // setScreen applique son updater de façon synchrone ici : la variable
        // est donc renseignée quand on la lit.
        if (ecranAuMomentDeLaDeconnexion) {
          setAuthNotice(`Votre session a été fermée alors que vous étiez sur l'écran « ${ecranAuMomentDeLaDeconnexion} ». (code DECONNEXION_INATTENDUE)`);
        }
      }
    });
    return ()=>subscription.unsubscribe();
  },[]);

  // Web Push — enregistre le SW et s'abonne pour clients ET prestataires
  useEffect(() => {
    if (!supaUser || !role) return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    const VAPID_PUBLIC = import.meta.env.VITE_VAPID_PUBLIC_KEY;
    if (!VAPID_PUBLIC) return;

    const subscribe = async () => {
      try {
        const reg = await navigator.serviceWorker.register("/sw.js");
        await navigator.serviceWorker.ready;
        const perm = await Notification.requestPermission();
        if (perm !== "granted") return;
        const existing = await reg.pushManager.getSubscription();
        const sub = existing || await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC),
        });
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        fetch("/api/missions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session.access_token}` },
          body: JSON.stringify({ action: "push_subscribe", subscription: sub.toJSON() }),
        }).catch(() => {});
      } catch {}
    };
    subscribe();
  }, [supaUser, role]);

  // Appelé quand l'utilisateur clique "Commencer" sur le splash
  const handleSplashNext = async () => {
    // Flux custom reset ou Supabase implicit recovery
    if(isRecoveryRef.current){ setScreen("reset_password"); return; }
    try {
      const sp = new URLSearchParams(window.location.search);
      if(sp.get("reset_token")){ setScreen("reset_password"); return; }
      const hp = new URLSearchParams(window.location.hash.slice(1));
      if(hp.get("type")==="recovery"){ setScreen("reset_password"); return; }
    } catch{}
    // Flux PKCE : ?code= dans l'URL → laisser Supabase traiter, attendre l'event PASSWORD_RECOVERY
    try {
      const sp = new URLSearchParams(window.location.search);
      if(sp.has("code")){
        await new Promise(res => setTimeout(res, 1200));
        if(isRecoveryRef.current){ setScreen("reset_password"); return; }
      }
    } catch{}
    const session = initSessionRef.current !== undefined
      ? initSessionRef.current
      : (await supabase.auth.getSession()).data.session;
    if(session){
      let stayLoggedIn; try { stayLoggedIn = localStorage.getItem("alane_stay_logged_in"); } catch(e) {}
      let sessionActive; try { sessionActive = sessionStorage.getItem("alane_session_active"); } catch(e) {}
      if (!stayLoggedIn && !sessionActive) {
        // Session Supabase persistée mais l'utilisateur n'a pas coché "Rester connecté"
        setAuthNotice("Vous n'aviez pas coché « Rester connecté » : la session a été fermée à la fermeture de l'application. (code SESSION_NON_PERSISTEE)");
        await supabase.auth.signOut();
        setScreen("role");
        return;
      }
      setSupaUser(session.user);
      // Utiliser le profil préchargé si disponible, sinon fetch réseau.
      // Test sur la valeur et non sur `!== undefined` : un préchargement échoué
      // ne doit pas court-circuiter le fallback réseau.
      let profile = initProfileRef.current || null;
      let profileErr = null;
      if(!profile){
        const r = await supabase.from("profiles").select("role,status,trial_exhausted,plan_abonnement").eq("id",session.user.id).single();
        profile = r.data; profileErr = r.error;
      }
      // Échec réseau/auth (≠ PGRST116 "aucune ligne") : ne pas détruire la session
      if(profileErr && profileErr.code !== "PGRST116"){
        setAuthNotice(`Votre profil n'a pas pu être lu (${profileErr.code || "erreur inconnue"} — ${profileErr.message || "sans détail"}). Réessayez ; si cela persiste, contactez le support. (code PROFIL_ILLISIBLE)`);
        setScreen("role"); return;
      }
      if(profile?.role){
        setRole(profile.role);
        if(profile.role==="prestataire"){
          const _planLogin = profile.plan_abonnement || "free";
          setPrestaPlan(_planLogin);
          // Invariant : plan payant → jamais trial_exhausted
          setTrialExhausted(_planLogin !== "free" ? false : !!profile.trial_exhausted);
          setProfileLoaded(true);
        }
        if(!profile.status || profile.status === "pending"){ setScreen("pending_approval"); return; }
        if(profile.status === "rejected" || profile.status === "suspended"){ await supabase.auth.signOut(); setScreen("role"); return; }
        setScreen(profile.role==="prestataire"?"p_home":"home");
        return;
      }
      // Session active mais profil introuvable → compte supprimé
      setAuthNotice("Aucun profil n'est associé à ce compte. (code PROFIL_ABSENT)");
      await supabase.auth.signOut();
    }
    setScreen("role");
  };

  const PRESTA_SCREENS=["p_home","p_missions","p_dashboard","calendar","abonnement_presta","doc_upload","presta_profile_edit","presta_pointage","micro_entreprise"];
  const CLIENT_SCREENS=["home","catalogue","search_filters","dashboard","sector_detail","profile","cv","booking","stripe_pay","tracking","validation","cancellation","team_booking","mission_history","favorites","cashback","mission_request","mission_broadcast","mission_pending","invoice"];

  // ── Synchronisation écran ↔ URL ─────────────────────────────────────────────
  // Reflète `screen` dans l'URL : chaque changement empile une entrée d'historique,
  // ce qui rend le bouton Retour et le rechargement fonctionnels.
  const skipFirstPush = useRef(true);
  useEffect(()=>{
    if(skipFirstPush.current){ skipFirstPush.current=false; return; }
    const path = pathForScreen(screen);
    if(window.location.pathname !== path){
      try { window.history.pushState({ screen }, "", path + window.location.search); } catch{}
    }
  },[screen]);

  // Sens inverse : le bouton Retour/Suivant du navigateur repilote l'écran.
  useEffect(()=>{
    const onPop = (e)=>{
      const target = e.state?.screen || screenForPath(window.location.pathname) || "splash";
      // Un écran à données n'est pas restaurable depuis l'URL seule
      setScreen(NEEDS_DATA.has(target) ? "splash" : target);
    };
    window.addEventListener("popstate", onPop);
    return ()=>window.removeEventListener("popstate", onPop);
  },[]);

  // ── Gardes d'accès ──────────────────────────────────────────────────────────
  // Attend que Supabase ait tranché sur la session avant de rediriger quoi que ce soit.
  useEffect(()=>{
    if(!authReady) return;
    if(window.location.hostname === "admin.alane.fr") return; // le BO a son propre flux
    // Pas de session sur un écran protégé → connexion
    if(!supaUser && !PUBLIC_SCREENS.has(screen)){
      setAuthNotice("Votre session n'était plus valide au moment d'ouvrir cet écran. (code SESSION_ABSENTE)");
      setScreen("role"); return;
    }
    // Compte pas encore validé par le BO : ne doit pas entrer dans l'app par URL.
    // profileStatus undefined = profil pas encore chargé → on ne tranche pas.
    if(supaUser && profileStatus==="pending" && !PUBLIC_SCREENS.has(screen) && screen!=="pending_approval"){
      setScreen("pending_approval"); return;
    }
    // Session active sur un écran de connexion → espace correspondant.
    // On se fonde sur le profil réellement chargé au démarrage, PAS sur `role` :
    // ce dernier n'est que le bouton choisi sur l'écran « Vous êtes ? », donc une
    // intention, pas un rôle vérifié. S'y fier déplaçait l'utilisateur vers
    // l'accueil au moment même où signInWithPassword réussit, avant que
    // handleLogin ait fini de contrôler le compte. Le refus qui suivait
    // déclenchait un signOut depuis « home » — écran non protégé contre le renvoi
    // — et l'utilisateur retombait sur l'écran de choix sans jamais voir le motif.
    const roleConfirme = initProfileRef.current?.role;
    if(supaUser && roleConfirme && AUTH_SCREENS.has(screen)){
      setScreen(roleConfirme==="prestataire" ? "p_home" : "home"); return;
    }
    // Entrée par URL dans l'espace de l'autre rôle
    if(role==="client"       && PRESTA_SCREENS.includes(screen)){ setScreen("home");   return; }
    if(role==="prestataire"  && CLIENT_SCREENS.includes(screen)){ setScreen("p_home"); return; }
  },[authReady, supaUser, role, screen, profileStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  const navigate=(to,data)=>{
    if(role==="client"    && PRESTA_SCREENS.includes(to)) return;
    if(role==="prestataire" && CLIENT_SCREENS.includes(to)) return;
    if(to==="profile"||to==="chat"||to==="tracking"||to==="validation"||to==="cancellation"||to==="contract"||to==="presta_pointage"||to==="rating") setSelectedProvider(data?.provider||data);
    if(to==="tracking" && data?._missionId) setSelectedMissionId(data._missionId);
    if(to==="chat") setChatClientId(data?.clientId||null);
    if(to==="sector_detail") setSelectedSector(data);
    if(to==="booking") { setSelectedProvider(data); }
    if(to==="stripe_pay") { if(data?.pendingMissionId) setSelectedMissionId(data.pendingMissionId); setPaymentAmount(data?.amount||124); setPaymentHours(data?.hours||8); setPaymentDate(data?.date||""); setPaymentDescription(data?.description||""); setPaymentAdresse(data?.adresse||""); setPaymentVille(data?.ville||""); setPaymentIsUrgent(data?.isUrgent||false); }
    if(to==="legal") setLegalType(data||"cgu");
    if(to==="payslip") setPayslipData(data);
    if(to==="mission_request") setSelectedSector(data);
    if(to==="mission_broadcast") setPendingMission(data);
    if(to==="invoice") setInvoiceMission(data);
    if(to==="mission_history" || to==="p_missions") setNotifOpenMissionId(data?.openMissionId||null);
    setScreen(to);
  };

  const clientScreens=["home","catalogue","search_filters","dashboard","settings","contact_support","notifications"];
  const prestaScreens=["p_home","p_missions","p_dashboard","calendar","settings","contact_support","notifications"];
  const showClientNav=role==="client"&&clientScreens.includes(screen);
  const showPrestaNav=role==="prestataire"&&prestaScreens.includes(screen);

  return (
    <>
    {/* Région aria-live pour les annonces dynamiques (screen readers) */}
    <div aria-live="polite" aria-atomic="true" style={{ position:"absolute", width:1, height:1, overflow:"hidden", clip:"rect(0 0 0 0)", whiteSpace:"nowrap" }}>
      {notifCount > 0 ? `${notifCount} nouvelle${notifCount > 1 ? "s" : ""} notification${notifCount > 1 ? "s" : ""}` : ""}
    </div>
    {showOnboarding && supaUser && (
      <OnboardingScreen
        role={role}
        onDone={()=>{
          try { localStorage.setItem(`alane_onboarded_${supaUser.id}`, "1"); } catch(e) {}
          setShowOnboarding(false);
        }}
        onNavigate={(to)=>{
          try { localStorage.setItem(`alane_onboarded_${supaUser.id}`, "1"); } catch(e) {}
          setShowOnboarding(false);
          navigate(to);
        }}
      />
    )}
    {/* Bannière de reprise — réservation abandonnée (option A) */}
    {bookingDraftBanner && screen === "home" && (
      <div style={{ position:"fixed", top:0, left:0, right:0, zIndex:9997, padding:"0 12px", paddingTop:"env(safe-area-inset-top,0px)" }}>
        <div style={{ background:"linear-gradient(135deg,#1A2B4A,#0D1B3E)", border:"1px solid rgba(124,111,224,0.4)", borderRadius:"0 0 16px 16px", padding:"14px 16px", display:"flex", alignItems:"center", gap:12, boxShadow:"0 4px 20px rgba(0,0,0,0.5)" }}>
          <div style={{ fontSize:26, flexShrink:0 }}>⏳</div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontWeight:800, color:"#F0F0F5", fontSize:13, marginBottom:2 }}>
              Vous n'avez pas finalisé votre réservation
            </div>
            <div style={{ color:"rgba(255,255,255,0.55)", fontSize:12, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
              {bookingDraftBanner.prestataireName
                ? `${bookingDraftBanner.prestataireName}${bookingDraftBanner.montant ? ` · ${bookingDraftBanner.montant} €` : ""}`
                : "Reprenez là où vous en étiez"}
            </div>
          </div>
          <button
            onClick={async()=>{
              // Ce bouton faisait navigate("home") : l'écran où l'utilisateur se
              // trouve déjà. Il masquait le bandeau sans rien reprendre.
              const draft = bookingDraftBanner;
              setBookingDraftBanner(null);
              const oublier = () => { try { localStorage.removeItem("alane_booking_draft"); } catch { /* stockage indisponible */ } };
              if(!draft?.missionId || !draft?.prestataireId){
                // Brouillon antérieur à l'enregistrement de ces informations :
                // impossible de reconstituer le tunnel sans repartir du profil.
                oublier();
                setBookingError("Cette réservation est trop ancienne pour être reprise. Relancez-la depuis le profil du prestataire.");
                return;
              }
              try {
                const { data:m } = await supabase.from("missions")
                  .select("id,montant_total,hours,date,heure_debut,description,adresse,ville,status")
                  .eq("id", draft.missionId).single();
                if(!m || !["open","pending_acceptance"].includes(m.status)){
                  oublier();
                  setBookingError("Cette réservation n'est plus disponible — elle a peut-être déjà été réglée ou annulée.");
                  return;
                }
                const d = await fetch("/api/prestataires").then(r=>r.json()).catch(()=>null);
                const prov = (d?.prestataires||[]).find(p=>p.id===draft.prestataireId);
                if(!prov){
                  setBookingError("Ce prestataire n'est plus disponible. Choisissez-en un autre.");
                  return;
                }
                setSelectedProvider(prov);
                setSelectedMissionId(m.id);
                setPaymentAmount(Number(m.montant_total) || draft.montant || 0);
                setPaymentHours(m.hours || 8);
                setPaymentDate(m.date || "");
                setPaymentStartTime(m.heure_debut || "08:00");
                setPaymentDescription(m.description || "");
                setPaymentAdresse(m.adresse || "");
                setPaymentVille(m.ville || "");
                setScreen("stripe_pay");
              } catch(e) {
                setBookingError(e?.message || "Reprise impossible — réessayez.");
              }
            }}
            style={{ background:"#7C6FE0", border:"none", borderRadius:10, padding:"8px 14px", color:"#fff", fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit", flexShrink:0 }}
          >Reprendre</button>
          <button
            onClick={()=>{ setBookingDraftBanner(null); try { localStorage.removeItem("alane_booking_draft"); } catch {} }}
            style={{ background:"transparent", border:"none", color:"rgba(255,255,255,0.4)", fontSize:18, cursor:"pointer", padding:"4px", lineHeight:1, flexShrink:0 }}
          >×</button>
        </div>
      </div>
    )}
    {cookieNotice && (
      <div style={{
        position:"fixed", bottom:0, left:0, right:0, zIndex:9998,
        background:"#0D1B3E", borderTop:"1px solid rgba(255,255,255,0.10)",
        padding:"14px 20px", display:"flex", flexWrap:"wrap",
        alignItems:"center", gap:12, justifyContent:"space-between",
      }}>
        <p style={{ color:"rgba(255,255,255,0.7)", fontSize:12, margin:0, flex:1, minWidth:200, lineHeight:1.6 }}>
          🍪 ALANE utilise uniquement des cookies nécessaires à son fonctionnement (session, préférences).
          {" "}<span onClick={()=>navigate("legal","privacy")} style={{ color:"#7C6FE0", cursor:"pointer", textDecoration:"underline" }}>En savoir plus</span>
        </p>
        <button onClick={()=>{ try { localStorage.setItem("alane_cookie_ok","1"); } catch(e) {} setCookieNotice(false); }}
          style={{ background:"#7C6FE0", border:"none", borderRadius:10, padding:"8px 18px", color:"#fff", fontWeight:700, fontSize:13, cursor:"pointer", whiteSpace:"nowrap", flexShrink:0 }}>
          J'ai compris
        </button>
      </div>
    )}
    <ResponsiveLayout
      screen={screen} role={role} isLoggedIn={!!supaUser} onNavigate={navigate}
      showClientNav={showClientNav} showPrestaNav={showPrestaNav}
      onlineStatus={onlineStatus} onToggleOnline={handleToggleOnline}
      unreadCount={unreadCount}
    >
      {screen==="reset_password"    && <ResetPasswordScreen resetToken={resetToken} onDone={()=>setScreen("role")} />}
      {screen==="pending_approval"  && <PendingApprovalScreen
        onLogout={async()=>{ await supabase.auth.signOut(); setRole(null); setScreen("role"); }}
        onApproved={(r)=>{ setRole(r); setScreen(r==="prestataire"?"p_home":"home"); }}
      />}
      {screen==="settings"          && <SettingsScreen role={role} onNavigate={navigate} onBack={()=>setScreen(role==="prestataire"?"p_home":"home")} onLogout={async()=>{ await supabase.auth.signOut(); setRole(null); setScreen("role"); }} />}
      {screen==="contact_support"   && <ContactSupportScreen onBack={()=>setScreen("settings")} />}
      {screen==="faq"               && <FAQScreen onBack={()=>setScreen("settings")} role={role} />}
      {screen==="splash"            && <SplashScreen onNext={handleSplashNext} />}
      {screen==="role"              && <RoleScreen notice={authNotice} onSelect={r=>{ if(r==="contact"){ setScreen("public_contact"); return; } setRole(r); setScreen(r==="prestataire"?"auth_presta":"auth_client"); }} onBack={()=>setScreen("splash")} />}
      {screen==="public_contact"    && <PublicContactScreen onBack={()=>setScreen("role")} />}

      {/* Auth — connexion ou inscription pour les deux rôles */}
      {screen==="auth_client"       && <AuthScreen role="client"
          onLogin={()=>{ setAuthNotice(null); setRole("client"); setScreen("home"); }}
          onRegister={()=>setScreen("pending_approval")}
          onBack={()=>setScreen("role")} />}
      {screen==="auth_presta"       && <AuthScreen role="prestataire"
          onLogin={async()=>{ setAuthNotice(null); setRole("prestataire"); setScreen("p_home"); const {data:{user}}=await supabase.auth.getUser(); if(user){ const {data:pr}=await supabase.from("profiles").select("trial_exhausted,plan_abonnement").eq("id",user.id).single(); const _pl=pr?.plan_abonnement||"free"; setPrestaPlan(_pl); setTrialExhausted(_pl!=="free"?false:!!pr?.trial_exhausted); setProfileLoaded(true); } }}
          onRegister={()=>setScreen("pending_approval")}
          onBack={()=>setScreen("role")} />}

      {/* Comment ca marche — uniquement pour les nouveaux inscrits */}
      {screen==="how_client"        && <HowItWorksScreen role="client" onNext={()=>setScreen("client_onboarding")} onBack={()=>setScreen("auth_client")} />}
      {screen==="how_presta"        && <HowItWorksScreen role="prestataire" onNext={()=>setScreen("presta_onboarding")} onBack={()=>setScreen("auth_presta")} />}

      {/* Onboarding complet — uniquement pour les nouveaux */}
      {screen==="client_onboarding" && <ClientOnboarding onComplete={()=>setScreen("home")} onBack={()=>setScreen("how_client")} />}
      {screen==="home"              && <HomeScreen onNavigate={navigate} notifCount={notifCount} />}
      {screen==="catalogue"         && <CatalogueScreen onNavigate={navigate} />}
      {screen==="sector_detail"     && <SectorDetailScreen sector={selectedSector} onNavigate={navigate} clientCoords={clientCoords} />}
      {screen==="mission_request"   && <MissionRequestScreen sector={selectedSector} onBack={()=>setScreen("sector_detail")} onSubmit={(m)=>{ if(m?.id) setSelectedMissionId(m.id); setScreen("mission_broadcast"); setPendingMission(m); }} />}
      {screen==="mission_broadcast" && <MissionBroadcastScreen prestation={pendingMission} onCancel={()=>setScreen("mission_request")} onChoose={p=>{ setSelectedProvider(p); setBookingSource("mission_broadcast"); setScreen("booking"); }} />}
      {screen==="search_filters"    && <SearchFiltersScreen onNavigate={navigate} />}
      {screen==="profile"           && <ProfileScreen provider={selectedProvider} onNavigate={navigate} onBack={()=>setScreen(selectedSector?"sector_detail":"search_filters")} />}
      {screen==="cv"                && <CVScreen provider={selectedProvider} onBack={()=>setScreen("profile")} onNavigate={navigate} />}
      {screen==="booking"           && <BookingScreen provider={selectedProvider} onNavigate={async(to,data)=>{
        if(to!=="stripe_pay") { navigate(to,data); return; }
        setPaymentAmount(data?.amount||124); setPaymentHours(data?.hours||8); setPaymentDate(data?.date||"");
        setPaymentStartTime(data?.startTime||"08:00"); setPaymentDescription(data?.description||"");
        setPaymentAdresse(data?.adresse||""); setPaymentVille(data?.ville||""); setPaymentIsUrgent(data?.isUrgent||false);
        // La prestation doit exister AVANT le paiement : /api/stripe-intent refuse
        // toute demande sans mission_id et recalcule le montant depuis la base,
        // pour ne jamais faire confiance au montant envoyé par le navigateur.
        // Elle est créée sans prestataire ni échéance : celui-ci n'est rattaché et
        // sollicité qu'au paiement réussi, quand onSuccess complète la prestation.
        try {
          const { data:ud } = await supabase.auth.getUser();
          const uid = ud?.user?.id;
          if(!uid) { setBookingError("Session expirée, veuillez vous reconnecter."); return; }
          const newId = typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g,c=>(c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>c/4).toString(16));
          const { error:insErr } = await supabase.from("missions").insert({
            id: newId,
            client_id: uid,
            // prestataire_id volontairement vide jusqu'au paiement : la liste des
            // demandes du prestataire filtre sur cet identifiant, il n'est donc
            // pas sollicité tant que le client n'a pas payé.
            prestataire_id: null,
            sector: selectedProvider?.sector || null,
            metier: selectedProvider?.jobTitle || selectedProvider?.role || null,
            date: data?.date || null,
            hours: data?.hours || 8,
            heure_debut: data?.startTime || null,
            tarif_horaire: selectedProvider?.rateNum || null,
            montant_total: data?.amount || null,
            description: data?.description || null,
            adresse: data?.adresse || null,
            ville: data?.ville || null,
            // "pending_acceptance" et non "open" : les missions "open" alimentent la
            // place de marché de tous les prestataires (list_open), une réservation
            // abandonnée avant paiement s'y afficherait donc.
            status: "pending_acceptance",
          });
          if(insErr) { setBookingError("Impossible de préparer la prestation : " + (insErr.message || "erreur inconnue")); return; }
          setSelectedMissionId(newId);
          setScreen("stripe_pay");
        } catch(e) {
          setBookingError(e?.message || "Impossible de préparer le paiement — réessayez.");
        }
      }} onBack={()=>setScreen(bookingSource)} />}
      {screen==="stripe_pay"        && <StripePaymentScreen amount={paymentAmount} provider={selectedProvider} description={paymentDescription} missionId={selectedMissionId||null} onSuccess={async(intentId)=>{
        setBookingError(null);
        setPendingProvider(selectedProvider);
        try {
          const { data:ud } = await supabase.auth.getUser();
          const userId = ud?.user?.id;
          if(!userId) throw new Error("Session expirée, veuillez vous reconnecter.");
          if(selectedProvider?.id){
            const today=new Date().toDateString();
            const mDay=paymentDate?new Date(paymentDate).toDateString():null;
            const isSameDay=!mDay||mDay===today;
            const deadline=new Date(Date.now()+(paymentIsUrgent?20:isSameDay?60:240)*60000).toISOString();
            let missionId = selectedMissionId;
            if(missionId){
              // L'affectation passe par le serveur : le trigger
              // prevent_missions_field_tampering interdit au client de modifier
              // prestataire_id et status depuis le navigateur (audit B-01).
              const { data:sdA } = await supabase.auth.getSession();
              const rA = await fetch("/api/missions", {
                method:"POST",
                headers:{ "Content-Type":"application/json", "Authorization":`Bearer ${sdA?.session?.access_token||""}` },
                body: JSON.stringify({ action:"assign_after_payment", mission_id:missionId, prestataire_id:selectedProvider.id, acceptance_deadline:deadline, stripe_payment_intent:intentId||null }),
              });
              if(!rA.ok){
                const jA = await rA.json().catch(()=>({}));
                throw new Error(jA.error || "Erreur lors de l'affectation de la prestation.");
              }
            } else {
              // Ce chemin créait la prestation depuis le navigateur en y écrivant
              // lui-même prestataire_id, status, acceptance_deadline et l'identifiant
              // du paiement : il contournait donc l'intégralité des contrôles serveur
              // — rayon d'intervention, accès aux prestations du prestataire, secteur
              // ouvert, tarif réellement annoncé.
              //
              // Il est par ailleurs inatteignable : /api/stripe-intent refuse toute
              // demande sans mission_id, un paiement ne peut donc pas aboutir sans que
              // la prestation existe déjà. Y arriver signifie qu'une hypothèse a cédé
              // en amont — mieux vaut le dire que créer une prestation non vérifiée.
              console.error("[paiement] encaissement sans identifiant de prestation — création annulée.");
              throw new Error("Paiement encaissé mais la prestation est introuvable. "
                + "Ne renouvelez pas le paiement : contactez-nous, le montant vous sera remboursé.");
            }
            // La notification in-app est désormais insérée par /api/missions
            // (action notify_prestataire), en service role et après vérification
            // que l'appelant est bien le client de la mission — voir S-06.
            const { data:sessionData } = await supabase.auth.getSession();
            fetch("/api/missions", {
              method:"POST", headers:{"Content-Type":"application/json","Authorization":`Bearer ${sessionData?.session?.access_token||""}`},
              body: JSON.stringify({ action:"notify_prestataire", prestataire_id:selectedProvider.id, mission_label:selectedProvider.jobTitle||selectedProvider.role||null, date:paymentDate||null, ville:paymentVille||null, hours:paymentHours||null, heure_debut:paymentStartTime||null, adresse:paymentAdresse||null, tarif_horaire:selectedProvider.rateNum||null, same_day:isSameDay }),
            }).catch(()=>{});
            fetch("/api/support", {
              method:"POST", headers:{"Content-Type":"application/json","Authorization":`Bearer ${sessionData?.session?.access_token||""}`},
              body: JSON.stringify({
                action: "booking_confirm",
                clientEmail: ud?.user?.email||null,
                clientName: ud?.user?.user_metadata?.prenom||null,
                prestaName: selectedProvider.name||null,
                job: selectedProvider.jobTitle||selectedProvider.role||null,
                date: paymentDate||null,
                startTime: paymentStartTime||null,
                hours: paymentHours||null,
                adresse: paymentAdresse||null,
                ville: paymentVille||null,
                total: paymentAmount,
              }),
            }).catch(()=>{});
          }
          setScreen("mission_pending");
        } catch(e) {
          // Le paiement est encaissé à ce stade : ne jamais laisser l'utilisateur
          // bloqué sur l'écran de règlement, qui n'a plus de retour une fois en
          // état « Paiement sécurisé ». On l'emmène sur ses prestations avec un
          // message explicite, la prestation existe déjà en base.
          setBookingError((e.message || "Une erreur est survenue.")
            + " Votre paiement a bien été enregistré — retrouvez la prestation dans « Mes prestations ». Contactez le support si elle n'y figure pas.");
          setScreen("mission_history");
        }
      }} onBack={()=>setScreen("booking")} />}
      {bookingError && (
        <div style={{ position:"fixed", bottom:80, left:"50%", transform:"translateX(-50%)", background:"#1a1a2e", border:"1px solid #F25E5E", borderRadius:12, padding:"12px 18px", color:"#F25E5E", fontSize:13, fontWeight:600, maxWidth:340, zIndex:9999, textAlign:"center", boxShadow:"0 4px 24px rgba(0,0,0,0.5)" }}>
          ⚠️ {bookingError}<br/><button onClick={()=>setBookingError(null)} style={{ marginTop:8, background:"none", border:"none", color:"#F25E5E", cursor:"pointer", fontSize:12, textDecoration:"underline" }}>Fermer</button>
        </div>
      )}
      {screen==="mission_pending"   && <MissionPendingScreen
        provider={pendingProvider||selectedProvider}
        amount={paymentAmount}
        missionId={selectedMissionId}
        hours={paymentHours}
        // Bascule directe vers le suivi. L'écran de contrat était traversé en
        // une seconde : la prestation étant déjà « assigned », il considérait les
        // deux signatures acquises et appelait aussitôt onSign, qui menait ici.
        // Le client signe déjà à la commande, cette étape n'apportait rien.
        onAccepted={()=>setScreen("tracking")}
        onCancelled={()=>{ setScreen("sector_detail"); }}
        onBack={()=>setScreen("home")}
      />}
      {screen==="contract"          && <ContractScreen provider={selectedProvider} amount={paymentAmount} hours={paymentHours} missionId={selectedMissionId} onSign={()=>setScreen("tracking")} onBack={()=>setScreen("home")} />}
      {screen==="tracking"          && <TrackingScreen provider={selectedProvider} missionId={selectedMissionId} onNavigate={navigate} clientCoords={clientCoords} />}
      {screen==="validation"        && <ValidationScreen provider={selectedProvider} role={role} missionId={selectedMissionId} onNavigate={navigate} />}
      {screen==="invoice"           && <InvoiceScreen prestation={invoiceMission} onBack={()=>setScreen("mission_history")} />}
      {screen==="cancellation"      && <CancellationScreen provider={selectedProvider} missionId={selectedMissionId} missionDate={paymentDate||null} onNavigate={navigate} onBack={()=>setScreen("mission_history")} />}
      {screen==="team_booking"      && <TeamBookingScreen onNavigate={navigate} onBack={()=>setScreen("home")} />}
      {screen==="mission_history"   && <MissionHistoryScreen onNavigate={navigate} onBack={()=>setScreen("home")} openMissionId={notifOpenMissionId} />}
      {screen==="chat"              && <ChatScreen provider={selectedProvider} chatClientId={chatClientId} onBack={()=>setScreen(role==="prestataire"?"p_missions":"search_filters")} />}
      {screen==="notifications"     && <NotificationsScreen onBack={()=>setScreen(role==="prestataire"?"p_home":"home")} onNavigate={navigate} role={role} />}
      {screen==="favorites"         && <FavoritesScreen onNavigate={navigate} onBack={()=>setScreen("home")} />}
      {screen==="referral"          && <ReferralScreen onBack={()=>setScreen("home")} />}
      {screen==="abonnement_presta" && <AbonnementPrestaScreen onBack={()=>setScreen("p_dashboard")} />}
      {screen==="cashback"          && <CashbackWalletScreen onBack={()=>setScreen("home")} onNavigate={navigate} />}
      {screen==="rating"            && <RatingScreen provider={selectedProvider} missionId={selectedProvider?._missionId} onSubmit={()=>setScreen("home")} onBack={()=>setScreen(selectedProvider?._fromHistory?"mission_history":"validation")} />}
      {screen==="client_pro_docs"       && <ClientProDocScreen onBack={()=>setScreen("settings")} />}
      {screen==="doc_upload"           && <DocUploadScreen onBack={()=>{ setDocsRefreshKey(k=>k+1); setScreen("p_dashboard"); }} />}
      {screen==="micro_entreprise"     && <MicroEntrepriseScreen onBack={()=>setScreen("p_dashboard")} />}
      {screen==="presta_profile_edit"  && <PrestaProfileEditScreen onBack={()=>setScreen("p_dashboard")} />}
      {screen==="presta_pointage"      && <PrestaPointageScreen provider={{...selectedProvider, _pointageType:undefined}} type={selectedProvider?._pointageType||"in"} onSuccess={()=>setScreen("p_missions")} onBack={()=>setScreen("p_missions")} />}
      {screen==="calendar"          && <CalendarScreen />}
      {screen==="legal"             && <LegalScreen type={legalType} onBack={()=>setScreen(role==="prestataire"?"p_home":role?"dashboard":"splash")} />}
      {screen==="payslip"           && <PayslipScreen provider={payslipData?.provider||selectedProvider} prestation={payslipData} onBack={()=>setScreen(role==="prestataire"?"p_dashboard":"dashboard")} />}
      {screen==="bo_login"          && <BackofficeLogin onLogin={()=>{ setBoUnlocked(true); setScreen("bo_dashboard"); }} onBack={()=>setScreen("splash")} />}
      {screen==="bo_dashboard"      && boUnlocked && <BackofficeDashboard onBack={()=>{ try { sessionStorage.removeItem("bo_token"); } catch(e) {} setBoUnlocked(false); setScreen("splash"); }} onNavigate={(s,r,data)=>{ if(r) setRole(r); setBoTestMode(true); navigate(s,data); }} />}
      {/* Quota épuisé : pas d'overlay global — restriction inline dans PMissionsTab uniquement */}

      {boTestMode && screen!=="bo_dashboard" && (
        <div style={{ position:"fixed", bottom:80, left:"50%", transform:"translateX(-50%)", zIndex:9999, background:C.violet, borderRadius:30, padding:"10px 20px", display:"flex", alignItems:"center", gap:8, boxShadow:"0 4px 20px rgba(124,111,224,0.5)", cursor:"pointer", whiteSpace:"nowrap" }}
          onClick={()=>{ setBoTestMode(false); setRole(null); setScreen("bo_dashboard"); }}>
          <span style={{ color:"#fff", fontSize:13, fontWeight:700 }}>← Retour BO</span>
        </div>
      )}

      {screen==="dashboard" && (
        <div style={{ minHeight:"100%", background:`linear-gradient(180deg, #0A1628 0%, #0D1B3E 100%)`, paddingBottom:90 }}>

          {/* Header premium */}
          <div style={{ background:"linear-gradient(135deg, #0A1628, #162547)", borderBottom:`1px solid ${C.border}`, padding:"52px 22px 28px", position:"relative", overflow:"hidden" }}>
            <div style={{ position:"absolute", top:-60, right:-60, width:200, height:200, borderRadius:"50%", background:`radial-gradient(circle, ${C.violet}15 0%, transparent 65%)`, pointerEvents:"none" }} />
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:20 }}>
              <div>
                <p style={{ color:C.textMuted, fontSize:11, letterSpacing:1, textTransform:"uppercase", margin:"0 0 4px" }}>Mon espace</p>
                <h2 style={{ color:C.text, fontSize:26, fontWeight:700, margin:0, fontFamily:font.display }}>Mon compte</h2>
              </div>
              <div style={{ width:46, height:46, borderRadius:r, background:`${C.violet}20`, border:`1px solid ${C.violet}35`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22 }}>👤</div>
            </div>

            {/* Cashback banner dans le header */}
            <div onClick={()=>navigate("cashback")} style={{ background:`${C.violet}18`, border:`1px solid ${C.violet}35`, borderRadius:r, padding:"12px 16px", cursor:"pointer", display:"flex", alignItems:"center", gap:12 }}>
              <div style={{ width:36, height:36, borderRadius:10, background:`${C.violet}25`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 }}>💰</div>
              <div style={{ flex:1 }}>
                <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:1 }}>
                  <span style={{ fontWeight:700, color:C.text, fontSize:14 }}>Cashback disponible</span>
                  <Badge color={getCashbackTier(clientCashback?.missions_completed_month||0).color} small>
                    {getCashbackTier(clientCashback?.missions_completed_month||0).icon} {getCashbackTier(clientCashback?.missions_completed_month||0).label}
                  </Badge>
                </div>
                <div style={{ color:C.textSub, fontSize:12 }}>
                  <strong style={{ color:C.success }}>{clientCashback ? clientCashback.cashback_balance.toFixed(2) : "0,00"} €</strong> · {(getCashbackTier(clientCashback?.missions_completed_month||0).rate*100).toFixed(0)}% sur chaque prestation
                </div>
              </div>
              <span style={{ color:C.violet, fontSize:18 }}>›</span>
            </div>
          </div>

          <div style={{ padding:"20px 18px" }}>

            {/* Actions rapides */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:20 }}>
              {[
                { icon:"📋", label:"Mes prestations",   color:C.violet,     action:"mission_history" },
                { icon:"❤️", label:"Mes favoris",    color:"#F25E5E",    action:"favorites"       },
                { icon:"👥", label:"Équipe",         color:C.accentGold, action:"team_booking"    },
                { icon:"🔔", label:"Notifications",  color:C.success,    action:"notifications"   },
              ].map((item,i) => (
                <div key={i} onClick={()=>navigate(item.action)} style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"16px 14px", cursor:"pointer", display:"flex", alignItems:"center", gap:11, transition:"all 0.2s" }}
                  className="card-hover">
                  <div style={{ width:38, height:38, borderRadius:11, background:`${item.color}18`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0 }}>{item.icon}</div>
                  <span style={{ fontWeight:600, color:C.text, fontSize:13 }}>{item.label}</span>
                </div>
              ))}
            </div>

            {/* Menu secondaire */}
            <div style={{ fontWeight:700, color:C.text, fontSize:13, marginBottom:12, letterSpacing:0.3 }}>Gestion</div>
            {[
              { icon:"📄", label:"Mes factures",      sub:"Voir mes prestations et justificatifs", action:"mission_history" },
              { icon:"🎁", label:"Parrainage",         sub:"3 filleuls Premium = 1 mois offert", action:"referral"      },
              { icon:"📋", label:"CGU",                sub:"Conditions générales",             action:"legal_cgu"     },
              { icon:"📝", label:"CGPS",               sub:"Conditions de prestation",         action:"legal_cgps"    },
              { icon:"🔒", label:"Confidentialité",    sub:"Politique de données",             action:"legal_privacy" },
              { icon:"⚙️", label:"Paramètres",         sub:"Compte, sécurité, paiement",      action:"settings"      },
            ].map((item,i) => (
              <div key={i} onClick={()=>{
                if(item.action==="legal_cgu") navigate("legal","cgu");
                else if(item.action==="legal_cgps") navigate("legal","cgps");
                else if(item.action==="legal_privacy") navigate("legal","privacy");
                else if(item.action==="settings") navigate("settings");
                else if(item.action) navigate(item.action);
              }} style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"13px 15px", marginBottom:8, display:"flex", alignItems:"center", gap:12, cursor:"pointer", transition:"all 0.2s" }}
                className="card-hover">
                <div style={{ width:38, height:38, borderRadius:11, background:"rgba(255,255,255,0.05)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 }}>{item.icon}</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:600, color:C.text, fontSize:13 }}>{item.label}</div>
                  <div style={{ color:C.textSub, fontSize:11, marginTop:1 }}>{item.sub}</div>
                </div>
                <span style={{ color:C.textMuted, fontSize:18, fontWeight:300 }}>›</span>
              </div>
            ))}

            {/* Version / Sign out */}
            <div style={{ marginTop:20, textAlign:"center" }}>
              <div style={{ color:C.textMuted, fontSize:11, marginBottom:8 }}>ALANE v1.0 — Île-de-France</div>
              <button onClick={async()=>{ await supabase.auth.signOut(); setRole(null); setScreen("role"); }} style={{ background:"transparent", border:`1px solid ${C.border}`, borderRadius:r, padding:"10px 28px", color:C.textSub, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
                Se déconnecter
              </button>
            </div>
          </div>
        </div>
      )}

      {screen==="presta_onboarding" && <PrestaOnboarding onComplete={()=>setScreen("presta_pending")} onBack={()=>setScreen("how_presta")} />}
      {screen==="presta_pending" && (
        <div style={{ minHeight:"100%", background:`linear-gradient(160deg, #050E20, #0A1628, #162547)`, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:32, textAlign:"center", position:"relative", overflow:"hidden" }}>
          <div style={{ position:"absolute", top:-80, right:-80, width:280, height:280, borderRadius:"50%", background:`radial-gradient(circle, ${C.accentGold}12 0%, transparent 65%)`, pointerEvents:"none" }} />
          <div style={{ fontSize:72, marginBottom:20 }}>📬</div>
          <h2 style={{ color:C.text, fontSize:26, fontWeight:700, margin:"0 0 12px", fontFamily:font.display }}>Dossier envoyé !</h2>
          <p style={{ color:C.textSub, fontSize:15, lineHeight:1.8, maxWidth:300, margin:"0 auto 12px" }}>Notre équipe examine votre dossier sous <strong style={{ color:C.accentGold }}>24 à 48h ouvrées</strong>.</p>
          <p style={{ color:C.textMuted, fontSize:13, lineHeight:1.6, maxWidth:280, margin:"0 auto 32px" }}>Vous recevrez une notification dès que votre compte est activé.</p>
          <Btn full onClick={()=>setScreen("p_home")} style={{ fontSize:16, maxWidth:280 }}>Accéder à mon espace →</Btn>
        </div>
      )}

      {role==="prestataire" && (screen==="p_home"||screen==="p_missions"||screen==="p_dashboard") && (
        <div style={{ minHeight:"100%", background:`linear-gradient(180deg, #0A1628 0%, #0D1B3E 100%)`, paddingBottom:80 }}>
          <PrestaDashboard activeScreen={screen} docsRefreshKey={docsRefreshKey} notifCount={notifCount} onNavigate={(to,data)=>{
            if(to==="payslip") navigate("payslip",data);
            else if(to==="legal") navigate("legal",data);
            else navigate(to,data);
          }} />
          {screen==="p_dashboard" && (
            <div style={{ padding:"0 18px 18px" }}>
              <OnlineStatusWidget online={onlineStatus} onToggle={handleToggleOnline} />
              <div style={{ display:"flex", gap:10 }}>
                <button onClick={()=>navigate("legal","cgu")} style={{ flex:1, padding:"11px", borderRadius:12, border:`1px solid ${C.border}`, background:"#0D1B3E", color:C.textSub, fontSize:12, cursor:"pointer", fontFamily:"inherit", fontWeight:600 }}>📋 CGU</button>
                <button onClick={()=>navigate("legal","cgps")} style={{ flex:1, padding:"11px", borderRadius:12, border:`1px solid ${C.border}`, background:"#0D1B3E", color:C.textSub, fontSize:12, cursor:"pointer", fontFamily:"inherit", fontWeight:600 }}>📝 CGPS</button>
                <button onClick={()=>navigate("legal","privacy")} style={{ flex:1, padding:"11px", borderRadius:12, border:`1px solid ${C.border}`, background:"#0D1B3E", color:C.textSub, fontSize:12, cursor:"pointer", fontFamily:"inherit", fontWeight:600 }}>🔒 Confidentialité</button>
              </div>
            </div>
          )}
        </div>
      )}
    </ResponsiveLayout>
    <ToastContainer />
    <ConfirmModal />
    <PromptModal />
    </>
  );
}