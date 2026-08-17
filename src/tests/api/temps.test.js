import { describe, it, expect } from "vitest";
import { frenchOffsetMs, debutPrestationMs, finPrestationMs, retardMinutes, echeanceVersementMs, fenetrePartagePosition, fenetrePointage, fenetreHeuresSupp } from "../../../api/_temps.js";

// Repère : « 14:00 » le 6 août 2026 est une heure de Paris en heure d'été,
// donc 12:00 UTC. En janvier, la même heure vaut 13:00 UTC.
const AOUT_14H_UTC    = Date.UTC(2026, 7, 6, 12, 0, 0);
const JANVIER_14H_UTC = Date.UTC(2026, 0, 6, 13, 0, 0);

describe("frenchOffsetMs", () => {
  it("rend -2 h en heure d'été", () => {
    expect(frenchOffsetMs(new Date("2026-08-06T12:00:00Z"))).toBe(-7200000);
  });
  it("rend -1 h en heure d'hiver", () => {
    expect(frenchOffsetMs(new Date("2026-01-06T12:00:00Z"))).toBe(-3600000);
  });
  it("bascule au dernier dimanche de mars à 01:00 UTC", () => {
    // 2026 : dernier dimanche de mars = le 29
    expect(frenchOffsetMs(new Date("2026-03-29T00:59:00Z"))).toBe(-3600000);
    expect(frenchOffsetMs(new Date("2026-03-29T01:00:00Z"))).toBe(-7200000);
  });
  it("rebascule au dernier dimanche d'octobre à 01:00 UTC", () => {
    // 2026 : dernier dimanche d'octobre = le 25
    expect(frenchOffsetMs(new Date("2026-10-25T00:59:00Z"))).toBe(-7200000);
    expect(frenchOffsetMs(new Date("2026-10-25T01:00:00Z"))).toBe(-3600000);
  });
});

describe("debutPrestationMs", () => {
  it("convertit une heure d'été française en UTC", () => {
    expect(debutPrestationMs("2026-08-06", "14:00")).toBe(AOUT_14H_UTC);
  });
  it("convertit une heure d'hiver française en UTC", () => {
    expect(debutPrestationMs("2026-01-06", "14:00")).toBe(JANVIER_14H_UTC);
  });
  it("retombe sur 08:00 quand l'heure est absente", () => {
    expect(debutPrestationMs("2026-08-06", null)).toBe(Date.UTC(2026, 7, 6, 6, 0, 0));
  });
  it("rend null sans date, plutôt qu'un NaN qui se propage", () => {
    expect(debutPrestationMs(null, "14:00")).toBeNull();
    expect(debutPrestationMs("pas-une-date", "14:00")).toBeNull();
  });
});

describe("finPrestationMs", () => {
  it("part de l'horaire prévu quand rien n'a été pointé", () => {
    expect(finPrestationMs({ date: "2026-08-06", heure_debut: "14:00", hours: 3 }))
      .toBe(AOUT_14H_UTC + 3 * 3600000);
  });
  it("part du pointage réel quand il existe — une prestation démarrée en retard finit en retard", () => {
    const demarrage = new Date(AOUT_14H_UTC + 40 * 60000).toISOString();
    expect(finPrestationMs({ date: "2026-08-06", heure_debut: "14:00", hours: 2, started_at: demarrage }))
      .toBe(AOUT_14H_UTC + 40 * 60000 + 2 * 3600000);
  });
  it("préfère actual_hours à hours", () => {
    expect(finPrestationMs({ date: "2026-08-06", heure_debut: "14:00", hours: 3, actual_hours: 1.5 }))
      .toBe(AOUT_14H_UTC + 1.5 * 3600000);
  });
});

