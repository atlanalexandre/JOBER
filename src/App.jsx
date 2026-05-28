import { useState, useEffect, useRef, Component } from "react";
import { supabase } from "./lib/supabase.js";
import { C, font, r, shadow } from "./constants/colors.js";
import { IS_LAUNCH, isLaunchPhase, MARGES, FRAIS_MER, ABONNEMENTS_PRESTA, prixClient, tarifInterim, economiePct, formatE, CASHBACK_TIERS, getCashbackTier, calcCashback } from "./constants/plans.js";
import { useResponsive } from "./hooks/useResponsive.js";
import { Stars, Badge, Btn, Input, AddressAutocomplete, formatPhone, checkIban, IbanInput, PasswordStrength, EmailInput, Select, StepHeader, Card, SectionHeader, Divider, MiniBar, DonutChart } from "./components/ui.jsx";
import { CP_COORDS, cpToCoords, genMissionCode, SECTORS, METIERS_TARIFS, METIERS, CV_DATA, DOCS_REQUIS, JOURS, PLAGES, NIVEAUX, LANGUES_LIST, COMPETENCES_PAR_SECTEUR, PROVIDERS_CACHE_TTL, FR_CITY_COORDS, SECTOR_LABELS } from "./constants/data.js";
import { PrestaRegisterFlow, ClientRegisterFlow, AuthScreen } from "./components/auth.jsx";
import { boFetch, useBoData, BackofficeLogin, BOComptes, BOSupport, BOModerationTab, BOExportCSV, BOExportMissions, BOExportPDF, EmailTestButton, BOTest, BOLogs, BOSettingsTab, BOResetMonthly, BORefundSection, BackofficeDashboard } from "./components/backoffice.jsx";
import { MissionPendingScreen, StripePaymentScreen, InvoiceScreen, CancellationScreen } from "./components/payment.jsx";
import { DocUploadCard, PrestaOnboarding, PrestaProfilTab, CvEditor, PrestaProfileEditScreen, PrestaPointageScreen, PrestaOnboardingChecklist, UpgradeNudge, PMissionsTab, PrestaTour, PrestaClientsTab, PrestaDashboard, MicroEntrepriseScreen } from "./components/presta-screens.jsx";
import { ContactSupportScreen, SettingsScreen, ResetPasswordScreen, ClientTour, HomeScreen, CatalogueScreen, useProviders, loadLeaflet, cityCoords, LeafletMap, SectorDetailScreen, SearchFiltersScreen, CVScreen, ProfileScreen, BookingScreen, TrackingScreen, ValidationScreen, ChatScreen, FavoritesScreen, FAQScreen, ReferralScreen, CalendarScreen, TeamBookingScreen, HowItWorksScreen, ClientOnboarding, ContractScreen, LegalScreen, PayslipScreen, MissionHistoryScreen, CashbackWalletScreen, NotificationsScreen, MissionTimeline, RatingScreen, DocUploadScreen, AbonnementPrestaScreen, MissionRequestScreen, MissionBroadcastScreen, NOTIF_ICONS, NOTIF_COLORS, timeAgo, TOUR_STEPS, haversineKm, travelTimeStr, OnboardingScreen } from "./components/client-screens.jsx";

