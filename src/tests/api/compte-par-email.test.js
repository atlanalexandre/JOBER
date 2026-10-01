// Retrouver un compte par son adresse (api/_auth.js) — relecture du 01/10/2026.
//
// `/auth/v1/admin/users?email=…` ne filtre pas : la réponse commence par le compte
// le plus récent. La réinitialisation du mot de passe changeait donc celui du
// DERNIER INSCRIT, et non celui du demandeur (constaté en recette).
import { describe, it, expect, vi, afterEach } from "vitest";
import { utilisateurParEmail } from "../../../api/_auth.js";
import resetPassword from "../../../api/reset-password.js";
import { secretReinitialisation, signerLien } from "../../../api/_reinitialisation.js";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

const RECENT = { id: "u-recent", email: "dernier.inscrit@exemple.fr" };
const CIBLE  = { id: "u-cible", email: "Demandeur@Exemple.fr", updated_at: "2026-10-01T10:00:00Z" };

function annuaire(pages, ecrits = []) {
  vi.stubGlobal("fetch", vi.fn(async (url, o = {}) => {
    const u = new URL(String(url));
    if (o.method === "PUT") { ecrits.push({ id: u.pathname.split("/").pop(), corps: JSON.parse(o.body) }); return new Response("{}", { status: 200 }); }
    const page = Number(u.searchParams.get("page")) || 1;
    return new Response(JSON.stringify({ users: pages[page - 1] || [] }), { status: 200 });
  }));
  return ecrits;
}

describe("utilisateurParEmail()", () => {
  it("rend le compte dont l'adresse est exactement la bonne — pas le premier", async () => {
    annuaire([[RECENT, CIBLE]]);
    expect((await utilisateurParEmail("demandeur@exemple.fr", "https://b", "k")).id).toBe("u-cible");
  });
  it("cherche sur les pages suivantes", async () => {
    const pleine = Array.from({ length: 1000 }, (_, i) => ({ id: `x${i}`, email: `x${i}@e.fr` }));
    annuaire([pleine, [CIBLE]]);
    expect((await utilisateurParEmail("demandeur@exemple.fr", "https://b", "k")).id).toBe("u-cible");
  });
  it("rend null quand personne n'a cette adresse — jamais « un » compte", async () => {
    annuaire([[RECENT]]);
    expect(await utilisateurParEmail("inconnu@exemple.fr", "https://b", "k")).toBeNull();
  });
  it("lève quand la liste est illisible : introuvable ne veut pas dire illisible", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("x", { status: 500 })));
    await expect(utilisateurParEmail("a@b.fr", "https://b", "k")).rejects.toThrow();
  });
});

describe("reset-password", () => {
  it("change le mot de passe du DEMANDEUR, pas celui du dernier inscrit", async () => {
    vi.stubEnv("BO_SESSION_SECRET", "secret");
    vi.stubEnv("VITE_SUPABASE_URL", "https://b");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "k");
    const email = "demandeur@exemple.fr";
    const jeton = signerLien(secretReinitialisation({ BO_SESSION_SECRET: "secret" }), email, CIBLE.updated_at);
    const ecrits = annuaire([[RECENT, CIBLE]]);
    vi.spyOn(console, "log").mockImplementation(() => {});
    const res = { statut: 0, status(s) { this.statut = s; return this; }, json() { return this; } };
    await resetPassword({ method: "POST", body: { resetToken: jeton, newPassword: "nouveau-mdp" } }, res);
    expect(res.statut).toBe(200);
    expect(ecrits.map(e => e.id)).toEqual(["u-cible"]);
  });
});
