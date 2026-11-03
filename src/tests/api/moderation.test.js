// Modération des services à caractère sexuel (02/11/2026) : repérer sans
// bloquer, et ne pas crier sur le vocabulaire ordinaire des métiers.
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { motsSuspects, contenusSuspects, signalerAuBackOffice, empreinte } from "../../../api/_moderation.js";
import { METIERS, COMPETENCES_PAR_METIER, QUALIFICATIONS_OBLIGATOIRES, NOTES_METIERS } from "../../constants/data.js";

describe("les mots repérés", () => {
  it("trouve les formulations sans ambiguïté, accents et majuscules compris", () => {
    for (const [t, attendu] of [
      ["Escort girl disponible ce soir", "escort girl"],
      ["massage naturiste à domicile", "naturiste"],
      ["Massage TANTRIQUE", "tantrique"],
      ["body-body possible", "body-body"],
      ["Happy ending en option", "happy ending"],
      ["Massage sensuel et relaxant", "massage sensuel"],
      ["Rapports tarifés", "relation tarifée"],
      ["services sexuels", "acte sexuel"],
      ["Érotique", "érotique"],
    ]) expect(motsSuspects(t), t).toContain(attendu);
  });
  it("ne crie pas sur le vocabulaire des métiers : libellés, compétences, titres, notes", () => {
    const textes = [
      ...Object.values(METIERS).flat(),
      ...Object.values(COMPETENCES_PAR_METIER).flat(),
      ...Object.values(QUALIFICATIONS_OBLIGATOIRES).flatMap(q => [q.titre, q.detail, q.texte]),
      ...Object.values(NOTES_METIERS).map(n => n.texte),
      "Massage relaxant aux huiles, soin du visage, épilation",
      "Rapport de fin de chantier, finitions soignées",
      "Body scrub et gommage", "Je suis disponible pour un extra en salle ce soir",
      // Relecture du 03/11/2026 : le vocabulaire ordinaire de la sécurité et du spa.
      "Agent d'escorte, escorte de fonds et protection rapprochée", "Escortes de convois exceptionnels",
      "Parfum sensuel et bougies pour le spa",
    ];
    const crient = textes.filter(t => motsSuspects(t).length);
    expect(crient).toEqual([]);
  });
});

describe("le balayage quotidien", () => {
  it("relit la présentation des prestataires, leur CV et les demandes", () => {
    const r = contenusSuspects({
      comptes: [{ id: "p1", user_metadata: { role: "prestataire", bio: "Massage naturiste" } },
        { id: "c1", user_metadata: { role: "client", bio: "naturiste" } }],
      profils: [{ id: "p2", cv: [{ poste: "Escort", description: "" }] }],
      missions: [{ client_id: "c2", titre: "Massage", description: "avec happy ending" }],
    });
    expect(r.map(x => [x.userId, x.origine])).toEqual([
      ["p1", "Présentation du prestataire"], ["p2", "CV du prestataire"], ["c2", "Description d'une demande"]]);
  });
});

describe("le ticket au back-office", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  const ctx = { supabaseUrl: "https://b.test", headers: { apikey: "k" }, userId: "11111111-aaaa", origine: "Message", texte: "escort ce soir", mots: ["escort"] };

  it("un seul ticket par contenu, rien de bloqué", async () => {
    const appels = [];
    vi.stubGlobal("fetch", vi.fn(async (u, o = {}) => { appels.push({ u: String(u), m: o.method || "GET", corps: o.body });
      return new Response(o.method === "POST" ? null : "[]", { status: o.method === "POST" ? 201 : 200 }); }));
    expect(await signalerAuBackOffice(ctx)).toBe("cree");
    const post = appels.find(a => a.m === "POST");
    const corps = JSON.parse(post.corps);
    expect(corps.subject).toBe(`[Modération] Message — compte 11111111-aaaa — ${empreinte("escort ce soir")}`);
    // Le compte concerné n'est pas l'auteur : rattaché à lui, « Répondre » lui
    // écrivait, et la suppression de son compte effaçait la trace.
    expect(corps.user_id).toBeNull();
    expect(corps.message).toContain("Compte concerné : 11111111-aaaa");
    vi.stubGlobal("fetch", vi.fn(async () => new Response('[{"id":1}]', { status: 200 })));
    expect(await signalerAuBackOffice(ctx)).toBe("deja");
  });
  it("un échec ne lève jamais : il est journalisé", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    expect(await signalerAuBackOffice(ctx)).toBe("echec");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("SIGNALEMENT NON CRÉÉ"), expect.any(String));
  });
});

describe("branchements", () => {
  const missions = readFileSync(new URL("../../../api/missions.js", import.meta.url), "utf8");
  const cron = readFileSync(new URL("../../../api/cron-reset-monthly.js", import.meta.url), "utf8");
  const ecrans = readFileSync(new URL("../../components/client-screens.jsx", import.meta.url), "utf8");
  it("chaque message envoyé est relu, après son enregistrement", () => {
    const bloc = missions.slice(missions.indexOf('if (action === "envoyer_message")'));
    expect(bloc.indexOf("motsSuspects(texte)")).toBeGreaterThan(bloc.indexOf("lignesMsg.length === 0"));
  });
  it("le balayage tourne chaque jour, APRÈS la surveillance des documents", () => {
    const bloc = cron.slice(cron.indexOf('if (queryAction === "documents")'));
    expect(bloc.indexOf("contenusSuspects(")).toBeGreaterThan(bloc.indexOf("derniere_surveillance_documents"));
    expect(bloc.indexOf("contenusSuspects(")).toBeLessThan(bloc.indexOf("return res.status(200).json({ success: true, datees"));
  });
  it("un bouton Signaler sur la fiche du prestataire et dans la messagerie", () => {
    expect(ecrans.match(/<BoutonSignaler /g)).toHaveLength(2);
  });
});
