/* eslint-disable react-refresh/only-export-components */
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
  const p = provider || {};
  const { providers: allProviders } = _useProviders();
  const [secsLeft, setSecsLeft]     = useState(3600);
  const [totalSecs, setTotalSecs]   = useState(3600);
  const [phase, setPhase]           = useState("waiting");
  const [loaded, setLoaded]         = useState(!missionId);

  // Charger le délai réel depuis Supabase
  useEffect(() => {
    if (!missionId) { setLoaded(true); return; }
    let mounted = true;
    supabase.from("missions").select("status,acceptance_deadline").eq("id", missionId).single()
      .then(({ data }) => {
        if (!mounted || !data) return;
        if (data.status === "assigned") { setPhase("accepted"); return; }
        if (data.status === "refused")  { setPhase("refused");  return; }
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
      const { data: sd } = await supabase.auth.getSession();
      if (!mounted || !sd?.session) return;
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
      // Le passage en "refused" et la notification sont faits par le serveur
      // (S-06) : il revérifie que le délai d'acceptation est réellement écoulé,
      // ce que le front ne peut pas prouver.
      (async () => {
        const { data:sd } = await supabase.auth.getSession();
        const token = sd?.session?.access_token;
        if (!token) return;
        try {
          const r = await fetch("/api/missions", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
            body: JSON.stringify({ action: "acceptance_timeout", mission_id: missionId }),
          });
          if (!r.ok) {
            const err = await r.json().catch(()=>({}));
            console.error("[timeout] refus automatique refusé :", r.status, err?.error || "");
          }
        } catch (err) {
          console.error("[timeout] refus automatique injoignable :", err.message);
        }
      })();
    }
  }, [loaded, secsLeft, phase, missionId]);

  if (!provider) return <div style={{ padding:40, textAlign:"center", color:C.textSub }}><button onClick={onBack} style={{ background:"transparent", border:"none", color:C.textSub, cursor:"pointer", fontSize:13, display:"block", marginBottom:16 }}>← Retour</button>Prestataire introuvable.</div>;

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
              <span style={{ color:C.textSub, fontSize:12 }}>· {p.missions} prestations</span>
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
              <div style={{ color:C.textSub, fontSize:12, marginTop:2 }}>Il dispose d'une heure pour accepter ou refuser la prestation</div>
            </div>
          </div>
        </div>

        {/* Info paiement sécurisé */}
        <div style={{ width:"100%", background:"rgba(255,255,255,0.03)", border:"1px solid "+C.border, borderRadius:r, padding:"12px 14px", marginBottom:14, fontSize:12, color:C.textSub, lineHeight:1.6 }}>
          🔒 <strong style={{ color:C.text }}>Votre paiement est sécurisé</strong> — Les fonds sont bloqués via Stripe et ne seront libérés qu'à l'acceptation. En cas de refus ou d'expiration, vous êtes intégralement remboursé(e).
        </div>

        {/* Info si pas de réponse */}
        <div style={{ width:"100%", background:`${C.accentGold}08`, border:`1px solid ${C.accentGold}30`, borderRadius:r, padding:"13px 15px", marginBottom:24, fontSize:12, color:C.textSub, lineHeight:1.7 }}>
          <div style={{ fontWeight:700, color:C.accentGold, fontSize:12, marginBottom:6 }}>📧 Si {p.name} ne répond pas dans le délai imparti…</div>
          Vous recevrez un email vous proposant de :
          <ul style={{ margin:"6px 0 0", paddingLeft:18, display:"flex", flexDirection:"column", gap:3 }}>
            <li><strong style={{ color:C.text }}>Choisir un autre prestataire</strong> disponible pour le même métier</li>
            <li><strong style={{ color:C.text }}>Diffuser la prestation</strong> à l'ensemble des prestataires {p.jobTitle||p.role ? `(${p.jobTitle||p.role})` : "du même métier"} — le premier à accepter prend la prestation</li>
          </ul>
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
        <h2 style={{ color:C.success, fontSize:24, fontWeight:800, margin:"0 0 12px", fontFamily:font.display }}>Prestation acceptée !</h2>
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
        <h2 style={{ color:C.accent, fontSize:24, fontWeight:800, margin:"0 0 12px", fontFamily:font.display }}>Prestation refusée</h2>
        <p style={{ color:C.textSub, fontSize:14, lineHeight:1.7, marginBottom:8 }}>
          <strong style={{ color:C.text }}>{p.name}</strong> a décliné la prestation. Votre paiement est intégralement remboursé.
        </p>
        <div style={{ background:C.accentGold+"10", border:"1px solid "+C.accentGold+"30", borderRadius:r, padding:"13px 15px", marginBottom:24, fontSize:13, color:C.textSub, lineHeight:1.6 }}>
          💡 Pas de panique — il y a <strong style={{ color:C.text }}>d'autres prestataires disponibles</strong> dans ce secteur. Choisissez-en un autre pour votre prestation.
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
          <strong style={{ color:C.text }}>{p.name}</strong> n'a pas répondu dans le délai d'une heure. La prestation est automatiquement annulée.
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
// ── Droit de rétractation (L.221-18 et s. du Code de la consommation) ──
//
// Le client commande à distance : il dispose en principe de quatorze jours pour
// se rétracter. Une exception existe pour certains services fournis à une date
// déterminée (L.221-28, 12°), mais son énumération est limitative et le conseil
// juridique demande de NE PAS la présumer applicable aux prestations d'ALANE.
//
// Ne rien dire ne supprime pas le droit : cela le PROLONGE jusqu'à douze mois
// (L.221-20). Un client pourrait alors réclamer le remboursement intégral d'une
// prestation commandée onze mois plus tôt, et exécutée.
//
// On informe donc, et on recueille la demande expresse d'exécution avant la fin
// du délai ainsi que la reconnaissance de la perte du droit après exécution
// complète (L.221-25). La case est obligatoire : sans elle, rien n'est purgé.
//
// Défini au niveau du module, et non dans le composant : une fonction de rendu
// recréée à chaque passage produit un nouveau type de composant, et React
// démonte alors la case à chaque frappe — elle se décochait toute seule.
function BlocRetractation({ coche, onChange }) {
  return (
    <label style={{
      display:"flex", gap:10, alignItems:"flex-start", cursor:"pointer",
      background:"rgba(255,255,255,0.04)", border:`1px solid ${coche ? `${C.violet}66` : C.border}`,
      borderRadius:12, padding:"12px 14px", marginTop:14, marginBottom:4,
    }}>
      <input
        type="checkbox"
        checked={coche}
        onChange={e => onChange(e.target.checked)}
        style={{ marginTop:2, width:18, height:18, flexShrink:0, accentColor:C.violet, cursor:"pointer" }}
      />
      <span style={{ fontSize:11, color:C.textSub, lineHeight:1.55 }}>
        Vous disposez d'un <strong style={{ color:C.text }}>droit de rétractation de 14 jours</strong> à compter
        de la conclusion du contrat. En cochant cette case, vous <strong style={{ color:C.text }}>demandez
        expressément</strong> que la prestation commence avant la fin de ce délai, et vous reconnaissez
        <strong style={{ color:C.text }}> perdre ce droit</strong> une fois la prestation pleinement exécutée.
        Si vous vous rétractez, le prix de la prestation vous est remboursé — la part déjà réalisée
        restant due si elle a commencé. Les frais de service, qui rémunèrent la mise en relation
        déjà effectuée, restent acquis.
      </span>
    </label>
  );
}

