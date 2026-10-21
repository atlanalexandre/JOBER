// Messagerie : le destinataire est prévenu par le serveur, depuis le message
// enregistré, et les e-mails et SMS sont plafonnés (décision D5 d'Alexandre,
// 14/10/2026 — `e2e/92` sur la recette).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { alerteExterieureDue, nomExpediteur, texteSmsMessage, DELAI_RAFALE_MS, DELAI_NON_LU_MS } from "../../../api/_messagerie.js";

const T = Date.parse("2026-10-14T12:00:00Z");
const il = (ms) => new Date(T - ms).toISOString();

describe("alerteExterieureDue — le plafond des e-mails et SMS", () => {
  it("premier message de la conversation : alerte", () => {
    expect(alerteExterieureDue(null, T)).toBe(true);
  });
  it("le précédent attend d'être lu : pas de seconde alerte", () => {
    expect(alerteExterieureDue({ created_at: il(2 * 3600e3), lu_at: null }, T)).toBe(false);
  });
  it("lu, mais il y a moins d'une demi-heure : même rafale, pas d'alerte", () => {
    expect(alerteExterieureDue({ created_at: il(DELAI_RAFALE_MS - 60e3), lu_at: il(60e3) }, T)).toBe(false);
  });
  it("lu, et il y a plus d'une demi-heure : alerte", () => {
    expect(alerteExterieureDue({ created_at: il(DELAI_RAFALE_MS + 60e3), lu_at: il(60e3) }, T)).toBe(true);
  });
  it("non lu depuis plus d'un jour : un rappel", () => {
    expect(alerteExterieureDue({ created_at: il(DELAI_NON_LU_MS + 60e3), lu_at: null }, T)).toBe(true);
  });
  it("date illisible : prudence, pas d'alerte", () => {
    expect(alerteExterieureDue({ created_at: "n'importe quoi", lu_at: null }, T)).toBe(false);
  });
  it("vingt messages à la minute, aucun lu : un seul e-mail et un seul SMS", () => {
    let precedent = null, alertes = 0;
    for (let i = 0; i < 20; i++) {
      const maintenant = T + i * 60e3;
      if (alerteExterieureDue(precedent, maintenant)) alertes++;
      precedent = { created_at: new Date(maintenant).toISOString(), lu_at: null };
    }
    expect(alertes).toBe(1);
  });
});

// Relecture du 15/10/2026 : la règle ne regardait que le message précédent, et tenait un
// message non lu pour « déjà signalé ». Or il avait pu être retenu par la demi-heure.
describe("alerteExterieureDue — rejouée sur les messages des dernières 24 h", () => {
  const iso = (ms) => new Date(ms).toISOString();
  const MIN = 60e3;

  it("message lu, puis deux autres à 10 min et à 1 h : le troisième est signalé", () => {
    const m1 = { created_at: iso(T), lu_at: iso(T + 5 * MIN) };
    const m2 = { created_at: iso(T + 10 * MIN), lu_at: null };
    expect(alerteExterieureDue([], T), "premier message").toBe(true);
    expect(alerteExterieureDue([m1], T + 10 * MIN), "dix minutes après : même rafale").toBe(false);
    expect(alerteExterieureDue([m1, m2], T + 60 * MIN), "une heure après, le destinataire a lu depuis l'alerte").toBe(true);
    // Avec le seul message précédent — ce que recevait la règle —, rien ne permettait de
    // savoir que m2 n'avait pas été signalé : le destinataire restait 24 h sans e-mail ni SMS.
    expect(alerteExterieureDue(m2, T + 60 * MIN)).toBe(false);
  });

  it("conversation suivie, puis destinataire parti : prévenu au premier message après une demi-heure de silence", () => {
    // Messages à 0, 10, 20 min, chacun lu 2 min après ; puis plus aucune lecture
    // (messages à 30, 40, 70 et 80 min).
    const lus = new Set([0, 10, 20]);
    const historique = [];
    const alertes = [];
    for (const minute of [0, 10, 20, 30, 40, 70, 80]) {
      const t = T + minute * MIN;
      if (alerteExterieureDue(historique, t)) alertes.push(minute);
      historique.push({ created_at: iso(t), lu_at: lus.has(minute) ? iso(t + 2 * MIN) : null });
    }
    // Pendant la rafale : une alerte, la première. À 70 min — trente minutes après le
    // message précédent, et le destinataire a lu depuis la première alerte : prévenu,
    // une seule fois (à 80 min, il n'a rien lu depuis).
    expect(alertes).toEqual([0, 70]);
  });

  it("vingt messages à la minute, aucun lu : un seul e-mail et un seul SMS", () => {
    const historique = [];
    let alertes = 0;
    for (let i = 0; i < 20; i++) {
      const t = T + i * MIN;
      if (alerteExterieureDue(historique, t)) alertes++;
      historique.push({ created_at: iso(t), lu_at: null });
    }
    expect(alertes).toBe(1);
  });

  it("rien lu depuis l'alerte : un rappel le lendemain, pas le jour même", () => {
    // T = 14h à Paris. 23 h 59 le même jour : rien ; 0 h 30 le lendemain : un rappel.
    const h = [{ created_at: iso(T), lu_at: null }];
    expect(alerteExterieureDue(h, Date.parse("2026-10-14T21:59:00Z"))).toBe(false);
    expect(alerteExterieureDue(h, Date.parse("2026-10-14T22:30:00Z"))).toBe(true);
  });

  it("un message par heure pendant deux jours, jamais lu : un rappel chaque jour (relecture du 16/10/2026)", () => {
    // L'historique lu ne remonte qu'à 24 h, et le rejeu prend son premier message pour
    // une alerte : le rappel « 24 h après » ne partait donc plus jamais.
    const tous = [];
    const alertes = [];
    for (let h = 0; h < 48; h++) {
      const t = T + h * 3600e3;
      const fenetre = tous.filter((m) => Date.parse(m.created_at) >= t - DELAI_NON_LU_MS);
      if (alerteExterieureDue(fenetre, t)) alertes.push(new Date(t).toISOString());
      tous.push({ created_at: iso(t), lu_at: null });
    }
    // La première alerte, puis une au premier message de chaque nouvelle journée (heure de Paris).
    expect(alertes).toEqual(["2026-10-14T12:00:00.000Z", "2026-10-14T22:00:00.000Z", "2026-10-15T22:00:00.000Z"]);
  });

  it("une date illisible dans l'historique : prudence, pas d'alerte", () => {
    expect(alerteExterieureDue([{ created_at: "n'importe quoi" }], T)).toBe(false);
  });
  // Relecture du 20/10/2026 : la règle du jour se compare à la dernière alerte, hors rafale.
  const rejouer = (heuresIso) => {
    const tous = [], alertes = [];
    for (const h of heuresIso) {
      const t = Date.parse(h);
      const fenetre = tous.filter((m) => Date.parse(m.created_at) >= t - DELAI_NON_LU_MS);
      if (alerteExterieureDue(fenetre, t)) alertes.push(h);
      tous.push({ created_at: iso(t), lu_at: null });
    }
    return alertes;
  };

  it("premier message du jour trop proche de l'alerte de la veille : le rappel part au suivant", () => {
    // Alerte à 23 h 50 (Paris), puis 0 h 05, 9 h, 15 h, jamais lus.
    const alertes = rejouer(["2026-10-14T21:50:00Z", "2026-10-14T22:05:00Z", "2026-10-15T07:00:00Z", "2026-10-15T13:00:00Z"]);
    expect(alertes).toEqual(["2026-10-14T21:50:00Z", "2026-10-15T07:00:00Z"]);
  });

  it("une rafale qui passe minuit ne donne qu'une alerte", () => {
    // Un message toutes les dix minutes de 23 h 30 à 0 h 30 (Paris), jamais lus.
    const heures = [];
    for (let m = 0; m <= 60; m += 10) heures.push(new Date(Date.parse("2026-10-14T21:30:00Z") + m * 60e3).toISOString());
    expect(rejouer(heures)).toEqual(["2026-10-14T21:30:00.000Z"]);
  });
});

