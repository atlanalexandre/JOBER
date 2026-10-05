import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { debiterCashback } from "../../../api/_cashback.js";

// Relecture du 05/10/2026 : réserver, débiter et noter en trois écritures
// séparées laissait, sur une coupure, une prestation « débitée » sans débit. La
// fonction `debiter_cashback_mission` fait les trois en une transaction ; le
// code y passe d'abord, et garde l'ancien chemin si elle est absente.

const SB = "https://base.test";
const H = { apikey: "k" };
const json = (v, status = 200) => new Response(JSON.stringify(v), { status });
const MISSION = { id: "m1", client_id: "c", cashback_applique: 4, cashback_debite: false };

beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); vi.spyOn(console, "log").mockImplementation(() => {}); vi.spyOn(console, "warn").mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function simuler(rpc) {
  const appels = [];
  vi.stubGlobal("fetch", vi.fn(async (url, o = {}) => {
    const u = String(url);
    appels.push({ u, m: o.method || "GET" });
    if (u.includes("rpc/debiter_cashback_mission")) return rpc();
    if (u.includes("select=cashback_balance")) return json([{ cashback_balance: 10 }]);
    if (o.method === "PATCH" && u.includes("cashback_debite.is.null")) return json([{ id: "m1" }]);
    if (o.method === "PATCH" && u.includes("profiles")) return json([{ id: "c" }]);
    return new Response(null, { status: 204 });
  }));
  return appels;
}

describe("débit du cashback par la base", () => {
  it("fonction présente : un seul appel, aucune écriture séparée", async () => {
    const appels = simuler(() => json([{ etat: "debite", debite: 4, solde: 6 }]));
    const r = await debiterCashback(MISSION, SB, H);
    expect(r).toEqual({ debite: 4, ok: true });
    expect(appels.filter(a => a.m === "PATCH")).toHaveLength(0);
  });

  it("déjà débitée par l'autre chemin : rien de plus", async () => {
    const appels = simuler(() => json([{ etat: "deja_debite", debite: 0, solde: null }]));
    const r = await debiterCashback(MISSION, SB, H);
    expect(r).toEqual({ debite: 0, ok: true });
    expect(appels.filter(a => a.m === "PATCH")).toHaveLength(0);
  });

  it("migration non passée (404) : l'ancien chemin débite comme avant", async () => {
    const appels = simuler(() => json({ code: "PGRST202", message: "Could not find the function" }, 404));
    const r = await debiterCashback(MISSION, SB, H);
    expect(r).toEqual({ debite: 4, ok: true });
    expect(appels.some(a => a.m === "PATCH" && a.u.includes("profiles"))).toBe(true);
  });
});
