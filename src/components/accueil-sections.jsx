// ═══════════════════════════════════════════════════════════════════════════
// La page d'accueil explique ALANE AVANT la création du compte (02/11/2026)
// ═══════════════════════════════════════════════════════════════════════════
//
// Retour d'un visiteur, transmis par Alexandre : « pas assez d'explications —
// qui sommes-nous ? pourquoi nous choisir ? Si tu comprends pas, tu crées
// pas. » L'accueil tenait en un écran : un titre, trois pastilles, un bouton.
// Le didacticiel existait, mais APRÈS le choix du rôle et de l'inscription.
//
// RÈGLE DE CE FICHIER : chaque phrase est VRAIE AUJOURD'HUI, et vérifiable
// dans le code ou les CGPS. Une promesse commerciale qui ne correspond pas au
// service est une pratique trompeuse (code de la consommation, art. L121-2),
// et c'est la première chose qu'un client déçu produirait. Les chiffres sont
// lus dans les constantes, jamais recopiés :
//   • pièces vérifiées      → DOCS_REQUIS (api/_documents.js) et les titres
//                             exigés métier par métier (api/_qualifications.js) ;
//   • 48 h de contestation  → CGPS art. 17.1, DELAI_CONTESTATION_MS (api/_temps.js) ;
//   • remboursement si personne n'accepte, frais compris → CGPS art. 8.2 bis ;
//   • cashback              → CASHBACK_TIERS (src/constants/plans.js).
// ═══════════════════════════════════════════════════════════════════════════

import { useState } from "react";
import { C, font, r } from "../constants/colors.js";
import { CASHBACK_TIERS } from "../constants/plans.js";
import { QUALIFICATIONS_OBLIGATOIRES, METIERS, SECTORS } from "../constants/data.js";

const pourcent = (x) => `${(x * 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`;
const TAUX_MIN = Math.min(...CASHBACK_TIERS.map(t => t.rate));
const TAUX_MAX = Math.max(...CASHBACK_TIERS.map(t => t.rate));
const NB_METIERS_REGLEMENTES = Object.keys(QUALIFICATIONS_OBLIGATOIRES).length;
const NB_METIERS_TOTAL = new Set(Object.values(METIERS).flat()).size;
const NB_SECTEURS = SECTORS.length;

const Titre = ({ sur, children }) => (
  <div style={{ marginBottom:18 }}>
    {sur && <div style={{ color:C.accentGold, fontSize:12, fontWeight:700, letterSpacing:1, textTransform:"uppercase", marginBottom:6 }}>{sur}</div>}
    <h2 style={{ color:C.text, fontSize:24, fontWeight:800, margin:0, lineHeight:1.2, fontFamily:font.display }}>{children}</h2>
  </div>
);