describe("echeanceVersementMs", () => {
  const PRESTA = { date: "2026-08-06", heure_debut: "14:00", hours: 3 };

  it("place le virement 48 h après la FIN de la prestation", () => {
    expect(echeanceVersementMs(PRESTA))
      .toBe(AOUT_14H_UTC + 3 * 3600000 + 48 * 3600000);
  });

  it("ne dépend pas de l'instant de validation — un client qui valide tard ne repousse rien", () => {
    const valideTroisJoursApres = AOUT_14H_UTC + 3 * 86400000;
    expect(echeanceVersementMs(PRESTA, valideTroisJoursApres))
      .toBe(echeanceVersementMs(PRESTA, AOUT_14H_UTC));
  });

  it("une validation immédiate en fin de service n'abrège pas la fenêtre", () => {
    // C'est exactement ce que faisait le versement immédiat : le client validait
    // de bonne foi, l'argent partait, et ses 48 h de contestation n'existaient plus.
    const finReelle = AOUT_14H_UTC + 3 * 3600000;
    expect(echeanceVersementMs(PRESTA, finReelle)).toBeGreaterThan(finReelle);
  });

  it("part du pointage réel quand la prestation a démarré en retard", () => {
    const demarrage = new Date(AOUT_14H_UTC + 60 * 60000).toISOString();
    expect(echeanceVersementMs({ ...PRESTA, started_at: demarrage }))
      .toBe(AOUT_14H_UTC + 60 * 60000 + 3 * 3600000 + 48 * 3600000);
  });

  it("ignore actual_hours — le versement ne doit jamais précéder la fermeture de la fenêtre", () => {
    // Prestation de 3 h commandée, 1 h réellement déclarée. Le délai de
    // contestation de l'action `dispute` part de la fin PRÉVUE : si l'échéance de
    // versement partait de la fin réelle, l'argent serait versé deux heures avant
    // que le client ne perde son droit de signaler.
    expect(echeanceVersementMs({ ...PRESTA, actual_hours: 1 }))
      .toBe(echeanceVersementMs(PRESTA));
  });

  it("retombe sur l'instant courant + 48 h quand l'horaire est illisible", () => {
    const maintenant = AOUT_14H_UTC;
    expect(echeanceVersementMs({ hours: 2 }, maintenant)).toBe(maintenant + 48 * 3600000);
  });
});

