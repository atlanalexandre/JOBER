// Liste anti-recréation (décision D4 d'Alexandre, 14/10/2026 — `e2e/94`).
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { hashPii } from "../../../api/_email.js";
import {
  telephoneNormalise, empreintes, filtreListeNoire, ligneListeNoire,
  ensemblesListeNoire, correspond, comptesRecrees, remiseAZeroMensuelle,
  inscrireListeNoire, INSCRIPTION_APRES_SUPPRESSION_MS, CONSERVATION_EMPREINTES_MS, depuisConservation,
} from "../../../api/_liste_noire.js";

describe("telephoneNormalise — une seule forme pour un même numéro", () => {
  it.each(["06 12 34 56 78", "0612345678", "06.12.34.56.78", "+33 6 12 34 56 78", "+33612345678", "0033612345678", "33612345678"])(
    "%s → 0612345678", (t) => expect(telephoneNormalise(t)).toBe("0612345678"));
  it("vide : rien", () => {
    expect(telephoneNormalise("")).toBeNull();
    expect(telephoneNormalise(null)).toBeNull();
  });
});

describe("empreintes — comparées sous toutes les écritures", () => {
  const liste = (lignes) => ensemblesListeNoire(lignes);
  it("une empreinte d'avant, prise sur « +33612345678 », reconnaît « 06 12 34 56 78 »", () => {
    const s = liste([{ telephone_hash: hashPii("+33612345678") }]);
    expect(correspond(empreintes({ telephone: "06 12 34 56 78" }), s)).toBe(true);
  });
  it("une empreinte nouvelle (normalisée) reconnaît « +33 6 12 34 56 78 »", () => {
    const s = liste([ligneListeNoire({ telephone: "06 12 34 56 78" })]);
    expect(correspond(empreintes({ telephone: "+33 6 12 34 56 78" }), s)).toBe(true);
  });
  it("l'IBAN, avec ou sans espaces, en minuscules ou majuscules", () => {
    const s = liste([ligneListeNoire({ iban: "FR76 3000 6000 0112 3456 7890 189" })]);
    expect(correspond(empreintes({ iban: "fr7630006000011234567890189" }), s)).toBe(true);
  });
  it("le SIRET, avec ou sans espaces", () => {
    const s = liste([{ siret_hash: hashPii("12345678900012") }]);
    expect(correspond(empreintes({ siret: "123 456 789 00012" }), s)).toBe(true);
  });
  it("un autre numéro n'est pas reconnu", () => {
    const s = liste([ligneListeNoire({ telephone: "0612345678", email: "a@b.fr" })]);
    expect(correspond(empreintes({ telephone: "0699999999", email: "c@d.fr" }), s)).toBe(false);
  });
  it("le filtre de recherche porte toutes les écritures", () => {
    const f = filtreListeNoire(empreintes({ email: "A@B.fr", telephone: "06 12 34 56 78" }));
    expect(f).toMatch(/^\(email_hash\.in\.\([0-9a-f]{64}\),telephone_hash\.in\.\(/);
    expect(f).toContain(hashPii("+33612345678"));
    expect(filtreListeNoire(empreintes({}))).toBe("");
  });
});

describe("comptesRecrees — l'IBAN saisi après l'inscription est comparé", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("reconnaît un profil par son IBAN, et lui seul", async () => {
    const iban = "FR7630006000011234567890189";
    const reponses = {
      account_blacklist: [{ id: "b1", iban_hash: hashPii(iban) }],
      profiles: [{ id: "p1", rib: iban }, { id: "p2", rib: "FR7630006000019999999999999" }],
    };
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      const u = String(url);
      const corps = u.includes("/auth/v1/admin/users") ? { users: [{ id: "p1", email: "x@y.fr", user_metadata: {} }, { id: "p2", email: "z@y.fr", user_metadata: {} }] }
        : u.includes("account_blacklist") ? (u.includes("offset=0") ? reponses.account_blacklist : [])
        : u.includes("/profiles") ? (u.includes("offset=0") ? reponses.profiles : [])
        : null;
      return { ok: true, status: 200, json: async () => corps };
    }));
    const r = await comptesRecrees("https://exemple.supabase.co", {});
    expect([...r]).toEqual(["p1"]);
  });
});

