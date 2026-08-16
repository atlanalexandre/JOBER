/* eslint-disable react-refresh/only-export-components */
import { useState, useEffect, useRef } from "react";
import { C, font, r, shadow } from "../constants/colors.js";
import { isLaunchPhase } from "../constants/plans.js";

export const Stars = ({ rating, size=13 }) => (
  <span style={{ fontSize:size, letterSpacing:1 }}>
    {[1,2,3,4,5].map(i=>(
      <span key={i} style={{ color:i<=Math.floor(rating)?C.accentGold:"rgba(255,255,255,0.12)" }}>★</span>
    ))}
  </span>
);

export const Badge = ({ children, color=C.violet, small }) => (
  <span style={{
    background:`${color}18`,
    color,
    border:`1px solid ${color}35`,
    borderRadius:100,
    padding: small ? "2px 9px" : "4px 14px",
    fontSize: small ? 10 : 11,
    fontWeight: 600,
    letterSpacing: 0.3,
    whiteSpace:"nowrap",
    display:"inline-block",
  }}>{children}</span>
);

export const Btn = ({ children, onClick, variant="primary", full, disabled, style:s, className="" }) => {
  // Le style passé en prop est fusionné APRÈS celui de la variante. Une propriété
  // à undefined — écrite naturellement sous la forme `couleur ? X : undefined` —
  // écrasait donc la valeur de la variante au lieu de la laisser intacte : le
  // bouton « Confirmer & payer » perdait son fond violet et s'affichait en blanc,
  // donnant l'impression d'être désactivé. On retire ces clés avant fusion.
  const styleUtile = s
    ? Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined))
    : undefined;
  const variants = {
    primary: {
      background: disabled ? "rgba(255,255,255,0.06)" : `linear-gradient(135deg, ${C.violet}, ${C.violetDark})`,
      color: disabled ? C.textMuted : C.white,
      boxShadow: disabled ? "none" : shadow.glow,
      border: "none",
    },
    secondary: {
      background: "transparent",
      color: C.text,
      border: `1px solid ${C.borderStrong}`,
      boxShadow: "none",
    },
    ghost: {
      background: "transparent",
      color: C.violet,
      border: `1px solid ${C.violet}55`,
      boxShadow: "none",
    },
    success: {
      background: `linear-gradient(135deg, ${C.success}, #0ab87a)`,
      color: C.white,
      boxShadow: `0 4px 20px ${C.success}44`,
      border: "none",
    },
    danger: {
      background: `linear-gradient(135deg, ${C.accent}, #d94848)`,
      color: C.white,
      boxShadow: `0 4px 16px ${C.accent}44`,
      border: "none",
    },
    gold: {
      background: `linear-gradient(135deg, ${C.accentGold}, #d9960a)`,
      color: "#1a1200",
      boxShadow: `0 4px 20px ${C.accentGold}44`,
      border: "none",
    },
    dark: {
      background: "#162547",
      color: C.text,
      border: `1px solid ${C.borderStrong}`,
      boxShadow: "none",
    },
  };
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`btn-hover ${className}`}
      style={{
        borderRadius: r,
        fontWeight: 600,
        fontSize: 15,
        cursor: disabled ? "not-allowed" : "pointer",
        padding: "14px 24px",
        width: full ? "100%" : "auto",
        fontFamily: "inherit",
        opacity: disabled ? 0.5 : 1,
        letterSpacing: 0.2,
        ...variants[variant],
        ...styleUtile,
      }}
    >{children}</button>
  );
};

export const Input = ({ label, type="text", placeholder, icon, value, onChange, onBlur, hint, disabled=false, autoComplete, name, inputMode }) => (
  <div style={{ marginBottom:16, minWidth:0 }}>
    {label && (
      <label style={{
        display:"block", fontSize:11, color:C.textSub,
        marginBottom:7, fontWeight:600, letterSpacing:0.8,
        textTransform:"uppercase",
      }}>{label}</label>
    )}
    <div style={{ position:"relative" }}>
      {icon && (
        <span style={{
          position:"absolute", left:14, top:"50%",
          transform:"translateY(-50%)", fontSize:16, opacity:0.5,
        }}>{icon}</span>
      )}
      <input
        type={type}
        placeholder={placeholder}
        value={value||""}
        onChange={onChange}
        onBlur={onBlur}
        disabled={disabled}
        autoComplete={autoComplete}
        name={name}
        inputMode={inputMode}
        style={{
          width:"100%",
          padding: icon ? "13px 14px 13px 44px" : "13px 16px",
          borderRadius: r,
          border: `1px solid ${disabled ? "rgba(255,255,255,0.04)" : C.border}`,
          fontSize:14, fontFamily:"inherit",
          color: disabled ? C.textMuted : C.text,
          background: disabled ? "rgba(255,255,255,0.03)" : "#112240",
          outline:"none",
          boxSizing:"border-box",
          transition:"border 0.2s, box-shadow 0.2s",
        }}
      />
    </div>
    {hint && <p style={{ fontSize:11, color:C.textMuted, margin:"6px 0 0 2px" }}>{hint}</p>}
  </div>
);

