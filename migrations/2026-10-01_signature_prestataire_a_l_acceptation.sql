-- ═══════════════════════════════════════════════════════════════════════════
-- signature_prestataire_a_l_acceptation
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI (audit, 01/10/2026)
--
-- Le prestataire signe le contrat de prestation EN ACCEPTANT (écran « Contrat
-- de prestation de service » : « je m'engage à réaliser la prestation… ») — mais
-- l'horodatage restait dans le navigateur. La seule date enregistrée dans
-- `contrat_presta_signe_at` était celle de l'ATTESTATION DE FIN, signée à la
-- confirmation de fin de prestation : deux actes différents dans une seule case,
-- et la signature du contrat elle-même jamais tracée.
--
-- Désormais :
--   • `contrat_presta_signe_at` = signature du contrat, à l'acceptation ;
--   • `fin_attestee_presta_at`  = attestation de fin de prestation.
--
-- Les dates déjà enregistrées sont des attestations de fin : elles sont recopiées
-- dans la nouvelle colonne. Elles restent aussi dans `contrat_presta_signe_at`
-- (rien n'est effacé) ; pour ces prestations passées, cette date est donc celle
-- de la fin, pas de l'acceptation — c'est documenté.
--
-- ORDRE : AVANT le code. Le code écrit `fin_attestee_presta_at` : sans la
-- colonne, la confirmation de fin serait refusée.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.missions ADD COLUMN IF NOT EXISTS fin_attestee_presta_at timestamptz;

UPDATE public.missions
   SET fin_attestee_presta_at = contrat_presta_signe_at
 WHERE contrat_presta_signe_at IS NOT NULL
   AND fin_attestee_presta_at IS NULL
   AND validation_prestataire IS TRUE;

-- VÉRIFICATION — attendu : la colonne existe, et autant de lignes recopiées que
-- de prestations dont la fin a été confirmée par le prestataire.
--   SELECT count(*) FILTER (WHERE fin_attestee_presta_at IS NOT NULL) AS recopiees,
--          count(*) FILTER (WHERE validation_prestataire AND contrat_presta_signe_at IS NOT NULL) AS attendues
--     FROM public.missions;