describe("les quatre trous sont fermés dans le code", () => {
  const cron = readFileSync(new URL("../../../api/cron-reset-monthly.js", import.meta.url), "utf8");
  const support = readFileSync(new URL("../../../api/support.js", import.meta.url), "utf8");
  it("la tâche des deux heures compare tous les comptes et repose la pénalité", () => {
    const rappels = cron.slice(cron.indexOf('if (req.query?.action === "reminders")'));
    expect(rappels.slice(0, 7000)).toMatch(/comptesRecrees\(SUPABASE_URL, headers, \{ utilisateurs: userMap, profils: profilsLus \}\)/);
    expect(rappels.slice(0, 9000)).toMatch(/body: JSON\.stringify\(\{ trial_exhausted: true \}\)/);
  });
  it("la remise à zéro du 1er du mois écarte les comptes recréés — par lots, pas dans l'adresse", () => {
    const reset = cron.slice(cron.indexOf("── Mode reset mensuel"));
    expect(reset.slice(0, 3500)).toMatch(/remiseAZeroMensuelle\(SUPABASE_URL, headers, recrees\)/);
    expect(reset).not.toMatch(/not\.in\.\(/);
  });
  it("la résiliation à l'échéance inscrit le compte, avant de le supprimer", () => {
    const i = cron.indexOf("ligneListeNoire(");
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(cron.indexOf('supprimerCompteAuth(p.id, SUPABASE_URL, headers, "resiliation")'));
  });
  it("l'inscription lit le SIRET d'un prestataire, pas seulement celui d'un client", () => {
    expect(support).toMatch(/siret: meta3\.siret \|\| meta3\.kbis/);
  });
});

// Suites de D4 (relecture du 15/10/2026).
describe("suites de D4 — relecture du 15/10/2026", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("une empreinte d'avant, prise sur le numéro modifié dans le profil (« 06 12 34 56 78 »), reconnaît « 0612345678 »", () => {
    // L'écran de profil enregistre le numéro tel qu'affiché, par paires ; les empreintes
    // d'avant D4 l'ont haché ainsi.
    for (const ancien of ["06 12 34 56 78", "+33 6 12 34 56 78", "06.12.34.56.78", "06-12-34-56-78"]) {
      const s = ensemblesListeNoire([{ telephone_hash: hashPii(ancien) }]);
      expect(correspond(empreintes({ telephone: "0612345678" }), s), ancien).toBe(true);
    }
  });

  it("une ligne inscrite APRÈS la création du compte ne le désigne pas : c'est sa propre suppression, manquée", () => {
    // La suppression inscrit l'empreinte, puis peut échouer (pièces non effacées : « votre
    // compte n'a pas été supprimé ») : le compte restait, et perdait son quota gratuit.
    const s = ensemblesListeNoire([{ email_hash: hashPii("a@b.fr"), created_at: "2026-10-10T12:00:00Z" }]);
    const e = empreintes({ email: "a@b.fr" });
    expect(correspond(e, s, Date.parse("2026-09-01T00:00:00Z")), "compte créé avant la ligne").toBe(false);
    expect(correspond(e, s, Date.parse("2026-10-11T00:00:00Z")), "compte recréé après la ligne").toBe(true);
    expect(correspond(e, s), "sans date de création : comme avant").toBe(true);
  });

  it("une ligne inscrite depuis le 19/10/2026 désigne tout compte, même ouvert AVANT (relecture du 16/10/2026)", () => {
    // Ouvrir le nouveau compte, puis supprimer l'ancien : la ligne, postérieure au nouveau
    // compte, était prise pour sa propre suppression manquée — et il gardait un quota neuf.
    const s = ensemblesListeNoire([{ email_hash: hashPii("a@b.fr"), created_at: "2026-10-20T08:00:00Z" }]);
    expect(correspond(empreintes({ email: "a@b.fr" }), s, Date.parse("2026-10-19T18:00:00Z"))).toBe(true);
    expect(INSCRIPTION_APRES_SUPPRESSION_MS).toBe(Date.parse("2026-10-19T12:00:00Z"));
  });

  it("les trois suppressions n'inscrivent l'empreinte qu'une fois le compte supprimé", () => {
    for (const [fichier, debut] of [["bo-action.js", "empreinteBL"], ["support.js", "let empreinteBL"], ["cron-reset-monthly.js", "let empreinteBL"]]) {
      const code = readFileSync(new URL(`../../../api/${fichier}`, import.meta.url), "utf8");
      const bloc = code.slice(code.indexOf(debut));
      const suppression = bloc.indexOf("supprimerCompteAuth(");
      const inscription = bloc.indexOf("inscrireListeNoire(");
      expect(suppression, fichier).toBeGreaterThan(0);
      expect(inscription, `${fichier} : inscrite après la suppression`).toBeGreaterThan(suppression);
      expect(code, `${fichier} : plus d'écriture directe`).not.toMatch(/account_blacklist`, \{\s*method: "POST"/);
    }
  });

  it("données effacées : l'empreinte s'inscrit même si la suppression du compte échoue ensuite (relecture du 20/10/2026)", () => {
    // Le support termine la suppression à la main : l'empreinte ne doit pas se perdre en route.
    for (const fichier of ["bo-action.js", "support.js"]) {
      const code = readFileSync(new URL(`../../../api/${fichier}`, import.meta.url), "utf8");
      const bloc = code.slice(code.indexOf("const compteSupprime = await supprimerCompteAuth("));
      expect(bloc.length, fichier).toBeGreaterThan(0);
      expect(bloc.indexOf("inscrireListeNoire("), `${fichier} : inscrite avant le test d'échec`)
        .toBeLessThan(bloc.indexOf("if (!compteSupprime)"));
      expect(bloc.indexOf("inscrireListeNoire("), fichier).toBeGreaterThan(0);
    }
  });

  it("inscrireListeNoire : un refus est journalisé, la suppression n'est pas défaite", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503 })));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await inscrireListeNoire("https://exemple.supabase.co", {}, { email_hash: "x" }, "resiliation compte-42")).toBe(false);
    expect(String(err.mock.calls.at(0)?.[0]), "le journal nomme le compte").toContain("compte-42");
    expect(await inscrireListeNoire("https://exemple.supabase.co", {}, null, "test")).toBe(false);
  });

  it("comptesRecrees compare la date de la ligne à celle du compte, et prend les profils déjà lus", async () => {
    const appels = [];
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      const u = String(url);
      appels.push(u);
      const corps = u.includes("account_blacklist")
        ? (u.includes("offset=0") ? [{ id: "b1", email_hash: hashPii("a@b.fr"), created_at: "2026-10-10T12:00:00Z" }] : [])
        : null;
      return { ok: true, status: 200, json: async () => corps };
    }));
    const utilisateurs = { ancien: { email: "a@b.fr", meta: {} }, recree: { email: "a@b.fr", meta: {} } };
    const profils = [
      { id: "ancien", created_at: "2026-09-01T00:00:00Z" },
      { id: "recree", created_at: "2026-10-12T00:00:00Z" },
    ];
    const r = await comptesRecrees("https://exemple.supabase.co", {}, { utilisateurs, profils });
    expect([...r]).toEqual(["recree"]);
    expect(appels.some(u => u.includes("/profiles")), "profils déjà lus : pas de seconde lecture").toBe(false);
    expect(appels.find(u => u.includes("account_blacklist"))).toContain("created_at");
  });

  it("la remise à zéro du 1er du mois tient dans des adresses courtes, quel que soit le nombre de comptes recréés", async () => {
    // Mesuré sur la recette : un `id=not.in.(…)` de 400 comptes (15 000 caractères) faisait
    // échouer la requête — et la remise à zéro de TOUS les comptes avec elle.
    const appels = [];
    vi.stubGlobal("fetch", vi.fn(async (url, opts = {}) => {
      appels.push({ url: String(url), corps: opts.body ? JSON.parse(opts.body) : null });
      return { ok: true, status: 204, text: async () => "" };
    }));
    const recrees = new Set(Array.from({ length: 500 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`));
    const out = await remiseAZeroMensuelle("https://exemple.supabase.co", {}, recrees);
    expect(out.ok).toBe(true);
    for (const a of appels) expect(a.url.length, a.url.slice(0, 120)).toBeLessThan(8000);
    expect(appels[0].corps).toEqual({ missions_completed_month: 0, commandes_mois: 0, trial_exhausted: false });
    const penalises = appels.slice(1).flatMap(a => a.url.match(/id=in\.\(([^)]*)\)/)[1].split(","));
    expect(new Set(penalises)).toEqual(recrees);
    for (const a of appels.slice(1)) expect(a.corps).toEqual({ missions_completed_month: 0, commandes_mois: 0, trial_exhausted: true });
  });

  it("une remise à zéro refusée est dite, et les comptes recréés ne sont pas touchés", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, text: async () => "panne" })));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await remiseAZeroMensuelle("https://exemple.supabase.co", {}, new Set(["x"]));
    expect(out.ok).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });
});

describe("durée de conservation — 3 ans (CGPS art. 14.4, décision du 21/10/2026)", () => {
  const T = Date.parse("2030-01-01T00:00:00Z");
  const e = empreintes({ email: "recree@exemple.fr" });
  const ligne = (age) => ({ email_hash: hashPii("recree@exemple.fr"), created_at: new Date(T - age).toISOString() });
  it("une empreinte de moins de 3 ans désigne encore le compte recréé", () => {
    expect(correspond(e, ensemblesListeNoire([ligne(CONSERVATION_EMPREINTES_MS - 86400e3)], T))).toBe(true);
  });
  it("au-delà de 3 ans, elle ne désigne plus personne", () => {
    expect(correspond(e, ensemblesListeNoire([ligne(CONSERVATION_EMPREINTES_MS + 1)], T))).toBe(false);
  });
  it("une date illisible reste comptée", () => {
    expect(correspond(e, ensemblesListeNoire([{ email_hash: hashPii("recree@exemple.fr"), created_at: "?" }], T))).toBe(true);
  });
});

describe("les lectures directes de la liste s'arrêtent aussi à 3 ans (relecture du 22/10/2026)", () => {
  it("depuisConservation : la borne PostgREST", () => {
    const T = Date.parse("2030-01-01T00:00:00Z");
    expect(depuisConservation(T)).toBe(`gte.${new Date(T - CONSERVATION_EMPREINTES_MS).toISOString()}`);
  });
  it.each([["api/support.js", /or: filtre3, created_at: depuisConservation\(\)/], ["api/bo-action.js", /or: filtreBl, created_at: depuisConservation\(\)/]])(
    "%s borne sa lecture", (f, motif) => {
      expect(readFileSync(new URL(`../../../${f}`, import.meta.url), "utf8")).toMatch(motif);
    });
  it("la relance ne journalise pas les adresses", () => {
    const bo = readFileSync(new URL("../../../api/bo-action.js", import.meta.url), "utf8");
    expect(bo).toMatch(/lot\.map\(d => \(\{ action: "relance_sans_siret", target_id: d\.id \}\)\)/);
  });
});
