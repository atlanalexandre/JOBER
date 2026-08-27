import { describe, it, expect } from "vitest";
import { euros } from "../../../api/_email.js";

// Les mails et le back-office affichaient « 20.2 € » : le nombre brut de la
// base, avec un point et sans les centimes. En France on écrit « 20,20 € ».
describe("euros()", () => {
  it("met une virgule et toujours deux décimales", () => {
    expect(euros(20.2)).toBe("20,20 €");
    expect(euros(19.9)).toBe("19,90 €");
    expect(euros(26)).toBe("26,00 €");
  });

  it("ne casse pas sur une valeur absente", () => {
    expect(euros(null)).toBe("0,00 €");
    expect(euros(undefined)).toBe("0,00 €");
    expect(euros("")).toBe("0,00 €");
  });

  it("accepte une chaîne, comme PostgREST la renvoie", () => {
    expect(euros("14.14")).toBe("14,14 €");
  });
});
