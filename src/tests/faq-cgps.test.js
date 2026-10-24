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
  it("les quotas annoncés viennent de la liste des formules, pas d'un chiffre recopié", () => {
    expect(ABONNEMENTS_PRESTA.map(p => p.id)).toEqual(["free", "premium", "elite"]);
    expect(faq).toMatch(/const quota = Object\.fromEntries\(ABONNEMENTS_PRESTA\.map\(p => \[p\.id, limites\?\.\[p\.id\] \?\? p\.missions\]\)\)/);
    expect(faq).toMatch(/\.eq\("key", "plan_limits"\)/);
    expect(faq).toContain("${quota.free} jours de prestation par mois en Gratuit, ${quota.premium} en Premium");
    expect(faq).toContain("ont ${quota.premium} jours au lieu de ${quota.free}");
  });
  it("l'offre de lancement ne s'annonce que si le serveur la dit ouverte (relecture du 23/10/2026)", () => {
    expect(faq).toMatch(/fetchOffreLancement\(\)\.then\(o => setOffreOuverte\(o\.ouverte === true\)\)/);
    expect(faq).toMatch(/\$\{offreOuverte \? `\\n\\nOffre de lancement/);
  });
  it("les taux de cashback viennent des paliers", () => {
    expect(faq).toContain("de ${taux[0]} à ${taux[taux.length - 1]} du montant");
    expect(faq).not.toMatch(/0,5 % à 1,5 %/);
  });
  it("l'offre de lancement et la montée en gamme sont décrites comme dans les CGPS (relecture du 22/10/2026)", () => {
    expect(faq).toMatch(/100 premiers prestataires dont l'accès aux prestations a été ouvert/);
    expect(faq).toMatch(/au prorata des jours restants de la période en cours/);
    expect(faq).not.toMatch(/jours restants du mois\./);
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
  it("le classement par formule et la conservation de 3 ans sont écrits", () => {
    expect(article("Article 11")).toMatch(/les membres Elite apparaissent en premier, puis les membres Premium/);
    expect(article("Article 14")).toMatch(/pendant 3 ans à compter de la suppression ou de la résiliation du compte/);
  });
  it("le paiement a lieu à la commande, avant l'acceptation", () => {
    expect(article("Article 5 —")).toMatch(/règle la Prestation au moment de sa commande/);
    expect(article("Article 5 —")).not.toMatch(/Dès l'acceptation d'une proposition, le Client procède au paiement/);
  });
});

describe("un seul délai d'arrivée du virement : celui des CGPS (art. 7.2)", () => {
  it.each(["src/components/presta-screens.jsx", "src/components/client-screens.jsx", "api/cron-reset-monthly.js", "api/missions.js"])("%s", (f) => {
    const t = readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");
    expect(t).not.toMatch(/sous 1 à 2 jours ouvrés/);
  });
  it("la montée en gamme se dit au prorata de la période, à l'écran comme dans la réponse du serveur", () => {
    expect(readFileSync(new URL("../../api/stripe-subscription.js", import.meta.url), "utf8")).not.toMatch(/jours restants du mois/);
    expect(ecran).not.toMatch(/jours restants du mois/);
  });
});
