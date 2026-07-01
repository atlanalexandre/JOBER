function validateIBAN(iban) {
  const clean = iban.replace(/[\s-]/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(clean))
    return { valid: false, error: "Format invalide (ex: FR76 3000...)" };
  if (clean.length < 15 || clean.length > 34)
    return { valid: false, error: "Longueur invalide" };

  const rearranged = clean.slice(4) + clean.slice(0, 4);
  const numStr = rearranged.split("").map(c => {
    const code = c.charCodeAt(0);
    return code >= 65 ? (code - 55).toString() : c;
  }).join("");

  let remainder = 0;
  for (const char of numStr) {
    remainder = (remainder * 10 + parseInt(char)) % 97;
  }
  return remainder === 1
    ? { valid: true }
    : { valid: false, error: "Clé de contrôle invalide" };
}

function validateSIRET(siret) {
  const clean = siret.replace(/[\s-.]/g, "");
  if (!/^\d{9}$/.test(clean) && !/^\d{14}$/.test(clean))
    return { valid: false, error: "Doit contenir 9 (SIREN) ou 14 chiffres (SIRET)" };

  // Luhn check (SIRET 14 digits)
  if (clean.length === 14) {
    let sum = 0;
    for (let i = 0; i < 14; i++) {
      let d = parseInt(clean[i]);
      if ((14 - i) % 2 === 0) { d *= 2; if (d > 9) d -= 9; }
      sum += d;
    }
    if (sum % 10 !== 0) return { valid: false, error: "Numéro invalide (échec contrôle Luhn)" };
  }
  return { valid: true, clean };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { iban, siret } = req.body;
  const result = {};

  // Validate IBAN
  if (iban) {
    const ibanResult = validateIBAN(iban);
    result.iban = ibanResult;
  }

  // Validate SIRET + check existence via API entreprises
  if (siret) {
    const siretResult = validateSIRET(siret);
    result.siret = siretResult;

    if (siretResult.valid) {
      try {
        const apiRes = await fetch(
          `https://recherche-entreprises.api.gouv.fr/search?q=${siretResult.clean || siret.replace(/[\s-.]/g,"")}&page=1&per_page=1`,
          { headers: { "Accept": "application/json" } }
        );
        const apiData = await apiRes.json();
        if (apiData.results?.length > 0) {
          const company = apiData.results[0];
          result.siret.exists   = true;
          result.siret.nom      = company.nom_complet || "";
          result.siret.actif    = company.etat_administratif === "A";
          result.siret.statut   = company.etat_administratif === "A" ? "Société active" : "Société fermée/radiée";
          result.siret.siege    = company.siege?.commune || "";
        } else {
          result.siret.exists = false;
          result.siret.error  = "Numéro non trouvé dans la base SIRENE";
        }
      } catch (e) {
        result.siret.apiError = "Impossible de vérifier via SIRENE (réseau)";
      }
    }
  }

  return res.status(200).json(result);
}