export const AddressAutocomplete = ({ label, value, onChange, onSelect, placeholder="12 rue de la Paix" }) => {
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const timerRef = useRef(null);
  const wrapRef  = useRef(null);

  useEffect(() => {
    const close = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("touchstart", close, { passive: true });
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("touchstart", close); };
  }, []);

  const handleChange = (e) => {
    const q = e.target.value;
    onChange(q);
    clearTimeout(timerRef.current);
    if (q.length < 3) { setSuggestions([]); setOpen(false); return; }
    timerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&limit=5`);
        const data = await res.json();
        const feats = data.features || [];
        setSuggestions(feats);
        setOpen(feats.length > 0);
      } catch { setSuggestions([]); setOpen(false); }
    }, 300);
  };

  const handleSelect = (feat) => {
    const { name, postcode, city } = feat.properties;
    onChange(name);
    onSelect({ rue: name, codePostal: postcode, ville: city });
    setSuggestions([]);
    setOpen(false);
  };

  return (
    <div ref={wrapRef} style={{ marginBottom:16, minWidth:0, position:"relative" }}>
      {label && <label style={{ display:"block", fontSize:11, color:C.textSub, marginBottom:7, fontWeight:600, letterSpacing:0.8, textTransform:"uppercase" }}>{label}</label>}
      <div style={{ position:"relative" }}>
        <span style={{ position:"absolute", left:14, top:"50%", transform:"translateY(-50%)", fontSize:16, opacity:0.5, pointerEvents:"none" }}>📍</span>
        <input type="text" placeholder={placeholder} value={value||""} onChange={handleChange}
          autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck="false"
          style={{ width:"100%", padding:"13px 14px 13px 44px", borderRadius:r, border:`1px solid ${C.border}`, fontSize:14, fontFamily:"inherit", color:C.text, background:"#112240", outline:"none", boxSizing:"border-box", transition:"border 0.2s, box-shadow 0.2s" }} />
      </div>
      {open && suggestions.length > 0 && (
        <div style={{ position:"absolute", top:"100%", left:0, right:0, marginTop:2, background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, zIndex:1000, overflow:"hidden", boxShadow:"0 8px 24px rgba(0,0,0,0.5)" }}>
          {suggestions.map((feat, i) => (
            <button key={i} onMouseDown={()=>handleSelect(feat)} onTouchEnd={e=>{e.preventDefault();handleSelect(feat);}}
              style={{ width:"100%", padding:"11px 14px", background:"transparent", border:"none", borderBottom:i<suggestions.length-1?`1px solid ${C.border}`:"none", color:C.text, fontSize:13, textAlign:"left", cursor:"pointer", fontFamily:"inherit", display:"block" }}>
              📍 {feat.properties.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export function formatPhone(v) {
  const d = v.replace(/\D/g,"").slice(0,10);
  return d.replace(/(\d{2})(?=\d)/g,"$1 ").trim();
}

export function checkIban(iban) {
  const s = (iban||"").replace(/\s/g,"").toUpperCase();
  if (s.length < 15) return null;
  const rearranged = s.slice(4)+s.slice(0,4);
  const n = rearranged.split("").map(c=>isNaN(c)?(c.charCodeAt(0)-55).toString():c).join("");
  let rem = 0;
  for (const c of n) rem = (rem*10+parseInt(c))%97;
  return rem === 1;
}

export const IbanInput = ({ label, placeholder, value, onChange, hint }) => {
  const valid = checkIban(value);
  const handleChange = (e) => {
    const raw = e.target.value.replace(/\s/g,"").toUpperCase().slice(0,34);
    const formatted = raw.replace(/(.{4})(?=.)/g,"$1 ").trim();
    onChange({ target: { value: formatted } });
  };
  return (
    <div style={{ marginBottom:16 }}>
      {label && <label style={{ display:"block", fontSize:11, color:C.textSub, marginBottom:7, fontWeight:600, letterSpacing:0.8, textTransform:"uppercase" }}>{label}</label>}
      <div style={{ position:"relative" }}>
        <span style={{ position:"absolute", left:14, top:"50%", transform:"translateY(-50%)", fontSize:16, opacity:0.5 }}>🏦</span>
        <input type="text" placeholder={placeholder} value={value||""} onChange={handleChange} autoComplete="off"
          style={{ width:"100%", padding:"13px 44px 13px 44px", borderRadius:r, border:`1px solid ${valid===false?"#F25E5E55":valid===true?"#10D98F55":C.border}`, fontSize:14, fontFamily:"inherit", color:C.text, background:"#112240", outline:"none", boxSizing:"border-box", transition:"border 0.2s" }} />
        {valid !== null && (
          <span style={{ position:"absolute", right:14, top:"50%", transform:"translateY(-50%)", fontSize:15 }}>{valid ? "✅" : "❌"}</span>
        )}
      </div>
      {valid === false && <p style={{ fontSize:11, color:"#F25E5E", margin:"5px 0 0 2px" }}>IBAN invalide — vérifiez le format</p>}
      {valid === true  && <p style={{ fontSize:11, color:"#10D98F", margin:"5px 0 0 2px" }}>IBAN valide ✓</p>}
      {valid === null && hint && <p style={{ fontSize:11, color:C.textMuted, margin:"5px 0 0 2px" }}>{hint}</p>}
    </div>
  );
};

function passwordStrength(pw) {
  if (!pw || pw.length < 3) return null;
  let score = 0;
  if (pw.length >= 8)  score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (score <= 1) return { label:"Faible",  color:"#F25E5E", pct:25  };
  if (score <= 3) return { label:"Moyen",   color:"#F5A623", pct:60  };
  return              { label:"Fort",    color:"#10D98F", pct:100 };
}

export const PasswordStrength = ({ password }) => {
  const s = passwordStrength(password);
  if (!s) return null;
  return (
    <div style={{ marginTop:-10, marginBottom:14 }}>
      <div style={{ height:3, borderRadius:2, background:C.border, overflow:"hidden" }}>
        <div style={{ height:"100%", width:`${s.pct}%`, background:s.color, borderRadius:2, transition:"width 0.4s, background 0.4s" }} />
      </div>
      <p style={{ fontSize:11, color:s.color, margin:"4px 0 0 2px", fontWeight:600 }}>Mot de passe {s.label}</p>
    </div>
  );
};

export const EmailInput = ({ label, value, onChange }) => {
  const [touched, setTouched] = useState(false);
  const fmt = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value||"");
  const showErr = touched && value && !fmt;
  const showOk  = touched && value && fmt;
  return (
    <div style={{ marginBottom:16 }}>
      <label style={{ display:"block", fontSize:11, color:C.textSub, marginBottom:7, fontWeight:600, letterSpacing:0.8, textTransform:"uppercase" }}>{label||"Adresse email *"}</label>
      <div style={{ position:"relative" }}>
        <span style={{ position:"absolute", left:14, top:"50%", transform:"translateY(-50%)", fontSize:16, opacity:0.5 }}>✉️</span>
        <input type="email" placeholder="votre@email.fr" value={value||""} onChange={onChange} onBlur={()=>setTouched(true)} autoComplete="email"
          style={{ width:"100%", padding:"13px 44px 13px 44px", borderRadius:r, border:`1px solid ${showErr?"#F25E5E55":showOk?"#10D98F55":C.border}`, fontSize:14, fontFamily:"inherit", color:C.text, background:"#112240", outline:"none", boxSizing:"border-box", transition:"border 0.2s" }} />
        {showOk  && <span style={{ position:"absolute", right:14, top:"50%", transform:"translateY(-50%)", fontSize:15 }}>✅</span>}
        {showErr && <span style={{ position:"absolute", right:14, top:"50%", transform:"translateY(-50%)", fontSize:15 }}>❌</span>}
      </div>
      {showErr && <p style={{ fontSize:11, color:"#F25E5E", margin:"5px 0 0 2px" }}>Format d'email invalide</p>}
    </div>
  );
};

export const Select = ({ label, options, value, onChange }) => (
  <div style={{ marginBottom:16 }}>
    {label && (
      <label style={{ display:"block", fontSize:11, color:C.textSub, marginBottom:7, fontWeight:600, letterSpacing:0.8, textTransform:"uppercase" }}>{label}</label>
    )}
    <select
      value={value||""}
      onChange={onChange}
      style={{
        width:"100%", padding:"13px 40px 13px 16px",
        borderRadius:r, border:`1px solid ${C.border}`,
        fontSize:14, fontFamily:"inherit",
        color: value ? C.text : C.textMuted,
        background: "#0D1B3E",
        outline:"none", boxSizing:"border-box",
        backgroundImage:`url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%238B8FA8' stroke-width='1.5' fill='none'/%3E%3C/svg%3E")`,
        backgroundRepeat:"no-repeat",
        backgroundPosition:"right 14px center",
        appearance:"none",
      }}
    >
      <option value="">Sélectionner…</option>
      {options.map(o=><option key={o} value={o}>{o}</option>)}
    </select>
  </div>
);

