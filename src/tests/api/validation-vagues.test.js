// Validation des prestataires par vagues (demande d'Alexandre du 20/10/2026) :
// l'état du dossier, les inscrits sans SIRET et leur relance (api/_vagues.js).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  etatDossier, aUnSiret, siretDeclare, destinatairesRelanceSiret, emailRelanceSiret, DELAI_ENTRE_RELANCES_SIRET_MS,
} from "../../../api/_vagues.js";

describe("etatDossier — la liste de travail de la vérification", () => {
  it("une pièce absente : incomplet, même si d'autres attendent d'être vérifiées", () => {
    expect(etatDossier([{ raison: "non vérifiée" }, { raison: "absente" }])).toBe("incomplet");
  });
  it("tout déposé, une pièce à contrôler : à vérifier", () => {
    expect(etatDossier([{ raison: "non vérifiée" }, { raison: "non vérifiée" }])).toBe("a_verifier");
  });
  it("une pièce expirée : au prestataire d'en déposer une autre, pas à vérifier (relecture du 21/10/2026)", () => {
    expect(etatDossier([{ raison: "non vérifiée" }, { raison: "expirée" }])).toBe("incomplet");
  });
  it("plus rien ne manque : prêt", () => {
    expect(etatDossier([])).toBe("pret");
  });
  it("pièces illisibles : l'écran n'affirme rien", () => {
    expect(etatDossier(null)).toBe(null);
  });
});

describe("aUnSiret — profil, puis métadonnées d'inscription", () => {
  it("lit profiles.siret, puis siret des métadonnées — les sources de l'empreinte anti-recréation", () => {
    expect(aUnSiret({ siret: "123 456 789 00012" }, {})).toBe(true);
    expect(aUnSiret({}, { siret: "12345678900012" })).toBe(true);
    expect(aUnSiret({}, { ae_siret: "12345678900012" }), "ae_siret n'est pas une source").toBe(false);
    expect(siretDeclare({ siret: "123 456 789 00012" }, {})).toBe("12345678900012");
  });
  it("vide ou blanc : pas de SIRET", () => {
    expect(aUnSiret({ siret: "  " }, { siret: "" })).toBe(false);
    expect(aUnSiret(null, null)).toBe(false);
  });
});

describe("destinatairesRelanceSiret — qui reçoit la relance", () => {
  const T = Date.parse("2026-10-20T10:00:00Z");
  const profils = [
    { id: "a", role: "prestataire", status: "pending", siret: null },
    { id: "b", role: "prestataire", status: "pending", siret: "12345678900012" },
    { id: "c", role: "prestataire", status: "approved", siret: null },
    { id: "d", role: "client", status: "pending", siret: null },
    { id: "e", role: "prestataire", status: "pending", siret: null },
    { id: "f", role: "prestataire", status: "pending", siret: null },
  ];
  const utilisateurs = {
    a: { email: "a@x.fr", meta: {} }, b: { email: "b@x.fr", meta: {} }, c: { email: "c@x.fr", meta: {} },
    d: { email: "d@x.fr", meta: {} }, e: { email: "e@x.fr", meta: {} }, f: { email: "f@x.fr", meta: { siret: "12345678900012" } },
  };
  it("prestataires en attente, sans SIRET, pas relancés depuis 30 jours", () => {
    const relances = [
      { target_id: "e", created_at: new Date(T - 3 * 24 * 3600e3).toISOString() },
      { target_id: "a", created_at: new Date(T - DELAI_ENTRE_RELANCES_SIRET_MS - 1).toISOString() },
    ];
    const { liste, dejaRelances } = destinatairesRelanceSiret(profils, utilisateurs, relances, T);
    expect(liste.map(d => d.id)).toEqual(["a"]);
    expect(dejaRelances).toBe(1);
  });
  it("sans adresse e-mail : écarté", () => {
    const { liste } = destinatairesRelanceSiret([profils[0]], { a: { email: "", meta: {} } }, [], T);
    expect(liste).toEqual([]);
  });
});

describe("l'e-mail de relance", () => {
  it("dit quoi faire, avec le guichet officiel et l'adresse du support, sans vocabulaire d'emploi", () => {
    const { sujet, html } = emailRelanceSiret();
    expect(sujet).toMatch(/SIRET/);
    expect(html).toContain("https://procedures.inpi.fr/");
    expect(html).toContain("support@alane.fr");
    expect(html).not.toMatch(/recrut|embauche|intérim|candidat/i);
  });
});

describe("le back-office", () => {
  const bo = readFileSync(new URL("../../../api/bo-action.js", import.meta.url), "utf8");
  const ecran = readFileSync(new URL("../../components/backoffice.jsx", import.meta.url), "utf8");
  it("la relance : destinataires et texte établis par le serveur, aperçu puis envoi au nombre annoncé", () => {
    const bloc = bo.slice(bo.indexOf('if (action === "relance_sans_siret")'), bo.indexOf('if (action === "update_profile")'));
    expect(bloc).toMatch(/destinatairesRelanceSiret\(/);
    expect(bloc).toMatch(/emailRelanceSiret\(\)/);
    expect(bloc).toMatch(/Number\(req\.body\.attendus\) !== liste\.length/);
    expect(bloc).not.toMatch(/req\.body\.(sujet|message|html|destinataires)/);
    // Une écriture du journal par lot, pas une par destinataire.
    expect(bloc).toMatch(/lot\.map\(d => \(\{ action: "relance_sans_siret"/);
    expect(bloc).toMatch(/lireUtilisateurs\(SUPABASE_URL, headers\)/);
  });
  it("le SIRET saisi au back-office est contrôlé avant d'être écrit", () => {
    const bloc = bo.slice(bo.indexOf('if (action === "update_profile")'));
    expect(bloc).toMatch(/if \(!validateSiret\(siret\)\) return res\.status\(400\)/);
  });
  it("la liste dit l'état du dossier et l'absence de SIRET", () => {
    expect(bo).toMatch(/etat_dossier: piecesAOuvrir \? etatDossier\(piecesAOuvrir\) : null/);
    expect(bo).toMatch(/sans_siret: p\.role === "prestataire" && !aUnSiret\(p, meta\)/);
  });
  it("la validation de la vague ne porte que sur les prestataires en attente affichés", () => {
    // Ce qui est rendu (tranches de 100), pas toute la liste filtrée (relecture du 21/10/2026).
    expect(ecran).toMatch(/const vagueAffichee = trier\(filtered\)\.slice\(0, nbAffiches\)\.filter\(p => p\.role === "prestataire" && p\.status === "pending"\)/);
    expect(ecran).toMatch(/await validerProfils\(vagueAffichee, "vague_affichee"\)/);
  });
});
