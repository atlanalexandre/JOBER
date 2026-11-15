// Clôture d'une demande « sans paiement » dont l'heure est passée : Stripe est
// interrogé avant, car un client qui a payé puis fermé son navigateur laisse un
// paiement abouti que la base ignore (13/11/2026). Il est remboursé à la clôture.
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { paiementsAboutisDe } from "../../../api/_paiement.js";

const M = "11111111-1111-4111-8111-111111111111";
const pi = (x = {}) => ({ id: "pi_1", status: "succeeded", metadata: { mission: M }, latest_charge: { refunded: false, amount_refunded: 0 }, ...x });

describe("paiementsAboutisDe", () => {
  afterEach(() => vi.unstubAllGlobals());
  const simuler = (data, status = 200) => {
    const urls = [];
    vi.stubGlobal("fetch", vi.fn(async (u) => { urls.push(String(u)); return new Response(JSON.stringify(status === 200 ? { data } : {}), { status }); }));
    return urls;
  };

  it("cherche par identifiant de prestation : un paiement de l'autre environnement ne s'y glisse pas", async () => {
    const urls = simuler([pi()]);
    expect((await paiementsAboutisDe(M, "sk")).aRendre).toEqual(["pi_1"]);
    // Une seule clause : Stripe refuse AND et OR mêlés (400, constaté le 14/11/2026).
    const requete = new URL(urls[0]).searchParams.get("query");
    expect(requete).toBe(`metadata['mission']:'${M}'`);
    expect(requete).not.toMatch(/ OR /);
  });
  it("écarte les séries, les heures supplémentaires et les paiements entièrement remboursés ; un remboursement partiel laisse le reste à rendre", async () => {
    simuler([
      pi({ id: "pi_serie", metadata: { mission: M, type: "serie" } }),
      pi({ id: "pi_hs", metadata: { mission: M, type: "heures_supp" } }),
      pi({ id: "pi_rendu", latest_charge: { refunded: true, amount_refunded: 11098 } }),
      pi({ id: "pi_partiel", latest_charge: { refunded: false, amount_refunded: 500 } }),
      pi({ id: "pi_autre", metadata: { mission: "autre" } }),
      pi({ id: "pi_bon" }),
    ]);
    expect((await paiementsAboutisDe(M, "sk")).aRendre).toEqual(["pi_partiel", "pi_bon"]);
  });
  it("un paiement en cours de traitement est signalé : la clôture attendra", async () => {
    simuler([pi({ id: "pi_traitement", status: "processing", latest_charge: null })]);
    expect(await paiementsAboutisDe(M, "sk")).toEqual({ aRendre: [], enCours: ["pi_traitement"] });
  });
  it("l'état est filtré ici : abandonné, annulé ou sans moyen de paiement — rien à rendre, rien n'attend", async () => {
    simuler(["canceled", "requires_payment_method", "requires_confirmation", "requires_action"].map((status, i) => pi({ id: `pi_${i}`, status, latest_charge: null })));
    expect(await paiementsAboutisDe(M, "sk")).toEqual({ aRendre: [], enCours: [] });
  });
  it("Stripe muet : lève — on ne clôt pas sans savoir", async () => {
    simuler([], 500);
    await expect(paiementsAboutisDe(M, "sk")).rejects.toThrow("refusée");
  });
});

describe("la clôture des demandes dépassées l'utilise", () => {
  const cron = readFileSync(new URL("../../../api/cron-reset-monthly.js", import.meta.url), "utf8");
  const debut = cron.indexOf("const aPaye = !!m.stripe_payment_intent;");
  const bloc = cron.slice(debut, debut + 9000);
  it("interroge Stripe AVANT de clore une demande sans paiement, et reporte s'il ne répond pas", () => {
    const recherche = bloc.indexOf("await paiementsAboutisDe(m.id, cleStripe)");
    expect(recherche).toBeGreaterThan(0);
    expect(recherche).toBeLessThan(bloc.indexOf("const close = await ecrireVerifie("));
    expect(bloc).toContain("paiement non vérifiable — clôture reportée");
    expect(bloc).toMatch(/paiement non vérifiable — clôture reportée[\s\S]{0,200}differeesPersistantes\.push\(m\.id\)/);
    expect(bloc).toContain("paiement en cours de traitement");
    expect(bloc).toContain("nonRattaches = lus.aRendre;");
  });
  it("une demande avec un paiement trouvé passe « annulée », pas « clôturée », et ce paiement est rendu avec la clé de l'application", () => {
    expect(bloc).toContain('{ status: aPaye || nonRattaches.length ? "cancelled" : "closed" }');
    expect(bloc).toContain("rembourserDoublonPaiement(pi, `cron/cloture ${m.id}`)");
    // Un paiement rattaché entre-temps : la clôture ne passe pas.
    expect(bloc).toContain('${aPaye ? "" : "&stripe_payment_intent=is.null"}');
  });
  it("le client lit la vraie raison : sa réservation n'a pas pu être finalisée", () => {
    expect(bloc).toContain("la réservation n'a pas pu être finalisée avant l'heure prévue");
  });
});
