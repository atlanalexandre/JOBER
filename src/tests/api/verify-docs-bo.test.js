// /api/verify-docs : réservé au back-office (étude du 13/10/2026).
import { describe, it, expect, vi, afterEach } from "vitest";
import crypto from "node:crypto";
import handler from "../../../api/verify-docs.js";
import { sessionBOValide } from "../../../api/_session_bo.js";

const SECRET = "secret-de-test";
const jeton = (ts = Math.floor(Date.now() / 1000), nonce = "0123456789abcdef") =>
  `${ts}.${nonce}.${crypto.createHmac("sha256", SECRET).update(`${ts}.${nonce}`).digest("hex")}`;
const reponse = () => { const r = { statut: 0, corps: null }; r.status = (s) => { r.statut = s; return r; }; r.json = (c) => { r.corps = c; return r; }; return r; };

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("verify-docs", () => {
  it("refuse un appel sans session du back-office", async () => {
    vi.stubEnv("BO_SESSION_SECRET", SECRET);
    const f = vi.fn(); vi.stubGlobal("fetch", f);
    const r = reponse();
    await handler({ method: "POST", headers: {}, body: { siret: "73282932000074" } }, r);
    expect(r.statut).toBe(401);
    expect(f, "SIRENE n'est pas interrogé").not.toHaveBeenCalled();
  });
  it("répond au back-office", async () => {
    vi.stubEnv("BO_SESSION_SECRET", SECRET);
    const r = reponse();
    await handler({ method: "POST", headers: { authorization: `Bearer ${jeton()}` }, body: { iban: "FR7630006000011234567890189" } }, r);
    expect(r.statut).toBe(200);
    expect(r.corps.iban.valid).toBe(true);
  });
});

describe("sessionBOValide", () => {
  it("refuse l'ancien format à deux parties, une signature fausse, une session expirée", () => {
    vi.stubEnv("BO_SESSION_SECRET", SECRET);
    const ts = Math.floor(Date.now() / 1000);
    const deux = `${ts}.${crypto.createHmac("sha256", SECRET).update(String(ts)).digest("hex")}`;
    expect(sessionBOValide(`Bearer ${deux}`)).toBe(false);
    const bon = jeton();
    const faux = bon.slice(0, -1) + (bon.endsWith("0") ? "1" : "0");
    expect(sessionBOValide(`Bearer ${faux}`)).toBe(false);
    expect(sessionBOValide(`Bearer ${jeton(ts - 90000)}`)).toBe(false);
    expect(sessionBOValide(`Bearer ${jeton()}`)).toBe(true);
  });
});
