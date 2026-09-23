import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  VALIDITE_DOCUMENTS, EXPIRATION_BLOQUANTE, VERIFICATIONS_OFFICIELLES,
  verificationPour, expirationDeduite, etatExpiration, TOLERANCE_JOURS,
} from "../../../api/_documents.js";
import { TOLERANCE_RC_PRO_JOURS, PREAVIS_RC_PRO_JOURS } from "../../../api/_conservation.js";
import { DOCS_REQUIS } from "../../constants/data.js";

// Une attestation URSSAF vaut six mois, une RC Pro s'arrête à une date, une
// carte CNAPS dure cinq ans. Rien ne surveillait ces dates, sauf la RC Pro :
// un prestataire validé en janvier avec une attestation de vigilance de
// décembre restait actif indéfiniment.

const MAINTENANT = Date.parse("2026-09-11T12:00:00Z");

describe("les règles de validité", () => {
  // Une règle qui vise un type inexistant ne s'applique à rien, et donne
  // l'illusion d'une surveillance.
  it("couvrent exactement les documents demandés", () => {
    const types = DOCS_REQUIS.map(d => d.id);
    for (const t of types) expect(VALIDITE_DOCUMENTS[t], `règle manquante : ${t}`).toBeTruthy();
    const orphelines = Object.keys(VALIDITE_DOCUMENTS).filter(t => !types.includes(t));
    expect(orphelines, `règles sans document : ${orphelines.join(", ")}`).toEqual([]);
  });

  // Ce qui bloque doit être proportionné. Suspendre pour un justificatif de
  // domicile de quatre mois pousse à désactiver la règle entière — et c'est
  // alors l'assurance qui n'est plus surveillée.
  it("ne bloquent l'accès que sur ce qui met quelqu'un en danger", () => {
    expect(EXPIRATION_BLOQUANTE.has("rc_pro")).toBe(true);
    expect(EXPIRATION_BLOQUANTE.has("urssaf")).toBe(true);
    expect(EXPIRATION_BLOQUANTE.has("domicile")).toBe(false);
    expect(EXPIRATION_BLOQUANTE.has("kbis")).toBe(false);
    expect(EXPIRATION_BLOQUANTE.has("photo")).toBe(false);
  });

  // La règle annoncée aux prestataires — article 19.1 des CGPS — ne change pas
  // parce que la surveillance s'étend à d'autres pièces.
  it("conservent la tolérance de l'article 19.1", () => {
    expect(TOLERANCE_JOURS).toBe(TOLERANCE_RC_PRO_JOURS);
    expect(PREAVIS_RC_PRO_JOURS).toBe(30);
  });
});

describe("expirationDeduite()", () => {
  it("calcule ce qui se calcule", () => {
    expect(expirationDeduite("urssaf", "2026-06-01")).toBe("2026-12-01");
    expect(expirationDeduite("kbis", "2026-06-01")).toBe("2026-09-01");
  });

  // La période de garantie d'une RC Pro est écrite sur l'attestation et n'a
  // aucun rapport avec le jour du dépôt. La déduire donnerait une fausse date,
  // et une fausse date rassure à tort — c'est pire que pas de date du tout.
  it("n'invente rien pour ce qui ne se déduit pas", () => {
    expect(expirationDeduite("rc_pro", "2026-06-01")).toBeNull();
    expect(expirationDeduite("cni", "2026-06-01")).toBeNull();
    expect(expirationDeduite("titre_sejour", "2026-06-01")).toBeNull();
  });

  it("ne date pas ce qui ne périme pas", () => {
    expect(expirationDeduite("rib", "2026-06-01")).toBeNull();
    expect(expirationDeduite("photo", "2026-06-01")).toBeNull();
  });

  it("ne s'effondre pas sur une date absente ou illisible", () => {
    for (const v of [null, undefined, "", "pas une date"]) {
      expect(expirationDeduite("urssaf", v)).toBeNull();
    }
  });
});

