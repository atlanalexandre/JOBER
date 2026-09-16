import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// La vérification, par le client, que la personne qui se présente chez lui est
// bien celle qu'il a réservée.
//
// Rien ne le permettait : l'écran de suivi n'affichait qu'un émoji, la
// notification d'arrivée ne nommait personne, et aucune action ne disait « ce
// n'est pas la bonne personne ». Les seuls recours étaient l'annulation
// ordinaire — frais de service retenus alors que le client n'y est pour rien —
// ou le litige, dont le bouton n'apparaît qu'APRÈS la prestation, donc une fois
// la personne entrée.
//
// Ces tests lisent le code source. C'est volontaire : ce qui doit être garanti
// ici n'est pas un calcul mais la PRÉSENCE de garde-fous, et leur disparition
// lors d'une refonte doit faire échouer la CI.

const missions = readFileSync(new URL("../../../api/missions.js", import.meta.url), "utf8");
const client   = readFileSync(new URL("../../components/client-screens.jsx", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("../../../migrations/2026-09-11_verification_identite_prestataire.sql", import.meta.url), "utf8");

describe("actions serveur de vérification d'identité", () => {
  it("expose les deux actions", () => {
    expect(missions).toContain('action === "confirmer_identite"');
    expect(missions).toContain('action === "refuser_identite"');
  });

  // L'identité de l'appelant vient du jeton, jamais du corps de la requête :
  // sans cela, n'importe qui refuserait la prestation d'un autre.
  it("n'accepte que le client de la prestation", () => {
    const bloc = missions.slice(missions.indexOf('action === "confirmer_identite"'));
    expect(bloc).toContain("client_id=eq.${caller.id}");
  });

  it("exige que le prestataire ait pointé son arrivée", () => {
    const bloc = missions.slice(missions.indexOf('action === "confirmer_identite"'));
    expect(bloc).toContain("mid.arrived_at");
    expect(bloc).toMatch(/n'a pas encore signalé son arrivée/);
  });

  // Un double clic sur un téléphone ne doit pas rembourser deux fois.
  it("est idempotent", () => {
    const bloc = missions.slice(missions.indexOf('action === "confirmer_identite"'));
    expect(bloc).toContain("deja_repondu");
    expect(bloc).toContain("Idempotency-Key");
  });

  // Partout ailleurs les frais restent acquis, parce qu'ils rémunèrent une mise
  // en relation effectuée. Ici elle ne l'a pas été : la personne annoncée ne
  // s'est pas présentée. Le remboursement porte donc sur `montant_total`, frais
  // compris, et surtout pas sur une part horaire qui les exclurait.
  it("rembourse l'intégralité, frais de service compris", () => {
    const bloc = missions.slice(missions.indexOf('action === "confirmer_identite"'));
    expect(bloc).toContain("Number(mid.montant_total)");
    expect(bloc).toMatch(/FRAIS DE SERVICE COMPRIS/);
    expect(bloc).not.toContain("fraisRetenus");
  });

  it("suspend le prestataire, de façon réversible", () => {
    const bloc = missions.slice(missions.indexOf('action === "refuser_identite"'));
    expect(bloc).toContain("missions_enabled: false");
    expect(bloc).toMatch(/RÉVERSIBLE/);
  });

  // Un remboursement en échec ne doit pas empêcher l'arrêt : on ne laisse
  // personne travailler chez un client qui vient de dire que ce n'est pas la
  // bonne personne. Mais il ne doit pas non plus être annoncé comme parti.
  it("arrête la prestation même si le remboursement échoue, sans le taire", () => {
    const bloc = missions.slice(missions.indexOf('action === "refuser_identite"'));
    expect(bloc).toContain('status: "cancelled"');
    expect(bloc).toContain("rembourse: refundIdentiteId !== null");
    expect(bloc).toMatch(/À TRAITER À LA MAIN/);
  });

  it("prévient le prestataire et l'administration", () => {
    const bloc = missions.slice(missions.indexOf('action === "refuser_identite"'));
    expect(bloc).toContain("support_tickets");
    expect(bloc).toContain("ADMIN_MAIL_ID");
    expect(bloc).toContain("Identité refusée par le client");
  });
});

describe("la notification d'arrivée nomme le prestataire", () => {
  it("ne dit plus « votre prestataire » sans nom", () => {
    const bloc = missions.slice(missions.indexOf('action === "checkin_mission"'));
    expect(bloc).toContain("nomPresta");
    // L'ancienne formulation, anonyme, ne doit pas revenir.
    expect(bloc).not.toContain("Prestataire arrivé(e) sur place");
  });

  it("invite à vérifier l'identité", () => {
    const bloc = missions.slice(missions.indexOf('action === "checkin_mission"'));
    expect(bloc).toMatch(/vérifier qu'il s'agit bien/);
  });
});

describe("la photo suit la prestation, pas le catalogue", () => {
  // Le catalogue public est filtré (compte approuvé, accès aux prestations
  // ouvert, secteur actif, consentement d'affichage). Un prestataire qui en
  // sortait entre la réservation et le jour J laissait le client devant de
  // simples initiales, au moment précis où il devait reconnaître quelqu'un.
  it("est servie par /api/missions au client de la prestation", () => {
    expect(missions).toContain("prestataire_photo:");
    expect(missions).toContain("select=id,prenom,nom,avatar_url");
  });

  it("est préférée à celle du catalogue côté écran", () => {
    expect(client).toContain("selected.prestataire_photo || fullProv?.photo_url");
  });

  it("est affichée dans l'écran de suivi", () => {
    expect(client).toContain("setPhotoPresta");
    expect(client).toContain('select("prenom,nom,avatar_url")');
  });

  // Le repli sur les initiales était muet : le client pouvait croire qu'il n'y
  // avait rien à comparer.
  it("dit au client quand aucune photo n'est disponible", () => {
    expect(client).toMatch(/Aucune photo disponible/);
  });
});

describe("la photo montrée au client est celle qu'ALANE a validée", () => {
  // `profiles.avatar_url` est choisi par le prestataire et modifiable à tout
  // moment APRÈS validation de son dossier : personne ne le contrôle. Le
  // document `photo` de DOCS_REQUIS, lui, est validé une pièce à la fois depuis
  // le back-office.
  it("sert le document photo validé, par URL signée", () => {
    expect(missions).toContain("type=eq.photo&verified=eq.true");
    expect(missions).toContain("/storage/v1/object/sign/Documents/");
    expect(missions).toContain("photosVerifiees[m.prestataire_id]");
  });

  // La pièce d'identité porte la date et le lieu de naissance, la nationalité
  // et un numéro de document. Rien de tout cela n'aide à reconnaître un visage.
  it("ne transmet JAMAIS la pièce d'identité", () => {
    const bloc = missions.slice(missions.indexOf("photosVerifiees"), missions.indexOf("const enriched"));
    expect(bloc).not.toContain("type=eq.cni");
    expect(bloc).not.toContain("titre_sejour");
  });

  it("dit au client si la photo est vérifiée ou seulement déclarative", () => {
    expect(missions).toContain("prestataire_photo_verifiee");
    expect(client).toMatch(/Photo vérifiée par ALANE/);
    expect(client).toMatch(/Photo déclarative, non vérifiée/);
  });

  // Une URL signée en échec ne doit pas faire disparaître la liste des
  // prestations : l'écran se replie sur l'avatar, et le dit.
  it("ne fait pas échouer la liste si la photo est illisible", () => {
    const bloc = missions.slice(missions.indexOf("photosVerifiees"), missions.indexOf("const enriched"));
    expect(bloc).toContain("console.error");
    // Et le repli existe : la photo validée d'abord, l'avatar ensuite.
    expect(missions).toContain(
      "photosVerifiees[m.prestataire_id] || profileMap[m.prestataire_id]?.avatar_url");
  });
});

describe("l'écran de refus", () => {
  it("demande une confirmation avant de refuser", () => {
    expect(client).toContain("confirmRefusIdentite");
  });

  it("annonce le remboursement intégral et la suspension", () => {
    expect(client).toMatch(/intégralement remboursé, frais de service compris/);
    expect(client).toMatch(/suspendu le temps que nous/);
  });

  it("passe par /api et jamais par une écriture directe", () => {
    const bloc = client.slice(client.indexOf("const repondreIdentite"));
    expect(bloc).toContain('fetch("/api/missions"');
    expect(bloc.slice(0, bloc.indexOf("setIdentiteEnCours(false)")))
      .not.toContain('supabase.from("missions")');
  });
});

describe("la migration", () => {
  it("borne les valeurs autorisées", () => {
    expect(migration).toContain("missions_identite_statut_check");
    expect(migration).toMatch(/IN \('confirmee', 'refusee'\)/);
  });

  // Un client capable d'écrire ces colonnes se rembourserait lui-même et
  // suspendrait qui il veut.
  it("ferme l'écriture depuis le navigateur", () => {
    expect(migration).toContain("REVOKE UPDATE (identite_statut)");
    expect(migration).toContain("REVOKE UPDATE (identite_repondu_at)");
  });
});

// La photo de profil est la seule pièce que le client verra, sur son palier,
// pour reconnaître qui sonne. Une vignette de 120 pixels n'y sert à rien.
describe("la qualité de la photo de profil", () => {
  const presta = readFileSync(new URL("../../components/presta-screens.jsx", import.meta.url), "utf8");

  it("exige une taille minimale, pour la photo seulement", () => {
    expect(presta).toContain("PHOTO_MIN_PX = 400");
    expect(presta).toContain('typeDoc === "photo"');
  });

  // iOS Safari échoue à décoder les photos de la pellicule (HEIC déguisés en
  // JPEG, Live Photos). Un contrôle qui refuse quand il ne sait pas
  // empêcherait la moitié des prestataires iPhone de déposer leur dossier.
  it("ne bloque jamais quand le décodage échoue", () => {
    const bloc = presta.slice(presta.indexOf("async function dimensionsImage"));
    expect(bloc).toContain("resolve(null)");
    const appel = presta.slice(presta.indexOf('typeDoc === "photo"'));
    expect(appel).toContain("if (dimensions &&");
  });

  // Sans minuteur, une image qui ne se charge jamais laisse le dépôt bloqué
  // sur « Envoi… ».
  it("abandonne au bout de trois secondes", () => {
    expect(presta).toContain("setTimeout(() => resolve(null), 3000)");
  });

  // Une heuristique de « qualité » fondée sur la clarté de l'image écarterait
  // les peaux foncées. Le contrôle ne porte QUE sur les dimensions.
  it("ne juge ni la netteté ni la luminosité", () => {
    // La fonction seule, et non tout ce qui la suit : `onBlur` et les filtres
    // CSS du reste du fichier feraient échouer le test sans rien prouver.
    const deb = presta.indexOf("async function dimensionsImage");
    const bloc = presta.slice(deb, presta.indexOf("\n}", deb)).toLowerCase();
    for (const interdit of ["luminance", "brightness", "getimagedata", "canvas"]) {
      expect(bloc, `heuristique interdite : ${interdit}`).not.toContain(interdit);
    }
  });

  it("dit au prestataire à quoi la photo sert", () => {
    const docs = readFileSync(new URL("../../../api/_documents.js", import.meta.url), "utf8");
    expect(docs).toMatch(/vos clients verront pour vous reconnaître/);
    expect(docs).toMatch(/400×400/);
  });
});

describe("la comparaison photo / pièce d'identité", () => {
  const bo = readFileSync(new URL("../../components/backoffice.jsx", import.meta.url), "utf8");

  it("ouvre les deux pièces côte à côte, dans les deux sens", () => {
    expect(bo).toContain("const pieceEnRegard");
    expect(bo).toContain('doc.type === "photo" ? "cni" : doc.type === "cni" ? "photo" : null');
    expect(bo).toContain("compareUrl");
  });

  // Un PDF ne s'affiche pas en regard d'une image : mieux vaut l'aperçu simple
  // que deux cadres dont un vide.
  it("ne compare que ce qui est affichable", () => {
    const bloc = bo.slice(bo.indexOf("const pieceEnRegard"));
    expect(bloc.slice(0, 600)).toContain("estImage");
  });
});
