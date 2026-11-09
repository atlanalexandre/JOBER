// La référence d'un titre (09/11/2026) : numéro de carte ou clé diplome.gouv.fr,
// écrite par le serveur sur le justificatif déjà déposé — jamais une adresse.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../api/_auth.js", () => ({ verifyUser: vi.fn(async () => ({ id: "p1" })) }));
const { default: handler } = await import("../../../api/notify-doc.js");

function reponse() {
  const res = { statusCode: 0, corps: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (j) => { res.corps = j; return res; };
  res.end = () => res;
  return res;
}
const appel = async (body) => { const res = reponse(); await handler({ method: "POST", headers: {}, body }, res); return res; };

describe("la référence d'un titre", () => {
  let patchs;
  beforeEach(() => {
    process.env.VITE_SUPABASE_URL = "https://b.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "k";
    patchs = [];
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async (url, o = {}) => {
      if ((o.method || "GET") === "PATCH") { patchs.push({ url: String(url), corps: JSON.parse(o.body) }); return new Response(JSON.stringify([{ id: "d1" }]), { status: 200 }); }
      return new Response("[]", { status: 200 });
    }));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("s'écrit sur le justificatif « diplômes » du prestataire, et sur lui seul", async () => {
    const r = await appel({ docType: "diplomes", referenceVerification: "  CAR-075-2027-01-15-20220123456  " });
    expect(r.statusCode).toBe(200);
    expect(patchs).toHaveLength(1);
    expect(patchs[0].url).toContain("prestataire_id=eq.p1&type=eq.diplomes");
    expect(patchs[0].corps).toEqual({ reference_verification: "CAR-075-2027-01-15-20220123456" });
  });
  it("refuse une adresse, un texte trop court ou trop long, et toute autre pièce", async () => {
    for (const ref of ["https://faux-site.fr/attestation", "ab", "x".repeat(81), "<script>"]) {
      expect((await appel({ docType: "diplomes", referenceVerification: ref })).statusCode, ref).toBe(400);
    }
    expect((await appel({ docType: "urssaf", referenceVerification: "ABC123" })).statusCode).toBe(400);
    expect(patchs).toHaveLength(0);
  });
  it("sans justificatif déposé, rien n'est écrit et le prestataire le sait", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
    const r = await appel({ docType: "diplomes", referenceVerification: "ABC123" });
    expect(r.statusCode).toBe(409);
    expect(r.corps.error).toContain("Déposez d'abord");
  });
});