export const StepHeader = ({ title, subtitle, step, total, onBack }) => (
  <div style={{
    background: "#0D1B3E",
    padding:"52px 22px 24px",
    borderBottom:`1px solid ${C.border}`,
  }}>
    {onBack && (
      <button onClick={onBack} className="btn-hover" style={{
        background:"transparent", border:"none",
        color:C.textSub, cursor:"pointer",
        fontSize:13, fontWeight:500, padding:"0 0 14px",
        display:"flex", alignItems:"center", gap:6,
      }}>
        ← Retour
      </button>
    )}
    {total && (
      <div style={{ display:"flex", gap:4, marginBottom:14 }}>
        {Array.from({length:total}).map((_,i)=>(
          <div key={i} style={{
            flex:1, height:2, borderRadius:1,
            background: i<step ? C.violet : C.border,
            transition:"background 0.4s",
          }} />
        ))}
      </div>
    )}
    {step && total && (
      <p style={{ color:C.textMuted, fontSize:11, margin:"0 0 4px", letterSpacing:1, textTransform:"uppercase", fontWeight:600 }}>
        Étape {step} / {total}
      </p>
    )}
    <h2 style={{ color:C.text, fontSize:22, fontWeight:700, margin:0, fontFamily:font.display, lineHeight:1.2 }}>{title}</h2>
    {subtitle && <p style={{ color:C.textSub, fontSize:13, margin:"6px 0 0", lineHeight:1.6 }}>{subtitle}</p>}
  </div>
);

