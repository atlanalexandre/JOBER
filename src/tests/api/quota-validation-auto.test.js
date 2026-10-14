// Le quota mensuel ne comptait que les prestations validées par le client : la
// validation automatique (24 h sans réponse) ne comptait rien, et la place se
// libérait (étude du 14/10/2026).
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { compterAuQuota } from "../../../api/missions.js";

afterEach(() => vi.unstubAllGlobals());

function simuler(profil, reglages = {}) {
  const ecrits = [];
  vi.stubGlobal("fetch", vi.fn(async (url, opts = {}) => {
    const u = String(url);
    if (opts.method === "PATCH") { ecrits.push({ url: u, corps: JSON.parse(opts.body) }); return new Response(null, { status: 204 }); }
    if (u.includes("/profiles?id=eq.")) return Response.json([profil]);
    if (u.includes("platform_settings")) return Response.json(reglages.lignes || [{ key: "plan_limits", value: { free: 2, premium: 8, elite: 999 } }]);
    return Response.json([]);
  }));
  return ecrits;
}

describe("quota mensuel", () => {
  it("compte les jours de la prestation", async () => {
    const ecrits = simuler({ missions_completed_month: 0, trial_exhausted: false, plan_abonnement: "premium" });
    await compterAuQuota("p1", 1, "https://x.supabase.co", {}, "test");
    const quota = ecrits.find(e => e.url.includes("/profiles?id=eq.p1"));
    expect(quota?.corps.missions_completed_month).toBe(1);
  });

  it("la validation automatique compte au quota, comme celle du client", () => {
    const src = readFileSync(new URL("../../../api/cron-reset-monthly.js", import.meta.url), "utf8");
    expect(src).toMatch(/autoValidated\+\+;[\s\S]{0,400}compterAuQuota\(m\.prestataire_id, nombreDeJours\(m\)/);
    const missions = readFileSync(new URL("../../../api/missions.js", import.meta.url), "utf8");
    expect(missions).toMatch(/compterAuQuota\(mission\.prestataire_id, missionDayCount/);
  });
});