describe("retardMinutes", () => {
  // C'est le calcul de l'alerte « prestataire en retard » du cron toutes les
  // 30 min. Sans la conversion de fuseau, le retard sortait 120 min trop bas
  // en été : la fenêtre [15, 45[ ne s'ouvrait qu'après 2 h 15 de retard réel,
  // soit après la fin d'une prestation d'une heure.
  it("mesure un retard réel de 30 min comme 30 min, pas comme -90", () => {
    const maintenant = AOUT_14H_UTC + 30 * 60000;
    expect(retardMinutes("2026-08-06", "14:00", maintenant)).toBe(30);
  });
  it("ouvre bien la fenêtre d'alerte [15, 45[ sur un retard réel", () => {
    const dansLaFenetre = (min) => {
      const r = retardMinutes("2026-08-06", "14:00", AOUT_14H_UTC + min * 60000);
      return r >= 15 && r < 45;
    };
    expect(dansLaFenetre(10)).toBe(false);
    expect(dansLaFenetre(15)).toBe(true);
    expect(dansLaFenetre(44)).toBe(true);
    expect(dansLaFenetre(45)).toBe(false);
  });
  it("reste négatif tant que l'heure n'est pas atteinte", () => {
    expect(retardMinutes("2026-08-06", "14:00", AOUT_14H_UTC - 10 * 60000)).toBe(-10);
  });
  it("fonctionne aussi en heure d'hiver", () => {
    expect(retardMinutes("2026-01-06", "14:00", JANVIER_14H_UTC + 20 * 60000)).toBe(20);
  });
  it("rend null quand l'horaire est inconnu", () => {
    expect(retardMinutes(null, "14:00")).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Fenêtre de partage de la position du prestataire
// ═══════════════════════════════════════════════════════════════════════════
//
// Le partage n'était borné par rien. Un prestataire qui l'activait la veille —
// le bouton étant visible dès l'affectation — diffusait sa position en direct
// pendant des heures, c'est-à-dire, la plupart du temps, son domicile.
//
// Une fenêtre d'une heure existait déjà dans le code, mais elle ne gouvernait
// que la notification « prestataire en route » : ni le partage, ni la lecture
// par le client n'étaient bornés.

describe("fenêtre de partage de position", () => {
  // 17 août 2026, 10:00 heure française = 08:00 UTC (été).
  const M = { date: "2026-08-17", heure_debut: "10:00", hours: 2 };
  const T = (iso) => new Date(iso).getTime();

  it("est fermée la veille", () => {
    const f = fenetrePartagePosition(M, T("2026-08-16T20:00:00Z"));
    expect(f.ouverte).toBe(false);
    expect(f.raison).toBe("trop_tot");
  });

  it("est fermée deux heures avant le début", () => {
    expect(fenetrePartagePosition(M, T("2026-08-17T06:00:00Z")).ouverte).toBe(false);
  });

  it("s'ouvre une heure avant le début", () => {
    // 08:00 UTC moins une heure = 07:00 UTC.
    expect(fenetrePartagePosition(M, T("2026-08-17T07:00:00Z")).ouverte).toBe(true);
    expect(fenetrePartagePosition(M, T("2026-08-17T06:59:00Z")).ouverte).toBe(false);
  });

  it("reste ouverte pendant la prestation", () => {
    expect(fenetrePartagePosition(M, T("2026-08-17T09:00:00Z")).ouverte).toBe(true);
  });

  it("se ferme une heure après la fin", () => {
    // Fin prévue 10:00 UTC (08:00 + 2 h), grâce jusqu'à 11:00 UTC.
    expect(fenetrePartagePosition(M, T("2026-08-17T10:59:00Z")).ouverte).toBe(true);
    expect(fenetrePartagePosition(M, T("2026-08-17T11:01:00Z")).ouverte).toBe(false);
    expect(fenetrePartagePosition(M, T("2026-08-17T11:01:00Z")).raison).toBe("trop_tard");
  });

  it("suit le pointage réel quand la prestation a démarré en retard", () => {
    // Démarrée à 11:00 UTC : la fenêtre court jusqu'à 13:00 + 1 h de grâce.
    const enRetard = { ...M, started_at: "2026-08-17T11:00:00Z" };
    expect(fenetrePartagePosition(enRetard, T("2026-08-17T13:30:00Z")).ouverte).toBe(true);
  });

  // À défaut de savoir si l'on est dans le rapport de la prestation, on ne
  // diffuse pas la position de quelqu'un. Le doute profite au prestataire.
  it("est fermée quand l'horaire est illisible", () => {
    expect(fenetrePartagePosition({ hours: 2 }).ouverte).toBe(false);
    expect(fenetrePartagePosition({ hours: 2 }).raison).toBe("horaire_inconnu");
    expect(fenetrePartagePosition(null).ouverte).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Fenêtres de pointage
// ═══════════════════════════════════════════════════════════════════════════
//
// Signalé par Alexandre le 17/08/2026 : à l'heure pile, aucun bouton ne
// permettait de déclarer sa présence ni de démarrer.
//
// La règle existait en CINQ exemplaires, avec cinq bornes différentes :
//
//   • « Je suis sur place », écran   : à partir de l'heure de début ;
//   • « Je suis sur place », serveur : aucune borne — trois jours avant, si on
//     voulait ;
//   • « Je commence », écran (cas 1) : une heure avant ;
//   • « Je commence », écran (cas 2) : cinq minutes avant ;
//   • « Je commence », serveur       : cinq minutes avant, jusqu'à H+2 h.
//
// Le bouton de démarrage apparaissait donc une heure avant, et le serveur le
// refusait pendant cinquante-cinq minutes.

describe("fenêtres de pointage", () => {
  const H = new Date("2026-08-17T08:20:00Z").getTime();
  const min = (n) => n * 60000;

  it("l'arrivée s'ouvre quinze minutes avant le début", () => {
    expect(fenetrePointage(H, H - min(16)).arrivee).toBe(false);
    expect(fenetrePointage(H, H - min(15)).arrivee).toBe(true);
    expect(fenetrePointage(H, H - min(1)).arrivee).toBe(true);
  });

  // La demande d'Alexandre, mot pour mot : « pile à l'heure le bouton démarrer ».
  it("le démarrage s'ouvre à l'heure prévue, pas avant", () => {
    expect(fenetrePointage(H, H - min(1)).demarrage).toBe(false);
    expect(fenetrePointage(H, H).demarrage).toBe(true);
  });

  it("l'arrivée reste ouverte pendant que le démarrage l'est", () => {
    const f = fenetrePointage(H, H + min(30));
    expect(f.arrivee).toBe(true);
    expect(f.demarrage).toBe(true);
  });

  // Au-delà de deux heures de retard, ce n'est plus un pointage, c'est un litige.
  it("les deux se ferment deux heures après le début", () => {
    expect(fenetrePointage(H, H + min(119)).demarrage).toBe(true);
    expect(fenetrePointage(H, H + min(121)).demarrage).toBe(false);
    expect(fenetrePointage(H, H + min(121)).arrivee).toBe(false);
  });

  it("annonce l'heure d'ouverture, pour pouvoir la dire au prestataire", () => {
    const f = fenetrePointage(H, H - min(60));
    expect(f.ouvreArrivee).toBe(H - min(15));
    expect(f.ouvreDemarrage).toBe(H);
    expect(f.ferme).toBe(H + min(120));
  });

  // Empêcher un prestataire de déclarer qu'il travaille parce qu'une date est
  // mal formée serait le punir d'un défaut qui n'est pas le sien — et le
  // client, lui, attend sur place.
  it("autorise tout quand l'horaire est illisible", () => {
    for (const v of [null, 0, NaN, undefined]) {
      const f = fenetrePointage(v, H);
      expect(f.arrivee).toBe(true);
      expect(f.demarrage).toBe(true);
      expect(f.horaireInconnu).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Fenêtre de demande d'heures supplémentaires
// ═══════════════════════════════════════════════════════════════════════════
//
// La demande n'était bornée par rien — ni à l'écran, ni côté serveur. Un client
// pouvait prolonger une prestation terminée depuis des heures, et l'acceptation
// rallonge `hours`, donc le montant dû, donc le versement : sur des heures que
// personne n'a travaillées.

describe("fenêtre des heures supplémentaires", () => {
  const FIN = new Date("2026-08-17T09:20:00Z").getTime();
  const min = (n) => n * 60000;

  it("reste ouverte pendant la prestation", () => {
    expect(fenetreHeuresSupp(FIN, FIN - min(30)).ouverte).toBe(true);
  });

  it("reste ouverte vingt minutes après la fin", () => {
    expect(fenetreHeuresSupp(FIN, FIN + min(19)).ouverte).toBe(true);
    expect(fenetreHeuresSupp(FIN, FIN + min(20)).ouverte).toBe(true);
  });

  it("se ferme au-delà", () => {
    expect(fenetreHeuresSupp(FIN, FIN + min(21)).ouverte).toBe(false);
    expect(fenetreHeuresSupp(FIN, FIN + min(180)).ouverte).toBe(false);
  });

  it("annonce l'heure de fermeture", () => {
    expect(fenetreHeuresSupp(FIN, FIN).ferme).toBe(FIN + min(20));
  });

  // Refuser une prolongation sur une date mal formée pénaliserait un client qui
  // n'y est pour rien — et la demande reste soumise à l'accord du prestataire,
  // qui, lui, sait s'il est encore là.
  it("reste ouverte quand la fin est illisible", () => {
    for (const v of [null, 0, NaN, undefined]) {
      expect(fenetreHeuresSupp(v, FIN).ouverte).toBe(true);
      expect(fenetreHeuresSupp(v, FIN).horaireInconnu).toBe(true);
    }
  });
});
