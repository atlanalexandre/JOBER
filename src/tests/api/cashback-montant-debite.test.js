import { describe, it, expect, vi, afterEach } from "vitest";
import { debiterCashback, restituerCashback } from "../../../api/_cashback.js";

// Relecture du 30/09/2026 : un débit plafonné (solde insuffisant) était rendu en
// entier à l'annulation — le client gagnait la différence.

const SB = "https://base.test";
const H = { apikey: "k" };
const json = (v, status = 200) => new Response(JSON.stringify(v), { status });

afterEach(() => vi.unstubAllGlobals());

describe("débit plafonné, puis restitution", () => {
  it("note le montant réellement débité", async () => {
    const appels = [];
    vi.stubGlobal("fetch", vi.fn(async (url, o = {}) => {
      appels.push({ url: String(url), method: o.method || "GET", body: o.body });
      if (String(url).includes("select=cashback_balance")) return json([{ cashback_balance: 1 }]);
      if (o.method === "PATCH" && String(url).includes("cashback_debite.is.null")) return json([{ id: "m1" }]);
      if (o.method === "PATCH" && String(url).includes("profiles")) return json([{ id: "c" }]);
      return new Response(null, { status: 204 });
    }));
    const r = await debiterCashback({ id: "m1", client_id: "c", cashback_applique: 5, cashback_debite: false }, SB, H);
    expect(r.debite).toBe(1);
    const note = appels.find(a => a.method === "PATCH" && a.body?.includes("cashback_debite_montant"));
    expect(JSON.parse(note.body)).toEqual({ cashback_debite_montant: 1 });
  });

  it("ne rend que ce qui a été débité, pas la réduction promise", async () => {
    let credite = null;
    vi.stubGlobal("fetch", vi.fn(async (url, o = {}) => {
      const u = String(url);
      if (u.includes("select=started_at,status")) return json([{ started_at: null, status: "cancelled" }]);
      if (u.includes("cashback_debite=is.true")) return json([{ id: "m1" }]);
      if (u.includes("select=cashback_debite_montant")) return json([{ cashback_debite_montant: 1 }]);
      if (u.includes("rpc/increment_cashback")) { credite = JSON.parse(o.body).p_delta; return json([{}]); }
      return new Response(null, { status: 204 });
    }));
    const r = await restituerCashback({ id: "m1", client_id: "c", cashback_applique: 5, cashback_debite: true }, SB, H, "test");
    expect(credite).toBe(1);
    expect(r.rendu).toBe(1);
  });

  it("montant non noté (ligne ancienne, migration absente) : la réduction, comme avant", async () => {
    let credite = null;
    vi.stubGlobal("fetch", vi.fn(async (url, o = {}) => {
      const u = String(url);
      if (u.includes("select=started_at,status")) return json([{ started_at: null, status: "cancelled" }]);
      if (u.includes("cashback_debite=is.true")) return json([{ id: "m1" }]);
      if (u.includes("select=cashback_debite_montant")) return json({ message: "column does not exist" }, 400);
      if (u.includes("rpc/increment_cashback")) { credite = JSON.parse(o.body).p_delta; return json([{}]); }
      return new Response(null, { status: 204 });
    }));
    await restituerCashback({ id: "m1", client_id: "c", cashback_applique: 5, cashback_debite: true }, SB, H, "test");
    expect(credite).toBe(5);
  });

  // Relecture du 04/10/2026 : le webhook et l'affectation, quasi simultanés,
  // débitaient chacun la réduction.
  it("second appel simultané : la prestation est déjà prise, le solde n'est pas débité une seconde fois", async () => {
    const appels = [];
    vi.stubGlobal("fetch", vi.fn(async (url, o = {}) => {
      appels.push({ url: String(url), method: o.method || "GET" });
      if (o.method === "PATCH" && String(url).includes("cashback_debite.is.null")) return json([]); // déjà prise
      if (String(url).includes("select=cashback_balance")) return json([{ cashback_balance: 5 }]);
      return json([{ id: "x" }]);
    }));
    const r = await debiterCashback({ id: "m1", client_id: "c", cashback_applique: 5, cashback_debite: false }, SB, H);
    expect(r.debite).toBe(0);
    expect(appels.some(a => a.method === "PATCH" && a.url.includes("profiles")), "aucun débit du solde").toBe(false);
  });
});