const Carte = ({ icone, titre, children }) => (
  <div style={{ background:"rgba(255,255,255,0.04)", border:`1px solid ${C.border}`, borderRadius:r, padding:"16px", display:"flex", gap:14, alignItems:"flex-start" }}>
    <div style={{ width:40, height:40, borderRadius:12, background:`${C.violet}22`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>{icone}</div>
    <div>
      <div style={{ color:C.text, fontWeight:700, fontSize:15, marginBottom:4 }}>{titre}</div>
      <div style={{ color:C.textSub, fontSize:13, lineHeight:1.6 }}>{children}</div>
    </div>
  </div>
);

const Bouton = ({ onClick, children, secondaire }) => (
  <button onClick={onClick} style={{
    width:"100%", border: secondaire ? `1px solid ${C.violet}` : "none", cursor:"pointer",
    background: secondaire ? "transparent" : `linear-gradient(135deg, ${C.violet}, ${C.violetLight})`,
    color: secondaire ? C.violetLight : "#fff", fontWeight:700, fontSize:15, padding:"15px", borderRadius:r + 4,
  }}>{children}</button>
);

const QUESTIONS = [
  ["Qui sont les prestataires ?",
    "Des indépendants — auto-entrepreneurs pour la plupart — inscrits à leur compte. ALANE ne les emploie pas : elle vérifie leurs pièces, les met en relation avec vous et sécurise le paiement."],
  ["Combien ça coûte ?",
    "Le tarif horaire fixé par le prestataire, multiplié par la durée, plus les frais de service d'ALANE. Le total est affiché avant tout paiement, et rien ne s'y ajoute."],
  ["Et si personne n'est disponible ?",
    "Si aucun prestataire n'accepte votre demande, vous êtes intégralement remboursé, frais de service compris."],
  ["Particulier ou entreprise ?",
    "Les deux. Un particulier réserve pour chez lui ; une entreprise pour ses locaux, avec un contrat-cadre et des factures à son nom."],
];

export function SectionsAccueil({ onCommencer, onFaq, onContact }) {
  const [ouverte, setOuverte] = useState(null);
  const section = { padding:"40px 0 0" };

  return (
    <div id="decouvrir" style={{ position:"relative", zIndex:1, paddingBottom:24 }}>
      {/* ── Ce qui fait la différence (02/11/2026) ──
          Demande d'Alexandre : « pourquoi moi et pas quelqu'un d'autre ? ».
          Quatre engagements que peu d'intermédiaires prennent ENSEMBLE, et que
          l'application tient réellement : aucune commission sur le tarif du
          prestataire (les frais de service sont payés par le client), le
          remboursement intégral si personne n'accepte (CGPS 8.2 bis), le
          titre exigé métier par métier (api/_qualifications.js), et un seul
          endroit pour les particuliers comme pour les entreprises. Aucun
          concurrent n'est nommé ni décrit : une comparaison doit être
          objective et vérifiable (code de la consommation, art. L122-1). */}
      <section style={{ ...section, paddingTop:8 }}>
        <div style={{ background:`linear-gradient(135deg, ${C.accentGold}1F, ${C.violet}1A)`, border:`1px solid ${C.accentGold}55`, borderRadius:r + 6, padding:"22px 18px" }}>
          <Titre sur="Ce qui fait la différence">Pourquoi ALANE, et pas un autre ?</Titre>
          <div style={{ display:"grid", gap:14 }}>
            {[
              ["🤝", "L'indépendant garde 100 % de son tarif",
                "Aucune commission n'est prélevée sur son travail : il est payé au juste prix, et c'est ce qui fait les prestataires motivés. Vous payez son tarif et nos frais de service, affichés à part."],
              ["🛡️", "Personne n'accepte ? Vous ne payez rien",
                "Si aucun prestataire n'accepte votre demande, vous êtes remboursé intégralement, frais de service compris. Et votre argent n'est versé qu'après la prestation."],
              ["🎓", "Le bon diplôme, vérifié avant la première prestation",
                `Pour les ${NB_METIERS_REGLEMENTES} métiers réglementés, pas de carte professionnelle ou de diplôme, pas de prestation : nous l'exigeons métier par métier.`],
              ["🏠", "Un seul endroit, pour chez vous comme pour votre entreprise",
                `${NB_METIERS_TOTAL} métiers dans ${NB_SECTEURS} secteurs — du ménage à la sécurité, de la cuisine au coaching sportif — avec contrat et factures en règle.`],
            ].map(([icone, titre, texte]) => (
              <div key={titre} style={{ display:"flex", gap:12, alignItems:"flex-start" }}>
                <div style={{ fontSize:24, lineHeight:1.2, flexShrink:0 }}>{icone}</div>
                <div>
                  <div style={{ color:C.text, fontWeight:800, fontSize:15.5, lineHeight:1.3 }}>{titre}</div>
                  <div style={{ color:C.textSub, fontSize:13, lineHeight:1.6, marginTop:3 }}>{texte}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Comment ça marche ── */}
      <section style={section}>
        <Titre sur="Comment ça marche">Un prestataire en trois étapes</Titre>
        <div style={{ display:"grid", gap:10 }}>
          {[
            ["1", "Décrivez votre besoin", "Le métier, la date, l'horaire et l'adresse. Choisissez un prestataire, ou laissez la demande à ceux qui sont disponibles près de chez vous."],
            ["2", "Voyez le prix, puis payez", "Le prix total s'affiche avant de payer. Votre argent est bloqué : il n'est versé au prestataire qu'après la prestation."],
            ["3", "Le prestataire intervient", "Vous suivez son arrivée, validez la fin de la prestation, et recevez votre facture."],
          ].map(([n, t, d]) => (
            <div key={n} style={{ display:"flex", gap:14, alignItems:"flex-start", padding:"14px 16px", background:"rgba(255,255,255,0.03)", borderRadius:r }}>
              <div style={{ width:30, height:30, borderRadius:"50%", background:C.violet, color:"#fff", fontWeight:800, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>{n}</div>
              <div>
                <div style={{ color:C.text, fontWeight:700, fontSize:15 }}>{t}</div>
                <div style={{ color:C.textSub, fontSize:13, lineHeight:1.6, marginTop:2 }}>{d}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Pourquoi nous choisir ── */}
      <section style={section}>
        <Titre sur="Pourquoi ALANE">Pourquoi nous choisir ?</Titre>
        <div style={{ display:"grid", gap:10 }}>
          <Carte icone="✅" titre="Des prestataires vérifiés, un par un">
            Avant d'être proposé, chaque prestataire fournit son immatriculation, son attestation Urssaf, son assurance
            responsabilité civile professionnelle et sa pièce d'identité, contrôlées par notre équipe. Pour les {NB_METIERS_REGLEMENTES} métiers
            réglementés — sécurité, conduite, coiffure, sport… — nous exigeons aussi le diplôme ou la carte professionnelle.
          </Carte>
          <Carte icone="💶" titre="Prix affiché = prix payé">
            Le tarif du prestataire et nos frais de service sont affichés avant le paiement. Aucun supplément caché.
          </Carte>
          <Carte icone="🔒" titre="Votre argent est protégé">
            Il est bloqué jusqu'à la prestation, et vous avez 48 h après pour signaler un problème. Personne n'accepte votre
            demande ? Vous êtes remboursé intégralement, frais compris.
          </Carte>
          <Carte icone="⚖️" titre="Un cadre clair pour les entreprises">
            Contrat de prestation, factures automatiques, attestations Urssaf vérifiées : vous faites appel à un indépendant
            dans les règles.
          </Carte>
          <Carte icone="💰" titre="Du cashback sur chaque prestation">
            De {pourcent(TAUX_MIN)} à {pourcent(TAUX_MAX)} du montant, crédités après chaque prestation et déduits de vos réservations suivantes.
          </Carte>
        </div>
      </section>

      {/* ── Pour les indépendants ── */}
      <section style={section}>
        <Titre sur="Vous êtes indépendant ?">Trouvez des clients, gardez votre liberté</Titre>
        <div style={{ display:"grid", gap:10, marginBottom:16 }}>
          <Carte icone="🎯" titre="Vous fixez votre tarif">ALANE ne prélève rien sur votre tarif horaire : ses frais de service sont payés par le client.</Carte>
          <Carte icone="🗓️" titre="Vous choisissez vos prestations">Vous acceptez ou refusez librement, sans justification et sans pénalité.</Carte>
          <Carte icone="🏦" titre="Un paiement garanti">Le client paie à la réservation ; vous êtes payé par virement après la prestation. Vos factures sont établies pour vous.</Carte>
          <Carte icone="🆓" titre="Une formule gratuite">Inscrivez-vous sans frais, et passez à une formule supérieure seulement si vous en avez besoin.</Carte>
        </div>
        <Bouton secondaire onClick={onCommencer}>Je propose mes services</Bouton>
      </section>

      {/* ── Qui sommes-nous ── */}
      <section style={section}>
        <Titre sur="Qui sommes-nous ?">Une plateforme française, pensée pour les deux côtés</Titre>
        <div style={{ color:C.textSub, fontSize:14, lineHeight:1.75 }}>
          <p style={{ margin:"0 0 12px" }}>
            ALANE est née d'un constat simple : trouver un indépendant fiable, au bon moment, prend trop de temps — et
            un indépendant sérieux a du mal à se faire connaître.
          </p>
          <p style={{ margin:0 }}>
            Nous vérifions chaque prestataire, nous affichons le vrai prix et nous protégeons le paiement jusqu'au bout.
            Notre conviction : un indépendant bien payé et un client bien protégé, c'est une relation qui dure.
          </p>
        </div>
      </section>

      {/* ── Questions fréquentes ── */}
      <section style={section}>
        <Titre sur="Questions fréquentes">Vous vous demandez peut-être…</Titre>
        <div style={{ display:"grid", gap:8, marginBottom:12 }}>
          {QUESTIONS.map(([q, rep], i) => (
            <div key={q} style={{ background:"rgba(255,255,255,0.04)", border:`1px solid ${C.border}`, borderRadius:r }}>
              <button onClick={() => setOuverte(ouverte === i ? null : i)} aria-expanded={ouverte === i}
                style={{ width:"100%", background:"none", border:"none", color:C.text, fontWeight:700, fontSize:14, padding:"14px 16px", textAlign:"left", cursor:"pointer", display:"flex", justifyContent:"space-between", gap:10 }}>
                {q}<span style={{ color:C.textMuted }}>{ouverte === i ? "▴" : "▾"}</span>
              </button>
              {ouverte === i && <div style={{ color:C.textSub, fontSize:13, lineHeight:1.6, padding:"0 16px 14px" }}>{rep}</div>}
            </div>
          ))}
        </div>
        <button onClick={onFaq} style={{ background:"none", border:"none", color:C.violetLight, fontSize:13, fontWeight:700, cursor:"pointer", padding:0 }}>
          Toutes les questions →
        </button>
      </section>

      {/* ── Appel final ── */}
      <section style={{ ...section, textAlign:"center" }}>
        <Titre>Prêt à essayer ?</Titre>
        <Bouton onClick={onCommencer}>Commencer →</Bouton>
        <p style={{ color:C.textMuted, fontSize:12, marginTop:12 }}>Inscription gratuite · Sans engagement</p>
        <button onClick={onContact} style={{ background:"none", border:"none", color:C.textSub, fontSize:13, cursor:"pointer", textDecoration:"underline" }}>
          Une question ? Écrivez-nous
        </button>
      </section>
    </div>
  );
}
