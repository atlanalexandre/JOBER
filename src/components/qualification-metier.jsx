// ═══════════════════════════════════════════════════════════════════════════
// Le métier choisi exige-t-il un diplôme ? Dit au moment du choix (04/11/2026)
// ═══════════════════════════════════════════════════════════════════════════
//
// Demande d'Alexandre : « lors de l'inscription, quand il rentre ses métiers,
// lui dire si un diplôme est obligatoire ou non ». L'écran « Ajouter un
// métier » du profil le disait pour les métiers réglementés ; l'INSCRIPTION,
// elle, n'en disait rien : le prestataire découvrait trois écrans plus loin
// — ou au refus de l'accès aux prestations — qu'il lui fallait une carte.
//
// Les deux réponses sont dites, pas seulement le « oui » : « aucun diplôme
// exigé » rassure celui qui hésitait à s'inscrire sans diplôme.
//
// Deux registres distincts, qui ne se mélangent pas : ce qui est EXIGÉ par
// un texte (QUALIFICATIONS_OBLIGATOIRES, que la plateforme réclamera) et ce
// qu'il faut SAVOIR (NOTES_METIERS). La source est api/_qualifications.js :
// l'écran ne recopie rien.
// ═══════════════════════════════════════════════════════════════════════════

import { C } from "../constants/colors.js";
import { qualificationRequise, noteMetier } from "../constants/data.js";

/** L'encart complet, sous le choix du métier. */
export function InfoQualificationMetier({ metier }) {
  if (!metier) return null;
  const q = qualificationRequise(metier);
  const n = noteMetier(metier);
  return (
    <>
      {q ? (
        <div data-testid="diplome-obligatoire" style={{ background:"rgba(240,180,41,0.10)", border:"1px solid rgba(240,180,41,0.40)", borderRadius:12, padding:"12px 14px", marginBottom:14 }}>
          <div style={{ color:"#F0B429", fontWeight:800, fontSize:12.5, marginBottom:5 }}>⚖️ Diplôme ou titre obligatoire pour ce métier</div>
          <div style={{ color:C.textSub, fontSize:12, lineHeight:1.55 }}>
            <strong style={{ color:C.text }}>{q.titre}</strong>{q.detail ? ` — ${q.detail}` : ""}.
            <br/>Vous devrez le déposer dans vos documents : ce métier ne vous sera proposé qu'une fois ce justificatif vérifié.
            <div style={{ color:C.textMuted, fontSize:11, marginTop:5 }}>{q.texte}</div>
          </div>
        </div>
      ) : (
        <div data-testid="diplome-non-obligatoire" style={{ background:`${C.success}12`, border:`1px solid ${C.success}40`, borderRadius:12, padding:"12px 14px", marginBottom:14 }}>
          {/* Avec une note, le métier peut exiger un titre pour UNE PARTIE de
              l'activité (Certiphyto du jardinier qui traite, permis du coursier
              motorisé) : un « aucun texte n'impose » sans nuance contredisait
              la note juste dessous (relecture du 05/11/2026). Mais toutes les notes ne
              parlent pas d'un titre — celles du crédit d'impôt (SAP), par exemple :
              le texte reste donc neutre et renvoie à la note (06/11/2026). Et il
              ne redit pas « aucun texte n'impose » : le titre dit déjà « dans le
              cas général », et la phrase contredisait les notes du coursier
              (permis) et du jardinier (Certiphyto) — relecture du 07/11/2026. */}
          <div style={{ color:C.success, fontWeight:800, fontSize:12.5, marginBottom:5 }}>
            {n ? "✅ Pas de diplôme obligatoire dans le cas général" : "✅ Aucun diplôme obligatoire pour ce métier"}
          </div>
          <div style={{ color:C.textSub, fontSize:12, lineHeight:1.55 }}>
            {n
              ? "Selon votre façon d'exercer, une condition peut s'ajouter : lisez la note ci-dessous. Vos diplômes et certifications restent un atout : ajoutez-les à votre profil."
              : "Aucun texte n'impose de diplôme pour l'exercer. Vos diplômes et certifications restent un atout : ajoutez-les à votre profil."}
          </div>
        </div>
      )}
      {n && (
        <div style={{ background:`${C.violet}12`, border:`1px solid ${C.violet}33`, borderRadius:12, padding:"12px 14px", marginBottom:14 }}>
          <div style={{ color:C.violet, fontWeight:800, fontSize:12.5, marginBottom:5 }}>ℹ️ Bon à savoir</div>
          <div style={{ color:C.textSub, fontSize:12, lineHeight:1.55 }}>{n}</div>
        </div>
      )}
    </>
  );
}

/** La pastille, dans la liste des métiers ajoutés. */
export function PastilleQualification({ metier }) {
  const q = qualificationRequise(metier);
  const n = noteMetier(metier);
  return (
    <span style={{
      display:"inline-block", marginTop:4, fontSize:10.5, fontWeight:700, borderRadius:6, padding:"2px 7px",
      background: q ? "rgba(240,180,41,0.15)" : `${C.success}18`, color: q ? "#F0B429" : C.success,
    }}>
      {q ? `⚖️ ${q.titre} obligatoire` : n ? "✅ Sans diplôme obligatoire (cas général)" : "✅ Sans diplôme obligatoire"}
    </span>
  );
}
