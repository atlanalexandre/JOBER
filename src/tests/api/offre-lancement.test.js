import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { offreActive, moisFr, PLACES_OFFRE } from "../../../api/_offre.js";

// L'offre de lancement a changé de fait générateur trois fois, et chaque fois
// pour la même raison : une place consommée par quelqu'un qui ne travaille pas.
//
//   • à l'INSCRIPTION — un compte refusé gardait sa place ;
//   • à l'OUVERTURE DE L'ACCÈS (24/08/2026) — un compte validé qui ne
//     travaillait jamais la gardait aussi ;
//   • à la PREMIÈRE PRESTATION ACCEPTÉE (15/09/2026), et pour le seul mois de
//     ce déclenchement.

describe("moisFr()", () => {
  // Vercel tourne en UTC. Le 1er octobre à 00 h 30 heure française est encore
  // le 30 septembre en UTC : comparer les mois sur `toISOString()` prolongerait
  // l'offre de deux heures pour les uns et l'amputerait pour les autres.
  it("compte les mois en heure de Paris, pas en UTC", () => {
    expect(moisFr("2026-09-30T23:00:00Z")).toBe("2026-10");
    expect(moisFr("2026-09-30T21:00:00Z")).toBe("2026-09");
  });

  it("ne s'effondre pas sur une date illisible", () => {
    expect(moisFr("pas une date")).toBeNull();
  });
});

describe("offreActive()", () => {
  const LE_15_SEPT = Date.parse("2026-09-15T12:00:00Z");

  it("vaut pour le mois du déclenchement", () => {
    expect(offreActive("2026-09-01T08:00:00Z", LE_15_SEPT)).toBe(true);
    expect(offreActive("2026-09-15T11:00:00Z", LE_15_SEPT)).toBe(true);
  });

  // La règle voulue par Alexandre : l'offre se clôture à la fin du mois du
  // déclenchement, quel que soit le jour où elle a commencé.
  it("s'arrête au mois suivant", () => {
    expect(offreActive("2026-08-30T12:00:00Z", LE_15_SEPT)).toBe(false);
    expect(offreActive("2026-07-03T08:00:00Z", LE_15_SEPT)).toBe(false);
  });

  // Le 31 août à 22 h UTC, il est déjà le 1er septembre à Paris : le
  // déclenchement compte donc pour septembre. C'est ce que vaut le passage par
  // le fuseau — un `toISOString()` aurait rattaché ce prestataire à août et lui
  // aurait retiré son offre le jour même où elle commençait.
  it("rattache la dernière nuit du mois au bon mois", () => {
    expect(offreActive("2026-08-31T22:00:00Z", LE_15_SEPT)).toBe(true);
    expect(offreActive("2026-08-31T20:00:00Z", LE_15_SEPT)).toBe(false);
  });

  it("ne vaut jamais sans déclenchement", () => {
    for (const v of [null, undefined, "", "pas une date"]) {
      expect(offreActive(v, LE_15_SEPT)).toBe(false);
    }
  });

  // Effet connu et assumé : accepter sa première prestation le 28 ne laisse que
  // trois jours d'offre. La règle est délibérée — si ce test tombe, c'est que
  // quelqu'un l'a « corrigée » sans le demander.
  it("n'accorde que le reliquat du mois à un déclenchement tardif", () => {
    const le28 = "2026-09-28T09:00:00Z";
    expect(offreActive(le28, Date.parse("2026-09-30T20:00:00Z"))).toBe(true);
    expect(offreActive(le28, Date.parse("2026-10-01T09:00:00Z"))).toBe(false);
  });
});

