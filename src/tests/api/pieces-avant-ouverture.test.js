// Ouvrir l'accès aux prestations suppose les pièces obligatoires validées
// (décision d'Alexandre du 30/09/2026) — api/_documents.js, piecesAvantOuverture.
import { describe, it, expect } from "vitest";
import { piecesAvantOuverture, docsRequisPour } from "../../../api/_documents.js";

const requis = docsRequisPour(null, [{ sector: "hotellerie", metier: "Femme/Valet de chambre" }]);
const valide = (type, extra = {}) => ({ type, verified: true, expires_at: null, ...extra });
const complet = ["photo", "kbis", "cni", "domicile", "rib", "rc_pro"].map(t => valide(t));
const MAINTENANT = Date.parse("2026-10-01T12:00:00Z");

describe("piecesAvantOuverture", () => {
  it("laisse ouvrir un dossier complet et validé", () => {
    expect(piecesAvantOuverture(requis, complet, MAINTENANT)).toEqual([]);
  });

  it("nomme les pièces absentes ou non validées — identité et assurance comprises", () => {
    const docs = complet.filter(d => d.type !== "cni").map(d => d.type === "rc_pro" ? { ...d, verified: false } : d);
    const r = piecesAvantOuverture(requis, docs, MAINTENANT);
    expect(r.map(d => [d.type, d.raison])).toEqual([["cni", "absente"], ["rc_pro", "non vérifiée"]]);
  });

  it("n'exige pas l'attestation URSSAF, qui a son délai de régularisation", () => {
    expect(piecesAvantOuverture(requis, complet, MAINTENANT).some(d => d.type === "urssaf")).toBe(false);
  });

  it("accepte une pièce d'identité purgée après vérification (CGPS 14.4)", () => {
    const docs = complet.map(d => d.type === "cni" ? { ...d, purged_at: "2026-09-01T00:00:00Z" } : d);
    expect(piecesAvantOuverture(requis, docs, MAINTENANT)).toEqual([]);
  });

  it("refuse une assurance échue depuis plus de trente jours, comme le balayage de nuit", () => {
    const echue = complet.map(d => d.type === "rc_pro" ? { ...d, expires_at: "2026-08-01" } : d);
    expect(piecesAvantOuverture(requis, echue, MAINTENANT)).toEqual([expect.objectContaining({ type: "rc_pro", raison: "expirée" })]);
    const recente = complet.map(d => d.type === "rc_pro" ? { ...d, expires_at: "2026-09-25" } : d);
    expect(piecesAvantOuverture(requis, recente, MAINTENANT)).toEqual([]);
  });

  it("ne bloque pas sur l'échéance d'une pièce qui ne suspend pas (domicile)", () => {
    const docs = complet.map(d => d.type === "domicile" ? { ...d, expires_at: "2026-01-01" } : d);
    expect(piecesAvantOuverture(requis, docs, MAINTENANT)).toEqual([]);
  });

  it("exige le titre de séjour d'un ressortissant hors UE", () => {
    const horsUE = docsRequisPour("Hors UE", [{ sector: "hotellerie", metier: "Femme/Valet de chambre" }]);
    expect(piecesAvantOuverture(horsUE, complet, MAINTENANT).map(d => d.type)).toEqual(["titre_sejour"]);
  });
});
