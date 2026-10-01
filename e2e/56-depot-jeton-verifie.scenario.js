// `/api/upload-document` (fonction en sursis) : jeton vérifié, type de pièce borné
// (audit « sécurité », 01/10/2026).
//
// Le jeton était DÉCODÉ sans que sa signature soit vérifiée : n'importe qui pouvait en
// fabriquer un au nom d'un prestataire, obtenir une adresse d'envoi vers ses pièces et
// les remplacer, et remettre ses documents « non vérifiés ». Le type de pièce n'était
// pas borné non plus (`../autre/cni`).
import { test, expect, request } from "@playwright/test";
import { sql, BYPASS, RECETTE_URL } from "./outils.js";
import { prestataireOperationnel } from "./fabrique.js";

test.describe.configure({ timeout: 200_000 });

function jetonFabrique(sub) {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b({ alg: "HS256", typ: "JWT" })}.${b({ sub, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })}.signature-inventee`;
}

async function appeler(jeton, corps) {
  const c = await request.newContext();
  const r = await c.post(`${RECETTE_URL}/api/upload-document`, {
    headers: { "x-vercel-protection-bypass": BYPASS, Authorization: `Bearer ${jeton}` },
    data: corps,
  });
  return { statut: r.status(), texte: await r.text() };
}

test("un jeton fabriqué au nom d'un prestataire est refusé", async () => {
  const victime = await prestataireOperationnel();
  const [avant] = await sql(`select count(*)::int n from documents where prestataire_id = '${victime.id}' and verified`);
  const r = await appeler(jetonFabrique(victime.id), { docType: "cni", fileName: "x.jpg", mimeType: "image/jpeg" });
  expect(r.statut, r.texte.slice(0, 200)).toBe(401);
  const [apres] = await sql(`select count(*)::int n from documents where prestataire_id = '${victime.id}' and verified`);
  expect(apres.n, "les pièces vérifiées le restent").toBe(avant.n);
});

test("un type de pièce hors liste est refusé, même avec un vrai jeton", async () => {
  const p = await prestataireOperationnel();
  const r = await appeler(p.jeton, { docType: "../autre-compte/cni", fileName: "x.jpg", mimeType: "image/jpeg" });
  expect(r.statut, r.texte.slice(0, 200)).toBe(400);
});