describe("etatExpiration()", () => {
  it("suit le cycle complet", () => {
    expect(etatExpiration("2026-12-31", MAINTENANT).etat).toBe("valide");
    expect(etatExpiration("2026-09-25", MAINTENANT).etat).toBe("bientot");
    expect(etatExpiration("2026-09-01", MAINTENANT).etat).toBe("expire");
    expect(etatExpiration("2026-07-01", MAINTENANT).etat).toBe("suspendable");
  });

  // Le document vaut pour toute sa dernière journée : expirer « aujourd'hui »
  // ne veut pas dire expiré ce matin.
  it("laisse sa dernière journée entière au document", () => {
    expect(etatExpiration("2026-09-11", MAINTENANT).etat).toBe("bientot");
  });

  // Trente jours de tolérance : suspendre le lendemain de l'échéance ne
  // laisserait pas le temps de réagir à la relance.
  it("ne suspend qu'au terme de la tolérance", () => {
    const j29 = MAINTENANT + 29 * 86400000;
    const j31 = MAINTENANT + 31 * 86400000;
    expect(etatExpiration("2026-09-11", j29).etat).toBe("expire");
    expect(etatExpiration("2026-09-11", j31).etat).toBe("suspendable");
  });

  it("rend null quand la date est inconnue", () => {
    for (const v of [null, undefined, "", "pas une date"]) expect(etatExpiration(v, MAINTENANT)).toBeNull();
  });
});

