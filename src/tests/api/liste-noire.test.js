// Liste anti-recréation (décision D4 d'Alexandre, 14/10/2026 — `e2e/94`).
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { hashPii } from "../../../api/_email.js";
import {
  telephoneNormalise, empreintes, filtreListeNoire, ligneListeNoire,
  ensemblesListeNoire, correspond, comptesRecrees,
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
    expect(rappels.slice(0, 6000)).toMatch(/comptesRecrees\(SUPABASE_URL, headers, \{ utilisateurs: userMap \}\)/);
    expect(rappels.slice(0, 8000)).toMatch(/body: JSON\.stringify\(\{ trial_exhausted: true \}\)/);
  });
  it("la remise à zéro du 1er du mois écarte les comptes recréés", () => {
    const reset = cron.slice(cron.indexOf("── Mode reset mensuel"));
    expect(reset).toMatch(/&id=not\.in\.\(/);
    expect(reset.slice(0, 3500)).toMatch(/trial_exhausted: true/);
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