describe("le déclenchement, côté serveur", () => {
  const missions = readFileSync(new URL("../../../api/missions.js", import.meta.url), "utf8");
  const offre = readFileSync(new URL("../../../api/_offre.js", import.meta.url), "utf8");

  // Quatre chemins mènent à une prestation acceptée : le lien d'un courriel,
  // l'action `accept` de l'application, la réponse à une demande directe, et la
  // reprise d'un remplacement. En oublier un priverait quelqu'un de son offre
  // pour un motif purement technique.
  it("couvre les quatre chemins d'acceptation", () => {
    const appels = missions.match(/declencherOffreLancement\(/g) || [];
    expect(appels.length, "un chemin d'acceptation ne déclenche pas l'offre").toBeGreaterThanOrEqual(4);
  });

  // Écrire sous condition `is.null` en base, plutôt que lire puis écrire :
  // deux acceptations simultanées ne doivent pas repousser la date.
  it("n'écrase jamais une date déjà posée", () => {
    expect(offre).toContain("offre_lancement_at=is.null");
  });

  // Une offre non déclenchée ne doit pas faire échouer l'acceptation d'une
  // prestation — mais elle doit se voir dans les journaux.
  it("ne fait pas échouer l'acceptation si elle échoue", () => {
    expect(offre).toContain("console.error");
    expect(offre).toMatch(/catch/);
    expect(offre).not.toMatch(/throw new/);
  });

  // L'éligibilité tient à l'ANCIENNETÉ : les 100 premiers inscrits dont
  // l'accès est ouvert. Le filtre sur l'accès ouvert protège des inscriptions
  // fantômes ; le tri sur la date d'inscription est ce qui a été promis.
  it("classe l'éligibilité sur l'ancienneté, parmi les comptes ouverts", () => {
    expect(offre).toContain("missions_enabled=is.true");
    expect(offre).toContain("order=created_at.asc");
    expect(PLACES_OFFRE).toBe(100);
  });

  it("vérifie l'ancienneté AVANT d'écrire la date", () => {
    const bloc = offre.slice(offre.indexOf("export async function declencherOffreLancement"));
    expect(bloc.indexOf("estEligible")).toBeLessThan(bloc.indexOf("offre_lancement_at=is.null"));
  });

  // Accorder l'offre à tort est une promesse qu'il faudra retirer : en cas de
  // doute, on n'accorde pas.
  it("refuse l'éligibilité quand le classement est illisible", () => {
    const bloc = offre.slice(offre.indexOf("export async function estEligible"), offre.indexOf("export async function declencherOffreLancement"));
    expect(bloc).toContain("return false");
    expect(bloc).not.toContain("return true;");
  });

  // Le classement ne se refait PAS à la lecture : le refaire ferait perdre en
  // cours de mois une offre déjà accordée à celui qu'un inscrit plus ancien
  // pousse hors des 100.
  it("ne rejoue pas le classement à chaque calcul de quota", () => {
    expect(missions).toContain("offreActive(profil.offre_lancement_at)");
    expect(missions).not.toContain("order=offre_lancement_at.asc");
    expect(missions).not.toContain("order=created_at.asc&limit=");
  });
});

// « Dès la fin du mois il perd l'offre et passe en Gratuit, SAUF s'il souscrit
// un abonnement. » C'est acquis sans une ligne de code : le quota rend
// directement la limite du plan dès qu'il n'est plus `free`, sans consulter
// l'offre. Ce test verrouille ce court-circuit.
describe("un abonnement prime sur l'offre", () => {
  const missions = readFileSync(new URL("../../../api/missions.js", import.meta.url), "utf8");

  it("un abonné ne passe jamais par l'offre de lancement", () => {
    const bloc = missions.slice(missions.indexOf("const limite = Number(limites[plan]"));
    const courtCircuit = bloc.indexOf('if (plan !== "free"');
    expect(courtCircuit, "le court-circuit des abonnés a disparu").toBeGreaterThanOrEqual(0);
    expect(courtCircuit).toBeLessThan(bloc.indexOf("offre_lancement_at"));
  });
});

// Annoncer autre chose que ce que le serveur applique est une pratique
// commerciale trompeuse (art. L121-2 du Code de la consommation). C'est déjà
// arrivé deux fois sur cette offre.
describe("ce qui est annoncé correspond à ce qui est appliqué", () => {
  const ui = readFileSync(new URL("../../components/ui.jsx", import.meta.url), "utf8");
  const presta = readFileSync(new URL("../../components/presta-screens.jsx", import.meta.url), "utf8");
  const api = readFileSync(new URL("../../../api/prestataires.js", import.meta.url), "utf8");

  // La règle tient en DEUX temps, et les deux doivent être annoncés. Ne dire
  // que l'éligibilité laisserait croire à une offre permanente ; ne dire que le
  // déclenchement laisserait croire qu'elle est ouverte à tous.
  it("annonce l'éligibilité ET le déclenchement", () => {
    expect(ui).toMatch(/100 premiers prestataires validés/);
    expect(ui).toMatch(/1re prestation/);
  });

  // L'éligibilité tient à l'ouverture de l'accès aux prestations. Les deux
  // compteurs affichés doivent compter cela, et rien d'autre : l'écart entre le
  // compteur et la règle serveur est le défaut corrigé le 24/08/2026.
  // Les écrans ne comptent plus rien eux-mêmes : ils posent la question au
  // serveur, qui compte l'éligibilité — les comptes dont l'accès est ouvert.
  // Compter chacun de son côté est la divergence qui s'est produite trois fois.
  it("le décompte n'existe qu'à un seul endroit", () => {
    expect(api).toContain("missions_enabled=is.true&select=id");
    expect(presta).toContain("fetchOffreLancement()");
    expect(presta, "l'écran prestataire recompte les places de son côté")
      .not.toContain('eq("missions_enabled",true)');
  });
});

// Le réglage `launch_phase` a été passé à `false` le 16/09/2026, et les écrans
// d'inscription ont continué d'annoncer « 8 prestations/mois gratuites aux 100
// premiers » pendant que le serveur en accordait 2. Les deux écrans lisaient une
// CONSTANTE DU CODE au lieu du réglage que le serveur consulte.
describe("l'annonce suit le réglage du serveur", () => {
  const auth = readFileSync(new URL("../../components/auth.jsx", import.meta.url), "utf8");
  const ui   = readFileSync(new URL("../../components/ui.jsx", import.meta.url), "utf8");

  it("les écrans d'inscription ne lisent plus de constante", () => {
    const code = auth.split("\n").filter(l => !l.trim().startsWith("//")).join("\n");
    expect(code, "un écran d'inscription annonce encore l'offre sans demander au serveur")
      .not.toContain("isLaunchPhase");
    expect(auth).toContain("fetchOffreLancement()");
  });

  // En cas d'échec de lecture, on n'annonce rien : ne pas promettre une offre
  // qui existe est un moindre mal que d'en promettre une qui n'existe pas.
  it("n'annonce rien quand l'état est illisible", () => {
    const bloc = auth.slice(auth.indexOf("const [offreLancement"));
    expect(bloc).toContain("useState(false)");
    expect(ui).toContain("ouverte: false, restantes: null");
  });
});

// « Une fois que les 100 prestataires ont bénéficié de l'offre, elle doit
// disparaître : elle n'aura plus lieu d'être. » — décision du 16/09/2026.
describe("une offre épuisée disparaît", () => {
  const api  = readFileSync(new URL("../../../api/prestataires.js", import.meta.url), "utf8");
  const ui   = readFileSync(new URL("../../components/ui.jsx", import.meta.url), "utf8");

  // Trois endroits répondaient à la question, chacun à sa façon — une constante
  // du code, le réglage, le décompte des places. Ils ont divergé trois fois.
  it("le serveur tranche, et lui seul", () => {
    expect(api).toContain("ouverte: reglageOuvert && restantes > 0");
    expect(ui).toContain("export function fetchOffreLancement");
  });

  it("le badge ne s'affiche plus quand l'offre est fermée", () => {
    expect(ui).toContain('if (context !== "booking" && ouverte === false) return null;');
  });

  // Une offre épuisée ne s'annonce pas « terminée », elle disparaît.
  it("ne mentionne plus « offre terminée »", () => {
    // Hors commentaires : le fichier explique justement pourquoi cette mention
    // a disparu, et cette explication ne doit pas faire échouer le test.
    const code = ui.split("\n").filter(l => !l.trim().startsWith("//")).join("\n");
    expect(code).not.toContain("offre terminée");
  });

  // Le contexte « booking » parle de la transparence du prix, pas de l'offre :
  // il n'a pas à disparaître avec elle.
  it("épargne le message qui ne promet pas l'offre", () => {
    expect(ui).toContain('context !== "booking"');
  });

  // Taire une offre qui existe est un moindre mal que d'en promettre une qui
  // n'existe pas : en cas de doute, fermé.
  it("répond « fermée » quand elle ne sait pas", () => {
    expect(api).toContain('prises: null, restantes: null, ouverte: false');
    expect(api).toContain("reglageOuvert = false;");
  });

  // Une ligne absente vaut ouverte, comme dans `quotaPrestations` : l'absence
  // n'est pas une décision.
  it("traite l'absence de réglage comme une offre ouverte", () => {
    expect(api).toContain('brut === null || (brut !== false && brut !== "false")');
  });
});
