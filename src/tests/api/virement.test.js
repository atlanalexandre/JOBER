// Virement au prestataire : réessayer sans jamais payer deux fois (api/_virement.js).
// Relecture du 01/10/2026 : la clé fixe `payout-{mission}` faisait rejouer par
// Stripe, 24 h durant, le refus du premier essai.
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleVersement, virementDejaEmis } from "../../../api/_virement.js";

afterEach(() => vi.unstubAllGlobals());
const H = 3600000;

describe("cleVersement()", () => {
  it("stable dans l'heure, neuve à l'essai suivant", () => {
    const t = 1_790_000_000_000;
    expect(cleVersement("m1", t)).toBe(cleVersement("m1", t + 10 * 60000));
    expect(cleVersement("m1", t)).not.toBe(cleVersement("m1", t + 2 * H));
    expect(cleVersement("m1", t)).not.toBe(cleVersement("m2", t));
  });
});

describe("virementDejaEmis()", () => {
  const page = (data, has_more = false) => ({ ok: true, status: 200, json: async () => ({ data, has_more }) });

  it("retrouve un virement déjà parti pour la prestation", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => page([{ id: "tr_autre", metadata: { mission_id: "m2" } }, { id: "tr_1", metadata: { mission_id: "m1" } }])));
    expect(await virementDejaEmis({ destination: "acct_1", missionId: "m1", stripeKey: "k" })).toEqual({ ok: true, id: "tr_1" });
  });

  it("ignore un virement repris (reversed) : il peut être refait", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => page([{ id: "tr_1", reversed: true, metadata: { mission_id: "m1" } }])));
    expect(await virementDejaEmis({ destination: "acct_1", missionId: "m1", stripeKey: "k" })).toEqual({ ok: true, id: null });
  });

  it("parcourt les pages", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(page([{ id: "tr_a", metadata: { mission_id: "x" } }], true))
      .mockResolvedValueOnce(page([{ id: "tr_b", metadata: { mission_id: "m1" } }]));
    vi.stubGlobal("fetch", f);
    expect(await virementDejaEmis({ destination: "acct_1", missionId: "m1", stripeKey: "k" })).toEqual({ ok: true, id: "tr_b" });
    expect(String(f.mock.calls[1][0])).toContain("starting_after=tr_a");
  });

  it("ne conclut rien quand Stripe ne répond pas — l'appelant n'émet pas", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));
    expect((await virementDejaEmis({ destination: "acct_1", missionId: "m1", stripeKey: "k" })).ok).toBe(false);
  });

  it("ne conclut rien au-delà du nombre de pages parcourues", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => page([{ id: "tr_x", metadata: { mission_id: "x" } }], true)));
    expect((await virementDejaEmis({ destination: "acct_1", missionId: "m1", stripeKey: "k", pagesMax: 3 })).ok).toBe(false);
  });
});