export class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { hasError:false, error:null }; }
  static getDerivedStateFromError(e) { return { hasError:true, error:e }; }
  componentDidCatch(e, info) { console.error("ErrorBoundary:", e, info); }
  render() {
    if(!this.state.hasError) return this.props.children;
    return (
      <div style={{ minHeight:"100vh", background:"#050E20", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:32, textAlign:"center" }}>
        <div style={{ fontSize:48, marginBottom:16 }}>⚠️</div>
        <h2 style={{ color:"#fff", fontSize:20, fontWeight:800, margin:"0 0 10px" }}>Une erreur inattendue est survenue</h2>
        <p style={{ color:"rgba(255,255,255,0.5)", fontSize:14, marginBottom:24 }}>Rechargez la page pour continuer.</p>
        <button onClick={()=>window.location.reload()} style={{ background:"#7C6FE0", border:"none", borderRadius:12, padding:"12px 28px", color:"#fff", fontWeight:700, fontSize:15, cursor:"pointer" }}>
          Recharger
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


// ── Design System, plans, hooks → imported from separate modules ─

// Met à jour les counts dynamiquement après chargement des PROVIDERS
// (sera appelé après la définition de PROVIDERS)

// ── Primitives ────────────────────────────────────────────────────
// ── UI Primitives — Premium Dark ─────────────────────────────────

// ── SCREENS ───────────────────────────────────────────────────────

function SplashScreen({ onNext, onBackoffice }) {
  const [v,setV]=useState(false);
  useEffect(()=>{ const t=setTimeout(()=>setV(true),100); return ()=>clearTimeout(t); },[]);
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
        <ALANELogo size="lg" />
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
          Trouvez des prestataires qualifiés et vérifiés pour vos missions ponctuelles — en quelques minutes.
        </p>

        {/* Stats pills */}
        <div style={{ display:"flex", gap:8, marginBottom:36, flexWrap:"wrap" }}>
          {[
            { v:"88+", l:"Prestataires" },
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

        {isLaunchPhase() && (
          <div style={{
            background:"linear-gradient(135deg, rgba(16,217,143,0.12), rgba(16,217,143,0.06))",
            border:"1px solid rgba(16,217,143,0.35)",
            borderRadius:r, padding:"12px 16px", marginBottom:20,
            display:"flex", gap:12, alignItems:"center",
          }}>
            <div style={{ width:36, height:36, borderRadius:10, background:"rgba(16,217,143,0.15)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0 }}>🎉</div>
            <div>
              <div style={{ fontWeight:700, color:"#10D98F", fontSize:13, marginBottom:2 }}>Offre de lancement</div>
              <div style={{ color:"rgba(255,255,255,0.5)", fontSize:11, lineHeight:1.5 }}>10 missions gratuites · Réservé aux 100 premiers prestataires inscrits</div>
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

function RoleScreen({ onSelect }) {
  const [hov,setHov]=useState(null);
  const [showCGU,setShowCGU]=useState(false);
  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(160deg, #050E20 0%, #0A1628 50%, #162547 100%)`, display:"flex", flexDirection:"column", padding:"60px 24px 48px", position:"relative", overflow:"hidden" }}>
      <div style={{ position:"absolute", top:-80, right:-80, width:280, height:280, borderRadius:"50%", background:`radial-gradient(circle, rgba(124,111,224,0.20) 0%, transparent 65%)`, pointerEvents:"none" }} />

      <div style={{ marginBottom:48 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:32 }}>
          <ALANELogo size="sm" />
        </div>
        <p style={{ color:C.textMuted, fontSize:11, letterSpacing:1.5, textTransform:"uppercase", fontWeight:600, marginBottom:10 }}>Bienvenue</p>
        <h2 style={{ color:C.text, fontSize:32, fontWeight:800, margin:0, lineHeight:1.15, fontFamily:font.display }}>Vous êtes ?</h2>
        <p style={{ color:C.textSub, fontSize:14, marginTop:8 }}>Choisissez votre profil pour commencer</p>
      </div>

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

      {isLaunchPhase() && (
        <div style={{
          background:"linear-gradient(135deg, rgba(16,217,143,0.10), rgba(16,217,143,0.04))",
          border:"1px solid rgba(16,217,143,0.30)",
          borderRadius:r, padding:"12px 16px", marginTop:24,
          display:"flex", gap:10, alignItems:"center",
        }}>
          <span style={{ fontSize:20, flexShrink:0 }}>🚀</span>
          <div>
            <div style={{ fontWeight:700, color:"#10D98F", fontSize:12, marginBottom:2 }}>Offre de lancement</div>
            <div style={{ color:"rgba(255,255,255,0.45)", fontSize:11, lineHeight:1.5 }}>10 missions gratuites · Réservé aux 100 premiers prestataires inscrits</div>
          </div>
        </div>
      )}

      <p style={{ color:C.textMuted, fontSize:11, textAlign:"center", marginTop:16 }}>
        En continuant, vous acceptez nos <span onClick={()=>setShowCGU(true)} style={{ color:C.violet, cursor:"pointer", textDecoration:"underline" }}>CGU</span>
      </p>
      {showCGU && (
        <div onClick={()=>setShowCGU(false)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", zIndex:1000, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
          <div onClick={e=>e.stopPropagation()} style={{ background:"#0D1B3E", borderRadius:"20px 20px 0 0", padding:"24px 22px 40px", width:"100%", maxWidth:540, maxHeight:"80vh", overflowY:"auto" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:18 }}>
              <div style={{ fontWeight:800, color:C.text, fontSize:16 }}>📋 Conditions Générales</div>
              <button onClick={()=>setShowCGU(false)} style={{ background:"transparent", border:"none", color:C.textSub, fontSize:20, cursor:"pointer", lineHeight:1 }}>✕</button>
            </div>
            {[
              { title:"1. Objet", text:"ALANE est une plateforme de mise en relation entre clients professionnels et prestataires qualifiés. L'utilisation de la plateforme implique l'acceptation des présentes conditions." },
              { title:"2. Inscription", text:"L'accès aux services nécessite la création d'un compte. Les informations fournies doivent être exactes et à jour. ALANE se réserve le droit de refuser ou suspendre tout compte." },
              { title:"3. Missions", text:"Les missions sont conclues directement entre clients et prestataires via la plateforme. ALANE agit en tant qu'intermédiaire et n'est pas partie au contrat de prestation." },
              { title:"4. Paiements", text:"Les paiements sont sécurisés via Stripe. Les fonds sont placés en escrow jusqu'à validation de la mission par le client. Toute contestation doit être soumise sous 48h." },
              { title:"5. Responsabilité", text:"ALANE ne peut être tenu responsable des dommages résultant de l'inexécution ou de la mauvaise exécution des missions. Chaque prestataire est couvert par sa propre RC Professionnelle." },
              { title:"6. Données personnelles", text:"Les données sont traitées conformément au RGPD. Vous disposez d'un droit d'accès, de rectification et de suppression. Contact : legal@alane.fr" },
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



// ── CONTACT SUPPORT ───────────────────────────────────────────────
// ── EN ATTENTE DE VALIDATION ──────────────────────────────────────
function PendingApprovalScreen({ onLogout, onApproved }) {
  const [userEmail, setUserEmail] = useState("");
  const [checking, setChecking] = useState(false);

  useEffect(()=>{
    supabase.auth.getUser().then(({ data })=>{ if(data?.user) setUserEmail(data.user.email||""); });
  },[]);

  useEffect(()=>{
    const onApprovedRef = { current: onApproved };
    onApprovedRef.current = onApproved;
    const interval = setInterval(async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase.from("profiles").select("status,role").eq("id", user.id).single();
      if (profile?.status === "approved") {
        clearInterval(interval);
        setChecking(true);
        onApprovedRef.current(profile.role);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, []);

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
    {id:"home",          icon:"🏠", label:"Accueil" },
    {id:"catalogue",     icon:"🗂️", label:"Secteurs"},
    {id:"search_filters",icon:"🔍", label:"Chercher"},
    {id:"dashboard",     icon:"👤", label:"Compte"  },
    {id:"settings",      icon:"⚙️", label:"Réglages"},
  ];
  return (
    <div style={{
      position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)",
      width:"100%", maxWidth:430,
      background:"#0D1B3E",
      borderTop:`1px solid ${C.border}`,
      display:"flex", padding:"10px 0 20px",
      zIndex:100,
      backdropFilter:"blur(20px)",
    }}>
      {tabs.map(t=>{
        const active2 = active===t.id;
        return (
          <button key={t.id} onClick={()=>onNavigate(t.id)} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:4, background:"none", border:"none", cursor:"pointer", padding:"2px 0" }}>
            <span style={{ fontSize:20, opacity:active2?1:0.35, transition:"opacity 0.2s", position:"relative" }}>
              {t.icon}
              {t.id==="search_filters" && unreadCount > 0 && (
                <div style={{ position:"absolute", top:-2, right:-2, background:"#E74C3C", borderRadius:"50%", width:16, height:16, fontSize:9, fontWeight:900, color:"#fff", display:"flex", alignItems:"center", justifyContent:"center" }}>{unreadCount > 9 ? "9+" : unreadCount}</div>
              )}
            </span>
            <span style={{ fontSize:9, fontWeight:active2?700:400, color:active2?C.violet:C.textMuted, letterSpacing:0.4, textTransform:"uppercase", transition:"color 0.2s" }}>{t.label}</span>
            {active2 && <div style={{ width:20, height:2, borderRadius:1, background:C.violet, marginTop:1 }} />}
          </button>
        );
      })}
    </div>
  );
}

function PrestaNav({ active, onNavigate, unreadCount }) {
  const tabs = [
    {id:"p_home",          icon:"🏠", label:"Accueil"   },
    {id:"p_missions",      icon:"📋", label:"Missions"  },
    {id:"abonnement_presta",icon:"⚡", label:"Abonnement"},
    {id:"p_dashboard",     icon:"👤", label:"Profil"    },
    {id:"settings",        icon:"⚙️", label:"Réglages"  },
  ];
  return (
    <div style={{
      position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)",
      width:"100%", maxWidth:430,
      background:"#0D1B3E",
      borderTop:`1px solid ${C.border}`,
      display:"flex", padding:"10px 0 20px",
      zIndex:100,
    }}>
      {tabs.map(t=>{
        const active2 = active===t.id;
        return (
          <button key={t.id} onClick={()=>onNavigate(t.id)} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:4, background:"none", border:"none", cursor:"pointer", padding:"2px 0" }}>
            <span style={{ fontSize:20, opacity:active2?1:0.35, transition:"opacity 0.2s", position:"relative" }}>
              {t.icon}
              {t.id==="p_missions" && unreadCount > 0 && (
                <div style={{ position:"absolute", top:-2, right:-2, background:"#E74C3C", borderRadius:"50%", width:16, height:16, fontSize:9, fontWeight:900, color:"#fff", display:"flex", alignItems:"center", justifyContent:"center" }}>{unreadCount > 9 ? "9+" : unreadCount}</div>
              )}
            </span>
            <span style={{ fontSize:9, fontWeight:active2?700:400, color:active2?C.accent:C.textMuted, letterSpacing:0.4, textTransform:"uppercase", transition:"color 0.2s" }}>{t.label}</span>
            {active2 && <div style={{ width:20, height:2, borderRadius:1, background:C.accent, marginTop:1 }} />}
          </button>
        );
      })}
    </div>
  );
}

// ── MODE ÉQUIPE ───────────────────────────────────────────────────
// ── MINI COMPOSANTS (évite useState dans .map) ───────────────────

// DocRow — onglet docs prestataire
function DocRowItem({ doc, isValid }) {
  const [renewed, setRenewed] = useState(false);
  const valid = isValid || renewed;
  return (
    <div style={{ background:"#0D1B3E", borderRadius:13, padding:"12px", marginBottom:8, display:"flex", gap:10, alignItems:"center", border:`1px solid ${valid?C.border:C.accent+"30"}` }}>
      <div style={{ width:38, height:38, borderRadius:10, background:valid?`${C.success}18`:`${C.accent}15`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 }}>{doc.icon}</div>
      <div style={{ flex:1 }}>
        <div style={{ fontWeight:700, color:C.text, fontSize:12 }}>{doc.label}</div>
        <div style={{ color:valid?C.success:C.textSub, fontSize:11, fontWeight:valid?700:400 }}>{valid?"✓ Validé":"En attente"}</div>
      </div>
      <div style={{ display:"flex", gap:6, alignItems:"center" }}>
        <Badge color={valid?C.success:C.accent} small>{valid?"OK":"Requis"}</Badge>
        {!isValid && !renewed && (
          <button onClick={()=>setRenewed(true)} style={{ padding:"4px 10px", borderRadius:8, border:`1px solid ${C.violet}`, background:"transparent", color:C.violet, fontSize:10, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>+ Charger</button>
        )}
        {isValid && (
          <span style={{ padding:"4px 10px", fontSize:10, color:C.success, fontWeight:600 }}>✓ Validé</span>
        )}
      </div>
    </div>
  );
}

// PendingDocRow — backoffice validation dossiers
function PendingDocRow({ u }) {
  const [validated, setValidated] = useState(false);
  const [docRequested, setDocRequested] = useState(false);
  return (
    <div style={{ background:"#0D1B3E", borderRadius:r, padding:"13px", marginBottom:9, border:`1px solid ${C.border}`, opacity:validated?0.6:1, transition:"opacity 0.3s" }}>
      <div style={{ display:"flex", gap:10, alignItems:"center", marginBottom:8 }}>
        <div style={{ width:40, height:40, borderRadius:12, background:`${C.violet}18`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20 }}>{u.avatar}</div>
        <div style={{ flex:1 }}>
          <div style={{ fontWeight:700, color:C.text, fontSize:13 }}>{u.name}</div>
          <div style={{ color:C.textSub, fontSize:11 }}>{u.role} · {u.sector}</div>
        </div>
        <div>
          {validated ? <Badge color={C.success} small>✓ Validé</Badge>
            : <Badge color={u.missing===0?C.success:C.accent} small>{u.missing===0?"Complet":`${u.missing} manquant${u.missing>1?"s":""}`}</Badge>}
        </div>
      </div>
      {!validated && (
        <div style={{ display:"flex", gap:8 }}>
          <button onClick={()=>setValidated(false)} style={{ flex:1, padding:"8px", borderRadius:10, border:`1px solid ${C.border}`, background:"transparent", color:C.textSub, fontSize:12, cursor:"default", fontFamily:"inherit" }}>👁️ {u.docs} doc{u.docs>1?"s":""}</button>
          {u.missing===0
            ? <button onClick={()=>setValidated(true)} style={{ flex:2, padding:"8px", borderRadius:10, border:"none", background:C.success, color:C.white, fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>✓ Valider</button>
            : <button onClick={()=>setDocRequested(true)} style={{ flex:2, padding:"8px", borderRadius:10, border:"none", background:docRequested?`${C.success}22`:`${C.accentGold}22`, color:docRequested?C.success:C.warning, fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>{docRequested?"✓ Envoyé":"⚠️ Demander docs"}</button>}
        </div>
      )}
      {validated && <div style={{ textAlign:"center", color:C.success, fontSize:12, fontWeight:700, padding:"4px 0" }}>✅ Compte activé</div>}
    </div>
  );
}

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
        <div style={{ fontWeight:800, color:online?C.success:C.gray, fontSize:14 }}>{online?"En ligne — Je reçois des missions":"Hors ligne — Je ne reçois pas de missions"}</div>
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
    { id:"catalogue",      icon:"🗂️", label:"Secteurs"        },
    { id:"search_filters", icon:"🔍", label:"Rechercher"      },
    { id:"mission_history",icon:"📋", label:"Mes missions"    },
    { id:"team_booking",   icon:"👥", label:"Équipe"          },
    { id:"favorites",      icon:"❤️", label:"Favoris"         },
    { id:"notifications",  icon:"🔔", label:"Notifications"   },
    { id:"referral",       icon:"🎁", label:"Parrainage"      },
    { id:"dashboard",      icon:"👤", label:"Mon compte"      },
  ];
  const prestaNav = [
    { id:"p_home",     icon:"🏠", label:"Accueil"      },
    { id:"p_missions", icon:"📋", label:"Missions"     },
    { id:"calendar",   icon:"📅", label:"Planning"     },
    { id:"notifications",icon:"🔔",label:"Notifications"},
    { id:"p_dashboard",icon:"👤", label:"Mon profil"   },
  ];
  const nav = role === "prestataire" ? prestaNav : clientNav;
  const accentColor = role === "prestataire" ? C.accent : C.violet;

  return (
    <div style={{
      width: 240, flexShrink: 0,
      background: `linear-gradient(180deg, ${C.navy} 0%, ${C.navyMid} 100%)`,
      height: "100vh", display: "flex", flexDirection: "column",
      borderRight: `1px solid rgba(255,255,255,0.06)`,
      boxShadow: "4px 0 24px rgba(0,0,0,0.15)",
    }}>
      {/* Logo */}
      <div style={{ padding: "28px 24px 20px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        <div onClick={()=>onNavigate(role==="prestataire"?"p_home":"home")} style={{ cursor:"pointer", display:"inline-flex" }}>
          <ALANELogo size="sm" />
        </div>
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
      <div style={{ flex:1, padding:"16px 12px", overflowY:"auto" }}>
        {nav.map(item => {
          const active = screen === item.id;
          return (
            <div key={item.id} onClick={() => onNavigate(item.id)}
              style={{
                display:"flex", alignItems:"center", gap:10, padding:"11px 14px",
                borderRadius:12, marginBottom:4, cursor:"pointer",
                background: active ? `${accentColor}22` : "transparent",
                border: `1px solid ${active ? accentColor+"44" : "transparent"}`,
                transition:"all 0.18s",
              }}
              onMouseEnter={e=>{ if(!active) e.currentTarget.style.background="rgba(255,255,255,0.06)"; }}
              onMouseLeave={e=>{ if(!active) e.currentTarget.style.background="transparent"; }}
            >
              <span style={{ fontSize:17 }}>{item.icon}</span>
              <span style={{ fontSize:13, fontWeight:active?700:400, color:active?C.white:"rgba(255,255,255,0.55)", transition:"color 0.18s" }}>{item.label}</span>
              {active && <div style={{ marginLeft:"auto", width:5, height:5, borderRadius:"50%", background:accentColor }} />}
            </div>
          );
        })}
      </div>

      {/* Bottom actions */}
      <div style={{ padding:"12px", borderTop:"1px solid rgba(255,255,255,0.07)" }}>
        {role==="prestataire" && (
          <div onClick={onToggleOnline} style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 14px", borderRadius:12, cursor:"pointer", background:onlineStatus?`${C.success}22`:"rgba(255,255,255,0.05)", border:`1px solid ${onlineStatus?C.success+"44":"rgba(255,255,255,0.1)"}`, marginBottom:8, transition:"all 0.2s" }}>
            <div style={{ width:9, height:9, borderRadius:"50%", background:onlineStatus?C.success:C.gray, boxShadow:onlineStatus?`0 0 6px ${C.success}`:"none" }} />
            <span style={{ fontSize:12, color:onlineStatus?C.success:"rgba(255,255,255,0.4)", fontWeight:600 }}>{onlineStatus?"En ligne":"Hors ligne"}</span>
            <div style={{ marginLeft:"auto", width:32, height:18, borderRadius:9, background:onlineStatus?C.success:C.gray, position:"relative", transition:"all 0.3s" }}>
              <div style={{ width:14, height:14, borderRadius:"50%", background:"#0D1B3E", position:"absolute", top:2, left:onlineStatus?16:2, transition:"left 0.3s" }} />
            </div>
          </div>
        )}
        <div onClick={()=>onNavigate("settings")}
          style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px", borderRadius:12, cursor:"pointer", marginBottom:6,
            background: screen==="settings" ? `${accentColor}22` : "rgba(255,255,255,0.05)",
            border: `1px solid ${screen==="settings" ? accentColor+"55" : "rgba(255,255,255,0.1)"}`,
            transition:"all 0.18s" }}
          onMouseEnter={e=>{ if(screen!=="settings") e.currentTarget.style.background="rgba(255,255,255,0.1)"; }}
          onMouseLeave={e=>{ if(screen!=="settings") e.currentTarget.style.background="rgba(255,255,255,0.05)"; }}
        >
          <span style={{ fontSize:16 }}>⚙️</span>
          <span style={{ fontSize:13, fontWeight: screen==="settings"?700:500, color: screen==="settings"?C.white:"rgba(255,255,255,0.75)" }}>Réglages</span>
          {screen==="settings" && <div style={{ marginLeft:"auto", width:5, height:5, borderRadius:"50%", background:accentColor }} />}
        </div>
        <div onClick={async()=>{ await supabase.auth.signOut(); onNavigate("role"); }} style={{ display:"flex", alignItems:"center", gap:8, padding:"9px 14px", borderRadius:10, cursor:"pointer", background:"rgba(242,94,94,0.08)", border:"1px solid rgba(242,94,94,0.2)" }}
          onMouseEnter={e=>e.currentTarget.style.background="rgba(242,94,94,0.18)"}
          onMouseLeave={e=>e.currentTarget.style.background="rgba(242,94,94,0.08)"}
        >
          <span style={{ fontSize:14 }}>🚪</span>
          <span style={{ fontSize:11, color:"#F25E5E", fontWeight:600 }}>Se déconnecter</span>
        </div>
      </div>
    </div>
  );
}

// ── RESPONSIVE LAYOUT WRAPPER ─────────────────────────────────────
function ResponsiveLayout({ children, screen, role, isLoggedIn, onNavigate, showClientNav, showPrestaNav, onlineStatus, onToggleOnline, unreadCount }) {
  const { isMobile } = useResponsive();

  const hybridBanner = !["bo_login","bo_dashboard"].includes(screen) && (
    <div style={{ background:"linear-gradient(90deg,#4F46E5,#7C3AED)", padding:"6px 16px", display:"flex", alignItems:"center", justifyContent:"center", gap:8, flexShrink:0 }}>
      <span style={{ fontSize:13 }}>⚡</span>
      <span style={{ fontSize:11, fontWeight:700, color:"#fff", letterSpacing:0.5 }}>⚡ ALANE · Tarif transparent · Prix affiché = Prix réel</span>
    </div>
  );

  const showAdminBtn = !["bo_login","bo_dashboard"].includes(screen);

  // Admin button — top-right, all screens
  const adminBtn = showAdminBtn && (
    <button
      onClick={() => onNavigate("bo_login")}
      title="Administration"
      style={{
        position: "fixed",
        top: 14,
        right: 14,
        zIndex: 9999,
        width: 34,
        height: 34,
        borderRadius: 10,
        background: "rgba(255,255,255,0.06)",
        border: "1px solid rgba(255,255,255,0.12)",
        color: "rgba(255,255,255,0.45)",
        fontSize: 16,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backdropFilter: "blur(10px)",
      }}
    >
      ⚙️
    </button>
  );


  if (isMobile) {
    return (
      <div style={{ width:"100%", height:"100vh", display:"flex", flexDirection:"column", fontFamily:"’DM Sans’,system-ui,sans-serif", background:C.bg, position:"relative", overflow:"hidden" }}>
        {hybridBanner}
        {(showClientNav || showPrestaNav) && (
          <div style={{ flexShrink:0, padding:"10px 18px", borderBottom:`1px solid rgba(255,255,255,0.06)`, display:"flex", alignItems:"center", background:"#050E20" }}>
            <div onClick={()=>onNavigate(role==="prestataire"?"p_home":"home")} style={{ cursor:"pointer" }}>
              <ALANELogo size="sm" />
            </div>
          </div>
        )}
        <div style={{ flex:1, overflowY:"auto", overflowX:"hidden" }}>
          {children}
        </div>
        {showClientNav && <ClientNav active={screen} onNavigate={onNavigate} unreadCount={unreadCount} />}
        {showPrestaNav && <PrestaNav active={screen} onNavigate={onNavigate} unreadCount={unreadCount} />}
        {adminBtn}
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
              Trouvez des prestataires qualifiés et vérifiés pour vos missions ponctuelles — en quelques minutes.
            </p>
            {/* Value props */}
            {[
              { icon:"✅", text:"Prestataires vérifiés et approuvés" },
              { icon:"🔒", text:"Paiement sécurisé en escrow" },
              { icon:"⭐", text:"Notes et avis après chaque mission" },
              { icon:"⚡", text:"Tarif transparent — prix affiché = prix réel" },
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
        <div style={{ flex:1, overflowY:"auto", overflowX:"hidden", display:"flex", flexDirection:"column" }}>
          {hybridBanner}
          <div style={{ flex:1, display:"flex", flexDirection:"column", maxWidth:560, width:"100%", margin:"0 auto", padding:"0 48px" }}>
            {children}
          </div>
        </div>
        {adminBtn}
      </div>
    );
  }

  return (
    <div style={{ display:"flex", height:"100vh", background:C.bg, fontFamily:"’Segoe UI’,system-ui,sans-serif", position:"relative" }}>
      {showSidebar && (
        <DesktopSidebar screen={screen} role={role} onNavigate={onNavigate} onlineStatus={onlineStatus} onToggleOnline={onToggleOnline} />
      )}
      <div style={{ flex:1, overflowY:"auto", overflowX:"hidden", display:"flex", flexDirection:"column" }}>
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
      {adminBtn}
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
export default function App() {
  const [screen,setScreen]=useState("splash");
  const [role,setRole]=useState(null);
  const [supaUser,setSupaUser]=useState(null);
  const [selectedProvider,setSelectedProvider]=useState(null);
  const [pendingProvider,setPendingProvider]=useState(null);
  const [selectedSector,setSelectedSector]=useState(null);
  const [selectedMissionId,setSelectedMissionId]=useState(null);
  const [chatClientId,setChatClientId]=useState(null);
  const [paymentAmount,setPaymentAmount]=useState(0);
  const [paymentHours,setPaymentHours]=useState(8);
  const [paymentDate,setPaymentDate]=useState("");
  const [paymentDescription,setPaymentDescription]=useState("");
  const [paymentAdresse,setPaymentAdresse]=useState("");
  const [paymentVille,setPaymentVille]=useState("");
  const [boUnlocked,setBoUnlocked]=useState(false);
  const [boTestMode,setBoTestMode]=useState(false);
  const [legalType,setLegalType]=useState("cgu");
  const [payslipData,setPayslipData]=useState(null);
  const [onlineStatus,setOnlineStatus]=useState(true);
  const [pendingMission,setPendingMission]=useState(null);
  const [bookingSource,setBookingSource]=useState("profile");
  const [unreadCount,setUnreadCount]=useState(0);
  const [notifCount,setNotifCount]=useState(0);
  const [clientCoords,setClientCoords]=useState(null);
  const [showOnboarding,setShowOnboarding]=useState(false);
  const [docsRefreshKey,setDocsRefreshKey]=useState(0);
  const [cookieNotice,setCookieNotice]=useState(()=>!localStorage.getItem("alane_cookie_ok"));

  // Capture ?ref=, ?profil=, ?bo= URL params
  useEffect(()=>{
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    if(ref && ref.length > 10) {
      sessionStorage.setItem("alane_referrer", ref);
    }
    const profil = params.get("profil");
    if(profil && profil.length > 30) {
      sessionStorage.setItem("alane_public_profil", profil);
    }
    if(params.get("bo") === "1") {
      setScreen("bo_login");
    }
    if(ref || profil || params.get("bo")) window.history.replaceState({}, "", window.location.pathname);
  },[]);

  // Public profil navigation — déclenché après que l'app est chargée
  useEffect(()=>{
    const profilId = sessionStorage.getItem("alane_public_profil");
    if(!profilId) return;
    sessionStorage.removeItem("alane_public_profil");
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
      supabase.auth.updateUser({ data: { plan_abonnement: plan } }).then(()=>{
        window.history.replaceState({}, "", window.location.pathname);
      });
    }
    if(params.get("sub_cancel") === "1") {
      window.history.replaceState({}, "", window.location.pathname);
    }
  },[]);

  // Tracking visiteur — une seule fois par session
  useEffect(()=>{
    if(sessionStorage.getItem("visit_tracked")) return;
    sessionStorage.setItem("visit_tracked","1");
    const sessionId = Math.random().toString(36).slice(2)+Date.now().toString(36);
    supabase.from("visits").insert({ session_id: sessionId }).then(()=>{}).catch(()=>{});
  },[]);

  // Reset badge messages non lus quand le chat est ouvert
  useEffect(()=>{
    if(screen==="chat"){
      localStorage.setItem("alane_msg_last_seen", new Date().toISOString());
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

  // Tracking GPS prestataire — envoie la position toutes les 60s quand mission assignée
  useEffect(()=>{
    if(!supaUser || role !== "prestataire" || !navigator.geolocation) return;
    const consentKey = `alane_gps_consent_${supaUser.id}`;
    if(!localStorage.getItem(consentKey)) {
      const ok = window.confirm("ALANE utilise votre position GPS uniquement pendant une mission assignée, pour permettre au client de suivre votre arrivée en temps réel. Votre position n'est jamais partagée en dehors d'une mission active.\n\nAutoriser la géolocalisation ?");
      if(!ok) return;
      localStorage.setItem(consentKey, "1");
    }
    let watchId = null;
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
    const iv = setInterval(sendPos, 60000);
    sendPos();
    return ()=>{ navigator.geolocation.clearWatch(watchId); clearInterval(iv); };
  },[supaUser, role]);

  // Poll messages non lus toutes les 10 secondes
  useEffect(()=>{
    if(!supaUser) return;
    let mounted = true;
    const userId = supaUser.id;
    const poll = async()=>{
      const lastSeen = localStorage.getItem("alane_msg_last_seen") || new Date(0).toISOString();
      const { data, error } = await supabase
        .from("messages")
        .select("id", { count:"exact" })
        .ilike("conversation_key", `%${userId}%`)
        .neq("sender_tag","client")
        .gt("created_at", lastSeen);
      if(!error && mounted) setUnreadCount(data?.length || 0);
    };
    poll();
    const interval = setInterval(poll, 10000);
    return ()=>{ mounted=false; clearInterval(interval); };
  },[supaUser]);

  // Onboarding : affiché une seule fois après le premier login
  useEffect(()=>{
    if(!supaUser) return;
    if(screen !== "home" && screen !== "p_home") return;
    const key = `alane_onboarded_${supaUser.id}`;
    if(!localStorage.getItem(key)) setShowOnboarding(true);
  },[screen, supaUser]);

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
  },[supaUser]);

  // Écouter les changements de session (déconnexion, reset password)
  // Ne pas auto-naviguer au démarrage : l'utilisateur passe toujours par le splash
  useEffect(()=>{
    let initialized = false;
    const { data:{ subscription } } = supabase.auth.onAuthStateChange((event,session)=>{
      // INITIAL_SESSION : on met à jour supaUser silencieusement, sans naviguer
      if(event==="INITIAL_SESSION"){ setSupaUser(session?.user||null); initialized=true; return; }
      // TOKEN_REFRESHED : simple mise à jour du user, jamais de navigation
      if(event==="TOKEN_REFRESHED"){ setSupaUser(session?.user||null); return; }

      setSupaUser(session?.user||null);
      if(event==="PASSWORD_RECOVERY") { setScreen("reset_password"); return; }
      if(event==="SIGNED_OUT") {
        // Ignorer le SIGNED_OUT si on est déjà sur un écran pre-login (évite les sauts au démarrage)
        if(!initialized) return;
        localStorage.removeItem("alane_stay_logged_in");
        sessionStorage.removeItem("alane_session_active");
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
        const preLoginScreens = ["splash","role","auth_client","auth_presta","how_client","how_presta","client_onboarding","presta_onboarding","presta_pending","pending_approval","reset_password","bo_login","bo_dashboard"];
        setScreen(prev => preLoginScreens.includes(prev) ? prev : "role");
      }
    });
    return ()=>subscription.unsubscribe();
  },[]);

  // Appelé quand l'utilisateur clique "Commencer" sur le splash
  const handleSplashNext = async () => {
    const { data:{ session } } = await supabase.auth.getSession();
    if(session){
      const stayLoggedIn  = localStorage.getItem("alane_stay_logged_in");
      const sessionActive = sessionStorage.getItem("alane_session_active");
      if (!stayLoggedIn && !sessionActive) {
        // Session Supabase persistée mais l'utilisateur n'a pas coché "Rester connecté"
        await supabase.auth.signOut();
        setScreen("role");
        return;
      }
      setSupaUser(session.user);
      const { data:profile } = await supabase.from("profiles").select("role,status").eq("id",session.user.id).single();
      if(profile?.role){
        setRole(profile.role);
        if(!profile.status || profile.status === "pending"){ setScreen("pending_approval"); return; }
        if(profile.status === "rejected"){ setScreen("role"); return; }
        setScreen(profile.role==="prestataire"?"p_home":"home");
        return;
      }
    }
    setScreen("role");
  };

  const PRESTA_SCREENS=["p_home","p_missions","p_dashboard","calendar","abonnement_presta","doc_upload","presta_profile_edit","presta_pointage","micro_entreprise"];
  const CLIENT_SCREENS=["home","catalogue","search_filters","dashboard","sector_detail","profile","cv","booking","stripe_pay","tracking","validation","cancellation","team_booking","mission_history","notifications","favorites","cashback","mission_request","mission_broadcast","mission_pending"];

  // Stack for browser back button — tracks app-internal navigation history
  const navStackRef = useRef([]);
  const screenRef = useRef(screen);
  useEffect(() => {
    screenRef.current = screen;
    // Vider la pile lors d'un retour aux écrans racine (déconnexion, etc.)
    if (["role", "splash", "pending_approval", "auth_client", "auth_presta"].includes(screen)) {
      navStackRef.current = [];
    }
  }, [screen]);

  // Initialise l'entrée courante dans l'historique du navigateur
  useEffect(() => {
    // Entrée tampon avec hash #/ — iOS Safari traite alane.fr et alane.fr#/ comme
    // deux pages différentes, ce qui garantit que popstate est déclenché au lieu
    // de quitter vers un autre site
    const buf = () => window.history.pushState({ alane: true }, "", window.location.pathname + "#/");
    buf();

    const handlePopState = () => {
      const prev = navStackRef.current.pop();
      buf(); // Toujours re-créer l'entrée tampon
      if (prev !== undefined) setScreen(prev);
    };

    // iOS BFCache : quand l'app est restaurée depuis le cache, ré-ajouter le tampon
    const handlePageShow = (e) => { if (e.persisted) buf(); };

    window.addEventListener("popstate", handlePopState);
    window.addEventListener("pageshow", handlePageShow);
    return () => {
      window.removeEventListener("popstate", handlePopState);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, []);

  const navigate=(to,data)=>{
    if(role==="client"    && PRESTA_SCREENS.includes(to)) return;
    if(role==="prestataire" && CLIENT_SCREENS.includes(to)) return;
    if(to==="profile"||to==="chat"||to==="tracking"||to==="validation"||to==="cancellation"||to==="contract"||to==="presta_pointage"||to==="rating") setSelectedProvider(data?.provider||data);
    if(to==="chat") setChatClientId(data?.clientId||null);
    if(to==="sector_detail") setSelectedSector(data);
    if(to==="booking") { setSelectedProvider(data); setBookingSource("profile"); }
    if(to==="stripe_pay") { setPaymentAmount(data?.amount||124); setPaymentHours(data?.hours||8); setPaymentDate(data?.date||""); setPaymentDescription(data?.description||""); setPaymentAdresse(data?.adresse||""); setPaymentVille(data?.ville||""); }
    if(to==="legal") setLegalType(data||"cgu");
    if(to==="payslip") setPayslipData(data);
    // Empiler l'écran courant pour le bouton retour navigateur
    navStackRef.current.push(screenRef.current);
    window.history.pushState({ alane: true }, "", window.location.pathname + "#/");
    if(to==="mission_request") setSelectedSector(data);
    if(to==="mission_broadcast") setPendingMission(data);
    setScreen(to);
  };

  const clientScreens=["home","catalogue","search_filters","dashboard","settings","contact_support"];
  const prestaScreens=["p_home","p_missions","p_dashboard","calendar","settings","contact_support"];
  const showClientNav=role==="client"&&clientScreens.includes(screen);
  const showPrestaNav=role==="prestataire"&&prestaScreens.includes(screen);

  return (
    <>
    {showOnboarding && supaUser && (
      <OnboardingScreen
        role={role}
        onDone={()=>{
          localStorage.setItem(`alane_onboarded_${supaUser.id}`, "1");
          setShowOnboarding(false);
        }}
        onNavigate={(to)=>{
          localStorage.setItem(`alane_onboarded_${supaUser.id}`, "1");
          setShowOnboarding(false);
          navigate(to);
        }}
      />
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
        <button onClick={()=>{ localStorage.setItem("alane_cookie_ok","1"); setCookieNotice(false); }}
          style={{ background:"#7C6FE0", border:"none", borderRadius:10, padding:"8px 18px", color:"#fff", fontWeight:700, fontSize:13, cursor:"pointer", whiteSpace:"nowrap", flexShrink:0 }}>
          J'ai compris
        </button>
      </div>
    )}
    <ResponsiveLayout
      screen={screen} role={role} isLoggedIn={!!supaUser} onNavigate={navigate}
      showClientNav={showClientNav} showPrestaNav={showPrestaNav}
      onlineStatus={onlineStatus} onToggleOnline={()=>setOnlineStatus(s=>!s)}
      unreadCount={unreadCount}
    >
      {screen==="reset_password"    && <ResetPasswordScreen onDone={()=>setScreen("role")} />}
      {screen==="pending_approval"  && <PendingApprovalScreen
        onLogout={async()=>{ await supabase.auth.signOut(); setRole(null); setScreen("role"); }}
        onApproved={(r)=>{ setRole(r); setScreen(r==="prestataire"?"p_home":"home"); }}
      />}
      {screen==="settings"          && <SettingsScreen role={role} onNavigate={navigate} onBack={()=>setScreen(role==="prestataire"?"p_home":"home")} onLogout={async()=>{ await supabase.auth.signOut(); setRole(null); setScreen("role"); }} />}
      {screen==="contact_support"   && <ContactSupportScreen onBack={()=>setScreen("settings")} />}
      {screen==="faq"               && <FAQScreen onBack={()=>setScreen("settings")} role={role} />}
      {screen==="splash"            && <SplashScreen onNext={handleSplashNext} onBackoffice={()=>setScreen("bo_login")} />}
      {screen==="role"              && <RoleScreen onSelect={r=>{ setRole(r); setScreen(r==="prestataire"?"auth_presta":"auth_client"); }} />}

      {/* Auth — connexion ou inscription pour les deux rôles */}
      {screen==="auth_client"       && <AuthScreen role="client"
          onLogin={()=>{ setRole("client"); setScreen("home"); }}
          onRegister={()=>setScreen("pending_approval")}
          onBack={()=>setScreen("role")} />}
      {screen==="auth_presta"       && <AuthScreen role="prestataire"
          onLogin={()=>{ setRole("prestataire"); setScreen("p_home"); }}
          onRegister={()=>setScreen("pending_approval")}
          onBack={()=>setScreen("role")} />}

      {/* Comment ca marche — uniquement pour les nouveaux inscrits */}
      {screen==="how_client"        && <HowItWorksScreen role="client" onNext={()=>setScreen("client_onboarding")} onBack={()=>setScreen("auth_client")} />}
      {screen==="how_presta"        && <HowItWorksScreen role="prestataire" onNext={()=>setScreen("presta_onboarding")} onBack={()=>setScreen("auth_presta")} />}

      {/* Onboarding complet — uniquement pour les nouveaux */}
      {screen==="client_onboarding" && <ClientOnboarding onComplete={()=>setScreen("home")} onBack={()=>setScreen("how_client")} />}
      {screen==="client_auth"       && <AuthScreen role="client" onLogin={()=>setScreen("home")} onRegister={()=>setScreen("how_client")} onBack={()=>setScreen("role")} />}
      {screen==="home"              && <HomeScreen onNavigate={navigate} notifCount={notifCount} />}
      {screen==="catalogue"         && <CatalogueScreen onNavigate={navigate} />}
      {screen==="sector_detail"     && <SectorDetailScreen sector={selectedSector} onNavigate={navigate} clientCoords={clientCoords} />}
      {screen==="mission_request"   && <MissionRequestScreen sector={selectedSector} onBack={()=>setScreen("sector_detail")} onSubmit={(m)=>{ if(m?.id) setSelectedMissionId(m.id); setScreen("mission_broadcast"); setPendingMission(m); }} />}
      {screen==="mission_broadcast" && <MissionBroadcastScreen mission={pendingMission} onCancel={()=>setScreen("mission_request")} onChoose={p=>{ setSelectedProvider(p); setBookingSource("mission_broadcast"); setScreen("booking"); }} />}
      {screen==="search_filters"    && <SearchFiltersScreen onNavigate={navigate} />}
      {screen==="profile"           && <ProfileScreen provider={selectedProvider} onNavigate={navigate} onBack={()=>setScreen(selectedSector?"sector_detail":"search_filters")} />}
      {screen==="cv"                && <CVScreen provider={selectedProvider} onBack={()=>setScreen("profile")} onNavigate={navigate} />}
      {screen==="booking"           && <BookingScreen provider={selectedProvider} onNavigate={(to,data)=>{ if(to==="stripe_pay") { setPaymentAmount(data?.amount||124); setPaymentHours(data?.hours||8); setPaymentDate(data?.date||""); setScreen("stripe_pay"); } else navigate(to,data); }} onBack={()=>{ setBookingSource("profile"); setScreen(bookingSource); }} />}
      {screen==="stripe_pay"        && <StripePaymentScreen amount={paymentAmount} provider={selectedProvider} description={paymentDescription} onSuccess={async()=>{
        setPendingProvider(selectedProvider);
        const { data:ud } = await supabase.auth.getUser();
        const userId = ud?.user?.id;
        if(selectedProvider?.id && userId){
          const today=new Date().toDateString();
          const mDay=paymentDate?new Date(paymentDate).toDateString():null;
          const isSameDay=!mDay||mDay===today;
          const deadline=new Date(Date.now()+(isSameDay?1:4)*3600000).toISOString();
          let missionId = selectedMissionId;
          if(missionId){
            // Flux broadcast : assigner le prestataire choisi
            await supabase.from("missions").update({ prestataire_id:selectedProvider.id, status:"pending_acceptance", acceptance_deadline:deadline }).eq("id",missionId);
          } else {
            // Flux direct (profil → booking) : créer la mission
            const { data:newM } = await supabase.from("missions").insert({
              client_id:userId, prestataire_id:selectedProvider.id,
              sector:selectedProvider.sector, metier:selectedProvider.jobTitle||selectedProvider.role,
              date:paymentDate||null, hours:paymentHours,
              tarif_horaire:selectedProvider.rateNum, montant_total:paymentAmount,
              description:paymentDescription||null,
              adresse:paymentAdresse||null,
              ville:paymentVille||null,
              status:"pending_acceptance", acceptance_deadline:deadline,
            }).select().single();
            if(newM){ missionId=newM.id; setSelectedMissionId(newM.id); }
          }
          await supabase.from("notifications").insert({ user_id:selectedProvider.id, type:"mission", title:"Nouvelle demande de mission", body:`Un client vous propose une mission. Vous avez ${isSameDay?"1 heure":"4 heures"} pour accepter ou refuser.`, read:false });
          fetch("/api/support", {
            method:"POST", headers:{"Content-Type":"application/json"},
            body: JSON.stringify({
              action: "booking_confirm",
              clientEmail: ud?.user?.email||null,
              clientName: ud?.user?.user_metadata?.prenom||null,
              prestaName: selectedProvider.name||null,
              job: selectedProvider.jobTitle||selectedProvider.role||null,
              date: paymentDate||null,
              hours: paymentHours||null,
              total: paymentAmount,
            }),
          }).catch(()=>{});
        }
        setScreen("mission_pending");
      }} onBack={()=>setScreen("booking")} />}
      {screen==="mission_pending"   && <MissionPendingScreen
        provider={pendingProvider||selectedProvider}
        amount={paymentAmount}
        missionId={selectedMissionId}
        hours={paymentHours}
        onAccepted={()=>setScreen("contract")}
        onCancelled={()=>{ setScreen("sector_detail"); }}
        onBack={()=>setScreen("home")}
      />}
      {screen==="contract"          && <ContractScreen provider={selectedProvider} amount={paymentAmount} hours={paymentHours} missionId={selectedMissionId} onSign={()=>setScreen("tracking")} onBack={()=>setScreen("stripe_pay")} />}
      {screen==="tracking"          && <TrackingScreen provider={selectedProvider} missionId={selectedMissionId} onNavigate={navigate} />}
      {screen==="validation"        && <ValidationScreen provider={selectedProvider} role={role} missionId={selectedMissionId} onNavigate={navigate} />}
      {screen==="invoice"           && <InvoiceScreen provider={selectedProvider} amount={paymentAmount} hours={paymentHours} missionId={selectedMissionId} onBack={()=>setScreen("dashboard")} />}
      {screen==="cancellation"      && <CancellationScreen provider={selectedProvider} missionId={selectedMissionId} missionDate={paymentAmount?.date||null} onNavigate={navigate} onBack={()=>setScreen("dashboard")} />}
      {screen==="team_booking"      && <TeamBookingScreen onNavigate={navigate} onBack={()=>setScreen("home")} />}
      {screen==="mission_history"   && <MissionHistoryScreen onNavigate={navigate} onBack={()=>setScreen("dashboard")} />}
      {screen==="chat"              && <ChatScreen provider={selectedProvider} chatClientId={chatClientId} onBack={()=>setScreen(role==="prestataire"?"p_missions":"search_filters")} />}
      {screen==="notifications"     && <NotificationsScreen onBack={()=>setScreen("home")} onNavigate={navigate} />}
      {screen==="favorites"         && <FavoritesScreen onNavigate={navigate} onBack={()=>setScreen("home")} />}
      {screen==="referral"          && <ReferralScreen onBack={()=>setScreen("home")} />}
      {screen==="abonnement_presta" && <AbonnementPrestaScreen onBack={()=>setScreen("p_dashboard")} />}
      {screen==="cashback"          && <CashbackWalletScreen onBack={()=>setScreen("dashboard")} onNavigate={navigate} />}
      {screen==="rating"            && <RatingScreen provider={selectedProvider} missionId={selectedProvider?._missionId} onSubmit={()=>setScreen("home")} onBack={()=>setScreen(selectedProvider?._fromHistory?"mission_history":"validation")} />}
      {screen==="doc_upload"           && <DocUploadScreen onBack={()=>{ setDocsRefreshKey(k=>k+1); setScreen("p_dashboard"); }} />}
      {screen==="micro_entreprise"     && <MicroEntrepriseScreen onBack={()=>setScreen("p_dashboard")} />}
      {screen==="presta_profile_edit"  && <PrestaProfileEditScreen onBack={()=>setScreen("p_dashboard")} />}
      {screen==="presta_pointage"      && <PrestaPointageScreen provider={{...selectedProvider, _pointageType:undefined}} type={selectedProvider?._pointageType||"in"} onSuccess={()=>setScreen("p_missions")} onBack={()=>setScreen("p_missions")} />}
      {screen==="calendar"          && <CalendarScreen />}
      {screen==="legal"             && <LegalScreen type={legalType} onBack={()=>setScreen(role?"dashboard":"splash")} />}
      {screen==="payslip"           && <PayslipScreen provider={payslipData?.provider||selectedProvider} mission={payslipData} onBack={()=>setScreen(role==="prestataire"?"p_dashboard":"dashboard")} />}
      {screen==="bo_login"          && <BackofficeLogin onLogin={()=>{ setBoUnlocked(true); setScreen("bo_dashboard"); }} onBack={()=>setScreen("splash")} />}
      {screen==="bo_dashboard"      && boUnlocked && <BackofficeDashboard onBack={()=>{ sessionStorage.removeItem("bo_token"); setBoUnlocked(false); setScreen("splash"); }} onNavigate={(s,r,data)=>{ if(r) setRole(r); setBoTestMode(true); navigate(s,data); }} />}
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
                  <Badge color={getCashbackTier(0).color} small>
                    {getCashbackTier(0).icon} {getCashbackTier(0).label}
                  </Badge>
                </div>
                <div style={{ color:C.textSub, fontSize:12 }}>
                  <strong style={{ color:C.success }}>0,00 €</strong> · {(getCashbackTier(0).rate*100).toFixed(0)}% sur chaque mission
                </div>
              </div>
              <span style={{ color:C.violet, fontSize:18 }}>›</span>
            </div>
          </div>

          <div style={{ padding:"20px 18px" }}>

            {/* Actions rapides */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:20 }}>
              {[
                { icon:"📋", label:"Mes missions",   color:C.violet,     action:"mission_history" },
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
              { icon:"📄", label:"Mes factures",      sub:"Télécharger mes justificatifs",    action:"invoice"       },
              { icon:"🎁", label:"Parrainage",         sub:"3 filleuls Premium = 1 mois offert", action:"referral"      },
              { icon:"📋", label:"CGU",                sub:"Conditions générales",             action:"legal_cgu"     },
              { icon:"🔒", label:"Confidentialité",    sub:"Politique de données",             action:"legal_privacy" },
              { icon:"⚙️", label:"Paramètres",         sub:"Compte, sécurité, paiement",      action:"settings"      },
            ].map((item,i) => (
              <div key={i} onClick={()=>{
                if(item.action==="legal_cgu") navigate("legal","cgu");
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
          <PrestaDashboard activeScreen={screen} docsRefreshKey={docsRefreshKey} onNavigate={(to,data)=>{
            if(to==="payslip") navigate("payslip",data);
            else if(to==="legal") navigate("legal",data);
            else navigate(to,data);
          }} />
          {screen==="p_dashboard" && (
            <div style={{ padding:"0 18px 18px" }}>
              <OnlineStatusWidget online={onlineStatus} onToggle={()=>setOnlineStatus(s=>!s)} />
              <div style={{ display:"flex", gap:10 }}>
                <button onClick={()=>navigate("legal","cgu")} style={{ flex:1, padding:"11px", borderRadius:12, border:`1px solid ${C.border}`, background:"#0D1B3E", color:C.textSub, fontSize:12, cursor:"pointer", fontFamily:"inherit", fontWeight:600 }}>📋 CGU</button>
                <button onClick={()=>navigate("legal","privacy")} style={{ flex:1, padding:"11px", borderRadius:12, border:`1px solid ${C.border}`, background:"#0D1B3E", color:C.textSub, fontSize:12, cursor:"pointer", fontFamily:"inherit", fontWeight:600 }}>🔒 Confidentialité</button>
              </div>
            </div>
          )}
        </div>
      )}
    </ResponsiveLayout>
    </>
  );
}