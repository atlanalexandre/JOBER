// Résumé de l'accueil prestataire : la prochaine prestation (relecture du 13/10/2026).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { prochainePrestation } from "../lib/prochaine-prestation.js";

const maintenant = new Date("2026-10-14T10:00:00").getTime(); // mercredi

describe("prochainePrestation", () => {
  it("une série commencée lundi est « en cours » et passe avant une prestation de jeudi", () => {
    const serie = { id:"s", status:"assigned", date:"2026-10-12", date_debut:"2026-10-12", date_fin:"2026-10-16", heure_debut:"08:00" };
    const jeudi = { id:"j", status:"assigned", date:"2026-10-15", heure_debut:"09:00" };
    const r = prochainePrestation([jeudi, serie], maintenant);
    expect(r.prochaine.m.id).toBe("s");
    expect(r.prochaine.enCours).toBe(true);
    expect(r.nb).toBe(2);
  });
  it("une série terminée n'est plus retenue", () => {
    const finie = { id:"f", status:"assigned", date:"2026-10-05", date_fin:"2026-10-09", heure_debut:"08:00" };
    expect(prochainePrestation([finie], maintenant).prochaine).toBeNull();
  });
  it("la plus proche d'abord ; une annulée est ignorée", () => {
    const a = { id:"a", status:"assigned", date:"2026-10-20", heure_debut:"09:00" };
    const b = { id:"b", status:"assigned", date:"2026-10-16", heure_debut:"09:00" };
    const c = { id:"c", status:"cancelled", date:"2026-10-15", heure_debut:"09:00" };
    expect(prochainePrestation([a, b, c], maintenant).prochaine.m.id).toBe("b");
  });
});

describe("my_missions : expiration d'une demande échue", () => {
  const code = readFileSync(new URL("../../api/missions.js", import.meta.url), "utf8");
  const bloc = code.slice(code.indexOf('action === "my_missions"'), code.indexOf("LA DISTANCE, PAS L'ADRESSE"));
  it("n'écrit que si le prestataire est encore rattaché, et ne prévient le client qu'alors", () => {
    expect(bloc).toContain("&prestataire_id=eq.${caller.id}&status=eq.pending_acceptance&select=id");
    expect(bloc).toContain("detaches.length > 0");
  });
});
