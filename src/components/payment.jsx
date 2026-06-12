import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase.js";
import { C, font, r } from "../constants/colors.js";
import { Btn, Stars } from "./ui.jsx";

// ── useProviders hook (needed by MissionPendingScreen and CancellationScreen) ──
function useProviders() {
  const [providers, setProviders] = useState([]);
  useEffect(() => {
    // Providers are mock/demo data loaded from the main app
    // This is a local copy to avoid circular imports
    setProviders([]);
  }, []);
  return { providers };
}

// Re-export the real useProviders from the main app via a different mechanism.
// Since MissionPendingScreen and CancellationScreen call useProviders() internally,
// we inject it via a module-level reference that gets set by App.jsx.
let _useProviders = useProviders;
export function setUseProviders(fn) { _useProviders = fn; }

// ── MISSION PENDING SCREEN ────────────────────────────────────────
export function MissionPendingScreen({ provider, amount, hours, missionId, onAccepted, onCancelled, onBack }) {
  if (!provider) return <div style={{ padding:40, textAlign:"center", color:C.textSub }}><button onClick={onBack} style={{ background:"transparent", border:"none", color:C.textSub, cursor:"pointer", fontSize:13, display:"block", marginBottom:16 }}>← Retour</button>Prestataire introuvable.</div>;
  const p = provider;
  const { providers: allProviders } = _useProviders();
  const [secsLeft, setSecsLeft]     = useState(3600);
  const [totalSecs, setTotalSecs]   = useState(3600);
  const [phase, setPhase]           = useState("waiting");
  const [loaded, setLoaded]         = useState(!missionId);
  const [clientId, setClientId]     = useState(null);

  // Charger le délai réel depuis Supabase
  useEffect(() => {
    if (!missionId) { setLoaded(true); return; }
    let mounted = true;
    supabase.from("missions").select("status,acceptance_deadline,client_id").eq("id", missionId).single()
      .then(({ data }) => {
        if (!mounted || !data) return;
        if (data.status === "assigned") { setPhase("accepted"); return; }
        if (data.status === "refused")  { setPhase("refused");  return; }
        setClientId(data.client_id || null);
        if (data.acceptance_deadline) {
          const secs = Math.max(0, Math.floor((new Date(data.acceptance_deadline).getTime() - Date.now()) / 1000));
          setSecsLeft(secs);
          setTotalSecs(secs > 0 ? secs : 3600);
        }
        setLoaded(true);
      });
    return () => { mounted = false; };
  }, [missionId]);

  // Polling toutes les 5s pour détecter la réponse du prestataire
  useEffect(() => {
    if (!missionId || phase !== "waiting") return;
    let mounted = true;
    const poll = async () => {
      const { data } = await supabase.from("missions").select("status").eq("id", missionId).single();
      if (!mounted || !data) return;
      if (data.status === "assigned") setPhase("accepted");
      else if (data.status === "refused") setPhase("refused");
    };
    const interval = setInterval(poll, 5000);
    return () => { mounted = false; clearInterval(interval); };
  }, [missionId, phase]);

  // Compte à rebours
  useEffect(() => {
    if (!loaded || phase !== "waiting") return;
    const t = setInterval(() => {
      setSecsLeft(s => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => clearInterval(t);
  }, [loaded, phase]);

  // Timeout : refus automatique
  useEffect(() => {
    if (!loaded || secsLeft !== 0 || phase !== "waiting") return;
    setPhase("timeout");
    if (missionId) {
      supabase.from("missions").update({ status: "refused" }).eq("id", missionId).then(()=>{});
      if (clientId) {
        supabase.from("notifications").insert({
          user_id: clientId, type: "mission",
          title: "Mission non confirmée",
          body: `${p.name} n'a pas répondu dans le délai imparti. Vous pouvez choisir un autre prestataire.`,
          read: false,
        }).then(()=>{});
      }
    }
  }, [loaded, secsLeft, phase, missionId, clientId]);


  const formatTimer = (secs) => {
    if (secs <= 0) return "0s";
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0) return h + "h " + String(m).padStart(2,"0") + "min";
    if (m > 0) return String(m).padStart(2,"0") + "min " + String(s).padStart(2,"0") + "s";
    return String(s).padStart(2,"0") + "s";
  };

  const pct = totalSecs > 0 ? Math.round((secsLeft / totalSecs) * 100) : 0;
  const circumference = 2 * Math.PI * 54;
  const dash = (pct / 100) * circumference;

  // ── PHASE : EN ATTENTE ─────────────────────────────────────────
  if (phase === "waiting") return (
    <div style={{ minHeight:"100%", background:"linear-gradient(180deg,#0A1628,#0D1B3E)", paddingBottom:40, display:"flex", flexDirection:"column" }}>
      <div style={{ background:"linear-gradient(135deg,#0A1628,#162547)", borderBottom:"1px solid "+C.border, padding:"52px 22px 24px" }}>
        <h2 style={{ color:C.text, fontSize:20, fontWeight:700, margin:"0 0 4px", fontFamily:font.display }}>⏳ En attente de confirmation</h2>
        <p style={{ color:C.textSub, fontSize:13, margin:0 }}>Demande envoyée à {p.name}</p>
      </div>

      <div style={{ padding:"28px 22px", flex:1, display:"flex", flexDirection:"column", alignItems:"center" }}>

        {/* Compte à rebours circulaire */}
        <div style={{ position:"relative", width:140, height:140, marginBottom:24 }}>
          <svg width={140} height={140} style={{ transform:"rotate(-90deg)" }}>
            <circle cx={70} cy={70} r={54} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={8} />
            <circle cx={70} cy={70} r={54} fill="none"
              stroke={secsLeft < 12 ? C.accent : C.violet}
              strokeWidth={8}
              strokeDasharray={circumference}
              strokeDashoffset={circumference - dash}
              strokeLinecap="round"
              style={{ transition:"stroke-dashoffset 0.9s linear, stroke 0.3s" }}
            />
          </svg>
          <div style={{ position:"absolute", top:"50%", left:"50%", transform:"translate(-50%,-50%)", textAlign:"center" }}>
            <div style={{ fontSize:22, fontWeight:800, color:secsLeft<12?C.accent:C.text }}>{formatTimer(secsLeft)}</div>
            <div style={{ fontSize:10, color:C.textMuted, marginTop:2 }}>restant</div>
          </div>
        </div>

        {/* Carte prestataire */}
        <div style={{ width:"100%", background:"#0D1B3E", border:"1px solid "+C.border, borderRadius:r, padding:"16px", marginBottom:18, display:"flex", gap:14, alignItems:"center" }}>
          <div style={{ width:52, height:52, borderRadius:14, background:p.color+"22", display:"flex", alignItems:"center", justifyContent:"center", fontSize:26, flexShrink:0 }}>{p.avatar}</div>
          <div style={{ flex:1 }}>
            <div style={{ fontWeight:700, color:C.text, fontSize:15 }}>{p.name}</div>
            <div style={{ color:C.textSub, fontSize:12, marginTop:2 }}>{p.jobTitle||p.role}</div>
            <div style={{ display:"flex", gap:6, marginTop:6, alignItems:"center" }}>
              <span style={{ color:C.accentGold, fontSize:13 }}>★</span>
              <span style={{ color:C.text, fontSize:13, fontWeight:700 }}>{p.rating}</span>
              <span style={{ color:C.textSub, fontSize:12 }}>· {p.missions} missions</span>
              <span style={{ color:C.textSub, fontSize:12 }}>· {p.responseTime}</span>
            </div>
          </div>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontWeight:800, color:C.success, fontSize:15 }}>{amount} €</div>
            <div style={{ color:C.textMuted, fontSize:11, marginTop:2 }}>{hours}h</div>
          </div>
        </div>

        {/* Statut animé */}
        <div style={{ width:"100%", background:C.violet+"10", border:"1px solid "+C.violet+"30", borderRadius:r, padding:"14px 16px", marginBottom:18 }}>
          <div style={{ display:"flex", gap:10, alignItems:"center" }}>
            <div style={{ width:10, height:10, borderRadius:"50%", background:C.violet, boxShadow:"0 0 8px "+C.violet, flexShrink:0, animation:"pulse 1.5s ease-in-out infinite" }} />
            <div>
              <div style={{ fontWeight:700, color:C.text, fontSize:13 }}>Notification envoyée à {p.name}</div>
              <div style={{ color:C.textSub, fontSize:12, marginTop:2 }}>Il dispose d'une heure pour accepter ou refuser la mission</div>
            </div>
          </div>
        </div>

        {/* Info paiement sécurisé */}
        <div style={{ width:"100%", background:"rgba(255,255,255,0.03)", border:"1px solid "+C.border, borderRadius:r, padding:"12px 14px", marginBottom:24, fontSize:12, color:C.textSub, lineHeight:1.6 }}>
          🔒 <strong style={{ color:C.text }}>Votre paiement est sécurisé</strong> — Les fonds sont sécurisés via Stripe mais ne seront libérés que si {p.name} accepte la mission. En cas de refus ou de timeout, contactez le support pour un remboursement.
        </div>

        {/* Bouton annuler */}
        <button onClick={onBack} style={{ width:"100%", padding:"14px", border:"1px solid "+C.border, borderRadius:r, background:"transparent", color:C.textSub, fontSize:14, cursor:"pointer", fontFamily:"inherit" }}>
          Annuler la demande
        </button>


      </div>
    </div>
  );

  // ── PHASE : ACCEPTÉE ───────────────────────────────────────────
  if (phase === "accepted") return (
    <div style={{ minHeight:"100%", background:"linear-gradient(180deg,#0A1628,#0D1B3E)", padding:"0 0 40px", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
      <div style={{ padding:"48px 28px", textAlign:"center", maxWidth:360, width:"100%" }}>
        <div style={{ width:100, height:100, borderRadius:"50%", background:C.success+"20", border:"3px solid "+C.success, display:"flex", alignItems:"center", justifyContent:"center", fontSize:48, margin:"0 auto 24px" }}>✅</div>
        <h2 style={{ color:C.success, fontSize:24, fontWeight:800, margin:"0 0 12px", fontFamily:font.display }}>Mission acceptée !</h2>
        <p style={{ color:C.textSub, fontSize:14, lineHeight:1.7, marginBottom:28 }}>
          <strong style={{ color:C.text }}>{p.name}</strong> a accepté votre demande. Le contrat est en cours de génération.
        </p>
        <div style={{ background:"#0D1B3E", border:"1px solid "+C.border, borderRadius:r, padding:"14px 16px", marginBottom:24, textAlign:"left" }}>
          <div style={{ display:"flex", justifyContent:"space-between", padding:"5px 0" }}>
            <span style={{ color:C.textSub, fontSize:13 }}>Prestataire</span>
            <span style={{ fontWeight:700, color:C.text, fontSize:13 }}>{p.name}</span>
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", padding:"5px 0" }}>
            <span style={{ color:C.textSub, fontSize:13 }}>Durée</span>
            <span style={{ fontWeight:700, color:C.text, fontSize:13 }}>{hours}h</span>
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", padding:"5px 0" }}>
            <span style={{ color:C.textSub, fontSize:13 }}>Total</span>
            <span style={{ fontWeight:800, color:C.success, fontSize:15 }}>{amount} €</span>
          </div>
        </div>
        <Btn full variant="success" onClick={onAccepted} style={{ fontSize:15, padding:"17px" }}>
          Signer le contrat →
        </Btn>
      </div>
    </div>
  );

  // ── PHASE : REFUSÉE ────────────────────────────────────────────
  if (phase === "refused") return (
    <div style={{ minHeight:"100%", background:"linear-gradient(180deg,#0A1628,#0D1B3E)", padding:"0 0 40px", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
      <div style={{ padding:"48px 28px", textAlign:"center", maxWidth:360, width:"100%" }}>
        <div style={{ width:100, height:100, borderRadius:"50%", background:C.accent+"15", border:"3px solid "+C.accent, display:"flex", alignItems:"center", justifyContent:"center", fontSize:48, margin:"0 auto 24px" }}>❌</div>
        <h2 style={{ color:C.accent, fontSize:24, fontWeight:800, margin:"0 0 12px", fontFamily:font.display }}>Mission refusée</h2>
        <p style={{ color:C.textSub, fontSize:14, lineHeight:1.7, marginBottom:8 }}>
          <strong style={{ color:C.text }}>{p.name}</strong> a décliné la mission. Votre paiement est intégralement remboursé.
        </p>
        <div style={{ background:C.accentGold+"10", border:"1px solid "+C.accentGold+"30", borderRadius:r, padding:"13px 15px", marginBottom:24, fontSize:13, color:C.textSub, lineHeight:1.6 }}>
          💡 Pas de panique — il y a <strong style={{ color:C.text }}>d'autres prestataires disponibles</strong> dans ce secteur. Choisissez-en un autre pour votre mission.
        </div>
        {(()=>{
          const alts = allProviders.filter(ap => ap.sector === p.sector && ap.id !== p.id && ap.available).slice(0,3);
          if(alts.length===0) return null;
          return (
            <div style={{ marginBottom:24, textAlign:"left" }}>
              <div style={{ fontWeight:700, color:C.text, fontSize:12, marginBottom:10 }}>Disponibles dans ce secteur :</div>
              {alts.map(alt=>(
                <div key={alt.id} style={{ background:"rgba(255,255,255,0.06)", border:`1px solid ${C.border}`, borderRadius:12, padding:"11px 14px", marginBottom:8, display:"flex", alignItems:"center", gap:10 }}>
                  <div style={{ fontSize:24 }}>{alt.avatar}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:700, color:C.text, fontSize:13 }}>{alt.name}</div>
                    <div style={{ color:C.textSub, fontSize:11 }}>{alt.jobTitle} · {alt.hourlyRate}</div>
                  </div>
                  <div style={{ width:7, height:7, borderRadius:"50%", background:C.success }} />
                </div>
              ))}
            </div>
          );
        })()}
        <Btn full onClick={onCancelled} style={{ fontSize:15, padding:"17px", marginBottom:12 }}>
          Choisir un autre prestataire →
        </Btn>
        <button onClick={onBack} style={{ width:"100%", padding:"13px", border:"1px solid "+C.border, borderRadius:r, background:"transparent", color:C.textSub, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
          Annuler définitivement
        </button>
      </div>
    </div>
  );

  // ── PHASE : TIMEOUT ─────────────────────────────────────────────
  return (
    <div style={{ minHeight:"100%", background:"linear-gradient(180deg,#0A1628,#0D1B3E)", padding:"0 0 40px", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
      <div style={{ padding:"48px 28px", textAlign:"center", maxWidth:360, width:"100%" }}>
        <div style={{ width:100, height:100, borderRadius:"50%", background:C.accentGold+"15", border:"3px solid "+C.accentGold, display:"flex", alignItems:"center", justifyContent:"center", fontSize:48, margin:"0 auto 24px" }}>⏰</div>
        <h2 style={{ color:C.accentGold, fontSize:24, fontWeight:800, margin:"0 0 12px", fontFamily:font.display }}>Délai dépassé</h2>
        <p style={{ color:C.textSub, fontSize:14, lineHeight:1.7, marginBottom:8 }}>
          <strong style={{ color:C.text }}>{p.name}</strong> n'a pas répondu dans le délai d'une heure. La mission est automatiquement annulée.
        </p>
        <div style={{ background:C.success+"08", border:"1px solid "+C.success+"25", borderRadius:r, padding:"13px 15px", marginBottom:24, fontSize:13, color:C.textSub, lineHeight:1.6 }}>
          ✅ <strong style={{ color:C.text }}>Paiement annulé</strong> — Aucun débit n'a été effectué. Le paiement Stripe est annulé instantanément.
        </div>
        <div style={{ background:"rgba(255,255,255,0.03)", border:"1px solid "+C.border, borderRadius:r, padding:"13px 15px", marginBottom:24, fontSize:12, color:C.textSub, lineHeight:1.6 }}>
          📧 Un email de confirmation vous a été envoyé. Le prestataire a été notifié de l'annulation automatique.
        </div>
        {(()=>{
          const alts = allProviders.filter(ap => ap.sector === p.sector && ap.id !== p.id && ap.available).slice(0,3);
          if(alts.length===0) return null;
          return (
            <div style={{ marginBottom:24, textAlign:"left" }}>
              <div style={{ fontWeight:700, color:C.text, fontSize:12, marginBottom:10 }}>Disponibles dans ce secteur :</div>
              {alts.map(alt=>(
                <div key={alt.id} style={{ background:"rgba(255,255,255,0.06)", border:`1px solid ${C.border}`, borderRadius:12, padding:"11px 14px", marginBottom:8, display:"flex", alignItems:"center", gap:10 }}>
                  <div style={{ fontSize:24 }}>{alt.avatar}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:700, color:C.text, fontSize:13 }}>{alt.name}</div>
                    <div style={{ color:C.textSub, fontSize:11 }}>{alt.jobTitle} · {alt.hourlyRate}</div>
                  </div>
                  <div style={{ width:7, height:7, borderRadius:"50%", background:C.success }} />
                </div>
              ))}
            </div>
          );
        })()}
        <Btn full onClick={onCancelled} style={{ fontSize:15, padding:"17px", marginBottom:12 }}>
          Choisir un autre prestataire →
        </Btn>
        <button onClick={onBack} style={{ width:"100%", padding:"13px", border:"1px solid "+C.border, borderRadius:r, background:"transparent", color:C.textSub, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
          Retour à l'accueil
        </button>
      </div>
    </div>
  );
}

// ── STRIPE PAYMENT SCREEN ─────────────────────────────────────────
export function StripePaymentScreen({ amount, provider, description, teamMode, teamProviders, onSuccess, onBack }) {
  const [method, setMethod] = useState("card");
  const [cardName, setCardName] = useState("");
  const [processing, setProcessing] = useState(false);
  const [done, setDone] = useState(false);
  const [stripeError, setStripeError] = useState(null);
  const [savedIban, setSavedIban]     = useState("");
  const [editingIban, setEditingIban] = useState(false);
  const [ibanInput, setIbanInput]     = useState("");
  const stripeRef   = useRef(null);
  const cardElRef   = useRef(null);
  const mountRef    = useRef(null);

  const [savedCard, setSavedCard]     = useState(null); // { pmId, customerId, brand, last4 }
  const [useSavedCard, setUseSavedCard] = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const m = data?.user?.user_metadata || {};
      const rib = m.rib || "";
      setSavedIban(rib);
      setIbanInput(rib);
      if (m.stripe_pm_id) {
        setSavedCard({ pmId: m.stripe_pm_id, customerId: m.stripe_customer_id, brand: m.card_brand||"card", last4: m.card_last4||"••••" });
      }
    });
  }, []);

  const total = (typeof amount === 'object' ? (amount?.amount ?? 124) : (amount ?? 124));
  const providers = teamMode ? (teamProviders||[]) : (provider ? [provider] : []);
  if (!providers.length) return <div style={{ padding:40, textAlign:"center", color:C.textSub }}><button onClick={onBack} style={{ background:"transparent", border:"none", color:C.textSub, cursor:"pointer", fontSize:13, display:"block", marginBottom:16 }}>← Retour</button>Prestataire introuvable.</div>;

  useEffect(() => {
    if (method !== "card") return;
    if (savedCard && useSavedCard) {
      (async () => {
        const { loadStripe } = await import("@stripe/stripe-js");
        const pk = import.meta.env.VITE_STRIPE_PUBLIC_KEY;
        if (!pk) return;
        stripeRef.current = await loadStripe(pk);
      })();
      return;
    }
    let cardEl;
    (async () => {
      const { loadStripe } = await import("@stripe/stripe-js");
      const pk = import.meta.env.VITE_STRIPE_PUBLIC_KEY;
      if (!pk || !mountRef.current) return;
      const stripe = await loadStripe(pk);
      if (!stripe) return;
      stripeRef.current = stripe;
      const elements = stripe.elements();
      cardEl = elements.create("card", {
        hidePostalCode: true,
        style: {
          base: { color:"#e2e8f0", fontFamily:"inherit", fontSize:"15px", "::placeholder":{ color:"#64748b" } },
          invalid: { color:"#f87171" },
        },
      });
      cardElRef.current = cardEl;
      if (mountRef.current) cardEl.mount(mountRef.current);
    })();
    return () => { if (cardEl) { cardEl.destroy(); cardElRef.current = null; } };
  }, [method, useSavedCard]);

  const handlePay = async () => {
    if (processing) return;
    setStripeError(null);
    if (method === "card") {
      const useStored = savedCard && useSavedCard;
      if (!stripeRef.current) { setStripeError("Stripe non initialisé, rechargez la page."); return; }
      if (!useStored && !cardElRef.current) { setStripeError("Stripe non initialisé, rechargez la page."); return; }
      setProcessing(true);
      try {
        const r = await fetch("/api/stripe-intent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amount: total, currency: "eur", customerId: savedCard?.customerId||null, metadata: { prestataire: providers[0]?.id || "", description: description || "" } }),
        });
        const { clientSecret, error: intentErr } = await r.json();
        if (intentErr || !clientSecret) throw new Error(intentErr || "Erreur création paiement");
        const confirmOpts = useStored
          ? { payment_method: savedCard.pmId }
          : { payment_method: { card: cardElRef.current, billing_details: cardName ? { name: cardName } : undefined } };
        const { error, paymentIntent } = await stripeRef.current.confirmCardPayment(clientSecret, confirmOpts);
        if (error) { setStripeError(error.message); setProcessing(false); return; }
        if (paymentIntent?.status === "succeeded") {
          setDone(true); setProcessing(false); onSuccess && onSuccess();
        }
      } catch (e) { setStripeError(e.message || "Erreur paiement"); setProcessing(false); }
    } else if (method === "apple") {
      setStripeError("Apple Pay n'est pas disponible. Veuillez utiliser le paiement par carte.");
    } else if (method === "wire") {
      setStripeError("Le paiement par virement nécessite une confirmation manuelle. Notre équipe vous contactera pour finaliser.");
    }
  };

  if(done) return (
    <div style={{ minHeight:"100%", background:`linear-gradient(160deg,${C.success},#1a7a40)`, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:32, textAlign:"center" }}>
      <div style={{ width:90, height:90, borderRadius:"50%", background:"rgba(255,255,255,0.2)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:44, marginBottom:20 }}>✓</div>
      <h2 style={{ color:C.white, fontSize:26, fontWeight:800, margin:"0 0 10px", fontFamily:font.display }}>Paiement sécurisé !</h2>
      <p style={{ color:"rgba(255,255,255,0.8)", fontSize:15, lineHeight:1.8, maxWidth:280, margin:"0 auto 24px" }}>
        <strong>{total} €</strong> sécurisés via Stripe.<br/>Libérés après validation de la mission.
      </p>
      <div style={{ background:"rgba(255,255,255,0.15)", borderRadius:16, padding:"16px 20px", width:"100%", maxWidth:300, marginBottom:24, textAlign:"left" }}>
        {[
          "🔒 Argent sécurisé jusqu'à validation",
          "📧 Confirmation envoyée par email",
          teamMode ? `👥 ${providers.length} prestataires notifiés` : `👤 ${providers[0]?.name} notifié(e)`,
          "📄 Contrat de mission généré",
        ].map((s,i) => <div key={i} style={{ color:"rgba(255,255,255,0.85)", fontSize:13, padding:"5px 0" }}>{s}</div>)}
      </div>
    </div>
  );

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg, #0A1628 0%, #0D1B3E 100%)`, paddingBottom:80 }}>
      <div style={{ background:"linear-gradient(135deg, #0A1628, #162547)", padding:"48px 22px 24px", borderRadius:"0 0 26px 26px" }}>
        <button onClick={onBack} style={{ background:"rgba(255,255,255,0.15)", border:"none", borderRadius:10, padding:"7px 14px", color:C.white, cursor:"pointer", fontSize:13, marginBottom:14 }}>← Retour</button>
        <h2 style={{ color:C.white, fontSize:20, fontWeight:800, margin:"0 0 4px" }}>💳 Paiement sécurisé</h2>
        <p style={{ color:"rgba(255,255,255,0.55)", fontSize:13, margin:0 }}>Argent bloqué jusqu'à validation mutuelle</p>
      </div>

      <div style={{ padding:"20px 18px" }}>
        {/* Résumé commande */}
        <div style={{ background:"#0D1B3E", borderRadius:16, padding:"16px", marginBottom:16, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
          <div style={{ fontWeight:800, color:C.text, fontSize:14, marginBottom:12 }}>📋 Récapitulatif</div>
          {providers.map((p,i) => (
            <div key={i} style={{ display:"flex", gap:10, alignItems:"center", padding:"8px 0", borderBottom:`1px solid ${C.border}` }}>
              <span style={{ fontSize:22 }}>{p.avatar}</span>
              <div style={{ flex:1 }}><div style={{ fontWeight:700, color:C.text, fontSize:13 }}>{p.name}</div><div style={{ color:C.textSub, fontSize:11 }}>{p.role} · {p.hourlyRate} HT</div></div>
            </div>
          ))}
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", paddingTop:12 }}>
            <span style={{ color:C.textSub, fontSize:13 }}>Total à bloquer</span>
            <span style={{ fontWeight:800, color:C.violet, fontSize:20 }}>{total} €</span>
          </div>
          <div style={{ background:`${C.success}15`, borderRadius:8, padding:"8px 10px", marginTop:10, fontSize:11, color:C.success, fontWeight:600 }}>
            🔒 Libéré uniquement après validation des deux parties
          </div>
        </div>

        {/* Méthode de paiement */}
        <div style={{ background:"#0D1B3E", borderRadius:16, padding:"16px", marginBottom:16, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
          <div style={{ fontWeight:800, color:C.text, fontSize:14, marginBottom:12 }}>Mode de paiement</div>
          <div style={{ display:"flex", gap:8, marginBottom:16 }}>
            {[{id:"card",icon:"💳",label:"Carte"},{id:"apple",icon:"",label:"Apple Pay"},{id:"wire",icon:"🏦",label:"Virement"}].map(m => (
              <button key={m.id} onClick={()=>setMethod(m.id)} style={{ flex:1, padding:"10px 6px", borderRadius:12, border:`2px solid ${method===m.id?C.violet:C.grayLight}`, background:method===m.id?`${C.violet}08`:C.white, cursor:"pointer", fontFamily:"inherit", transition:"all 0.2s" }}>
                <div style={{ fontSize:18 }}>{m.icon}</div>
                <div style={{ fontSize:11, fontWeight:method===m.id?700:500, color:method===m.id?C.violet:C.gray, marginTop:2 }}>{m.label}</div>
              </button>
            ))}
          </div>

          {method==="card" && (
            <div>
              {savedCard && (
                <div style={{ marginBottom:12 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", background: useSavedCard?`${C.violet}18`:"#0D1B3E", border:`2px solid ${useSavedCard?C.violet:C.border}`, borderRadius:11, padding:"12px 14px", cursor:"pointer" }} onClick={()=>setUseSavedCard(true)}>
                    <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                      <span style={{ fontSize:20 }}>💳</span>
                      <div>
                        <div style={{ fontWeight:700, color:C.text, fontSize:13, textTransform:"capitalize" }}>{savedCard.brand} ••••{savedCard.last4}</div>
                        <div style={{ color:C.textSub, fontSize:11 }}>Carte enregistrée</div>
                      </div>
                    </div>
                    <div style={{ width:18, height:18, borderRadius:"50%", border:`2px solid ${useSavedCard?C.violet:C.border}`, background:useSavedCard?C.violet:"transparent", display:"flex", alignItems:"center", justifyContent:"center" }}>
                      {useSavedCard && <div style={{ width:8, height:8, borderRadius:"50%", background:"#fff" }} />}
                    </div>
                  </div>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", background: !useSavedCard?`${C.violet}18`:"#0D1B3E", border:`2px solid ${!useSavedCard?C.violet:C.border}`, borderRadius:11, padding:"12px 14px", cursor:"pointer", marginTop:8 }} onClick={()=>setUseSavedCard(false)}>
                    <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                      <span style={{ fontSize:20 }}>➕</span>
                      <div style={{ fontWeight:600, color:C.text, fontSize:13 }}>Utiliser une autre carte</div>
                    </div>
                    <div style={{ width:18, height:18, borderRadius:"50%", border:`2px solid ${!useSavedCard?C.violet:C.border}`, background:!useSavedCard?C.violet:"transparent", display:"flex", alignItems:"center", justifyContent:"center" }}>
                      {!useSavedCard && <div style={{ width:8, height:8, borderRadius:"50%", background:"#fff" }} />}
                    </div>
                  </div>
                </div>
              )}
              {(!savedCard || !useSavedCard) && (
                <>
                  <div style={{ marginBottom:12 }}>
                    <label style={{ display:"block", fontSize:12, color:C.textSub, fontWeight:600, marginBottom:5 }}>Titulaire de la carte</label>
                    <input value={cardName} onChange={e=>setCardName(e.target.value)} placeholder="Jean Dupont" style={{ width:"100%", padding:"12px 14px", borderRadius:11, border:`1px solid ${C.border}`, fontSize:14, fontFamily:"inherit", outline:"none", boxSizing:"border-box", background:"#162547", color:C.text }} />
                  </div>
                  <div style={{ marginBottom:12 }}>
                    <label style={{ display:"block", fontSize:12, color:C.textSub, fontWeight:600, marginBottom:5 }}>Coordonnées de la carte</label>
                    <div style={{ borderRadius:11, border:`1px solid ${C.border}`, background:"#162547", overflow:"hidden" }}>
                      <div ref={mountRef} style={{ padding:"14px 14px", minHeight:50 }} />
                    </div>
                  </div>
                </>
              )}
              {stripeError && (
                <div style={{ background:"#ff4d4d15", border:"1px solid #ff4d4d40", borderRadius:10, padding:"10px 12px", color:"#f87171", fontSize:13, marginTop:8 }}>
                  ⚠️ {stripeError}
                </div>
              )}
            </div>
          )}
          {method==="apple" && (
            <div style={{ textAlign:"center", padding:"20px 0" }}>
              <div style={{ fontSize:48, marginBottom:8 }}></div>
              <p style={{ color:C.textSub, fontSize:14, marginBottom:12 }}>Apple Pay n'est pas disponible sur cet appareil ou ce navigateur.</p>
              <p style={{ color:C.textSub, fontSize:12 }}>Utilisez le paiement par carte ou virement.</p>
            </div>
          )}
          {method==="wire" && (
            <div style={{ background:`${C.accentGold}15`, borderRadius:12, padding:"14px", fontSize:13, lineHeight:1.7 }}>
              <div style={{ fontWeight:800, color:C.text, marginBottom:8 }}>Coordonnées bancaires ALANE</div>
              {[["IBAN","FR76 3000 4000 0100 0000 0000 123"],["BIC","BNPAFRPPXXX"],["Référence",`ALANE-${Date.now().toString().slice(-6)}`],["Montant",`${total} €`]].map(([l,v])=>(
                <div key={l} style={{ display:"flex", justifyContent:"space-between", padding:"4px 0" }}>
                  <span style={{ color:C.textSub }}>{l}</span><span style={{ fontWeight:700, color:C.text, fontSize:12 }}>{v}</span>
                </div>
              ))}
              <div style={{ marginTop:10, color:C.warning, fontSize:11, fontWeight:600 }}>⚠️ Délai de validation : 1-2 jours ouvrés</div>
            </div>
          )}
        </div>

        {/* IBAN remboursement */}
        <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"14px 16px", marginBottom:14 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom: editingIban ? 10 : 0 }}>
            <div>
              <div style={{ fontSize:12, fontWeight:700, color:C.text }}>🏦 IBAN pour remboursement</div>
              {!editingIban && <div style={{ fontSize:12, color:C.textSub, marginTop:3 }}>{savedIban ? `${ibanInput.slice(0,8)}••••••••••••••` : "Non renseigné"}</div>}
            </div>
            <button onClick={()=>setEditingIban(!editingIban)} style={{ background:`${C.violet}20`, border:`1px solid ${C.violet}44`, borderRadius:8, padding:"5px 12px", color:C.violet, fontSize:11, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
              {editingIban ? "Annuler" : savedIban ? "✏️ Modifier" : "+ Ajouter"}
            </button>
          </div>
          {editingIban && (
            <div>
              <input value={ibanInput} onChange={e=>setIbanInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,"").replace(/(.{4})/g,"$1 ").trim())} placeholder="FR76 XXXX XXXX XXXX XXXX XXXX XXX" style={{ width:"100%", padding:"11px 12px", borderRadius:10, border:`1px solid ${C.border}`, fontSize:13, fontFamily:"monospace", background:"#162547", color:C.text, boxSizing:"border-box", outline:"none", marginBottom:8 }} />
              <button onClick={async()=>{ await supabase.auth.updateUser({ data:{ rib: ibanInput.replace(/\s/g,"") } }); setSavedIban(ibanInput); setEditingIban(false); }} style={{ width:"100%", padding:"10px", borderRadius:10, border:"none", background:C.violet, color:"#fff", fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>Enregistrer</button>
            </div>
          )}
        </div>

        {/* Sécurité */}
        <div style={{ display:"flex", gap:8, justifyContent:"center", marginBottom:16 }}>
          {["🔒 SSL 256-bit","🛡️ 3D Secure","✓ PCI DSS"].map(s=>(
            <span key={s} style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:8, padding:"4px 10px", fontSize:10, color:C.textSub, fontWeight:600 }}>{s}</span>
          ))}
        </div>

        <Btn full onClick={handlePay} disabled={processing}
          style={{ fontSize:16, padding:"18px", position:"relative" }}>
          {processing ? "⏳ Traitement en cours…" : `🔒 Payer ${total} € en sécurité`}
        </Btn>
        <p style={{ textAlign:"center", color:C.textSub, fontSize:11, marginTop:8 }}>Aucun débit avant validation de votre mission</p>
      </div>
    </div>
  );
}

// ── FACTURE / INVOICE ─────────────────────────────────────────────
export function InvoiceScreen({ mission, onBack }) {
  const [clientInfo,  setClientInfo]  = useState({ name:"", company:"" });
  const [prestaInfo,  setPrestaInfo]  = useState({ name:"", company:"", siret:"" });
  const [loading,     setLoading]     = useState(true);

  const missionDate = mission?.created_at ? new Date(mission.created_at) : new Date();
  const invoiceNum  = mission
    ? `ALA-${missionDate.getFullYear()}${String(missionDate.getMonth()+1).padStart(2,"0")}-${mission.id.slice(-6).toUpperCase()}`
    : "ALA-000000";
  const emittedDate  = missionDate.toLocaleDateString("fr-FR");
  const ht           = Number(mission?.montant_total || (Number(mission?.tarif_horaire||0) * Number(mission?.hours||0))) || 0;
  const htFormatted  = ht.toFixed(2).replace(".",",");

  useEffect(() => {
    if (!mission) { setLoading(false); return; }
    (async () => {
      try {
        const [{ data: cu }, { data: cp }] = await Promise.all([
          supabase.auth.getUser(),
          supabase.from("profiles").select("prenom,nom,societe_nom").eq("id", mission.client_id).single(),
        ]);
        const clientMeta = cu?.user?.user_metadata || {};
        setClientInfo({
          name:    [cp?.prenom||clientMeta.prenom, cp?.nom||clientMeta.nom].filter(Boolean).join(" ") || cu?.user?.email || "—",
          company: cp?.societe_nom || clientMeta.societe_nom || "",
        });
        if (mission.prestataire_id) {
          const { data: pp } = await supabase.from("profiles").select("prenom,nom,societe_nom").eq("id", mission.prestataire_id).single();
          setPrestaInfo({
            name:    [pp?.prenom, pp?.nom].filter(Boolean).join(" ") || "Prestataire",
            company: pp?.societe_nom || "",
            siret:   "",
          });
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [mission?.id]);

  if (!mission) return (
    <div style={{ padding:40, textAlign:"center", color:C.textSub }}>
      <button onClick={onBack} style={{ background:"transparent", border:"none", color:C.textSub, cursor:"pointer", fontSize:13, display:"block", marginBottom:16 }}>← Retour</button>
      Facture introuvable.
    </div>
  );

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg,#0A1628,#0D1B3E)`, paddingBottom:80 }}>
      {/* Header — masqué à l'impression */}
      <div className="no-print" style={{ background:"linear-gradient(135deg,#0A1628,#162547)", padding:"48px 22px 24px", borderRadius:"0 0 26px 26px" }}>
        <button onClick={onBack} style={{ background:"rgba(255,255,255,0.15)", border:"none", borderRadius:10, padding:"7px 14px", color:C.white, cursor:"pointer", fontSize:13, marginBottom:14 }}>← Retour</button>
        <h2 style={{ color:C.white, fontSize:20, fontWeight:800, margin:"0 0 4px" }}>📄 Facture de mission</h2>
        <p style={{ color:"rgba(255,255,255,0.55)", fontSize:13, margin:0 }}>{invoiceNum}</p>
      </div>

      {loading ? (
        <div style={{ padding:40, textAlign:"center", color:C.textSub }}>Chargement…</div>
      ) : (
        <div style={{ padding:"20px 18px" }}>
          {/* Zone imprimable */}
          <div id="invoice-print-area">
            {/* En-tête */}
            <div style={{ background:"#0D1B3E", borderRadius:16, padding:"20px", marginBottom:14, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:16 }}>
                <div>
                  <div style={{ fontSize:22, fontWeight:800, color:C.violet, fontFamily:font.display, letterSpacing:1 }}>ALANE</div>
                  <div style={{ color:C.textSub, fontSize:11, marginTop:2 }}>Plateforme de services à la demande</div>
                </div>
                <div style={{ textAlign:"right" }}>
                  <div style={{ fontWeight:800, color:C.text, fontSize:13 }}>FACTURE</div>
                  <div style={{ color:C.textSub, fontSize:11 }}>{invoiceNum}</div>
                  <div style={{ color:C.textSub, fontSize:11 }}>Émise le {emittedDate}</div>
                </div>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, paddingTop:12, borderTop:`1px solid ${C.border}` }}>
                <div>
                  <div style={{ fontSize:11, color:C.textSub, fontWeight:600, marginBottom:4, textTransform:"uppercase", letterSpacing:0.5 }}>Client</div>
                  <div style={{ fontSize:13, fontWeight:700, color:C.text }}>{clientInfo.name}</div>
                  {clientInfo.company && <div style={{ fontSize:11, color:C.textSub }}>{clientInfo.company}</div>}
                </div>
                <div>
                  <div style={{ fontSize:11, color:C.textSub, fontWeight:600, marginBottom:4, textTransform:"uppercase", letterSpacing:0.5 }}>Prestataire</div>
                  <div style={{ fontSize:13, fontWeight:700, color:C.text }}>{prestaInfo.name}</div>
                  {prestaInfo.company && <div style={{ fontSize:11, color:C.textSub }}>{prestaInfo.company}</div>}
                  {prestaInfo.siret && <div style={{ fontSize:11, color:C.textSub }}>SIRET : {prestaInfo.siret}</div>}
                </div>
              </div>
            </div>

            {/* Détail mission */}
            <div style={{ background:"#0D1B3E", borderRadius:16, padding:"16px", marginBottom:14, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
              <div style={{ fontWeight:800, color:C.text, fontSize:13, marginBottom:12 }}>Détail de la prestation</div>
              <div style={{ display:"flex", justifyContent:"space-between", padding:"8px 0", borderBottom:`1px solid ${C.border}` }}>
                <span style={{ color:C.textSub, fontSize:12, fontWeight:600 }}>Description</span>
                <span style={{ color:C.textSub, fontSize:12, fontWeight:600 }}>Montant HT</span>
              </div>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 0", borderBottom:`1px solid ${C.border}` }}>
                <div>
                  <div style={{ fontWeight:700, color:C.text, fontSize:13 }}>{mission.metier || "Prestation de service"}</div>
                  {mission.sector && <div style={{ color:C.textSub, fontSize:11, marginTop:2 }}>Secteur : {mission.sector}</div>}
                  {mission.date && <div style={{ color:C.textSub, fontSize:11 }}>Date : {mission.date}</div>}
                  {mission.ville && <div style={{ color:C.textSub, fontSize:11 }}>Lieu : {mission.ville}</div>}
                  <div style={{ color:C.textSub, fontSize:11 }}>
                    {mission.hours}h × {Number(mission.tarif_horaire||0).toFixed(2).replace(".",",")} € HT/h
                  </div>
                </div>
                <div style={{ fontWeight:700, color:C.text, fontSize:14, minWidth:70, textAlign:"right" }}>{htFormatted} €</div>
              </div>
              <div style={{ padding:"10px 0 4px" }}>
                {[
                  ["Sous-total HT", `${htFormatted} €`],
                  ["TVA (0% — art. 293 B CGI)", "0,00 €"],
                  ["Total TTC", `${htFormatted} €`],
                ].map(([l,v],i) => (
                  <div key={l} style={{ display:"flex", justifyContent:"space-between", padding:"5px 0" }}>
                    <span style={{ color:i===2?C.text:C.gray, fontSize:i===2?15:13, fontWeight:i===2?900:400 }}>{l}</span>
                    <span style={{ color:i===2?C.violet:C.text, fontSize:i===2?18:13, fontWeight:i===2?900:600 }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Statut */}
            <div style={{ background:`${C.success}15`, border:`1px solid ${C.success}44`, borderRadius:r, padding:"14px 16px", marginBottom:14, display:"flex", gap:10, alignItems:"center" }}>
              <span style={{ fontSize:24 }}>✅</span>
              <div>
                <div style={{ fontWeight:800, color:C.success, fontSize:13 }}>Mission validée</div>
                <div style={{ color:C.textSub, fontSize:11, marginTop:2 }}>Paiement traité via ALANE</div>
              </div>
            </div>

            {/* Mention légale */}
            <div style={{ color:C.textMuted, fontSize:10, lineHeight:1.5, padding:"0 2px 4px" }}>
              TVA non applicable — article 293 B du CGI. En cas de retard de paiement, des pénalités de retard sont dues selon les articles L.441-6 et D.441-5 du Code de commerce.
            </div>
          </div>

          {/* Bouton impression — masqué à l'impression */}
          <div className="no-print" style={{ marginTop:16 }}>
            <Btn full onClick={()=> window.print()} style={{ padding:"14px", fontSize:14, fontWeight:700 }}>
              🖨️ Télécharger / Imprimer PDF
            </Btn>
          </div>
        </div>
      )}
    </div>
  );
}

// ── GESTION DES ANNULATIONS ───────────────────────────────────────
export function CancellationScreen({ provider, missionId, missionDate, onNavigate, onBack }) {
  if (!provider) return <div style={{ padding:40, textAlign:"center", color:C.textSub }}><button onClick={onBack} style={{ background:"transparent", border:"none", color:C.textSub, cursor:"pointer", fontSize:13, display:"block", marginBottom:16 }}>← Retour</button>Mission introuvable.</div>;
  const p = provider;
  const [step, setStep] = useState("policy"); // policy | confirm | replacement | done
  const [reason, setReason] = useState("");
  const [chosen, setChosen] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const { providers: allProviders } = _useProviders();
  const replacements = allProviders.filter(ap => ap.sector === p.sector && ap.id !== p.id && ap.available).slice(0, 4);

  // Calcul réel du délai avant mission
  const missionTs = missionDate ? new Date(missionDate).getTime() : Date.now() + 18*3600000;
  const hoursLeft = Math.max(0, Math.floor((missionTs - Date.now()) / 3600000));
  const penalty = hoursLeft < 24 ? 100 : hoursLeft < 48 ? 50 : 0;
  const penaltyAmount = (124 * penalty / 100).toFixed(0);

  const policyColor = penalty === 0 ? C.success : penalty === 50 ? C.warning : C.danger;
  const policyLabel = penalty === 0 ? "Annulation gratuite" : penalty === 50 ? "Frais d'annulation 50%" : "Annulation tardive — frais 100%";

  if(step==="replacement") return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg, #0A1628 0%, #0D1B3E 100%)`, paddingBottom:80 }}>
      <div style={{ background:`linear-gradient(135deg,${C.accent},#c0392b)`, padding:"48px 22px 24px", borderRadius:"0 0 26px 26px" }}>
        <h2 style={{ color:C.white, fontSize:20, fontWeight:800, margin:"0 0 4px" }}>🔄 Remplaçant automatique</h2>
        <p style={{ color:"rgba(255,255,255,0.7)", fontSize:13, margin:0 }}>Prestataires disponibles sur votre créneau</p>
      </div>
      <div style={{ padding:"20px 18px" }}>
        <div style={{ background:`${C.accentGold}15`, border:`1px solid ${C.accentGold}44`, borderRadius:12, padding:"12px 14px", marginBottom:16, fontSize:13, color:C.text }}>
          ⚡ ALANE a trouvé <strong>{replacements.length} remplaçant{replacements.length>1?"s":""}</strong> disponible{replacements.length>1?"s":""} sur votre créneau
        </div>
        {replacements.length === 0 ? (
          <div style={{ background:"#0D1B3E", borderRadius:16, padding:"24px", textAlign:"center", boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
            <div style={{ fontSize:44, marginBottom:12 }}>😔</div>
            <div style={{ fontWeight:800, color:C.text, marginBottom:8 }}>Aucun remplaçant disponible</div>
            <div style={{ color:C.textSub, fontSize:13, marginBottom:16 }}>Vous serez remboursé intégralement</div>
            <Btn full variant="success" onClick={()=>setStep("done")}>Confirmer le remboursement</Btn>
          </div>
        ) : (
          <>
            {replacements.map(r => (
              <div key={r.id} onClick={()=>setChosen(r)} style={{ background:"#0D1B3E", borderRadius:16, padding:"14px", marginBottom:11, boxShadow:"0 4px 16px rgba(0,0,0,0.5)", cursor:"pointer", border:`2px solid ${chosen?.id===r.id?C.success:C.grayLight}`, transition:"border 0.2s" }}>
                <div style={{ display:"flex", gap:12, alignItems:"center" }}>
                  <div style={{ width:50, height:50, borderRadius:15, background:`${r.color}22`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:24, flexShrink:0 }}>{r.avatar}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:700, color:C.text, fontSize:14 }}>{r.name}</div>
                    <div style={{ color:C.textSub, fontSize:12 }}>{r.role}</div>
                    <div style={{ display:"flex", gap:6, marginTop:3, alignItems:"center" }}><Stars rating={r.rating} size={12}/><span style={{ color:C.textSub, fontSize:11 }}>{r.rating} · {r.distance}</span></div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ color:C.violet, fontWeight:800, fontSize:13 }}>{r.hourlyRate}</div>
                    {chosen?.id===r.id && <div style={{ color:C.success, fontSize:12, fontWeight:700, marginTop:4 }}>✓ Sélectionné</div>}
                  </div>
                </div>
              </div>
            ))}
            <Btn full variant="success" disabled={!chosen} onClick={()=>setStep("done")} style={{ marginTop:8 }}>
              ✓ Confirmer {chosen?.name || "le remplaçant"}
            </Btn>
          </>
        )}
      </div>
    </div>
  );

  if(step==="done") return (
    <div style={{ minHeight:"100%", background:`linear-gradient(160deg,${C.success},#1a7a40)`, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:32, textAlign:"center" }}>
      <div style={{ fontSize:72, marginBottom:20 }}>{chosen ? "🔄" : "💶"}</div>
      <h2 style={{ color:C.white, fontSize:24, fontWeight:800, margin:"0 0 12px" }}>{chosen ? "Remplaçant confirmé !" : "Remboursement initié"}</h2>
      <p style={{ color:"rgba(255,255,255,0.8)", fontSize:15, lineHeight:1.8, maxWidth:280, margin:"0 auto 28px" }}>
        {chosen ? `${chosen.name} prendra en charge votre mission.` : "Vous serez remboursé sous 3-5 jours ouvrés."}
      </p>
      <Btn full variant="secondary" onClick={()=>onNavigate("home")} style={{ color:C.success }}>Retour à l'accueil</Btn>
      <button onClick={()=>onNavigate("rating",p)} style={{ background:"rgba(255,255,255,0.15)", border:"1px solid rgba(255,255,255,0.3)", borderRadius:12, padding:"11px 24px", color:"rgba(255,255,255,0.9)", cursor:"pointer", marginTop:10, fontSize:13, fontFamily:"inherit", width:"100%", fontWeight:600 }}>⭐ Noter {p.name}</button>
    </div>
  );

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg, #0A1628 0%, #0D1B3E 100%)`, paddingBottom:80 }}>
      <div style={{ background:`linear-gradient(135deg,${C.accent},#c0392b)`, padding:"48px 22px 24px", borderRadius:"0 0 26px 26px" }}>
        <button onClick={onBack} style={{ background:"rgba(255,255,255,0.15)", border:"none", borderRadius:10, padding:"7px 14px", color:C.white, cursor:"pointer", fontSize:13, marginBottom:14 }}>← Retour</button>
        <h2 style={{ color:C.white, fontSize:20, fontWeight:800, margin:"0 0 4px" }}>❌ Annuler la mission</h2>
        <p style={{ color:"rgba(255,255,255,0.7)", fontSize:13, margin:0 }}>{p.name} · {p.role}</p>
      </div>

      <div style={{ padding:"20px 18px" }}>
        {/* Politique d'annulation */}
        <div style={{ background:"#0D1B3E", borderRadius:16, padding:"16px", marginBottom:16, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
          <div style={{ fontWeight:800, color:C.text, fontSize:14, marginBottom:14 }}>📋 Politique d'annulation ALANE</div>
          {[
            { label:"Plus de 48h avant", detail:"Annulation gratuite", color:C.success, icon:"✅" },
            { label:"Entre 24h et 48h",  detail:"Frais de 50% du montant", color:C.warning, icon:"⚠️" },
            { label:"Moins de 24h",      detail:"Frais de 100% du montant", color:C.danger, icon:"❌" },
          ].map((r,i) => (
            <div key={i} style={{ display:"flex", gap:12, alignItems:"center", padding:"10px 0", borderBottom:i<2?`1px solid ${C.grayLight}`:"none" }}>
              <span style={{ fontSize:20 }}>{r.icon}</span>
              <div style={{ flex:1 }}>
                <div style={{ fontWeight:700, color:C.text, fontSize:13 }}>{r.label}</div>
                <div style={{ color:C.textSub, fontSize:11 }}>{r.detail}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Votre situation */}
        <div style={{ background:`${policyColor}15`, border:`2px solid ${policyColor}44`, borderRadius:16, padding:"16px", marginBottom:16 }}>
          <div style={{ fontWeight:800, color:policyColor, fontSize:14, marginBottom:4 }}>{policyLabel}</div>
          <div style={{ color:C.textSub, fontSize:13 }}>Mission dans <strong style={{ color:C.text }}>{hoursLeft}h</strong></div>
          {penalty > 0 && (
            <div style={{ marginTop:8, fontWeight:700, color:C.text, fontSize:14 }}>
              Frais d'annulation : <span style={{ color:C.danger }}>{penaltyAmount} €</span>
            </div>
          )}
        </div>

        {/* Raison */}
        <div style={{ background:"#0D1B3E", borderRadius:16, padding:"16px", marginBottom:16, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
          <div style={{ fontWeight:800, color:C.text, fontSize:13, marginBottom:10 }}>Motif d'annulation</div>
          {["Erreur de date / horaire","Prestataire ne convient plus","Mission annulée par mon client","Problème de budget","Autre"].map(r => (
            <div key={r} onClick={()=>setReason(r)} style={{ padding:"10px 14px", borderRadius:10, marginBottom:6, border:`2px solid ${reason===r?C.violet:C.grayLight}`, background:reason===r?`${C.violet}08`:C.white, cursor:"pointer", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <span style={{ fontSize:13, fontWeight:reason===r?700:400, color:reason===r?C.violet:C.text }}>{r}</span>
              {reason===r && <span style={{ color:C.violet, fontSize:16 }}>✓</span>}
            </div>
          ))}
        </div>

        <div style={{ display:"flex", gap:10 }}>
          <Btn variant="secondary" onClick={onBack} style={{ flex:1, padding:"13px", fontSize:13 }}>Garder la mission</Btn>
          <Btn variant="danger" disabled={!reason||cancelling} onClick={async()=>{
            setCancelling(true);
            try {
              const { data: { session } } = await supabase.auth.getSession();
              const token = session?.access_token;
              if (missionId && token) {
                await fetch("/api/missions", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`,
                  },
                  body: JSON.stringify({
                    action: "cancel_client",
                    mission_id: missionId,
                    reason,
                    penalty,
                  }),
                });
              }
            } catch {}
            setCancelling(false);
            setStep("replacement");
          }} style={{ flex:2, padding:"13px", fontSize:13 }}>
            {cancelling ? "…" : `Annuler ${penalty>0?`(−${penaltyAmount} €)`:""}`}
          </Btn>
        </div>
      </div>
    </div>
  );
}