export const Card = ({ children, style={}, className="card-hover", onClick }) => (
  <div
    onClick={onClick}
    className={className}
    style={{
      background: "#0D1B3E",
      borderRadius: r,
      border: `1px solid ${C.border}`,
      padding: 16,
      cursor: onClick ? "pointer" : "default",
      ...style,
    }}
  >{children}</div>
);

export const SectionHeader = ({ title, action, onAction }) => (
  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
    <h3 style={{ margin:0, fontSize:15, fontWeight:700, color:C.text }}>{title}</h3>
    {action && (
      <button onClick={onAction} style={{ background:"none", border:"none", color:C.violet, fontWeight:600, fontSize:12, cursor:"pointer", letterSpacing:0.3 }}>
        {action} →
      </button>
    )}
  </div>
);

export const Divider = () => <div style={{ height:1, background:C.border, margin:"16px 0" }} />;

export const MiniBar = ({ data, color, height=40 }) => {
  const max = Math.max(...data);
  return (
    <div style={{ display:"flex", gap:4, alignItems:"flex-end", height }}>
      {data.map((v,i) => (
        <div key={i} style={{ flex:1, background: i===data.length-1 ? color : color+"66", borderRadius:"3px 3px 0 0", height:`${(v/max)*100}%`, minHeight:4, transition:"height 0.3s" }} />
      ))}
    </div>
  );
};

