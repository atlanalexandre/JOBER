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

describe("refus durable de la base (relecture du 30/10/2026)", () => {
  it("4xx (colonne ou droit changés) : valeurs par défaut, pas null — sinon 502 à chaque passage, sans ticket", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    servir(new Response("{}", { status: 400 }));
    expect(await lireFraisServiceOuNull("https://b.test", {})).toEqual(FRAIS_PAR_DEFAUT);
  });
  it("429 : panne passagère, null", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    servir(new Response("{}", { status: 429 }));
    expect(await lireFraisServiceOuNull("https://b.test", {})).toBeNull();
  });
});

describe("création du paiement de la prolongation", () => {
  const intent = readFileSync(new URL("../../../api/stripe-intent.js", import.meta.url), "utf8");
  it("les frais sont lus comme à la confirmation : illisibles, rien n'est débité (502)", () => {
    expect(intent).toMatch(/const fraisS = await lireFraisServiceOuNull\(SUPABASE_URL_PI, hdrsPI\);\n\s+if \(!fraisS\) return res\.status\(502\)/);
  });
});

describe("écran client", () => {
  const ecran = readFileSync(new URL("../../components/client-screens.jsx", import.meta.url), "utf8");
  it("une prolongation payée mais non confirmée ne propose plus de la régler une seconde fois", () => {
    expect(ecran.match(/noterSuppPayee\(paiementSupp\.id\);/g)).toHaveLength(2);
    expect(ecran).toMatch(/if \(suppPayees\.has\(selected\.id\)\) return \(/);
    expect(ecran.indexOf("if (suppPayees.has(selected.id))")).toBeLessThan(ecran.indexOf("Régler {d.total"));
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
