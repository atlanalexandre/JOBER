// Prolongation : les frais de service sont lus avec l'ÉTAT de la lecture
// (lireFraisServiceEtat). Historique : repli sur les valeurs par défaut
// (paiement valable jugé insuffisant, 29/10), null sur tout échec (502 répété
// sans ticket, 30/10), valeurs par défaut sur un refus durable (prolongation
// enregistrée sous le montant payé, 31/10). Un refus durable ne fait plus ni
// payer ni appliquer.
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { lireFraisServiceEtat, FRAIS_PAR_DEFAUT } from "../../../api/_montant.js";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const servir = (rep) => vi.stubGlobal("fetch", vi.fn(async () => rep));

describe("lireFraisServiceEtat", () => {
  it("réglage lu : fusionné avec les valeurs par défaut", async () => {
    servir(new Response(JSON.stringify([{ value: { single: 5.9 } }]), { status: 200 }));
    expect(await lireFraisServiceEtat("https://b.test", {})).toEqual({ frais: { ...FRAIS_PAR_DEFAUT, single: 5.9 }, etat: "ok" });
  });
  it("réglage absent (aucune ligne) : valeurs par défaut, ce n'est pas une panne", async () => {
    servir(new Response("[]", { status: 200 }));
    expect(await lireFraisServiceEtat("https://b.test", {})).toEqual({ frais: FRAIS_PAR_DEFAUT, etat: "ok" });
  });
  it("panne passagère (5xx, 429, réseau, réponse illisible) : « panne », sans frais", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const st of [503, 429]) {
      servir(new Response("{}", { status: st }));
      expect(await lireFraisServiceEtat("https://b.test", {})).toEqual({ frais: null, etat: "panne" });
    }
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNRESET"); }));
    expect(await lireFraisServiceEtat("https://b.test", {})).toEqual({ frais: null, etat: "panne" });
  });
  it("refus durable (4xx) : « refus », sans frais — jamais les valeurs par défaut (relecture du 31/10/2026)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    servir(new Response("{}", { status: 400 }));
    expect(await lireFraisServiceEtat("https://b.test", {})).toEqual({ frais: null, etat: "refus" });
  });
});

describe("création du paiement de la prolongation (stripe-intent)", () => {
  const intent = readFileSync(new URL("../../../api/stripe-intent.js", import.meta.url), "utf8");
  it("frais illisibles ou refusés : rien n'est débité (502)", () => {
    expect(intent).toMatch(/const \{ frais: fraisS \} = await lireFraisServiceEtat\(SUPABASE_URL_PI, hdrsPI\);\n\s+if \(!fraisS\) return res\.status\(502\)/);
  });
  it("prolongation déjà payée (même repère, non remboursée) : second paiement refusé (409) — relecture du 31/10/2026", () => {
    expect(intent).toMatch(/metadata\['type'\]:'heures_supp' AND status:'succeeded'/);
    expect(intent).toMatch(/dejaPayee = dq\.data\.find\(p => p\.metadata\?\.deja_appliquees === repere/);
    expect(intent).toMatch(/if \(dejaPayee\) \{[\s\S]{0,200}return res\.status\(409\)/);
    // Avant la création du paiement, et une recherche illisible ne fait pas payer à l'aveugle.
    expect(intent.indexOf("if (dejaPayee)")).toBeLessThan(intent.indexOf('"Idempotency-Key": `supp2-'));
    expect(intent).toMatch(/paiements antérieurs illisibles[\s\S]{0,120}return res\.status\(502\)/);
  });
});

describe("écran client", () => {
  const ecran = readFileSync(new URL("../../components/client-screens.jsx", import.meta.url), "utf8");
  it("après un paiement non confirmé : plus de bouton « Régler » pour CETTE prolongation, et un message qui dit la suite réelle", () => {
    expect(ecran).toContain('noterSuppPayee(paiementSupp, res.status === 502 ? "auto" : "equipe");');
    expect(ecran).toContain('noterSuppPayee(paiementSupp, "equipe");');
    expect(ecran).toMatch(/if \(suppPayees\.has\(cleSupp\(selected\)\)\) return \(/);
    expect(ecran.indexOf("if (suppPayees.has(cleSupp(selected)))")).toBeLessThan(ecran.indexOf("Régler {d.total"));
    // La clé suit la prolongation en cours : une prolongation suivante reste réglable.
    expect(ecran).toMatch(/const cleSupp = \(m\) => `\$\{m\.id\}:\$\{Math\.round\(\(Number\(m\.extra_hours_appliquees \|\| 0\) \+ Number\(m\.heures_ajoutees_total \|\| 0\)\) \* 100\) \/ 100\}`;/);
  });
});

describe("appliquerHeuresSupp", () => {
  const code = readFileSync(new URL("../../../api/missions.js", import.meta.url), "utf8");
  const fonction = code.slice(code.indexOf("export async function appliquerHeuresSupp"), code.indexOf("export default async function handler"));
  it("panne : 502 (le rattrapage réessaie) ; refus durable : 500 (le rattrapage ouvre un ticket) — jamais d'application sur des frais par défaut", () => {
    expect(fonction).toMatch(/const \{ frais, etat: etatFrais \} = await lireFraisServiceEtat\(SUPABASE_URL, headers\);\n\s+if \(etatFrais === "panne"\) return reponseHS\(502, \{ error: MESSAGE_VERIFICATION_DIFFEREE \}\);/);
    expect(fonction).toMatch(/if \(!frais\) return reponseHS\(500,/);
    expect(fonction).not.toMatch(/await lireFraisService\(/);
  });
});
