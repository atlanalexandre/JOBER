import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase.js";
import { C, font, r } from "../constants/colors.js";
import { ABONNEMENTS_PRESTA, isLaunchPhase, prixClient, formatE } from "../constants/plans.js";
import { SECTORS, METIERS, METIERS_TARIFS, DOCS_REQUIS, docsRequisPour, JOURS, PLAGES, LANGUES_LIST, COMPETENCES_PAR_SECTEUR, COMPETENCES_PAR_METIER, cpToCoords, genMissionCode } from "../constants/data.js";
import { Btn, Badge, Input, StepHeader, Select, IbanInput, LaunchBadge, AddressAutocomplete, formatPhone, showToast, showConfirm, BlocPropositionResolution, ouvrirFacture } from "./ui.jsx";
import { fenetrePointage } from "../../api/_temps.js";

const ACCEPTED_TYPES = new Set(["application/pdf","image/jpeg","image/jpg","image/png","image/webp","image/heic","image/heif"]);
const ACCEPTED_EXTS  = new Set(["pdf","jpg","jpeg","png","webp","heic","heif"]);
const ACCEPT_ATTR    = ".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif";
const PENDING_DOCS_KEY = 'jober_pending_docs_v1';

// Ce que le prestataire perçoit réellement : tarif × heures × jours.
//
// Six copies d'une même formule privilégiaient `montant_total`, qui porte ce que le
// CLIENT a payé — frais de service d'ALANE compris. Tous les montants affichés au
// prestataire étaient donc surévalués : son revenu du mois, sa fiche de fin de
// prestation, son historique, ses totaux, et jusqu'à son export comptable. Pour un
// auto-entrepreneur qui déclare son chiffre d'affaires à partir de cet export, cela
// revenait à déclarer un revenu jamais encaissé.
//
// Les heures réellement effectuées priment sur les heures prévues.
// Volontairement non exportée : exporter une fonction depuis un fichier de
// composants casse le rafraîchissement à chaud (react-refresh).
function montantPrestataire(m) {
  // Une prestation clôturée porte le montant exact qui lui sera versé, figé par
  // le serveur (`payout_amount`). Il fait foi : le recalcul ci-dessous ignore le
  // plafonnement des heures appliqué quand un décalage d'horaire n'a jamais été
  // arbitré, et afficherait donc plus que ce que le prestataire touchera.
  if (m?.payout_amount != null) return Number(m.payout_amount);
  const heures = Number(m?.actual_hours ?? m?.hours ?? 0);
  const tarif  = Number(m?.tarif_horaire || 0);
  const jours  = (m?.date_debut && m?.date_fin)
    ? Math.max(1, Math.round((new Date(m.date_fin) - new Date(m.date_debut)) / 86400000) + 1)
    : 1;
  // Une prolongation acceptée est payée au tarif que le prestataire a annoncé,
  // pas au tarif de la commande. Même découpage que `partHoraire` dans
  // api/_cloture.js, qui fait foi : les deux doivent rester alignés.
  const supp = Math.min(heures, Math.max(0, Number(m?.extra_hours_appliquees) || 0));
  const tarifSupp = Number(m?.extra_hours_tarif) > 0 ? Number(m.extra_hours_tarif) : tarif;
  return Math.round(((heures - supp) * tarif + supp * tarifSupp) * jours * 100) / 100;
}

function validateDocSync(file) {
  const ext = file.name ? file.name.split(".").pop().toLowerCase() : "";
  if (!ACCEPTED_TYPES.has(file.type) && !ACCEPTED_EXTS.has(ext)) {
    return "Format non accepté — envoyez un PDF ou une photo (JPG, PNG, HEIC).";
  }
  if (file.size > 10 * 1024 * 1024) return "Fichier trop lourd (max 10 Mo).";
  if (file.size < 1 * 1024) return "Fichier trop petit — vérifiez que c'est le bon document.";
  return null;
}

async function validateDoc(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  if (!ACCEPTED_TYPES.has(file.type) && !ACCEPTED_EXTS.has(ext)) {
    return "Format non accepté — envoyez un PDF ou une photo (JPG, PNG, HEIC).";
  }
  if (file.size > 10 * 1024 * 1024) return "Fichier trop lourd (max 10 Mo).";
  if (file.size < 1 * 1024) return "Fichier trop petit — vérifiez que c'est le bon document.";

  if (file.type === "application/pdf" || ext === "pdf") {
    try {
      const buf = await file.slice(0, 5).arrayBuffer();
      const header = String.fromCharCode(...new Uint8Array(buf));
      if (!header.startsWith("%PDF")) return "PDF corrompu ou illisible — régénérez-le ou envoyez une photo du document.";
    } catch { /* ignore — laisser passer si ArrayBuffer indisponible */ }
    return null;
  }

  // Pas de test <img> : URL.createObjectURL échoue silencieusement sur iOS Safari
  // pour les photos de la pellicule (HEIC déguisés en JPEG, Live Photos…).
  // Les vérifications type/taille sont suffisantes ; le serveur rejette les fichiers invalides.

  return null;
}

async function notifyDocUpload(docType, isRenewal = false) {
  try {
    const { data: sd } = await supabase.auth.getSession();
    const token = sd?.session?.access_token;
    if (!token) return;
    fetch("/api/notify-doc", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ docType, isRenewal }),
    }).catch(() => {});
  } catch { /* ignore */ }
}

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



// ── Se faire remplacer (CGPS art. 9) ────────────────────────────────────────
//
// Un salarié ne peut jamais envoyer quelqu'un à sa place ; un prestataire de
// services le peut, parce que le contrat porte sur un service et non sur sa
// personne. Ce droit figurait dans les CGPS sans exister dans le produit : la
// seule issue était l'annulation, qui renvoyait la prestation à la place de
// marché sans que le sortant n'ait son mot à dire.
//
// Le sortant choisit dans une liste fermée, il ne saisit pas d'identifiant : le
// serveur ne propose que des professionnels du bon métier, libres sur le créneau
// et dont le tarif tient dans la commande.
function RemplacementModal({ missionId, onClose, onEnvoye }) {
  const [candidats, setCandidats] = useState(null);   // null = chargement
  const [erreur, setErreur]       = useState(null);
  const [choisi, setChoisi]       = useState(null);
  const [motif, setMotif]         = useState("");
  const [envoi, setEnvoi]         = useState(false);

  useEffect(() => {
    let vivant = true;
    (async () => {
      try {
        const { data: sd } = await supabase.auth.getSession();
        const r = await fetch("/api/missions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${sd?.session?.access_token || ""}` },
          body: JSON.stringify({ action: "remplacants_possibles", mission_id: missionId }),
        });
        const j = await r.json().catch(() => ({}));
        if (!vivant) return;
        if (!r.ok) { setErreur(j.error || "Liste indisponible."); setCandidats([]); return; }
        setCandidats(Array.isArray(j.candidats) ? j.candidats : []);
      } catch {
        if (vivant) { setErreur("Connexion impossible."); setCandidats([]); }
      }
    })();
    return () => { vivant = false; };
  }, [missionId]);

  const envoyer = async () => {
    if (!choisi || envoi) return;
    setEnvoi(true);
    try {
      const { data: sd } = await supabase.auth.getSession();
      const r = await fetch("/api/missions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${sd?.session?.access_token || ""}` },
        body: JSON.stringify({ action: "proposer_remplacant", mission_id: missionId, remplacant_id: choisi, motif: motif.trim() || null }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { showToast(j.error || "La demande n'a pas pu être envoyée."); setEnvoi(false); return; }
      onEnvoye();
    } catch {
      showToast("Envoi impossible — vérifiez votre connexion.");
      setEnvoi(false);
    }
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.85)", zIndex:9999, display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ background:"#0D1B3E", borderRadius:20, padding:24, margin:20, maxWidth:520, width:"100%", maxHeight:"85vh", display:"flex", flexDirection:"column" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6, flexShrink:0 }}>
          <h3 style={{ color:C.violet, fontSize:16, fontWeight:800, margin:0, fontFamily:font.display }}>Me faire remplacer</h3>
          <button onClick={onClose} style={{ background:"transparent", border:"none", color:C.textSub, cursor:"pointer", fontSize:20, lineHeight:1, padding:"0 4px" }}>×</button>
        </div>
        <div style={{ color:C.textSub, fontSize:12, lineHeight:1.6, marginBottom:14, flexShrink:0 }}>
          Vous proposez à un confrère indépendant de reprendre cette prestation.
          Le remplacement n&apos;a lieu que si <strong style={{ color:C.text }}>le confrère et le client
          l&apos;acceptent tous les deux</strong>. Tant que ce n&apos;est pas le cas, la prestation
          reste à votre charge. Vous restez responsable de la bonne exécution devant le client.
        </div>

        <div style={{ overflowY:"auto", flex:1, marginBottom:14, WebkitOverflowScrolling:"touch" }}>
          {candidats === null && <div style={{ color:C.textSub, fontSize:13, textAlign:"center", padding:"20px 0" }}>Recherche de confrères disponibles…</div>}
          {candidats !== null && candidats.length === 0 && (
            <div style={{ background:"rgba(255,255,255,0.04)", borderRadius:10, padding:"14px 12px", textAlign:"center" }}>
              <div style={{ color:C.text, fontSize:13, fontWeight:700, marginBottom:4 }}>Aucun confrère disponible</div>
              <div style={{ color:C.textSub, fontSize:12, lineHeight:1.5 }}>
                {erreur || "Personne ne correspond au métier et au créneau pour l'instant. Vous pouvez réessayer plus tard ou annuler la prestation."}
              </div>
            </div>
          )}
          {(candidats || []).map(c => (
            <button key={c.id} onClick={() => setChoisi(c.id)}
              style={{ width:"100%", textAlign:"left", display:"flex", alignItems:"center", gap:12, padding:"11px 12px", marginBottom:8, borderRadius:12, cursor:"pointer", fontFamily:"inherit",
                       border:`1px solid ${choisi===c.id ? C.violet : "rgba(255,255,255,0.12)"}`,
                       background: choisi===c.id ? "rgba(124,111,224,0.15)" : "rgba(255,255,255,0.03)" }}>
              <div style={{ width:34, height:34, borderRadius:"50%", background:C.violet, color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:800, fontSize:14, flexShrink:0 }}>
                {(c.prenom || "?").slice(0,1).toUpperCase()}
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ color:C.text, fontWeight:700, fontSize:13 }}>{c.prenom}{c.initiale ? ` ${c.initiale}.` : ""}</div>
                <div style={{ color:C.textSub, fontSize:11 }}>{c.metier || "Professionnel qualifié"}{c.note ? ` · ★ ${Number(c.note).toFixed(1)}` : ""}</div>
              </div>
              {choisi===c.id && <span style={{ color:C.violet, fontWeight:800, fontSize:16 }}>✓</span>}
            </button>
          ))}
        </div>

        {candidats !== null && candidats.length > 0 && (
          <div style={{ flexShrink:0 }}>
            <textarea value={motif} onChange={e => setMotif(e.target.value.slice(0, 500))}
              placeholder="Motif communiqué au client (facultatif) — ex. empêchement familial"
              rows={2}
              style={{ width:"100%", padding:"10px 12px", borderRadius:10, border:"1px solid rgba(255,255,255,0.12)", background:"rgba(255,255,255,0.04)", color:C.text, fontSize:13, fontFamily:"inherit", resize:"vertical", marginBottom:12 }} />
            <button disabled={!choisi || envoi} onClick={envoyer}
              style={{ width:"100%", padding:"13px", borderRadius:12, border:"none", background:C.violet, color:"#fff", fontWeight:800, fontSize:15, fontFamily:"inherit",
                       cursor:(!choisi||envoi)?"not-allowed":"pointer", opacity:(!choisi||envoi)?0.4:1 }}>
              {envoi ? "Envoi…" : "Proposer ce remplaçant →"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2-lat1)*Math.PI/180;
  const dLon = (lon2-lon1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return +(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))).toFixed(1);
}

