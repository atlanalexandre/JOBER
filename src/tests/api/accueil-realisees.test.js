// « prestations réalisées », sur l'accueil du client (relecture du 15/10/2026).
//
// Le compteur venu du serveur le 13/10/2026 comptait les prestations `completed` ET
// `closed`. Or `closed` ne désigne jamais une prestation faite : une demande close sans
// prestataire ni paiement, une prestation remboursée par le back-office, un litige
// remboursé. En recette, 39 prestations `closed` s'ajoutaient ainsi aux 219 terminées —
// dont 7 sans aucun prestataire. Le catalogue, lui, ne compte que `completed`.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import handler from "../../../api/prestataires.js";

function reponse() {
  const res = { statusCode: 0, corps: null, entetes: {} };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (j) => { res.corps = j; return res; };
  res.setHeader = (k, v) => { res.entetes[k] = v; };
  return res;
}

describe("accueil client : prestations réalisées", () => {
  let urls;
  beforeEach(() => {
    process.env.VITE_SUPABASE_URL = "https://exemple.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "cle-de-test";
    urls = [];
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      urls.push(String(url));
      const n = String(url).includes("status=eq.open") ? 4 : 219;
      return { ok: true, status: 200, headers: { get: (k) => (k === "content-range" ? `0-0/${n}` : null) } };
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.VITE_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it("ne compte que les prestations terminées, comme le catalogue", async () => {
    const res = reponse();
    await handler({ method: "GET", query: { action: "demandes_ouvertes" }, headers: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.corps).toEqual({ count: 4, realisees: 219 });
    const realisees = urls.find(u => !u.includes("status=eq.open"));
    expect(realisees).toContain("/rest/v1/missions?status=eq.completed&");
    expect(realisees).not.toContain("closed");
  });
});
