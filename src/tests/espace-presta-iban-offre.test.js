// Espace prestataire (étude d'octobre 2026, constaté en recette sur petit iPhone) :
//   - « IBAN / RIB manquant — ajoutez votre IBAN avant d'accepter une prestation »
//     s'affichait à tout prestataire en règle : l'écran lisait l'IBAN dans
//     user_metadata, où il n'est plus rangé depuis le 24/09/2026 (profiles.rib) ;
//   - l'offre de lancement s'affichait avec « 0 place restante sur 100 » : la
//     réponse du serveur était réécrite par une lecture directe de `launch_phase`.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const presta = readFileSync(new URL("../components/presta-screens.jsx", import.meta.url), "utf8");
const client = readFileSync(new URL("../components/client-screens.jsx", import.meta.url), "utf8");

describe("l'IBAN du prestataire", () => {
  it("se lit dans profiles.rib, jamais dans user_metadata", () => {
    expect(presta).not.toMatch(/user_metadata\?\.rib/);
    expect(presta).not.toMatch(/!!m\.rib/);
    expect(presta).toMatch(/select\("mandat_facturation_at,mandat_encaissement_at,rib"\)/);
  });
});

describe("l'offre de lancement", () => {
  it("n'est décidée que par le serveur, sur les écrans qui l'annoncent", () => {
    expect(presta).not.toMatch(/eq\("key",\s*"launch_phase"\)/);
    // Écran d'abonnement et « Comment ça marche ? » : la réponse du serveur, jamais le réglage seul.
    expect(client).not.toMatch(/setLaunchActive\(Boolean/);
    expect(client).toMatch(/fetchOffreLancement\(\)\.then\(o => setLaunchActive\(o\.ouverte\)\)/);
    expect(client).toMatch(/launchPhase: o\.ouverte === true/);
    expect(client).not.toMatch(/100\/100 — offre terminée/);
  });
  it("« Comment ça marche ? » ne promet pas un débit différé qui n'existe pas", () => {
    expect(client).not.toMatch(/Aucun débit définitif avant/);
  });
  it("n'est pas annoncée avant sa réponse", () => {
    expect(presta).not.toMatch(/useState\(isLaunchPhase\(\)\)/);
    expect(client).not.toMatch(/\[launchActive,setLaunchActive\]=useState\(isLaunchPhase\(\)\)/);
    expect(client).not.toMatch(/setLaunchPhaseHome\] = useState\(isLaunchPhase\(\)\)/);
  });
  it("dit les deux temps de la règle sur l'écran d'abonnement", () => {
    expect(client).not.toMatch(/8 prestations\/mois gratuites/);
    expect(client).toMatch(/le mois de votre première prestation acceptée/);
  });
});
