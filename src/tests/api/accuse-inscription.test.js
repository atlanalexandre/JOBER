import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { envoyerAccuseInscription, htmlAccuseInscription } from "../../../api/_accuse_inscription.js";

// Accusé de réception de l'inscription (29/09/2026) : envoyé par le serveur,
// une seule fois, jamais marqué « envoyé » s'il n'est pas parti.

const SB = "https://base.test";
const H = { apikey: "k", Authorization: "Bearer k" };

function simuler({ prise = [{ id: "p1" }], resend = 200 } = {}) {
  const appels = [];
  vi.stubGlobal("fetch", vi.fn(async (url, opts = {}) => {
    appels.push({ url: String(url), method: opts.method, body: opts.body });
    if (String(url).includes("api.resend.com")) return new Response("{}", { status: resend });
    if (String(url).includes("accuse_inscription_at=is.null")) return new Response(JSON.stringify(prise), { status: 200 });
    return new Response(null, { status: 204 });
  }));
  return appels;
}

beforeEach(() => { process.env.RESEND_API_KEY = "re_test"; process.env.RESEND_FROM = "ALANE <no-reply@alane.fr>"; });
afterEach(() => { vi.unstubAllGlobals(); });

describe("envoyerAccuseInscription()", () => {
  it("prend, puis envoie : une fois", async () => {
    const appels = simuler();
    expect(await envoyerAccuseInscription("p1", "a@b.fr", SB, H)).toBe("envoye");
    expect(appels[0].url).toContain("role=eq.prestataire&status=eq.pending&accuse_inscription_at=is.null");
    expect(appels.filter(a => a.url.includes("resend")).length).toBe(1);
  });

  it("n'envoie rien si déjà envoyé, validé entre-temps ou pas un prestataire", async () => {
    const appels = simuler({ prise: [] });
    expect(await envoyerAccuseInscription("p1", "a@b.fr", SB, H)).toBe("deja");
    expect(appels.some(a => a.url.includes("resend"))).toBe(false);
  });

  it("rend la prise si l'envoi est refusé : le passage suivant réessaie", async () => {
    const appels = simuler({ resend: 422 });
    expect(await envoyerAccuseInscription("p1", "a@b.fr", SB, H)).toBe("echec");
    const rendu = appels.at(-1);
    expect(rendu.url).toContain("accuse_inscription_at=eq.");
    expect(JSON.parse(rendu.body)).toEqual({ accuse_inscription_at: null });
  });
});

describe("le texte et son câblage", () => {
  it("reprend le courriel d'Alexandre", () => {
    const html = htmlAccuseInscription();
    expect(html).toContain("Nous vous confirmons la bonne réception de votre demande d'inscription.");
    expect(html).toContain("dès la mise en route d'Alane");
    expect(html).toContain("La direction");
  });

  it("l'inscription écrit à l'adresse du COMPTE, jamais à celle envoyée par le navigateur", () => {
    const src = readFileSync(new URL("../../../api/support.js", import.meta.url), "utf8");
    expect(src).toContain("envoyerAccuseInscription(_welcomeCaller.id, _welcomeCaller.email");
  });

  it("le traitement automatique le rattrape", () => {
    const src = readFileSync(new URL("../../../api/cron-reset-monthly.js", import.meta.url), "utf8");
    expect(src).toContain("accuse_inscription_at=is.null");
    expect(src).toContain("envoyerAccuseInscription(id, ud.email");
  });
});