describe("les vérifications officielles", () => {
  it("pointent vers des services de l'État, jamais un intermédiaire", () => {
    for (const [type, v] of Object.entries(VERIFICATIONS_OFFICIELLES)) {
      expect(v.url, type).toMatch(/^https:\/\/[^/]*\.(gouv\.fr|urssaf\.fr|education\.fr)\//);
      expect(v.mode, type).toBeTruthy();
    }
  });

  // Pour un agent de sécurité, « diplômes » veut dire carte CNAPS ; pour un
  // pâtissier, CAP. Le même type de document, deux services différents.
  it("suivent le métier quand c'est nécessaire", () => {
    expect(verificationPour("diplomes", { titre: "Carte professionnelle CNAPS" }).url).toMatch(/cnaps/i);
    expect(verificationPour("diplomes", { titre: "Diplôme SSIAP 1 à jour" }).url).toMatch(/cnaps/i);
    expect(verificationPour("diplomes", { titre: "CAP coiffure" }).url).toMatch(/education\.fr/);
    expect(verificationPour("diplomes", null).url).toMatch(/education\.fr/);
  });

  it("ne proposent rien quand aucun service n'existe", () => {
    expect(verificationPour("rc_pro", null)).toBeNull();
    expect(verificationPour("rib", null)).toBeNull();
  });
});

// La règle ne vaut que si elle est appliquée, et UNE SEULE FOIS. Deux
// traitements pour la même attestation, c'est deux relances — puis deux règles
// qui divergent.
describe("le balayage quotidien", () => {
  const cron = readFileSync(new URL("../../../api/cron-reset-monthly.js", import.meta.url), "utf8");

  it("existe et lit la colonne qui existait déjà", () => {
    expect(cron).toContain('queryAction === "documents"');
    expect(cron).toContain("expires_at=not.is.null");
  });

  it("ne double pas l'ancien traitement RC Pro", () => {
    expect(cron).not.toContain("type=eq.rc_pro&expires_at");
    expect(cron).not.toContain("etatRcPro(");
    expect(cron).not.toContain("rc_pro_relance_at");
  });

  it("ne suspend que sur les documents bloquants", () => {
    const bloc = cron.slice(cron.indexOf('queryAction === "documents"'));
    expect(bloc).toContain("EXPIRATION_BLOQUANTE.has(d.type)");
  });

  // Annuler la prestation de demain parce qu'une attestation expire
  // aujourd'hui punirait le client, qui n'y est pour rien.
  it("ne touche pas aux prestations déjà acceptées", () => {
    const bloc = cron.slice(cron.indexOf('queryAction === "documents"'));
    expect(bloc).toContain("missions_enabled: false");
    expect(bloc).not.toContain('status: "cancelled"');
    expect(bloc).toMatch(/déjà acceptées .*ne sont pas annulées|ne sont pas annulées/);
  });

  it("relance au plus une fois par semaine", () => {
    const bloc = cron.slice(cron.indexOf('queryAction === "documents"'));
    expect(bloc).toContain("7 * 86400000");
  });

  it("est planifié une fois par jour", () => {
    const vercel = JSON.parse(readFileSync(new URL("../../../vercel.json", import.meta.url), "utf8"));
    const cronDocs = vercel.crons.find(c => c.path.includes("action=documents"));
    expect(cronDocs, "cron absent de vercel.json").toBeTruthy();
    expect(cronDocs.schedule).toMatch(/^\d+ \d+ \* \* \*$/);
  });
});

// Le balayage prévenait le prestataire, et personne d'autre : le seul endroit
// où une suspension apparaissait, c'étaient les journaux Vercel — que personne
// ne lit tous les matins.
describe("rendre compte à l'administration", () => {
  const cron = readFileSync(new URL("../../../api/cron-reset-monthly.js", import.meta.url), "utf8");
  const bloc = cron.slice(cron.indexOf('queryAction === "documents"'));

  it("alerte le jour d'une suspension", () => {
    expect(bloc).toContain("ADMIN_DOCS");
    expect(bloc).toContain("resumeSuspensions.length > 0");
  });

  it("récapitule le lundi", () => {
    expect(bloc).toContain("getUTCDay() === 1");
    expect(bloc).toContain("resumeEcheances");
  });

  // Un courriel qu'on classe sans lire ne prévient plus de rien le jour où il
  // compte. Rien ne part quand il n'y a rien à dire.
  it("n'envoie rien quand il n'y a rien à signaler", () => {
    expect(bloc).toMatch(/resumeSuspensions\.length > 0 \|\| \(lundi && resumeEcheances\.length > 0\)/);
  });

  // Sans trace du passage, on ne distingue pas « rien à signaler » de « le
  // traitement ne s'exécute plus ».
  it("horodate son passage", () => {
    expect(bloc).toContain("derniere_surveillance_documents");
  });
});

describe("le panneau du back-office", () => {
  const bo = readFileSync(new URL("../../components/backoffice.jsx", import.meta.url), "utf8");

  it("rassemble les échéances en tête de l'onglet Documents", () => {
    expect(bo).toContain("const echeances = docs");
    expect(bo).toContain("etatExpiration(d.expires_at)");
  });

  // La plus pressante d'abord : la liste répond à « de quoi dois-je m'occuper
  // aujourd'hui ? ».
  it("trie par urgence", () => {
    expect(bo).toContain("a.exp.jours - b.exp.jours");
  });

  // Une pièce qui ne suspend pas ne doit pas se lire comme une urgence.
  it("distingue ce qui suspend de ce qui ne suspend pas", () => {
    expect(bo).toContain("EXPIRATION_BLOQUANTE.has(d.type)");
    expect(bo).toMatch(/ne suspend pas/);
  });

  it("lit la même règle que le serveur", () => {
    expect(bo).toContain('from "../../api/_documents.js"');
  });
});

// La date saisie à la main au back-office s'écrivait dans `date_expiration`,
// une colonne qui n'a jamais existé — la migration du 14/08/2026 a créé
// `expires_at`. PostgREST refusait la requête entière : chaque saisie échouait,
// et le badge d'expiration de la fenêtre des documents, calculé sur le même
// nom, ne s'affichait jamais. Une RC Pro dont la date n'était connue que par
// cette saisie n'était donc surveillée par personne.
describe("une seule colonne pour la fin de validité", () => {
  const fichiers = ["bo-action.js", "cron-reset-monthly.js", "missions.js", "_documents.js"];

  it("n'écrit ni ne lit jamais `date_expiration`", () => {
    for (const f of fichiers) {
      const code = readFileSync(new URL(`../../../api/${f}`, import.meta.url), "utf8")
        // Les commentaires peuvent citer l'ancien nom pour expliquer l'erreur.
        .split("\n").filter(l => !l.trim().startsWith("//")).join("\n");
      expect(code, f).not.toMatch(/date_expiration/);
    }
  });

  it("enregistre la date saisie dans `expires_at`", () => {
    const bo = readFileSync(new URL("../../../api/bo-action.js", import.meta.url), "utf8");
    const bloc = bo.slice(bo.indexOf('action === "set_expiration"'), bo.indexOf('action === "list_all_docs"'));
    expect(bloc).toContain("expires_at: date || null");
  });

  it("affiche le badge d'après `expires_at`", () => {
    const bo = readFileSync(new URL("../../../api/bo-action.js", import.meta.url), "utf8");
    expect(bo).toContain("expiration: etatExpiration(doc.expires_at)");
  });
});