describe("nomExpediteur — lu dans le profil, réduit à des lettres", () => {
  it("prénom et initiale du nom", () => {
    expect(nomExpediteur({ prenom: "Marie", nom: "durand" }, "client")).toBe("Marie D.");
    expect(nomExpediteur({ prenom: "Jean-Luc", nom: "D'Arc" }, "client")).toBe("Jean-Luc D.");
  });
  it("ni lien ni numéro de téléphone, 30 caractères au plus", () => {
    const n = nomExpediteur({ prenom: "Appelez le 0899000000 ou www.arnaque.fr", nom: "" }, "client");
    expect(n).not.toMatch(/\d/);
    expect(n).not.toMatch(/\./);
    expect(n.length).toBeLessThanOrEqual(30);
  });
  it("profil vide ou illisible : un nom générique", () => {
    expect(nomExpediteur(null, "client")).toBe("votre client");
    expect(nomExpediteur({}, "prestataire")).toBe("votre prestataire");
  });
});

describe("le SMS ne porte aucun texte de l'expéditeur", () => {
  it("le nom, et rien d'autre de sa main", () => {
    expect(texteSmsMessage("Marie D.")).toBe(
      "ALANE - Nouveau message de Marie D. dans votre messagerie. Ouvrez l'application pour le lire. alane.fr");
  });
});

describe("les anciens envois au texte libre sont fermés", () => {
  const src = readFileSync(new URL("../../../api/missions.js", import.meta.url), "utf8");
  const bloc = (a) => {
    const i = src.indexOf(`if (action === "${a}")`);
    return i < 0 ? "" : src.slice(i, src.indexOf('\n    if (action === "', i + 10));
  };
  it.each(["chat_notify", "notify_client"])("%s n'envoie plus rien", (a) => {
    const b = bloc(a);
    expect(b.length).toBeGreaterThan(0);
    expect(b).not.toMatch(/api\.brevo\.com|api\.resend\.com|notifier\(|sendEmail\(/);
  });
  it("envoyer_message prévient depuis le message enregistré, avec le plafond", () => {
    const b = bloc("envoyer_message");
    expect(b).toMatch(/alerteExterieureDue\(precedents,/);
    // L'historique des dernières 24 h, du plus ancien au plus récent — pas le seul précédent.
    expect(b).toMatch(/&created_at=gte\./);
    expect(b).toMatch(/&limit=\$\{HISTORIQUE_MAX\}&order=created_at\.asc/);
    expect(b).not.toMatch(/order=created_at\.desc&limit=1/);
    // L'e-mail et le SMS partent ensemble.
    expect(b).toMatch(/await Promise\.all\(envois\)/);
    expect(b).toMatch(/texteSmsMessage\(nom\)/);
    expect(b).toMatch(/nomExpediteur\(/);
    expect(b).not.toMatch(/sender_name|message_preview/);
  });
  it("l'écran n'appelle plus chat_notify", () => {
    const ecran = readFileSync(new URL("../../components/client-screens.jsx", import.meta.url), "utf8");
    expect(ecran).not.toMatch(/action: "chat_notify"/);
  });
});