export function StripePaymentScreen({ amount, provider, description, missionId, teamMode, teamProviders, onSuccess, onBack }) {
  const [cardName, setCardName] = useState("");
  const [cardNameError, setCardNameError] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [done, setDone] = useState(false);
  const [stripeError, setStripeError] = useState(null);
  const stripeRef   = useRef(null);
  const cardElRef   = useRef(null);
  const mountRef    = useRef(null);

  const [savedCard, setSavedCard]     = useState(null); // { pmId, customerId, brand, last4 }
  const [useSavedCard, setUseSavedCard] = useState(true);
  const [applePayAvailable, setApplePayAvailable] = useState(false);
  const [prepaidBalance, setPrepaidBalance] = useState(0);
  const [useWallet, setUseWallet]           = useState(false);
  const [walletProcessing, setWalletProcessing] = useState(false);
  // Renonciation au droit de rétractation — voir BlocRetractation, plus bas.
  const [retractationOk, setRetractationOk] = useState(false);
  const applePayBtnRef    = useRef(null);
  const paymentRequestRef = useRef(null);
  const applePayStripeRef = useRef(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const m = data?.user?.user_metadata || {};
      if (m.stripe_pm_id) {
        setSavedCard({ pmId: m.stripe_pm_id, customerId: m.stripe_customer_id, brand: m.card_brand||"card", last4: m.card_last4||"••••" });
      }
    });
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: sd }) => {
      const token = sd?.session?.access_token;
      if (!token) return;
      fetch("/api/wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ action: "get_balance" }),
      }).then(r => r.json()).then(({ balance }) => {
        if (balance > 0) setPrepaidBalance(balance);
      }).catch(() => {});
    });
  }, []);

  // ── Sauvegarde du brouillon à l'entrée dans le tunnel de paiement ──────────
  useEffect(() => {
    const draft = {
      prestataireName: (provider || (teamProviders||[])[0])?.name || null,
      // Identifiant nécessaire pour reconstituer la fiche du prestataire à la
      // reprise : la prestation est créée sans prestataire_id tant que le
      // paiement n'a pas abouti, le lien serait donc perdu au rechargement.
      prestataireId: (provider || (teamProviders||[])[0])?.id || null,
      metier: description || null,
      montant: typeof amount === "object" ? (amount?.amount ?? null) : (amount ?? null),
      missionId: missionId || null,
      timestamp: Date.now(),
    };
    // A — localStorage (reprise in-app immédiate)
    try { localStorage.setItem("alane_booking_draft", JSON.stringify(draft)); } catch { /* ignore */ }
    // B+C — Supabase (push + email via cron après 30 min)
    supabase.auth.getSession().then(({ data: sd }) => {
      const token = sd?.session?.access_token;
      if (!token) return;
      fetch("/api/booking-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({
          action: "save",
          prestataire_name: draft.prestataireName,
          metier: draft.metier,
          montant: draft.montant,
          mission_id: draft.missionId,
        }),
      }).catch(() => {});
    });
    // Nettoyage si l'utilisateur quitte sans payer
    return () => {};
  }, []);

  useEffect(() => {
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
  }, [useSavedCard]);

  // ── Apple Pay / Google Pay ──────────────────────────────────────────
  const total = (typeof amount === 'object' ? (amount?.amount ?? 124) : (amount ?? 124));

  useEffect(() => {
    const amountCents = Math.round(total * 100);
    (async () => {
      const { loadStripe } = await import("@stripe/stripe-js");
      const pk = import.meta.env.VITE_STRIPE_PUBLIC_KEY;
      if (!pk) return;
      const stripe = await loadStripe(pk);
      if (!stripe) return;
      applePayStripeRef.current = stripe;
      const pr = stripe.paymentRequest({
        country: "FR", currency: "eur",
        total: { label: "ALANE", amount: amountCents },
        requestPayerName: false, requestPayerEmail: false,
      });
      const result = await pr.canMakePayment();
      if (!result) return;
      paymentRequestRef.current = pr;
      pr.on("paymentmethod", async (ev) => {
        setProcessing(true);
        try {
          const { data: { session: apSess } } = await supabase.auth.getSession();
          const apToken = apSess?.access_token;
          if (!missionId) { ev.complete("fail"); setStripeError("Identifiant de prestation manquant. Veuillez fermer et rouvrir le paiement."); setProcessing(false); return; }
          const r = await fetch("/api/stripe-intent", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(apToken ? { "Authorization": `Bearer ${apToken}` } : {}) },
            body: JSON.stringify({ amount: total, currency: "eur", mission_id: missionId, metadata: { prestataire: (provider || (teamProviders||[])[0])?.id || "" } }),
          });
          const { clientSecret, error: intentErr } = await r.json();
          if (intentErr || !clientSecret) { ev.complete("fail"); setStripeError(intentErr || "Erreur création paiement"); setProcessing(false); return; }
          const { error, paymentIntent } = await stripe.confirmCardPayment(clientSecret, { payment_method: ev.paymentMethod.id }, { handleActions: false });
          if (error) { ev.complete("fail"); setStripeError(error.message); setProcessing(false); return; }
          ev.complete("success");
          if (paymentIntent.status === "requires_action") {
            const { error: e2 } = await stripe.confirmCardPayment(clientSecret);
            if (e2) { setStripeError(e2.message); setProcessing(false); return; }
          }
          clearDraft();
          setDone(true); setProcessing(false);
          onSuccess && onSuccess(paymentIntent.id);
        } catch (e) { ev.complete("fail"); setStripeError(e.message || "Erreur paiement"); setProcessing(false); }
      });
      setApplePayAvailable(true);
    })();
  }, []);

  useEffect(() => {
    if (!applePayAvailable || !applePayBtnRef.current || !paymentRequestRef.current || !applePayStripeRef.current) return;
    const btn = applePayStripeRef.current.elements().create("paymentRequestButton", {
      paymentRequest: paymentRequestRef.current,
      style: { paymentRequestButton: { type: "buy", theme: "dark", height: "52px" } },
    });
    btn.mount(applePayBtnRef.current);
    return () => btn.destroy();
  }, [applePayAvailable]);

  const clearDraft = () => {
    try { localStorage.removeItem("alane_booking_draft"); } catch { /* ignore */ }
    supabase.auth.getSession().then(({ data: sd }) => {
      const token = sd?.session?.access_token;
      if (!token) return;
      fetch("/api/booking-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ action: "clear" }),
      }).catch(() => {});
    });
  };

  const providers = teamMode ? (teamProviders||[]) : (provider ? [provider] : []);
  if (!providers.length) return <div style={{ padding:40, textAlign:"center", color:C.textSub }}><button onClick={onBack} style={{ background:"transparent", border:"none", color:C.textSub, cursor:"pointer", fontSize:13, display:"block", marginBottom:16 }}>← Retour</button>Prestataire introuvable.</div>;

  const handlePayFromWallet = async () => {
    if (walletProcessing) return;
    if (!missionId) { setStripeError("Identifiant de prestation manquant. Veuillez fermer et rouvrir le paiement."); return; }
    setWalletProcessing(true);
    setStripeError(null);
    try {
      const { data: { session: wSess } } = await supabase.auth.getSession();
      const r = await fetch("/api/wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${wSess?.access_token}` },
        body: JSON.stringify({ action: "pay_mission", mission_id: missionId }),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error || "Erreur paiement wallet");
      clearDraft();
      setDone(true);
      onSuccess && onSuccess(`wallet_${missionId}`);
    } catch (e) {
      setStripeError(e.message || "Erreur paiement wallet");
      setWalletProcessing(false);
    }
  };

  const handlePay = async () => {
    if (processing) return;
    setStripeError(null);
    const useStored = savedCard && useSavedCard;
    if (!useStored && !cardName.trim()) {
      setCardNameError(true);
      return;
    }
    if (!stripeRef.current) {
      const { loadStripe } = await import("@stripe/stripe-js");
      const pk = import.meta.env.VITE_STRIPE_PUBLIC_KEY;
      stripeRef.current = pk ? await loadStripe(pk) : null;
    }
    if (!stripeRef.current) { setStripeError("Stripe non initialisé, rechargez la page."); return; }
    if (!useStored && !cardElRef.current) { setStripeError("Stripe non initialisé, rechargez la page."); return; }
    setProcessing(true);
    try {
      const { data: { session: piSession } } = await supabase.auth.getSession();
      if (!missionId) throw new Error("Identifiant de prestation manquant. Veuillez fermer et rouvrir le paiement.");
      const r = await fetch("/api/stripe-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(piSession?.access_token ? { "Authorization": `Bearer ${piSession.access_token}` } : {}) },
        body: JSON.stringify({ amount: total, currency: "eur", customerId: savedCard?.customerId||null, mission_id: missionId, metadata: { prestataire: providers[0]?.id || "", description: description || "" } }),
      });
      const { clientSecret, error: intentErr } = await r.json();
      if (intentErr || !clientSecret) throw new Error(intentErr || "Erreur création paiement");
      const confirmOpts = useStored
        ? { payment_method: savedCard.pmId }
        : { payment_method: { card: cardElRef.current, billing_details: cardName ? { name: cardName } : undefined } };
      const { error, paymentIntent } = await stripeRef.current.confirmCardPayment(clientSecret, confirmOpts);
      if (error) { setStripeError(error.message); setProcessing(false); return; }
      if (paymentIntent?.status === "succeeded") {
        clearDraft(); setDone(true); setProcessing(false); onSuccess && onSuccess(paymentIntent.id);
      }
    } catch (e) { setStripeError(e.message || "Erreur paiement"); setProcessing(false); }
  };

  if(done) return (
    <div style={{ minHeight:"100%", background:`linear-gradient(160deg,${C.success},#1a7a40)`, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:32, textAlign:"center" }}>
      <div style={{ width:90, height:90, borderRadius:"50%", background:"rgba(255,255,255,0.2)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:44, marginBottom:20 }}>✓</div>
      <h2 style={{ color:C.white, fontSize:26, fontWeight:800, margin:"0 0 10px", fontFamily:font.display }}>Paiement sécurisé !</h2>
      <p style={{ color:"rgba(255,255,255,0.8)", fontSize:15, lineHeight:1.8, maxWidth:280, margin:"0 auto 12px" }}>
        <strong>{total} €</strong> sécurisés via Stripe.<br/>Libérés après validation de la prestation.
      </p>
      <div style={{ background:"rgba(255,255,255,0.12)", borderRadius:10, padding:"10px 18px", marginBottom:24, fontSize:13, color:"rgba(255,255,255,0.85)" }}>
        ⏳ Prestation en cours d'activation — vous serez notifié(e) dès la confirmation.
      </div>
      <div style={{ background:"rgba(255,255,255,0.15)", borderRadius:16, padding:"16px 20px", width:"100%", maxWidth:300, marginBottom:24, textAlign:"left" }}>
        {[
          "🔒 Argent sécurisé jusqu'à validation",
          "📧 Confirmation envoyée par email",
          teamMode ? `👥 ${providers.length} prestataires notifiés` : `👤 ${providers[0]?.name} notifié(e)`,
          "📄 Contrat de prestation généré",
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

        {/* Apple Pay / Google Pay */}
        {applePayAvailable && (
          <div style={{ marginBottom:16 }}>
            <div ref={applePayBtnRef} style={{ borderRadius:12, overflow:"hidden" }} />
            <div style={{ display:"flex", alignItems:"center", gap:10, marginTop:14 }}>
              <div style={{ flex:1, height:1, background:C.border }} />
              <span style={{ color:C.textSub, fontSize:11, fontWeight:600 }}>ou payer par carte</span>
              <div style={{ flex:1, height:1, background:C.border }} />
            </div>
          </div>
        )}

        {/* ── Wallet ALANE ── */}
        {prepaidBalance >= total && (
          <div style={{ background:"#0D1B3E", borderRadius:16, padding:"16px", marginBottom:16, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
              <div style={{ fontWeight:800, color:C.text, fontSize:14 }}>💰 Wallet ALANE</div>
              <span style={{ background:"rgba(16,217,143,0.15)", color:"#10D98F", fontSize:10, fontWeight:700, padding:"3px 8px", borderRadius:99, border:"1px solid rgba(16,217,143,0.3)" }}>
                {prepaidBalance.toFixed(2).replace(".", ",")} € disponibles
              </span>
            </div>
            <div
              onClick={()=>setUseWallet(true)}
              style={{ display:"flex", justifyContent:"space-between", alignItems:"center", background: useWallet?`${C.violet}18`:"transparent", border:`2px solid ${useWallet?C.violet:C.border}`, borderRadius:11, padding:"12px 14px", cursor:"pointer", marginBottom:8 }}
            >
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <span style={{ fontSize:20 }}>💰</span>
                <div>
                  <div style={{ fontWeight:700, color:C.text, fontSize:13 }}>Payer depuis mon wallet</div>
                  <div style={{ color:"#10D98F", fontSize:11, fontWeight:600 }}>✅ 0 frais Stripe fixes sur cette prestation</div>
                </div>
              </div>
              <div style={{ width:18, height:18, borderRadius:"50%", border:`2px solid ${useWallet?C.violet:C.border}`, background:useWallet?C.violet:"transparent", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                {useWallet && <div style={{ width:8, height:8, borderRadius:"50%", background:"#fff" }} />}
              </div>
            </div>
            <div
              onClick={()=>setUseWallet(false)}
              style={{ display:"flex", justifyContent:"space-between", alignItems:"center", background: !useWallet?`${C.violet}18`:"transparent", border:`2px solid ${!useWallet?C.violet:C.border}`, borderRadius:11, padding:"12px 14px", cursor:"pointer" }}
            >
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <span style={{ fontSize:20 }}>💳</span>
                <div style={{ fontWeight:600, color:C.text, fontSize:13 }}>Payer par carte bancaire</div>
              </div>
              <div style={{ width:18, height:18, borderRadius:"50%", border:`2px solid ${!useWallet?C.violet:C.border}`, background:!useWallet?C.violet:"transparent", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                {!useWallet && <div style={{ width:8, height:8, borderRadius:"50%", background:"#fff" }} />}
              </div>
            </div>
            {useWallet && (
              <>
                {stripeError && (
                  <div style={{ background:"#ff4d4d15", border:"1px solid #ff4d4d40", borderRadius:10, padding:"10px 12px", color:"#f87171", fontSize:13, marginTop:12 }}>
                    ⚠️ {stripeError}
                  </div>
                )}
                <BlocRetractation coche={retractationOk} onChange={setRetractationOk} />
                <Btn full onClick={handlePayFromWallet} disabled={walletProcessing || !retractationOk} style={{ marginTop:14, fontSize:16, padding:"18px" }}>
                  {walletProcessing ? "⏳ Traitement en cours…" : `💰 Payer ${total} € depuis mon wallet`}
                </Btn>
                <p style={{ textAlign:"center", color:C.textSub, fontSize:11, marginTop:8 }}>
                  Solde après paiement : {Math.max(0, prepaidBalance - total).toFixed(2).replace(".", ",")} €
                </p>
              </>
            )}
          </div>
        )}

        {/* Wallet insuffisant — bannière de recharge rapide */}
        {prepaidBalance > 0 && prepaidBalance < total && (
          <div style={{ background:"rgba(107,86,255,0.10)", border:"1px solid rgba(107,86,255,0.35)", borderRadius:14, padding:"14px 16px", marginBottom:16, display:"flex", justifyContent:"space-between", alignItems:"center", gap:12 }}>
            <div>
              <div style={{ fontWeight:700, color:C.text, fontSize:13, marginBottom:3 }}>💰 Wallet insuffisant</div>
              <div style={{ color:C.textSub, fontSize:12 }}>
                Solde : <strong style={{ color:"#fff" }}>{prepaidBalance.toFixed(2).replace(".",",")} €</strong> — il manque <strong style={{ color:C.violet }}>{(total - prepaidBalance).toFixed(2).replace(".",",")} €</strong>
              </div>
            </div>
            {/* Le rechargement est suspendu (voir api/stripe-wallet-topup.js).
                Proposer un bouton qui répond 503 serait pire que ne rien
                proposer : le client cliquerait, verrait une erreur, et
                conclurait que la plateforme est cassée. */}
            <span style={{ color:C.textMuted, fontSize:11, textAlign:"right", flexShrink:0, maxWidth:180, lineHeight:1.4 }}>
              Rechargement suspendu — réglez le complément par carte.
            </span>
          </div>
        )}


        {/* Méthode de paiement */}
        {!useWallet && (
        <div style={{ background:"#0D1B3E", borderRadius:16, padding:"16px", marginBottom:16, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
          <div style={{ fontWeight:800, color:C.text, fontSize:14, marginBottom:12 }}>💳 Carte bancaire</div>
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
                    <label style={{ display:"block", fontSize:12, fontWeight:600, marginBottom:5, color: cardNameError ? "#f87171" : C.textSub }}>
                      Titulaire de la carte <span style={{ color:"#f87171" }}>*</span>
                    </label>
                    <input
                      value={cardName}
                      onChange={e=>{ setCardName(e.target.value); if(e.target.value.trim()) setCardNameError(false); }}
                      placeholder="Jean Dupont"
                      style={{ width:"100%", padding:"12px 14px", borderRadius:11, border:`1px solid ${cardNameError ? "#f87171" : C.border}`, fontSize:14, fontFamily:"inherit", outline:"none", boxSizing:"border-box", background:"#162547", color:C.text }}
                    />
                    {cardNameError && <div style={{ color:"#f87171", fontSize:11, marginTop:4 }}>Le nom du titulaire est obligatoire</div>}
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
        </div>
        )}

        {/* Sécurité + bouton paiement carte — masqués si wallet sélectionné */}
        {!useWallet && (
          <>
            <div style={{ display:"flex", gap:8, justifyContent:"center", marginBottom:16 }}>
              {["🔒 SSL 256-bit","🛡️ 3D Secure","✓ PCI DSS"].map(s=>(
                <span key={s} style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:8, padding:"4px 10px", fontSize:10, color:C.textSub, fontWeight:600 }}>{s}</span>
              ))}
            </div>
            <BlocRetractation coche={retractationOk} onChange={setRetractationOk} />
            <Btn full onClick={handlePay} disabled={processing || !retractationOk}
              style={{ fontSize:16, padding:"18px", position:"relative" }}>
              {processing ? "⏳ Traitement en cours…" : `🔒 Payer ${total} € en sécurité`}
            </Btn>
            <p style={{ textAlign:"center", color:C.textSub, fontSize:11, marginTop:8 }}>Aucun débit avant validation de votre prestation</p>
          </>
        )}
      </div>
    </div>
  );
}

// ── Informations légales ALANE ────────────────────────────────────
//
// Aucune valeur par défaut : la forme juridique était codée en dur à « SAS » et
// s'affichait donc sur toutes les factures, y compris avant l'immatriculation de
// la société. Un document qui a l'apparence d'une facture ne peut pas affirmer
// l'existence d'une personne morale qui n'existe pas encore.
//
// Ces trois mentions ne s'affichent que si elles sont renseignées dans Vercel.
// Tant qu'elles ne le sont pas, l'en-tête indique simplement le rôle d'ALANE.
const ALANE_SIRET   = import.meta.env.VITE_ALANE_SIRET   || "";
const ALANE_ADRESSE = import.meta.env.VITE_ALANE_ADRESSE || "";
const ALANE_FORME   = import.meta.env.VITE_ALANE_FORME   || "";

// ── WALLET TOP-UP MODAL ───────────────────────────────────────────
const TOPUP_AMOUNTS = [20, 50, 100, 200];

// Conservé volontairement, sans appelant, le temps de la suspension du
// rechargement : c'est l'écran à rebrancher une fois la qualification du
// portefeuille tranchée. Le retirer obligerait à le réécrire.
// eslint-disable-next-line no-unused-vars
export function WalletTopupModal({ onClose, onSuccess }) {
  const [selectedAmt,  setSelectedAmt]  = useState(50);
  const [customAmt,    setCustomAmt]    = useState("");
  const [useCustom,    setUseCustom]    = useState(false);
  const [cardName,     setCardName]     = useState("");
  const [cardNameErr,  setCardNameErr]  = useState(false);
  const [processing,   setProcessing]   = useState(false);
  const [done,         setDone]         = useState(false);
  const [error,        setError]        = useState(null);
  const [savedCard,    setSavedCard]    = useState(null); // { pmId, brand, last4 }
  const [useSavedCard, setUseSavedCard] = useState(false);
  const stripeRef  = useRef(null);
  const cardElRef  = useRef(null);
  const mountRef   = useRef(null);

  const amount = useCustom
    ? (parseFloat(customAmt.replace(",", ".")) || 0)
    : selectedAmt;

  // Savings message: one Stripe fixed fee (0,25€) per top-up vs per mission
  // For N missions from one top-up: savings = (N-1) × 0,25€
  const savingsHint = amount >= 50
    ? `Avec ${amount} €, couvrez plusieurs prestations et ne payez les 0,25 € de frais fixes Stripe qu'une seule fois — au lieu d'une fois par prestation.`
    : "Chaque recharge = un seul paiement Stripe, quelle que soit la quantité de prestations financées.";

  // Load saved card from user_metadata on mount
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const m = data?.user?.user_metadata || {};
      if (m.stripe_pm_id) {
        setSavedCard({ pmId: m.stripe_pm_id, brand: m.card_brand || "card", last4: m.card_last4 || "••••" });
        setUseSavedCard(true);
      }
    });
  }, []);

  // Mount Stripe card element only when using a new card
  useEffect(() => {
    if (useSavedCard) {
      if (cardElRef.current) { cardElRef.current.destroy(); cardElRef.current = null; }
      return;
    }
    let destroyed = false;
    (async () => {
      const { loadStripe } = await import("@stripe/stripe-js");
      const pk = import.meta.env.VITE_STRIPE_PUBLIC_KEY;
      if (!pk || destroyed) return;
      const stripe = await loadStripe(pk);
      if (!stripe || destroyed) return;
      stripeRef.current = stripe;
      if (!mountRef.current || cardElRef.current || destroyed) return;
      const elements = stripe.elements();
      const cardEl = elements.create("card", {
        hidePostalCode: true,
        style: {
          base:    { color:"#e2e8f0", fontFamily:"inherit", fontSize:"15px", "::placeholder":{ color:"#64748b" } },
          invalid: { color:"#f87171" },
        },
      });
      cardElRef.current = cardEl;
      if (mountRef.current && !destroyed) cardEl.mount(mountRef.current);
    })();
    return () => {
      destroyed = true;
      if (cardElRef.current) { cardElRef.current.destroy(); cardElRef.current = null; }
    };
  }, [useSavedCard]);

  const handlePay = async () => {
    if (processing || done) return;
    if (!useSavedCard && !cardName.trim()) { setCardNameErr(true); return; }
    if (!amount || amount < 10 || amount > 1000) { setError("Montant invalide (10 € – 1 000 €)"); return; }
    if (!useSavedCard && (!stripeRef.current || !cardElRef.current)) { setError("Stripe non initialisé — rechargez la page."); return; }
    setProcessing(true);
    setError(null);
    try {
      // Ensure Stripe is loaded when using saved card (no card element was mounted)
      if (useSavedCard && !stripeRef.current) {
        const { loadStripe } = await import("@stripe/stripe-js");
        const pk = import.meta.env.VITE_STRIPE_PUBLIC_KEY;
        stripeRef.current = await loadStripe(pk);
      }
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const r = await fetch("/api/stripe-wallet-topup", {
        method:  "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body:    JSON.stringify({ amount }),
      });
      const { clientSecret, error: intentErr } = await r.json();
      if (intentErr || !clientSecret) throw new Error(intentErr || "Erreur création paiement");
      const paymentMethodParam = useSavedCard && savedCard
        ? { payment_method: savedCard.pmId }
        : { payment_method: { card: cardElRef.current, billing_details: cardName ? { name: cardName } : undefined } };
      const { error: stripeErr, paymentIntent } = await stripeRef.current.confirmCardPayment(clientSecret, paymentMethodParam);
      if (stripeErr) throw new Error(stripeErr.message);
      if (paymentIntent?.status === "succeeded") {
        setDone(true);
        onSuccess && onSuccess(amount);
      }
    } catch (e) {
      setError(e.message || "Erreur paiement");
      setProcessing(false);
    }
  };

  return (
    <div style={{ position:"fixed", top:0, left:0, right:0, bottom:0, background:"rgba(0,0,0,0.85)", zIndex:9999, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
      <div style={{ background:"#0A1628", borderRadius:"24px 24px 0 0", padding:"24px 20px 40px", width:"100%", maxWidth:480, maxHeight:"90vh", overflowY:"auto" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
          <h3 style={{ color:"#fff", fontSize:18, fontWeight:800, margin:0 }}>💰 Recharger mon wallet</h3>
          <button onClick={onClose} style={{ background:"rgba(255,255,255,0.1)", border:"none", borderRadius:8, padding:"6px 12px", color:"rgba(255,255,255,0.6)", cursor:"pointer", fontSize:16, fontFamily:"inherit" }}>×</button>
        </div>

        {done ? (
          <div style={{ textAlign:"center", padding:"32px 16px" }}>
            <div style={{ fontSize:52, marginBottom:16 }}>✅</div>
            <h4 style={{ color:"#10D98F", fontWeight:800, fontSize:20, margin:"0 0 10px" }}>Wallet rechargé !</h4>
            <p style={{ color:"rgba(255,255,255,0.7)", fontSize:14, lineHeight:1.6, margin:"0 0 24px" }}>
              <strong style={{ color:"#fff" }}>{amount} €</strong> ont été ajoutés à votre wallet ALANE.<br/>
              Vous pouvez maintenant payer vos prochaines prestations sans frais supplémentaires.
            </p>
            <button onClick={onClose} style={{ background:C.violet, border:"none", borderRadius:12, padding:"14px 28px", color:"#fff", fontWeight:700, fontSize:15, cursor:"pointer", fontFamily:"inherit" }}>Fermer</button>
          </div>
        ) : (
          <>
            {/* Montant */}
            <div style={{ marginBottom:16 }}>
              <div style={{ fontSize:12, color:"rgba(255,255,255,0.5)", fontWeight:600, marginBottom:10, textTransform:"uppercase", letterSpacing:1 }}>Montant de la recharge</div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8, marginBottom:10 }}>
                {TOPUP_AMOUNTS.map(a => (
                  <button key={a} onClick={()=>{ setSelectedAmt(a); setUseCustom(false); }}
                    style={{ background: !useCustom && selectedAmt===a ? C.violet : "rgba(255,255,255,0.07)", border:`2px solid ${!useCustom && selectedAmt===a ? C.violet : "rgba(255,255,255,0.12)"}`, borderRadius:10, padding:"12px 4px", color:"#fff", fontWeight:700, fontSize:14, cursor:"pointer", fontFamily:"inherit" }}>
                    {a} €
                  </button>
                ))}
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <button onClick={()=>setUseCustom(v=>!v)}
                  style={{ background: useCustom ? C.violet : "rgba(255,255,255,0.07)", border:`2px solid ${useCustom ? C.violet : "rgba(255,255,255,0.12)"}`, borderRadius:10, padding:"11px 14px", color:"#fff", fontWeight:600, fontSize:13, cursor:"pointer", fontFamily:"inherit", whiteSpace:"nowrap" }}>
                  Autre montant
                </button>
                {useCustom && (
                  <div style={{ flex:1, position:"relative" }}>
                    <input
                      value={customAmt}
                      onChange={e=>setCustomAmt(e.target.value)}
                      placeholder="ex. 75"
                      type="number" min="10" max="1000"
                      style={{ width:"100%", padding:"11px 32px 11px 12px", borderRadius:10, border:`1px solid rgba(255,255,255,0.2)`, background:"#162547", color:"#fff", fontSize:14, fontFamily:"inherit", outline:"none", boxSizing:"border-box" }}
                    />
                    <span style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)", color:"rgba(255,255,255,0.4)", fontSize:13 }}>€</span>
                  </div>
                )}
              </div>
            </div>

            {/* Savings info */}
            <div style={{ background:"rgba(16,217,143,0.08)", border:"1px solid rgba(16,217,143,0.25)", borderRadius:12, padding:"12px 14px", marginBottom:16, fontSize:12, color:"rgba(255,255,255,0.75)", lineHeight:1.6 }}>
              <span style={{ color:"#10D98F", fontWeight:700 }}>💡 Économisez sur les frais Stripe</span><br/>
              {savingsHint}
            </div>

            {/* Carte */}
            <div style={{ marginBottom:14 }}>
              <div style={{ fontSize:12, color:"rgba(255,255,255,0.5)", fontWeight:600, marginBottom:10, textTransform:"uppercase", letterSpacing:1 }}>Paiement par carte</div>

              {/* Saved card selector */}
              {savedCard && (
                <div style={{ marginBottom:12 }}>
                  <div onClick={()=>setUseSavedCard(true)} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", background: useSavedCard ? "rgba(107,86,255,0.12)" : "rgba(255,255,255,0.04)", border:`2px solid ${useSavedCard ? C.violet : "rgba(255,255,255,0.12)"}`, borderRadius:11, padding:"12px 14px", cursor:"pointer", marginBottom:8 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                      <span style={{ fontSize:20 }}>💳</span>
                      <div>
                        <div style={{ fontWeight:700, color:"#fff", fontSize:13, textTransform:"capitalize" }}>{savedCard.brand} ••••{savedCard.last4}</div>
                        <div style={{ color:"rgba(255,255,255,0.45)", fontSize:11 }}>Carte enregistrée</div>
                      </div>
                    </div>
                    <div style={{ width:18, height:18, borderRadius:"50%", border:`2px solid ${useSavedCard ? C.violet : "rgba(255,255,255,0.25)"}`, background:useSavedCard ? C.violet : "transparent", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                      {useSavedCard && <div style={{ width:8, height:8, borderRadius:"50%", background:"#fff" }} />}
                    </div>
                  </div>
                  <div onClick={()=>setUseSavedCard(false)} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", background: !useSavedCard ? "rgba(107,86,255,0.12)" : "rgba(255,255,255,0.04)", border:`2px solid ${!useSavedCard ? C.violet : "rgba(255,255,255,0.12)"}`, borderRadius:11, padding:"12px 14px", cursor:"pointer" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                      <span style={{ fontSize:20 }}>➕</span>
                      <div style={{ fontWeight:600, color:"#fff", fontSize:13 }}>Utiliser une autre carte</div>
                    </div>
                    <div style={{ width:18, height:18, borderRadius:"50%", border:`2px solid ${!useSavedCard ? C.violet : "rgba(255,255,255,0.25)"}`, background:!useSavedCard ? C.violet : "transparent", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                      {!useSavedCard && <div style={{ width:8, height:8, borderRadius:"50%", background:"#fff" }} />}
                    </div>
                  </div>
                </div>
              )}

              {(!savedCard || !useSavedCard) && (
                <>
                  <div style={{ marginBottom:10 }}>
                    <label style={{ display:"block", fontSize:12, fontWeight:600, marginBottom:5, color: cardNameErr ? "#f87171" : "rgba(255,255,255,0.5)" }}>
                      Titulaire <span style={{ color:"#f87171" }}>*</span>
                    </label>
                    <input
                      value={cardName}
                      onChange={e=>{ setCardName(e.target.value); if(e.target.value.trim()) setCardNameErr(false); }}
                      placeholder="Jean Dupont"
                      style={{ width:"100%", padding:"12px 14px", borderRadius:11, border:`1px solid ${cardNameErr?"#f87171":"rgba(255,255,255,0.15)"}`, fontSize:14, fontFamily:"inherit", outline:"none", boxSizing:"border-box", background:"#162547", color:"#fff" }}
                    />
                    {cardNameErr && <div style={{ color:"#f87171", fontSize:11, marginTop:4 }}>Champ obligatoire</div>}
                  </div>
                  <div style={{ borderRadius:11, border:"1px solid rgba(255,255,255,0.15)", background:"#162547", overflow:"hidden" }}>
                    <div ref={mountRef} style={{ padding:"14px", minHeight:50 }} />
                  </div>
                </>
              )}
            </div>

            {error && (
              <div style={{ background:"#ff4d4d15", border:"1px solid #ff4d4d40", borderRadius:10, padding:"10px 12px", color:"#f87171", fontSize:13, marginBottom:14 }}>
                ⚠️ {error}
              </div>
            )}

            <button onClick={handlePay} disabled={processing}
              style={{ width:"100%", background: processing ? "rgba(255,255,255,0.1)" : C.violet, border:"none", borderRadius:12, padding:"16px", color:"#fff", fontWeight:800, fontSize:16, cursor: processing ? "default" : "pointer", fontFamily:"inherit" }}>
              {processing ? "⏳ Traitement en cours…" : `Recharger ${useCustom ? (parseFloat(customAmt)||0) : selectedAmt} €`}
            </button>
            <p style={{ textAlign:"center", color:"rgba(255,255,255,0.3)", fontSize:11, marginTop:8 }}>🔒 Paiement sécurisé · SSL 256-bit · PCI DSS</p>
          </>
        )}
      </div>
    </div>
  );
}

// ── FACTURE / INVOICE ─────────────────────────────────────────────
export function InvoiceScreen({ prestation, onBack }) {
  const [clientInfo,  setClientInfo]  = useState({ name:"", company:"", siret:"", adresse:"", cp:"", ville:"" });
  const [prestaInfo,  setPrestaInfo]  = useState({ name:"", company:"", siret:"", adresse:"", cp:"", ville:"" });
  const [loading,     setLoading]     = useState(true);

  const billedHours  = prestation?.actual_hours ?? prestation?.hours ?? 0;
  const missionDate  = prestation?.created_at ? new Date(prestation.created_at) : new Date();
  const invoiceNum   = prestation
    ? `ALA-${missionDate.getFullYear()}${String(missionDate.getMonth()+1).padStart(2,"0")}-${prestation.id.slice(-6).toUpperCase()}`
    : "ALA-000000";
  const emittedDate  = missionDate.toLocaleDateString("fr-FR");
  const htCalc       = Math.round(billedHours * Number(prestation?.tarif_horaire||0) * 100) / 100;
  const ht           = htCalc > 0 ? htCalc : (Number(prestation?.montant_total||0));
  const htFormatted  = ht.toFixed(2).replace(".",",");

  useEffect(() => {
    if (!prestation) { setLoading(false); return; }
    (async () => {
      try {
        const [{ data: cu }, { data: cp }] = await Promise.all([
          supabase.auth.getUser(),
          supabase.from("profiles").select("prenom,nom,societe_nom,adresse,code_postal,ville,siret").eq("id", prestation.client_id).single(),
        ]);
        const clientMeta = cu?.user?.user_metadata || {};
        setClientInfo({
          name:    [cp?.prenom||clientMeta.prenom, cp?.nom||clientMeta.nom].filter(Boolean).join(" ") || cu?.user?.email || "—",
          company: cp?.societe_nom || clientMeta.societe_nom || "",
          siret:   cp?.siret || clientMeta.kbis || "",
          adresse: cp?.adresse || clientMeta.adresse || "",
          cp:      cp?.code_postal || clientMeta.code_postal || "",
          ville:   cp?.ville || clientMeta.ville || "",
        });
        if (prestation.prestataire_id) {
          const { data: pp } = await supabase.from("profiles").select("prenom,nom,societe_nom,adresse,code_postal,ville,siret").eq("id", prestation.prestataire_id).single();
          setPrestaInfo({
            name:    [pp?.prenom, pp?.nom].filter(Boolean).join(" ") || "Prestataire",
            company: pp?.societe_nom || "",
            siret:   pp?.siret || "",
            adresse: pp?.adresse || "",
            cp:      pp?.code_postal || "",
            ville:   pp?.ville || "",
          });
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [prestation?.id]);

  if (!prestation) return (
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
        <h2 style={{ color:C.white, fontSize:20, fontWeight:800, margin:"0 0 4px" }}>📄 Facture de prestation</h2>
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
                  {/* La facture est établie par le prestataire au client :
                      ALANE n'en est pas l'émetteur, seulement l'intermédiaire.
                      Le dire évite qu'un lecteur — client, comptable, contrôleur
                      — attribue la prestation à la plateforme. */}
                  <div style={{ color:C.textSub, fontSize:11, marginTop:2 }}>
                    Plateforme de mise en relation{ALANE_FORME ? ` · ${ALANE_FORME}` : ""}
                  </div>
                  {ALANE_ADRESSE && <div style={{ color:C.textSub, fontSize:10, marginTop:1 }}>{ALANE_ADRESSE}</div>}
                  {ALANE_SIRET   && <div style={{ color:C.textSub, fontSize:10, marginTop:1 }}>SIRET : {ALANE_SIRET}</div>}
                  <div style={{ color:C.textMuted, fontSize:9, marginTop:3, maxWidth:210, lineHeight:1.4 }}>
                    Facture établie par le prestataire au client. ALANE intervient
                    comme intermédiaire et n&apos;est pas partie au contrat de prestation.
                  </div>
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
                  {clientInfo.siret   && <div style={{ fontSize:11, color:C.textSub }}>SIRET : {clientInfo.siret}</div>}
                  {clientInfo.adresse && <div style={{ fontSize:11, color:C.textSub, marginTop:3 }}>{clientInfo.adresse}</div>}
                  {(clientInfo.cp || clientInfo.ville) && <div style={{ fontSize:11, color:C.textSub }}>{[clientInfo.cp, clientInfo.ville].filter(Boolean).join(" ")}</div>}
                </div>
                <div>
                  <div style={{ fontSize:11, color:C.textSub, fontWeight:600, marginBottom:4, textTransform:"uppercase", letterSpacing:0.5 }}>Prestataire</div>
                  <div style={{ fontSize:13, fontWeight:700, color:C.text }}>{prestaInfo.name}</div>
                  {prestaInfo.company && <div style={{ fontSize:11, color:C.textSub }}>{prestaInfo.company}</div>}
                  {prestaInfo.siret   && <div style={{ fontSize:11, color:C.textSub }}>SIRET : {prestaInfo.siret}</div>}
                  {prestaInfo.adresse && <div style={{ fontSize:11, color:C.textSub, marginTop:3 }}>{prestaInfo.adresse}</div>}
                  {(prestaInfo.cp || prestaInfo.ville) && <div style={{ fontSize:11, color:C.textSub }}>{[prestaInfo.cp, prestaInfo.ville].filter(Boolean).join(" ")}</div>}
                </div>
              </div>
            </div>

            {/* Détail prestation */}
            <div style={{ background:"#0D1B3E", borderRadius:16, padding:"16px", marginBottom:14, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
              <div style={{ fontWeight:800, color:C.text, fontSize:13, marginBottom:12 }}>Détail de la prestation</div>
              <div style={{ display:"flex", justifyContent:"space-between", padding:"8px 0", borderBottom:`1px solid ${C.border}` }}>
                <span style={{ color:C.textSub, fontSize:12, fontWeight:600 }}>Description</span>
                <span style={{ color:C.textSub, fontSize:12, fontWeight:600 }}>Montant HT</span>
              </div>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 0", borderBottom:`1px solid ${C.border}` }}>
                <div>
                  <div style={{ fontWeight:700, color:C.text, fontSize:13 }}>{prestation.metier || "Prestation de service"}</div>
                  {prestation.sector && <div style={{ color:C.textSub, fontSize:11, marginTop:2 }}>Secteur : {prestation.sector}</div>}
                  {prestation.date && <div style={{ color:C.textSub, fontSize:11 }}>Date : {prestation.date}</div>}
                  {prestation.started_at
                    ? <div style={{ color:C.textSub, fontSize:11 }}>Début réel : {new Date(prestation.started_at).toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"})}</div>
                    : prestation.heure_debut && <div style={{ color:C.textSub, fontSize:11 }}>Début : {prestation.heure_debut}</div>}
                  {prestation.delay_status === "rejected" && prestation.actual_hours && (
                    <div style={{ color:"#F59E0B", fontSize:11 }}>Décalage refusé — {prestation.actual_hours}h facturées</div>
                  )}
                  {prestation.ville && <div style={{ color:C.textSub, fontSize:11 }}>Lieu : {prestation.ville}</div>}
                  {htCalc > 0 && (
                    <div style={{ color:C.textSub, fontSize:11 }}>
                      {billedHours}h × {Number(prestation.tarif_horaire||0).toFixed(2).replace(".",",")} € HT/h
                    </div>
                  )}
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
                <div style={{ fontWeight:800, color:C.success, fontSize:13 }}>Prestation validée</div>
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
  const p = provider || {};
  const [step, setStep] = useState("policy"); // policy | confirm | replacement | done
  const [reason, setReason] = useState("");
  const [chosen, setChosen] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const { providers: allProviders } = _useProviders();
  const replacements = allProviders.filter(ap => ap.sector === p.sector && ap.id !== p.id && ap.available).slice(0, 4);

  if (!provider) return <div style={{ padding:40, textAlign:"center", color:C.textSub }}><button onClick={onBack} style={{ background:"transparent", border:"none", color:C.textSub, cursor:"pointer", fontSize:13, display:"block", marginBottom:16 }}>← Retour</button>Prestation introuvable.</div>;

  // Calcul réel du délai avant prestation + pénalité
  const missionTs = missionDate ? new Date(missionDate).getTime() : Date.now() + 18*3600000;
  const hoursLeft = Math.max(0, Math.floor((missionTs - Date.now()) / 3600000));
  const penalty = hoursLeft >= 24 ? 0 : 100;
  const penaltyAmount = 0; // frais de service seulement, montant géré par l'admin

  if(step==="replacement") return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg, #0A1628 0%, #0D1B3E 100%)`, paddingBottom:80 }}>
      <div style={{ background:`linear-gradient(135deg,${C.accent},#c0392b)`, padding:"48px 22px 24px", borderRadius:"0 0 26px 26px" }}>
        <h2 style={{ color:C.white, fontSize:20, fontWeight:800, margin:"0 0 4px" }}>🔄 Remplaçant automatique</h2>
        <p style={{ color:"rgba(255,255,255,0.7)", fontSize:13, margin:0 }}>Prestataires disponibles sur votre créneau</p>
      </div>
      <div style={{ padding:"20px 18px" }}>
        <div style={{ background:`${C.accentGold}15`, border:`1px solid ${C.accentGold}44`, borderRadius:12, padding:"12px 14px", marginBottom:16, fontSize:13, color:C.text }}>
          ALANE a trouvé <strong>{replacements.length} remplaçant{replacements.length>1?"s":""}</strong> disponible{replacements.length>1?"s":""} sur votre créneau
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
        {chosen ? `${chosen.name} prendra en charge votre prestation.` : "Vous serez remboursé sous 3-5 jours ouvrés."}
      </p>
      <Btn full variant="secondary" onClick={()=>onNavigate("home")} style={{ color:C.success }}>Retour à l'accueil</Btn>
      <button onClick={()=>onNavigate("rating",p)} style={{ background:"rgba(255,255,255,0.15)", border:"1px solid rgba(255,255,255,0.3)", borderRadius:12, padding:"11px 24px", color:"rgba(255,255,255,0.9)", cursor:"pointer", marginTop:10, fontSize:13, fontFamily:"inherit", width:"100%", fontWeight:600 }}>⭐ Noter {p.name}</button>
    </div>
  );

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg, #0A1628 0%, #0D1B3E 100%)`, paddingBottom:80 }}>
      <div style={{ background:`linear-gradient(135deg,${C.accent},#c0392b)`, padding:"48px 22px 24px", borderRadius:"0 0 26px 26px" }}>
        <button onClick={onBack} style={{ background:"rgba(255,255,255,0.15)", border:"none", borderRadius:10, padding:"7px 14px", color:C.white, cursor:"pointer", fontSize:13, marginBottom:14 }}>← Retour</button>
        <h2 style={{ color:C.white, fontSize:20, fontWeight:800, margin:"0 0 4px" }}>❌ Annuler la prestation</h2>
        <p style={{ color:"rgba(255,255,255,0.7)", fontSize:13, margin:0 }}>{p.name} · {p.role}</p>
      </div>

      <div style={{ padding:"20px 18px" }}>
        {/* Politique d'annulation */}
        <div style={{ background:"#0D1B3E", borderRadius:16, padding:"16px", marginBottom:16, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
          <div style={{ fontWeight:800, color:C.text, fontSize:14, marginBottom:10 }}>📋 Politique d'annulation ALANE</div>
          <div style={{ color:C.textSub, fontSize:13, lineHeight:1.7 }}>
            L'annulation est <strong style={{ color:C.success }}>sans retenue</strong> sur le montant de la prestation. Seuls les <strong style={{ color:C.text }}>frais de service</strong> engagés restent dus.
          </div>
          <div style={{ marginTop:10, background:`${C.success}12`, border:`1px solid ${C.success}30`, borderRadius:10, padding:"10px 14px", fontSize:12, color:C.textSub }}>
            ✅ Aucun frais d'annulation sur le montant de la prestation
          </div>
        </div>

        {/* Raison */}
        <div style={{ background:"#0D1B3E", borderRadius:16, padding:"16px", marginBottom:16, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
          <div style={{ fontWeight:800, color:C.text, fontSize:13, marginBottom:10 }}>Motif d'annulation</div>
          {["Erreur de date / horaire","Prestataire ne convient plus","Prestation annulée par mon client","Problème de budget","Autre"].map(r => (
            <div key={r} onClick={()=>setReason(r)} style={{ padding:"10px 14px", borderRadius:10, marginBottom:6, border:`2px solid ${reason===r?C.violet:C.grayLight}`, background:reason===r?`${C.violet}08`:C.white, cursor:"pointer", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <span style={{ fontSize:13, fontWeight:reason===r?700:400, color:reason===r?C.violet:C.text }}>{r}</span>
              {reason===r && <span style={{ color:C.violet, fontSize:16 }}>✓</span>}
            </div>
          ))}
        </div>

        <div style={{ display:"flex", gap:10 }}>
          <Btn variant="secondary" onClick={onBack} style={{ flex:1, padding:"13px", fontSize:13 }}>Garder la prestation</Btn>
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
            } catch { /* ignore */ }
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