export const DonutChart = ({ sectors, size=120 }) => {
  const rad=40, cx=60, cy=60, circ=2*Math.PI*rad;
  let offset=0;
  return (
    <svg width={size} height={size} viewBox="0 0 120 120">
      <circle cx={cx} cy={cy} r={rad} fill="none" stroke="#E8ECF4" strokeWidth={18} />
      {sectors.map((s,i) => {
        const dash = (s.pct/100)*circ;
        const gap  = circ - dash;
        const el = (
          <circle key={i} cx={cx} cy={cy} r={rad} fill="none"
            stroke={s.color} strokeWidth={18}
            strokeDasharray={`${dash} ${gap}`}
            strokeDashoffset={-offset}
            style={{ transform:"rotate(-90deg)", transformOrigin:"center" }}
          />
        );
        offset += dash;
        return el;
      })}
      <text x={cx} y={cy-6}  textAnchor="middle" fontSize="14" fontWeight="900" fill="#1A1F36">{sectors.reduce((a,s)=>a+s.missions,0)||""}</text>
      <text x={cx} y={cy+10} textAnchor="middle" fontSize="9"  fill="#8A93A8">prestations</text>
    </svg>
  );
};

export function LaunchBadge({ context="home", spotsLeft=null }) {
  if(!isLaunchPhase()) return null;
  const spotsText = spotsLeft !== null
    ? (spotsLeft > 0 ? `Plus que ${spotsLeft} place${spotsLeft > 1 ? "s" : ""} sur 100` : "100/100 places — offre terminée")
    : "Réservé aux 100 premiers prestataires inscrits";
  const msgs = {
    home:    { icon:"🎉", title:"Offre de lancement", sub:`10 prestations gratuites · ${spotsText}` },
    presta:  { icon:"🚀", title:"10 prestations offertes", sub: spotsLeft !== null ? `${spotsLeft} place${spotsLeft > 1 ? "s" : ""} restante${spotsLeft > 1 ? "s" : ""} sur 100 · Inscrivez-vous maintenant` : "Réservé aux 100 premiers prestataires inscrits" },
    booking: { icon:"💡", title:"Tarif transparent", sub:"Le prix affiché est le prix réel — aucune surprise" },
  };
  const m = msgs[context] || msgs.home;
  return (
    <div style={{ background:"rgba(16,217,143,0.10)", border:"1px solid rgba(16,217,143,0.30)", borderRadius:r, padding:"11px 14px", marginBottom:14, display:"flex", gap:10, alignItems:"center" }}>
      <span style={{ fontSize:18, flexShrink:0 }}>{m.icon}</span>
      <div>
        <div style={{ fontWeight:700, color:"#10D98F", fontSize:13 }}>{m.title}</div>
        <div style={{ color:C.textSub, fontSize:11, marginTop:2 }}>{m.sub}</div>
      </div>
    </div>
  );
}

// ── Toast ────────────────────────────────────────────────────────────
const _toastRef = { fn: null };
export function showToast(msg, type = "error") {
  if (_toastRef.fn) _toastRef.fn(msg, type);
}
export function ToastContainer() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    _toastRef.fn = (msg, type) => {
      const id = Date.now() + Math.random();
      setItems(prev => [...prev.slice(-2), { id, msg, type }]);
      setTimeout(() => setItems(prev => prev.filter(t => t.id !== id)), 4000);
    };
    return () => { _toastRef.fn = null; };
  }, []);
  if (!items.length) return null;
  return (
    <div style={{ position:"fixed", bottom:80, left:"50%", transform:"translateX(-50%)", zIndex:9999, display:"flex", flexDirection:"column", gap:8, pointerEvents:"none", width:"calc(100% - 32px)", maxWidth:420 }}>
      {items.map(t => (
        <div key={t.id} style={{ background: t.type==="success" ? "#10D98F" : t.type==="info" ? "#7C6FE0" : "#F25E5E", color:"#fff", borderRadius:12, padding:"12px 16px", fontSize:14, fontWeight:600, boxShadow:"0 4px 20px rgba(0,0,0,0.4)", textAlign:"center" }}>
          {t.msg}
        </div>
      ))}
    </div>
  );
}

