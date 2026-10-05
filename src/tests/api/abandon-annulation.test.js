// Tâche des réservations abandonnées (relecture du 05/10/2026) : une annulation
// refusée après un remboursement n'est plus avalée, et le client n'est prévenu
// qu'une fois l'annulation faite.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import handler from "../../../api/cron-abandon.js";

const json = (corps, status = 200) => Promise.resolve(new Response(status === 204 ? null : JSON.stringify(corps), { status }));
const LIGNE = { id: "11111111-1111-4111-8111-111111111111", client_id: "22222222-2222-4222-8222-222222222222", titre: "Ménage", metier: "Femme/Valet de chambre" };

function simuler({ patchMission }) {
  const appels = { remboursements: 0, notifications: [], patchs: 0 };
  vi.stubGlobal("fetch", vi.fn((url, opts = {}) => {
    const u = String(url);
    const m = opts.method || "GET";
    if (u.includes("payment_intents/search")) return json({ data: [{ id: "pi_1", status: "succeeded", metadata: { mission: LIGNE.id } }] });
    if (u.includes("api.stripe.com/v1/refunds")) { appels.remboursements++; return json({ id: "re_1" }); }
    if (u.includes("/rest/v1/missions") && u.includes("created_at=lt.") && m === "GET") return json([LIGNE]);
    if (u.includes("/rest/v1/missions") && m === "PATCH") { appels.patchs++; return patchMission(); }
    if (u.includes("/rest/v1/notifications")) { appels.notifications.push(JSON.parse(opts.body)); return json(null, 201); }
    return json([]);
  }));
  return appels;
}

const appeler = async () => {
  const res = { status() { return this; }, json() { return this; }, end() { return this; } };
  await handler({ method: "GET", headers: {} }, res);
};

describe("réservations abandonnées payées", () => {
  let erreurs;
  beforeEach(() => {
    process.env.VITE_SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "srk";
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    delete process.env.CRON_SECRET;
    erreurs = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("annulation refusée : journalisée, et le client n'est pas prévenu", async () => {
    const a = simuler({ patchMission: () => json({ message: "refus" }, 500) });
    await appeler();
    expect(a.remboursements).toBe(1);
    expect(a.notifications.some(n => /remboursé/.test(n.title || ""))).toBe(false);
    expect(erreurs.mock.calls.some(c => /annulation de .* refusée/.test(String(c[0])))).toBe(true);
  });

  it("annulation faite : le client est prévenu une fois", async () => {
    const a = simuler({ patchMission: () => json([{ id: LIGNE.id }]) });
    await appeler();
    expect(a.notifications.filter(n => /remboursé/.test(n.title || ""))).toHaveLength(1);
  });

  it("la file est tirée au hasard parmi les 200 plus anciennes", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../../../api/cron-abandon.js", import.meta.url), "utf8");
    expect(src).toContain("order=created_at.asc&limit=200");
    expect(src).toContain("tirerAuHasard(");
  });
});
