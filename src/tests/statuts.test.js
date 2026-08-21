// Le vocabulaire des états d'une prestation.
//
// Ces libellés sont ce que le client lit. Ils ne décrivent pas l'état interne :
// `completed` et `closed` sont deux états distincts en base, une seule et même
// chose pour lui — la prestation a eu lieu.
import { describe, it, expect } from "vitest";
import { libelleStatut, couleurStatut, ONGLETS_PRESTATIONS } from "../lib/statuts.js";

const LE_20_AOUT = new Date("2026-08-20T12:00:00Z").getTime();
const passee = { status:"assigned", date:"2026-08-19", heure_debut:"08:00", hours:1 };
const avenir = { status:"assigned", date:"2026-08-25", heure_debut:"08:00", hours:1 };

describe("libelleStatut", () => {
  it("signale « À valider » quand la prestation est finie et non validée", () => {
    // Le seul état où une action est demandée au client, et où son inaction
    // retient le versement du prestataire.
    expect(libelleStatut(passee, LE_20_AOUT)).toBe("À valider");
  });

  it("ne le signale plus une fois le client passé", () => {
    expect(libelleStatut({ ...passee, validation_client: true }, LE_20_AOUT)).toBe("Confirmée");
  });

  it("ne le signale pas sur une prestation à venir", () => {
    expect(libelleStatut(avenir, LE_20_AOUT)).toBe("Confirmée");
  });

  it("dit « Terminée » pour completed ET closed", () => {
    // Deux états en base, une seule réalité pour le client.
    expect(libelleStatut({ status:"completed" }, LE_20_AOUT)).toBe("Terminée");
    expect(libelleStatut({ status:"closed" },    LE_20_AOUT)).toBe("Terminée");
  });

  it("remplace le jargon par ce que vit le client", () => {
    expect(libelleStatut({ status:"open" }, LE_20_AOUT)).toBe("Recherche en cours");
    expect(libelleStatut({ status:"needs_replacement" }, LE_20_AOUT)).toBe("Remplaçant recherché");
    expect(libelleStatut({ status:"disputed" }, LE_20_AOUT)).toBe("Litige en cours");
  });

  it("rend l'état brut plutôt qu'un libellé inventé", () => {
    // Mieux vaut un mot étrange qu'un mot rassurant et faux.
    expect(libelleStatut({ status:"etat_inconnu" }, LE_20_AOUT)).toBe("etat_inconnu");
    expect(libelleStatut({}, LE_20_AOUT)).toBe("—");
  });

  it("suit le pointage réel plutôt que l'horaire prévu", () => {
    const demarreeTard = {
      status:"assigned", date:"2026-08-20", heure_debut:"08:00", hours:1,
      started_at: new Date("2026-08-20T11:30:00Z").toISOString(),
    };
    // Prévue de 8 h à 9 h, réellement démarrée à 11 h 30 : à 12 h elle tourne
    // encore. La juger terminée sur l'horaire prévu serait faux.
    expect(libelleStatut(demarreeTard, LE_20_AOUT)).toBe("Confirmée");
  });
});

describe("couleurStatut", () => {
  it("met en évidence le seul état qui demande une action", () => {
    const C = { accentGold:"#F0B429", success:"#10D98F", violet:"#7C6FE0" };
    expect(couleurStatut(passee, C, LE_20_AOUT)).toBe("#F0B429");
    expect(couleurStatut({ status:"completed" }, C, LE_20_AOUT)).toBe("#10D98F");
  });
});

describe("ONGLETS_PRESTATIONS", () => {
  it("garde des identifiants alignés sur les statuts filtrés", () => {
    // Les onglets filtrent sur `m.status` : renommer un libellé ne doit jamais
    // changer l'identifiant, sous peine d'un onglet qui ne montre plus rien.
    expect(ONGLETS_PRESTATIONS.map(o => o.id))
      .toEqual(["all", "open", "assigned", "completed", "prestataires"]);
  });
});
