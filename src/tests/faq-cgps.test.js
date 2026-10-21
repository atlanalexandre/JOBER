// FAQ et CGPS alignées (relecture du 21/10/2026). La FAQ promettait encore une
// carte « débitée qu'après validation » (elle l'est à la réservation), un prix
// « sans frais » (les frais de service s'ajoutent), une « confirmation
// immédiate » (le prestataire doit accepter) et un changement de formule
// « immédiat » (seule la montée l'est). Les CGPS ne décrivaient pas les
// abonnements, que trois de leurs articles citaient pourtant.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { CGPS } from "../constants/cgps.js";
import { ABONNEMENTS_PRESTA } from "../constants/plans.js";

const ecran = readFileSync(new URL("../components/client-screens.jsx", import.meta.url), "utf8");
const faq = ecran.slice(ecran.indexOf("export function FAQScreen"), ecran.indexOf("  return (", ecran.indexOf("export function FAQScreen")));
const article = (debut) => CGPS.sections.find(a => a.title.startsWith(debut))?.text || "";

describe("la FAQ ne promet rien que les CGPS démentent", () => {
  it.each([
    [/débitée qu'après validation/, "paiement à la réservation (art. 5.3)"],
    [/sans frais cachés ni commission/, "frais de service (art. 6.2)"],
    [/confirmation immédiate/, "le prestataire doit accepter"],
    [/le changement est immédiat/, "seule la montée en gamme l'est (art. 6B.3)"],
    [/24h ouvrées/, "délai de réponse jamais décidé"],
    [/abonnement Premium, vous recevez/, "tout abonnement payant compte (art. 6B.3)"],
  ])("%s", (motif) => {
    expect(faq).not.toMatch(motif);
  });
  it("les quotas annoncés sont ceux des formules", () => {
    const q = Object.fromEntries(ABONNEMENTS_PRESTA.map(p => [p.id, p.missions]));
    expect(faq).toContain(`${q.free} jours de prestation par mois en Gratuit, ${q.premium} en Premium`);
  });
});

describe("les CGPS décrivent les abonnements qu'elles citent", () => {
  const texte = CGPS.sections.map(a => a.text).join("\n");
  it("l'article 6B existe, avec le 6B.4 cité aux articles 14.4 et 16.3", () => {
    expect(texte).toMatch(/article 6B\.4/);
    expect(article("Article 6B")).toMatch(/6B\.4 Comptes recréés/);
  });
  it("les prix de l'article 6B sont ceux des formules", () => {
    for (const p of ABONNEMENTS_PRESTA.filter(x => x.price > 0)) {
      expect(article("Article 6B")).toContain(`${p.label} : ${p.price.toFixed(2).replace(".", ",")} € par mois`);
    }
  });
  it("le paiement a lieu à la commande, avant l'acceptation", () => {
    expect(article("Article 5 —")).toMatch(/règle la Prestation au moment de sa commande/);
    expect(article("Article 5 —")).not.toMatch(/Dès l'acceptation d'une proposition, le Client procède au paiement/);
  });
});
