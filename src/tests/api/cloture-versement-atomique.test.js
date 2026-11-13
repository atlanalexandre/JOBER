// La validation (`complete`) et l'interruption (`cancel_in_progress`)
// programment le versement DANS l'écriture qui clôt la prestation, conditionnée
// à `status=eq.assigned` (relecture du 11/11/2026). Écrit à part, un échec
// laissait une prestation `completed` sans versement, que rien ne reprenait ;
// et l'interruption, sans condition, pouvait écraser une validation du même
// instant.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../../../api/missions.js", import.meta.url), "utf8");
const bloc = (action) => {
  const d = src.indexOf(`if (action === "${action}")`);
  return src.slice(d, src.indexOf("\n    if (action ===", d + 30));
};

describe("complete", () => {
  const b = bloc("complete");
  const ecriture = b.slice(b.indexOf("&status=eq.assigned`"), b.indexOf("const completedRows"));
  it("l'écriture conditionnelle qui clôt porte aussi le versement", () => {
    expect(ecriture).toContain('status: "completed"');
    expect(ecriture).toMatch(/payout_status: "pending",\s*payout_due_at: new Date\(echeanceVersement\)\.toISOString\(\),\s*payout_amount: partPrestataire/);
  });
  it("plus aucune seconde écriture du versement", () => {
    expect(b.slice(b.indexOf("const completedRows"))).not.toContain('payout_status: "pending"');
  });
});

describe("cancel_in_progress", () => {
  const b = bloc("cancel_in_progress");
  it("arrêt de toute la prestation : l'écriture l'emporte sur une validation du même instant, jamais sur un litige ni un versement parti (12/11/2026)", () => {
    expect(b).toContain('? "&status=in.(assigned,completed)&or=(payout_status.is.null,payout_status.eq.pending)"');
    expect(b).toMatch(/const majAnnul = await fetch\(`\$\{SUPABASE_URL\}\/rest\/v1\/missions\?id=eq\.\$\{mission_id\}\$\{filtreAnnul\}`/);
  });
  it("arrêt de la journée seulement : la prestation doit être toujours en cours", () => {
    expect(b).toContain(': "&status=eq.assigned";');
  });
  it("le versement d'une prestation arrêtée part dans cette même écriture, et nulle part ailleurs", () => {
    expect(b).toMatch(/\.\.\.versementInterruption,/);
    expect(b.match(/payout_status: "pending"/g)).toHaveLength(1);
    expect(b).toMatch(/const versementInterruption = !\(annulerReste && mission\.prestataire_id\) \? \{\}/);
  });
  it("rien à verser : le versement est annulé, pas laissé à celui d'une validation du même instant (13/11/2026)", () => {
    expect(b).toContain(': { payout_status: "annule", payout_amount: 0 };');
  });
  it("les heures ajoutées sont rendues APRÈS le remboursement de la prestation, et leur échec n'arrête plus rien (13/11/2026)", () => {
    const principal = b.indexOf("refund-cancel-inprogress-");
    const ajouts = b.indexOf("await rembourserAjoutsNonFaits(");
    expect(principal).toBeGreaterThan(0);
    expect(ajouts).toBeGreaterThan(principal);
    expect(ajouts).toBeLessThan(b.indexOf("const majAnnul"));
    expect(b.slice(ajouts, ajouts + 900)).toContain("À FAIRE À LA MAIN");
  });

  it("heures ajoutées non rendues : un ticket interne, et le client n'en lit pas le remboursement (13/11/2026, après-midi)", () => {
    const echec = b.indexOf("ajoutsRendus = false;");
    expect(echec).toBeGreaterThan(0);
    const suite = b.slice(echec, echec + 1500);
    // Un ticket propre à CET échec (le jour), ce qui est déjà parti déduit.
    // La journée écourtée et l'arrêt de toute la prestation, le même jour, ont chacun leur ticket.
    expect(suite).toContain('evenement: `interruption ${aujourdHui} (${annulerReste ? "arrêt" : "journée"})`');
    expect(suite).toContain("parPaiement: ajoutsPerdus.parPaiement || {}");
    expect(suite).toContain("centimesRendus: Number(rAjouts.centimes) || 0");
    expect(b).toContain("remboursement: Math.round((refundAmount + ajoutsRendusEuros + renduRetard) * 100) / 100,");
    // Ce que Stripe a réellement rendu, même quand tout réussit (plafonné au reste remboursable).
    expect(b).toMatch(/const rAjouts = await rembourserAjoutsNonFaits\([^\n]*\n(?:\s*\/\/[^\n]*\n)*\s*ajoutsRendusEuros = \(Number\(rAjouts\.centimes\) \|\| 0\) \/ 100;/);
  });
  it("le ticket est partagé, propre à chaque échec, n'annonce que le reste dû et demande de vérifier dans Stripe", () => {
    const f = src.slice(src.indexOf("async function ticketHeuresAjoutees("), src.indexOf("async function remettreARembourser("));
    expect(f).toContain("— ${evenement}`");
    expect(f).toContain("Reste dû au client");
    expect(f).toContain("Dû à l'origine, par paiement");
    expect(f).toContain("Vérifier d'abord dans Stripe");
    expect(src.match(/\[Interne\] Heures ajoutées à rembourser/g)).toHaveLength(1);
  });
});

describe("back-office : un versement annulé ne parle de litige que pour ce qu'il est", () => {
  const bo = readFileSync(new URL("../../components/backoffice.jsx", import.meta.url), "utf8");
  it("le libellé n'attribue l'annulation à aucune cause : elle en a plusieurs", () => {
    expect(bo).not.toContain("Versement annulé — le client a été remboursé au titre du litige.");
    expect(bo).toContain('"Versement annulé — rien n\'est dû au prestataire."');
  });
});