// ── ConfirmModal ─────────────────────────────────────────────────────
const _confirmRef = { fn: null };
export async function showConfirm(msg) {
  if (!_confirmRef.fn) return window.confirm(msg);
  return _confirmRef.fn(msg);
}
export function ConfirmModal() {
  const [state, setState] = useState(null);
  const resolveRef = useRef(null);
  useEffect(() => {
    _confirmRef.fn = (msg) => new Promise(resolve => { resolveRef.current = resolve; setState({ msg }); });
    return () => { _confirmRef.fn = null; };
  }, []);
  if (!state) return null;
  const choose = (v) => { setState(null); resolveRef.current?.(v); };
  return (
    <div onClick={() => choose(false)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", zIndex:10000, display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
      <div onClick={e => e.stopPropagation()} style={{ background:"#0D1B3E", borderRadius:20, padding:"28px 24px", width:"100%", maxWidth:380, border:"1px solid rgba(124,111,224,0.25)", boxShadow:"0 20px 60px rgba(0,0,0,0.6)" }}>
        <p style={{ color:"#F0F0F5", fontSize:15, lineHeight:1.6, margin:"0 0 24px", whiteSpace:"pre-wrap" }}>{state.msg}</p>
        <div style={{ display:"flex", gap:10 }}>
          <button onClick={() => choose(false)} style={{ flex:1, padding:"12px", borderRadius:12, border:"1px solid rgba(255,255,255,0.1)", background:"transparent", color:"#8B8FA8", fontWeight:700, fontSize:14, cursor:"pointer", fontFamily:"inherit" }}>Annuler</button>
          <button onClick={() => choose(true)} style={{ flex:1, padding:"12px", borderRadius:12, border:"none", background:"#7C6FE0", color:"#fff", fontWeight:700, fontSize:14, cursor:"pointer", fontFamily:"inherit" }}>Confirmer</button>
        </div>
      </div>
    </div>
  );
}

// ── PromptModal ──────────────────────────────────────────────────────
const _promptRef = { fn: null };
export async function showPrompt(msg, placeholder = "") {
  if (!_promptRef.fn) return window.prompt(msg);
  return _promptRef.fn(msg, placeholder);
}
export function PromptModal() {
  const [state, setState] = useState(null);
  const [val, setVal] = useState("");
  const resolveRef = useRef(null);
  useEffect(() => {
    _promptRef.fn = (msg, placeholder) => new Promise(resolve => { resolveRef.current = resolve; setState({ msg, placeholder }); setVal(""); });
    return () => { _promptRef.fn = null; };
  }, []);
  if (!state) return null;
  const choose = (v) => { setState(null); resolveRef.current?.(v); };
  return (
    <div onClick={() => choose(null)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", zIndex:10000, display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
      <div onClick={e => e.stopPropagation()} style={{ background:"#0D1B3E", borderRadius:20, padding:"28px 24px", width:"100%", maxWidth:380, border:"1px solid rgba(124,111,224,0.25)", boxShadow:"0 20px 60px rgba(0,0,0,0.6)" }}>
        <p style={{ color:"#F0F0F5", fontSize:15, lineHeight:1.6, margin:"0 0 16px", whiteSpace:"pre-wrap" }}>{state.msg}</p>
        <input
          type="text" value={val} onChange={e => setVal(e.target.value)}
          placeholder={state.placeholder || ""}
          onKeyDown={e => { if (e.key==="Enter") choose(val||null); if (e.key==="Escape") choose(null); }}
          autoFocus
          style={{ width:"100%", padding:"12px 14px", borderRadius:12, border:"1px solid rgba(124,111,224,0.3)", background:"#162547", color:"#F0F0F5", fontSize:14, fontFamily:"inherit", boxSizing:"border-box", marginBottom:16, outline:"none" }}
        />
        <div style={{ display:"flex", gap:10 }}>
          <button onClick={() => choose(null)} style={{ flex:1, padding:"12px", borderRadius:12, border:"1px solid rgba(255,255,255,0.1)", background:"transparent", color:"#8B8FA8", fontWeight:700, fontSize:14, cursor:"pointer", fontFamily:"inherit" }}>Annuler</button>
          <button onClick={() => choose(val||null)} style={{ flex:1, padding:"12px", borderRadius:12, border:"none", background:"#7C6FE0", color:"#fff", fontWeight:700, fontSize:14, cursor:"pointer", fontFamily:"inherit" }}>Envoyer</button>
        </div>
      </div>
    </div>
  );
}

// ── prestaCount singleton ────────────────────────────────────────────
let _prestaCountCache = null;
let _prestaCountPending = null;
export function fetchPrestaCount() {
  if (_prestaCountCache !== null) return Promise.resolve(_prestaCountCache);
  if (_prestaCountPending) return _prestaCountPending;
  _prestaCountPending = fetch("/api/prestataires?action=count")
    .then(r => r.json())
    .then(d => { _prestaCountCache = d.count ?? null; _prestaCountPending = null; return _prestaCountCache; })
    .catch(() => { _prestaCountPending = null; return null; });
  return _prestaCountPending;
}

// ═══════════════════════════════════════════════════════════════════════════
// Proposition de résolution d'un litige (CGPS art. 17.1)
// ═══════════════════════════════════════════════════════════════════════════
//
// ALANE propose, elle ne décide pas. La proposition n'engage les parties que
// si aucune des deux ne s'y oppose dans les 48 heures — et ce délai ne veut
// rien dire si personne ne voit passer la proposition ni ne dispose du moyen
// de s'y opposer.
//
// Ce bloc est donc la contrepartie visible de l'article : c'est lui qui fait
// du silence un accord. Il est partagé entre le client et le prestataire
// parce que les deux ont exactement le même droit, et qu'un bloc recopié
// finit par diverger — c'est déjà arrivé quatre fois sur les CGPS.
export function BlocPropositionResolution({ mission, onOppose }) {
  const [envoi, setEnvoi] = useState(false);
  if (!mission?.resolution_proposee) return null;

  const quoi = mission.resolution_proposee === "rembourser_client"
    ? "de vous rembourser / de rembourser le client"
    : "de verser la rémunération au prestataire";
  const opposee = !!mission.resolution_opposition_at;
  const echeance = mission.resolution_echeance_at ? new Date(mission.resolution_echeance_at) : null;
  const expire = echeance ? Date.now() >= echeance.getTime() : false;

  const opposer = async () => {
    if (!await showConfirm(
      "Vous opposer à cette proposition ?\n\nLes fonds resteront bloqués. ALANE ne pourra plus les débloquer sans un accord entre vous et l'autre partie, une décision de justice, ou une procédure de l'établissement de paiement."
    )) return;
    setEnvoi(true);
    try { await onOppose(); } finally { setEnvoi(false); }
  };

  return (
    <div style={{ background:"rgba(255,255,255,0.05)", border:`1px solid ${C.border}`, borderRadius:12, padding:"14px 16px", marginTop:12, fontSize:13, color:C.textSub, lineHeight:1.65 }}>
      <div style={{ fontWeight:800, color:C.text, fontSize:14, marginBottom:6 }}>📩 Proposition de résolution</div>
      <div>Après examen du litige, ALANE propose <strong style={{ color:C.text }}>{quoi}</strong>.</div>
      {mission.resolution_proposee === "rembourser_client" && (
        <div style={{ marginTop:6, color:C.textMuted }}>
          Le remboursement porte sur le prix de la prestation ; les frais de service restent acquis à ALANE (article 17.1 des CGPS).
        </div>
      )}
      {mission.resolution_motif && (
        <div style={{ marginTop:6, color:C.textMuted }}>Motif : {mission.resolution_motif}</div>
      )}

      {opposee ? (
        <div style={{ marginTop:10, color:C.danger, fontWeight:700 }}>
          ⛔ Une opposition a été enregistrée : les fonds restent bloqués. Le différend se poursuit entre les parties — médiation ou juridiction compétente (article 17 des CGPS).
        </div>
      ) : expire ? (
        <div style={{ marginTop:10, color:C.textMuted }}>
          Le délai d'opposition est écoulé : la proposition est réputée acceptée et son exécution est en cours.
        </div>
      ) : (
        <>
          <div style={{ marginTop:10 }}>
            Cette proposition ne tranche pas le litige et ne vous est pas imposée. Sans opposition de votre part
            {echeance ? <> avant le <strong style={{ color:C.text }}>{echeance.toLocaleString("fr-FR", { dateStyle:"long", timeStyle:"short" })}</strong></> : null},
            elle sera considérée comme acceptée par les deux parties et exécutée.
          </div>
          <button onClick={opposer} disabled={envoi}
            style={{ marginTop:12, width:"100%", padding:"11px", borderRadius:12, border:`1px solid ${C.danger}`, background:"transparent", color:C.danger, fontWeight:700, fontSize:13, cursor:envoi?"default":"pointer", fontFamily:"inherit", opacity:envoi?0.5:1 }}>
            {envoi ? "Enregistrement…" : "Je m'oppose à cette proposition"}
          </button>
          <div style={{ marginTop:6, fontSize:11, color:C.textMuted, textAlign:"center" }}>
            Aucune justification n'est demandée. Vos droits restent entiers.
          </div>
        </>
      )}
    </div>
  );
}
