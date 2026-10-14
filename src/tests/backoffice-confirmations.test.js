// Back-office : les gestes d'argent et les envois de masse se confirment, et
// « Annuler » arrête tout (décision D6 d'Alexandre, 14/10/2026 — `e2e/93`).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const bo = readFileSync(new URL("../components/backoffice.jsx", import.meta.url), "utf8");
const api = readFileSync(new URL("../../api/bo-action.js", import.meta.url), "utf8");

/** La confirmation précède-t-elle l'appel au serveur, dans les `fenetre` caractères qui le précèdent ? */
function confirmeAvant(appel, fenetre = 2500) {
  const i = bo.indexOf(appel);
  expect(i, `appel introuvable : ${appel}`).toBeGreaterThan(0);
  return /showConfirm\(/.test(bo.slice(Math.max(0, i - fenetre), i));
}

describe("confirmation avant chaque geste d'argent et chaque envoi de masse", () => {
  it.each([
    ['action:"adjust_cashback"', "ajustement du cashback"],
    ['action:"manual_refund"', "remboursement manuel"],
    ['action:"broadcast_notification"', "notification à tous"],
    ['action:"send_global_comm"', "communication à tous les prestataires"],
  ])("%s (%s)", (appel) => {
    expect(confirmeAvant(appel)).toBe(true);
  });
  it("l'ajustement du cashback affiche un refus du serveur", () => {
    const i = bo.indexOf('action:"adjust_cashback"');
    expect(bo.slice(i, i + 900)).toMatch(/showToast\(j\.error/);
  });
});

describe("annuler une prestation payée", () => {
  it("la question « Rembourser le client en même temps ? » n'est plus posée", () => {
    expect(bo).not.toMatch(/showConfirm\("Cette prestation a un paiement Stripe/);
  });
  it("« Annuler » dans la confirmation arrête tout ; « OK » annule ET rembourse", () => {
    const i = bo.indexOf("rembourser intégralement ${m.client_name");
    expect(i).toBeGreaterThan(0);
    const suite = bo.slice(i, i + 300);
    expect(suite).toMatch(/\)\) return;/);
    expect(suite).toMatch(/handleCancel\(m\.id, true\)/);
  });
});

describe("le motif s'ajoute au message envoyé, il ne le remplace plus", () => {
  const bloc = api.slice(api.indexOf('if (action === "cancel_mission")'), api.indexOf('if (action === "cancel_mission")') + 4000);
  it("le message au client garde « 5 à 10 jours » quand un motif est saisi", () => {
    expect(bloc).not.toMatch(/body:reason\|\|/);
    expect(bloc).toMatch(/5 à 10 jours ouvrés[^"]*"[^)]*\) \+ suffixe/);
  });
});
