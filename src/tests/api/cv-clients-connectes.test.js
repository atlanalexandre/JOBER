// Le CV des prestataires : aux clients connectés seulement (décision
// d'Alexandre du 14/10/2026).
//
// Le catalogue `/api/prestataires` est public, sans compte, et gardé par le
// réseau de Vercel : il rendait le CV complet — parcours, employeurs, diplômes —
// à tout visiteur, alors que l'écran ne le montre qu'à un client connecté.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import handler from "../../../api/prestataires.js";
import { cvPresent } from "../../../api/_cv.js";

const PRESTA = "33333333-3333-4333-8333-333333333333";
const CV = { titre: "Femme de chambre", accroche: "Huit ans en hôtellerie de luxe.", experiences: [{ poste: "Gouvernante", entreprise: "Hôtel X" }] };

beforeEach(() => {
  vi.stubEnv("VITE_SUPABASE_URL", "https://base.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

function reponse() {
  const r = { code: 0, corps: null, entetes: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.corps = b; return r; };
  r.setHeader = (k, v) => { r.entetes[k] = v; };
  return r;
}

function monde({ role = "client", status = "approved", jetonValide = true, cvProfil = CV, cvMeta = null } = {}) {
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    const u = String(url);
    const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s });
    if (u.endsWith("/auth/v1/user")) return jetonValide ? json({ id: "appelant" }) : json({}, 401);
    if (u.includes("profiles?id=eq.appelant")) return json([{ role, status }]);
    if (u.includes(`profiles?id=eq.${PRESTA}`)) return json([{ cv: cvProfil }]);
    if (u.includes(`/auth/v1/admin/users/${PRESTA}`)) return json({ user_metadata: { cv: cvMeta } });
    return json([]);
  }));
}

const lire = async (entetes = { authorization: "Bearer jeton" }) => {
  const res = reponse();
  await handler({ method: "GET", headers: entetes, query: { action: "cv", id: PRESTA } }, res);
  return res;
};

describe("lecture du CV", () => {
  it("sans compte : refusée", async () => {
    monde();
    const res = await lire({});
    expect(res.code).toBe(401);
    expect(res.corps.cv).toBeUndefined();
  });

  it("par un prestataire : refusée", async () => {
    monde({ role: "prestataire" });
    expect((await lire()).code).toBe(403);
  });

  it("par un client suspendu : refusée", async () => {
    monde({ status: "suspended" });
    expect((await lire()).code).toBe(403);
  });

  it("par un client connecté : le CV, jamais gardé en cache partagé", async () => {
    monde();
    const res = await lire();
    expect(res.code).toBe(200);
    expect(res.corps.cv.titre).toBe(CV.titre);
    expect(res.entetes["Cache-Control"]).toBe("private, no-store");
  });

  it("CV d'avant le 29/09/2026, resté dans user_metadata : lu aussi", async () => {
    monde({ cvProfil: null, cvMeta: CV });
    expect((await lire()).corps.cv.titre).toBe(CV.titre);
  });
});

describe("catalogue public", () => {
  const code = readFileSync(new URL("../../../api/prestataires.js", import.meta.url), "utf8");
  it("ne rend plus le contenu du CV, seulement s'il existe", () => {
    expect(code).not.toMatch(/^\s*cv:\s/m);
    expect(code).toContain("a_cv:             cvPresent(p.cv || meta.cv),");
  });
  it("un CV vide n'est pas un CV", () => {
    expect(cvPresent({})).toBe(false);
    expect(cvPresent({ experiences: [] })).toBe(false);
    expect(cvPresent(CV)).toBe(true);
  });
});
