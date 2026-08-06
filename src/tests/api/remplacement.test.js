import { describe, it, expect } from "vitest";
import { debutPrestationMs } from "../../../api/_temps.js";

// ═══════════════════════════════════════════════════════════════════════════
// Droit de remplacement (CGPS art. 9)
// ═══════════════════════════════════════════════════════════════════════════
//
// Les règles de décision de `api/missions.js` sont reproduites ici à l'identique.
// Elles ne portent pas sur de l'affichage : une erreur laisse une prestation sans
// titulaire le jour J, ou fait basculer une prestation déjà commencée.

// Délai minimum entre la demande et le début, pour que le client ait un temps
// réel de réponse (action `proposer_remplacant`).
const DELAI_MIN_MS = 2 * 3600000;

function demandeRecevable(mission, maintenantMs) {
  const debutMs = debutPrestationMs(mission.date, mission.heure_debut);
  if (mission.started_at) return { ok: false, motif: "commencee" };
  if (debutMs !== null && debutMs - maintenantMs < DELAI_MIN_MS) return { ok: false, motif: "trop_tard" };
  return { ok: true };
}

// Le remplacement n'est exécuté que lorsque les DEUX accords sont posés.
function etatApresAccord(demande, role) {
  const maj = {
    ...demande,
    accord_client_at:  role === "client"  ? "maintenant" : demande.accord_client_at,
    accord_entrant_at: role === "entrant" ? "maintenant" : demande.accord_entrant_at,
  };
  return {
    ...maj,
    statut: (maj.accord_client_at && maj.accord_entrant_at) ? "accepte" : "en_attente",
  };
}

const VIDE = { accord_client_at: null, accord_entrant_at: null, statut: "en_attente" };

describe("recevabilité d'une demande de remplacement", () => {
  const midiUTC = Date.UTC(2026, 7, 10, 12, 0, 0); // 14 h à Paris en été

  it("accepte une demande déposée bien avant le début", () => {
    const maintenant = midiUTC - 6 * 3600000;
    expect(demandeRecevable({ date: "2026-08-10", heure_debut: "14:00" }, maintenant).ok).toBe(true);
  });

  it("accepte une demande déposée exactement 2 h avant", () => {
    const maintenant = midiUTC - DELAI_MIN_MS;
    expect(demandeRecevable({ date: "2026-08-10", heure_debut: "14:00" }, maintenant).ok).toBe(true);
  });

  it("refuse une demande déposée moins de 2 h avant : le client n'aurait pas le temps de répondre", () => {
    const maintenant = midiUTC - 90 * 60000;
    const r = demandeRecevable({ date: "2026-08-10", heure_debut: "14:00" }, maintenant);
    expect(r.ok).toBe(false);
    expect(r.motif).toBe("trop_tard");
  });

  it("refuse une prestation déjà commencée, même déposée très à l'avance", () => {
    const r = demandeRecevable(
      { date: "2026-08-10", heure_debut: "14:00", started_at: "2026-08-10T12:05:00Z" },
      midiUTC - 10 * 3600000
    );
    expect(r.ok).toBe(false);
    expect(r.motif).toBe("commencee");
  });

  it("mesure le délai en heure française, pas en UTC", () => {
    // 12:30 UTC = 14 h 30 à Paris : la prestation de 14 h a déjà commencé.
    // Sans conversion, le calcul naïf verrait encore 1 h 30 d'avance et
    // accepterait la demande.
    const maintenant = Date.UTC(2026, 7, 10, 12, 30, 0);
    expect(demandeRecevable({ date: "2026-08-10", heure_debut: "14:00" }, maintenant).ok).toBe(false);
  });
});

describe("les deux accords sont requis", () => {
  it("l'accord du client seul ne suffit pas", () => {
    const r = etatApresAccord(VIDE, "client");
    expect(r.statut).toBe("en_attente");
  });

  it("l'accord du remplaçant seul ne suffit pas", () => {
    const r = etatApresAccord(VIDE, "entrant");
    expect(r.statut).toBe("en_attente");
  });

  it("le second accord déclenche la bascule, quel que soit l'ordre", () => {
    expect(etatApresAccord(etatApresAccord(VIDE, "client"), "entrant").statut).toBe("accepte");
    expect(etatApresAccord(etatApresAccord(VIDE, "entrant"), "client").statut).toBe("accepte");
  });
});

describe("détermination du rôle de celui qui répond", () => {
  // Le rôle découle de l'identité de l'appelant, jamais du corps de la requête :
  // laisser le client annoncer « je suis le remplaçant » permettrait de poser
  // les deux accords soi-même.
  const roleDe = (callerId, dem) =>
    callerId === dem.client_id ? "client"
    : callerId === dem.entrant_id ? "entrant"
    : null;

  const dem = { client_id: "cli", entrant_id: "ent", sortant_id: "sor" };

  it("reconnaît le client et le remplaçant", () => {
    expect(roleDe("cli", dem)).toBe("client");
    expect(roleDe("ent", dem)).toBe("entrant");
  });

  it("refuse le prestataire sortant : il propose, il ne s'accorde pas à lui-même", () => {
    expect(roleDe("sor", dem)).toBeNull();
  });

  it("refuse un tiers", () => {
    expect(roleDe("quelqun-dautre", dem)).toBeNull();
  });
});
