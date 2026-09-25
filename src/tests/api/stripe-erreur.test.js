// Ce qu'un utilisateur lit quand Stripe refuse : jamais le message brut.
import { describe, it, expect, vi } from "vitest";
import { messageErreurStripe } from "../../../api/_stripe_erreur.js";

describe("messageErreurStripe", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});

  it("ne laisse jamais filer la clé secrète, même partiellement", () => {
    const m = messageErreurStripe({ type: "invalid_request_error", message: "Invalid API Key provided: sk_test_****KGVj" }, "test");
    expect(m).not.toMatch(/sk_|KGVj|Invalid/);
  });

  it("une clé refusée est annoncée comme une indisponibilité, en français", () => {
    const m = messageErreurStripe({ type: "authentication_error", message: "Invalid API Key provided" }, "test");
    expect(m).toMatch(/momentanément indisponible/);
  });

  it("une carte refusée le dit", () => {
    expect(messageErreurStripe({ type: "card_error", code: "card_declined" }, "test")).toMatch(/carte a été refusée/);
  });

  it("n'affirme jamais que rien n'a été prélevé", () => {
    for (const type of ["authentication_error", "card_error", "api_error", "invalid_request_error", undefined]) {
      expect(messageErreurStripe({ type }, "test")).not.toMatch(/Aucune somme/);
    }
  });

  it("journalise le message complet", () => {
    const journal = vi.spyOn(console, "error").mockImplementation(() => {});
    messageErreurStripe({ type: "invalid_request_error", message: "détail technique" }, "contexte-x");
    expect(journal.mock.calls.flat().join(" ")).toMatch(/contexte-x.*détail technique|détail technique/);
  });
});
