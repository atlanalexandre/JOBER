// Double paiement : deux trous restants (relecture du 14/10/2026).
//
// 1. `paiementDejaAbouti` ne cherchait que dans la liste du client Stripe quand
//    il y en avait un. Un paiement créé sans client (client Stripe indisponible
//    au premier essai) n'y figure pas : le second essai faisait payer à nouveau.
// 2. Le refus d'un second paiement annulait la réservation sur son seul statut,
//    même quand un premier paiement venait d'y être rattaché — sans le rendre.
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { paiementDejaAbouti } from "../../../api/_paiement.js";

const pi = (id, extra = {}) => ({ id, status: "succeeded", metadata: { mission: "m1", client: "c1" }, latest_charge: { refunded: false }, ...extra });

describe("paiementDejaAbouti", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("retrouve un paiement créé sans client Stripe, même quand le client en a un désormais", async () => {
    const urls = [];
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      urls.push(String(url));
      const data = String(url).includes("/search?") ? [pi("pi_sans_client")] : [pi("pi_autre", { metadata: { mission: "m2", client: "c1" } })];
      return { ok: true, status: 200, json: async () => ({ data }) };
    }));
    expect(await paiementDejaAbouti({ missionId: "m1", clientId: "c1", customerId: "cus_1", cle: "sk" })).toBe("pi_sans_client");
    expect(urls[0]).toContain("customer=cus_1");
    expect(urls[1]).toContain("/payment_intents/search?");
  });

  it("trouvé dans la liste du client : pas de recherche en plus", async () => {
    const appel = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [pi("pi_client")] }) }));
    vi.stubGlobal("fetch", appel);
    expect(await paiementDejaAbouti({ missionId: "m1", clientId: "c1", customerId: "cus_1", cle: "sk" })).toBe("pi_client");
    expect(appel).toHaveBeenCalledTimes(1);
  });

  it("sans client Stripe : la recherche seule", async () => {
    const appel = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [] }) }));
    vi.stubGlobal("fetch", appel);
    expect(await paiementDejaAbouti({ missionId: "m1", clientId: "c1", customerId: null, cle: "sk" })).toBeNull();
    expect(appel).toHaveBeenCalledTimes(1);
    expect(String(appel.mock.calls[0][0])).toContain("/search?");
  });

  it("Stripe illisible : on ne sait pas, on le dit", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: { message: "panne" } }) })));
    await expect(paiementDejaAbouti({ missionId: "m1", clientId: "c1", customerId: "cus_1", cle: "sk" })).rejects.toThrow(/refusée \(500\)/);
  });
});

describe("refus d'un paiement après coup", () => {
  const source = readFileSync(new URL("../../../api/missions.js", import.meta.url), "utf8");
  const bloc = source.slice(source.indexOf("async function rembourserRefusApresPaiement"), source.indexOf("function suffixeRemboursement"));
  it("n'annule la réservation que si aucun autre paiement n'y est rattaché", () => {
    expect(bloc).toMatch(/status=in\.\(open,pending_acceptance\)\$\{filtrePaiementLibre\(intentId\)\}/);
  });
});
