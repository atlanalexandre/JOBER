import { describe, it, expect } from "vitest";

// Algorithme MOD-97 extrait de App.jsx (identique)
function checkIban(iban) {
  const s = (iban || "").replace(/\s/g, "").toUpperCase();
  if (s.length < 15) return null;
  const rearranged = s.slice(4) + s.slice(0, 4);
  const n = rearranged.split("").map(c => {
    const code = c.charCodeAt(0);
    return code >= 65 ? String(code - 55) : c;
  }).join("");
  let rem = 0;
  for (const c of n) rem = (rem * 10 + parseInt(c)) % 97;
  return rem === 1;
}

describe("Validation IBAN (MOD-97)", () => {
  it("IBAN français valide", () => {
    expect(checkIban("FR7630006000011234567890189")).toBe(true);
  });
  it("IBAN allemand valide", () => {
    expect(checkIban("DE89370400440532013000")).toBe(true);
  });
  it("IBAN invalide (chiffre modifié)", () => {
    expect(checkIban("FR7630006000011234567890180")).toBe(false);
  });
  it("IBAN trop court → null", () => {
    expect(checkIban("FR76")).toBeNull();
  });
  it("chaîne vide → null", () => {
    expect(checkIban("")).toBeNull();
  });
  it("null → null", () => {
    expect(checkIban(null)).toBeNull();
  });
  it("espaces ignorés (format affiché)", () => {
    expect(checkIban("FR76 3000 6000 0112 3456 7890 189")).toBe(true);
  });
});
