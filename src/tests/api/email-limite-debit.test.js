// Limite de débit de Resend (relecture du 29/10/2026) : un 429 est passager,
// retenté comme une panne ; seul un refus durable rend `false` d'emblée.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { sendEmail } from "../../../api/_email.js";

beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", "re_x");
  vi.stubEnv("RESEND_FROM", "ALANE <no-reply@alane.fr>");
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.useFakeTimers({ toFake: ["setTimeout"] });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

async function envoyer(statuts) {
  const f = vi.fn(async () => new Response("{}", { status: statuts.shift() ?? 200 }));
  vi.stubGlobal("fetch", f);
  const p = sendEmail({ to: "a@exemple.fr", subject: "s", html: "h" });
  await vi.runAllTimersAsync();
  return { resultat: await p, essais: f.mock.calls.length };
}

describe("sendEmail et la limite de débit", () => {
  it("429 puis accepté : retenté, envoyé", async () => {
    expect(await envoyer([429, 200])).toEqual({ resultat: true, essais: 2 });
  });
  it("429 qui persiste : panne (`undefined`), pas refus durable", async () => {
    expect(await envoyer([429, 429])).toEqual({ resultat: undefined, essais: 2 });
  });
  it("refus durable (422) : `false`, sans second essai", async () => {
    expect(await envoyer([422])).toEqual({ resultat: false, essais: 1 });
  });
});
