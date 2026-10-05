import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { debiterCashback } from "../../../api/_cashback.js";

// Relecture du 05/10/2026 : la prestation est réservée pour le débit, et l'autre
// chemin qui la trouve prise s'arrête pour de bon. Un compare-and-swap manqué une
// seule fois — un crédit arrivé entre la lecture et l'écriture — laissait donc le
// solde intact pour toujours.

const SB = "https://base.test";
const H = { apikey: "k" };
const json = (v, status = 200) => new Response(JSON.stringify(v), { status });

beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); vi.spyOn(console, "log").mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function simuler(soldes, casReussi) {
  const ecrits = [];
  let lectures = 0, cas = 0;
  vi.stubGlobal("fetch", vi.fn(async (url, o = {}) => {
    const u = String(url);
    if (u.includes("select=cashback_balance")) return json([{ cashback_balance: soldes[Math.min(lectures++, soldes.length - 1)] }]);
    if (o.method === "PATCH" && u.includes("cashback_debite.is.null")) return json([{ id: "m1" }]);
    if (o.method === "PATCH" && u.includes("profiles")) { ecrits.push(JSON.parse(o.body)); return json(casReussi(++cas) ? [{ id: "c" }] : []); }
    if (o.method === "PATCH") { ecrits.push(JSON.parse(o.body)); return new Response(null, { status: 204 }); }
    return new Response(null, { status: 204 });
  }));
  return ecrits;
}

describe("débit du cashback, solde modifié entre-temps", () => {
  it("relit et réessaie : la réduction est bien débitée sur le nouveau solde", async () => {
    // 10 € lus, puis un crédit de 3 € arrive : le premier CAS échoue, le second passe sur 13 €.
    const ecrits = simuler([10, 13], (n) => n === 2);
    const r = await debiterCashback({ id: "m1", client_id: "c", cashback_applique: 4, cashback_debite: false }, SB, H);
    expect(r).toEqual({ debite: 4, ok: true });
    expect(ecrits.some(e => e.cashback_balance === 9)).toBe(true);
    expect(ecrits.some(e => e.cashback_debite === false), "la réservation n'est pas rendue").toBe(false);
  });

  it("trois échecs : la réservation est rendue, rien n'est débité", async () => {
    const ecrits = simuler([10, 11, 12], () => false);
    const r = await debiterCashback({ id: "m1", client_id: "c", cashback_applique: 4, cashback_debite: false }, SB, H);
    expect(r).toEqual({ debite: 0, ok: false });
    expect(ecrits.filter(e => "cashback_balance" in e)).toHaveLength(3);
    expect(ecrits.some(e => e.cashback_debite === false)).toBe(true);
  });
});
