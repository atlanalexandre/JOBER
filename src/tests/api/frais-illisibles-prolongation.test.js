// Prolongation déjà payée, frais de service illisibles (relecture du 29/10/2026) :
// le paiement n'est pas contrôlé contre des valeurs par défaut — il paraissait
// insuffisant, et la prolongation était refusée au client qui venait de payer.
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { lireFraisServiceOuNull, FRAIS_PAR_DEFAUT } from "../../../api/_montant.js";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const servir = (rep) => vi.stubGlobal("fetch", vi.fn(async () => rep));

describe("lireFraisServiceOuNull", () => {
  it("réglage lu : fusionné avec les valeurs par défaut", async () => {
    servir(new Response(JSON.stringify([{ value: { single: 5.9 } }]), { status: 200 }));
    expect(await lireFraisServiceOuNull("https://b.test", {})).toEqual({ ...FRAIS_PAR_DEFAUT, single: 5.9 });
  });
  it("réglage absent (aucune ligne) : valeurs par défaut, ce n'est pas une panne", async () => {
    servir(new Response("[]", { status: 200 }));
    expect(await lireFraisServiceOuNull("https://b.test", {})).toEqual(FRAIS_PAR_DEFAUT);
  });
  it("base en panne ou réponse illisible : null, jamais les valeurs par défaut", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    servir(new Response("{}", { status: 503 }));
    expect(await lireFraisServiceOuNull("https://b.test", {})).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNRESET"); }));
    expect(await lireFraisServiceOuNull("https://b.test", {})).toBeNull();
  });
});

describe("appliquerHeuresSupp", () => {
  const code = readFileSync(new URL("../../../api/missions.js", import.meta.url), "utf8");
  const fonction = code.slice(code.indexOf("export async function appliquerHeuresSupp"), code.indexOf("export default async function handler"));
  it("contrôle le paiement contre les frais réglés, ou attend (502) s'ils sont illisibles", () => {
    expect(fonction).toMatch(/const frais {2}= await lireFraisServiceOuNull\(SUPABASE_URL, headers\);\n\s+if \(!frais\) return reponseHS\(502, \{ error: MESSAGE_VERIFICATION_DIFFEREE \}\);/);
    expect(fonction).not.toMatch(/await lireFraisService\(/);
  });
});