function DocRowItem({ doc, isSent, isVerified, onUploaded }) {
  const [renewed, setRenewed] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [pendingFile, setPendingFile] = useState(null);
  const fileInputRef = useRef(null);
  // Trois états distincts. « Envoyé » n'est pas « validé » : le backoffice doit
  // encore examiner le document, et il peut le refuser. Un document renvoyé
  // (renewed) repart toujours en attente de vérification.
  const sent     = isSent || renewed;
  const verified = isVerified && !renewed;

  // Étape 1 : sélection du fichier — AUCUN réseau, juste stocker le fichier en mémoire.
  // iOS ne peut pas interférer avec des opérations purement locales.
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!file) return;
    const validErr = validateDocSync(file);
    if (validErr) { setUploadError(validErr); return; }
    setUploadError(null);
    setPendingFile(file);
  };

  // Étape 2 : envoi — déclenché par un clic bouton, contexte réseau normal (pas file-picker).
  // iOS ne restreint PAS les fetch initiés depuis un événement click standard.
  const handleSend = async () => {
    if (!pendingFile) return;
    const file = pendingFile;
    setPendingFile(null);
    setUploading(true);
    setUploadError(null);
    try {
      const { data: sd } = await supabase.auth.getSession();
      const at = sd?.session?.access_token || "";
      let userId;
      try { userId = JSON.parse(atob(at.split(".")[1].replace(/-/g,"+").replace(/_/g,"/")))?.sub; } catch { /* JWT illisible → userId reste undefined, rejeté juste après */ }
      if (!userId || !at) throw new Error("Session expirée — reconnectez-vous.");

      // Nom stable par (prestataire, type) : un remplacement écrase le fichier
      // précédent au lieu d'en accumuler. Pas d'extension : le Content-Type stocké
      // suffit à l'affichage (les URLs signées du BO ignorent l'extension).
      const storagePath = `${userId}/${doc.id}`;
      const SB_URL = import.meta.env.VITE_SUPABASE_URL;
      const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

      // Storage upload — x-upsert écrase le fichier existant (même chemin)
      const upRes = await fetch(`${SB_URL}/storage/v1/object/Documents/${storagePath}`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${at}`, "apikey": SB_KEY, "x-upsert": "true", "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!upRes.ok) {
        const err = await upRes.json().catch(() => ({}));
        throw new Error("Erreur upload: " + (err.message || err.error || upRes.status));
      }

      // Upsert sur (prestataire_id, type) — met à jour la ligne existante
      const { error: dbErr } = await supabase.from("documents").upsert({ prestataire_id: userId, type: doc.id, storage_path: storagePath, verified: false }, { onConflict: "prestataire_id,type" });
      if (dbErr) {
        try {
          const pending = JSON.parse(localStorage.getItem(PENDING_DOCS_KEY)||'[]');
          pending.push({ uid: userId, type: doc.id, sp: storagePath });
          localStorage.setItem(PENDING_DOCS_KEY, JSON.stringify(pending));
        } catch { /* localStorage indisponible (Safari privé) → pas de réessai, l'erreur ci-dessous suffit */ }
        throw new Error("Erreur sauvegarde: " + (dbErr.message || dbErr.hint || dbErr.code));
      }

      notifyDocUpload(doc.id, true);
      setRenewed(true);
      onUploaded?.(doc.id);
    } catch (err) {
      setUploadError(err?.message || "Erreur lors de l'envoi. Réessayez.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div style={{ marginBottom:8 }}>
      <div style={{ background:"#0D1B3E", borderRadius:13, padding:"12px", display:"flex", gap:10, alignItems:"center", border:`1px solid ${uploadError?C.danger+"60":verified?C.border:C.accent+"30"}` }}>
        <input ref={fileInputRef} type="file" accept={ACCEPT_ATTR} style={{ display:"none" }} onChange={handleFileChange} />
        <div style={{ width:38, height:38, borderRadius:10, background:verified?`${C.success}18`:`${C.accent}15`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 }}>{doc.icon}</div>
        <div style={{ flex:1 }}>
          <div style={{ fontWeight:700, color:C.text, fontSize:12 }}>{doc.label}</div>
          <div style={{ color:verified?C.success:(pendingFile||sent?C.accentGold:C.textSub), fontSize:11, fontWeight:verified?700:400 }}>
            {verified ? "✓ Validé"
              : pendingFile ? (pendingFile.name||"Fichier prêt")
              : sent ? "⏳ En cours de vérification"
              : (doc.required===false?"Recommandé":"En attente")}
          </div>
        </div>
        <div style={{ display:"flex", gap:6, alignItems:"center" }}>
          {!pendingFile && (
            <button onClick={()=>{ setUploadError(null); fileInputRef.current?.click(); }} disabled={uploading}
              style={{ padding:"4px 10px", borderRadius:8, border:`1px solid ${C.violet}`, background:"transparent", color:C.violet, fontSize:10, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
              {sent ? "Remplacer" : "+ Charger"}
            </button>
          )}
          {pendingFile && !uploading && (
            <>
              <button onClick={handleSend}
                style={{ padding:"4px 10px", borderRadius:8, border:"none", background:C.violet, color:"#fff", fontSize:10, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
                Envoyer
              </button>
              <button onClick={()=>setPendingFile(null)}
                style={{ padding:"4px 8px", borderRadius:8, border:`1px solid ${C.border}`, background:"transparent", color:C.textSub, fontSize:10, cursor:"pointer", fontFamily:"inherit" }}>
                ✕
              </button>
            </>
          )}
          {uploading && <span style={{ fontSize:10, color:C.textSub }}>Envoi…</span>}
          {verified && !pendingFile && (
            <Badge color={C.success} small>OK</Badge>
          )}
          {sent && !verified && !pendingFile && (
            <Badge color={C.accentGold} small>À vérifier</Badge>
          )}
          {!sent && !pendingFile && (
            <Badge color={doc.required===false?C.textSub:C.accent} small>{doc.required===false?"Optionnel":"Requis"}</Badge>
          )}
        </div>
      </div>
      {uploadError && (
        <div style={{ background:`${C.danger}15`, border:`1px solid ${C.danger}44`, borderRadius:8, padding:"6px 10px", marginTop:4, fontSize:11, color:C.danger, fontWeight:600 }}>
          ⚠️ {uploadError}
        </div>
      )}
    </div>
  );
}

export function DocUploadCard({ doc, value, onChange, required }) {
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState(null);
  const inputRef = useRef(null);
  const loaded = !!value;

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadErr(null);
    const validErr = await validateDoc(file);
    if (validErr) { setUploadErr(validErr); if (inputRef.current) inputRef.current.value = ""; return; }
    setUploading(true);
    try {
      await onChange(file);
    } catch (err) {
      setUploadErr(err?.message || "Échec de l'envoi — réessayez.");
      if (inputRef.current) inputRef.current.value = "";
    } finally {
      setUploading(false);
    }
  };

  const acceptAttr = doc.id === "photo" ? "image/*" : ACCEPT_ATTR;

  return (
    <div style={{ marginBottom:9 }}>
      <div style={{ background:"#0D1B3E", borderRadius:r, padding:"13px", border:`2px solid ${uploadErr?C.danger:loaded?C.success:C.grayLight}`, display:"flex", gap:11, alignItems:"flex-start" }}>
        <input ref={inputRef} type="file" accept={acceptAttr} style={{ display:"none" }} onChange={handleFile} />
        <div style={{ width:40, height:40, borderRadius:11, background:loaded?`${C.success}18`:C.grayLight, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0 }}>{doc.icon}</div>
        <div style={{ flex:1 }}>
          <div style={{ fontWeight:700, color:C.text, fontSize:13 }}>{doc.label}</div>
          <div style={{ color:C.textSub, fontSize:11, marginTop:2 }}>{doc.info}</div>
          <button onClick={()=>inputRef.current?.click()} disabled={uploading} style={{ marginTop:6, background:"none", border:"none", color:loaded?C.success:C.violet, fontSize:12, fontWeight:700, cursor:"pointer", padding:0, fontFamily:"inherit" }}>
            {uploading ? "Envoi…" : loaded ? "✓ Chargé — Remplacer" : "+ Charger le fichier"}
          </button>
        </div>
        <Badge color={required?C.accent:C.gray} small>{required?"Obligatoire":"Optionnel"}</Badge>
      </div>
      {uploadErr && (
        <div style={{ background:`${C.danger}15`, border:`1px solid ${C.danger}44`, borderRadius:8, padding:"6px 10px", marginTop:4, fontSize:11, color:C.danger, fontWeight:600 }}>
          ⚠️ {uploadErr}
        </div>
      )}
    </div>
  );
}


export function PrestaOnboarding({ onComplete, onBack }) {
  const [step,setStep]=useState(1);
  const TOTAL=8;
  const [infos,setInfos]=useState({prenom:"",nom:"",email:"",tel:"",password:"",dateNaissance:"",lieuNaissance:"",nationalite:"France",nif:"",residenceFiscale:"France"});
  const [adresse,setAdresse]=useState({rue:"",ville:"",cp:"",pays:"France",rayon:"20"});
  const [ae,setAe]=useState({siret:"",siren:"",activite:"",dateCreation:"",codeAPE:"",regime:"micro-entreprise"});
  const [siretStatus,setSiretStatus]=useState(null); // null | "loading" | "ok" | "error"
  const siretTimerRef=useRef(null);
  const handleSiretChange=(v)=>{
    const clean=v.replace(/\D/g,"").slice(0,14);
    setAe(prev=>({...prev,siret:clean,siren:clean.slice(0,9)}));
    setSiretStatus(null);
    clearTimeout(siretTimerRef.current);
    if(clean.length===14){
      setSiretStatus("loading");
      siretTimerRef.current=setTimeout(async()=>{
        try{
          const res=await fetch(`https://api.annuaire-entreprises.data.gouv.fr/entreprise/${clean.slice(0,9)}`);
          if(!res.ok){setSiretStatus("error");return;}
          const d=await res.json();
          setSiretStatus("ok");
          setAe(prev=>({
            ...prev,
            siren:clean.slice(0,9),
            activite:prev.activite||d.libelle_activite_principale||"",
            codeAPE:prev.codeAPE||d.activite_principale||"",
            dateCreation:prev.dateCreation||d.date_creation||"",
          }));
        }catch{setSiretStatus("error");}
      },600);
    }
  };
  const [docs,setDocs]=useState({});
  const [metiers,setMetiers]=useState([]);
  const [newMetier,setNewMetier]=useState({sector:"",metier:"",niveau:"Confirmé",certifs:"",tarifNet:12});
  const [langues,setLangues]=useState(["Français"]);
  const [bio,setBio]=useState("");
  const [dispos,setDispos]=useState({});
  const [prefs,setPrefs]=useState({contrat:"Journée complète",tarifMin:"12",vehicule:false,permis:false,mobilite:"20"});
  const [showGuide,setShowGuide]=useState(false);
  const [choixAE,setChoixAE]=useState(null);
  const [abonnement,setAbonnement]=useState("free");
  const [justAdded,setJustAdded]=useState(false);

  const toggleDispo=(jour,plage)=>setDispos(prev=>{const curr=prev[jour]||[];const next=curr.includes(plage)?curr.filter(p=>p!==plage):[...curr,plage];return{...prev,[jour]:next};});
  const justAddedRef = useRef(null);
  const addMetier=()=>{
    if(!newMetier.sector||!newMetier.metier)return;
    setMetiers(prev=>[...prev,{...newMetier,id:Date.now()}]);
    setNewMetier({sector:"",metier:"",niveau:"Confirmé",certifs:"",tarifNet:12});
    setJustAdded(true);
    clearTimeout(justAddedRef.current);
    justAddedRef.current=setTimeout(()=>setJustAdded(false),1500);
  };
  const toggleLangue=(l)=>setLangues(prev=>prev.includes(l)?prev.filter(x=>x!==l):[...prev,l]);
  const [submitting,setSubmitting]=useState(false);
  const [submitError,setSubmitError]=useState("");
  const [cguAccepted,setCguAccepted]=useState(false);
  // La liste dépend de la nationalité : le titre de séjour n'est exigé que des
  // ressortissants hors UE.
  const docsAttendus=docsRequisPour(infos.nationalite);
  const docsOk=docsAttendus.filter(d=>d.required).every(d=>docs[d.id]);
  const dispoStep=6;
  const recapStep=8;

  const handleSubmitDossier=async()=>{
    setSubmitting(true);
    setSubmitError("");
    try {
      const { data, error:authErr } = await supabase.auth.getUser();
      if(authErr || !data?.user) throw new Error("Session expirée, reconnectez-vous");
      const user = data.user;
      const existingMeta = user.user_metadata || {};

      // Update profiles table for prenom/nom
      await supabase.from("profiles").update({ prenom:infos.prenom, nom:infos.nom }).eq("id",user.id);

      // Store everything else in user_metadata (merge with existing to not overwrite rib/role/etc.)
      await supabase.auth.updateUser({
        data: {
          ...existingMeta,
          prenom: infos.prenom,
          nom: infos.nom,
          telephone: infos.tel || existingMeta.telephone,
          ae_siret: ae.siret,
          ae_siren: ae.siren,
          ae_activite: ae.activite,
          ae_dateCreation: ae.dateCreation,
          ae_codeAPE: ae.codeAPE,
          ae_regime: ae.regime,
          adresse: adresse.rue,
          ville: adresse.ville,
          cp: adresse.cp,
          zone_km: parseInt(adresse.rayon) || 20,
          bio,
          secteur: metiers[0]?.sector || existingMeta.secteur,
          metiers_list: metiers.map(m => ({ sector: m.sector, metier: m.metier, niveau: m.niveau, tarifNet: m.tarifNet, certifs: m.certifs })),
          tarif_net: metiers[0]?.tarifNet || existingMeta.tarif_net,
          langues,
          dispon_jours_creneaux: dispos,
          plan_abonnement: abonnement !== "free" ? abonnement : (existingMeta.plan_abonnement || "free"),
          dossier_soumis: true,
          // Nationalité et numéro fiscal : la première détermine si un titre de
          // séjour est exigé, le second est une donnée déclarable au titre de
          // DAC7. Elles n'étaient conservées nulle part.
          nationalite: infos.nationalite,
          nif: infos.nif || null,
        },
      });
      // `profiles` porte les données fiscales : c'est la table que lit l'export
      // DAC7. Les écrire dans les seules métadonnées les rendrait invisibles au
      // moment où il faut déclarer.
      const { data: uNow } = await supabase.auth.getUser();
      if (uNow?.user?.id) {
        const { error: fiscalErr } = await supabase.from("profiles").update({
          nif: infos.nif || null,
          nif_collecte_at: infos.nif ? new Date().toISOString() : null,
          residence_fiscale: infos.residenceFiscale === "France" ? "FR" : null,
        }).eq("id", uNow.user.id);
        // Journalisé, non bloquant : le dossier est déjà envoyé, et l'export
        // signale de toute façon les données manquantes.
        if (fiscalErr) console.error("[onboarding] données fiscales non enregistrées :", fiscalErr.message);
      }
    } catch(e){
      setSubmitError("Une erreur est survenue lors de l'envoi. Réessayez.");
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
    onComplete();
  };
  const stepValid=()=>{
    if(step===1)return infos.prenom&&infos.nom&&infos.email&&infos.tel&&infos.password&&infos.nif;
    if(step===2)return adresse.rue&&adresse.ville&&adresse.cp;
    if(step===3)return ae.siret&&ae.siren&&ae.activite;
    if(step===4)return true;
    if(step===5)return true;
    if(step===dispoStep)return Object.keys(dispos).some(j=>(dispos[j]||[]).length>0);
    if(step===7)return true;
    return true;
  };
  const TITLES=["Informations personnelles","Adresse & zone","Statut auto-entrepreneur","Documents administratifs","Métiers & compétences","Disponibilités","Votre abonnement","Récapitulatif"];
  const SUBS=["Vos coordonnées","Résidence et intervention","Informations légales","Obligatoires pour valider","Vos savoir-faire","Vos créneaux","Choisissez votre plan","Vérifiez avant envoi"];

  return (
    <div style={{ minHeight:"100%", background:C.bg, paddingBottom:100 }}>
      <StepHeader step={step} total={TOTAL} title={TITLES[step-1]} subtitle={SUBS[step-1]} onBack={step===1?onBack:()=>setStep(s=>s-1)} />
      <div style={{ padding:"22px 18px" }}>
        {step===1 && <>
          <div style={{ display:"flex", gap:10 }}><div style={{ flex:1 }}><Input label="Prénom *" placeholder="Jean" value={infos.prenom} onChange={e=>setInfos({...infos,prenom:e.target.value})} /></div><div style={{ flex:1 }}><Input label="Nom *" placeholder="Dupont" value={infos.nom} onChange={e=>setInfos({...infos,nom:e.target.value})} /></div></div>
          <Input label="Email *" type="email" placeholder="jean@exemple.fr" icon="✉️" value={infos.email} onChange={e=>setInfos({...infos,email:e.target.value})} />
          <Input label="Téléphone *" placeholder="06 12 34 56 78" icon="📱" value={infos.tel} onChange={e=>setInfos({...infos,tel:formatPhone(e.target.value)})} />
          <Input label="Mot de passe *" type="password" placeholder="Minimum 8 caractères" icon="🔒" value={infos.password} onChange={e=>setInfos({...infos,password:e.target.value})} />
          <Input label="Date de naissance" type="date" placeholder="AAAA-MM-JJ" value={infos.dateNaissance} onChange={e=>setInfos({...infos,dateNaissance:e.target.value})} />
          <Input label="Lieu de naissance" placeholder="Paris" value={infos.lieuNaissance} onChange={e=>setInfos({...infos,lieuNaissance:e.target.value})} />
          <Select label="Nationalité" options={["France","Autre UE","Hors UE"]} value={infos.nationalite} onChange={e=>setInfos({...infos,nationalite:e.target.value})} />
          {/* Numéro fiscal — exigé de l'opérateur de plateforme par la directive
              DAC7 (art. 1649 ter A du CGI), qui lui impose de déclarer chaque
              année l'identité de ses prestataires et les sommes versées. Il est
              distinct du SIRET, et rien ne le collectait. */}
          <Input label="Numéro fiscal (NIF)" placeholder="13 chiffres" icon="🧾"
            value={infos.nif} onChange={e=>setInfos({...infos,nif:e.target.value.replace(/\s/g,"")})}
            hint="Figure sur votre avis d'imposition. Obligatoire : ALANE doit déclarer chaque année vos revenus à l'administration fiscale." />
          {/* La résidence fiscale ne se déduit pas de la nationalité : un
              Français peut résider fiscalement ailleurs, et l'inverse. On la
              demande plutôt que de l'inventer. */}
          <Select label="Pays de résidence fiscale" options={["France","Autre pays"]}
            value={infos.residenceFiscale} onChange={e=>setInfos({...infos,residenceFiscale:e.target.value})} />
          <div style={{ background:`${C.violet}10`, border:`1px solid ${C.violet}33`, borderRadius:12, padding:"12px 14px", marginBottom:16 }}>
            <div style={{ fontWeight:700, color:C.text, fontSize:13, marginBottom:8 }}>📸 Photo de profil</div>
            <div style={{ display:"flex", gap:10 }}>
              <div style={{ flex:1, background:"#0D1B3E", border:`2px dashed ${C.grayLight}`, borderRadius:12, padding:"14px", textAlign:"center", cursor:"pointer" }}><div style={{ fontSize:24 }}>📷</div><div style={{ fontSize:11, color:C.textSub, marginTop:4 }}>Prendre</div></div>
              <div style={{ flex:1, background:"#0D1B3E", border:`2px dashed ${C.grayLight}`, borderRadius:12, padding:"14px", textAlign:"center", cursor:"pointer" }}><div style={{ fontSize:24 }}>🖼️</div><div style={{ fontSize:11, color:C.textSub, marginTop:4 }}>Galerie</div></div>
            </div>
          </div>
        </>}
        {step===2 && <>
          <AddressAutocomplete label="Adresse *" value={adresse.rue} onChange={v=>setAdresse({...adresse,rue:v})} onSelect={s=>setAdresse({...adresse,rue:s.rue,ville:s.ville,cp:s.codePostal})} />
          <div style={{ display:"flex", gap:10 }}><div style={{ flex:2 }}><Input label="Ville *" placeholder="Paris" value={adresse.ville} onChange={e=>setAdresse({...adresse,ville:e.target.value})} /></div><div style={{ flex:1 }}><Input label="CP *" placeholder="75001" value={adresse.cp} onChange={e=>setAdresse({...adresse,cp:e.target.value})} /></div></div>
          <Select label="Pays" options={["France","Belgique","Suisse","Luxembourg"]} value={adresse.pays} onChange={e=>setAdresse({...adresse,pays:e.target.value})} />
          <div style={{ background:"#0D1B3E", borderRadius:16, padding:"16px", boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
            <div style={{ fontWeight:800, color:C.text, fontSize:14, marginBottom:4 }}>🗺️ Rayon d'intervention</div>
            <p style={{ color:C.textSub, fontSize:12, margin:"0 0 12px" }}>Distance max pour une prestation</p>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
              {["5","10","20","30","50","100"].map(km=><button key={km} onClick={()=>setAdresse({...adresse,rayon:km})} style={{ padding:"9px 16px", borderRadius:20, border:"none", cursor:"pointer", background:adresse.rayon===km?C.violet:C.grayLight, color:adresse.rayon===km?C.white:C.text, fontWeight:700, fontSize:13, fontFamily:"inherit" }}>{km} km</button>)}
            </div>
            <p style={{ color:C.violet, fontSize:12, fontWeight:700, marginTop:10 }}>Zone : {adresse.rayon} km autour de chez vous</p>
          </div>
        </>}
        {step===3 && <>
          <div style={{ background:`${C.accentGold}15`, border:`1px solid ${C.accentGold}55`, borderRadius:r, padding:"14px", marginBottom:18, fontSize:13, lineHeight:1.5 }}>⚠️ <strong>Auto-entrepreneur obligatoire</strong><br/><span style={{ color:C.textSub }}>ALANE travaille exclusivement avec des AE. Vos infos seront vérifiées.</span></div>
          <div style={{ marginBottom:16 }}>
            <label style={{ display:"block", fontSize:11, color:C.textSub, marginBottom:7, fontWeight:600, letterSpacing:0.8, textTransform:"uppercase" }}>N° SIRET *</label>
            <div style={{ position:"relative" }}>
              <span style={{ position:"absolute", left:14, top:"50%", transform:"translateY(-50%)", fontSize:16, opacity:0.5 }}>🔢</span>
              <input type="text" inputMode="numeric" placeholder="12345678900010" value={ae.siret} onChange={e=>handleSiretChange(e.target.value)} autoComplete="off"
                style={{ width:"100%", padding:"13px 44px 13px 44px", borderRadius:r, border:`1px solid ${siretStatus==="error"?"#F25E5E55":siretStatus==="ok"?"#10D98F55":C.border}`, fontSize:14, fontFamily:"inherit", color:C.text, background:"#112240", outline:"none", boxSizing:"border-box", transition:"border 0.2s" }} />
              {siretStatus==="loading" && <span style={{ position:"absolute", right:14, top:"50%", transform:"translateY(-50%)", fontSize:13, color:C.textSub }}>⏳</span>}
              {siretStatus==="ok"      && <span style={{ position:"absolute", right:14, top:"50%", transform:"translateY(-50%)", fontSize:15 }}>✅</span>}
              {siretStatus==="error"   && <span style={{ position:"absolute", right:14, top:"50%", transform:"translateY(-50%)", fontSize:15 }}>❌</span>}
            </div>
            {siretStatus==="ok"    && <p style={{ fontSize:11, color:"#10D98F", margin:"5px 0 0 2px" }}>Entreprise trouvée — infos auto-remplies ✓</p>}
            {siretStatus==="error" && <p style={{ fontSize:11, color:"#F25E5E", margin:"5px 0 0 2px" }}>SIRET introuvable — vérifiez le numéro</p>}
            {siretStatus===null    && <p style={{ fontSize:11, color:C.textMuted, margin:"5px 0 0 2px" }}>14 chiffres — visible sur votre extrait KBIS</p>}
          </div>
          <Input label="N° SIREN" placeholder="XXX XXX XXX" icon="🏢" value={ae.siren} onChange={e=>setAe({...ae,siren:e.target.value})} hint="Auto-rempli depuis le SIRET" />
          <Input label="Activité déclarée *" placeholder="Prestation de services…" value={ae.activite} onChange={e=>setAe({...ae,activite:e.target.value})} />
          <Input label="Code APE / NAF" placeholder="7022Z" value={ae.codeAPE} onChange={e=>setAe({...ae,codeAPE:e.target.value})} />
          <Input label="Date de création" type="date" placeholder="AAAA-MM-JJ" value={ae.dateCreation} onChange={e=>setAe({...ae,dateCreation:e.target.value})} />
          <Select label="Régime fiscal" options={["micro-entreprise","entreprise individuelle","autre"]} value={ae.regime} onChange={e=>setAe({...ae,regime:e.target.value})} />
          {/* Guide création micro-entreprise */}
          <div onClick={()=>setShowGuide(!showGuide)} style={{ background:showGuide?C.violet+"14":"rgba(255,255,255,0.04)", border:`1px solid ${showGuide?C.violet+"55":C.border}`, borderRadius:r, padding:"13px 15px", marginBottom:12, cursor:"pointer", display:"flex", alignItems:"center", gap:12 }}>
            <div style={{ width:38, height:38, borderRadius:11, background:C.violet+"20", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0 }}>🚀</div>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:700, color:C.text, fontSize:13 }}>Pas encore auto-entrepreneur ?</div>
              <div style={{ color:C.textSub, fontSize:12 }}>Créez votre micro-entreprise en 24h — on vous guide</div>
            </div>
            <span style={{ color:C.violet, fontSize:18, display:"inline-block", transform:showGuide?"rotate(90deg)":"none", transition:"transform 0.2s" }}>›</span>
          </div>
          {showGuide && (
            <div style={{ marginBottom:14 }}>
              {[
                { id:"legalstart", nom:"LegalStart",        logo:"⚖️", color:"#4F46E5", badge:"Recommandé", info:"0€ · SIRET en 48h · Validation juridique incluse", lien:"https://www.legalstart.fr/micro-entreprise/" },
                { id:"urssaf",     nom:"URSSAF (officiel)", logo:"🏛️", color:"#059669", badge:"100% gratuit", info:"Gratuit · Site officiel de l’État · SIRET 24h", lien:"https://www.autoentrepreneur.urssaf.fr/" },
              ].map(p=>(
                <div key={p.id} onClick={()=>setChoixAE(choixAE===p.id?null:p.id)} style={{ background:choixAE===p.id?p.color+"15":"#0D1B3E", border:`2px solid ${choixAE===p.id?p.color:C.border}`, borderRadius:r+2, padding:"13px", marginBottom:8, cursor:"pointer" }}>
                  <div style={{ display:"flex", gap:10, alignItems:"center" }}>
                    <div style={{ width:40, height:40, borderRadius:11, background:p.color+"20", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>{p.logo}</div>
                    <div style={{ flex:1 }}>
                      <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:2 }}>
                        <span style={{ fontWeight:700, color:C.text, fontSize:14 }}>{p.nom}</span>
                        <span style={{ background:p.color+"22", color:p.color, fontSize:10, fontWeight:700, borderRadius:6, padding:"2px 8px" }}>{p.badge}</span>
                      </div>
                      <div style={{ color:C.textSub, fontSize:11 }}>{p.info}</div>
                    </div>
                    <div style={{ width:20, height:20, borderRadius:"50%", border:`2px solid ${choixAE===p.id?p.color:C.border}`, background:choixAE===p.id?p.color:"transparent", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                      {choixAE===p.id && <div style={{ width:7, height:7, borderRadius:"50%", background:"#fff" }}/>}
                    </div>
                  </div>
                  {choixAE===p.id && (
                    <a href={p.lien} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()} style={{ display:"block", marginTop:12, padding:"11px", borderRadius:r, background:`linear-gradient(135deg,${p.color},${p.color}cc)`, color:"#fff", fontWeight:700, fontSize:13, textAlign:"center", textDecoration:"none" }}>
                      Créer ma micro-entreprise sur {p.nom} →
                    </a>
                  )}
                </div>
              ))}
              <div style={{ fontSize:11, color:C.textMuted, lineHeight:1.6, padding:"10px 0" }}>
                ℹ️ ALANE ne perçoit aucune commission sur la création de votre entreprise. Revenez avec votre SIRET pour finaliser votre inscription.
              </div>
            </div>
          )}
        </>}
        {step===4 && <>
          <div style={{ background:docsOk?`${C.success}15`:`${C.accent}15`, border:`1px solid ${docsOk?C.success:C.accent}44`, borderRadius:r, padding:"13px 16px", marginBottom:18, display:"flex", gap:10 }}>
            <span style={{ fontSize:20 }}>{docsOk?"✅":"⚠️"}</span>
            <div>
              <div style={{ fontWeight:700, color:C.text, fontSize:13 }}>{docsOk?"Tous les documents obligatoires chargés !":"Documents manquants"}</div>
              <div style={{ color:C.textSub, fontSize:11 }}>Formats acceptés : PDF, JPG, PNG</div>
            </div>
          </div>
          <p style={{ fontWeight:800, color:C.text, fontSize:13, marginBottom:10 }}>Documents obligatoires</p>
          {docsAttendus.filter(d=>d.required).map(doc=>(
            <DocUploadCard key={doc.id} doc={doc} value={docs[doc.id]} onChange={async(file)=>{
              if(!file) return;
              // getSession() rafraîchit le token expiré ; getUser() renvoyait un user
              // alors que la requête suivante partait avec un JWT périmé, donc en rôle
              // anon, et la RLS de `documents` la rejetait silencieusement.
              const { data:_sd } = await supabase.auth.getSession();
              const user = _sd?.session?.user;
              if(!user) throw new Error("Session expirée — reconnectez-vous pour envoyer vos documents.");
              const path = `${user.id}/${doc.id}`;
              const { error } = await supabase.storage.from("Documents").upload(path, file, { upsert:true });
              if(error) throw new Error("Erreur d'envoi : " + (error.message || "inconnue"));
              setDocs(prev=>({...prev,[doc.id]:path}));
              const { error:dbErr } = await supabase.from("documents").upsert({ prestataire_id:user.id, type:doc.id, storage_path:path }, { onConflict:"prestataire_id,type" });
              if(dbErr) throw new Error("Document envoyé mais non enregistré — réessayez.");
              notifyDocUpload(doc.id, false);
            }} required />
          ))}
          <p style={{ fontWeight:800, color:C.text, fontSize:13, margin:"18px 0 10px" }}>Documents optionnels</p>
          {docsAttendus.filter(d=>!d.required).map(doc=>(
            <DocUploadCard key={doc.id} doc={doc} value={docs[doc.id]} onChange={async(file)=>{
              if(!file) return;
              const { data:_sd } = await supabase.auth.getSession();
              const user = _sd?.session?.user;
              if(!user) throw new Error("Session expirée — reconnectez-vous pour envoyer vos documents.");
              const path = `${user.id}/${doc.id}`;
              const { error } = await supabase.storage.from("Documents").upload(path, file, { upsert:true });
              if(error) throw new Error("Erreur d'envoi : " + (error.message || "inconnue"));
              setDocs(prev=>({...prev,[doc.id]:path}));
              const { error:dbErr } = await supabase.from("documents").upsert({ prestataire_id:user.id, type:doc.id, storage_path:path }, { onConflict:"prestataire_id,type" });
              if(dbErr) throw new Error("Document envoyé mais non enregistré — réessayez.");
              notifyDocUpload(doc.id, false);
            }} required={false} />
          ))}
        </>}
        {step===5 && <>
          {/* Liste des métiers ajoutés */}
          {metiers.length>0 && (
            <div style={{ marginBottom:18 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                <p style={{ fontWeight:800, color:C.text, fontSize:13, margin:0 }}>Vos métiers ({metiers.length})</p>
                <span style={{ background:`${C.success}20`, color:C.success, fontSize:11, fontWeight:700, borderRadius:8, padding:"3px 10px" }}>✓ {metiers.length} ajouté{metiers.length>1?"s":""}</span>
              </div>
              {metiers.map((m,i)=>(
                <div key={m.id} style={{ background:"#0D1B3E", borderRadius:r, padding:"13px 14px", marginBottom:8, border:`1px solid ${C.border}`, display:"flex", alignItems:"center", gap:10 }}>
                  <div style={{ width:38, height:38, borderRadius:10, background:`${C.violet}15`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0 }}>
                    {SECTORS.find(s=>s.id===m.sector)?.icon||"💼"}
                  </div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:700, color:C.text, fontSize:13 }}>{m.metier}</div>
                    <div style={{ color:C.textSub, fontSize:11, marginTop:1 }}>{SECTORS.find(s=>s.id===m.sector)?.label} · {m.niveau}</div>
                    {m.certifs&&<div style={{ color:C.violet, fontSize:11, marginTop:2 }}>🎓 {m.certifs}</div>}
                    <div style={{ display:"flex", gap:12, marginTop:5, alignItems:"center" }}>
                      <span style={{ fontSize:13, fontWeight:800, color:C.success }}>Vous : {formatE(m.tarifNet||12)}</span>
                      <span style={{ fontSize:11, color:C.textMuted }}>→ Client : {formatE(prixClient(m.tarifNet||12, m.sector||"divers"))}</span>
                    </div>
                  </div>
                  <button onClick={()=>setMetiers(prev=>prev.filter((_,j)=>j!==i))} style={{ background:"rgba(242,94,94,0.1)", border:"none", borderRadius:8, width:32, height:32, color:C.accent, cursor:"pointer", fontSize:16, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>×</button>
                </div>
              ))}
            </div>
          )}

          {/* Formulaire ajout métier */}
          <div style={{ background:"#0D1B3E", borderRadius:16, padding:"16px", marginBottom:18, boxShadow:"0 2px 12px rgba(0,0,0,0.4)", border:`1px dashed ${C.border}` }}>
            <p style={{ fontWeight:800, color:C.text, fontSize:13, margin:"0 0 2px" }}>
              {metiers.length===0 ? "+ Ajouter un métier" : "+ Ajouter un autre métier"}
            </p>
            <p style={{ color:C.textSub, fontSize:12, margin:"0 0 14px" }}>
              {metiers.length===0
                ? "Optionnel — vous pourrez compléter après validation"
                : "Chaque métier peut avoir son propre taux horaire"}
            </p>
            <Select label="Secteur" options={SECTORS.map(s=>s.label)} value={SECTORS.find(s=>s.id===newMetier.sector)?.label||""} onChange={e=>{const s=SECTORS.find(x=>x.label===e.target.value);setNewMetier({...newMetier,sector:s?.id||"",metier:""}); }} />
            {newMetier.sector && <Select label="Métier" options={METIERS[newMetier.sector]||[]} value={newMetier.metier} onChange={e=>{
              const tarif = METIERS_TARIFS[newMetier.sector]?.[e.target.value];
              setNewMetier({...newMetier, metier:e.target.value, tarifNet: tarif?.default || tarif?.min || 12});
            }} />}
            {newMetier.sector && newMetier.metier && (() => {
              const t    = METIERS_TARIFS[newMetier.sector]?.[newMetier.metier];
              const net  = newMetier.tarifNet || t?.default || t?.min || 12;
              const clientPrice = prixClient(net, newMetier.sector||"divers");
              const belowMarket = t && net < t.min;
              const aboveMarket = t && net > t.max;
              return (
                <div style={{ background:`${C.violet}08`, border:`1px solid ${C.violet}22`, borderRadius:r, padding:"16px", marginBottom:14 }}>

                  {/* Moyenne prestataire */}
                  {t && (
                    <div style={{ background:`${C.accentGold}15`, border:`1px solid ${C.accentGold}44`, borderRadius:10, padding:"10px 12px", marginBottom:14, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                      <span style={{ fontSize:12, color:C.text, fontWeight:600 }}>📊 Moyenne prestataire</span>
                      <span style={{ fontSize:13, color:C.accentGold, fontWeight:800 }}>{formatE(Math.round(((t.min + t.max) / 2) * 10) / 10)}</span>
                    </div>
                  )}

                  {/* Saisie libre du taux */}
                  <div style={{ marginBottom:12 }}>
                    <label style={{ display:"block", fontSize:12, color:C.textSub, fontWeight:600, marginBottom:8 }}>
                      Votre taux horaire souhaité (libre)
                    </label>
                    <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                      <div style={{ flex:1, position:"relative" }}>
                        <input
                          type="number" min={1} step={0.1}
                          value={net}
                          onChange={e => setNewMetier({...newMetier, tarifNet: Math.max(1, Math.round(+(e.target.value||1)*100)/100)})}
                          style={{ width:"100%", padding:"14px 48px 14px 16px", borderRadius:12, border:`2px solid ${belowMarket||aboveMarket ? C.accentGold : C.violet}`, fontSize:20, fontWeight:800, color:C.violet, fontFamily:"inherit", outline:"none", boxSizing:"border-box", textAlign:"center" }}
                        />
                        <span style={{ position:"absolute", right:14, top:"50%", transform:"translateY(-50%)", color:C.textSub, fontSize:13, fontWeight:600 }}>€/h</span>
                      </div>
                      <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                        <button onClick={()=>setNewMetier({...newMetier, tarifNet: Math.round((net+0.1)*100)/100})} style={{ width:36, height:32, borderRadius:8, border:`1px solid ${C.border}`, background:"#0D1B3E", cursor:"pointer", fontSize:16, display:"flex", alignItems:"center", justifyContent:"center" }}>＋</button>
                        <button onClick={()=>setNewMetier({...newMetier, tarifNet: Math.max(1, Math.round((net-0.1)*100)/100)})} style={{ width:36, height:32, borderRadius:8, border:`1px solid ${C.border}`, background:"#0D1B3E", cursor:"pointer", fontSize:16, display:"flex", alignItems:"center", justifyContent:"center" }}>－</button>
                      </div>
                    </div>

                    {/* Alerte si hors fourchette — indicatif seulement */}
                    {belowMarket && (
                      <div style={{ marginTop:8, fontSize:11, color:C.warning, fontWeight:600 }}>
                        ⚠️ En dessous du marché — vous pouvez tout à fait le garder
                      </div>
                    )}
                    {aboveMarket && (
                      <div style={{ marginTop:8, fontSize:11, color:C.accentGold, fontWeight:600 }}>
                        📈 Au-dessus du marché — assurez-vous que votre profil le justifie
                      </div>
                    )}
                  </div>

                  {/* Résumé net → client */}
                  <div style={{ background:"#0D1B3E", borderRadius:12, padding:"12px 14px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                    <div>
                      <div style={{ fontSize:11, color:C.textSub, fontWeight:600 }}>Vous encaissez</div>
                      <div style={{ fontSize:22, fontWeight:800, color:C.success }}>{formatE(net)}</div>
                    </div>
                    <div style={{ textAlign:"center", color:C.grayLight, fontSize:20 }}>→</div>
                    <div style={{ textAlign:"right" }}>
                      <div style={{ fontSize:11, color:C.textSub, fontWeight:600 }}>Affiché aux clients</div>
                      <div style={{ fontSize:22, fontWeight:800, color:C.text }}>{formatE(clientPrice)}</div>
                    </div>
                  </div>
                  <p style={{ fontSize:11, color:C.textSub, margin:"8px 0 0", textAlign:"center", lineHeight:1.4 }}>
                    Le tarif client inclut les frais de service ALANE
                  </p>

                  {/* Simulateur de charges auto-entrepreneur */}
                  {(() => {
                    const charges = Math.round(net * 0.22 * 100) / 100;
                    const netApres = Math.round((net - charges) * 100) / 100;
                    const scenarios = [
                      { label:"Prestation 4h",      gain: Math.round(netApres * 4 * 10) / 10 },
                      { label:"Prestation 8h",      gain: Math.round(netApres * 8 * 10) / 10 },
                      { label:"4 prestations/mois", gain: Math.round(netApres * 8 * 4 * 10) / 10 },
                    ];
                    return (
                      <div style={{ background:"rgba(16,217,143,0.06)", border:`1px solid ${C.success}25`, borderRadius:12, padding:"13px 14px", marginTop:12 }}>
                        <div style={{ fontWeight:800, color:C.text, fontSize:12, marginBottom:10 }}>🧮 Simulateur de charges auto-entrepreneur</div>
                        <div style={{ display:"flex", justifyContent:"space-between", padding:"5px 0", borderBottom:`1px solid rgba(255,255,255,0.06)` }}>
                          <span style={{ fontSize:12, color:C.textSub }}>Cotisations URSSAF (22%)</span>
                          <span style={{ fontSize:12, fontWeight:700, color:C.accent }}>− {formatE(charges)}</span>
                        </div>
                        <div style={{ display:"flex", justifyContent:"space-between", padding:"7px 0 8px", borderBottom:`1px solid rgba(255,255,255,0.06)` }}>
                          <span style={{ fontSize:12, color:C.textSub, fontWeight:700 }}>Net après charges</span>
                          <span style={{ fontSize:14, fontWeight:800, color:C.success }}>{formatE(netApres)}/h</span>
                        </div>
                        <div style={{ marginTop:10, display:"flex", gap:6 }}>
                          {scenarios.map(s => (
                            <div key={s.label} style={{ flex:1, background:"#0D1B3E", borderRadius:8, padding:"7px 4px", textAlign:"center" }}>
                              <div style={{ fontSize:10, color:C.textSub, marginBottom:2 }}>{s.label}</div>
                              <div style={{ fontSize:13, fontWeight:800, color:C.success }}>{formatE(s.gain)}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              );
            })()}
            <Select label="Niveau" options={["Débutant","Confirmé","Expert"]} value={newMetier.niveau} onChange={e=>setNewMetier({...newMetier,niveau:e.target.value})} />
            <Input label="Certifications (optionnel)" placeholder="Ex : CACES 1, HACCP, SST…" value={newMetier.certifs} onChange={e=>setNewMetier({...newMetier,certifs:e.target.value})} hint="Laissez vide si aucune certification" />
            <Btn
              full
              onClick={addMetier}
              disabled={!newMetier.sector||!newMetier.metier}
              variant={justAdded?"success":"primary"}
              style={{ padding:"13px", fontSize:15 }}
            >
              {justAdded ? "✓ Métier ajouté !" : `${metiers.length===0?"+ Ajouter ce métier":"+ Ajouter un autre métier"}`}
            </Btn>
          </div>
          <div style={{ background:"#0D1B3E", borderRadius:16, padding:"16px", marginBottom:18, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
            <p style={{ fontWeight:800, color:C.text, fontSize:13, margin:"0 0 12px" }}>🌍 Langues parlées</p>
            <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
              {["Français","Anglais","Espagnol","Arabe","Portugais","Allemand","Italien","Mandarin"].map(l=><button key={l} onClick={()=>toggleLangue(l)} style={{ padding:"8px 14px", borderRadius:20, border:"none", cursor:"pointer", background:langues.includes(l)?C.violet:C.grayLight, color:langues.includes(l)?C.white:C.text, fontWeight:langues.includes(l)?700:500, fontSize:13, fontFamily:"inherit" }}>{l}</button>)}
            </div>
          </div>
          <div style={{ marginBottom:8 }}>
            <label style={{ display:"block", fontSize:12, color:C.textSub, marginBottom:5, fontWeight:600 }}>Présentation libre</label>
            <textarea placeholder="Décrivez votre parcours…" value={bio} onChange={e=>setBio(e.target.value)} style={{ width:"100%", padding:"13px", borderRadius:12, border:`1px solid ${C.border}`, fontSize:14, fontFamily:"inherit", resize:"none", height:90, boxSizing:"border-box", outline:"none", color:C.text }} />
          </div>
        </>}
        {step===7 && <>
          <div style={{ background:`${C.violet}10`, border:`1px solid ${C.violet}30`, borderRadius:r, padding:"13px 15px", marginBottom:18 }}>
            <div style={{ fontWeight:700, color:C.text, fontSize:13, marginBottom:4 }}>Choisissez votre plan ALANE</div>
            <div style={{ color:C.textSub, fontSize:12 }}>Tarif transparent · prix affiché = prix réel. Changez de plan à tout moment.</div>
          </div>
          <div style={{ background:"rgba(124,111,224,0.1)", border:"1px solid rgba(124,111,224,0.3)", borderRadius:r, padding:"10px 14px", marginBottom:14, fontSize:12, color:C.textSub }}>
            💡 Vous pourrez changer de plan à tout moment depuis votre espace.
          </div>
          {ABONNEMENTS_PRESTA.map(plan=>{
            const active=abonnement===plan.id;
            return (
              <div key={plan.id} onClick={()=>setAbonnement(plan.id)} style={{ background:active?plan.color+"15":"#0D1B3E", border:`2px solid ${active?plan.color:C.border}`, borderRadius:r+4, padding:"14px", marginBottom:10, cursor:"pointer", position:"relative" }}>
                {plan.popular&&<div style={{ position:"absolute", top:10, right:10, background:plan.color, borderRadius:6, padding:"2px 8px", color:"#fff", fontSize:10, fontWeight:700 }}>Populaire</div>}
                <div style={{ display:"flex", gap:10, alignItems:"center", marginBottom:8 }}>
                  <div style={{ width:40, height:40, borderRadius:11, background:plan.color+"20", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0 }}>{plan.icon}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:700, color:C.text, fontSize:14 }}>{plan.label}</div>
                    <div style={{ fontWeight:800, color:plan.color, fontSize:17 }}>{plan.price===0?"Gratuit":plan.price+" €/mois"}</div>
                  </div>
                  <div style={{ width:22, height:22, borderRadius:"50%", border:`2px solid ${active?plan.color:C.border}`, background:active?plan.color:"transparent", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                    {active&&<div style={{ width:8, height:8, borderRadius:"50%", background:"#fff" }}/>}
                  </div>
                </div>
                {plan.features.map((f,i)=>(
                  <div key={i} style={{ display:"flex", gap:8, padding:"2px 0" }}>
                    <span style={{ color:plan.color, fontSize:12 }}>✓</span>
                    <span style={{ color:C.textSub, fontSize:12 }}>{f}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </>}
        {step===dispoStep && <>
          <div style={{ background:"#0D1B3E", borderRadius:16, padding:"16px", marginBottom:18, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
            <p style={{ fontWeight:800, color:C.text, fontSize:14, margin:"0 0 4px" }}>📅 Disponibilités hebdomadaires</p>
            <p style={{ color:C.textSub, fontSize:12, margin:"0 0 16px" }}>Modifiables à tout moment depuis votre profil</p>
            {JOURS.map(jour=>{
              const sel=dispos[jour]||[];
              return (
                <div key={jour} style={{ marginBottom:10, borderRadius:12, border:`2px solid ${sel.length>0?C.violet+"44":C.grayLight}`, overflow:"hidden" }}>
                  <div style={{ padding:"10px 14px", background:sel.length>0?`${C.violet}08`:C.white, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                    <span style={{ fontWeight:800, color:sel.length>0?C.violet:C.text, fontSize:14 }}>{jour}</span>
                    {sel.length>0?<Badge color={C.violet} small>{sel.length} plage{sel.length>1?"s":""}</Badge>:<span style={{ color:C.textSub, fontSize:12 }}>Non disponible</span>}
                  </div>
                  <div style={{ padding:"8px 14px", display:"flex", gap:6, flexWrap:"wrap", borderTop:`1px solid ${C.border}` }}>
                    {PLAGES.map(plage=>{const a=sel.includes(plage);return(<button key={plage} onClick={()=>toggleDispo(jour,plage)} style={{ padding:"6px 12px", borderRadius:10, border:"none", cursor:"pointer", background:a?C.violet:C.grayLight, color:a?C.white:C.text, fontWeight:a?700:500, fontSize:11, fontFamily:"inherit" }}>{plage.split(" ")[0]}</button>);})}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ background:"#0D1B3E", borderRadius:16, padding:"16px", boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
            <p style={{ fontWeight:800, color:C.text, fontSize:14, margin:"0 0 14px" }}>⚙️ Préférences de prestation</p>
            <div style={{ marginBottom:14 }}>
              <label style={{ display:"block", fontSize:11, color:C.textSub, marginBottom:8, fontWeight:600, letterSpacing:0.8, textTransform:"uppercase" }}>Type de prestations souhaitées</label>
              <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
                {["Journée complète","Demi-journée","Semaine complète","Prestations urgentes","Week-end"].map(type=>(
                  <button key={type} onClick={()=>setPrefs(p=>({ ...p, contrat:p.contrat===type?"":type }))} style={{ padding:"9px 14px", borderRadius:20, border:"none", cursor:"pointer", fontFamily:"inherit", fontSize:12, fontWeight:prefs.contrat===type?700:500, background:prefs.contrat===type?C.violet:"rgba(255,255,255,0.06)", color:prefs.contrat===type?C.white:C.textSub, transition:"all 0.2s" }}>
                    {type}
                  </button>
                ))}
              </div>
              <p style={{ color:C.textMuted, fontSize:11, marginTop:8 }}>Sélectionnez votre préférence principale — modifiable à tout moment</p>
            </div>
            <Input label="Rayon max (km)" type="number" placeholder="20" value={prefs.mobilite} onChange={e=>setPrefs({...prefs,mobilite:e.target.value})} />
            <div style={{ display:"flex", gap:10 }}>
              {[{key:"vehicule",label:"🚗 Véhiculé(e)"},{key:"permis",label:"📋 Permis B"}].map(({key,label})=><button key={key} onClick={()=>setPrefs({...prefs,[key]:!prefs[key]})} style={{ flex:1, padding:"12px", borderRadius:12, border:`2px solid ${prefs[key]?C.violet:C.grayLight}`, background:prefs[key]?`${C.violet}10`:C.white, color:prefs[key]?C.violet:C.gray, fontWeight:prefs[key]?700:500, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>{label}</button>)}
            </div>
          </div>
        </>}
        {step===recapStep && <>
          <div style={{ background:`${C.success}15`, border:`1px solid ${C.success}44`, borderRadius:r, padding:"14px 16px", marginBottom:18, display:"flex", gap:12, alignItems:"center" }}>
            <span style={{ fontSize:28 }}>🎉</span>
            <div><div style={{ fontWeight:800, color:C.text, fontSize:14 }}>Profil complet !</div><div style={{ color:C.textSub, fontSize:12 }}>Vérifiez avant envoi</div></div>
          </div>
          {[
            {title:"👤 Identité",items:[`${infos.prenom} ${infos.nom}`,infos.email,infos.tel]},
            {title:"📍 Adresse",items:[`${adresse.rue}, ${adresse.cp} ${adresse.ville}`,`Zone : ${adresse.rayon} km`]},
            {title:"🏢 Auto-entrepreneur",items:[`SIRET : ${ae.siret||"—"}`,`Activité : ${ae.activite||"—"}`]},
            {title:"📎 Documents",items:[`${Object.values(docs).filter(Boolean).length}/${docsAttendus.length} chargés`]},
            {title:"💼 Métiers & taux nets",items:metiers.map(m=>m.tarifNet?`${m.metier} — ${formatE(m.tarifNet)} net`:m.metier)},
            {title:"📅 Disponibilités",items:JOURS.filter(j=>(dispos[j]||[]).length>0).map(j=>`${j} : ${(dispos[j]||[]).map(p=>p.split(" ")[0]).join(", ")}`)},
            ...[{title:"💎 Abonnement",items:[(ABONNEMENTS_PRESTA.find(p=>p.id===abonnement)||ABONNEMENTS_PRESTA[0]).label+" — "+(ABONNEMENTS_PRESTA.find(p=>p.id===abonnement)?.price===0?"Gratuit":(ABONNEMENTS_PRESTA.find(p=>p.id===abonnement)?.price)+" €/mois")]}],
          ].map(section=>(
            <div key={section.title} style={{ background:"#0D1B3E", borderRadius:r, padding:"14px", marginBottom:10, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
              <div style={{ fontWeight:800, color:C.text, fontSize:13, marginBottom:8 }}>{section.title}</div>
              {section.items.filter(Boolean).map((item,i)=><div key={i} style={{ color:C.textSub, fontSize:13, padding:"4px 0" }}>{item}</div>)}
              {section.items.filter(Boolean).length===0 && <div style={{ color:C.accent, fontSize:13 }}>⚠️ Non renseigné</div>}
            </div>
          ))}
          <div style={{ background:"#0D1B3E", borderRadius:r, padding:"14px", marginBottom:14, boxShadow:"0 2px 12px rgba(0,0,0,0.4)" }}>
            <label style={{ display:"flex", gap:10, alignItems:"flex-start", cursor:"pointer" }}>
              <input type="checkbox" checked={cguAccepted} onChange={e=>setCguAccepted(e.target.checked)} style={{ marginTop:2, accentColor:C.violet }} />
              <span style={{ fontSize:13, color:C.textSub, lineHeight:1.5 }}>J'accepte les <strong style={{ color:C.violet }}>CGU</strong> et la <strong style={{ color:C.violet }}>Politique de confidentialité</strong> de ALANE</span>
            </label>
          </div>
          <div style={{ background:`${C.accentGold}15`, border:`1px solid ${C.accentGold}44`, borderRadius:12, padding:"12px 14px", marginBottom:18, fontSize:12, color:C.text }}>⏱️ Délai de validation : <strong>24 à 48h ouvrées</strong></div>
          {submitError && <div style={{ background:"#F25E5E22", border:"1px solid #F25E5E55", borderRadius:r, padding:"10px 14px", marginBottom:14, color:"#F25E5E", fontSize:13 }}>{submitError}</div>}
          <Btn full variant="success" onClick={handleSubmitDossier} disabled={submitting||!cguAccepted} style={{ fontSize:16, padding:"18px" }}>{submitting?"Envoi en cours…":"✅ Envoyer mon dossier"}</Btn>
        </>}
        {step<TOTAL && <div style={{ marginTop:18 }}><Btn full onClick={()=>setStep(s=>s+1)} disabled={!stepValid()} style={{ fontSize:16, padding:"17px" }}>Continuer →</Btn></div>}
      </div>
    </div>
  );
}

export function PrestaProfilTab({ onNavigate }) {
  const [meta, setMeta] = useState(null);
  // Données fiscales — voir le bloc plus bas. Elles vivent dans `profiles`, pas
  // dans les métadonnées : c'est la table que lit l'export DAC7.
  const [fiscal, setFiscal] = useState(null);
  const [nifSaisi, setNifSaisi] = useState("");
  const [residenceSaisie, setResidenceSaisie] = useState("France");
  const [fiscalEnCours, setFiscalEnCours] = useState(false);

  useEffect(()=>{
    supabase.auth.getUser().then(({data})=>{
      if(!data?.user) return;
      setMeta(data.user.user_metadata||{});
      supabase.from("profiles").select("nif,residence_fiscale").eq("id", data.user.id).single()
        .then(({ data: f, error }) => {
          // Sans trace, un dossier fiscal incomplet resterait invisible au
          // prestataire comme à nous, jusqu'au jour de la déclaration.
          if (error) { console.error("[profil] données fiscales illisibles :", error.message); return; }
          setFiscal(f || {});
          if (f?.nif) setNifSaisi(f.nif);
          if (f?.residence_fiscale) setResidenceSaisie(f.residence_fiscale === "FR" ? "France" : "Autre pays");
        });
    });
  },[]);

  const enregistrerFiscal = async () => {
    const nif = nifSaisi.replace(/\s/g, "");
    if (!nif) { showToast("Renseignez votre numéro fiscal."); return; }
    setFiscalEnCours(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("profiles").update({
        nif,
        nif_collecte_at: new Date().toISOString(),
        residence_fiscale: residenceSaisie === "France" ? "FR" : null,
      }).eq("id", u?.user?.id);
      if (error) { showToast(error.message || "Enregistrement impossible."); setFiscalEnCours(false); return; }
      setFiscal({ nif, residence_fiscale: residenceSaisie === "France" ? "FR" : null });
      showToast("Informations fiscales enregistrées.");
    } catch (e) { showToast(e?.message || "Erreur réseau"); }
    setFiscalEnCours(false);
  };

  const secteurInfo = meta?.secteur ? SECTORS.find(s=>s.id===meta.secteur) : null;
  const color = secteurInfo?.color || C.accentGold;

  return (
    <div>
      {/* Informations fiscales — obligatoires depuis le 16/08/2026 au titre de la
          directive DAC7, qui impose à la plateforme de déclarer chaque année
          l'identité de ses prestataires et les sommes versées.
          Le champ n'existait qu'à l'inscription : les comptes créés avant
          restaient incomplets, et rien ne leur permettait de se mettre à jour. */}
      {fiscal && !fiscal.nif && (
        <div style={{ background:"rgba(240,180,41,0.10)", border:"1px solid rgba(240,180,41,0.35)", borderRadius:r, padding:"16px", marginBottom:12 }}>
          <div style={{ color:"#F0B429", fontWeight:800, fontSize:14, marginBottom:6 }}>
            Votre numéro fiscal est manquant
          </div>
          <div style={{ color:C.textSub, fontSize:12, lineHeight:1.6, marginBottom:12 }}>
            ALANE doit déclarer chaque année à l'administration fiscale les sommes qui vous ont été
            versées, et votre numéro fiscal en fait partie. Il figure sur votre avis d'imposition,
            et compte treize chiffres. Il est distinct de votre SIRET.
          </div>
          <Input label="Numéro fiscal (NIF)" placeholder="13 chiffres" icon="🧾"
            value={nifSaisi} onChange={e=>setNifSaisi(e.target.value.replace(/\s/g,""))} />
          <Select label="Pays de résidence fiscale" options={["France","Autre pays"]}
            value={residenceSaisie} onChange={e=>setResidenceSaisie(e.target.value)} />
          <button onClick={enregistrerFiscal} disabled={fiscalEnCours} style={{
            marginTop:10, padding:"11px 18px", borderRadius:10, border:"none", background:"#F0B429",
            color:"#0A1628", fontWeight:800, fontSize:13, cursor:"pointer", fontFamily:"inherit",
            opacity:fiscalEnCours?0.6:1,
          }}>
            {fiscalEnCours ? "…" : "Enregistrer"}
          </button>
        </div>
      )}

      {/* Carte profil métier */}
      {meta && (meta.secteur || meta.metier || meta.tarif_net) && (
        <div style={{ background:"#0D1B3E", borderRadius:r, padding:"16px", marginBottom:12, border:`1px solid ${color}33` }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
            <div style={{ fontWeight:700, color:C.text, fontSize:14 }}>Mon profil professionnel</div>
            <button onClick={()=>onNavigate("presta_profile_edit")} style={{ background:`${color}20`, border:`1px solid ${color}44`, borderRadius:8, padding:"5px 12px", color:color, fontSize:11, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>✏️ Modifier</button>
          </div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:12 }}>
            {secteurInfo && <Badge color={color} small>{secteurInfo.icon} {secteurInfo.label}</Badge>}
            {meta.metier && <Badge color={C.violet} small>💼 {meta.metier}</Badge>}
            {meta.niveau && <Badge color={C.textSub} small>{meta.niveau==="Débutant"?"🌱":meta.niveau==="Confirmé"?"💪":"🏆"} {meta.niveau}</Badge>}
            {meta.experience_ans!=null && <Badge color={C.textSub} small>🕐 {meta.experience_ans} an{meta.experience_ans>1?"s":""}</Badge>}
          </div>
          {meta.tarif_net && (
            <div style={{ background:`${color}15`, borderRadius:10, padding:"10px 12px", marginBottom:meta.langues?.length?10:0, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <span style={{ color:C.textSub, fontSize:12 }}>Tarif net</span>
              <span style={{ color:color, fontWeight:800, fontSize:15 }}>{Number(meta.tarif_net).toFixed(2)} €/h</span>
            </div>
          )}
          {meta.langues?.length > 0 && (
            <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
              {meta.langues.map(l=><span key={l} style={{ background:"rgba(255,255,255,0.06)", borderRadius:6, padding:"3px 8px", color:C.textSub, fontSize:11 }}>🌐 {l}</span>)}
            </div>
          )}
        </div>
      )}

      {/* Disponibilités */}
      {meta && (meta.dispon_jours?.length || meta.dispon_creneaux?.length) && (
        <div style={{ background:"#0D1B3E", borderRadius:r, padding:"14px 16px", marginBottom:12 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
            <div style={{ fontWeight:700, color:C.text, fontSize:13 }}>📅 Disponibilités</div>
            <button onClick={()=>onNavigate("presta_profile_edit")} style={{ background:"transparent", border:"none", color:C.violet, fontSize:11, fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}>Modifier</button>
          </div>
          {meta.dispon_jours?.length > 0 && (
            <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:8 }}>
              {meta.dispon_jours.map(j=><span key={j} style={{ background:`${C.violet}20`, border:`1px solid ${C.violet}44`, borderRadius:6, padding:"3px 9px", color:C.violet, fontSize:11, fontWeight:600 }}>{j.slice(0,3)}</span>)}
            </div>
          )}
          {meta.dispon_creneaux?.length > 0 && (
            <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
              {meta.dispon_creneaux.map(c=><span key={c} style={{ background:"rgba(255,255,255,0.05)", borderRadius:6, padding:"3px 8px", color:C.textSub, fontSize:11 }}>{c.split(" ")[0]}</span>)}
            </div>
          )}
          {meta.dispo_immediat && <div style={{ color:C.success, fontSize:11, fontWeight:600, marginTop:8 }}>🟢 Disponible immédiatement</div>}
        </div>
      )}

      {/* Si aucune donnée d'inscription → incitation à compléter */}
      {meta && !meta.secteur && (
        <div style={{ background:`${C.accentGold}12`, border:`1px solid ${C.accentGold}35`, borderRadius:r, padding:"14px 16px", marginBottom:12 }}>
          <div style={{ fontWeight:700, color:C.accentGold, fontSize:13, marginBottom:6 }}>⚠️ Profil incomplet</div>
          <div style={{ color:C.textSub, fontSize:12, lineHeight:1.6, marginBottom:10 }}>Complétez votre profil pour apparaître dans les résultats et recevoir des prestations.</div>
          <button onClick={()=>onNavigate("presta_profile_edit")} style={{ background:C.accentGold, border:"none", borderRadius:10, padding:"9px 16px", color:"#000", fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>Compléter mon profil →</button>
        </div>
      )}

      {/* Liens fixes */}
      {[
        {icon:"📂",label:"Mes documents",sub:"Uploader & renouveler mes docs", action:()=>onNavigate("doc_upload")},
        {icon:"👤",label:"Informations personnelles",sub:"Nom, email, téléphone", action:()=>onNavigate("settings")},
        {icon:"💎",label:"Mon abonnement",sub:"100 premiers → 10 missions/mois gratuit · Premium 29€ · Elite 59€",action:()=>onNavigate("abonnement_presta")},
        {icon:"🔔",label:"Notifications",sub:"Gérer mes alertes", action:()=>onNavigate("notifications")},
      ].map((item,i)=>(
        <div key={i} onClick={item.action} style={{ background:"#0D1B3E", borderRadius:r, padding:"13px", marginBottom:9, display:"flex", alignItems:"center", gap:12, cursor:"pointer", boxShadow:"0 2px 12px rgba(0,0,0,0.4)", transition:"transform 0.15s" }}
          onMouseEnter={e=>e.currentTarget.style.transform="translateX(4px)"}
          onMouseLeave={e=>e.currentTarget.style.transform="translateX(0)"}
        >
          <div style={{ width:40, height:40, borderRadius:12, background:`${C.accent}15`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 }}>{item.icon}</div>
          <div style={{ flex:1 }}><div style={{ fontWeight:700, color:C.text, fontSize:13 }}>{item.label}</div><div style={{ color:C.textSub, fontSize:11 }}>{item.sub}</div></div>
          <span style={{ color:C.textSub, fontSize:17 }}>›</span>
        </div>
      ))}
    </div>
  );
}

export function CvEditor({ cv, onChange, color }) {
  const [titre,    setTitre]    = useState(cv?.titre    || "");
  const [accroche, setAccroche] = useState(cv?.accroche || "");
  const [exps,     setExps]     = useState(cv?.experiences || []);
  const [forms,    setForms]    = useState(cv?.formations  || []);
  const [permis,   setPermis]   = useState(cv?.permis   || "");

  const notify = (updates) => onChange({ titre, accroche, experiences:exps, formations:forms, permis, ...updates, hasCV:true });

  return (
    <div>
      <Input label="Titre professionnel" placeholder="Ex: Cariste CACES 1/3/5 — Logisticien" value={titre} onChange={e=>{ setTitre(e.target.value); notify({titre:e.target.value}); }} />
      <div style={{ marginBottom:14 }}>
        <label style={{ display:"block", fontSize:12, color:C.textSub, fontWeight:600, marginBottom:6 }}>Accroche</label>
        <textarea value={accroche} onChange={e=>{ setAccroche(e.target.value); notify({accroche:e.target.value}); }} placeholder="Décrivez votre profil en 2-3 phrases…" style={{ width:"100%", padding:"11px 13px", borderRadius:12, border:`1px solid ${C.border}`, fontSize:13, fontFamily:"inherit", resize:"vertical", height:80, boxSizing:"border-box", outline:"none", background:"#112240", color:C.text, lineHeight:1.5 }} />
      </div>
      <div style={{ fontWeight:700, color:C.text, fontSize:12, marginBottom:8 }}>💼 Expériences</div>
      {exps.map((e,i) => (
        <div key={i} style={{ background:"rgba(255,255,255,0.04)", borderRadius:10, padding:"10px 12px", marginBottom:8, position:"relative" }}>
          <button onClick={()=>{ const n=[...exps]; n.splice(i,1); setExps(n); notify({experiences:n}); }} style={{ position:"absolute", top:8, right:8, background:"rgba(242,94,94,0.15)", border:"none", borderRadius:6, color:"#F25E5E", cursor:"pointer", fontSize:11, padding:"2px 7px", fontFamily:"inherit" }}>✕</button>
          <Input label="Poste" value={e.poste||""} onChange={ev=>{ const n=[...exps]; n[i]={...n[i],poste:ev.target.value}; setExps(n); notify({experiences:n}); }} />
          <Input label="Entreprise" value={e.entreprise||""} onChange={ev=>{ const n=[...exps]; n[i]={...n[i],entreprise:ev.target.value}; setExps(n); notify({experiences:n}); }} />
          <Input label="Période" placeholder="2022 – 2025" value={e.periode||""} onChange={ev=>{ const n=[...exps]; n[i]={...n[i],periode:ev.target.value}; setExps(n); notify({experiences:n}); }} />
          <Input label="Description" value={e.desc||""} onChange={ev=>{ const n=[...exps]; n[i]={...n[i],desc:ev.target.value}; setExps(n); notify({experiences:n}); }} />
        </div>
      ))}
      <button onClick={()=>{ const n=[...exps,{poste:"",entreprise:"",periode:"",desc:""}]; setExps(n); notify({experiences:n}); }} style={{ width:"100%", padding:"9px", border:`1px dashed ${color}`, borderRadius:10, background:"transparent", color, cursor:"pointer", fontSize:12, fontWeight:700, fontFamily:"inherit", marginBottom:14 }}>+ Ajouter une expérience</button>
      <div style={{ fontWeight:700, color:C.text, fontSize:12, marginBottom:8 }}>🎓 Formations</div>
      {forms.map((f,i) => (
        <div key={i} style={{ background:"rgba(255,255,255,0.04)", borderRadius:10, padding:"10px 12px", marginBottom:8, position:"relative" }}>
          <button onClick={()=>{ const n=[...forms]; n.splice(i,1); setForms(n); notify({formations:n}); }} style={{ position:"absolute", top:8, right:8, background:"rgba(242,94,94,0.15)", border:"none", borderRadius:6, color:"#F25E5E", cursor:"pointer", fontSize:11, padding:"2px 7px", fontFamily:"inherit" }}>✕</button>
          <Input label="Diplôme / Certification" value={f.diplome||""} onChange={ev=>{ const n=[...forms]; n[i]={...n[i],diplome:ev.target.value}; setForms(n); notify({formations:n}); }} />
          <Input label="Établissement" value={f.etablissement||""} onChange={ev=>{ const n=[...forms]; n[i]={...n[i],etablissement:ev.target.value}; setForms(n); notify({formations:n}); }} />
          <Input label="Année" placeholder="2023" value={f.annee||""} onChange={ev=>{ const n=[...forms]; n[i]={...n[i],annee:ev.target.value}; setForms(n); notify({formations:n}); }} />
        </div>
      ))}
      <button onClick={()=>{ const n=[...forms,{diplome:"",etablissement:"",annee:""}]; setForms(n); notify({formations:n}); }} style={{ width:"100%", padding:"9px", border:`1px dashed ${color}`, borderRadius:10, background:"transparent", color, cursor:"pointer", fontSize:12, fontWeight:700, fontFamily:"inherit", marginBottom:14 }}>+ Ajouter une formation</button>
      <Input label="Permis / Mobilité" placeholder="Permis B — véhiculé" value={permis} onChange={e=>{ setPermis(e.target.value); notify({permis:e.target.value}); }} />
    </div>
  );
}

const TAUX_URSSAF = { bic: 0.123, bnc: 0.212 };

function TarifSimulateur({ secteur, metier, tarifNet, color }) {
  const [open, setOpen]           = useState(false);
  const [regime, setRegime]       = useState("bic");
  const [netSouhaite, setNetSouhaite] = useState(tarifNet || 13);

  const tarifInfo = secteur && metier ? METIERS_TARIFS[secteur]?.[metier] : null;
  const taux      = TAUX_URSSAF[regime];
  const tarifFact = netSouhaite / (1 - taux);
  const charges   = tarifFact - netSouhaite;

  // Position du curseur sur la barre (range 0–50€ pour la lisibilité)
  const barMax = Math.max(tarifInfo?.max || 30, tarifNet, netSouhaite) + 5;
  const pct = v => `${Math.min(Math.max((v / barMax) * 100, 0), 100)}%`;

  return (
    <div style={{ marginTop: 12 }}>
      {/* ── Fourchette marché ALANE ── */}
      {tarifInfo && (
        <div style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 14px", marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: C.textSub, marginBottom: 8 }}>
            📊 <strong style={{ color: C.text }}>Fourchette marché ALANE — {metier}</strong>
          </div>
          {/* Barre visuelle */}
          <div style={{ position: "relative", height: 8, background: "rgba(255,255,255,0.08)", borderRadius: 4, margin: "10px 0 6px" }}>
            {/* Zone marché */}
            <div style={{ position: "absolute", left: pct(tarifInfo.min), width: `calc(${pct(tarifInfo.max)} - ${pct(tarifInfo.min)})`, height: "100%", background: `${C.success}55`, borderRadius: 4 }} />
            {/* Curseur tarif actuel */}
            <div style={{ position: "absolute", left: pct(tarifNet), top: "50%", transform: "translate(-50%, -50%)", width: 14, height: 14, borderRadius: "50%", background: color || C.violet, border: "2px solid #fff", boxShadow: "0 1px 4px rgba(0,0,0,0.4)", transition: "left 0.2s" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.textMuted }}>
            <span>0 €</span>
            <span style={{ color: C.success, fontWeight: 700 }}>{tarifInfo.min} – {tarifInfo.max} €/h</span>
            <span>{barMax} €</span>
          </div>
          <div style={{ marginTop: 8, fontSize: 11, color: tarifNet < tarifInfo.min ? "#F25E5E" : tarifNet > tarifInfo.max ? C.accentGold : C.success, fontWeight: 700 }}>
            {tarifNet < tarifInfo.min ? "⚠️ En dessous du marché" : tarifNet > tarifInfo.max ? "📈 Au-dessus du marché" : "✅ Dans la fourchette marché"}
          </div>
        </div>
      )}

      {/* ── Simulateur de charges ── */}
      <div style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
        <button onClick={() => setOpen(o => !o)} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 14px", background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit" }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: C.text }}>🧮 Simulateur de charges URSSAF</span>
          <span style={{ fontSize: 11, color: C.textMuted }}>{open ? "▲" : "▼"}</span>
        </button>
        {open && (
          <div style={{ padding: "0 14px 14px", borderTop: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 11, color: C.textSub, margin: "10px 0 12px", lineHeight: 1.5 }}>
              Indiquez votre revenu net souhaité. Le simulateur calcule le tarif à facturer selon votre régime.
            </div>

            {/* Régime */}
            <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
              {[["bic", "BIC — Services (12,3 %)"], ["bnc", "BNC — Libéral (21,2 %)"]].map(([val, lbl]) => (
                <button key={val} onClick={() => setRegime(val)} style={{ flex: 1, padding: "8px 6px", borderRadius: 8, border: `1px solid ${regime === val ? color || C.violet : C.border}`, background: regime === val ? `${color || C.violet}18` : "transparent", color: regime === val ? color || C.violet : C.textSub, fontSize: 10, fontWeight: regime === val ? 700 : 400, cursor: "pointer", fontFamily: "inherit", lineHeight: 1.4, textAlign: "center" }}>
                  {lbl}
                </button>
              ))}
            </div>

            {/* Input net souhaité */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: C.textSub, marginBottom: 6 }}>Revenu net souhaité (€/h)</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="number" min={1} max={200} step={0.5}
                  value={netSouhaite}
                  onChange={e => setNetSouhaite(Math.max(1, Number(e.target.value)))}
                  style={{ width: 80, padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.border}`, background: "rgba(255,255,255,0.06)", color: C.text, fontSize: 14, fontWeight: 700, fontFamily: "inherit", textAlign: "center" }}
                />
                <span style={{ color: C.textSub, fontSize: 12 }}>€/h net</span>
              </div>
            </div>

            {/* Résultat */}
            <div style={{ background: "#0D1B3E", borderRadius: 10, padding: "12px 14px", border: `1px solid ${color || C.violet}33` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontSize: 12, color: C.textSub }}>Revenu net</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{netSouhaite.toFixed(2)} €/h</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: C.textSub }}>Charges URSSAF ({(taux * 100).toFixed(1)} %)</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#F25E5E" }}>+{charges.toFixed(2)} €/h</span>
              </div>
              <div style={{ height: 1, background: C.border, marginBottom: 8 }} />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: C.text }}>Tarif à facturer</span>
                <span style={{ fontSize: 17, fontWeight: 800, color: color || C.violet }}>{tarifFact.toFixed(2)} €/h</span>
              </div>
            </div>

            <div style={{ fontSize: 10, color: C.textMuted, marginTop: 8, lineHeight: 1.5 }}>
              * Taux 2024. N'inclut pas la CFE (~200–600 €/an) ni la TVA (franchise en base si CA &lt; 36 800 €).
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function PrestaProfileEditScreen({ onBack }) {
  const [meta, setMeta] = useState(null);
  const [dispos, setDispos] = useState({});
  const [dispoImmediat, setDispoImmediat] = useState(true);
  const [tarifNet, setTarifNet] = useState(13);
  const [langues, setLangues] = useState(["Français"]);
  const [competences, setCompetences] = useState([]);
  const [statutPro, setStatutPro] = useState("auto-entrepreneur");
  const [rayon, setRayon] = useState(20);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [telephone, setTelephone] = useState("");
  const [iban, setIban]           = useState("");
  const [photoUrl, setPhotoUrl]       = useState(null);
  const [photoChanged, setPhotoChanged] = useState(false);
  const [previewUrl, setPreviewUrl]   = useState(null);
  const [photoAuth, setPhotoAuth]     = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);

  useEffect(()=>{
    (async () => {
      const { data: { session } } = await supabase.auth.getSession().catch(() => ({ data: {} }));
      const m = session?.user?.user_metadata || {};
      setMeta(m);
      // La photo vit dans profiles.avatar_url : user_metadata est embarqué dans le JWT,
      // et un data URI y faisait dépasser la limite d'en-tête HTTP (toute requête en 520).
      // Repli sur m.photo_url pour les comptes pas encore migrés.
      if (session?.user?.id) {
        supabase.from("profiles").select("avatar_url").eq("id", session.user.id).single()
          .then(({ data }) => setPhotoUrl(data?.avatar_url || m.photo_url || null));
      }
      // Charge le nouvel objet par jour, ou reconstruit depuis l'ancien format plat
      if (m.dispon_jours_creneaux && Object.keys(m.dispon_jours_creneaux).length > 0) {
        setDispos(m.dispon_jours_creneaux);
      } else if (m.dispon_jours?.length) {
        const rebuilt = {};
        (m.dispon_jours || []).forEach(j => { rebuilt[j] = m.dispon_creneaux || []; });
        setDispos(rebuilt);
      }
      setDispoImmediat(m.dispo_immediat !== false);
      setTarifNet(m.tarif_net || 13);
      setLangues(m.langues?.length ? m.langues : ["Français"]);
      setCompetences(m.competences || []);
      setStatutPro(m.statut_pro || "auto-entrepreneur");
      setRayon(m.zone_km || 20);
      setTelephone(m.telephone||"");
      setIban(m.rib||"");
      setPhotoAuth(m.photo_public_auth || false);
    })();
  },[]);

  const toggle = (arr, setArr, item) =>
    setArr(prev => prev.includes(item) ? prev.filter(x=>x!==item) : [...prev, item]);

  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { showToast("Photo trop lourde (max 10 Mo)"); return; }
    setPhotoUploading(true);
    try {
      // Compression canvas → data URL JPEG 350px max, qualité 0.82
      // Stockée directement dans user_metadata — pas de Storage bucket requis
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (ev) => {
          const img = new Image();
          img.onload = () => {
            const MAX = 350;
            const ratio = Math.min(MAX / img.width, MAX / img.height, 1);
            const canvas = document.createElement("canvas");
            canvas.width  = Math.round(img.width  * ratio);
            canvas.height = Math.round(img.height * ratio);
            canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL("image/jpeg", 0.82));
          };
          img.onerror = reject;
          img.src = ev.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      setPreviewUrl(dataUrl);
      setPhotoUrl(dataUrl);
      setPhotoChanged(true);
      showToast("Photo prête — pensez à enregistrer");
    } catch (err) {
      showToast("Erreur traitement photo : " + (err?.message || "inconnue"));
    }
    setPhotoUploading(false);
  };

  const handleSave = async () => {
    setSaving(true); setSaveError(null); setSessionExpired(false);
    try {
      // Force-refresh session before update to ensure valid token
      const { data: refreshData, error: refreshErr } = await supabase.auth.refreshSession();
      if (refreshErr || !refreshData?.session) {
        setSaving(false);
        setSessionExpired(true);
        return;
      }

      const profileData = {
        dispon_jours: JOURS.filter(j => (dispos[j]||[]).length > 0),
        dispon_jours_creneaux: dispos,
        dispo_immediat: dispoImmediat,
        tarif_net: Number(tarifNet), langues, competences, statut_pro: statutPro, zone_km: rayon,
        telephone, rib: iban,
        photo_public_auth: photoAuth,
        cv: meta?.cv || {},
      };
      // photo_url ne doit JAMAIS retourner dans user_metadata : ce champ est encodé
      // dans le JWT, et un data URI de 60 Ko y dépasse la limite d'en-tête HTTP.
      const { error } = await supabase.auth.updateUser({ data: profileData });
      if (error) {
        if (error.status === 401 || error.message?.toLowerCase().includes("token") || error.message?.toLowerCase().includes("session")) {
          setSaving(false);
          setSessionExpired(true);
          return;
        }
        throw new Error(error.message);
      }

      if (photoChanged) {
        const { data: { session } } = await supabase.auth.getSession();
        const uid = session?.user?.id;
        if (uid) {
          const { error: photoErr } = await supabase.from("profiles").update({ avatar_url: photoUrl }).eq("id", uid);
          if (photoErr) throw new Error("Profil enregistré, mais la photo n'a pas pu être sauvegardée.");
        }
      }

      setSaving(false);
      setSaved(true);
      setTimeout(() => { setSaved(false); onBack(); }, 1200);
    } catch (e) {
      setSaving(false);
      setSaveError(e?.message || "Erreur lors de l'enregistrement.");
      setTimeout(() => setSaveError(null), 5000);
    }
  };

  const secteurInfo = meta?.secteur ? SECTORS.find(s=>s.id===meta?.secteur) : null;
  const color = secteurInfo?.color || C.accentGold;
  const sliderMin = 1;
  const sliderMax = 100;
  const compListe = COMPETENCES_PAR_METIER[meta?.metier] || COMPETENCES_PAR_SECTEUR[meta?.secteur] || [];

  const hasDispos = Object.values(dispos).some(slots => slots.length > 0);
  const completePct = (
    (photoUrl ? 15 : 0) +
    (meta?.bio ? 15 : 0) +
    (tarifNet > 0 ? 10 : 0) +
    (hasDispos ? 20 : 0) +
    (langues.filter(l => l !== "Français").length > 0 ? 10 : 0) +
    (telephone ? 10 : 0) +
    (iban ? 10 : 0) +
    (dispoImmediat ? 10 : 0)
  );
  const completeColor = completePct >= 80 ? "#22c55e" : completePct >= 50 ? "#f59e0b" : "#ef4444";
  // Indicateur coloré : rouge si manquant, couleur secteur si rempli
  const dot = (filled) => <span style={{ color: filled ? color : "#ef4444", fontWeight:700, fontSize:13 }}>●</span>;

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg,#0A1628,#0D1B3E)`, paddingBottom:100 }}>
      <div style={{ background:`linear-gradient(135deg,${color}55,${color}22)`, padding:"52px 22px 22px" }}>
        <button onClick={onBack} style={{ background:"rgba(255,255,255,0.15)", border:"none", borderRadius:10, padding:"7px 14px", color:"#fff", cursor:"pointer", fontSize:13, marginBottom:14 }}>← Retour</button>
        <h2 style={{ color:"#fff", fontSize:20, fontWeight:700, margin:0, fontFamily:font.display }}>✏️ Modifier mon profil</h2>
        {meta?.metier && <div style={{ color:"rgba(255,255,255,0.7)", fontSize:13, marginTop:4 }}>{secteurInfo?.label} · {meta.metier}</div>}
        <div style={{ marginTop:14 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:5 }}>
            <span style={{ color:"rgba(255,255,255,0.75)", fontSize:12, fontWeight:600 }}>Profil complété à</span>
            <span style={{ color:completeColor, fontSize:13, fontWeight:800 }}>{completePct}%</span>
          </div>
          <div style={{ height:6, borderRadius:3, background:"rgba(255,255,255,0.15)", overflow:"hidden" }}>
            <div style={{ height:"100%", width:`${completePct}%`, background:completeColor, borderRadius:3, transition:"width 0.5s" }} />
          </div>
        </div>
      </div>

      <div style={{ padding:"20px 18px" }}>
        {/* Photo de profil */}
        <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"16px", marginBottom:14 }}>
          <label style={{ display:"block", fontSize:12, color:C.textSub, fontWeight:600, marginBottom:12, textTransform:"uppercase", letterSpacing:0.8 }}>
            Photo de profil {dot(!!(previewUrl || photoUrl))}
          </label>
          <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:14 }}>
            <div style={{ width:68, height:68, borderRadius:"50%", background:`${color}22`, border:`2px solid ${color}44`, overflow:"hidden", display:"flex", alignItems:"center", justifyContent:"center", fontSize:30, flexShrink:0 }}>
              {(previewUrl || photoUrl)
                ? <img src={previewUrl || photoUrl} alt="Photo de profil" style={{ width:"100%", height:"100%", objectFit:"cover" }} onError={() => { setPreviewUrl(null); setPhotoUrl(null); showToast("Impossible d'afficher la photo — vérifiez les accès du bucket Supabase"); }} />
                : "📷"}
            </div>
            <div>
              <label style={{ display:"inline-block", padding:"9px 16px", background:`${color}22`, border:`1px solid ${color}55`, borderRadius:10, color, fontWeight:700, fontSize:13, cursor: photoUploading ? "not-allowed" : "pointer" }}>
                {photoUploading ? "Envoi en cours…" : (previewUrl || photoUrl) ? "Changer la photo" : "Ajouter une photo"}
                <input type="file" accept="image/*" style={{ display:"none" }} onChange={handlePhotoUpload} disabled={photoUploading} />
              </label>
              {photoUrl && !previewUrl && <div style={{ color:C.success, fontSize:12, marginTop:6 }}>✓ Photo enregistrée</div>}
              {previewUrl && photoUploading && <div style={{ color:color, fontSize:12, marginTop:6 }}>⏳ Envoi en cours…</div>}
              {previewUrl && !photoUploading && <div style={{ color:C.success, fontSize:12, marginTop:6 }}>✓ Photo prête — enregistrez</div>}
            </div>
          </div>
          <label style={{ display:"flex", alignItems:"flex-start", gap:10, cursor:"pointer" }}>
            <input type="checkbox" checked={photoAuth} onChange={e=>setPhotoAuth(e.target.checked)} style={{ accentColor:color, width:16, height:16, marginTop:2, flexShrink:0 }} />
            <span style={{ color:C.textSub, fontSize:13, lineHeight:1.4 }}>J'autorise l'affichage de ma photo sur mon profil public visible par les clients</span>
          </label>
        </div>

        {/* Tarif */}
        <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"16px", marginBottom:14 }}>
          <label style={{ display:"block", fontSize:12, color:C.textSub, fontWeight:600, marginBottom:12, textTransform:"uppercase", letterSpacing:0.8 }}>
            Tarif horaire net : <span style={{ color, fontWeight:800, fontSize:15 }}>{Number(tarifNet).toFixed(2)} €/h</span>
          </label>
          <input type="range" min={sliderMin} max={sliderMax} step={0.5} value={tarifNet} onChange={e=>setTarifNet(Number(e.target.value))} style={{ width:"100%", accentColor:color, marginBottom:6 }} />
          <div style={{ display:"flex", justifyContent:"space-between", color:C.textMuted, fontSize:11 }}><span>{sliderMin} €</span><span>{sliderMax} €</span></div>
          <TarifSimulateur secteur={meta?.secteur} metier={meta?.metier} tarifNet={tarifNet} color={color} />
        </div>

        {/* Disponibilités par jour */}
        <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"16px", marginBottom:14 }}>
          <div style={{ fontWeight:700, color:C.text, fontSize:13, marginBottom:4 }}>📅 Disponibilités {dot(hasDispos)}</div>
          <div style={{ color:C.textSub, fontSize:12, marginBottom:14 }}>Sélectionnez vos créneaux jour par jour</div>
          {JOURS.map(jour => {
            const sel = dispos[jour] || [];
            const hasSel = sel.length > 0;
            return (
              <div key={jour} style={{ marginBottom:8, borderRadius:10, border:`2px solid ${hasSel?color:C.border}`, overflow:"hidden", transition:"border-color 0.2s" }}>
                <div style={{ padding:"9px 13px", background:hasSel?`${color}10`:"transparent", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                  <span style={{ fontWeight:700, color:hasSel?color:C.text, fontSize:13 }}>{jour}</span>
                  {hasSel
                    ? <span style={{ fontSize:11, color:color, fontWeight:600 }}>{sel.map(c=>c.split(" ")[0]).join(" · ")}</span>
                    : <span style={{ color:C.textSub, fontSize:11 }}>Non disponible</span>}
                </div>
                <div style={{ padding:"7px 13px", display:"flex", gap:6, flexWrap:"wrap", borderTop:`1px solid ${C.border}`, background:"rgba(0,0,0,0.1)" }}>
                  {PLAGES.map(plage => {
                    const active = sel.includes(plage);
                    return (
                      <button key={plage} onClick={()=>setDispos(prev=>{ const cur=prev[jour]||[]; return {...prev,[jour]:active?cur.filter(x=>x!==plage):[...cur,plage]}; })}
                        style={{ padding:"6px 12px", borderRadius:8, border:"none", cursor:"pointer", fontFamily:"inherit", fontSize:12, fontWeight:active?700:500, background:active?color:"rgba(255,255,255,0.07)", color:active?C.white:C.textSub, transition:"all 0.15s" }}>
                        {plage.split(" ")[0]}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          <div style={{ height:8 }} />
          <div onClick={()=>setDispoImmediat(!dispoImmediat)} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", cursor:"pointer" }}>
            <span style={{ color:C.text, fontSize:13 }}>Disponible immédiatement</span>
            <div style={{ width:40, height:22, borderRadius:11, background:dispoImmediat?color:"rgba(255,255,255,0.15)", position:"relative", transition:"background 0.2s" }}>
              <div style={{ position:"absolute", top:2, left:dispoImmediat?20:2, width:18, height:18, borderRadius:"50%", background:"#fff", transition:"left 0.2s" }} />
            </div>
          </div>
        </div>

        {/* Langues */}
        <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"16px", marginBottom:14 }}>
          <div style={{ fontWeight:700, color:C.text, fontSize:13, marginBottom:12 }}>🌐 Langues parlées</div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
            {LANGUES_LIST.map(l=>(
              <button key={l} onClick={()=>{ if(l==="Français") return; toggle(langues,setLangues,l); }} style={{ padding:"7px 12px", borderRadius:100, border:`1px solid ${langues.includes(l)?color:C.border}`, background:langues.includes(l)?`${color}25`:"transparent", color:langues.includes(l)?color:C.textSub, fontSize:12, fontWeight:langues.includes(l)?700:400, cursor:l==="Français"?"default":"pointer", fontFamily:"inherit", opacity:l==="Français"?0.6:1 }}>{l}{l==="Français"?" ✓":""}</button>
            ))}
          </div>
        </div>

        {/* Compétences */}
        {compListe.length > 0 && (
          <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"16px", marginBottom:14 }}>
            <div style={{ fontWeight:700, color:C.text, fontSize:13, marginBottom:4 }}>🎯 Vos spécialités</div>
            <div style={{ fontSize:11, color:C.textSub, marginBottom:12, lineHeight:1.5 }}>Sélectionnez ce que vous maîtrisez — ces tags apparaissent sur votre profil et aident les clients à vous trouver</div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
              {compListe.map(c=>(
                <button key={c} onClick={()=>toggle(competences,setCompetences,c)} style={{ padding:"7px 12px", borderRadius:100, border:`1px solid ${competences.includes(c)?color:C.border}`, background:competences.includes(c)?`${color}25`:"transparent", color:competences.includes(c)?color:C.textSub, fontSize:12, fontWeight:competences.includes(c)?700:400, cursor:"pointer", fontFamily:"inherit", transition:"all 0.2s" }}>{c}</button>
              ))}
            </div>
          </div>
        )}

        {/* Rayon géographique */}
        <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"16px", marginBottom:20 }}>
          <div style={{ fontWeight:700, color:C.text, fontSize:13, marginBottom:12 }}>📍 Rayon d'intervention</div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:10 }}>
            {["5","10","20","30","50","100"].map(km=>(
              <button key={km} onClick={()=>setRayon(parseInt(km))} style={{ padding:"9px 16px", borderRadius:20, border:"none", cursor:"pointer", background:rayon===parseInt(km)?color:C.grayLight, color:rayon===parseInt(km)?C.white:C.text, fontWeight:700, fontSize:13, fontFamily:"inherit" }}>{km} km</button>
            ))}
          </div>
          <p style={{ color:color, fontSize:12, fontWeight:700, margin:0 }}>Zone : {rayon} km autour de chez vous</p>
        </div>

        {/* Statut pro */}
        <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"16px", marginBottom:20 }}>
          <div style={{ fontWeight:700, color:C.text, fontSize:13, marginBottom:12 }}>🧾 Statut professionnel</div>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {[
              { id:"auto-entrepreneur", label:"Auto-entrepreneur / Micro-entreprise", icon:"🧾" },
            ].map(s=>(
              <button key={s.id} onClick={()=>setStatutPro(s.id)} style={{ padding:"12px 14px", borderRadius:r, border:`2px solid ${statutPro===s.id?color:C.border}`, background:statutPro===s.id?`${color}20`:"rgba(255,255,255,0.03)", cursor:"pointer", fontFamily:"inherit", textAlign:"left", display:"flex", gap:10, alignItems:"center", transition:"all 0.2s" }}>
                <span style={{ fontSize:16 }}>{s.icon}</span>
                <span style={{ color:statutPro===s.id?color:C.text, fontWeight:statutPro===s.id?700:500, fontSize:13 }}>{s.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Coordonnées */}
        <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"16px", marginBottom:14 }}>
          <div style={{ fontWeight:700, color:C.text, fontSize:13, marginBottom:12 }}>📞 Coordonnées & paiement {dot(!!(telephone && iban))}</div>
          {meta?.date_naissance && (
            <div style={{ marginBottom:14 }}>
              <div style={{ fontSize:12, color:C.textSub, fontWeight:600, marginBottom:4 }}>🎂 Date de naissance</div>
              <div style={{ background:"#050E20", border:`1px solid ${C.border}`, borderRadius:10, padding:"11px 14px", color:C.textMuted, fontSize:14 }}>
                {(() => {
                  const dob = new Date(meta.date_naissance);
                  const today = new Date();
                  const age = today.getFullYear() - dob.getFullYear() - (today < new Date(today.getFullYear(), dob.getMonth(), dob.getDate()) ? 1 : 0);
                  return `${dob.toLocaleDateString("fr-FR")} · ${age} ans`;
                })()}
              </div>
              <div style={{ fontSize:11, color:C.textMuted, marginTop:4 }}>Non modifiable — contactez le support si erreur.</div>
            </div>
          )}
          <Input label="Téléphone" placeholder="06 12 34 56 78" icon="📱" value={telephone} onChange={e=>setTelephone(formatPhone(e.target.value))} />
          <IbanInput label="IBAN (pour recevoir vos virements)" placeholder="FR76 3000 6000 0112 3456 7890 189" value={iban} onChange={e=>setIban(e.target.value.toUpperCase())} />
        </div>

        {/* CV */}
        <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"16px", marginBottom:20 }}>
          <div style={{ fontWeight:700, color:C.text, fontSize:13, marginBottom:4 }}>📄 Mon parcours</div>
          <div style={{ color:C.textSub, fontSize:12, marginBottom:14, lineHeight:1.5 }}>Renseignez votre parcours pour qu'il soit visible par les clients sur votre profil.</div>
          <CvEditor cv={meta?.cv||{}} onChange={newCv=>setMeta(m=>({...m,cv:newCv}))} color={color} />
        </div>

        {sessionExpired && (
          <div style={{ background:"rgba(242,94,94,0.12)", border:"1px solid rgba(242,94,94,0.5)", borderRadius:12, padding:"14px 16px", marginBottom:12, textAlign:"center" }}>
            <div style={{ color:"#F25E5E", fontWeight:700, fontSize:13, marginBottom:10 }}>⚠️ Session expirée — vous devez vous reconnecter</div>
            <button onClick={async () => { await supabase.auth.signOut(); }} style={{ padding:"10px 20px", borderRadius:10, border:"none", background:"#F25E5E", color:"#fff", fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
              Se déconnecter
            </button>
          </div>
        )}
        {saveError && <div style={{ background:"rgba(242,94,94,0.12)", border:"1px solid rgba(242,94,94,0.4)", borderRadius:10, padding:"10px 14px", marginBottom:12, fontSize:13, color:"#F25E5E", textAlign:"center" }}>❌ {saveError}</div>}
        <Btn full onClick={handleSave} disabled={saving || sessionExpired} style={{ background:saveError?C.accent:color, boxShadow:`0 8px 24px ${color}44`, padding:"16px", fontSize:15 }}>
          {saving ? "Enregistrement…" : saved ? "✅ Sauvegardé !" : "Enregistrer les modifications"}
        </Btn>
      </div>
    </div>
  );
}

export function PrestaPointageScreen({ provider, type, onSuccess, onBack }) {
  const p = provider || {};
  const expectedCode = provider ? genMissionCode(p.id, type) : "";
  const isIn = type === "in";

  const [gpsStatus, setGpsStatus] = useState("loading"); // loading | ok | warning | error
  const [gpsDistance, setGpsDistance] = useState(null);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!provider || !navigator.geolocation) { setGpsStatus("error"); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const missionCoords = cpToCoords(p.code_postal || "75");
        if (missionCoords) {
          const dist = haversineKm(pos.coords.latitude, pos.coords.longitude, missionCoords[0], missionCoords[1]);
          setGpsDistance(dist);
          setGpsStatus(dist <= 0.5 ? "ok" : "warning");
        } else {
          setGpsStatus("ok");
        }
      },
      () => setGpsStatus("error"),
      { timeout: 8000, enableHighAccuracy: true }
    );
  }, []);

  if (!provider) return <div style={{ padding:40, textAlign:"center", color:C.textSub }}>Prestation introuvable.</div>;

  const handleValidate = () => {
    if (code.trim() !== expectedCode) {
      setCodeError("Code incorrect. Vérifiez avec le client.");
      return;
    }
    setDone(true);
    const key = `alane_pointage_${p.id}_${new Date().toISOString().slice(0,10)}`;
    try { localStorage.setItem(key, isIn ? "checkin" : "checkout"); } catch { /* ignore */ }
    setTimeout(() => onSuccess && onSuccess(), 2000);
  };

  if (done) return (
    <div style={{ minHeight:"100%", background:`linear-gradient(160deg,${C.success},#1a7a40)`, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:32, textAlign:"center" }}>
      <div style={{ fontSize:72, marginBottom:16 }}>{isIn ? "✅" : "🏁"}</div>
      <h2 style={{ color:C.white, fontSize:24, fontWeight:800, margin:"0 0 10px", fontFamily:font.display }}>{isIn ? "Arrivée confirmée !" : "Départ confirmé !"}</h2>
      <p style={{ color:"rgba(255,255,255,0.8)", fontSize:14, lineHeight:1.8, maxWidth:280, margin:"0 auto" }}>
        {isIn ? "Votre présence est enregistrée. Bonne prestation !" : "Prestation terminée. En attente de validation."}
      </p>
    </div>
  );

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg,#0A1628,#0D1B3E)`, paddingBottom:40 }}>
      <div style={{ background:"linear-gradient(135deg,#0A1628,#162547)", borderBottom:`1px solid ${C.border}`, padding:"52px 22px 24px" }}>
        <button onClick={onBack} style={{ background:"transparent", border:"none", color:C.textSub, cursor:"pointer", fontSize:13, marginBottom:14 }}>← Retour</button>
        <h2 style={{ color:C.text, fontSize:22, fontWeight:700, margin:"0 0 4px", fontFamily:font.display }}>{isIn ? "📍 Pointer mon arrivée" : "🏁 Pointer mon départ"}</h2>
        <p style={{ color:C.textSub, fontSize:13, margin:0 }}>{p.name} · Cariste CACES 1 · Entrepôt XYZ</p>
      </div>

      <div style={{ padding:"22px 18px" }}>
        {/* Étape 1 — GPS */}
        <div style={{ background:"#0D1B3E", border:`1px solid ${gpsStatus==="ok"?C.success:gpsStatus==="warning"?"#FFA500":C.border}`, borderRadius:r, padding:"16px", marginBottom:16 }}>
          <div style={{ display:"flex", gap:12, alignItems:"center" }}>
            <div style={{ width:44, height:44, borderRadius:12, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22,
              background: gpsStatus==="ok" ? `${C.success}22` : gpsStatus==="warning" ? "rgba(255,165,0,0.15)" : "rgba(255,255,255,0.05)" }}>
              {gpsStatus==="loading" ? "📡" : gpsStatus==="ok" ? "✅" : gpsStatus==="warning" ? "⚠️" : "❌"}
            </div>
            <div>
              <div style={{ fontWeight:700, color:C.text, fontSize:14 }}>Vérification GPS</div>
              <div style={{ color:C.textSub, fontSize:12, marginTop:2 }}>
                {gpsStatus==="loading" && "Localisation en cours…"}
                {gpsStatus==="ok" && `Vous êtes sur place (${gpsDistance !== null ? gpsDistance+" km" : "< 500m"} du lieu de prestation)`}
                {gpsStatus==="warning" && `Vous semblez éloigné du lieu (${gpsDistance} km). Vérifiez votre position.`}
                {gpsStatus==="error" && "GPS indisponible. Continuez avec le code client."}
              </div>
            </div>
          </div>
        </div>

        {/* Étape 2 — Code client */}
        <div style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r, padding:"18px", marginBottom:20 }}>
          <div style={{ fontWeight:700, color:C.text, fontSize:14, marginBottom:4 }}>🔢 Code client</div>
          <p style={{ color:C.textSub, fontSize:12, margin:"0 0 16px", lineHeight:1.6 }}>
            Demandez au client le code {isIn ? "d'arrivée" : "de départ"} affiché dans son application.
          </p>
          <div style={{ display:"flex", gap:10, justifyContent:"center", marginBottom:16 }}>
            {[0,1,2,3].map(i => (
              <div key={i} style={{ width:56, height:64, borderRadius:r, border:`2px solid ${code[i] ? C.violet : C.border}`, background: code[i] ? `${C.violet}18` : "rgba(255,255,255,0.03)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:28, fontWeight:900, color:C.text, fontFamily:"monospace" }}>
                {code[i] || "—"}
              </div>
            ))}
          </div>
          {/* Pavé numérique */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8, maxWidth:240, margin:"0 auto" }}>
            {[1,2,3,4,5,6,7,8,9,"",0,"⌫"].map((k,i) => (
              <button key={i} disabled={k===""} onClick={() => {
                if (k === "⌫") { setCode(c => c.slice(0,-1)); setCodeError(""); }
                else if (code.length < 4) { setCode(c => c + k); setCodeError(""); }
              }} style={{ padding:"14px", borderRadius:r, border:`1px solid ${C.border}`, background: k===""?"transparent":"#162547", color:C.text, fontSize:18, fontWeight:700, cursor:k===""?"default":"pointer", fontFamily:"monospace", opacity:k===""?0:1 }}>
                {k}
              </button>
            ))}
          </div>
          {codeError && <p style={{ color:C.accent, fontSize:12, textAlign:"center", marginTop:10 }}>{codeError}</p>}
        </div>

        <Btn full disabled={code.length < 4 || gpsStatus==="loading"}
          onClick={handleValidate}
          style={{ fontSize:15, padding:"16px", background: isIn ? C.success : C.accentGold, boxShadow:`0 8px 24px ${isIn?C.success:C.accentGold}44` }}>
          {isIn ? "✅ Confirmer mon arrivée" : "🏁 Confirmer mon départ"}
        </Btn>
        {gpsStatus === "warning" && (
          <p style={{ color:"#FFA500", fontSize:11, textAlign:"center", marginTop:8, lineHeight:1.5 }}>
            ⚠️ Votre position GPS est éloignée. L'alerte sera enregistrée.
          </p>
        )}
      </div>
    </div>
  );
}

export function PrestaOnboardingChecklist({ onNavigate }) {
  const [meta, setMeta] = useState(null);
  const [dismissed, setDismissed] = useState(() => { try { return localStorage.getItem("alane_presta_checklist_dismissed") === "1"; } catch { return false; } });

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMeta(data?.user?.user_metadata || {}));
  }, []);

  if (dismissed || !meta) return null;

  const items = [
    { id:"secteur",  label:"Secteur d'activité choisi",   done:!!meta.secteur,               action:"presta_profile_edit" },
    { id:"metier",   label:"Métier renseigné",             done:!!meta.metier,                 action:"presta_profile_edit" },
    { id:"dispos",   label:"Disponibilités configurées",   done:!!(meta.dispon_jours?.length), action:"presta_profile_edit" },
    { id:"tarif",    label:"Tarif horaire défini",         done:!!meta.tarif_net,              action:"presta_profile_edit" },
    { id:"rib",      label:"IBAN renseigné",               done:!!meta.rib,                    action:"settings"            },
  ];

  const doneCount = items.filter(i => i.done).length;
  if (doneCount === items.length) return null;
  const pct = Math.round((doneCount / items.length) * 100);

  return (
    <div style={{ background:"linear-gradient(135deg,#0D1B3E,#162547)", border:`1px solid ${C.violet}44`, borderRadius:16, padding:"16px", marginBottom:18 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
        <div>
          <div style={{ fontWeight:800, color:C.text, fontSize:13 }}>🚀 Premiers pas</div>
          <div style={{ color:C.textSub, fontSize:11, marginTop:2 }}>{doneCount}/{items.length} étapes complétées</div>
        </div>
        <button onClick={() => { try { localStorage.setItem("alane_presta_checklist_dismissed","1"); } catch { /* ignore */ } setDismissed(true); }} style={{ background:"none", border:"none", color:C.textMuted, cursor:"pointer", fontSize:20, lineHeight:1, padding:"0 0 0 8px" }}>×</button>
      </div>
      <div style={{ background:"rgba(255,255,255,0.08)", borderRadius:99, height:6, marginBottom:14, overflow:"hidden" }}>
        <div style={{ width:`${pct}%`, height:"100%", background:`linear-gradient(90deg,${C.violet},${C.violetLight})`, borderRadius:99, transition:"width 0.5s" }} />
      </div>
      {items.map((item, idx) => (
        <div key={item.id}
          onClick={() => !item.done && onNavigate(item.action)}
          style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 0", borderBottom: idx < items.length-1 ? `1px solid rgba(255,255,255,0.05)` : "none", cursor:item.done?"default":"pointer" }}>
          <div style={{ width:22, height:22, borderRadius:"50%", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:800,
            background: item.done ? `${C.success}22` : `${C.violet}22`,
            border: `1.5px solid ${item.done ? C.success : C.violet}66`,
            color: item.done ? C.success : C.violet }}>
            {item.done ? "✓" : "→"}
          </div>
          <span style={{ flex:1, fontSize:13, color:item.done?C.textSub:C.text, fontWeight:item.done?400:600, textDecoration:item.done?"line-through":"none" }}>{item.label}</span>
          {!item.done && <span style={{ color:C.violet, fontSize:11, fontWeight:700, flexShrink:0 }}>Compléter →</span>}
        </div>
      ))}
    </div>
  );
}

export function TrialExhaustedPaywall({ onUpgrade, onUnblocked }) {
  const [checking, setChecking] = useState(false);
  const handleRetry = async () => {
    setChecking(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setChecking(false); return; }
      // Appel backend : vérifie Stripe + guérit DB si plan payant
      const res = await fetch("/api/missions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session.access_token}` },
        body: JSON.stringify({ action: "refresh_plan" }),
      });
      if (res.ok) {
        const data = await res.json();
        if (!data.trial_exhausted || (data.plan && data.plan !== "free")) {
          onUnblocked?.();
          return;
        }
      }
    } catch { /* ignore */ }
    setChecking(false);
  };
  return (
    <div style={{ position:"fixed", inset:0, background:"#050E20", zIndex:8000, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:28, textAlign:"center" }}>
      <div style={{ fontSize:64, marginBottom:20 }}>🔒</div>
      <h2 style={{ color:"#fff", fontSize:22, fontWeight:900, margin:"0 0 10px", fontFamily:"inherit" }}>Accès suspendu</h2>
      <p style={{ color:"rgba(255,255,255,0.55)", fontSize:14, lineHeight:1.7, maxWidth:300, margin:"0 auto 8px" }}>
        Votre offre gratuite a été entièrement utilisée ce mois-ci.
      </p>
      <p style={{ color:"rgba(255,255,255,0.35)", fontSize:12, lineHeight:1.6, maxWidth:280, margin:"0 auto 32px" }}>
        Pour continuer à accéder aux prestations, choisissez un abonnement Premium ou Elite. Le quota gratuit se réinitialise le 1er de chaque mois.
      </p>
      <div style={{ display:"flex", flexDirection:"column", gap:12, width:"100%", maxWidth:320 }}>
        <button onClick={onUpgrade} style={{ padding:"16px", borderRadius:14, border:"none", background:"linear-gradient(135deg,#7C6FE0,#5B4FCF)", color:"#fff", fontWeight:800, fontSize:16, cursor:"pointer", fontFamily:"inherit", boxShadow:"0 4px 20px rgba(124,111,224,0.4)" }}>
          💎 Voir les abonnements
        </button>
        <button onClick={handleRetry} disabled={checking} style={{ padding:"13px", borderRadius:14, border:"1px solid rgba(16,217,143,0.3)", background:"rgba(16,217,143,0.06)", color:"#10D98F", fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit", opacity:checking?0.6:1 }}>
          {checking ? "Vérification…" : "🔄 Vérifier mon accès"}
        </button>
        <button onClick={async()=>{ await supabase.auth.signOut(); }} style={{ padding:"13px", borderRadius:14, border:"1px solid rgba(255,255,255,0.12)", background:"transparent", color:"rgba(255,255,255,0.4)", fontWeight:600, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
          Se déconnecter
        </button>
      </div>
    </div>
  );
}

export function UpgradeNudge({ onNavigate, plan: planProp }) {
  const [plan, setPlan] = useState(null);
  const [trialExhausted, setTrialExhausted] = useState(false);
  useEffect(() => {
    // N'effectue la requête que si le parent n'a pas fourni de plan
    if (planProp !== undefined) return;
    supabase.auth.getUser().then(({ data }) => {
      const uid = data?.user?.id;
      const metaPlan = data?.user?.user_metadata?.plan_abonnement || "free";
      if (uid) {
        supabase.from("profiles").select("trial_exhausted,plan_abonnement").eq("id", uid).single()
          .then(({ data: p }) => {
            const RANK = { free:0, premium:1, elite:2 };
            const pp = p?.plan_abonnement || "free";
            const resolvedPlan = (RANK[metaPlan]||0) > (RANK[pp]||0) ? metaPlan : pp;
            setPlan(resolvedPlan);
            if (resolvedPlan !== "free") setTrialExhausted(false);
            else if (p?.trial_exhausted) setTrialExhausted(true);
          });
      } else {
        setPlan(metaPlan);
      }
    });
  }, [planProp]);
  const effectivePlan = planProp !== undefined ? planProp : plan;
  if (effectivePlan === null) return null;
  if (effectivePlan !== "free") return null;
  if (trialExhausted) {
    return (
      <div onClick={() => onNavigate("abonnement_presta")} style={{ background:`linear-gradient(135deg,rgba(242,94,94,0.12),rgba(240,180,41,0.08))`, border:`1px solid rgba(242,94,94,0.4)`, borderRadius:r, padding:"13px 16px", marginBottom:14, cursor:"pointer", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div>
          <div style={{ fontWeight:700, color:"#F25E5E", fontSize:13 }}>⛔ Prestations gratuites épuisées</div>
          <div style={{ color:C.textSub, fontSize:11, marginTop:2 }}>Votre quota gratuit a déjà été utilisé. Passez Premium pour accéder aux prestations.</div>
        </div>
        <span style={{ color:C.violet, fontWeight:700, fontSize:13 }}>29€/mois ›</span>
      </div>
    );
  }
  return (
    <div onClick={() => onNavigate("abonnement_presta")} style={{ background:`linear-gradient(135deg,${C.violet}20,${C.accentGold}15)`, border:`1px solid ${C.violet}44`, borderRadius:r, padding:"13px 16px", marginBottom:14, cursor:"pointer", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
      <div>
        <div style={{ fontWeight:700, color:C.text, fontSize:13 }}>💎 Passez Premium</div>
        <div style={{ color:C.textSub, fontSize:11, marginTop:2 }}>Prestations illimitées · Badge vérifié · Urgences</div>
      </div>
      <span style={{ color:C.violet, fontWeight:700, fontSize:13 }}>29€/mois ›</span>
    </div>
  );
}

function DeadlineCountdown({ deadline }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!deadline) return null;
  const secs = Math.floor((new Date(deadline).getTime() - now) / 1000);
  const label = secs <= 0 ? "Délai dépassé" : (() => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    return h > 0 ? `${h}h ${String(m).padStart(2,"0")}min restant` : `${String(m).padStart(2,"0")}min restant`;
  })();
  const expired = secs <= 0;
  return (
    <div style={{ textAlign:"right", flexShrink:0 }}>
      <span style={{ fontSize:11, color:expired?C.textMuted:C.accentGold, fontWeight:700 }}>⏱ {label}</span>
    </div>
  );
}

function ElapsedTimer({ startedAt, maxMs, onEnd }) {
  const [now, setNow] = useState(Date.now());
  const onEndFiredRef = useRef(false);
  const prevMaxMsRef = useRef(maxMs);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  // Reset fired flag when maxMs increases (extra hours accepted)
  useEffect(() => {
    if (maxMs > prevMaxMsRef.current) {
      onEndFiredRef.current = false;
    }
    prevMaxMsRef.current = maxMs;
  }, [maxMs]);
  const elapsed = Math.min(now - new Date(startedAt).getTime(), maxMs);
  const done = elapsed >= maxMs;
  useEffect(() => {
    if (done && !onEndFiredRef.current) {
      onEndFiredRef.current = true;
      onEnd?.();
    }
  }, [done]); // eslint-disable-line react-hooks/exhaustive-deps
  const s = Math.floor(elapsed / 1000);
  const ph = Math.floor(s / 3600);
  const pm = Math.floor((s % 3600) / 60);
  const ps = s % 60;
  const timerStr = ph > 0 ? `${ph}h${String(pm).padStart(2,"0")}` : `${String(pm).padStart(2,"0")}:${String(ps).padStart(2,"0")}`;
  const col = done ? "#F0B429" : C.success;
  return (
    <div style={{ background:`${col}12`, border:`1px solid ${col}40`, borderRadius:10, padding:"10px 14px", marginBottom:10, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
      <div>
        <div style={{ color:col, fontWeight:700, fontSize:12 }}>{done ? "✓ Temps écoulé" : "🚀 Prestation en cours"}</div>
        <div style={{ color:C.textSub, fontSize:11, marginTop:2 }}>Démarrée à {new Date(startedAt).toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"})}</div>
      </div>
      <div style={{ textAlign:"right" }}>
        <div style={{ color:col, fontWeight:800, fontSize:18, fontVariantNumeric:"tabular-nums" }}>{timerStr}</div>
        <div style={{ color:C.textMuted, fontSize:10 }}>{done ? "durée totale" : "écoulé"}</div>
      </div>
    </div>
  );
}

export function PMissionsTab({ onNavigate }) {
  // Tarif proposé pour une prolongation, par prestation. Vide = le tarif
  // habituel du prestataire.
  const [tarifSupp, setTarifSupp] = useState({});
  const [pendingMissions, setPendingMissions] = useState([]);
  const [assignedMissions, setAssignedMissions] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [renderTick, setRenderTick] = useState(0);
  const [userId, setUserId]       = useState(null);
  const [userName, setUserName]   = useState("");
  const [actioning, setActioning] = useState(null);
  const [confirmRefuse, setConfirmRefuse] = useState(null);
  const [expandedDetail, setExpandedDetail] = useState(null);
  const [contractMission, setContractMission] = useState(null);
  const [contractSignedAt, setContractSignedAt] = useState({});
  const [contractAcceptMission, setContractAcceptMission] = useState(null);
  const [validatingMission, setValidatingMission] = useState(null);
  const [validatedSummary, setValidatedSummary] = useState(null);
  // Le partage de position était un simple état React : perdu à chaque
  // rechargement, le bouton réaffichait « Partager ma position » alors que la
  // dernière position restait visible côté client. Le prestataire pouvait donc
  // croire avoir coupé le partage sans que ce soit le cas — question de
  // consentement autant que de cohérence d'affichage.
  const [sharingLocation, setSharingLocation] = useState(() => {
    try { return JSON.parse(localStorage.getItem("alane_partage_position") || "{}"); }
    catch { return {}; }
  });
  useEffect(() => {
    try { localStorage.setItem("alane_partage_position", JSON.stringify(sharingLocation)); }
    catch { /* stockage indisponible : le partage reste actif pour la session */ }
  }, [sharingLocation]);
  const [checkingInId, setCheckingInId] = useState(null);
  const [arrivedAtMap, setArrivedAtMap] = useState({});
  const [checkInGeoError, setCheckInGeoError] = useState({});
  const [startedAtMap, setStartedAtMap] = useState({});
  const [startingMission, setStartingMission] = useState(null);
  const [missionCoordCache, setMissionCoordCache] = useState({});
  const arrivedAtMapRef = useRef({});
  const autoCheckinLockRef = useRef(new Set());
  const geocodedRef = useRef(new Set());
  const geoWatchRef = useRef(null);
  const [trialExhausted, setTrialExhausted] = useState(false);
  const [userPlan, setUserPlan] = useState("free");
  // Remplacement (CGPS art. 9) : id de la prestation dont on ouvre la modale,
  // et demandes déjà en attente pour ne pas en proposer deux.
  const [remplacementPour, setRemplacementPour] = useState(null);
  const [remplacementsEnCours, setRemplacementsEnCours] = useState({});

  const chargerRemplacements = async () => {
    try {
      const { data: sd } = await supabase.auth.getSession();
      if (!sd?.session?.access_token) return;
      const r = await fetch("/api/missions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${sd.session.access_token}` },
        body: JSON.stringify({ action: "mes_remplacements" }),
      });
      const j = await r.json().catch(() => ({}));
      const parMission = {};
      for (const d of (j.remplacements || [])) {
        if (d.role === "sortant") parMission[d.mission_id] = d;
      }
      setRemplacementsEnCours(parMission);
    } catch (e) {
      // Échec silencieux acceptable : le bouton reste proposé, et le serveur
      // refusera une seconde demande (index unique). Journalisé pour le suivi.
      console.error("[remplacements] chargement échoué :", e.message);
    }
  };
  useEffect(() => { chargerRemplacements(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const toggleTracking = async (missionId) => {
    // Plus rien à arrêter : il n'y a plus de suivi en cours, seulement des envois
    // ponctuels. Un second clic renvoie la position plutôt que de couper quelque
    // chose qui ne tourne pas.
    if (!navigator.geolocation) { showToast("Géolocalisation non supportée par votre navigateur."); return; }
    // Le serveur refuse la position hors de la fenêtre de la prestation : elle
    // s'ouvre une heure avant le début. On attend donc sa réponse pour dire au
    // prestataire ce qui s'est réellement passé — un « position transmise »
    // affiché sans regarder le résultat lui faisait croire que le client la
    // voyait, alors qu'elle n'était pas enregistrée.
    const sendPos = async (lat, lng) => {
      const { data: sd } = await supabase.auth.getSession();
      const token = sd?.session?.access_token;
      if (!token) return;
      try {
        const r = await fetch("/api/missions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
          body: JSON.stringify({ action: "update_position", mission_id: missionId, lat, lng }),
        });
        const j = await r.json().catch(() => ({}));
        if (j?.success) {
          showToast("Position transmise au client.", "success");
          setSharingLocation(s => ({ ...s, [missionId]: true }));
        } else {
          showToast(j?.error || "La position n'a pas pu être transmise.");
        }
      } catch (e) {
        console.error("[position] envoi échoué :", e.message);
        showToast("Erreur réseau — la position n'a pas été transmise.");
      }
    };
    // UN SEUL RELEVÉ, à la demande — plus de suivi continu.
    //
    // La position était transmise toutes les quinze secondes pendant toute la
    // prestation. Le conseil prudentiel recommande de la réduire au strict
    // nécessaire : un tel suivi ressemble à un contrôle des horaires, et
    // l'article 10C.3 des CGPS affirme précisément le contraire — les
    // déclarations ne constituent « ni un décompte du temps de travail, ni un
    // dispositif de contrôle des horaires ». Une clause qui dit l'inverse de ce
    // que fait le produit ne protège personne.
    //
    // Le client garde ce qui lui sert : savoir que son prestataire est en route,
    // et où il en est au moment où il le demande.
    navigator.geolocation.getCurrentPosition(
      p => { sendPos(p.coords.latitude, p.coords.longitude); },
      () => showToast("Position indisponible — vérifiez les autorisations de votre navigateur."),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const loadPending = async () => {
    const { data: sd } = await supabase.auth.getSession();
    const token = sd?.session?.access_token;
    if (!token) return;
    try {
      const r = await fetch("/api/missions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ action: "my_missions" }),
      });
      const data = await r.json();
      setPendingMissions(Array.isArray(data.pending)  ? data.pending.filter(m => m.status !== "cancelled")  : []);
      const assigned = Array.isArray(data.assigned) ? data.assigned.filter(m => m.status !== "cancelled") : [];
      setAssignedMissions(assigned);
      const arrivedMap = {};
      const startedMap = {};
      assigned.forEach(m => {
        if (m.arrived_at) arrivedMap[m.id] = m.arrived_at;
        if (m.started_at) startedMap[m.id] = m.started_at;
      });
      setArrivedAtMap(prev => { const n = { ...prev, ...arrivedMap }; arrivedAtMapRef.current = n; return n; });
      setStartedAtMap(prev => ({ ...prev, ...startedMap }));
    } catch { /* ignore */ }
  };

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const u = data?.user;
        if (!u) { setLoading(false); return; }
        setUserId(u.id);
        const meta = u.user_metadata || {};
        setUserName([meta.prenom, meta.nom].filter(Boolean).join(" ") || "");
        supabase.from("profiles").select("trial_exhausted,plan_abonnement").eq("id", u.id).single()
          .then(({ data: pr }) => {
            const RANK = { free:0, premium:1, elite:2 };
            const pp = pr?.plan_abonnement || "free";
            const mp = meta.plan_abonnement || "free";
            const plan = (RANK[mp]||0) > (RANK[pp]||0) ? mp : pp;
            setUserPlan(plan);
            if (plan !== "free") setTrialExhausted(false);
            else if (pr?.trial_exhausted) setTrialExhausted(true);
          });
        await loadPending();
      } catch { /* profil ou docs en attente indisponibles → l'écran s'affiche quand même */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!userId) return;
    const t = setInterval(loadPending, 30000);
    return () => clearInterval(t);
  }, [userId]);

  // Ticker 30s pour recalculer isPast / badge sans attendre un refresh
  useEffect(() => {
    const t = setInterval(() => setRenderTick(n => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`pmissions_${userId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "missions" }, () => loadPending())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, () => loadPending())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId]);

  // Sync arrivedAtMap to ref so GPS callbacks always see fresh value
  useEffect(() => { arrivedAtMapRef.current = arrivedAtMap; }, [arrivedAtMap]);


  // Geocode mission addresses for auto-checkin detection
  useEffect(() => {
    for (const m of assignedMissions) {
      if (geocodedRef.current.has(m.id)) continue;
      if (arrivedAtMap[m.id]) { geocodedRef.current.add(m.id); continue; }
      const addr = [m.adresse, m.ville].filter(Boolean).join(" ");
      if (!addr) { geocodedRef.current.add(m.id); setMissionCoordCache(prev => ({ ...prev, [m.id]: "error" })); continue; }
      geocodedRef.current.add(m.id);
      setMissionCoordCache(prev => ({ ...prev, [m.id]: "loading" }));
      fetch(`https://api-adresse.data.gouv.fr/search/?${new URLSearchParams({ q: addr, limit: "1" })}`)
        .then(r => r.json())
        .then(d => {
          const feat = d.features?.[0];
          if (feat) {
            const [lng, lat] = feat.geometry.coordinates;
            setMissionCoordCache(prev => ({ ...prev, [m.id]: { lat, lng } }));
          } else {
            setMissionCoordCache(prev => ({ ...prev, [m.id]: "error" }));
          }
        })
        .catch(() => setMissionCoordCache(prev => ({ ...prev, [m.id]: "error" })));
    }
  }, [assignedMissions]);

  // GPS watch for automatic check-in (< 150m)
  useEffect(() => {
    const now = Date.now(); // snapshot local à cet effet seulement
    const watchable = assignedMissions.filter(m => {
      const c = missionCoordCache[m.id];
      if (!c || typeof c !== "object" || arrivedAtMap[m.id]) return false;
      // N'activer la détection que si la mission commence dans moins de 60 min ou a déjà commencé
      if (m.date && m.heure_debut) {
        try {
          const [yr, mo, dy] = m.date.split("-").map(Number);
          const [hh, mm] = m.heure_debut.split(":").map(Number);
          const missionStart = new Date(yr, mo - 1, dy, hh, mm).getTime();
          if (now < missionStart - 60 * 60 * 1000) return false;
        } catch { /* ignore */ }
      }
      return true;
    });

    if (geoWatchRef.current != null) { navigator.geolocation?.clearWatch(geoWatchRef.current); geoWatchRef.current = null; }
    if (!watchable.length || !navigator.geolocation) return;

    geoWatchRef.current = navigator.geolocation.watchPosition(async (pos) => {
      const { latitude, longitude } = pos.coords;
      for (const m of watchable) {
        const coords = missionCoordCache[m.id];
        if (!coords || typeof coords !== "object") continue;
        if (arrivedAtMapRef.current[m.id]) continue;
        if (autoCheckinLockRef.current.has(m.id)) continue;
        if (haversineKm(latitude, longitude, coords.lat, coords.lng) > 0.15) continue;
        autoCheckinLockRef.current.add(m.id);
        try {
          const { data: sd } = await supabase.auth.getSession();
          const token = sd?.session?.access_token;
          const r = await fetch("/api/missions", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token || ""}` }, body: JSON.stringify({ action: "checkin_mission", mission_id: m.id }) });
          const d = await r.json();
          if (d.arrived_at) setArrivedAtMap(prev => { const n = { ...prev, [m.id]: d.arrived_at }; arrivedAtMapRef.current = n; return n; });
        } catch { /* ignore */ }
        autoCheckinLockRef.current.delete(m.id);
      }
    }, (_err) => {
      // GPS denied/unavailable → mark all as error so fallback button shows
      watchable.forEach(m => setMissionCoordCache(prev => ({ ...prev, [m.id]: "error" })));
    }, { enableHighAccuracy: true, maximumAge: 20000 });

    return () => { if (geoWatchRef.current != null) { navigator.geolocation.clearWatch(geoWatchRef.current); geoWatchRef.current = null; } };
  }, [assignedMissions, missionCoordCache, arrivedAtMap]);

  const handleAccept = async (m) => {
    setActioning(m.id + "_acc");
    const { data: sd } = await supabase.auth.getSession();
    const token = sd?.session?.access_token;
    const r = await fetch("/api/missions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ action: "respond_mission", mission_id: m.id, response: "accept", presta_name: userName }),
    });
    const data = await r.json();
    if (data.success) {
      setPendingMissions(prev => prev.filter(x => x.id !== m.id));
      setAssignedMissions(prev => [...prev, { ...m, status: "assigned" }]);
    }
    setActioning(null);
  };

  const handleRefuse = async (m) => {
    setConfirmRefuse(null);
    setActioning(m.id + "_ref");
    const { data: sd } = await supabase.auth.getSession();
    const token = sd?.session?.access_token;
    const r = await fetch("/api/missions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ action: "respond_mission", mission_id: m.id, response: "refuse", presta_name: userName }),
    });
    const data = await r.json();
    if (data.success) {
      setPendingMissions(prev => prev.filter(x => x.id !== m.id));
    }
    setActioning(null);
  };



  const computeEndTime = (heureDebut, hours) => {
    if (!heureDebut) return null;
    const [h, m] = heureDebut.split(":").map(Number);
    const endMin = h * 60 + m + Math.round(Number(hours) * 60);
    return `${String(Math.floor(endMin / 60) % 24).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`;
  };

  // Retourne HH:MM depuis un timestamp ISO
  const isoToHHMM = (iso) => {
    if (!iso) return null;
    return new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
  };

  // Horaires affichés pour une mission avec démarrage réel
  // start = toujours l'heure réelle si started_at, sinon heure_debut
  // end   = started_at + hours si started_at connu, sinon heure_debut + hours
  const computeMissionTimes = (m) => {
    const startedAt = startedAtMap[m.id];
    const displayStart = startedAt ? isoToHHMM(startedAt) : m.heure_debut;
    const displayEnd = computeEndTime(displayStart, m.hours);
    return { displayStart, displayEnd };
  };


  if (loading) return <div style={{ textAlign:"center", color:C.textSub, padding:40 }}>Chargement…</div>;

  return (
    <div>
      {/* Remplacements qu'un confrère propose à ce prestataire (CGPS art. 9) */}
      <RemplacementsProposes onRepondu={()=>{ loadPending?.(); chargerRemplacements(); }} />

      {/* Contrat électronique prestataire */}
      {/* Contrat de prestation — acceptation prestation */}
      {contractAcceptMission && (
        <ContractModal
          title="Contrat de prestation de service"
          contractText={`CONTRAT DE PRESTATION DE SERVICE

Prestation :
Métier : ${contractAcceptMission.metier || contractAcceptMission.sector || ""}
Date : ${contractAcceptMission.date || ""}
Durée : ${contractAcceptMission.hours || ""} heure(s)
Tarif horaire : ${contractAcceptMission.tarif_horaire || ""} €/h

En signant ce contrat, je m'engage à réaliser la prestation dans les conditions convenues, à respecter les délais et à me conformer aux conditions générales de la plateforme ALANE.

Signé électroniquement le ${new Date().toLocaleDateString("fr-FR")}`}
          onSign={async () => {
            const prestation = contractAcceptMission;
            setContractAcceptMission(null);
            await handleAccept(prestation);
          }}
          onClose={() => setContractAcceptMission(null)}
        />
      )}

      {validatedSummary && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }} onClick={()=>setValidatedSummary(null)}>
          <div style={{ background:"#0D1B3E", borderRadius:20, padding:28, maxWidth:380, width:"100%", border:"1px solid rgba(16,217,143,0.3)", boxShadow:"0 8px 40px rgba(0,0,0,0.5)" }} onClick={e=>e.stopPropagation()}>
            <div style={{ textAlign:"center", marginBottom:20 }}>
              <div style={{ fontSize:48, marginBottom:8 }}>✅</div>
              <div style={{ fontWeight:800, fontSize:18, color:"#10D98F", marginBottom:4 }}>Prestation validée !</div>
              <div style={{ color:"rgba(255,255,255,0.5)", fontSize:13 }}>En attente de validation par le client</div>
            </div>
            <div style={{ background:"rgba(255,255,255,0.04)", borderRadius:12, padding:"14px 16px", marginBottom:16 }}>
              {[
                ["Prestation",   validatedSummary.metier || validatedSummary.sector || "—"],
                ["Date",      validatedSummary.date || (validatedSummary.date_debut ? `${validatedSummary.date_debut} → ${validatedSummary.date_fin||""}` : "—")],
                ["Durée",     validatedSummary.actual_hours != null ? `${validatedSummary.actual_hours}h (réelles)` : validatedSummary.hours ? `${validatedSummary.hours}h` : "—"],
                ["Tarif",     validatedSummary.tarif_horaire ? `${validatedSummary.tarif_horaire} €/h` : "—"],
                ["Montant",   validatedSummary.tarif_horaire && (validatedSummary.actual_hours ?? validatedSummary.hours) ? `${((validatedSummary.actual_hours ?? validatedSummary.hours) * validatedSummary.tarif_horaire).toFixed(2)} € HT` : "—"],
                ["Ville",     validatedSummary.ville || "—"],
              ].map(([l, v]) => (
                <div key={l} style={{ display:"flex", justifyContent:"space-between", padding:"5px 0", borderBottom:"1px solid rgba(255,255,255,0.06)" }}>
                  <span style={{ color:"rgba(255,255,255,0.45)", fontSize:12 }}>{l}</span>
                  <span style={{ color:"#E8EAF0", fontWeight:600, fontSize:12 }}>{v}</span>
                </div>
              ))}
            </div>
            <div style={{ background:"rgba(16,217,143,0.07)", border:"1px solid rgba(16,217,143,0.2)", borderRadius:10, padding:"10px 14px", fontSize:12, color:"rgba(255,255,255,0.6)", lineHeight:1.6, marginBottom:16 }}>
              Une notification a été envoyée au client. Dès sa validation, votre paiement sera déclenché automatiquement.
            </div>
            <button onClick={()=>setValidatedSummary(null)} style={{ width:"100%", padding:"12px", borderRadius:12, border:"none", background:"#10D98F", color:"#fff", fontWeight:700, fontSize:14, cursor:"pointer", fontFamily:"inherit" }}>
              Fermer
            </button>
          </div>
        </div>
      )}

      {contractMission && (
        <ContractModal
          title="Attestation de réalisation de prestation"
          contractText={`ATTESTATION DE RÉALISATION DE MISSION

Prestation :
Métier : ${contractMission.metier || contractMission.sector || ""}
Date : ${contractMission.date || ""}
Durée : ${contractMission.hours || ""} heure(s)
Tarif horaire : ${contractMission.tarif_horaire || ""} €/h

En signant cette attestation, je certifie avoir réalisé la prestation conformément aux termes convenus et autorise le déblocage du paiement.

Signé électroniquement le ${new Date().toLocaleDateString("fr-FR")}`}
          onSign={async (ts) => {
            setContractSignedAt(prev => ({ ...prev, [contractMission.id]: ts }));
            const prestation = contractMission;
            setContractMission(null);
            const { data:{ session } } = await supabase.auth.getSession();
            const r = await fetch("/api/missions", { method:"POST", headers:{"Content-Type":"application/json","Authorization":`Bearer ${session?.access_token||""}`}, body: JSON.stringify({ action:"validate_presta", mission_id:prestation.id, contrat_presta_signe_at: ts }) });
            if(r.ok) { setAssignedMissions(prev=>prev.map(x=>x.id===prestation.id?{...x,validation_prestataire:true}:x)); setValidatedSummary(prestation); }
            else { const e = await r.json().catch(()=>({})); showToast(e.error || "Erreur lors de la validation — réessayez."); }
          }}
          onClose={() => setContractMission(null)}
        />
      )}

      {/* Prestations en attente de confirmation */}
      {pendingMissions.length > 0 && (
        <div style={{ marginBottom:18 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
            <div style={{ width:8, height:8, borderRadius:"50%", background:C.accent, boxShadow:`0 0 8px ${C.accent}`, animation:"pulse 1.5s ease-in-out infinite" }} />
            <p style={{ fontWeight:800, color:C.accent, fontSize:13, margin:0 }}>🔔 En attente de votre réponse ({pendingMissions.length})</p>
          </div>
          {pendingMissions.map(m => {
            const sector = SECTORS.find(s => s.id === m.sector);
            const expired = m.acceptance_deadline && new Date(m.acceptance_deadline).getTime() < Date.now();
            const isAct = actioning === m.id+"_acc" || actioning === m.id+"_ref";
            return (
              <div key={m.id} style={{ background:"#0D1B3E", borderRadius:16, padding:"15px", marginBottom:12, border:`2px solid ${expired ? C.textMuted : C.accent}55` }}>
                <div style={{ display:"flex", gap:12, alignItems:"flex-start", marginBottom:10 }}>
                  <div style={{ width:44, height:44, borderRadius:12, background:`${sector?.color||C.violet}22`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>{sector?.icon||"📋"}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:700, color:C.text, fontSize:14 }}>{m.titre || m.metier || sector?.label || "Prestation"}</div>
                    <div style={{ color:C.textSub, fontSize:12 }}>📅 {m.date}{m.heure_debut ? ` · ${m.heure_debut}${computeEndTime(m.heure_debut,m.hours) ? ` – ${computeEndTime(m.heure_debut,m.hours)}` : ""}` : ` · ${m.hours}h`}</div>
                    {m.heure_debut && <div style={{ color:C.textSub, fontSize:12 }}>⏱ {m.hours}h de travail</div>}
                    {m.tarif_horaire > 0 && <div style={{ color:C.success, fontSize:12, fontWeight:700 }}>💶 {Number(m.tarif_horaire).toFixed(2).replace(".",",")} € HT/h</div>}
                  </div>
                  {m.acceptance_deadline && <DeadlineCountdown deadline={m.acceptance_deadline} />}
                </div>
                {(m.ville || m.adresse || m.description) && (
                  <div style={{ marginBottom:8 }}>
                    <button onClick={()=>setExpandedDetail(expandedDetail===m.id?null:m.id)} style={{ background:"transparent", border:`1px solid rgba(255,255,255,0.12)`, borderRadius:8, padding:"5px 12px", color:"rgba(255,255,255,0.5)", fontSize:11, fontWeight:600, cursor:"pointer", fontFamily:"inherit", width:"100%" }}>
                      {expandedDetail===m.id ? "▲ Masquer les détails" : "▼ Voir les détails"}
                    </button>
                    {expandedDetail===m.id && (
                      <div style={{ marginTop:8, padding:"10px 12px", background:"rgba(255,255,255,0.03)", borderRadius:10, border:"1px solid rgba(255,255,255,0.07)", display:"flex", flexDirection:"column", gap:6 }}>
                        {(m.ville||m.adresse) && <div style={{ fontSize:12, color:C.textSub }}>📍 {[m.adresse, m.ville].filter(Boolean).join(", ")}</div>}
                        {m.description && <div style={{ fontSize:12, color:C.textSub }}>📝 {m.description}</div>}
                        {m.tarif_horaire && m.hours && <div style={{ fontSize:12, color:C.success, fontWeight:700 }}>💶 Total estimé : {(Number(m.tarif_horaire)*Number(m.hours)).toFixed(2).replace(".",",")} € HT</div>}
                      </div>
                    )}
                  </div>
                )}
                {expired ? (
                  <div style={{ padding:"9px", borderRadius:10, background:"rgba(255,255,255,0.04)", color:C.textMuted, fontSize:12, textAlign:"center" }}>Délai dépassé — cette prestation a été annulée automatiquement</div>
                ) : (
                  <div style={{ display:"flex", gap:8, flexDirection:"column" }}>
                    {confirmRefuse === m.id ? (
                      <div style={{ background:`${C.accent}12`, border:`1px solid ${C.accent}44`, borderRadius:10, padding:"12px", textAlign:"center" }}>
                        <div style={{ color:C.accent, fontWeight:700, fontSize:13, marginBottom:8 }}>Confirmer le refus ?</div>
                        <div style={{ display:"flex", gap:8 }}>
                          <button onClick={()=>setConfirmRefuse(null)} style={{ flex:1, padding:"9px", borderRadius:8, border:`1px solid rgba(255,255,255,0.2)`, background:"transparent", color:"rgba(255,255,255,0.7)", fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>Annuler</button>
                          <button onClick={()=>handleRefuse(m)} disabled={isAct} style={{ flex:1, padding:"9px", borderRadius:8, border:"none", background:C.accent, color:"#fff", fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>{actioning===m.id+"_ref" ? "…" : "Oui, refuser"}</button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display:"flex", gap:8, flexDirection:"column" }}>
                        {trialExhausted && userPlan === "free" ? (
                          <div style={{ background:`rgba(242,94,94,0.1)`, border:`1px solid rgba(242,94,94,0.35)`, borderRadius:10, padding:"12px 14px", textAlign:"center" }}>
                            <div style={{ color:"#F25E5E", fontWeight:700, fontSize:13, marginBottom:4 }}>⛔ Quota épuisé — acceptation impossible</div>
                            <div style={{ color:"rgba(255,255,255,0.5)", fontSize:11, marginBottom:10 }}>Passez Premium pour accepter des prestations illimitées</div>
                            <button onClick={()=>onNavigate&&onNavigate("abonnement_presta")} style={{ padding:"9px 18px", borderRadius:8, border:"none", background:C.violet, color:"#fff", fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>
                              💎 Passer Premium — 29€/mois
                            </button>
                          </div>
                        ) : (
                          <div style={{ display:"flex", gap:8 }}>
                            <button onClick={()=>setConfirmRefuse(m.id)} disabled={isAct} style={{ flex:1, padding:"11px", border:`1px solid ${C.accent}44`, borderRadius:10, background:C.accent+"10", color:C.accent, fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>✗ Refuser</button>
                            <button onClick={()=>{ if(!isAct) setContractAcceptMission(m); }} disabled={isAct} style={{ flex:2, padding:"11px", border:"none", borderRadius:10, background:C.success, color:"#fff", fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
                              {actioning===m.id+"_acc" ? "…" : "✅ Accepter la prestation"}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Prestations assignées : à venir et en cours */}
      {assignedMissions.length > 0 && (() => {
        // Le titre annonçait « en cours » pour toute prestation assignée, y compris
        // celles qui n'avaient pas commencé — la carte affichait « À venir » juste à
        // côté. Une prestation n'est en cours que lorsque le prestataire a pointé son
        // démarrage, exactement comme le calcule la carte plus bas.
        const maintenant = Date.now();
        const enCours = assignedMissions.filter(m => {
          const debut = startedAtMap[m.id] ? new Date(startedAtMap[m.id]).getTime() : 0;
          return debut > 0 && debut < maintenant;
        }).length;
        const aVenir = assignedMissions.length - enCours;
        const titre = enCours === 0
          ? `Prestation${aVenir > 1 ? "s" : ""} à venir (${aVenir})`
          : aVenir === 0
            ? `Prestation${enCours > 1 ? "s" : ""} en cours (${enCours})`
            : `${enCours} en cours · ${aVenir} à venir`;
        const couleur = enCours > 0 ? C.success : C.accentGold;
        return (
        <div style={{ marginBottom:18 }}>
          <p style={{ fontWeight:800, color:couleur, fontSize:13, margin:"0 0 10px", display:"flex", alignItems:"center", gap:6 }}>
            <span style={{ width:8, height:8, borderRadius:"50%", background:couleur, display:"inline-block" }} />
            {titre}
          </p>
          {assignedMissions.map(m => {
            const sector = SECTORS.find(s => s.id === m.sector);
            const missionStart = m.date
              ? (m.heure_debut
                  ? new Date(`${m.date}T${m.heure_debut}`).getTime()
                  : new Date(m.date + 'T00:00:00').getTime())
              : 0;
            // Pour les missions en cours, toujours utiliser hours (actual_hours est réservé aux missions terminées)
            const effectiveHours = m.hours ?? 1;
            void renderTick; // forces re-render every 30s via state change
            const renderNow = Date.now();

            // Une prestation ne démarre et ne se termine que sur pointage RÉEL du
            // prestataire. Le code se rabattait auparavant sur l'horaire prévu :
            // sans aucune action de sa part, la prestation passait « en cours »
            // puis « terminée — pensez à valider », et le bouton de pointage
            // disparaissait. Le client voyait donc une prestation exécutée que
            // personne n'avait déclaré avoir commencée.
            const debutReel = startedAtMap[m.id] ? new Date(startedAtMap[m.id]).getTime() : 0;
            const finPrevue = missionStart > 0 ? missionStart + (Number(effectiveHours) * 3600000) : 0;
            // Un démarrage tardif décalait la fin d'autant, sans que le client ait
            // accepté quoi que ce soit. La prestation s'arrête à l'heure prévue tant
            // qu'il n'a pas donné son accord — c'est lui qui a réservé ce créneau.
            const decalageAccepte = m.delay_status === "approved";
            const finReelle = debutReel
              ? ((!decalageAccepte && finPrevue > 0 && finPrevue > debutReel)
                  ? Math.min(finPrevue, debutReel + (Number(effectiveHours) * 3600000))
                  : debutReel + (Number(effectiveHours) * 3600000))
              : 0;

            const isStarted = debutReel > 0 && debutReel < renderNow;
            const isPast    = finReelle > 0 && finReelle < renderNow;
            // Retard : l'heure de début est passée et rien n'a été pointé. Compté
            // dès le début prévu, et non à la fin : sur une prestation d'une heure,
            // attendre la fin prévue pour alerter revient à alerter trop tard.
            const retardMin = (!debutReel && missionStart > 0 && missionStart < renderNow)
              ? Math.floor((renderNow - missionStart) / 60000) : 0;
            const enRetard = retardMin > 0;
            const pointageManquant = !debutReel && finPrevue > 0 && finPrevue < renderNow;

            const badgeColor = isPast ? C.accentGold : pointageManquant ? C.danger : enRetard ? C.danger : isStarted ? C.success : C.violet;
            const badgeLabel = isPast ? "À valider" : pointageManquant ? "Pointage manquant" : enRetard ? `Retard ${retardMin} min` : isStarted ? "En cours" : "À venir";
            const borderColor = isPast ? C.accentGold+"88" : (pointageManquant||enRetard) ? C.danger+"66" : isStarted ? C.success+"44" : C.violet+"44";
            return (
              <div key={m.id} style={{ background:"#0D1B3E", borderRadius:16, padding:"15px", marginBottom:12, border:`2px solid ${borderColor}` }}>
                {enRetard && !pointageManquant && (
                  <div style={{ background:`${C.danger}15`, border:`1px solid ${C.danger}55`, borderRadius:10, padding:"8px 12px", marginBottom:10, display:"flex", alignItems:"center", gap:8 }}>
                    <span style={{ fontSize:16 }}>⏰</span>
                    <span style={{ color:C.danger, fontSize:12, fontWeight:700 }}>
                      {retardMin} min de retard — signalez votre arrivée, le client est informé
                    </span>
                  </div>
                )}
                {pointageManquant && (
                  <div style={{ background:`${C.danger}15`, border:`1px solid ${C.danger}55`, borderRadius:10, padding:"8px 12px", marginBottom:10, display:"flex", alignItems:"center", gap:8 }}>
                    <span style={{ fontSize:16 }}>⚠️</span>
                    <span style={{ color:C.danger, fontSize:12, fontWeight:700 }}>Horaire dépassé — signalez votre arrivée pour démarrer la prestation</span>
                  </div>
                )}
                {isPast && (
                  <div style={{ background:`${C.accentGold}15`, border:`1px solid ${C.accentGold}44`, borderRadius:10, padding:"8px 12px", marginBottom:10, display:"flex", gap:8, alignItems:"center" }}>
                    <span style={{ fontSize:16 }}>⚠️</span>
                    <span style={{ color:C.accentGold, fontSize:12, fontWeight:700 }}>Prestation terminée — pensez à valider !</span>
                  </div>
                )}
                {/* Proposition envoyée, en attente du règlement du client. */}
                {m.extra_hours_status === "accepte_presta" && (
                  <div style={{ background:`${C.accentGold}12`, border:`1px solid ${C.accentGold}44`, borderRadius:12, padding:"12px 14px", marginBottom:10, fontSize:12, color:C.textSub, lineHeight:1.6 }}>
                    <div style={{ fontWeight:700, color:C.accentGold, fontSize:13, marginBottom:3 }}>⏳ Prolongation en attente de règlement</div>
                    Le client doit régler le complément. La durée sera prolongée à ce moment-là, pas avant.
                  </div>
                )}
                {/* Demande d'heures supplémentaires en attente */}
                {m.extra_hours_status === "pending" && m.extra_hours_requested > 0 && (
                  <div style={{ background:"rgba(124,111,224,0.1)", border:`1px solid ${C.violet}44`, borderRadius:12, padding:"14px", marginBottom:10 }}>
                    <div style={{ fontWeight:700, color:C.violet, fontSize:13, marginBottom:4 }}>⏱ Demande de prolongation</div>
                    <div style={{ color:C.textSub, fontSize:12, marginBottom:12 }}>
                      Le client souhaite prolonger la prestation de <strong style={{ color:C.text }}>{m.extra_hours_requested}h supplémentaire{m.extra_hours_requested > 1 ? "s" : ""}</strong>.
                    </div>

                    {/* Le tarif de la prolongation est le vôtre.
                        Vous fixez librement votre prix (CGPS art. 6.1), et une
                        prolongation imprévue n'a pas de raison d'être vendue au
                        tarif d'un créneau réservé à l'avance. Le client voit le
                        montant exact et reste libre de refuser. */}
                    <div style={{ marginBottom:12 }}>
                      <label style={{ display:"block", color:C.textMuted, fontSize:11, fontWeight:700, letterSpacing:0.4, textTransform:"uppercase", marginBottom:6 }}>
                        Votre tarif pour ces heures
                      </label>
                      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                        <input
                          type="number" min={1} max={500} step="0.5"
                          value={tarifSupp[m.id] ?? (m.tarif_horaire ?? "")}
                          onChange={e => setTarifSupp(t => ({ ...t, [m.id]: e.target.value }))}
                          style={{ width:110, padding:"9px 12px", borderRadius:10, border:`1px solid ${C.border}`, background:"rgba(255,255,255,0.06)", color:C.text, fontSize:14, fontFamily:"inherit", textAlign:"center" }}
                        />
                        <span style={{ color:C.textSub, fontSize:13 }}>€ HT/h</span>
                        <span style={{ color:C.textMuted, fontSize:11, marginLeft:"auto" }}>
                          Habituel : {Number(m.tarif_horaire || 0).toFixed(2).replace(".", ",")} €
                        </span>
                      </div>
                    </div>

                    <div style={{ display:"flex", gap:8 }}>
                      <button onClick={async () => {
                        const { data: sd } = await supabase.auth.getSession();
                        const token = sd?.session?.access_token;
                        const r = await fetch("/api/missions", { method:"POST", headers:{"Content-Type":"application/json","Authorization":`Bearer ${token||""}`}, body: JSON.stringify({ action:"respond_extra_hours", mission_id:m.id, response:"refuse" }) });
                        if (r.ok) setAssignedMissions(prev => prev.map(x => x.id===m.id ? {...x, extra_hours_status:"refused", extra_hours_requested:null} : x));
                      }} style={{ flex:1, padding:"10px", borderRadius:10, border:"1px solid rgba(242,94,94,0.4)", background:"rgba(242,94,94,0.1)", color:"#F25E5E", fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>
                        ✗ Refuser
                      </button>
                      <button onClick={async () => {
                        const { data: sd } = await supabase.auth.getSession();
                        const token = sd?.session?.access_token;
                        const tarif = Number(tarifSupp[m.id] ?? m.tarif_horaire);
                        const r = await fetch("/api/missions", { method:"POST", headers:{"Content-Type":"application/json","Authorization":`Bearer ${token||""}`}, body: JSON.stringify({ action:"respond_extra_hours", mission_id:m.id, response:"accept", tarif_horaire: tarif }) });
                        const d = await r.json().catch(() => ({}));
                        if (r.ok && d.ok) {
                          // La durée ne change PAS ici : elle ne bouge qu'au
                          // règlement du client. L'annoncer maintenant ferait
                          // croire à une prolongation acquise.
                          setAssignedMissions(prev => prev.map(x => x.id===m.id ? {...x, extra_hours_status:"accepte_presta", extra_hours_tarif: tarif} : x));
                          showToast(`Proposition envoyée — ${Number(d.devis?.total || 0).toFixed(2).replace(".", ",")} € à régler par le client.`, "success");
                        } else {
                          showToast(d.error || "Votre réponse n'a pas pu être enregistrée.");
                        }
                      }} style={{ flex:2, padding:"10px", borderRadius:10, border:"none", background:C.violet, color:"#fff", fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>
                        ✅ Accepter +{m.extra_hours_requested}h
                      </button>
                    </div>
                  </div>
                )}
                <div style={{ display:"flex", gap:12, alignItems:"flex-start", marginBottom:10 }}>
                  <div style={{ width:44, height:44, borderRadius:12, background:`${sector?.color||C.success}22`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>{sector?.icon||"✅"}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:700, color:C.text, fontSize:14 }}>{m.titre || m.metier || sector?.label || "Prestation"}</div>
                    {(() => { const {displayStart,displayEnd} = computeMissionTimes(m); return (
                      <div style={{ color:C.textSub, fontSize:12 }}>📅 {m.date}{displayStart ? ` · ${displayStart}${displayEnd ? ` – ${displayEnd}` : ""}` : ` · ${m.hours}h`}</div>
                    ); })()}
                    {m.heure_debut && <div style={{ color:C.textSub, fontSize:12 }}>⏱ {m.hours}h de travail</div>}
                    {m.ville && <div style={{ color:C.textSub, fontSize:12 }}>📍 {m.ville}{m.adresse ? `, ${m.adresse}` : ""}</div>}
                    {m.tarif_horaire > 0 && <div style={{ color:C.success, fontSize:12, fontWeight:700 }}>💶 {Number(m.tarif_horaire).toFixed(2).replace(".",",")} € HT/h</div>}
                    {m.description && <div style={{ color:C.textMuted, fontSize:12, marginTop:4, fontStyle:"italic" }}>"{m.description}"</div>}
                  </div>
                  <span style={{ background:`${badgeColor}20`, border:`1px solid ${badgeColor}44`, borderRadius:20, padding:"3px 9px", color:badgeColor, fontSize:10, fontWeight:700, flexShrink:0 }}>{badgeLabel}</span>
                </div>
                {/* Timer / Checkin / Start */}
                {startedAtMap[m.id] ? (
                    <ElapsedTimer
                      key={`${m.id}-${m.hours ?? 1}`}
                      startedAt={startedAtMap[m.id]}
                      maxMs={(m.hours ?? 1) * 3600 * 1000}
                      onEnd={async () => {
                        const { data: sd } = await supabase.auth.getSession();
                        const tok = sd?.session?.access_token;
                        if (!tok) return;
                        fetch("/api/missions", {
                          method: "POST",
                          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${tok}` },
                          body: JSON.stringify({ action: "notify_end", mission_id: m.id }),
                        }).catch(() => {});
                      }}
                    />
                  ) : arrivedAtMap[m.id] ? (
                  // ── Sur place, pas encore démarré : bouton "Je commence" ──
                  <div style={{ marginBottom:10 }}>
                    <div style={{ background:`${C.success}10`, border:`1px solid ${C.success}30`, borderRadius:10, padding:"8px 12px", marginBottom:8, display:"flex", alignItems:"center", gap:8 }}>
                      <span style={{ fontSize:14 }}>✅</span>
                      <div>
                        <div style={{ color:C.success, fontWeight:700, fontSize:12 }}>Arrivé(e) sur place — client notifié</div>
                        <div style={{ color:C.textSub, fontSize:11 }}>Arrivé(e) à {new Date(arrivedAtMap[m.id]).toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"})}</div>
                      </div>
                    </div>
                    {(() => {
                      // Cinquième copie de la règle, avec une cinquième borne :
                      // cinq minutes d'avance, là où l'autre bouton s'ouvrait une
                      // heure avant. Tout passe désormais par `fenetrePointage`.
                      const fd = fenetrePointage(debutLocalMs(m));
                      const tooEarly = !fd.demarrage && !fd.horaireInconnu;
                      const unlockTime = fd.ouvreDemarrage
                        ? new Date(fd.ouvreDemarrage).toLocaleTimeString("fr-FR", { hour:"2-digit", minute:"2-digit" })
                        : null;
                      return (
                        <>
                          {tooEarly && (
                            <div style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:10, padding:"8px 12px", marginBottom:8, textAlign:"center" }}>
                              <span style={{ color:C.textSub, fontSize:12 }}>🔒 Démarrage disponible à <strong style={{ color:C.text }}>{unlockTime}</strong></span>
                            </div>
                          )}
                          <button disabled={startingMission === m.id || tooEarly} onClick={async () => {
                            setStartingMission(m.id);
                            const { data: sd } = await supabase.auth.getSession();
                            const token = sd?.session?.access_token;
                            const r = await fetch("/api/missions", { method:"POST", headers:{"Content-Type":"application/json","Authorization":`Bearer ${token||""}`}, body: JSON.stringify({ action:"start_mission", mission_id:m.id }) });
                            const d = await r.json();
                            if (d.started_at) setStartedAtMap(prev => ({ ...prev, [m.id]: d.started_at }));
                            setStartingMission(null);
                          }} style={{ width:"100%", padding:"13px", borderRadius:12, border:"none", background:tooEarly?"rgba(255,255,255,0.07)":startingMission===m.id?"rgba(16,217,143,0.4)":"linear-gradient(135deg,#10D98F,#0aad72)", color:tooEarly?"rgba(255,255,255,0.3)":"#fff", fontWeight:800, fontSize:15, cursor:tooEarly||startingMission===m.id?"default":"pointer", fontFamily:"inherit", letterSpacing:0.3 }}>
                            {startingMission===m.id ? "Démarrage…" : tooEarly ? "🔒 Démarrage à l'heure prévue" : "🚀 Je commence la prestation"}
                          </button>
                        </>
                      );
                    })()}
                  </div>
                ) : !isPast && (
                  // ── Pas encore arrivé : détection GPS ou fallback manuel ──
                  <div style={{ marginBottom:10 }}>
                    {missionCoordCache[m.id] === "loading" || (missionCoordCache[m.id] && typeof missionCoordCache[m.id] === "object") ? (() => {
                      // La règle vit dans `api/_temps.js` — la même que celle
                      // appliquée par le serveur. Elle était recopiée ici quatre
                      // fois, avec quatre bornes différentes : le bouton
                      // apparaissait une heure avant, et le serveur refusait
                      // pendant cinquante-cinq minutes.
                      const f = fenetrePointage(debutLocalMs(m));
                      const tooEarly = !f.arrivee;
                      const missionStarted = f.arrivee;
                      const checkinBtn = (
                        <button disabled={checkingInId === m.id} onClick={async () => {
                          setCheckingInId(m.id);
                          setCheckInGeoError(prev => ({ ...prev, [m.id]: null }));
                          const { data: sd } = await supabase.auth.getSession();
                          const token = sd?.session?.access_token;
                          const r = await fetch("/api/missions", { method:"POST", headers:{"Content-Type":"application/json","Authorization":`Bearer ${token||""}`}, body: JSON.stringify({ action:"checkin_mission", mission_id:m.id }) });
                          const d = await r.json();
                          if (d.arrived_at) setArrivedAtMap(prev => { const n = { ...prev, [m.id]: d.arrived_at }; arrivedAtMapRef.current = n; return n; });
                          setCheckingInId(null);
                        }} style={{ width:"100%", padding:"12px", borderRadius:12, border:"none", background:checkingInId===m.id?"rgba(16,217,143,0.4)":"linear-gradient(135deg,#10D98F,#0aad72)", color:"#fff", fontWeight:800, fontSize:14, cursor:checkingInId===m.id?"default":"pointer", fontFamily:"inherit", letterSpacing:0.3 }}>
                          {checkingInId===m.id ? "Enregistrement…" : "📍 Je suis sur place"}
                        </button>
                      );
                      return tooEarly ? (
                        <div style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:10, padding:"10px 13px", display:"flex", alignItems:"center", gap:10 }}>
                          <div style={{ fontSize:16, flexShrink:0 }}>⏳</div>
                          <div>
                            <div style={{ color:C.textSub, fontWeight:700, fontSize:12 }}>Détection automatique d'arrivée inactive</div>
                            <div style={{ color:C.textMuted, fontSize:11 }}>Elle s'activera 1h avant le début et confirmera votre présence sur place. Sans rapport avec le partage de position ci-dessous.</div>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                          <div style={{ background:"rgba(124,111,224,0.08)", border:"1px solid rgba(124,111,224,0.25)", borderRadius:10, padding:"10px 13px", display:"flex", alignItems:"center", gap:10 }}>
                            <div style={{ width:8, height:8, borderRadius:"50%", background:C.violet, boxShadow:`0 0 8px ${C.violet}`, flexShrink:0, animation:"pulse 1.5s ease-in-out infinite" }} />
                            <div>
                              <div style={{ color:C.violet, fontWeight:700, fontSize:12 }}>Détection de présence active</div>
                              <div style={{ color:C.textSub, fontSize:11 }}>Vous recevrez automatiquement la confirmation d'arrivée dès que vous serez à moins de 150m.</div>
                            </div>
                          </div>
                          {missionStarted && checkinBtn}
                        </div>
                      );
                    })() : (
                      // Fallback : GPS refusé ou adresse non géocodable → bouton manuel à l'heure de début
                      (() => {
                        const missionStarted = fenetrePointage(debutLocalMs(m)).arrivee;
                        return missionStarted ? (
                          <button disabled={checkingInId === m.id} onClick={async () => {
                            setCheckingInId(m.id);
                            setCheckInGeoError(prev => ({ ...prev, [m.id]: null }));
                            const { data: sd } = await supabase.auth.getSession();
                            const token = sd?.session?.access_token;
                            const r = await fetch("/api/missions", { method:"POST", headers:{"Content-Type":"application/json","Authorization":`Bearer ${token||""}`}, body: JSON.stringify({ action:"checkin_mission", mission_id:m.id }) });
                            const d = await r.json();
                            if (d.arrived_at) setArrivedAtMap(prev => { const n = { ...prev, [m.id]: d.arrived_at }; arrivedAtMapRef.current = n; return n; });
                            setCheckingInId(null);
                          }} style={{ width:"100%", padding:"12px", borderRadius:12, border:"none", background:checkingInId===m.id?"rgba(16,217,143,0.4)":"linear-gradient(135deg,#10D98F,#0aad72)", color:"#fff", fontWeight:800, fontSize:14, cursor:checkingInId===m.id?"default":"pointer", fontFamily:"inherit", letterSpacing:0.3 }}>
                            {checkingInId===m.id ? "Enregistrement…" : "📍 Je suis sur place"}
                          </button>
                        ) : (
                          <div style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:10, padding:"10px 13px", display:"flex", alignItems:"center", gap:10 }}>
                            <div style={{ fontSize:16, flexShrink:0 }}>⏳</div>
                            <div style={{ color:C.textMuted, fontSize:12 }}>Le bouton de présence sera disponible à l'heure de début de la prestation.</div>
                          </div>
                        );
                      })()
                    )}
                    {checkInGeoError[m.id] && (
                      <div style={{ marginTop:8, background:"rgba(242,94,94,0.1)", border:"1px solid rgba(242,94,94,0.35)", borderRadius:10, padding:"10px 13px", fontSize:12, color:"#F25E5E", lineHeight:1.5 }}>
                        {checkInGeoError[m.id]}
                      </div>
                    )}
                  </div>
                )}
                <div style={{ display:"flex", gap:8, flexDirection:"column" }}>
                  {/* Bouton "Je suis là" — visible si prestation démarrée, pas encore validée, pas encore checké */}
                  {isStarted && !isPast && !m.arrived_at && (
                    <button onClick={async () => {
                      const { data:{ session } } = await supabase.auth.getSession();
                      const r = await fetch("/api/missions", { method:"POST", headers:{"Content-Type":"application/json","Authorization":`Bearer ${session?.access_token||""}`}, body: JSON.stringify({ action:"checkin_mission", mission_id:m.id }) });
                      if (r.ok) {
                        const d = await r.json().catch(() => ({}));
                        setAssignedMissions(prev => prev.map(x => x.id === m.id ? { ...x, arrived_at: d.arrived_at || new Date().toISOString() } : x));
                      }
                    }}
                      style={{ width:"100%", padding:"10px", borderRadius:10, border:"none", background:"linear-gradient(135deg,#10D98F,#0ABF7A)", color:"#fff", fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
                      📍 Je suis là
                    </button>
                  )}
                  {isStarted && !isPast && m.arrived_at && (
                    <div style={{ padding:"9px 12px", borderRadius:10, background:"rgba(16,217,143,0.1)", border:"1px solid rgba(16,217,143,0.3)", color:"#10D98F", fontWeight:700, fontSize:12, textAlign:"center" }}>
                      📍 Arrivée confirmée — client notifié ✅
                    </div>
                  )}
                  <div style={{ display:"flex", gap:8 }}>
                    {isPast && !m.validation_prestataire && (
                      <button disabled={validatingMission === m.id} onClick={async()=>{
                        if (!contractSignedAt[m.id]) {
                          setContractMission(m);
                        } else {
                          setValidatingMission(m.id);
                          const { data:{ session } } = await supabase.auth.getSession();
                          const r = await fetch("/api/missions", { method:"POST", headers:{"Content-Type":"application/json","Authorization":`Bearer ${session?.access_token||""}`}, body: JSON.stringify({ action:"validate_presta", mission_id:m.id, contrat_presta_signe_at: contractSignedAt[m.id] }) });
                          if(r.ok) { setAssignedMissions(prev=>prev.map(x=>x.id===m.id?{...x,validation_prestataire:true}:x)); setValidatedSummary(m); }
                          else { const e = await r.json().catch(()=>({})); showToast(e.error || "Erreur lors de la validation — réessayez."); }
                          setValidatingMission(null);
                        }
                      }}
                        style={{ flex:1, padding:"9px", borderRadius:10, border:"none", background:validatingMission===m.id?"rgba(240,180,41,0.5)":C.accentGold, color:"#fff", fontWeight:700, fontSize:12, cursor:validatingMission===m.id?"default":"pointer", fontFamily:"inherit" }}>
                        {validatingMission === m.id ? "Validation…" : "✅ Valider la prestation"}
                      </button>
                    )}
                    {isPast && m.validation_prestataire && (
                      <div style={{ flex:1, padding:"9px", borderRadius:10, background:`${C.success}20`, border:`1px solid ${C.success}44`, color:C.success, fontWeight:700, fontSize:12, textAlign:"center" }}>
                        ✅ Validé — en attente client
                      </div>
                    )}
                  </div>
                  {m.client_id && (
                    <button onClick={()=>onNavigate("chat", { id: m.client_id, name: "Client", avatar: "👤", color: "#4FC3F7", clientId: m.client_id })}
                      style={{ width:"100%", padding:"9px", borderRadius:10, border:"1px solid rgba(79,195,247,0.3)", background:"rgba(79,195,247,0.08)", color:"#4FC3F7", fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>
                      💬 Chat avec le client
                    </button>
                  )}
                  <button onClick={() => toggleTracking(m.id)}
                    style={{ width:"100%", padding:"9px", borderRadius:10, border:`1px solid ${sharingLocation[m.id] ? "rgba(242,94,94,0.4)" : "rgba(16,217,143,0.3)"}`, background:sharingLocation[m.id] ? "rgba(242,94,94,0.08)" : "rgba(16,217,143,0.08)", color:sharingLocation[m.id] ? "#F25E5E" : "#10D98F", fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>
                    {sharingLocation[m.id] ? "📍 Position transmise — envoyer à nouveau" : "📍 Envoyer ma position au client"}
                  </button>
                  {/* Se faire remplacer plutôt qu'annuler : la prestation reste
                      honorée, le client garde son créneau, et le droit prévu par
                      les CGPS devient réellement exerçable. */}
                  {!startedAtMap[m.id] && (
                    remplacementsEnCours[m.id] ? (
                      <div style={{ marginTop:8, background:"rgba(124,111,224,0.1)", border:"1px solid rgba(124,111,224,0.3)", borderRadius:10, padding:"10px 12px" }}>
                        <div style={{ color:C.violet, fontWeight:700, fontSize:12, marginBottom:3 }}>🔄 Remplacement proposé</div>
                        <div style={{ color:C.textSub, fontSize:11, lineHeight:1.5, marginBottom:8 }}>
                          En attente de {remplacementsEnCours[m.id].accord_entrant ? "" : "l'accord du confrère"}
                          {!remplacementsEnCours[m.id].accord_entrant && !remplacementsEnCours[m.id].accord_client ? " et de " : ""}
                          {remplacementsEnCours[m.id].accord_client ? "" : "l'accord du client"}.
                          {" "}La prestation reste à votre charge tant que les deux ne sont pas donnés.
                        </div>
                        <button onClick={async()=>{
                          const { data:{ session } } = await supabase.auth.getSession();
                          const r = await fetch("/api/missions", { method:"POST", headers:{"Content-Type":"application/json","Authorization":`Bearer ${session?.access_token||""}`}, body: JSON.stringify({ action:"annuler_remplacement", remplacement_id: remplacementsEnCours[m.id].id }) });
                          const j = await r.json().catch(()=>({}));
                          if (r.ok) chargerRemplacements();
                          else showToast(j.error || "Retrait impossible.");
                        }} style={{ width:"100%", padding:"8px", borderRadius:8, border:"1px solid rgba(255,255,255,0.2)", background:"transparent", color:C.textSub, fontWeight:700, fontSize:11, cursor:"pointer", fontFamily:"inherit" }}>
                          Retirer ma demande
                        </button>
                      </div>
                    ) : (
                      <button onClick={()=>setRemplacementPour(m.id)}
                        style={{ width:"100%", marginTop:8, padding:"10px", borderRadius:10, border:"1px solid rgba(124,111,224,0.4)", background:"rgba(124,111,224,0.08)", color:C.violet, fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>
                        🔄 Me faire remplacer
                      </button>
                    )
                  )}
                  <button onClick={async()=>{
                    if(!await showConfirm("Annuler cette prestation ?")) return;
                    const { data:{ session } } = await supabase.auth.getSession();
                    // La mission n'est retirée de la liste que si le serveur a
                    // réellement annulé. Elle disparaissait auparavant quoi qu'il
                    // arrive : le prestataire croyait avoir annulé, le client
                    // l'attendait toujours le jour J.
                    try {
                      const r = await fetch("/api/missions", { method:"POST", headers:{"Content-Type":"application/json","Authorization":`Bearer ${session?.access_token||""}`}, body: JSON.stringify({ action:"presta_cancel", mission_id:m.id }) });
                      const j = await r.json().catch(()=>({}));
                      if (r.ok) setAssignedMissions(prev => prev.filter(x => x.id !== m.id));
                      else showToast(j.error || "Annulation refusée — la prestation reste à votre charge.");
                    } catch { showToast("Annulation impossible — vérifiez votre connexion."); }
                  }} style={{ width:"100%", marginTop:8, padding:"10px", borderRadius:10, border:"1px solid rgba(242,94,94,0.35)", background:"transparent", color:"#F25E5E", fontWeight:600, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>
                    ✕ Annuler la prestation
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        );
      })()}

      {/* État vide */}
      {assignedMissions.length === 0 && pendingMissions.length === 0 && (
        <div style={{ background:"rgba(255,255,255,0.04)", border:`1px solid ${C.border}`, borderRadius:16, padding:"28px 16px", textAlign:"center", marginBottom:16 }}>
          <div style={{ fontSize:36, marginBottom:8 }}>🔔</div>
          <div style={{ color:C.text, fontSize:13, fontWeight:600, marginBottom:4 }}>Aucune prestation en cours</div>
          <div style={{ color:C.textMuted, fontSize:12, lineHeight:1.6 }}>Vous serez notifié dès qu'un client vous choisit pour une prestation.</div>
        </div>
      )}

      {remplacementPour && (
        <RemplacementModal
          missionId={remplacementPour}
          onClose={()=>setRemplacementPour(null)}
          onEnvoye={()=>{ setRemplacementPour(null); chargerRemplacements(); showToast("Demande envoyée. Le confrère et le client doivent l'accepter."); }}
        />
      )}
    </div>
  );
}

// ── Remplacements proposés à ce prestataire ─────────────────────────────────
//
// Le remplaçant est un indépendant : il ne peut pas être volontaire d'office
// pour une prestation qu'il n'a pas acceptée. Son accord est donc requis, au
// même titre que celui du client.
export function RemplacementsProposes({ onRepondu }) {
  const [demandes, setDemandes] = useState([]);
  const [enCours, setEnCours]   = useState(null);

  const charger = async () => {
    try {
      const { data: sd } = await supabase.auth.getSession();
      if (!sd?.session?.access_token) return;
      const r = await fetch("/api/missions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${sd.session.access_token}` },
        body: JSON.stringify({ action: "mes_remplacements" }),
      });
      const j = await r.json().catch(() => ({}));
      setDemandes((j.remplacements || []).filter(d => d.role === "entrant" && !d.deja_repondu));
    } catch (e) {
      console.error("[remplacements proposés] chargement échoué :", e.message);
    }
  };
  useEffect(() => { charger(); }, []);

  const repondre = async (id, reponse) => {
    setEnCours(id);
    try {
      const { data: sd } = await supabase.auth.getSession();
      const r = await fetch("/api/missions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${sd?.session?.access_token || ""}` },
        body: JSON.stringify({ action: "repondre_remplacement", remplacement_id: id, reponse }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { showToast(j.error || "Réponse non enregistrée."); setEnCours(null); return; }
      showToast(reponse === "accepter"
        ? (j.statut === "accepte" ? "Vous reprenez cette prestation." : "Accord enregistré — en attente du client.")
        : "Vous avez décliné.");
      await charger();
      onRepondu?.();
    } catch {
      showToast("Connexion impossible.");
    }
    setEnCours(null);
  };

  if (!demandes.length) return null;

  return (
    <div style={{ marginBottom:16 }}>
      {demandes.map(d => {
        const m = d.mission || {};
        const quand = [m.date, m.heure_debut ? String(m.heure_debut).slice(0,5).replace(":","h") : null].filter(Boolean).join(" à ");
        return (
          <div key={d.id} style={{ background:"rgba(124,111,224,0.1)", border:"1px solid rgba(124,111,224,0.35)", borderRadius:14, padding:"14px 14px", marginBottom:10 }}>
            <div style={{ color:C.violet, fontWeight:800, fontSize:13, marginBottom:4 }}>🤝 On vous propose un remplacement</div>
            <div style={{ color:C.text, fontSize:13, fontWeight:700, marginBottom:2 }}>
              {m.titre || m.metier || "Prestation"}{m.ville ? ` — ${m.ville}` : ""}
            </div>
            <div style={{ color:C.textSub, fontSize:12, marginBottom:d.motif?6:10 }}>
              {quand}{m.hours ? ` · ${m.hours}h` : ""} · proposé par {d.sortant?.prenom}{d.sortant?.initiale ? ` ${d.sortant.initiale}.` : ""}
            </div>
            {d.motif && <div style={{ color:C.textMuted, fontSize:11, fontStyle:"italic", marginBottom:10 }}>« {d.motif} »</div>}
            <div style={{ color:C.textMuted, fontSize:11, lineHeight:1.5, marginBottom:10 }}>
              Vous êtes libre de refuser. Le client doit également donner son accord : rien n&apos;est acquis avant.
            </div>
            <div style={{ display:"flex", gap:8 }}>
              <button disabled={enCours===d.id} onClick={()=>repondre(d.id,"refuser")}
                style={{ flex:1, padding:"10px", borderRadius:10, border:"1px solid rgba(255,255,255,0.2)", background:"transparent", color:C.textSub, fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>
                Décliner
              </button>
              <button disabled={enCours===d.id} onClick={()=>repondre(d.id,"accepter")}
                style={{ flex:2, padding:"10px", borderRadius:10, border:"none", background:C.violet, color:"#fff", fontWeight:800, fontSize:12, cursor:"pointer", fontFamily:"inherit", opacity:enCours===d.id?0.5:1 }}>
                {enCours===d.id ? "…" : "J'accepte de remplacer"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── PRESTA TOUR ───────────────────────────────────────────────────
const PRESTA_TOUR_STEPS = [
  {
    icon:"👷",
    title:"Bienvenue sur ALANE !",
    desc:"ALANE vous connecte directement avec des clients qui ont besoin de vos compétences. Voici comment ça fonctionne.",
    color:"#7C6FE0",
  },
  {
    icon:"📋",
    title:"1. Complétez votre profil",
    desc:"Renseignez votre secteur, votre métier, vos disponibilités et votre IBAN. Un profil complet vous rend visible et rassure les clients.",
    color:"#4FC3F7",
  },
  {
    icon:"🔔",
    title:"2. Recevez des demandes",
    desc:"Un client vous choisit directement et vous envoie une demande de prestation. Vous recevez une notification immédiate sur votre téléphone.",
    color:"#F0B429",
  },
  {
    icon:"⏱️",
    title:"3. Acceptez ou refusez",
    desc:"Vous avez 1 heure (prestation du jour) ou 4 heures (autre jour) pour répondre. Sans réponse, la prestation est automatiquement annulée.",
    color:"#F06292",
  },
  {
    icon:"💶",
    title:"4. Réalisez & soyez payé",
    desc:"Effectuez la prestation, le client la valide, et vous êtes payé directement sur votre IBAN sous 3 à 5 jours ouvrés.",
    color:"#81C784",
  },
];

export function PrestaTour({ onDone }) {
  const [step, setStep] = useState(0);
  const s = PRESTA_TOUR_STEPS[step];
  const isLast = step === PRESTA_TOUR_STEPS.length - 1;
  return (
    <div style={{ position:"fixed", inset:0, zIndex:9999, background:"rgba(5,14,32,0.92)", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"24px 28px" }}>
      <div style={{ width:"100%", maxWidth:360, background:"#0D1B3E", borderRadius:24, overflow:"hidden", boxShadow:"0 24px 80px rgba(0,0,0,0.7)" }}>
        <div style={{ display:"flex", gap:6, justifyContent:"center", padding:"18px 0 0" }}>
          {PRESTA_TOUR_STEPS.map((_,i) => (
            <div key={i} style={{ width:i===step?22:7, height:7, borderRadius:4, background:i===step?s.color:"rgba(255,255,255,0.15)", transition:"all 0.3s" }} />
          ))}
        </div>
        <div style={{ textAlign:"center", padding:"24px 28px 0" }}>
          <div style={{ width:84, height:84, borderRadius:"50%", background:s.color+"20", border:`2px solid ${s.color}44`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:40, margin:"0 auto 20px" }}>{s.icon}</div>
          <h2 style={{ color:"#fff", fontSize:20, fontWeight:800, margin:"0 0 12px", fontFamily:font.display, lineHeight:1.2 }}>{s.title}</h2>
          <p style={{ color:"rgba(255,255,255,0.65)", fontSize:14, lineHeight:1.7, margin:0 }}>{s.desc}</p>
        </div>
        <div style={{ padding:"24px 28px 28px", display:"flex", gap:10 }}>
          {step > 0 && (
            <button onClick={()=>setStep(s=>s-1)} style={{ flex:1, padding:"13px", border:"1px solid rgba(255,255,255,0.15)", borderRadius:14, background:"transparent", color:"rgba(255,255,255,0.6)", fontSize:14, cursor:"pointer", fontFamily:"inherit", fontWeight:600 }}>← Précédent</button>
          )}
          <button onClick={()=>{ if(isLast) onDone(); else setStep(s=>s+1); }} style={{ flex:2, padding:"13px", border:"none", borderRadius:14, background:s.color, color:"#fff", fontSize:14, fontWeight:800, cursor:"pointer", fontFamily:"inherit" }}>
            {isLast ? "C'est parti ! 🚀" : "Suivant →"}
          </button>
        </div>
        {!isLast && (
          <button onClick={onDone} style={{ display:"block", width:"100%", padding:"0 0 18px", background:"none", border:"none", color:"rgba(255,255,255,0.3)", fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>Passer</button>
        )}
      </div>
    </div>
  );
}

export function PrestaClientsTab() {
  const [clients, setClients] = useState([]);
  const [blocked, setBlocked] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(()=>{
    let blockedList = []; try { blockedList = JSON.parse(localStorage.getItem("alane_blocked_clients")||"[]"); } catch { /* ignore */ }
    setBlocked(blockedList);
    supabase.auth.getUser().then(async ({data})=>{
      const uid = data?.user?.id; if(!uid){ setLoading(false); return; }
      const {data:prestations} = await supabase.from("missions").select("client_id,date,sector,metier,montant_total").eq("prestataire_id",uid).in("status",["completed","assigned"]).order("date",{ascending:false});
      if(!prestations){ setLoading(false); return; }
      const seen = new Map();
      for(const m of prestations){
        if(!seen.has(m.client_id)) seen.set(m.client_id, { clientId:m.client_id, lastDate:m.date, sector:m.sector, metier:m.metier, missionCount:0, total:0 });
        const c = seen.get(m.client_id);
        c.missionCount++;
        c.total += Number(m.montant_total||0);
      }
      const ids = [...seen.keys()];
      if(ids.length){
        const {data:profiles} = await supabase.from("profiles").select("id,prenom,nom").in("id",ids);
        for(const p of (profiles||[])){
          const c = seen.get(p.id);
          if(c) c.name = `${p.prenom||""} ${p.nom||""}`.trim() || "Client";
        }
      }
      setClients([...seen.values()]);
      setLoading(false);
    });
  },[]);

  const toggleBlock = (clientId) => {
    setBlocked(prev=>{
      const next = prev.includes(clientId) ? prev.filter(id=>id!==clientId) : [...prev, clientId];
      try { localStorage.setItem("alane_blocked_clients", JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  if(loading) return <div style={{ textAlign:"center", padding:30, color:C.textSub }}>Chargement…</div>;

  return (
    <div>
      <div style={{ background:`${C.violet}12`, border:`1px solid ${C.violet}30`, borderRadius:r, padding:"12px 14px", marginBottom:16, fontSize:12, color:C.textSub, lineHeight:1.6 }}>
        👥 Historique de vos clients. Bloquez un client pour ne plus recevoir ses prestations.
      </div>
      {clients.length === 0 ? (
        <div style={{ textAlign:"center", padding:"28px 16px", color:C.textSub, fontSize:13 }}>
          <div style={{ fontSize:36, marginBottom:10 }}>👥</div>
          Aucun client pour le moment
        </div>
      ) : clients.map(c=>{
        const isBlocked = blocked.includes(c.clientId);
        const sector = SECTORS.find(s=>s.id===c.sector);
        return (
          <div key={c.clientId} style={{ background:"#0D1B3E", border:`1.5px solid ${isBlocked?"rgba(242,94,94,0.4)":C.border}`, borderRadius:14, padding:"13px 14px", marginBottom:10, display:"flex", gap:12, alignItems:"center" }}>
            <div style={{ width:42, height:42, borderRadius:12, background:isBlocked?"rgba(242,94,94,0.15)":`${C.violet}20`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>
              {isBlocked?"🚫":"🏢"}
            </div>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:700, color:isBlocked?C.accent:C.text, fontSize:14 }}>{c.name||"Client"}</div>
              <div style={{ color:C.textSub, fontSize:11, marginTop:2 }}>
                {c.missionCount} prestation{c.missionCount>1?"s":""} · {sector?.label||c.sector||""}
                {c.total>0 && ` · ${c.total.toFixed(0)} €`}
              </div>
              {c.lastDate && <div style={{ color:C.textMuted, fontSize:10, marginTop:1 }}>Dernière prestation : {c.lastDate}</div>}
            </div>
            <button onClick={()=>toggleBlock(c.clientId)} style={{ padding:"7px 11px", borderRadius:9, border:`1px solid ${isBlocked?"rgba(242,94,94,0.5)":C.border}`, background:isBlocked?"rgba(242,94,94,0.12)":"rgba(255,255,255,0.05)", color:isBlocked?C.accent:C.textSub, fontSize:11, fontWeight:700, cursor:"pointer", fontFamily:"inherit", flexShrink:0 }}>
              {isBlocked?"Débloquer":"Bloquer"}
            </button>
          </div>
        );
      })}
    </div>
  );
}

// Instant du début prévu, tel que le navigateur le voit.
//
// `debutPrestationMs` n'est PAS utilisable ici : elle interprète une date naïve
// dans le fuseau du runtime puis applique le décalage français. C'est juste sur
// Vercel, qui tourne en UTC, et faux dans un navigateur déjà à l'heure de Paris.
// Chaque côté calcule donc l'instant à sa façon ; seule la RÈGLE des fenêtres
// est partagée.
function debutLocalMs(m) {
  if (!m?.date) return null;
  const heure = String(m.heure_debut || "00:00").slice(0, 5);
  const t = new Date(`${m.date}T${heure}`).getTime();
  return Number.isNaN(t) ? null : t;
}

export function PrestaDashboard({ onNavigate, activeScreen, docsRefreshKey=0, notifCount=0 }) {
  // Opposition à une proposition de résolution (CGPS art. 17.1). Même geste
  // que côté client, même endpoint : c'est le serveur qui vérifie que
  // l'appelant est bien partie au litige.
  const opposerResolution = async (missionId) => {
    try {
      const { data:sd } = await supabase.auth.getSession();
      const res = await fetch("/api/missions", {
        method:"POST",
        headers:{ "Content-Type":"application/json", "Authorization":`Bearer ${sd?.session?.access_token}` },
        body: JSON.stringify({ action:"opposer_resolution", mission_id: missionId }),
      });
      const j = await res.json();
      if (j.success) {
        const at = new Date().toISOString();
        setHistoryMissions(ms => ms.map(m => m.id === missionId ? { ...m, resolution_opposition_at: at } : m));
        showToast("Opposition enregistrée — les fonds restent bloqués.", "success");
      } else {
        showToast(j.error || "Votre opposition n'a pas pu être enregistrée.");
      }
    } catch (e) {
      console.error("[opposer_resolution] échec :", e.message);
      showToast("Erreur réseau — votre opposition n'a pas été enregistrée, réessayez.");
    }
  };

  const [tab,setTab]=useState("prestations");
  const [_userRib,setUserRib]=useState(null);
  const [ribMissionError,_setRibMissionError]=useState(false);
  const [spotsLeft,setSpotsLeft]=useState(null);
  const [planActuel,setPlanActuel]=useState("free");
  const [planLoaded,setPlanLoaded]=useState(false);
  const [userName,setUserName]=useState("");
  const [userStatus,setUserStatus]=useState(null);
  const [missionsEnabled,setMissionsEnabled]=useState(false);
  const [dispoRapide,setDispoRapide]=useState(true);
  const [showTour,setShowTour]=useState(false);
  const [statsData,setStatsData]=useState({prestations:0,revenuMois:0,note:null,taux:null});
  const [completedMissions,setCompletedMissions]=useState([]);
  const [historyMissions,setHistoryMissions]=useState([]);
  // Sommes dues à ALANE (CGPS art. 8B.3). La notification envoyée au prestataire
  // lors d'une retenue lui annonce que « le détail figure dans votre espace » :
  // sans cet écran, la promesse était vide et la retenue restait inexpliquée.
  const [creances,setCreances]=useState([]);
  // Mandat de facturation : sans lui, ALANE ne peut pas établir de facture au
  // nom du prestataire (art. 289 I-2 du CGI). Le document reste alors une simple
  // attestation, sans numéro — donc inutilisable pour sa comptabilité.
  const [mandatFacturation,setMandatFacturation]=useState(null); // null = inconnu
  const [mandatEnCours,setMandatEnCours]=useState(false);
  // Mandat d'encaissement — distinct des CGPS et du mandat de facturation. Il
  // autorise ALANE à encaisser le prix au nom du prestataire ; c'est la pièce
  // sur laquelle repose la qualification de l'activité.
  const [mandatEncaissement,setMandatEncaissement]=useState(null);
  const [encaissementEnCours,setEncaissementEnCours]=useState(false);

  const accepterMandatEncaissement = async () => {
    setEncaissementEnCours(true);
    try {
      const { data: sd } = await supabase.auth.getSession();
      const jwt = sd?.session?.access_token;
      if (!jwt) { showToast("Session expirée — reconnectez-vous"); setEncaissementEnCours(false); return; }
      const r = await fetch("/api/missions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${jwt}` },
        body: JSON.stringify({ action: "accepter_mandat_encaissement" }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.success) { showToast(d.error || `Erreur ${r.status}`); setEncaissementEnCours(false); return; }
      setMandatEncaissement(new Date().toISOString());
      showToast("Mandat d'encaissement accepté.");
    } catch (e) { showToast(e?.message || "Erreur réseau"); }
    setEncaissementEnCours(false);
  };

  // Export comptable. Un auto-entrepreneur déclare son chiffre d'affaires chaque
  // trimestre et le récapitule chaque année : il lui fallait jusqu'ici rouvrir
  // ses prestations une par une. L'article 242 bis du CGI imposera de toute façon
  // un récapitulatif annuel — autant produire un fichier qui serve aux deux.
  //
  // Les montants sont ceux RÉELLEMENT versés (`payout_amount` quand il existe),
  // jamais un recalcul : c'est sur ce chiffre que se déclare le revenu, et un
  // écart d'un euro entre l'export et la banque coûte une heure de vérification
  // à quelqu'un qui n'est pas comptable.
  const exporterComptabilite = () => {
    const annee = new Date().getFullYear();
    const lignes = completedMissions
      .filter(m => (m.date || "").startsWith(String(annee)))
      .sort((a, b) => (a.date || "").localeCompare(b.date || ""));

    if (!lignes.length) { showToast(`Aucune prestation terminée en ${annee}.`); return; }

    const champ = (v) => {
      const t = String(v ?? "");
      return /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const etats = { pending:"en attente", processing:"en cours", transferred:"versé", held:"retenu", failed:"bloqué" };
    const entete = ["Date","Prestation","Ville","Heures","Tarif horaire","Montant net","Retenue","Versement","N° de facture"];
    const corps = lignes.map(m => [
      m.date || "",
      m.titre || m.metier || SECTORS.find(x => x.id === m.sector)?.label || "Prestation",
      m.ville || "",
      String(m.actual_hours ?? m.hours ?? ""),
      String(m.tarif_horaire ?? ""),
      Number(m.payout_amount ?? montantPrestataire(m)).toFixed(2),
      Number(m.payout_compensation || 0).toFixed(2),
      etats[m.payout_status] || "",
      m.invoice_number || "",
    ].map(champ).join(";"));

    const total = lignes.reduce((t, m) => t + Number(m.payout_amount ?? montantPrestataire(m)), 0);
    corps.push(["", "TOTAL " + annee, "", "", "", total.toFixed(2), "", "", ""].map(champ).join(";"));

    // Point-virgule et BOM : sans eux, Excel en français ouvre tout dans une
    // seule colonne et massacre les accents.
    const csv = "\uFEFF" + [entete.map(champ).join(";"), ...corps].join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `alane-prestations-${annee}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`${lignes.length} prestation${lignes.length>1?"s":""} exportée${lignes.length>1?"s":""}.`);
  };

  const accepterMandat = async () => {
    setMandatEnCours(true);
    try {
      const { data: sd } = await supabase.auth.getSession();
      const jwt = sd?.session?.access_token;
      if (!jwt) { showToast("Session expirée — reconnectez-vous"); setMandatEnCours(false); return; }
      const r = await fetch("/api/missions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${jwt}` },
        body: JSON.stringify({ action: "accepter_mandat_facturation" }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.success) { showToast(d.error || `Erreur ${r.status}`); setMandatEnCours(false); return; }
      setMandatFacturation(new Date().toISOString());
      showToast("Mandat accepté — vos factures sont désormais établies à votre nom.");
    } catch (e) { showToast(e?.message || "Erreur réseau"); }
    setMandatEnCours(false);
  };
  const [missionsUsedMonth,setMissionsUsedMonth]=useState(0);
  // Limite mensuelle telle que le serveur l'applique réellement. Le front la
  // déduisait d'une constante où le plan gratuit annonce 10 prestations, alors que
  // `plan_limits` en accorde 2 hors offre de lancement : un prestataire pouvait lire
  // « 2/10 » en étant déjà bloqué. Seul /api/missions connaît la vraie valeur.
  const [limiteMensuelle,setLimiteMensuelle]=useState(null);
  const [ratedMissions, setRatedMissions] = useState(new Set());
  const [ratingTarget, setRatingTarget] = useState(null);
  const [streak, setStreak] = useState(0);
  const [recapCard, setRecapCard] = useState(null);
  const [ratingValue, setRatingValue] = useState(0);
  const [ratingComment, setRatingComment] = useState("");
  const [ratingLoading, setRatingLoading] = useState(false);
  const [profilPct,setProfilPct]=useState(0);
  const [_missingDocs,setMissingDocs]=useState([]);
  const [uploadedDocIds,setUploadedDocIds]=useState([]);
  const [verifiedDocIds,setVerifiedDocIds]=useState([]);
  const [launchPhaseActive,setLaunchPhaseActive]=useState(isLaunchPhase());
  const [dashPhotoUrl,setDashPhotoUrl]=useState(null);
  useEffect(()=>{
    if(activeScreen==="p_dashboard") setTab("profil");
    else if(activeScreen==="p_missions"||activeScreen==="p_home") setTab("prestations");
  },[activeScreen]);
  useEffect(()=>{
    (async()=>{
      const { data: { session } } = await supabase.auth.getSession().catch(() => ({ data: {} }));
      const u = session?.user; if(!u) return;
      setUserRib(u.user_metadata?.rib||null);
      setDispoRapide(u.user_metadata?.dispo_immediat !== false);
      setUserName([u.user_metadata?.prenom,u.user_metadata?.nom].filter(Boolean).join(" ")||"Mon espace");
      // profiles.avatar_url d'abord (hors JWT), repli metadata pour les comptes non migrés
      supabase.from("profiles").select("avatar_url,mandat_facturation_at,mandat_encaissement_at").eq("id", u.id).single()
        .then(({ data }) => {
          setDashPhotoUrl(data?.avatar_url || u.user_metadata?.photo_url || null);
          setMandatFacturation(data?.mandat_facturation_at || null);
          setMandatEncaissement(data?.mandat_encaissement_at || null);
        });
      const m=u.user_metadata||{};
      const checks=[!!m.prenom,!!m.nom,!!m.telephone,!!m.rib,!!(m.secteur||m.metiers_list?.length),!!(m.ae_siret||m.siret),!!m.bio,!!(m.adresse||m.rue),Object.values(m.dispon_jours_creneaux||{}).some(v=>v?.length>0),!!m.langues?.length];
      setProfilPct(Math.round(checks.filter(Boolean).length/checks.length*100));
      const tourKey=`alane_presta_tour_done_${u.id}`;
      let prestaTourDone; try { prestaTourDone = localStorage.getItem(tourKey); } catch { /* ignore */ }
      if(!prestaTourDone) setShowTour(true);
      const token = session?.access_token || "";
      const [prof,{data:mData},{data:rData},planJson]=await Promise.all([
        fetch("/api/get-profile",{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${token}`},body:JSON.stringify({})}).then(async r=>{
          if(r.status===404){await supabase.auth.signOut();return "__deleted__";}
          return r.ok?r.json():null;
        }).catch(()=>null),
        supabase.from("missions").select("id,client_id,montant_total,tarif_horaire,hours,actual_hours,date,date_debut,date_fin,heure_debut,sector,metier,titre,status,payout_status,payout_amount,payout_due_at,resolution_proposee,resolution_motif,resolution_echeance_at,resolution_opposition_at").eq("prestataire_id",u.id).in("status",["assigned","completed","refused","cancelled","disputed"]),
        supabase.from("ratings").select("rating").eq("reviewee_provider_id",u.id),
        fetch("/api/missions",{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${token}`},body:JSON.stringify({action:"refresh_plan"})}).then(r=>r.json()).catch(()=>null),
      ]);
      if(prof==="__deleted__") return;
      if(prof) {
        setUserStatus(prof.status);
        setMissionsEnabled(prof.missions_enabled === true);
      }
      // Le plan affiché suit le serveur, qui ne retient plus que `profiles`. Il était
      // calculé comme le plus élevé des trois sources, user_metadata compris : le
      // prestataire lisait « Elite » — choisi à l'inscription, jamais payé — tout en
      // étant limité au quota gratuit.
      setPlanActuel(planJson?.plan || prof?.plan_abonnement || "free");
      if (planJson?.limite_mensuelle != null) setLimiteMensuelle(Number(planJson.limite_mensuelle));
      setPlanLoaded(true);
      const getAmt = montantPrestataire;
      const allM=Array.isArray(mData)?mData:[];
      const done=allM.filter(m=>m.status==="completed");
      const refused=allM.filter(m=>m.status==="refused");
      const som=new Date(new Date().getFullYear(),new Date().getMonth(),1);
      const doneMois=done.filter(m=>m.date&&new Date(m.date)>=som);
      const revenuMois=doneMois.reduce((s,m)=>s+getAmt(m),0);
      const rList=(Array.isArray(rData)?rData:[]).map(r=>r.rating).filter(Boolean);
      const avgNote=rList.length?(rList.reduce((a,b)=>a+b,0)/rList.length):null;
      const totalR=done.length+refused.length;
      const taux=totalR>0?Math.round((done.length/totalR)*100):null;
      setStatsData({prestations:done.length,revenuMois:Math.round(revenuMois*100)/100,note:avgNote?avgNote.toFixed(1):null,taux:taux!==null?taux+"%":null});
      setCompletedMissions(done);
      // `disputed` était absent de cette liste : un prestataire dont la
      // prestation était contestée ne la voyait plus nulle part — ni le litige,
      // ni la proposition de résolution qu'il a 48 h pour contester (CGPS 17.1).
      // Un droit qu'on ne voit pas ne s'exerce pas.
      setHistoryMissions([...done, ...allM.filter(m => ["cancelled","refused","disputed"].includes(m.status))].sort((a,b) => (b.date||"").localeCompare(a.date||"")));

      // Lecture directe : la RLS n'autorise que ses propres créances.
      supabase.from("creances_prestataires")
        .select("id,montant_initial,montant_restant,motif,statut,notifiee_at,exigible_at,created_at")
        .in("statut", ["active","contestee"])
        .order("created_at", { ascending: false })
        .then(({ data, error }) => {
          // Une erreur silencieuse afficherait « aucune somme due » à quelqu'un
          // à qui l'on retient la moitié de chaque versement (règle 1.2).
          if (error) { console.error("[presta] créances illisibles :", error.message); return; }
          setCreances(Array.isArray(data) ? data : []);
        });

      // Streak: consecutive calendar days with ≥1 completed mission, backwards from yesterday
      const missionDays = new Set(done.map(m => m.date?.slice(0,10)).filter(Boolean));
      let s = 0;
      const ref = new Date(); ref.setDate(ref.getDate() - 1); // start from yesterday
      for (let i = 0; i < 365; i++) {
        const key = ref.toISOString().slice(0,10);
        if (missionDays.has(key)) { s++; ref.setDate(ref.getDate() - 1); }
        else break;
      }
      setStreak(s);

      // Recap card: show for newest completed mission not yet seen
      const seenKey = `alane_presta_recap_seen_${u.id}`;
      let seenIds; try { seenIds = new Set(JSON.parse(localStorage.getItem(seenKey)||"[]")); } catch(e) { seenIds = new Set(); }
      const unseen = done.filter(m => !seenIds.has(m.id)).sort((a,b) => (b.date||"") > (a.date||"") ? 1 : -1);
      if (unseen.length > 0) setRecapCard(unseen[0]);

      // Même raison que côté client : filtrer sur `reviewer_id` imposait de
      // laisser cette colonne lisible par tous.
      try {
        const rAvis = await fetch("/api/missions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
          body: JSON.stringify({ action: "mes_avis" }),
        });
        const jAvis = await rAvis.json();
        if (Array.isArray(jAvis.mission_ids)) setRatedMissions(new Set(jAvis.mission_ids));
        else console.error("[avis] liste illisible :", jAvis?.error);
      } catch (e) {
        console.error("[avis] relecture impossible :", e.message);
      }
      const assignedNow = allM.filter(m=>m.status==="assigned").length;
      setMissionsUsedMonth(doneMois.length + assignedNow);
      const { data: docsArr } = await supabase.from("documents").select("type,verified").eq("prestataire_id", u.id);
      const uploaded = (Array.isArray(docsArr)?docsArr:[]).map(d=>d.type);
      // « Envoyé » et « validé par le backoffice » sont deux états distincts :
      // l'écran affichait « ✓ Validé » dès le dépôt, alors que le backoffice
      // affichait encore « En attente ».
      setVerifiedDocIds((Array.isArray(docsArr)?docsArr:[]).filter(d=>d.verified).map(d=>d.type));
      // Photo stockée dans profiles.avatar_url — pas dans la table documents
      const { data: profPhoto } = await supabase.from("profiles").select("avatar_url").eq("id", u.id).single();
      if ((profPhoto?.avatar_url || u.user_metadata?.photo_url) && !uploaded.includes("photo")) uploaded.push("photo");

      // Réessayer les inserts en attente (docs uploadés sur iOS dont le fetch DB a été annulé)
      try {
        const pending = JSON.parse(localStorage.getItem(PENDING_DOCS_KEY)||'[]');
        const mine = pending.filter(e=>e.uid===u.id && !uploaded.includes(e.type));
        if (mine.length) {
          const { data: pd } = await supabase.auth.getSession().catch(() => ({ data: {} }));
          const pAt = pd?.session?.access_token || "";
          const SB_URL_P = import.meta.env.VITE_SUPABASE_URL;
          const SB_KEY_P = import.meta.env.VITE_SUPABASE_ANON_KEY;
          const done = [];
          await Promise.all(mine.map(e =>
            fetch(`${SB_URL_P}/rest/v1/documents?on_conflict=prestataire_id,type`, {
              method:"POST",
              headers:{"Authorization":`Bearer ${pAt}`,"apikey":SB_KEY_P,"Content-Type":"application/json","Prefer":"return=minimal,resolution=merge-duplicates"},
              body:JSON.stringify({ prestataire_id:e.uid, type:e.type, storage_path:e.sp, verified:false }),
            }).then(r=>{ if(r.ok){ done.push(e.sp); uploaded.push(e.type); } }).catch(()=>{})
          ));
          if (done.length) {
            localStorage.setItem(PENDING_DOCS_KEY, JSON.stringify(pending.filter(e=>!done.includes(e.sp))));
          }
        }
      } catch { /* file d'attente illisible → on repart de la liste serveur ci-dessous */ }

      setUploadedDocIds(uploaded);
      // Même règle que dans l'inscription : le titre de séjour n'est réclamé
      // qu'aux ressortissants hors UE. Le lire depuis user_metadata évite un
      // aller-retour et suit la déclaration faite à l'inscription.
      const required = docsRequisPour(u?.user_metadata?.nationalite).filter(d=>d.required).map(d=>d.id);
      setMissingDocs(required.filter(id=>!uploaded.includes(id)));
    })();
    supabase.from("profiles").select("id",{count:"exact",head:true}).eq("role","prestataire").eq("status","approved")
      .then(({count})=>{ if(count!=null) setSpotsLeft(Math.max(0,100-count)); });
    supabase.from("platform_settings").select("value").eq("key","launch_phase").single()
      .then(({data})=>{ if(data?.value!=null) setLaunchPhaseActive(Boolean(data.value)); });
  },[docsRefreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const refresh = async () => {
      if (document.visibilityState !== "visible") return;
      const { data: { session: sess2 } } = await supabase.auth.getSession().catch(() => ({ data: {} }));
      const u = sess2?.user; if (!u) return;
      const token = sess2?.access_token || "";
      const [profRes, planJson] = await Promise.all([
        supabase.from("profiles").select("status,missions_enabled,plan_abonnement").eq("id", u.id).single(),
        fetch("/api/missions",{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${token}`},body:JSON.stringify({action:"refresh_plan"})}).then(r=>r.json()).catch(()=>null),
      ]);
      if (profRes.data) {
        setUserStatus(profRes.data.status);
        setMissionsEnabled(profRes.data.missions_enabled === true);
      }
      setPlanActuel(planJson?.plan || profRes.data?.plan_abonnement || "free");
      if (planJson?.limite_mensuelle != null) setLimiteMensuelle(Number(planJson.limite_mensuelle));
    };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, []);

  const dismissTour = async () => {
    setShowTour(false);
    const {data} = await supabase.auth.getUser();
    const u = data?.user;
    if(u) { try { localStorage.setItem(`alane_presta_tour_done_${u.id}`,"1"); } catch { /* ignore */ } }
  };

  const dismissRecap = async () => {
    if (!recapCard) return;
    const { data } = await supabase.auth.getUser();
    const uid = data?.user?.id; if (!uid) { setRecapCard(null); return; }
    const seenKey = `alane_presta_recap_seen_${uid}`;
    let seenIds; try { seenIds = new Set(JSON.parse(localStorage.getItem(seenKey)||"[]")); } catch(e) { seenIds = new Set(); }
    seenIds.add(recapCard.id);
    // Cap à 500 pour éviter un localStorage illimité — on garde les plus récents
    const seenArr = [...seenIds];
    const capped = seenArr.length > 500 ? seenArr.slice(seenArr.length - 500) : seenArr;
    try { localStorage.setItem(seenKey, JSON.stringify(capped)); } catch { /* ignore */ }
    setRecapCard(null);
  };

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg, #0A1628 0%, #0D1B3E 100%)`, paddingBottom:80 }}>
      {/* ── Recap Card ── */}
      {recapCard && (() => {
        const getAmt = montantPrestataire;
        const amt = getAmt(recapCard);
        const billedHours = recapCard.actual_hours ?? recapCard.hours;
        const sector = SECTORS.find(s => s.id === recapCard.sector);
        const dateLabel = recapCard.date
          ? (() => { try { return new Date(recapCard.date).toLocaleDateString("fr-FR",{day:"numeric",month:"long",year:"numeric"}); } catch(e) { return recapCard.date; } })()
          : "";
        return (
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", display:"flex", alignItems:"flex-end", justifyContent:"center", zIndex:9990, backdropFilter:"blur(3px)", WebkitBackdropFilter:"blur(3px)" }}>
            <div style={{ background:"linear-gradient(180deg,#0D1B3E,#091224)", borderRadius:"24px 24px 0 0", padding:"14px 20px 0", paddingBottom:"calc(96px + env(safe-area-inset-bottom, 16px))", width:"100%", maxWidth:480, border:`1px solid rgba(16,217,143,0.25)`, borderBottom:"none", textAlign:"center", maxHeight:"80vh", overflowY:"auto" }}>
              <div style={{ width:36, height:4, background:"rgba(255,255,255,0.15)", borderRadius:2, margin:"0 auto 14px" }} />
              <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:12, marginBottom:10 }}>
                <div style={{ width:52, height:52, borderRadius:"50%", background:"linear-gradient(135deg,rgba(16,217,143,0.2),rgba(10,191,122,0.1))", border:"2px solid rgba(16,217,143,0.4)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:24, flexShrink:0, boxShadow:"0 0 20px rgba(16,217,143,0.25)" }}>
                  {sector?.icon || "✅"}
                </div>
                <div style={{ textAlign:"left" }}>
                  <h2 style={{ color:"#10D98F", fontSize:18, fontWeight:900, margin:"0 0 2px", fontFamily:"inherit" }}>Prestation validée ! 🎉</h2>
                  <p style={{ color:C.textSub, fontSize:12, margin:0 }}>{recapCard.metier || sector?.label || "Prestation"} · {dateLabel}</p>
                </div>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:12 }}>
                <div style={{ background:"rgba(16,217,143,0.08)", border:"1px solid rgba(16,217,143,0.2)", borderRadius:12, padding:"12px 10px" }}>
                  <div style={{ fontSize:20, fontWeight:900, color:"#10D98F" }}>{amt > 0 ? `${amt.toFixed(2).replace(".",",")} €` : "—"}</div>
                  <div style={{ fontSize:11, color:C.textSub, marginTop:3 }}>Montant gagné</div>
                </div>
                <div style={{ background:"rgba(162,155,254,0.08)", border:"1px solid rgba(162,155,254,0.2)", borderRadius:12, padding:"12px 10px" }}>
                  <div style={{ fontSize:20, fontWeight:900, color:C.violet }}>{billedHours ? `${billedHours}h` : "—"}</div>
                  <div style={{ fontSize:11, color:C.textSub, marginTop:3 }}>Durée réalisée</div>
                </div>
              </div>
              {streak >= 2 && (
                <div style={{ background:"rgba(240,180,41,0.1)", border:"1px solid rgba(240,180,41,0.3)", borderRadius:10, padding:"8px 12px", marginBottom:12, display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
                  <span style={{ fontSize:16 }}>🔥</span>
                  <span style={{ color:C.accentGold, fontWeight:700, fontSize:12 }}>{streak} jours de suite — continuez comme ça !</span>
                </div>
              )}
              <button onClick={dismissRecap} style={{ width:"100%", padding:"13px", borderRadius:13, border:"none", background:"linear-gradient(135deg,#10D98F,#0ABF7A)", color:"#fff", fontWeight:800, fontSize:15, cursor:"pointer", fontFamily:"inherit" }}>
                Super ! 🚀
              </button>
            </div>
          </div>
        );
      })()}
      {ratingTarget && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", display:"flex", alignItems:"flex-end", justifyContent:"center", zIndex:500, backdropFilter:"blur(4px)", WebkitBackdropFilter:"blur(4px)" }}>
          <div style={{ background:"#0D1B3E", borderRadius:"22px 22px 0 0", padding:"28px 22px 40px", width:"100%", maxWidth:480, border:`1px solid ${C.border}`, borderBottom:"none" }}>
            <div style={{ width:40, height:4, background:C.border, borderRadius:2, margin:"0 auto 20px" }} />
            <h3 style={{ color:C.text, fontSize:17, fontWeight:800, margin:"0 0 4px", textAlign:"center" }}>⭐ Noter le client</h3>
            <p style={{ color:C.textMuted, fontSize:12, textAlign:"center", margin:"0 0 20px" }}>Prestation du {ratingTarget.date} — {ratingTarget.metier || ratingTarget.sector}</p>
            <div style={{ display:"flex", justifyContent:"center", gap:10, marginBottom:20 }}>
              {[1,2,3,4,5].map(s => (
                <button key={s} onClick={()=>setRatingValue(s)}
                  style={{ fontSize:32, background:"none", border:"none", cursor:"pointer", opacity: s <= ratingValue ? 1 : 0.25, transform: s <= ratingValue ? "scale(1.1)" : "scale(1)", transition:"all 0.15s" }}>
                  ⭐
                </button>
              ))}
            </div>
            <textarea
              value={ratingComment}
              onChange={e=>setRatingComment(e.target.value)}
              placeholder="Commentaire optionnel…"
              style={{ width:"100%", padding:"12px", borderRadius:12, border:`1px solid ${C.border}`, background:"#112240", color:C.text, fontSize:13, fontFamily:"inherit", resize:"none", height:80, boxSizing:"border-box", outline:"none", marginBottom:16 }}
            />
            <div style={{ display:"flex", gap:10 }}>
              <button onClick={()=>{ setRatingTarget(null); setRatingValue(0); setRatingComment(""); }}
                style={{ flex:1, padding:"12px", borderRadius:12, border:`1px solid ${C.border}`, background:"none", color:C.textSub, fontWeight:600, fontSize:14, cursor:"pointer", fontFamily:"inherit" }}>
                Annuler
              </button>
              <button
                disabled={ratingValue === 0 || ratingLoading}
                onClick={async()=>{
                  if(ratingValue === 0) return;
                  setRatingLoading(true);
                  const { data:{ session } } = await supabase.auth.getSession();
                  if(!session) { setRatingLoading(false); return; }
                  // Aucun contrôle n'existait de ce côté : l'écriture partait du
                  // navigateur, sans vérifier que le prestataire avait bien travaillé
                  // avec ce client ni qu'il n'avait pas déjà noté. Le serveur tranche.
                  const rN = await fetch("/api/missions", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session.access_token || ""}` },
                    body: JSON.stringify({ action: "submit_rating", mission_id: ratingTarget.id, rating: ratingValue, comment: ratingComment.trim() || null }),
                  }).catch(() => null);
                  if (!rN || !rN.ok) {
                    const jN = rN ? await rN.json().catch(() => ({})) : {};
                    console.error("[avis] dépôt impossible :", jN.error || rN?.status);
                    showToast(jN.error || "Avis non enregistré — réessayez.", "error");
                    setRatingLoading(false);
                    return;
                  }
                  setRatedMissions(prev => new Set([...prev, ratingTarget.id]));
                  setRatingTarget(null);
                  setRatingValue(0);
                  setRatingComment("");
                  setRatingLoading(false);
                }}
                style={{ flex:2, padding:"12px", borderRadius:12, border:"none", background: ratingValue === 0 ? C.grayLight : `linear-gradient(135deg,${C.violet},${C.indigo})`, color: ratingValue === 0 ? C.textMuted : C.white, fontWeight:700, fontSize:14, cursor: ratingValue === 0 ? "not-allowed" : "pointer", fontFamily:"inherit" }}>
                {ratingLoading ? "Envoi…" : "Envoyer la note"}
              </button>
            </div>
          </div>
        </div>
      )}
      {showTour && <PrestaTour onDone={dismissTour} />}
      <div style={{ background:"linear-gradient(135deg, #0A1628, #162547)", padding:"48px 22px 28px", borderRadius:"0 0 26px 26px" }}>
        <div style={{ display:"flex", gap:14, alignItems:"center", marginBottom:18 }}>
          <div style={{ width:58, height:58, borderRadius:18, background:`${C.accent}44`, overflow:"hidden", display:"flex", alignItems:"center", justifyContent:"center", fontSize:28, border:"2px solid rgba(255,255,255,0.2)", flexShrink:0 }}>
      {dashPhotoUrl
        ? <img src={dashPhotoUrl} alt="Photo de profil" style={{ width:"100%", height:"100%", objectFit:"cover" }} />
        : "👨‍💼"}
    </div>
          <div style={{ flex:1 }}>
            <p style={{ color:"rgba(255,255,255,0.5)", fontSize:11, margin:0 }}>Espace prestataire</p>
            <h2 style={{ color:C.white, fontSize:18, fontWeight:800, margin:"2px 0 5px" }}>{userName||"Mon espace"}</h2>
            <div style={{ display:"flex", gap:6 }}>
              <div style={{ width:8, height:8, borderRadius:"50%", background:userStatus==="approved"?C.success:userStatus==="rejected"?C.accent:userStatus===null?"rgba(255,255,255,0.3)":C.accentGold }} />
              <span style={{ color:userStatus==="approved"?C.success:userStatus==="rejected"?C.accent:userStatus===null?"rgba(255,255,255,0.4)":C.accentGold, fontSize:11, fontWeight:700 }}>{userStatus==="approved"?"Compte validé":userStatus==="rejected"?"Compte refusé":userStatus===null?"…":"En attente de validation"}</span>
            </div>
          </div>
          <button onClick={()=>onNavigate("notifications")} style={{ position:"relative", background:"rgba(255,255,255,0.1)", border:"none", borderRadius:12, width:42, height:42, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, cursor:"pointer", flexShrink:0 }}>
            🔔
            {notifCount > 0 && (
              <div style={{ position:"absolute", top:-4, right:-4, background:"#E74C3C", borderRadius:"50%", width:18, height:18, fontSize:10, fontWeight:900, color:"#fff", display:"flex", alignItems:"center", justifyContent:"center" }}>{notifCount > 9 ? "9+" : notifCount}</div>
            )}
          </button>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8 }}>
          {[
            {l:"Prestations",v:String(statsData.prestations||0),i:"✅"},
            {l:"Ce mois",v:statsData.revenuMois>0?(statsData.revenuMois+"€"):"—",i:"💶"},
            {l:"Note",v:statsData.note?(statsData.note+"★"):"—",i:"⭐"},
            {l:"Streak",v:streak>0?`🔥${streak}j`:"—",i:"",highlight:streak>=3},
          ].map(s=>(
            <div key={s.l} style={{ background:s.highlight?"linear-gradient(135deg,rgba(240,180,41,0.2),rgba(240,120,41,0.12))":"rgba(255,255,255,0.1)", borderRadius:12, padding:"10px 6px", textAlign:"center", border:s.highlight?"1px solid rgba(240,180,41,0.4)":"none" }}>
              {s.i && <div style={{ fontSize:16 }}>{s.i}</div>}
              <div style={{ color:s.highlight?C.accentGold:C.white, fontWeight:800, fontSize:s.highlight?13:12 }}>{s.v}</div>
              <div style={{ color:"rgba(255,255,255,0.45)", fontSize:9 }}>{s.l}</div>
            </div>
          ))}
        </div>
        {/* Complétude du profil */}
        {profilPct < 100 && (
          <div onClick={()=>onNavigate("presta_profile_edit")} style={{ background:"rgba(255,255,255,0.07)", borderRadius:12, padding:"10px 14px", marginTop:10, cursor:"pointer" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
              <span style={{ color:"rgba(255,255,255,0.7)", fontSize:11, fontWeight:600 }}>Complétude du profil</span>
              <span style={{ color:profilPct>=80?C.success:profilPct>=50?C.accentGold:C.accent, fontSize:11, fontWeight:800 }}>{profilPct}%</span>
            </div>
            <div style={{ height:4, borderRadius:2, background:"rgba(255,255,255,0.15)", overflow:"hidden" }}>
              <div style={{ height:"100%", width:`${profilPct}%`, borderRadius:2, background:profilPct>=80?C.success:profilPct>=50?C.accentGold:C.accent, transition:"width 0.6s" }} />
            </div>
            <p style={{ color:"rgba(255,255,255,0.4)", fontSize:10, margin:"4px 0 0" }}>Complétez votre profil pour être mis en avant →</p>
          </div>
        )}
        {/* Toggle disponibilité rapide */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", background:"rgba(255,255,255,0.07)", borderRadius:12, padding:"10px 14px", marginTop:10 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <div style={{ width:8, height:8, borderRadius:"50%", background:dispoRapide?C.success:"rgba(255,255,255,0.3)" }} />
            <span style={{ color:C.text, fontSize:12, fontWeight:600 }}>
              {dispoRapide ? "Disponible maintenant" : "Non disponible"}
            </span>
          </div>
          <button onClick={()=>{ const v=!dispoRapide; setDispoRapide(v); supabase.auth.updateUser({data:{dispo_immediat:v}}); }}
            style={{ width:44, height:24, borderRadius:12, border:"none", cursor:"pointer", position:"relative",
              background:dispoRapide?C.success:"rgba(255,255,255,0.15)", transition:"background 0.2s" }}>
            <div style={{ position:"absolute", top:3, left:dispoRapide?21:3, width:18, height:18, borderRadius:"50%",
              background:C.white, transition:"left 0.2s" }} />
          </button>
        </div>
        {planLoaded && (() => {
          const plan = ABONNEMENTS_PRESTA.find(p=>p.id===planActuel)||ABONNEMENTS_PRESTA[0];
          return (
            <div onClick={()=>onNavigate("abonnement_presta")} style={{ marginTop:10, display:"flex", alignItems:"center", justifyContent:"space-between", background:"rgba(255,255,255,0.07)", borderRadius:12, padding:"8px 14px", cursor:"pointer" }}>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <span style={{ fontSize:14 }}>{plan.icon}</span>
                <span style={{ color:plan.color, fontWeight:700, fontSize:12 }}>Plan {plan.label}</span>
                {plan.id==="free" && <span style={{ color:C.textMuted, fontSize:11 }}>· Upgrader →</span>}
              </div>
              <span style={{ color:C.textSub, fontSize:11 }}>Gérer ›</span>
            </div>
          );
        })()}
      </div>
      <div style={{ padding:"18px 18px 0" }}>
        {launchPhaseActive && <LaunchBadge context="presta" spotsLeft={spotsLeft} />}
        <div style={{ display:"flex", background:"#162547", borderRadius:12, padding:4, marginBottom:18, overflowX:"auto", WebkitOverflowScrolling:"touch" }}>
          {[{id:"prestations",l:"Prestations"},{id:"profil",l:"Profil"},{id:"docs",l:"Docs"},{id:"revenus",l:"Revenus"},{id:"historique",l:"Historique"},{id:"clients",l:"Clients"}].map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} style={{ flex:"1 0 auto", padding:"9px 4px", border:"none", borderRadius:10, cursor:"pointer", background:tab===t.id?C.white:"transparent", color:tab===t.id?C.navy:C.gray, fontWeight:tab===t.id?700:500, fontSize:11, fontFamily:"inherit", boxShadow:tab===t.id?"0 2px 8px rgba(0,0,0,0.1)":"none" }}>{t.l}</button>
          ))}
        </div>
        {tab==="prestations" && <>
          <PrestaOnboardingChecklist onNavigate={onNavigate} />
          {planLoaded && <UpgradeNudge onNavigate={onNavigate} plan={planActuel} />}
          {/* Bandeau « Prestations urgentes activées — vous êtes prioritaire »
              retiré le 17/08/2026 : aucune priorité de ce genre n'existe.
              `candidatsPourMission` classe par distance puis par charge du mois,
              et s'interdit délibérément de tenir compte de l'abonnement — un
              classement fondé sur autre chose que des critères objectifs
              donnerait prise au reproche d'un pouvoir de direction déguisé
              (CGPS art. 5.2). Annoncer une priorité qui n'existe pas la vendait
              deux fois : au prestataire, et contre la défense de la plateforme. */}
          {ribMissionError && (
            <div style={{ background:"rgba(242,94,94,0.12)", border:"1px solid rgba(242,94,94,0.4)", borderRadius:12, padding:"12px 14px", marginBottom:14, fontSize:13, color:"#F25E5E", lineHeight:1.6 }}>
              🏦 <strong>IBAN / RIB manquant</strong><br/>Ajoutez votre IBAN dans vos réglages avant d'accepter une prestation.
            </div>
          )}
          {planLoaded && (() => {
            const plan = ABONNEMENTS_PRESTA.find(p=>p.id===planActuel)||ABONNEMENTS_PRESTA[0];
            // La constante ne sert que de repli le temps que le serveur réponde.
            const limitBrute = limiteMensuelle != null ? limiteMensuelle : plan.missions;
            const limit = limitBrute >= 999 ? null : limitBrute;
            if(!limit) return null;
            const pct = Math.min(100, Math.round((missionsUsedMonth/limit)*100));
            const remaining = Math.max(0, limit - missionsUsedMonth);
            return (
              <div style={{ background:"rgba(255,255,255,0.04)", border:`1px solid ${remaining===0?"#F25E5E44":C.border}`, borderRadius:12, padding:"10px 14px", marginBottom:14 }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
                  <span style={{ fontSize:12, color:C.textSub }}>Prestations ce mois</span>
                  <span style={{ fontSize:12, fontWeight:700, color:remaining===0?"#F25E5E":C.text }}>{missionsUsedMonth}/{limit}</span>
                </div>
                <div style={{ height:5, borderRadius:99, background:"rgba(255,255,255,0.1)", overflow:"hidden" }}>
                  <div style={{ width:`${pct}%`, height:"100%", borderRadius:99, background:remaining===0?"#F25E5E":C.violet, transition:"width .3s" }} />
                </div>
                {remaining===0 && <div style={{ marginTop:6, fontSize:11, color:"#F25E5E" }}>Limite atteinte — passez en {planActuel==="free"?"Premium":"Elite"} pour continuer</div>}
                {remaining>0 && remaining<=2 && <div style={{ marginTop:6, fontSize:11, color:C.accentGold }}>Plus que {remaining} prestation{remaining>1?"s":""} disponible{remaining>1?"s":""}</div>}
              </div>
            );
          })()}
          <p style={{ fontWeight:800, color:C.text, fontSize:13, marginBottom:12 }}>{activeScreen==="p_home" ? "📋 Mes prestations" : "🔔 Prestations disponibles"}</p>
          {!missionsEnabled ? (
            <div style={{ background:"rgba(240,180,41,0.08)", border:`1px solid rgba(240,180,41,0.35)`, borderRadius:r, padding:"20px 16px", textAlign:"center" }}>
              <div style={{ fontSize:32, marginBottom:10 }}>⏳</div>
              <div style={{ fontWeight:800, color:C.accentGold, fontSize:14, marginBottom:8 }}>Accès aux prestations en attente</div>
              <p style={{ color:C.textSub, fontSize:13, margin:"0 0 12px", lineHeight:1.6 }}>
                L'équipe ALANE doit valider votre dossier avant de vous donner accès aux prestations.<br/>
                Assurez-vous d'avoir uploadé tous vos documents dans l'onglet <strong>Docs</strong>.
              </p>
              <button onClick={()=>{ onNavigate("doc_upload"); }} style={{ background:"rgba(240,180,41,0.2)", border:`1px solid rgba(240,180,41,0.5)`, borderRadius:r, padding:"10px 18px", color:C.accentGold, fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
                📎 Compléter mon dossier
              </button>
            </div>
          ) : (
            <PMissionsTab onNavigate={onNavigate} homeMode={activeScreen==="p_home"} />
          )}
        </>}
        {tab==="profil" && <PrestaProfilTab onNavigate={onNavigate} />}
        {tab==="clients" && <PrestaClientsTab />}
        {tab==="docs" && <>
          <div style={{ background:`${C.accentGold}15`, border:`1px solid ${C.accentGold}44`, borderRadius:12, padding:"11px 14px", marginBottom:14, fontSize:12 }}>⚠️ Certains documents doivent être renouvelés annuellement (attestation URSSAF, RC Pro).</div>
          <div onClick={()=>onNavigate("micro_entreprise")} style={{ background:"linear-gradient(135deg,#4F46E515,#0EA5E910)", border:"1px solid #4F46E540", borderRadius:r, padding:"13px 14px", marginBottom:14, cursor:"pointer", display:"flex", alignItems:"center", gap:10 }}>
            <span style={{ fontSize:22 }}>🚀</span>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:700, color:C.text, fontSize:13 }}>Pas encore auto-entrepreneur ?</div>
              <div style={{ color:C.textSub, fontSize:11, marginTop:2 }}>LegalStart & URSSAF vous accompagnent dans vos démarches</div>
            </div>
            <span style={{ color:C.textMuted, fontSize:16 }}>›</span>
          </div>
          {DOCS_REQUIS.map((doc,i)=>(
            <DocRowItem key={i} doc={doc} isSent={uploadedDocIds.includes(doc.id)} isVerified={verifiedDocIds.includes(doc.id)} onUploaded={(newType)=>{
              setUploadedDocIds(prev => prev.includes(newType) ? prev : [...prev, newType]);
              // Un renvoi repasse le document en attente de vérification
              setVerifiedDocIds(prev => prev.filter(t => t !== newType));
            }} />
          ))}
        </>}
        {tab==="historique" && (()=>{
          const statusLabels = { completed:"Terminée", cancelled:"Annulée", refused:"Refusée", disputed:"Litige en cours" };
          const statusColors = { completed:C.success, cancelled:"#F25E5E", refused:C.textMuted, disputed:"#F2A65E" };
          const getAmtH = montantPrestataire;
          return historyMissions.length === 0 ? (
            <div style={{ background:"rgba(255,255,255,0.04)", border:`1px solid ${C.border}`, borderRadius:18, padding:"28px 16px", textAlign:"center" }}>
              <div style={{ fontSize:36, marginBottom:10 }}>📂</div>
              <div style={{ color:C.text, fontSize:13, fontWeight:600, marginBottom:6 }}>Aucune prestation dans l'historique</div>
              <div style={{ color:C.textMuted, fontSize:12, lineHeight:1.6 }}>Vos prestations passées (terminées, annulées, refusées) apparaîtront ici.</div>
            </div>
          ) : <>
            {historyMissions.map(m => {
              const sector = SECTORS.find(s => s.id === m.sector);
              const amt = getAmtH(m);
              const statusColor = statusColors[m.status] || C.textMuted;
              const statusLabel = statusLabels[m.status] || m.status;
              return (
                <div key={m.id} style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:14, padding:"13px 14px", marginBottom:10 }}>
                  <div style={{ display:"flex", gap:12, alignItems:"center" }}>
                    <div style={{ width:40, height:40, borderRadius:11, background:`${sector?.color||C.violet}22`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0 }}>{sector?.icon||"📋"}</div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontWeight:700, color:C.text, fontSize:13 }}>{m.titre||m.metier||sector?.label||"Prestation"}</div>
                      <div style={{ color:C.textSub, fontSize:11 }}>📅 {m.date}{m.heure_debut?` · ${m.heure_debut}`:""}
                        {m.hours ? ` · ${m.hours}h` : ""}
                      </div>
                    </div>
                    <div style={{ textAlign:"right", flexShrink:0 }}>
                      {m.status === "completed" && amt > 0 && (
                        <div style={{ color:C.success, fontWeight:800, fontSize:14 }}>{amt.toFixed(2).replace(".",",")} €</div>
                      )}
                      <span style={{ background:`${statusColor}20`, border:`1px solid ${statusColor}44`, borderRadius:20, padding:"2px 8px", color:statusColor, fontSize:10, fontWeight:700 }}>{statusLabel}</span>
                    </div>
                  </div>
                  {/* Proposition de résolution — le prestataire a exactement le
                      même droit d'opposition que le client (CGPS art. 17.1). */}
                  <BlocPropositionResolution mission={m} onOppose={() => opposerResolution(m.id)} />

                  {m.status === "completed" && (() => {
                    // Le versement n'est plus immédiat : il part à la fermeture du
                    // délai de 48 h dont le client dispose pour signaler un problème
                    // (CGPS art. 17.1). Un prestataire qui ne voit rien arriver et
                    // qu'on n'a pas prévenu ouvre un ticket — puis en perd confiance.
                    if (m.payout_status === "transferred") {
                      return <div style={{ marginTop:8, color:C.success, fontSize:11, fontWeight:600 }}>💸 Versement envoyé sur votre IBAN</div>;
                    }
                    if (m.payout_status === "pending" || m.payout_status === "processing") {
                      const du = m.payout_due_at ? new Date(m.payout_due_at) : null;
                      const aVenir = du && du.getTime() > Date.now();
                      return (
                        <div style={{ marginTop:8, color:C.textSub, fontSize:11, lineHeight:1.5 }}>
                          ⏳ Versement {aVenir
                            ? `prévu le ${du.toLocaleDateString("fr-FR", { day:"numeric", month:"long" })}`
                            : "en cours"} — le client dispose de 48 h après la fin de la prestation pour signaler un problème.
                        </div>
                      );
                    }
                    if (m.payout_status === "failed") {
                      return <div style={{ marginTop:8, color:"#F25E5E", fontSize:11, fontWeight:600 }}>⚠️ Versement bloqué — écrivez à support@alane.fr</div>;
                    }
                    return null;
                  })()}
                  {m.status === "completed" && (
                    // La facture est celle du PRESTATAIRE au client : elle porte son
                    // nom, son SIRET et son numéro séquentiel, et c'est sur elle qu'il
                    // déclare son chiffre d'affaires. Le serveur l'autorisait déjà à
                    // l'ouvrir — il manquait seulement le bouton, et lui n'avait donc
                    // aucun moyen d'accéder à son propre document comptable.
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        // L'onglet s'ouvre DANS le clic — voir `ouvrirFacture`.
                        // Appelé après un `await`, Safari le bloquait en silence.
                        ouvrirFacture(m.id, {
                          getSession: async () => (await supabase.auth.getSession()).data?.session?.access_token,
                          apiFetch: (jwt) => fetch("/api/missions", {
                            method: "POST",
                            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${jwt}` },
                            body: JSON.stringify({ action: "generate_invoice_token", mission_id: m.id }),
                          }).catch(() => null),
                        });
                      }}
                      style={{ width:"100%", marginTop:10, padding:"10px", borderRadius:10, border:`1px solid ${C.violet}55`, background:`${C.violet}15`, color:C.violet, fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}
                    >
                      📄 Ma facture
                    </button>
                  )}
                  {m.status === "completed" && !ratedMissions.has(m.id) && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setRatingTarget(m); }}
                      style={{ width:"100%", marginTop:10, padding:"10px", borderRadius:10, border:`1px solid ${C.accentGold}44`, background:`${C.accentGold}12`, color:C.accentGold, fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}
                    >
                      ⭐ Noter le client
                    </button>
                  )}
                  {m.status === "completed" && ratedMissions.has(m.id) && (
                    <div style={{ marginTop:8, textAlign:"center", color:C.success, fontSize:11, fontWeight:600 }}>✓ Client noté</div>
                  )}
                </div>
              );
            })}
          </>;
        })()}
        {tab==="revenus" && (()=>{
          const getAmt = montantPrestataire;
          const total=completedMissions.reduce((s,m)=>s+getAmt(m),0);
          const resteDu = creances.reduce((t,c)=>t+Number(c.montant_restant||0),0);

          // Ce qui ARRIVE, et non ce qui est déjà arrivé. L'onglet ne montrait que
          // les revenus passés : le prestataire devait ouvrir ses prestations une
          // par une pour savoir ce qu'on lui doit et quand. C'est pourtant la
          // première question qu'un indépendant se pose.
          const enAttente = completedMissions.filter(m => m.payout_status === "pending" || m.payout_status === "processing");
          const retenus   = completedMissions.filter(m => m.payout_status === "held");
          const echoues   = completedMissions.filter(m => m.payout_status === "failed");
          const sommeDe   = (liste) => liste.reduce((t,m) => t + Number(m.payout_amount ?? getAmt(m)), 0);
          const prochaine = enAttente
            .map(m => m.payout_due_at).filter(Boolean).sort()[0] || null;

          return <>
            {(enAttente.length > 0 || retenus.length > 0 || echoues.length > 0) && (
              <div style={{ background:"rgba(124,111,224,0.10)", border:`1px solid ${C.violet}44`, borderRadius:16, padding:"16px 18px", marginBottom:14 }}>
                <div style={{ color:C.violet, fontWeight:800, fontSize:13, marginBottom:10 }}>Vos versements à venir</div>
                {enAttente.length > 0 && (
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:6 }}>
                    <span style={{ color:C.textSub, fontSize:12 }}>
                      {enAttente.length} prestation{enAttente.length>1?"s":""} en attente de versement
                      {prochaine && <span style={{ color:C.textMuted }}> · prochain le {new Date(prochaine).toLocaleDateString("fr-FR",{day:"numeric",month:"long"})}</span>}
                    </span>
                    <span style={{ color:C.text, fontWeight:800, fontSize:15 }}>{sommeDe(enAttente).toFixed(2).replace(".",",")} €</span>
                  </div>
                )}
                {retenus.length > 0 && (
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:6 }}>
                    <span style={{ color:"#E67E22", fontSize:12 }}>{retenus.length} versement{retenus.length>1?"s":""} retenu{retenus.length>1?"s":""} — motif indiqué par e-mail</span>
                    <span style={{ color:"#E67E22", fontWeight:800, fontSize:15 }}>{sommeDe(retenus).toFixed(2).replace(".",",")} €</span>
                  </div>
                )}
                {echoues.length > 0 && (
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline" }}>
                    <span style={{ color:"#F25E5E", fontSize:12 }}>{echoues.length} versement{echoues.length>1?"s":""} bloqué{echoues.length>1?"s":""} — écrivez à support@alane.fr</span>
                    <span style={{ color:"#F25E5E", fontWeight:800, fontSize:15 }}>{sommeDe(echoues).toFixed(2).replace(".",",")} €</span>
                  </div>
                )}
                <div style={{ color:C.textMuted, fontSize:11, marginTop:10, lineHeight:1.5 }}>
                  Le virement part 48 h après la fin de la prestation — le délai dont le client dispose
                  pour signaler un problème. Il arrive ensuite sur votre compte sous 1 à 2 jours ouvrés.
                </div>
              </div>
            )}
            {mandatEncaissement === null && (
              <div style={{ background:"rgba(124,111,224,0.10)", border:`1px solid ${C.violet}44`, borderRadius:16, padding:"16px 18px", marginBottom:14 }}>
                <div style={{ color:C.violet, fontWeight:800, fontSize:14, marginBottom:6 }}>
                  Mandat d'encaissement — à accepter
                </div>
                <div style={{ color:C.textSub, fontSize:12, lineHeight:1.6, marginBottom:12 }}>
                  Vous chargez ALANE d'encaisser pour vous le prix de vos prestations auprès du client, en votre
                  nom et pour votre compte. Les sommes encaissées vous appartiennent : elles ne deviennent à
                  aucun moment la propriété d'ALANE.
                  <br /><br />
                  Elles sont conservées jusqu'à la fermeture du délai de 48 heures dont le client dispose pour
                  signaler un problème, puis vous sont versées. ALANE ne peut les retenir au-delà que pour l'un
                  des motifs limitativement énumérés à l'article 7.4 des CGPS, pour 90 jours au maximum, en vous
                  notifiant le motif et le montant — et vous pouvez contester.
                  <br /><br />
                  Vous pouvez révoquer ce mandat à tout moment en clôturant votre compte, sans effet sur les
                  prestations déjà commandées.
                </div>
                <button onClick={accepterMandatEncaissement} disabled={encaissementEnCours} style={{
                  padding:"11px 18px", borderRadius:10, border:"none", background:C.violet,
                  color:"#fff", fontWeight:800, fontSize:13, cursor:"pointer", fontFamily:"inherit",
                  opacity:encaissementEnCours?0.6:1,
                }}>
                  {encaissementEnCours ? "…" : "J'accepte le mandat d'encaissement"}
                </button>
              </div>
            )}
            {mandatFacturation === null && (
              <div style={{ background:"rgba(240,180,41,0.10)", border:"1px solid rgba(240,180,41,0.35)", borderRadius:16, padding:"16px 18px", marginBottom:14 }}>
                <div style={{ color:"#F0B429", fontWeight:800, fontSize:14, marginBottom:6 }}>
                  Vos factures ne sont pas encore établies à votre nom
                </div>
                <div style={{ color:C.textSub, fontSize:12, lineHeight:1.6, marginBottom:12 }}>
                  ALANE peut établir vos factures à votre place, à votre nom et pour votre compte : numérotées,
                  archivées, utilisables pour votre comptabilité et vos déclarations. La loi exige pour cela votre
                  accord préalable et écrit (article 289 du Code général des impôts).
                  <br /><br />
                  Vous restez l'émetteur de vos factures et pouvez contester chacune d'elles depuis votre historique.
                  Tant que vous n'avez pas accepté, vous recevez une simple attestation de prestation, sans numéro —
                  et c'est à vous d'établir vos factures.
                </div>
                <button onClick={accepterMandat} disabled={mandatEnCours} style={{
                  padding:"11px 18px", borderRadius:10, border:"none", background:"#F0B429",
                  color:"#0A1628", fontWeight:800, fontSize:13, cursor:"pointer", fontFamily:"inherit",
                  opacity:mandatEnCours?0.6:1,
                }}>
                  {mandatEnCours ? "…" : "J'accepte le mandat de facturation"}
                </button>
              </div>
            )}
            {creances.length > 0 && (
              <div style={{ background:"rgba(230,126,34,0.10)", border:"1px solid rgba(230,126,34,0.35)", borderRadius:16, padding:"16px 18px", marginBottom:14 }}>
                <div style={{ color:"#E67E22", fontWeight:800, fontSize:14, marginBottom:6 }}>
                  Somme due à ALANE — reste {resteDu.toFixed(2).replace(".",",")} €
                </div>
                <div style={{ color:C.textSub, fontSize:12, lineHeight:1.6, marginBottom:10 }}>
                  Aucune retenue n'est opérée sur vos versements sans votre accord écrit : cette somme
                  se règle d'accord entre nous (CGPS art. 8B.3). Vous pouvez la contester à
                  direction@alane.fr sous quinze jours ; la demande est examinée de façon contradictoire.
                </div>
                {creances.map(c => (
                  <div key={c.id} style={{ borderTop:`1px solid ${C.border}`, paddingTop:10, marginTop:10 }}>
                    <div style={{ color:C.text, fontSize:13, fontWeight:700 }}>
                      {Number(c.montant_restant).toFixed(2).replace(".",",")} € restants
                      <span style={{ color:C.textMuted, fontWeight:400 }}> sur {Number(c.montant_initial).toFixed(2).replace(".",",")} €</span>
                      {c.statut === "contestee" && <span style={{ color:"#E67E22", fontSize:11, fontWeight:700 }}> · contestée, retenue suspendue</span>}
                    </div>
                    <div style={{ color:C.textSub, fontSize:12, marginTop:3 }}>{c.motif}</div>
                    {c.exigible_at && (
                      <div style={{ color:C.textMuted, fontSize:11, marginTop:3 }}>
                        Exigible le {new Date(c.exigible_at).toLocaleDateString("fr-FR", { day:"numeric", month:"long", year:"numeric" })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {completedMissions.length===0 ? (
              <div style={{ background:"rgba(255,255,255,0.04)", border:`1px solid ${C.border}`, borderRadius:18, padding:"28px 16px", textAlign:"center", marginBottom:16 }}>
                <div style={{ fontSize:36, marginBottom:10 }}>💶</div>
                <div style={{ color:C.text, fontSize:13, fontWeight:600, marginBottom:6 }}>Aucun revenu pour le moment</div>
                <div style={{ color:C.textMuted, fontSize:12, lineHeight:1.6 }}>Vos revenus apparaîtront ici une fois vos premières prestations complétées.</div>
              </div>
            ) : <>
              <button onClick={exporterComptabilite} style={{
                width:"100%", marginBottom:12, padding:"12px", borderRadius:12,
                border:`1px solid ${C.violet}55`, background:`${C.violet}12`, color:C.violet,
                fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit",
              }}>
                📊 Exporter mes prestations {new Date().getFullYear()} (CSV)
              </button>
              <div style={{ background:`linear-gradient(135deg,${C.success}22,${C.success}10)`, border:`1px solid ${C.success}44`, borderRadius:16, padding:"16px 18px", marginBottom:14, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div>
                  <div style={{ color:C.textSub, fontSize:11, marginBottom:2 }}>Total gagné</div>
                  <div style={{ color:C.success, fontWeight:800, fontSize:22 }}>{total.toFixed(2).replace(".",",")} €</div>
                </div>
                <div style={{ textAlign:"right" }}>
                  <div style={{ color:C.textSub, fontSize:11, marginBottom:2 }}>Prestations</div>
                  <div style={{ color:C.text, fontWeight:800, fontSize:18 }}>{completedMissions.length}</div>
                </div>
              </div>
              {/* ── Graphe mensuel ── */}
              {(() => {
                const now = new Date();
                const months = Array.from({length:4}, (_,i) => {
                  const d = new Date(now.getFullYear(), now.getMonth() - (3-i), 1);
                  return { year:d.getFullYear(), month:d.getMonth(), label:["Jan","Fév","Mar","Avr","Mai","Juin","Juil","Aoû","Sep","Oct","Nov","Déc"][d.getMonth()] };
                });
                const getAmt2 = montantPrestataire;
                const byMonth = months.map(({year,month,label}) => {
                  const rev = completedMissions.filter(m => {
                    if (!m.date) return false;
                    const d = new Date(m.date);
                    return d.getFullYear()===year && d.getMonth()===month;
                  }).reduce((s,m) => s+getAmt2(m), 0);
                  return {label, rev};
                });
                const maxRev = Math.max(...byMonth.map(m=>m.rev), 1);
                return (
                  <div style={{ background:"rgba(255,255,255,0.04)", border:`1px solid ${C.border}`, borderRadius:14, padding:"16px 14px", marginBottom:14 }}>
                    <div style={{ fontSize:12, fontWeight:700, color:C.textSub, marginBottom:14 }}>📊 Revenus par mois</div>
                    <div style={{ display:"flex", gap:8, alignItems:"flex-end", height:72 }}>
                      {byMonth.map(({label,rev},i) => {
                        const pct = Math.max(4, Math.round((rev/maxRev)*100));
                        const isCurrentMonth = i === 3;
                        return (
                          <div key={label} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
                            <div style={{ fontSize:10, color:rev>0?C.success:C.textMuted, fontWeight:700 }}>{rev>0?rev.toFixed(0)+"€":""}</div>
                            <div style={{ width:"100%", height:60, display:"flex", alignItems:"flex-end" }}>
                              <div style={{ width:"100%", height:`${pct}%`, borderRadius:"6px 6px 3px 3px", background:isCurrentMonth?`linear-gradient(180deg,${C.success},${C.success}88)`:"rgba(16,217,143,0.3)", transition:"height .4s" }} />
                            </div>
                            <div style={{ fontSize:10, color:isCurrentMonth?C.text:C.textSub, fontWeight:isCurrentMonth?700:400 }}>{label}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
              {completedMissions.map(m=>{
                const sector=SECTORS.find(s=>s.id===m.sector);
                const amt=getAmt(m);
                return (
                  <div key={m.id} style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:14, padding:"13px 14px", marginBottom:10 }}>
                    <div style={{ display:"flex", gap:12, alignItems:"center" }}>
                      <div style={{ width:40, height:40, borderRadius:11, background:`${sector?.color||C.violet}22`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0 }}>{sector?.icon||"📋"}</div>
                      <div style={{ flex:1 }}>
                        <div style={{ fontWeight:700, color:C.text, fontSize:13 }}>{m.titre||m.metier||sector?.label||"Prestation"}</div>
                        <div style={{ color:C.textSub, fontSize:11 }}>📅 {m.date}{m.hours?` · ${m.hours}h`:""}</div>
                      </div>
                      <div style={{ textAlign:"right", flexShrink:0 }}>
                        <div style={{ color:C.success, fontWeight:800, fontSize:14 }}>{amt>0?amt.toFixed(2).replace(".",",")+" €":"—"}</div>
                        <div style={{ color:C.textMuted, fontSize:10 }}>Versé</div>
                      </div>
                    </div>
                    {!ratedMissions.has(m.id) && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setRatingTarget(m); }}
                        style={{ width:"100%", marginTop:10, padding:"10px", borderRadius:10, border:`1px solid ${C.accentGold}44`, background:`${C.accentGold}12`, color:C.accentGold, fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}
                      >
                        ⭐ Noter le client
                      </button>
                    )}
                    {ratedMissions.has(m.id) && (
                      <div style={{ marginTop:8, textAlign:"center", color:C.success, fontSize:11, fontWeight:600 }}>✓ Client noté</div>
                    )}
                  </div>
                );
              })}
            </>}
            <div style={{ background:`${C.accentGold}15`, border:`1px solid ${C.accentGold}44`, borderRadius:12, padding:"10px 14px", fontSize:12, color:C.text, marginBottom:12 }}>
              💡 Ces montants correspondent à votre taux horaire net encaissé à chaque prestation.
            </div>
            <div style={{ background:"rgba(239,68,68,0.10)", border:"1px solid rgba(239,68,68,0.35)", borderRadius:12, padding:"12px 14px", fontSize:12, color:C.text, marginBottom:12, lineHeight:1.6 }}>
              <span style={{ fontWeight:700 }}>⚠️ Plafond auto-entrepreneur</span><br/>
              Le régime micro-entreprise est soumis à un plafond annuel de chiffre d'affaires de <strong>77 700 € pour les prestations de services</strong> (seuil révisé chaque année). Au-delà de ce seuil, vous perdez le bénéfice du régime. Suivez vos revenus toutes sources confondues et consultez l'URSSAF ou un expert-comptable si vous approchez de cette limite.
            </div>
            {completedMissions.length > 0 && (
              <button onClick={()=>{
                const getAmt = montantPrestataire;
                const rows=[["Date","Secteur","Métier","Heures","Montant (€)","Statut"],...completedMissions.map(m=>[m.date||"",SECTORS.find(s=>s.id===m.sector)?.label||m.sector||"",m.metier||"",m.hours||"",getAmt(m).toFixed(2),m.status||""])];
                const csv=rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
                const blob=new Blob(["﻿"+csv],{type:"text/csv;charset=utf-8;"});
                const url=URL.createObjectURL(blob);
                const a=document.createElement("a"); a.href=url; a.download=`alane-revenus-${new Date().toISOString().slice(0,10)}.csv`; a.click();
                URL.revokeObjectURL(url);
              }} style={{ width:"100%", padding:"13px", borderRadius:r, border:`1px solid ${C.border}`, background:"rgba(255,255,255,0.04)", color:C.text, fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"inherit", display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
                📥 Exporter en CSV (comptabilité)
              </button>
            )}
          </>;
        })()}
      </div>
    </div>
  );
}

export function MicroEntrepriseScreen({ onBack }) {
  const services = [
    {
      id: "legalstart",
      name: "LegalStart",
      emoji: "⚖️",
      tagline: "Créez votre micro-entreprise en ligne",
      color: "#4F46E5",
      avantages: [
        "Immatriculation en quelques clics (SIREN/SIRET)",
        "Accompagnement juridique personnalisé",
        "Contrats et statuts rédigés par des avocats",
      ],
      cta: "Créer ma micro-entreprise →",
      url: "https://www.legalstart.fr/micro-entreprise/",
    },
    {
      id: "urssaf_ae",
      name: "URSSAF (officiel)",
      emoji: "🏛️",
      tagline: "Le site officiel pour créer votre auto-entreprise",
      color: "#059669",
      avantages: [
        "100% gratuit · Site officiel de l'État",
        "Immatriculation SIRET en 24h",
        "Démarches simplifiées en ligne",
      ],
      cta: "Créer mon auto-entreprise →",
      url: "https://www.autoentrepreneur.urssaf.fr/portail/accueil/creer-mon-auto-entreprise.html",
    },
  ];

  return (
    <div style={{ minHeight:"100%", background:`linear-gradient(180deg,#0A1628,#0D1B3E)`, paddingBottom:40 }}>
      <div style={{ background:"linear-gradient(135deg,#0A1628,#162547)", borderBottom:`1px solid ${C.border}`, padding:"52px 22px 24px" }}>
        <button onClick={onBack} style={{ background:"transparent", border:"none", color:C.textSub, cursor:"pointer", fontSize:13, marginBottom:14 }}>← Retour</button>
        <h2 style={{ color:C.text, fontSize:22, fontWeight:800, margin:0, fontFamily:font.display }}>Créer ma micro-entreprise</h2>
        <p style={{ color:C.textSub, fontSize:13, margin:"6px 0 0" }}>Nos partenaires vous accompagnent dans vos démarches</p>
      </div>

      <div style={{ padding:"20px 18px" }}>
        <div style={{ background:`${C.violet}18`, border:`1px solid ${C.violet}40`, borderRadius:r, padding:"14px 16px", marginBottom:20, display:"flex", gap:10, alignItems:"flex-start" }}>
          <span style={{ fontSize:18, flexShrink:0 }}>💡</span>
          <p style={{ color:C.textSub, fontSize:13, margin:0, lineHeight:1.6 }}>
            Pour exercer sur ALANE, vous devez être auto-entrepreneur (micro-entreprise). Ces plateformes vous permettent de vous lancer rapidement et légalement.
          </p>
        </div>

        {services.map(s => (
          <div key={s.id} style={{ background:"#0D1B3E", border:`1px solid ${C.border}`, borderRadius:r+4, padding:"20px", marginBottom:16 }}>
            <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:14 }}>
              <div style={{ width:52, height:52, borderRadius:14, background:`${s.color}20`, border:`1px solid ${s.color}40`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:26, flexShrink:0 }}>
                {s.emoji}
              </div>
              <div>
                <div style={{ fontWeight:800, color:C.text, fontSize:17, fontFamily:font.display }}>{s.name}</div>
                <div style={{ color:C.textSub, fontSize:12, marginTop:2 }}>{s.tagline}</div>
              </div>
            </div>

            <div style={{ marginBottom:16 }}>
              {s.avantages.map((a, i) => (
                <div key={i} style={{ display:"flex", gap:8, alignItems:"flex-start", marginBottom:8 }}>
                  <span style={{ color:s.color, fontSize:14, flexShrink:0, marginTop:1 }}>✓</span>
                  <span style={{ color:C.textSub, fontSize:13, lineHeight:1.5 }}>{a}</span>
                </div>
              ))}
            </div>

            <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ display:"block", textDecoration:"none" }}>
              <button style={{ width:"100%", padding:"13px", borderRadius:r, border:"none", background:s.color, color:"#fff", fontSize:14, fontWeight:800, cursor:"pointer", fontFamily:"inherit" }}>
                {s.cta}
              </button>
            </a>
          </div>
        ))}

        <p style={{ color:C.textMuted, fontSize:11, textAlign:"center", margin:"8px 0 0", lineHeight:1.6 }}>
          ALANE n'est pas affilié à ces services. Ces liens sont fournis à titre informatif pour faciliter vos démarches.
        </p>
      </div>
    </div>
  );
}

