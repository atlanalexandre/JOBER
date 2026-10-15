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
    expect(b).toMatch(/alerteExterieureDue\(/);
    expect(b).toMatch(/texteSmsMessage\(nom\)/);
    expect(b).toMatch(/nomExpediteur\(/);
    expect(b).not.toMatch(/sender_name|message_preview/);
  });
  it("l'écran n'appelle plus chat_notify", () => {
    const ecran = readFileSync(new URL("../../components/client-screens.jsx", import.meta.url), "utf8");
    expect(ecran).not.toMatch(/action: "chat_notify"/);
  });
});
