# JOBER / ALANE — Documentation du projet

Documentation de référence : à quoi sert le projet, comment il est construit, et comment
les données circulent. Les **règles de travail** (ce que Claude doit faire ou ne pas faire)
sont dans [CLAUDE.md](CLAUDE.md).

> **Source de vérité** : c'est la base Supabase elle-même. Les fichiers `.sql` à la racine
> sont d'anciens brouillons divergents, ils ne font pas autorité.

---

## 1. Le produit en deux phrases

ALANE est une place de marché qui met en relation des **clients** (entreprises ayant un besoin
ponctuel) et des **prestataires** indépendants (auto-entrepreneurs) dans la propreté, la
logistique, la restauration, l'hôtellerie et le commerce.

Le client publie ou commande une prestation, un prestataire l'accepte, la réalise, puis les
deux valident. Le paiement passe par Stripe, la plateforme prend une commission, et le client
cumule du cashback.

---

## 2. Architecture

| Brique | Technologie |
|---|---|
| Interface | React 19 + Vite, application monopage, styles en ligne |
| Base de données & authentification | Supabase (PostgreSQL + RLS) |
| Fichiers | Supabase Storage, bucket `Documents` (privé) |
| Fonctions serveur | Vercel Functions, dossier `/api` |
| Paiement | Stripe |
| Emails | Resend · SMS et emails de relance : Brevo |
| Hébergement | Vercel — `www.alane.fr`, backoffice sur `admin.alane.fr` |

**Ce n'est pas du Next.js**, malgré le dossier `/api`. C'est du React pur côté navigateur,
plus des fonctions serverless Vercel à côté. Il n'y a pas de rendu serveur.

### Organisation des fichiers

```
src/
  App.jsx                    ~1500 l. — état global, navigation, gardes d'accès
  lib/
    supabase.js              client Supabase
    routes.js                correspondance écran ↔ URL
  components/
    auth.jsx                 connexion + inscription (client et prestataire)
    client-screens.jsx       ~8000 l. — tout l'espace client
    presta-screens.jsx       ~3300 l. — tout l'espace prestataire
    backoffice.jsx           ~3100 l. — administration
    payment.jsx              tunnel de paiement Stripe
    ui.jsx                   composants partagés (boutons, badges, modales)
  constants/
    data.js                  secteurs, métiers, tarifs, documents requis (226 métiers, 7 secteurs)
    plans.js                 abonnements, frais, paliers de cashback
    colors.js                charte graphique
api/                         27 fonctions serverless
```

Les fichiers d'écrans sont volumineux (8000 lignes pour l'espace client). C'est un choix
historique : **on ne le refond pas sans demande explicite**.

---

## 3. Les deux espaces

### Client
Cherche un prestataire dans le catalogue ou publie une demande, réserve, paie, suit la
prestation en direct (géolocalisation), valide, note. Cumule un cashback progressif.

Le **portefeuille prépayé est fermé depuis le 16/08/2026** (avis prudentiel, CGPS art. 5B.3) :
plus de rechargement, plus de paiement depuis le solde. Les soldes constitués restent
remboursables — aucun n'existait à la fermeture. Conséquence à traiter : **le cashback n'a
plus de chemin de dépense**, le paiement par portefeuille étant le seul qui le consommait.

### Prestataire
Dépose ses documents, attend la validation par l'administration, reçoit des propositions,
accepte ou refuse dans un délai imparti, pointe son arrivée, valide la fin. Peut souscrire un
abonnement pour dépasser le quota gratuit de prestations mensuelles.

### Backoffice
Sur `admin.alane.fr`, protégé par mot de passe et éventuellement par filtrage d'adresses IP.
Valide les comptes, consulte les documents, gère les litiges, les remboursements et les
réglages de la plateforme.

---

## 4. La base de données

### Tables principales

**`profiles`** — le compte applicatif, un par utilisateur, avec le même identifiant que dans
Supabase Auth.
Champs clés : `role` (`client` ou `prestataire`), `status` (`pending`, `approved`, `rejected`,
`suspended`), `missions_enabled` (accès aux prestations accordé par l'administration),
`plan_abonnement`, `cashback_balance`, `prepaid_balance`, `avatar_url`.

**`missions`** — la prestation. C'est l'objet central. Attention : **il n'existe pas de table
`prestations`**, malgré le vocabulaire employé dans l'interface.
Statuts autorisés : `open`, `pending_acceptance`, `assigned`, `needs_replacement`,
`completed`, `closed`, `cancelled`, `disputed`, `rejected`, `refused`.

`retractation_renonciation_at` et `retractation_version` portent la preuve que le client a
demandé l'exécution avant la fin du délai de rétractation et reconnu perdre son droit après
exécution complète (CGPS art. 8.3). La version est enregistrée avec la date : sans elle, on
saurait dans deux ans QUAND le client a renoncé, mais pas À QUOI. Elles restent NULL sur les
prestations antérieures au 15/08/2026 — le droit n'y a pas été purgé, et il faut que cela
reste visible.

Le versement au prestataire se suit sur `payout_status`
(`pending` → `processing` → `transferred`, ou `failed`, ou `held` en cas de retenue),
`payout_amount` (le montant dû, figé à la clôture), `payout_due_at` (l'instant à partir
duquel le virement est émissible, soit la fin de la prestation + 48 h),
`payout_hold_reason` / `payout_hold_at` / `payout_hold_until` (retenue de l'art. 7.4) et
`payout_compensation` (somme retenue au titre de l'art. 8B.3).
Voir « Le versement au prestataire » au §6.

`cashback_applique` porte la part du prix réglée en cashback et `cashback_debite` dit si le
solde du client a réellement été prélevé. La seconde n'est pas une redondance : entre la
création de l'intention de paiement et sa confirmation, `cashback_applique` porte une réduction
PROMISE que rien n'a encore consommée — un panier abandonné ne doit rien coûter au client.

`resolution_proposee` (`verser_prestataire` | `rembourser_client`, sous contrainte `CHECK`),
`resolution_motif`, `resolution_montant`, `resolution_notifiee_at`, `resolution_echeance_at`,
`resolution_opposition_par` / `resolution_opposition_at` et `resolution_executee_cause`
portent le dénouement d'un litige : la proposition formulée par ALANE, le délai de 48 h
pendant lequel chacune des deux parties peut s'y opposer, et la cause qui a finalement fait
bouger les fonds — accord tacite, décision de justice, ou procédure de l'établissement de
paiement. C'est la seule chose qu'on aura à produire si l'on demande un jour au titre de quoi
l'argent a bougé. Voir « Dénouer un litige » au §6.

`alerte_sans_prestataire_at` (timestamptz, nullable) marque l'envoi de l'avertissement adressé
au client 6 h avant l'annulation automatique d'une prestation que personne n'a acceptée. Elle
ne sert qu'à ne l'envoyer qu'une fois. Non modifiable depuis le navigateur : un client pourrait
sinon l'effacer pour être alerté en boucle, ou la remplir pour ne jamais l'être.

`resolution_montant` (numérique, nullable, `CHECK > 0`) porte le montant d'un remboursement
PARTIEL. `NULL` — le cas courant — vaut remboursement du prix de la prestation, frais de
service retenus. Elle n'a de sens qu'avec `resolution_proposee = 'rembourser_client'` ; un
versement au prestataire la laisse nulle. Elle a été ajoutée le 21/08/2026 : sans elle, un
litige partiel — deux heures sur trois réalisées — n'avait que deux issues, tout rendre ou ne
rien rendre, et l'arbitre devait choisir celle qui lésait le moins mal. Comme toutes les
colonnes qui décident d'un montant, elle n'est pas modifiable depuis le navigateur.

**`creances_prestataires`** — les sommes dues par un prestataire à ALANE (art. 8B.3), avec
leur reste à recouvrer, leur notification et leur date d'exigibilité.
**`compensations_versements`** — le journal des retenues opérées sur chaque versement. Les
deux sont en lecture seule pour l'intéressé (RLS `SELECT` sur `auth.uid()`) ; créer ou
éteindre une créance passe par `/api`.

**`documents`** — les pièces justificatives des prestataires. `verified_at` date la
vérification, `expires_at` porte la fin de validité des attestations qui en ont une (RC Pro,
URSSAF), `purged_at` marque la suppression du fichier.

**La purge des pièces d'identité supprime le FICHIER, pas la LIGNE.** CNI, Kbis et
justificatif de domicile partent du stockage 30 jours après la vérification, et au plus tard
12 mois après le dépôt même sans vérification (CGPS art. 14.4, `api/_conservation.js`). La
ligne survit avec `purged_at` : elle est la preuve que la vérification a eu lieu, ce
qu'ALANE doit pouvoir justifier (art. L8222-1 du Code du travail, CGPS art. 10B.8 et 10D.4).
Supprimer la ligne effacerait la démarche en même temps que la pièce. Si la suppression du
fichier échoue, `purged_at` n'est **pas** écrit — sinon la pièce serait réputée supprimée
alors qu'elle est toujours là, et plus rien ne repasserait dessus.

**La résiliation d'un compte professionnel passe par un préavis de 30 jours** (CGPS art. 16.2,
règlement P2B). `resiliation_prevue_at` porte la date d'effet, `resiliation_motif` ce qui a été
notifié — une décision qu'on ne sait plus justifier ne se défend pas. Le compte fonctionne
normalement pendant le préavis : un préavis n'est pas une suspension. Le traitement quotidien
exécute à l'échéance, mais **reporte** si une prestation est en cours ou si un versement reste
dû — supprimer le compte le ferait disparaître avec l'argent.

Les attestations RC Pro sont relancées 30 jours avant l'échéance, puis à l'expiration, et
l'accès aux propositions est suspendu 30 jours après (`missions_enabled = false`), comme
l'écrit l'article 19.1. La suspension ne dépend pas de l'envoi de la relance : elle tombe au
terme de la tolérance, que l'e-mail soit parti ou non.
Types : `photo`, `kbis`, `urssaf`, `cni`, `domicile`, `rib`, `rc_pro`, `diplomes`, `tva`,
`autre`. **Un seul document par prestataire et par type** (contrainte unique).

**`candidatures`** — les prestataires qui postulent à une mission ouverte.

**`notifications`**, **`messages`**, **`support_tickets`**, **`ratings`**,
**`tracking_positions`** (géolocalisation en cours de prestation), **`favorites`**,
**`push_subscriptions`**.

**`visits`** — compteur de visites anonymes. Une ligne est insérée au premier chargement de
chaque session (`App.jsx:1103`), avec un simple `session_id` et aucune donnée personnelle.

**`wallet_topups`** — le registre des recharges du portefeuille, clé primaire = identifiant
du paiement Stripe. `montant_rembourse` porte ce qui a déjà été rendu sur chaque recharge :
sans lui, une seconde demande de remboursement rejouerait les mêmes, Stripe refuserait, mais
le solde du client aurait été débité deux fois.

**`booking_drafts`** — réservations abandonnées en cours de tunnel. Écrites par
`booking-draft.js` à l'entrée du tunnel et effacées à la fin ; `cron-abandon.js` les relit
pour envoyer les relances.

**`contracts`** — contrats de prestation générés et signés (`client-screens.jsx:4756`).

### Fonctions SQL (RPC)

**Le déclencheur `missions_field_tamper_guard` ne couvre que les `UPDATE`.** Vérifié en base
le 30/07/2026 : `CREATE TRIGGER missions_field_tamper_guard BEFORE UPDATE ON public.missions`.
Une ligne `missions` est **insérée par le navigateur du client** (`App.jsx`,
`client-screens.jsx`) : à la création, il choisit donc librement `tarif_horaire` et
`montant_total`. Ne jamais considérer ces deux champs comme fiables. Ils sont contrôlés
côté serveur à deux endroits, et il faut les deux :

- `api/_montant.js` (`verifierMontant`) — le total moins la part horaire doit correspondre à
  l'un des trois frais de service du barème, sinon le paiement est refusé. Appelé par
  **`stripe-intent.js` ET `wallet.js`** : il existe deux chemins d'encaissement, et le
  portefeuille prépayé n'était pas contrôlé jusqu'au 06/08/2026. Un client pouvait créer sa
  prestation avec `montant_total = tarif × heures`, la régler depuis son portefeuille et ne
  payer aucun frais de service ;
- `api/missions.js` (`assign_after_payment`) — le tarif horaire payé ne peut pas être
  inférieur au `tarif_net` réellement annoncé par le prestataire affecté.

**`missions_creation_guard`** (migration `2026-07-30_secu_verrou_creation_prestation.sql`)
double ces contrôles au niveau de la base, seul endroit qu'aucun chemin d'écriture ne peut
contourner. Pour un compte connecté, il interdit à la création : un `client_id` autre que
soi-même, un `prestataire_id` renseigné, un statut hors `open`/`pending_acceptance`, un
`stripe_payment_intent`, un `acceptance_deadline`, un pointage antidaté, et un
`montant_total` inférieur à la seule part horaire (frais de service négatifs). `service_role`
et les rôles d'administration sont exemptés. Il pose une **borne basse** sur le montant, pas
le calcul exact du tarif : reproduire la grille tarifaire en base finirait par diverger du
tunnel de réservation et bloquerait des réservations légitimes.

**`wallet_topups`** — le registre des recharges de portefeuille. La clé primaire est
l'identifiant du paiement Stripe : c'est la base, et non le code, qui empêche qu'une même
recharge soit créditée deux fois. Lisible par le seul service role. Avant elle, l'argent
entrait dans le portefeuille sans laisser aucune trace — un solde ne pouvait être ni
justifié, ni rapproché des encaissements Stripe.

Trois procédures stockées sont appelées depuis le code, et n'existent donc que dans la base :

- `check_prestataire_slot` — vérifie la disponibilité d'un prestataire sur un créneau.
- `increment_cashback` — crédite le cashback de façon atomique.
- `crediter_portefeuille` — enregistre une recharge et incrémente le solde dans une seule
  transaction ; renvoie `NULL` si la recharge avait déjà été traitée. Le webhook sait
  fonctionner sans elle (repli sur l'ancien crédit, non protégé, signalé dans les journaux).

Comme elles ne sont pas visibles dans les fichiers SQL du dépôt, une modification de leur
signature casse le code sans que rien ne le signale. **La référence, c'est la base.**

**`platform_settings`** — les réglages modifiables depuis le backoffice, stockés en clé/valeur.
Chaque clé est listée avec **l'endroit qui l'applique réellement** : un réglage qu'aucun code
ne lit est un piège, l'administrateur croit agir alors que rien ne change.

| Clé | Appliquée par |
|---|---|
| `cashback_rates` | `api/missions.js` (action `complete`) |
| `subscription_prices` | `api/plans.js`, écrans d'abonnement |
| `plan_limits` | `api/missions.js` — helper `limitePlanMensuelle()`, appliqué au plan lu dans **`profiles`** |
| `launch_phase` | badges de l'interface **et** `limitePlanMensuelle()` (8 prestations/mois aux 100 premiers prestataires) |
| `frais_service` | tunnel de réservation, `api/stripe-intent.js` |
| `urgency_surcharge` | écran de secteur (majoration affichée au client) |
| `seuils_dependance` | `api/bo-action.js` — action `signaux_dependance`. Absent = valeurs par défaut de `_dependance.js` (60 % du CA, 8 prestations minimum, 24 jours sur 8 semaines, fenêtre 180 j) |
| `disabled_sectors` | `api/missions.js` — `get_sector_status` (affichage) et `assign_after_payment` (refus de réservation) |
| `invoice_sequence` | `api/invoice.js` — compteur incrémenté **une fois par facture**, à sa première consultation, jamais aux suivantes |
| `commission_rate` | **personne** — vestige : la plateforme se rémunère sur les frais de service, `prixClient()` applique 0 % de commission. Ne pas s'y fier. |

**Ouverture des secteurs** — la règle vit dans `api/_secteurs.js`, seul endroit, et repose
sur trois réglages :

| Clé | Effet |
|---|---|
| `sector_min_prestataires` | Seuil d'ouverture automatique. **20** par défaut. `0` ouvre tout |
| `disabled_sectors` | Fermés d'autorité, quoi qu'il arrive |
| `forced_open_sectors` | Ouverts malgré un effectif insuffisant |

Ordre de priorité : fermeture d'autorité → ouverture forcée → effectif ≥ seuil → fermé.
La fermeture d'autorité l'emporte sur l'ouverture forcée : entre deux réglages
contradictoires, on retient le plus prudent.

Le seuil a existé à 30, puis a été **retiré le 30/07/2026** — non parce qu'il était mauvais,
mais parce qu'il n'avait jamais fonctionné : `get_sector_status` répondait 401 à ses deux
appelants. Le jour où ce défaut a été corrigé, appliquer le seuil aurait fermé tous les
secteurs d'un coup. Il est **rétabli le 07/08/2026** à la demande d'Alexandre, avec
`forced_open_sectors` en plus : sans cette échappatoire, aucune plateforme ne peut démarrer —
il faudrait vingt prestataires pour accepter la première commande, et une première commande
pour attirer des prestataires.

Le décompte ne retient que les prestataires **approuvés ET avec `missions_enabled`** : un
compte que l'administration n'a pas activé n'est pas réservable, le compter serait mentir.

Trois chemins consomment cet état — l'accueil client, le refus de réservation après paiement
(`assign_after_payment`), et l'affectation chez un tiers — via `etatSecteursAvecCache()`, avec
un cache de 5 minutes. **Un changement de réglage met donc jusqu'à 5 minutes à se refléter.**

**`account_blacklist`** — empreintes des comptes supprimés, pour empêcher qu'on recrée un
compte afin de récupérer l'essai gratuit. **Ne contient que des empreintes**, jamais de
données en clair.

**`mission_remplacements`** — le droit de remplacement du prestataire (CGPS art. 9), créé le
06/08/2026 par `2026-08-06_droit_de_remplacement.sql`.

Une ligne par demande : `mission_id`, `sortant_id`, `entrant_id`, `client_id`, `motif`,
`statut` (`en_attente`, `accepte`, `refuse`, `annule`, `expire`), `accord_entrant_at`,
`accord_client_at`, `refus_par`, `refus_motif`, `execute_at`.

Le remplacement n'est exécuté **qu'une fois les deux accords recueillis** : celui du
remplaçant — indépendant, il ne peut pas être volontaire d'office — et celui du client, qui
reçoit quelqu'un chez lui. Tant qu'il en manque un, le sortant reste titulaire et engagé.
Un index unique partiel garantit **une seule demande ouverte par prestation** : sans lui, un
prestataire pourrait en proposer trois et laisser le client arbitrer, ce qui lui rendrait le
choix nominatif que l'article 5.2 lui retire.

L'exécution se réduit à basculer `missions.prestataire_id`. Le virement de fin de prestation
lit ce champ : le remplaçant est donc payé de ce qu'il a réellement fait et facture en son
nom, sans aucun code de paiement à modifier.

RLS : **lecture seule**, réservée aux trois personnes concernées. Aucune policy d'écriture —
tout passe par `/api/missions`, qui seul vérifie les qualifications et l'ordre des accords.

**Toute notification part sur les deux canaux.** `notifier()` dans `api/_push.js` écrit la ligne
dans `notifications` ET envoie la notification push. C'est le passage obligé : le 18/08/2026, le
dépôt comptait 86 insertions pour 20 push, écart que personne n'avait décidé — la validation
d'une prestation ne prévenait pas le prestataire, alors qu'un retard de quinze minutes le
faisait. Les envois groupés gardent leur insertion en lot, suivie d'une boucle de push. Une
insertion directe sans push est refusée par `npm run coherence`.

**`push_subscriptions`** — **un appareil n'appartient qu'à un compte à la fois.** L'`endpoint`
identifie une installation du site dans un navigateur, pas une personne : à la reconnexion sous
un autre compte, il est réenregistré sans que l'ancienne ligne soit retirée. L'appareil recevait
alors les notifications des deux comptes — nom du client, montant, adresse d'intervention — soit
une communication de données personnelles à qui n'y a pas droit. `push_subscribe` supprime
désormais les lignes portant le même endpoint et un autre `user_id` avant d'insérer la sienne
(migration `2026-08-18_un_appareil_un_compte.sql`). Plusieurs appareils par compte reste normal ;
c'est l'inverse qui ne l'est pas.

**`bo_logs`**, **`bo_rate_limits`** — traçabilité et limitation du backoffice.

### Tables supprimées

`prestataires`, `metiers`, `disponibilites`, `abonnements`, `bookings` et `mission_responses`
ont été **supprimées le 05/08/2026** (migration `2026-08-05_nettoyage_tables_mortes.sql`).
Elles doublonnaient des données vivant dans `profiles`, `missions` et `candidatures`, et
n'étaient lues par aucune ligne de code.

Elles portaient **25 règles RLS** — 4, 6, 5, 2, 5 et 3 respectivement — que plus personne ne
relisait, dont une sur `prestataires` ouverte au rôle `public` : un visiteur non connecté
pouvait y créer une fiche. C'est la raison de fond du nettoyage, bien plus que l'encombrement.

Si ces noms réapparaissent dans un ancien fichier `.sql` de la racine, c'est un vestige :
**ne pas les recréer**.

### Où vivent les données

C'est le point le plus déroutant du projet, et la source de plusieurs pannes.

| Emplacement | Contenu | Limite |
|---|---|---|
| `auth.users.user_metadata` | Infos saisies à l'inscription : téléphone, adresse, secteur, métier, tarif, disponibilités, compétences | **Encodé dans le jeton, ~16 Ko max** |
| `profiles.rib` | IBAN du prestataire | **Jamais dans `user_metadata`** — voir ci-dessous |
| Table `profiles` | Rôle, statut, soldes, abonnement, photo | Aucune |
| Storage `Documents` | Les fichiers justificatifs | 10 Mo par fichier |

Beaucoup d'informations métier sont dans `user_metadata` plutôt que dans une table. C'est un
héritage. **La règle absolue : rien de volumineux dans `user_metadata`** — voir CLAUDE.md §1.1.

---

## 5. La logique Supabase

### Deux clés, deux niveaux de confiance

**La clé anonyme** est publique, embarquée dans le code envoyé au navigateur. N'importe qui
peut la lire. Elle ne donne aucun privilège : c'est la **RLS** (sécurité au niveau des lignes)
qui décide de ce qui est lisible.

**La clé service role** contourne toute la sécurité. Elle n'existe que dans les variables
d'environnement Vercel et n'est utilisée que dans `/api`. Si elle fuitait, toute la base
serait exposée.

### La RLS, en pratique

Chaque table a des règles décrivant qui peut lire et écrire quoi. Le principe général :

- **`profiles`** : chacun ne voit et ne modifie que sa propre ligne.
- **`missions`** : visibles par le client concerné, le prestataire assigné, et tout le monde
  si la mission est ouverte (pour que les prestataires puissent postuler).
- **`documents`** : chaque prestataire ne voit que les siens. Le backoffice y accède via `/api`.
- **`platform_settings`** : seules les clés nécessaires avant connexion sont publiques
  (tarifs, phase de lancement). La commission et les taux de cashback sont privés.
- **`notifications`** : chacun lit et marque comme lues **ses** notifications, mais
  **personne ne peut en créer** depuis le navigateur. Toutes les notifications sont
  insérées par `/api/missions` en service role. Cette écriture était ouverte à tout
  compte connecté jusqu'au 29/07/2026 — c'était un vecteur de phishing in-app.
- **Storage** : chacun n'écrit que dans son dossier `{user_id}/`.

Deux conséquences pratiques :

1. **Une requête qui ne renvoie rien n'est pas forcément une erreur** — ce peut être la RLS
   qui filtre. Vérifier le rôle avant de conclure à un bug.
2. **Toute opération sensible passe par `/api`**, qui vérifie l'appelant puis agit en service
   role. Le front ne doit jamais pouvoir modifier un montant ou un statut de mission.

### Les fonctions serveur

Les 27 fichiers de `/api`. Les principaux :

| Fichier | Rôle |
|---|---|
| `missions.js` | Cycle de vie complet des prestations (le plus gros) |
| `bo-action.js` | Toutes les actions du backoffice |
| `prestataires.js` | Catalogue des prestataires |
| `stripe-*.js` | Paiement, remboursement, abonnement, portefeuille, webhook |
| `upload-document.js`, `save-document.js`, `get-documents.js` | Documents |
| `support.js` | Tickets, emails, suppression de compte |
| `cron-*.js` | Tâches planifiées (remise à zéro mensuelle, relances) |
| `_auth.js`, `_email.js` | Fonctions partagées — `verifyUser`, envoi d'emails, hachage |
| `stripe-intent.js` | PaymentIntent, SetupIntent, portail de facturation, suppression de carte. **L'identifiant client Stripe se lit dans `profiles.stripe_customer_id`, jamais dans le corps de la requête** — helper `clientStripeDuCompte()`, qui le crée et le persiste s'il manque. Le PaymentIntent porte toujours ce `customer` : sans lui, Stripe refuse toute confirmation avec une carte enregistrée |
| `_dependance.js` | Détection de la dépendance économique et de l'intégration durable (CGPS art. 10D) — `couplesADependance()`. Seuils réglables par `platform_settings.seuils_dependance`. Exposé au backoffice par l'action `signaux_dependance` |
| `_cashback.js` | Le cashback en réduction du paiement — `reductionCashback()`, `debiterCashback()`, `restituerCashback()`, `plafonnerRemboursement()`. Importé aussi par `payment.jsx` : le tunnel AFFICHE la réduction avec la même fonction que celle qui la calcule côté serveur |
| `_montant.js` | Cohérence du montant encaissé — `verifierMontant()`. Appelé par `stripe-intent.js` et par `wallet.js` (ce second chemin n'est plus emprunté depuis la fermeture du portefeuille). Comparaison en centimes entiers : en euros flottants, un écart d'exactement un centime sortait de la tolérance et refusait un montant juste |
| `_temps.js` | Conversion des horaires de prestation — `heure_debut` est une heure **locale française**, Vercel tourne en **UTC**. Toute comparaison à `Date.now()` passe par `debutPrestationMs` / `finPrestationMs` / `retardMinutes`. Ne jamais recopier la formule : trois copies manuelles sur quatre étaient fausses (voir l'en-tête du fichier) |

### Comment l'appelant est vérifié

Il n'y a **pas** un seul schéma d'authentification mais quatre, selon la nature de l'appel.
Le confondre conduit à ajouter la mauvaise vérification dans un nouveau fichier.

| Mécanisme | Fichiers | Principe |
|---|---|---|
| `verifyUser` | `missions`, `support`, `wallet`, `stripe-intent`, `stripe-wallet-topup`, `booking-draft`, `get-documents`, `notify-doc` | Jeton Supabase de l'utilisateur, validé auprès de `/auth/v1/user` |
| Vérification inline équivalente | `save-document`, `update-profile`, `upload-document`, `stripe-subscription` | Même principe, mais avec une copie locale du code au lieu de `_auth.js` |
| Token backoffice | `bo-action`, `bo-verify-pin`, `invoice`, `stripe-refund`, `reset-password`, `forgot-password` | Session BO signée en HMAC avec `BO_SESSION_SECRET` |
| `CRON_SECRET` / signature Stripe | `cron-abandon`, `cron-reset-monthly` / `stripe-webhook` | Appels machine, jamais déclenchés par un utilisateur |

`missions.js` utilise une version **étendue** de `verifyUser` qui contrôle en plus le `status`
du profil. C'est volontaire : ne pas la remplacer par celle de `_auth.js`.

### Deux endpoints sans aucune authentification

Ce sont les seules exceptions, et elles méritent d'être connues avant d'être copiées comme
modèle :

- **`get-profile.js`** — reçoit un `userId` dans le corps de la requête et renvoie `role`,
  `status`, `missions_enabled` et `plan_abonnement` de ce compte, en service role, donc
  **hors RLS**. Quiconque connaît un identifiant peut lire ces champs. Les données restent
  limitées (ni nom, ni email, ni téléphone) mais la lecture n'est pas contrôlée.
- **`prestataires.js`** — sert le catalogue complet des prestataires approuvés (identifiant,
  prénom, nom, photo) sans vérifier l'appelant. À noter : cela **contourne la décision S-11**
  de l'audit, qui avait fermé ce catalogue aux comptes connectés en retirant les policies RLS
  publiques. La restriction porte sur l'accès direct à la table, pas sur cet endpoint.
  La route allégée `?action=count`, elle, doit rester publique : l'écran d'accueil s'en sert
  avant toute connexion.

Refermer ces deux points est une décision produit, pas une correction évidente : `get-profile`
est appelé pendant la connexion, et le catalogue sert aussi les liens de partage `?profil=`
qui fonctionnent aujourd'hui sans compte.

### Ce que le front n'a plus le droit d'écrire

Trois écritures sensibles se faisaient directement depuis le navigateur. Elles passent
toutes par `/api/missions` depuis le 29/07/2026, et **rien ne doit les y ramener** :

| Écriture | Action serveur | Pourquoi |
|---|---|---|
| Notification | `notify_prestataire` | Un compte pouvait notifier n'importe qui, avec un texte libre |
| Clôture de mission + cashback | `complete` | Le client écrivait son propre solde ; taux de `plans.js` au lieu de la base, et lecture-écriture non atomique |
| Refus après délai expiré | `acceptance_timeout` | Le serveur revérifie que `acceptance_deadline` est réellement dépassée |

La règle générale reste celle de `CLAUDE.md` §3.3 : **argent, statut de mission et cashback
ne s'écrivent jamais depuis `src/`.**

### Les documents contractuels

| Document | Où il vit | Quand il est présenté |
|---|---|---|
| **CGPS** (23 articles) | `src/constants/cgps.js` — **source unique** | Modale d'inscription (acceptation), écran Documents, et `public/cgps.html` généré |
| Contrat-cadre Client Professionnel | `src/constants/contrat-cadre-pro.js` | Avant la première réservation chez un tiers |
| Contrat de prestation | `client-screens.jsx` (`contrat_prestation`) | Signé à chaque prestation |
| CGU | `App.jsx` | Modale « Conditions Générales » du pied de page |

Les CGPS ont existé en **quatre exemplaires** jusqu'au 06/08/2026 : le texte intégral, une
copie HTML manuelle dans `public/cgps.html`, et **deux résumés distincts de huit sections**
dans `auth.jsx` — un par parcours d'inscription, chacun titré « CGPS » et validé par un
bouton « J'accepte les CGPS ».

Le document que l'utilisateur acceptait n'était donc pas celui qui l'engage, et il était
**faux sur l'argent** : il annonçait une commission de mise en relation qui n'existe pas
(`prixClient()` applique 0 %), affirmait qu'ALANE ne détient pas les fonds alors qu'ils sont
séquestrés par Stripe Connect jusqu'à la double validation, et niait toute retenue sur le
montant de la prestation que l'article 8.1 prévoit pourtant.

Depuis, un seul texte : `src/constants/cgps.js`, importé par l'application, par les écrans
d'inscription et par le générateur. **Ne jamais en recopier un extrait dans un écran** —
importer `CGPS` et rendre les sections.

Pour modifier les CGPS : éditer `src/constants/cgps.js`, mettre à jour `maj` s'il s'agit
d'une évolution de fond, puis `npm run cgps`. La CI (`npm run cgps:verifier`) refuse toute
divergence avec `public/cgps.html`.

### Le formulaire de paiement — Payment Element

**Migré le 18/08/2026**, sur signalement de Stripe. `elements.create("card")` et
`confirmCardPayment` sont une intégration obsolète : aucune nouveauté n'y arrive plus, ni
moyens de paiement, ni améliorations du 3-D Secure.

Le tunnel utilise désormais **Payment Element en mode différé** — `mode: "payment"` avec un
montant, sans `clientSecret`. Ce choix n'est pas cosmétique : le PaymentIntent n'est créé
qu'au clic sur « Payer ». Le créer à l'ouverture remplirait Stripe d'intentions abandonnées et
romprait la règle du cashback, qui ne réserve rien tant que le paiement n'a pas abouti.

Trois conséquences à connaître :

- `elements.submit()` valide les champs **avant** que le PaymentIntent n'existe. Une erreur à
  cette étape est une erreur de saisie, jamais un refus bancaire.
- Le montant est transmis à la création puis par `elements.update()` quand le cashback est lu.
  Recréer l'élément effacerait un numéro de carte déjà saisi.
- `redirect: "if_required"` garde le client sur ALANE quand la banque ne demande rien. Le
  `return_url` doit exister malgré tout — Stripe refuse la confirmation sans lui.

**`paymentMethodTypes: ["card"]` est obligatoire en mode différé.** Le PaymentIntent n'existant
pas encore au montage, Payment Element ne peut pas lire le `payment_method_types` que le serveur
lui imposera : sans cette liste, il propose tout ce qui est activé sur le compte Stripe.
Constaté le 18/08/2026 — Bancontact, MB WAY, Amazon Pay et EPS sont apparus dans le tunnel
d'une plateforme française de services.

Ce n'est pas qu'une question d'encombrement : toute la mécanique de litige raisonne sur une
carte. La liste doit rester alignée sur celle d'`api/stripe-intent.js`, sinon un moyen proposé
au client serait refusé à la confirmation, en anglais, après le clic.

Le nom du titulaire reste dans le champ d'ALANE (`billingDetails.name: "never"`) : il est déjà
obligatoire et validé. **Apple Pay et Google Pay gardent leur bouton séparé** (`paymentRequest`)
plutôt que ceux de Payment Element : un seul chantier à la fois sur un tunnel qui déplace de
l'argent. À reprendre avec la bascule Stripe Connect.

### Facturation

La facture est établie **par le prestataire au client**. ALANE n'en est pas l'émetteur :
elle apparaît en en-tête comme intermédiaire, et le document le dit explicitement.

`VITE_ALANE_FORME` n'a **plus de valeur par défaut**. Elle valait `"SAS"`, si bien que toute
facture affirmait l'existence d'une société qui n'était pas encore immatriculée. Les trois
mentions (`VITE_ALANE_SIRET`, `VITE_ALANE_ADRESSE`, `VITE_ALANE_FORME`) ne s'affichent que si
elles sont renseignées dans Vercel.

**Archive immuable** — `factures_archives` (migration `2026-08-07`). La facture était
**reconstruite depuis les données vivantes à chaque affichage** : un prestataire qui changeait
de raison sociale voyait toutes ses factures passées changer avec lui, et une suppression de
compte les vidait de l'identité des parties. Un document comptable ne se réécrit pas.

L'état est désormais figé **à l'émission**, c'est-à-dire à l'attribution du numéro — le moment
où la facture existe juridiquement. Les affichages suivants relisent cet instantané. Deux
déclencheurs interdisent en base toute modification et toute suppression : une erreur se
corrige par un avoir, pas par une réécriture.

Conservation **dix ans** (art. L123-22 du Code de commerce). Le droit à l'effacement ne s'y
oppose pas : le RGPD art. 17.3.b réserve les traitements nécessaires à une obligation légale.
C'est ce qui rend licite l'anonymisation des prestations à la suppression de compte — la pièce
comptable, elle, subsiste.

Les factures numérotées **avant** cette migration sont archivées au premier affichage suivant,
avec une trace en journal : leur contenu a pu dériver entre-temps, mais il cesse de dériver.

**Numérotation** — `platform_settings.invoice_sequence`, incrémenté par compare-and-swap avec
trois tentatives, puis figé dans `missions.invoice_number`. Format `FAC-{année}-{6 chiffres}`.
La séquence est continue et **ne se réinitialise pas** au changement d'année : c'est la
continuité qui compte, pas l'alignement sur l'exercice.

Si aucun numéro ne peut être tiré, **l'édition est refusée** (503). Le repli précédent
fabriquait `FAC-{8 caractères de l'identifiant}` — hors séquence, non chronologique, et non
conservé : au réaffichage suivant la même prestation recevait un vrai numéro, soit deux
documents portant deux numéros pour une seule opération, ce qu'interdit l'article 242 nonies A
de l'annexe II au CGI. Ne pas produire de document est rattrapable ; en produire un mal
numéroté ne l'est pas.

### Le backoffice

`admin.alane.fr` n'est **pas un déploiement séparé** : c'est la même application, le même
bundle. `App.jsx` bascule sur l'écran `bo_login` quand `window.location.hostname` vaut
`admin.alane.fr`. Les écrans `bo_login` et `bo_dashboard` sont dans `PUBLIC_SCREENS` :
`www.alane.fr/admin` ouvre donc la même page de connexion. La sécurité réelle est
**entièrement côté serveur**.

**Authentification** — `bo-verify-pin` valide le mot de passe (`BO_PASSWORD`, comparaison
`timingSafeEqual`, 10 tentatives / 5 min / IP persistées dans `bo_rate_limits`) et rend un
jeton `ts.nonce.HMAC`. `bo-action` le vérifie **une seule fois, avant tout aiguillage** :
les 50+ actions sont couvertes sans exception possible. Expiration 24 h. Jeton rangé en
`sessionStorage`.

Si `BO_PASSWORD` est absent, un mot de passe de repli dérivé de la clé service role reste
accepté, mais il n'est **jamais transmis au navigateur** — il s'écrit dans les journaux
Vercel. Il l'était jusqu'au 06/08/2026, affiché en clair sur l'écran de connexion avec un
bouton pour s'en servir : une variable d'environnement absente ouvrait le backoffice à
quiconque connaissait l'adresse. Une tentative ratée ne renvoie plus aucun diagnostic
(elle donnait la longueur exacte de `BO_PASSWORD` et la liste des variables d'environnement).

**IBAN** — l'action `list` ne renvoie plus que `rib_present` et `rib_fin` (4 derniers
caractères). La valeur complète s'obtient fiche par fiche via `reveal_iban`, **tracée dans
`bo_logs`**. L'export CSV ne contient plus que les 4 derniers caractères. Jusqu'au
06/08/2026, l'IBAN complet de **tous** les comptes partait au navigateur à chaque ouverture
du backoffice — contraire à la minimisation (RGPD art. 5.1.c), et une session compromise
emportait tout le fichier bancaire.

**Journal** — toute action sensible écrit dans `bo_logs` via le helper `journaliser()`.
Sept ne le faisaient pas : `approve`/`reject`, `verify_doc`, `reject_doc`,
`send_global_comm`, `save_settings`, `delete_ticket`, `reset_visits`,
`list_missions_export`, `seed_docs`. La validation des pièces d'identité et la modification
des réglages — frais de service, cashback, seuils de vigilance — ne laissaient aucune trace.

### Carte

Leaflet est chargé dynamiquement par `loadLeaflet()` (`client-screens.jsx`). Il tente d'abord
**la copie locale uniquement** : `public/leaflet.js` et `public/leaflet.css`, déposés le
07/08/2026 et servis par ALANE.

Il n'y a **aucun repli sur un CDN**. La bibliothèque venait d'`unpkg.com` ; un CDN compromis y
exécuterait du code arbitraire sur le site, `admin.alane.fr` compris puisqu'il partage le même
bundle, avec accès au jeton de session du backoffice. `unpkg.com` a été retiré de `script-src`
et de `style-src` : un repli serait de toute façon bloqué par le CSP, et le laisser dans le
code donnerait l'illusion d'un filet qui n'existe pas.

Les fichiers sont **à la racine de `public/`** et non dans un sous-dossier : le dépôt se gère
depuis l'interface web de GitHub, où l'envoi de fichiers ne permet pas de choisir un chemin
imbriqué. Un chemin plus profond aurait été plus propre, mais il ne serait jamais déposé.

**Si la carte cesse de s'afficher**, la console indique le fichier manquant. Pour le
reconstituer :

```bash
curl -o public/leaflet.js  https://unpkg.com/leaflet@1.9.4/dist/leaflet.js
curl -o public/leaflet.css https://unpkg.com/leaflet@1.9.4/dist/leaflet.css
```

### En-têtes de sécurité

Le CSP de `vercel.json` n'autorise plus `'unsafe-inline'` dans **`script-src`** : le build ne
contient aucun script inline (seulement des blocs `application/ld+json`, qui ne sont pas
exécutés) ni aucun gestionnaire `on*`. Vérifié avant de retirer la directive.

`script-src` n'autorise plus qu'**un seul domaine tiers : `js.stripe.com`**. Toute
bibliothèque ajoutée devra être hébergée par ALANE, ou le CSP la bloquera — c'est voulu.

`'unsafe-inline'` reste **obligatoire dans `style-src`** : tout le projet est écrit en styles
en ligne (règle 3.1). Ne pas le retirer.

Ajoutés au passage : `form-action 'self'` et `frame-ancestors 'none'`.

### Suppression de compte et anti-recréation

`account_blacklist` ne contient que des **empreintes** (`hashPii`) de l'email, du téléphone,
de l'IBAN et du SIRET — jamais de données en clair. Elle sert à empêcher qu'un compte
supprimé se recrée pour retrouver un essai gratuit, et reste compatible avec le droit à
l'effacement : elle évite précisément d'avoir à conserver les identifiants.

Deux chemins de suppression, et **un seul l'alimentait** jusqu'au 07/08/2026 :

| Chemin | Fichier | Empreinte enregistrée |
|---|---|---|
| Suppression par l'administration | `bo-action.js` (`delete`) | Oui, depuis toujours |
| Suppression par l'utilisateur | `support.js` (`delete_account`) | **Non — corrigé le 07/08/2026** |

Or c'est le second que les utilisateurs empruntent. Il suffisait de supprimer son compte
depuis l'application puis de se réinscrire pour retrouver un essai gratuit, autant de fois
que voulu.

Le contrôle à l'inscription (`support.js`, action `welcome`) était par ailleurs **incapable de
lire l'IBAN** : il référençait `SUPABASE_URL`, déclaré plus bas dans la même fonction, ce qui
levait « Cannot access before initialization » à chaque appel. Le `catch` l'avalait, la valeur
retombait sur `user_metadata.rib` — vide depuis la migration RGPD qui a sorti l'IBAN du jeton.

**Formulaire de contact** — public, mais l'identité ne se déclare plus. `userId` était lu dans
le corps de la requête et servait à relever la limite anti-spam de 3 à 20 messages par dix
minutes, ainsi qu'à rattacher le ticket à un compte : inventer un identifiant suffisait pour
la limite haute, en copier un vrai pour écrire au nom d'autrui. Le jeton est désormais
vérifié quand il est présent, et c'est lui qui fait foi.

### Le webhook Stripe

Signature vérifiée systématiquement : HMAC-SHA256 sur le corps brut, comparaison à temps
constant, tolérance de 300 s. Sans `STRIPE_WEBHOOK_SECRET`, le webhook est **rejeté**, jamais
accepté par défaut.

**Idempotence** — Stripe réémet tant qu'il n'a pas reçu de 2xx. Deux protections :
la recharge de portefeuille passe par la procédure `crediter_portefeuille`, dont la clé
primaire est l'identifiant du paiement ; l'affectation d'une prestation vérifie
`stripe_payment_intent` puis filtre le `PATCH` sur les statuts non terminaux, si bien qu'une
seconde livraison ne modifie aucune ligne et s'arrête là.

**Le webhook est un chemin parallèle à `assign_after_payment`.** Il ne vérifiait pas que le
prestataire a toujours accès aux prestations : entre la création du paiement et sa
confirmation, l'administration peut avoir suspendu le compte. Depuis le 07/08/2026, le
webhook contrôle `status=approved` **et** `missions_enabled`. Si le prestataire ne remplit
plus les conditions, la prestation passe en `needs_replacement` plutôt qu'en `assigned` —
l'argent est encaissé, le client doit être servi — et le client est prévenu.

### Les contraintes de la base peuvent être en retard sur le code

**Constaté le 18/08/2026**, sur un prestataire qui ne pouvait pas accepter une
prolongation. `missions_extra_hours_status_check` n'autorisait pas `accepte_presta`, valeur
introduite la veille avec la prolongation payante.

Le relevé a montré **trois contraintes** dans cet état, corrigées par
`2026-08-18_contraintes_en_retard_sur_le_code.sql` :

| Contrainte | Valeur manquante | Ce que ça cassait |
|---|---|---|
| `missions_extra_hours_status_check` | `accepte_presta` | Aucune prolongation acceptable |
| `missions_delay_status_check` | `pending` | **Le pointage entier** échouait en cas de retard > 15 min |
| `missions_payout_status_check` | `held` | Une retenue de l'art. 7.4 ne retenait rien |

La deuxième est la plus instructive. `delay_status = "pending"` est écrit **dans le même
PATCH** que `arrived_at` et `started_at` : la contrainte faisait donc échouer le pointage
lui-même, mais uniquement quand il y avait du retard. Un prestataire ponctuel n'écrit pas
cette colonne, et le défaut restait invisible. L'arbitrage du décalage (CGPS art. 10C) n'a
ainsi jamais pu se déclencher.

C'est la règle 1.6 de CLAUDE.md prise par l'autre bout : elle prescrit de relever toutes les
valeurs avant d'ajouter une contrainte ; il faut aussi relire la contrainte avant d'ajouter
une valeur. `npm run contraintes` met les deux listes en regard.

### Migrations

Le dossier `migrations/` contient les changements de schéma et de policies, datés et
nommés en français. Ils ne sont **pas appliqués automatiquement** : il faut les jouer dans
l'éditeur SQL Supabase. Chaque fichier porte ses requêtes de vérification et sa procédure
de retour arrière.

Les trois fichiers `*.sql` à la racine (`supabase-schema.sql`, `supabase_schema.sql`,
`supabase_migration.sql`) sont des reliquats divergents — **aucun ne fait autorité**.

Cette divergence a déjà coûté une panne complète : `supabase-schema.sql` annonce
`documents.id uuid`, `supabase_schema.sql` annonce `documents.id BIGSERIAL`. Le backoffice
avait été écrit sur la première hypothèse et exigeait un uuid, si bien que **la validation
et le refus d'un document répondaient toujours « docId invalide »** — les boutons n'ont
jamais fonctionné. Avant d'écrire un contrôle de format sur une clé primaire, **relever son
type dans la base** (`SELECT pg_typeof(id) FROM <table> LIMIT 1;`), jamais dans ces fichiers.

---

## 6. Parcours utilisateur

### Inscription et validation

**Les deux rôles ne suivent pas le même chemin.** C'est une source de confusion fréquente.

```
CLIENT
Inscription → status "approved" directement (auth.jsx:826)
           → email de bienvenue
           → accès immédiat à l'application, aucune validation backoffice

PRESTATAIRE
Inscription → status "pending" (auth.jsx:131)
           → email de bienvenue
           → écran d'attente, l'application est inaccessible
Backoffice → validation → status "approved" → email de confirmation
           → il faut EN PLUS missions_enabled = true pour accéder aux prestations
```

Autrement dit : **seuls les prestataires passent par une validation manuelle.** Un client
créé à l'instant peut réserver immédiatement.

**L'IBAN vit dans `profiles.rib`, jamais dans `user_metadata`.** Il y était stocké, donc
encodé dans le jeton d'authentification, transmis en en-tête HTTP à chaque requête et
conservé dans le navigateur. Ce n'est pas un problème de taille — 27 caractères — mais
d'exposition : une coordonnée bancaire atteignait ainsi chaque point d'entrée de la
plateforme, y compris ceux qui n'en ont aucun besoin (minimisation, RGPD art. 5.1.c). Les
quatre lectures (liste du backoffice, approbation, suppression, contrôle anti-recréation à
l'inscription) lisent `profiles.rib` en priorité et retombent sur l'ancien emplacement tant
que l'étape 2 de la migration `2026-07-30_rgpd_iban_hors_du_jeton` n'a pas été passée.

**`profiles.plan_abonnement` fait seule foi pour l'abonnement.** `user_metadata` en contient
une copie, mais elle n'est **jamais** opposable : à l'inscription, le prestataire choisit son
plan d'un simple appui, sans paiement, et cette valeur y atterrit. Tant que le repli sur
user_metadata existait, il suffisait de sélectionner Elite en créant son compte pour obtenir
999 prestations par mois, le badge et la première place dans les résultats — sans rien régler.
`user_metadata.plan_souhaite` conserve désormais ce choix comme simple intention.

Seuls trois chemins accordent un plan payant : le webhook Stripe, la vérification directe de
l'abonnement dans `refresh_plan`, et le forçage manuel depuis le backoffice.

`status` et `missions_enabled` sont deux choses différentes : un prestataire peut avoir un
compte validé tout en n'ayant pas encore accès aux prestations, tant que son dossier
documentaire n'est pas complet.

`missions_enabled` vaut **`false` par défaut** (colonne créée avec `DEFAULT false`). Le verrou
est appliqué à trois endroits, et il faut les trois : l'interface du prestataire masque la
liste des prestations, `api/prestataires.js` l'exclut du catalogue client, et
`api/missions.js` (`assign_after_payment`) refuse de lui affecter une prestation. Tant que
l'administrateur n'a pas cliqué « ✅ Activer l'accès aux prestations » dans le backoffice, un
prestataire approuvé **n'apparaît pas** aux clients — c'est voulu, mais c'est aussi la première
chose à vérifier si le catalogue paraît vide.

Quatre statuts existent : `pending`, `approved`, `rejected`, `suspended`. Le dernier est
traité à la connexion (`auth.jsx:1175`) et au démarrage (`App.jsx:1391`) : la session est
fermée et l'utilisateur renvoyé à l'écran de choix de rôle.

### Cycle d'une prestation

```
open                 publiée, les prestataires peuvent postuler
pending_acceptance   un prestataire est sollicité, il a un délai pour répondre
assigned             accepté, prestation à venir ou en cours
completed            terminée et validée des deux côtés
closed               clôturée
```

Chemins de sortie : `cancelled` (annulation), `disputed` (litige),
`needs_replacement` (le prestataire se désiste, retour au marché), `rejected` / `refused`.

**`needs_replacement` signifie « déjà payée ».** C'est ce qui la distingue d'une prestation
réouverte en `open` : le prestataire s'est désisté après paiement, l'argent du client est
conservé le temps de trouver un remplaçant. Si l'heure de début passe sans remplaçant, le
traitement automatique **rembourse intégralement** puis passe la prestation en `cancelled` —
le contrat le promet, et rien ne l'appliquait : la prestation était clôturée et l'argent
restait acquis à la plateforme. Un remboursement qui échoue **diffère la clôture** plutôt que
de la masquer : la prestation est reprise au passage suivant, et les prestations différées
depuis plusieurs passages sont journalisées en erreur — sans quoi elles restent visibles à
l'écran sans que personne ne sache pourquoi.

**Le client est prévenu 6 h avant** (21/08/2026). Il apprenait l'annulation au moment où elle
tombait : il avait réservé, payé, organisé sa journée, et découvrait à 08 h 30 que personne ne
viendrait. Un avertissement quelques heures plus tôt ne change pas la règle mais lui laisse le
temps de s'organiser. `missions.alerte_sans_prestataire_at` garantit un envoi unique — le
traitement repasse toutes les deux heures. L'écriture précède l'envoi : si elle échoue, rien
n'est envoyé, car mieux vaut pas d'alerte qu'une alerte toutes les deux heures.

**Corrigé le 21/08/2026 — deux trous dans cette clôture automatique.** Le filtre portait sur
`date < aujourd'hui` : une prestation qui commençait à 08 h 30 et n'avait toujours personne
restait « en recherche » toute la journée et n'était clôturée qu'après minuit — le client
attendait quelqu'un qui ne viendrait pas, son argent bloqué. L'échéance est désormais l'HEURE
DE DÉBUT, calculée en heure locale française par `debutPrestationMs()` (`api/_temps.js`).
Second trou : `date` est NULLE sur les prestations sur plusieurs jours, qui portent
`date_debut`, et PostgREST écarte les NULL d'une comparaison — ces prestations n'étaient donc
**jamais** examinées. Une prestation du 30/07 était encore « Remplaçant recherché » le 21/08.
La requête teste maintenant `or=(date.lte.…, and(date.is.null, date_debut.lte.…))`.

**`profiles_privileges_guard`** (migration `2026-07-30_secu_verrou_champs_profil.sql`) protège
les champs privilégiés du profil. La ligne `profiles` est créée **et** modifiée par le
navigateur — quatre `upsert` dans `auth.jsx`, des `update` dans les écrans de profil — qui y
choisit donc lui-même `role` et `status`. L'application n'écrit jamais autre chose que
`status = 'pending'`, mais rien ne l'y obligeait : seule la RLS protégeait ces champs. Le
déclencheur rend la question sans objet. Restent libres : nom, prénom, adresse, ville, code
postal, `avatar_url`, `rib`.

**`META_EXPOSE` dans `api/bo-action.js` liste les champs `user_metadata` renvoyés au
backoffice.** C'est une liste blanche volontaire — un champ sensible ajouté plus tard ne fuite
pas par accident — mais elle doit être **étendue en même temps que l'inscription**. Elle datait
d'avant le formulaire prestataire actuel : le backoffice affichait « Secteur », « Métier »,
« Tarif net », « Adresse » et « Langues » sans jamais les recevoir, et la fiche d'un candidat
se résumait à son email, son téléphone et son IBAN — alors que c'est sur ces informations que
repose la décision de validation.

**Le SIRET d'un prestataire est dans `user_metadata.siret`**, pas dans `kbis`, qui n'est
renseigné que pour les clients professionnels. Le contrôle à l'approbation et le bouton
« Vérifier IBAN / SIRET » ne lisaient que `kbis` : aucun SIRET de prestataire n'était vérifié.

**`api/update-profile.js` filtre ce que le navigateur peut écrire dans `user_metadata`.**
Il fusionnait sans aucun filtre l'objet reçu : un compte pouvait donc s'attribuer un
abonnement, se valider lui-même ou se créditer un portefeuille en modifiant son profil. Une
liste de champs privilégiés est refusée (`plan_abonnement`, `status`, `missions_enabled`,
`prepaid_balance`, les identifiants Stripe…). Deux garde-fous de taille s'y ajoutent, la
fonction écrivant précisément le champ visé par la règle 1.1 : toute valeur commençant par
`data:` est refusée, et l'ensemble est plafonné à 6 Ko — bien en deçà des 16 Ko de l'en-tête,
qui doit aussi porter la signature du jeton.

**Les avis reçus par un CLIENT ne sont visibles que dans le back-office** (décision du
18/08/2026). Ils étaient enregistrés et lus par personne — une collecte de données
personnelles sans finalité, ce que le RGPD n'admet pas. Les montrer au prestataire avant qu'il
accepte aurait été l'usage naturel, mais aurait fait de la note un critère de sélection, donc
un pouvoir sur le client exercé par la plateforme qui l'affiche.

L'onglet Avis sépare les deux sens et calcule une moyenne par client **à partir de trois
avis** : en dessous, un seul prestataire mécontent condamnerait quelqu'un. Le sens de l'avis se
déduit du rôle du destinataire, sans colonne supplémentaire.

**`ratings.reviewee_provider_id` porte le prestataire OU le client** selon le sens — le nom est
trompeur. `list_ratings` demandait `reviewee_id`, colonne qui n'existe pas : PostgREST refusait
toute la requête et l'onglet affichait « Aucun avis » quel qu'en soit le nombre. Corrigé le
18/08/2026.

**Les avis passent par `/api/missions` (`submit_rating`), jamais par le navigateur.**
L'insertion s'y faisait directement : le contrôle d'éligibilité était une requête du front,
contournable, et côté prestataire il n'existait pas du tout — on pouvait noter n'importe qui,
autant de fois que voulu, alors que la note pilote le classement du catalogue. Le serveur
vérifie que l'auteur a pris part à la prestation, qu'elle est terminée, et qu'il n'a pas déjà
donné son avis ; le destinataire est déduit de la prestation. `reviewee_provider_id` porte
selon le sens le prestataire **ou** le client — le nom de la colonne est trompeur.

**Les frais de service sont dus sur toute annulation à l'initiative du client**, quel que
soit le délai — CGPS art. 8.1, « en principe retenus et non remboursables car ils couvrent des
coûts déjà engagés ». Le serveur les remboursait pourtant au-delà de 24 h, alors que l'écran
de confirmation annonçait déjà « hors frais de service ». Unique exception, CGPS art. 8.2 :
la défaillance du prestataire, où le remboursement est intégral.

**Retard du prestataire : le client peut annuler sans aucun frais.** Le seuil est
proportionnel à la durée — `min(60 min, max(20 min, 25 % de la durée))`, soit 20 min pour une
prestation d'une heure, 30 min pour deux heures, 60 min au-delà de quatre. Un retard se juge
en proportion : 30 minutes sur une heure, c'est la moitié du service perdu ; sur huit heures,
un contretemps. Le droit **se referme dès le démarrage** — le prestataire est alors à l'œuvre
et c'est l'arbitrage du décalage qui rééquilibre ; annuler le ferait travailler pour rien.
Le remboursement est **intégral, frais de service compris**, comme le promet le contrat en cas
de défaillance du prestataire. Le retard est recalculé par `cancel_client` et jamais lu depuis
la requête. Le seuil est dupliqué dans `seuilAnnulationRetardMin()` côté front pour
n'afficher le bouton qu'à bon escient : les deux doivent rester alignés.

**Article 5.2 des CGPS — l'affectation est faite par ALANE dès qu'un tiers est en jeu.** Le
choix libre d'un prestataire nommément désigné a été identifié comme le principal point de
vulnérabilité de la plateforme : il est exactement le critère que l'article 10B.2 interdit.
Le choix reste libre quand le client commande pour lui-même ; il disparaît dès qu'il déclare
intervenir chez un tiers. Le code doit suivre : voir « affectation automatique » ci-dessous.

**Parrainage** — la récompense « 3 filleuls abonnés = 1 mois offert » est évaluée dans
`api/stripe-webhook.js`, au moment où un filleul **souscrit réellement**, et non plus dans
`track_referral` à son inscription. Le code l'accordait dès trois créations de compte : trois
inscriptions suffisaient à obtenir un abonnement payant. `profiles.referral_rewards_granted`
compte les récompenses déjà versées, sans quoi chaque nouvel abonnement d'un filleul en
redéclencherait une.

La récompense **prolonge** l'abonnement du parrain, elle ne le remplace jamais : elle écrivait
`plan_abonnement: "premium"` avec une fin à trente jours, ce qui déclassait un parrain Elite et
tronquait sa souscription en cours. `track_referral` ne fait plus que rattacher le filleul, une
seule fois — le filtre `referred_by IS NULL` interdit de réattribuer un parrainage — et
recalcule le compteur depuis la source au lieu de l'incrémenter.

**Contrat-cadre Client Professionnel** — `src/constants/contrat-cadre-pro.js`, huit articles,
distinct des CGPS. Celles-ci sont acceptées par tous et ne peuvent pas porter les engagements
propres au client professionnel : garantie de vendre un résultat, maintien du pouvoir
d'organisation, coopération aux audits, indemnisation (civile uniquement), conservation des
preuves cinq ans.

Son acceptation est un **préalable bloquant** : `affecter_tiers` refuse une réservation chez
un tiers si `profiles.contrat_cadre_pro` est absent. Elle est écrite par l'action
`accepter_contrat_cadre` en service role — le navigateur ne peut pas se l'attribuer — et
conserve la **version** acceptée. Toute modification de fond doit incrémenter
`VERSION_CONTRAT_CADRE` : les clients devront réaccepter, et l'on saura quelle rédaction
liait un client à la date d'une prestation donnée.

Sans la migration `2026-08-05_contrat_cadre_professionnel.sql`, l'acceptation ne peut pas être
enregistrée et les réservations chez un tiers restent bloquées pour les comptes
professionnels. C'est volontaire : un engagement qu'on ne peut pas prouver ne sert à rien.
Les réservations ordinaires ne sont pas affectées.

**Ce qu'un prestataire voit avant d'accepter** (18/08/2026) : la ville, la **distance à vol
d'oiseau**, et non l'adresse exacte.

L'adresse complète était transmise à tout prestataire sollicité, y compris à ceux qui
refuseraient. Pour un hôtel, sans conséquence ; pour une prestation au domicile d'un
particulier, c'est l'adresse d'une personne communiquée à quelqu'un qui n'y mettra jamais les
pieds. Elle est **retirée de la réponse serveur**, pas seulement masquée à l'affichage — une
donnée envoyée au navigateur est une donnée communiquée. Elle réapparaît dans `assigned`, dès
l'acceptation.

La distance vient du calcul qui filtrait déjà les candidats (`geocodeFR` + `haversineKm`) :
elle était jetée après usage. Elle est arrondie et affichée avec un tilde — annoncer 12 km
quand la route en fait 20 serait pire que ne rien dire.

Au-delà du confort : plus le prestataire dispose d'éléments objectifs pour accepter ou refuser,
plus son autonomie est manifeste. Une plateforme qui sollicite sans dire où, en comptant sur
l'urgence pour faire accepter, ressemble à une affectation plutôt qu'à une offre.

**Affectation automatique chez un tiers** — `candidatsPourMission()` et l'action
`affecter_tiers` dans `api/missions.js`. Dès qu'une prestation porte une
`tiers_declaration`, le prestataire consulté par le client n'est **pas** transmis :
`affecter_tiers` remplace `assign_after_payment` et la plateforme sélectionne elle-même.

Les critères sont **objectifs et uniquement objectifs** : métier (principal ou secondaire),
secteur, tarif — jamais en dessous du `tarif_net` du prestataire —, jour de disponibilité
déclaré, rayon d'intervention, quota restant. L'ordre est la distance puis la charge du mois.
**Ni note, ni abonnement, ni ancienneté** : un classement fondé sur le comportement donnerait
prise au reproche d'un pouvoir de direction déguisé. Ne pas en ajouter.

`affecterCandidatSuivant()` fait la cascade : un refus (`respond_mission`) ou un délai dépassé
(`acceptance_timeout`) passe au candidat suivant au lieu de rembourser — le client n'a désigné
personne, sa commande tient. À court de candidats, la prestation bascule en `open`, donc en
diffusion : c'est alors le prestataire qui se propose, ce qui rend son autonomie visible et
horodatée.

**Articles 10B.5 à 10B.8** — garanties du client professionnel, droit d'audit sur le contrat
conclu avec le bénéficiaire final, clause d'indemnisation (civile uniquement : elle ne couvre
pas le pénal, qui reste personnel), et fondement contractuel des mécanismes de détection avec
conservation des vérifications.

**Le contrat de prestation ne prétend plus interdire une requalification.** Il affirmait
« Aucune requalification en contrat de travail ne saurait résulter du présent accord » — une
clause qu'un juge ignore, et qui donne l'impression de vouloir neutraliser une règle d'ordre
public. Elle est remplacée par la reconnaissance que la qualification dépend des conditions
réelles d'exécution et relève de l'appréciation souveraine des juridictions.

**Article 10C des CGPS — horaires, décalage et durée facturée.** Le mécanisme de décalage
modifie le montant dû : il devait donc figurer dans les conditions, et y être qualifié. Le
10C.3 énonce que l'ajustement détermine le prix du service réellement exécuté et **n'est ni
une pénalité, ni une sanction**, sans conséquence sur l'accès à la plateforme, le classement
ou le quota — ce qui doit rester vrai dans le code. Le 10C.4 ouvre un réexamen contradictoire
sous quinze jours, le 10C.5 décrit l'annulation sans frais pour retard substantiel.

**La grille de cashback des CGPS doit suivre `CASHBACK_TIERS`.** Elle annonçait une grille qui
n'a jamais existé — 0,5 % sous 10 prestations, 1 % de 10 à 29, 1,5 % au-delà de 30 — alors que
la grille réelle est 0,5 / 0,75 / 1 / 1,5 % aux paliers 0-2, 3-5, 6-9 et 10+. Trois endroits à
garder alignés : `plans.js`, `platform_settings.cashback_rates` et l'article 5B.1.

**`missions.tiers_declaration`** (migration `2026-08-05_declaration_intervention_tiers.sql`)
conserve la déclaration de l'article 10B : bénéficiaire final, service vendu, périmètre et
critères, livrable attendu, et identité de la personne qui organise le travail sur place.
Elle n'est demandée qu'aux **comptes professionnels** qui cochent « exécutée au bénéfice ou
dans les locaux d'un tiers », et les cinq champs conditionnent alors la réservation.

Le point de droit qui justifie ce formulaire : **il n'existe aucun seuil de durée ni de
récurrence**. Une mission d'une journée peut être requalifiée, une prestation récurrente peut
rester licite. Ce qui distingue les deux, c'est l'objet de ce qui est vendu — un livrable, ou
la présence d'une personne. Le formulaire force la première formulation.

La déclaration est envoyée par l'action `declarer_tiers`, **après** la création de la
prestation et sans bloquer : elle a une valeur probatoire, pas opérationnelle, et perdre une
réservation payante parce que la colonne manque serait un remède pire que le mal. Un échec est
journalisé en erreur, avec le contenu déclaré.

**La question du lieu est posée, pas devinée.** Une adresse différente de celle du compte ne
signifie **pas** qu'on intervient chez un tiers : une entreprise multi-sites commande
légitimement ailleurs. Le client professionnel répond donc explicitement — « dans mon
entreprise » ou « chez un tiers » — et sa réponse est enregistrée dans `tiers_declaration`
dans les deux cas. C'est ce qui permet à la détection de distinguer un multi-sites d'un compte
silencieux, au lieu de les confondre.

**Traçabilité des signaux** — actions `traiter_signal` et `historique_conformite` de
`api/bo-action.js`, consignées dans `bo_logs` sous le préfixe `conformite_`. Une détection
qu'on ne traite pas est **pire que pas de détection** : elle établit que la plateforme savait.
Cinq décisions possibles, et « classer sans suite » exige un motif écrit — c'est la plus
exposée, celle qu'il faudra justifier.

**L'axe de la durée** (18/08/2026, sur recommandation du conseil juridique). La détection
mesurait la RÉCURRENCE — un même lieu revient au moins trois fois — sans distinguer un pic de
trois semaines d'une présence continue de six mois. Or c'est la continuité qui caractérise la
mise à disposition durable.

`analyserContinuite()` dans `api/_dependance.js` rend, pour le lieu qui revient le plus : mois
civils consécutifs, mois distincts, jours maximum dans un même mois, et bornes de la période.
Le drapeau `presence_continue` exige **les deux** conditions — au moins 3 mois consécutifs ET
au moins 4 jours dans un même mois. Trois mois à raison d'une venue chacun n'est pas une
présence ; huit jours dans un seul mois est un chantier, pas une intégration.

Les comptes marqués remontent en tête de l'onglet Modération, avec un badge. Comme le reste du
module, **ce ne sont pas des seuils légaux** : ils déclenchent un examen, ils n'absolvent rien,
et ils ne doivent jamais être présentés comme une limite à ne pas franchir.

**Détection des schémas de mise à disposition** — action `signaux_mise_a_disposition` de
`api/bo-action.js`, affichée dans l'onglet Modération. Elle croise le lieu d'intervention des
prestations avec la ville déclarée par le client et ne retient que la **récurrence au même
endroit** (au moins trois fois, sur au moins trois prestations). Aucun signal ne prouve quoi
que ce soit : il désigne les comptes à qui poser une question, première marche de l'escalade
du 10B.4. Les seuils sont volontairement bas et la ville de compte est cherchée dans
`profiles.ville` puis dans `user_metadata` — sans elle, rien n'est signalé plutôt que
d'accuser à tort.

**Article 10B des CGPS — intervention au bénéfice d'un tiers.** La sous-traitance n'est pas
interdite : un client professionnel peut faire exécuter une prestation chez son propre client,
c'est licite. Ce qui est prohibé est le schéma précis — fournir à un tiers un prestataire
nommément désigné ou un volume d'heures, ce tiers exerçant directement sur lui le pouvoir de
direction. Une interdiction plus large aurait bloqué la vraie sous-traitance. Le client
professionnel déclare le bénéficiaire final, le lieu réel, la nature du service vendu et
l'identité de la personne qui organise le travail. L'engagement figure aussi dans le contrat
signé à la commande, seul document opposable aux deux parties.

**Le décalage est un ajustement de prix, jamais une sanction.** La distinction n'est pas
cosmétique : un ajustement automatique décidé par le seul client, appliqué en silence et sans
droit de réponse, constitue un indice de pouvoir disciplinaire — ce qu'une plateforme ne peut
exercer sur un indépendant sans risquer la requalification. Trois règles en découlent, à
préserver : les textes parlent de **durée facturée** et de **temps réalisé**, jamais de
pénalité ni de refus ; le prestataire est **notifié avec les chiffres** et une voie de
contestation (`direction@alane.fr`) ; et le retard **n'alimente ni suspension, ni classement,
ni quota** — vérifié le 05/08/2026, `arrival_delay_minutes` et `delay_status` ne servent qu'au
calcul du prix.

**Un démarrage tardif ne décale pas la fin sans l'accord du client.** Le décalage est
mesuré à deux moments — au pointage d'arrivée (`checkin_mission`) **et** au démarrage
(`start_mission`), le plus défavorable au client étant retenu — au-delà de 15 minutes. Il est
inscrit dans `arrival_delay_minutes` avec `delay_status = "pending"`, et le client est
notifié. Trois issues :

| `delay_status` | Fin de la prestation | Heures facturées |
|---|---|---|
| `approved` | repoussée du retard | heures prévues |
| `rejected` | heure initiale | réduites par `respond_delay` |
| `pending` (sans réponse) | heure initiale | plafonnées à la validation, dans `complete` |

La règle vit à trois endroits qui doivent rester alignés : `api/missions.js` (mesure et
plafonnement), et les deux comptes à rebours — client dans `client-screens.jsx`, prestataire
dans `presta-screens.jsx` — qui s'ancraient auparavant sur `started_at` seul.

**Le passage en `disputed` est borné à 48 h après la fin effective de la prestation**, délai
imposé par les CGPS art. 17.1 (« au-delà de 48 heures sans signalement, la Prestation est
réputée définitivement validée »). Le point de départ est le pointage réel (`started_at`)
s'il existe, sinon l'horaire prévu (`date` + `heure_debut` + `hours`). La règle vit à deux
endroits qui doivent rester alignés : `api/missions.js` (action `dispute`, seul juge) et
`contestationOuverte()` dans `client-screens.jsx`, qui masque le bouton pour ne pas envoyer
l'utilisateur dans un mur. Sans date exploitable, aucun des deux ne bloque.

### Signaler un litige

Deux boutons « Signaler un problème » existent, à deux moments différents. Ils faisaient
**deux choses différentes** jusqu'au 12/08/2026, et un seul protégeait le client.

| Où | Ce qu'il fait |
|---|---|
| Écran de validation (`ValidationScreen`) | Appelle l'action `dispute`. **Corrigé le 12/08** : il se contentait auparavant de créer un ticket de support |
| Historique des prestations (`MissionHistoryScreen`) | Appelle l'action `dispute` — correct depuis toujours |
| Carte d'une prestation terminée (bouton « Signaler un problème ») | Appelle l'action `dispute` **depuis le 21/08/2026** — elle appelait auparavant `raise_dispute` |

**`raise_dispute` a été supprimée le 21/08/2026.** Deux actions faisaient la même chose et
avaient divergé : `dispute` appliquait le délai de 48 h des CGPS et vérifiait le résultat de
ses écritures ; `raise_dispute` appliquait un délai de 7 jours, n'en vérifiait aucune, et
renvoyait `{ success: true }` là où le front teste `j.ok`. Conséquences constatées : le délai
de contestation dépendait du bouton utilisé, et un signalement parfaitement abouti — litige
enregistré, e-mail parti — affichait « Erreur lors de l'envoi du signalement ». L'alerte
administrateur que portait `raise_dispute` a été reprise dans `dispute`.

Le défaut : le bouton de l'écran de validation insérait une ligne dans `support_tickets` et
envoyait un email. La prestation restait `assigned`, **l'auto-validation la clôturait 24 h plus
tard et le virement partait au prestataire**. Le client croyait s'être opposé au paiement ; il
ne s'était opposé à rien.

**Recevabilité** — l'action `dispute` acceptait uniquement `status = completed`. Or le moment
décisif est celui d'avant, quand le client est invité à valider. Elle accepte désormais aussi
une prestation `assigned` dont `validation_prestataire` est vrai.

**Ce qui gèle les fonds** : le passage en `disputed` fait sortir la prestation des deux
filtres qui la feraient avancer — `status=eq.assigned` de l'auto-validation, et
`status=eq.completed` du versement différé. Il n'y a pas d'autre verrou.

**Le signalement avant validation ne fonctionnait pas** malgré son ouverture le 12/08 :
l'action l'acceptait à l'entrée, mais l'écriture filtrait sur `status=eq.completed` seul.
Une prestation encore `assigned` ne correspondait à aucune ligne et le client recevait un
409. Corrigé le 14/08 — le filtre couvre `completed` et `assigned`.

**Le délai de contestation et l'échéance de versement partent du même instant**, la fin
*prévue* de la prestation : `echeanceVersementMs` neutralise `actual_hours`, comme le
contrôle de délai de l'action `dispute`. Sans cela, une prestation écourtée — 2 h déclarées
sur 4 h commandées — voyait son versement partir deux heures avant la fermeture de la
fenêtre, le client pouvant encore signaler un problème sur un argent déjà versé.

**Tranché le 14/08/2026 — le versement est différé de 48 h.** Le virement partait auparavant
à l'instant de la validation, alors que l'article 17.1 accorde au client 48 h pour signaler
un problème *après la fin de la prestation* : ces heures n'existaient donc pas. Un client qui
validait de bonne foi en fin de service puis constatait un défaut l'après-midi même n'avait
plus rien à bloquer, l'annulation du Transfer échouant dès que Stripe a viré les fonds sur le
compte bancaire du prestataire. Voir « Le versement au prestataire » ci-dessous.

### Réserver : ce qui est vérifié, et quand

**Corrigé le 16/08/2026, après un incident en production.** L'ordre des opérations était :

1. le navigateur insère la prestation (`status: "pending_acceptance"`, `prestataire_id: null`) ;
2. `/api/stripe-intent` crée le paiement — il vérifiait le montant, pas le secteur ;
3. Stripe encaisse ;
4. `assign_after_payment` affecte le prestataire — **et c'est seulement là** que le secteur,
   l'activation du prestataire, son tarif et son rayon d'intervention étaient contrôlés.

Un refus à l'étape 4 laissait donc le client débité, la prestation sans prestataire et sans
`acceptance_deadline` — donc invisible de tous les traitements automatiques, rien ne la
reprenait jamais — et le prestataire jamais sollicité. Le message affiché disait « votre
paiement a bien été enregistré », ce qui était exact et sans recours.

**Deux corrections, à deux niveaux.**

*La cause* : le secteur est désormais vérifié dans `/api/stripe-intent`, **avant** que le
moindre euro ne bouge. Refuser là ne coûte rien au client. La règle et son cache ont pour
cela été sortis de `api/missions.js` vers `api/_secteurs.js`, seul moyen que les deux chemins
lisent la même chose plutôt que d'en recopier une troisième version.

*Le filet* : les quatre autres refus de `assign_after_payment` — prestataire indisponible,
prestataire non activé, tarif incohérent, adresse hors zone — et les deux de
`affecter_tiers` **remboursent intégralement et annulent la prestation**
(`rembourserRefusApresPaiement`). Le remboursement porte sur la totalité, frais de service
compris : le client n'a commis aucune faute, c'est la Plateforme qui refuse — même règle que
l'annulation par le prestataire (CGPS art. 8).

Le message rendu au client dit ce qui s'est réellement passé, et **ne promet jamais un
remboursement qui n'a pas eu lieu** : si Stripe refuse, il invite à écrire au support et
l'incident est journalisé en erreur. Le message générique du front (« votre paiement a bien
été enregistré ») n'est plus ajouté lorsque le serveur a déjà parlé de l'argent — il
affirmait au client qu'il était débité alors qu'il venait d'être remboursé.

Le refus est idempotent : la clé `refus-<mission_id>` empêche qu'un client qui réessaie
déclenche un second remboursement du même paiement.

**Le tunnel de réservation affichait deux fois le récapitulatif.** `BookingScreen` contenait
les étapes 2 et 3 **en double**, et le premier exemplaire de l'étape 3 embarquait sous le
récapitulatif une copie entière du formulaire de l'étape 1, second bouton « Continuer »
compris. L'écran de paiement enchaînait donc : récapitulatif, formulaire de réservation,
récapitulatif, paiement. Les deux copies de l'étape 2 étaient identiques ; celles de
l'étape 3 avaient déjà divergé. Supprimé.

### Un secteur fermé ne montre plus rien

**Corrigé le 16/08/2026.** Le contrôle du secteur existait sur le paiement, pas sur la
vitrine. Un secteur fermé faisait quand même apparaître ses prestataires dans « Top
prestataires », dans le catalogue et dans la recherche : le client en choisissait un,
remplissait tout le formulaire, et se faisait refuser au moment de payer.

C'est exactement le défaut déjà corrigé pour `missions_enabled` — une règle appliquée à
l'affectation mais pas à l'affichage.

Le filtrage vit dans **`/api/prestataires`**, source unique du catalogue client (dix écrans
l'utilisent via `useProviders`). L'effectif y est compté sur la population déjà chargée —
exactement celle que compte `etatSecteursAvecCache` : prestataires approuvés, accès aux
prestations activé, secteur lu dans `user_metadata`. Aucun second recensement des comptes, et
surtout aucune seconde version de la règle.

**Deux garde-fous, parce que masquer est dangereux.** `lireReglagesSecteurs` renvoie désormais
`lu`, qui distingue « réglages lus » de « réglages retombés sur leurs valeurs par défaut » :
sans cette distinction, une panne de lecture d'une seconde appliquerait le seuil par défaut,
fermerait tous les secteurs et **viderait la vitrine**. Réglages illisibles → aucun filtrage.
De même, un secteur inconnu du module n'est jamais masqué. Le filtrage est un affinage, pas
une sécurité : le refus de réservation reste assuré par `/api/stripe-intent`.

**La tuile d'un secteur fermé affichait `3/undefined presta`.** `ss.min` n'a jamais existé —
l'API renvoie `seuil`. Mais le vrai problème n'était pas la faute de frappe : afficher
l'effectif contredit `messageSecteurFerme`, qui s'interdit délibérément de le dire au client
pour ne pas lui donner la mesure exacte de la faiblesse du réseau. La tuile affiche
« Bientôt », sans chiffre.

**Conséquence pratique au démarrage** : le seuil d'ouverture automatique est à 20 prestataires.
Tant qu'un secteur est sous ce seuil, il faut l'inscrire dans `forced_open_sectors` depuis le
backoffice pour que ses prestataires soient visibles — sans quoi le catalogue reste vide, ce
qui est désormais le comportement correct et non plus une incohérence.

**Le réglage avait deux boutons « Sauvegarder » identiques**, côte à côte : l'un enregistrait
`disabled_sectors`, l'autre `forced_open_sectors`, et rien ne disait lequel. Cocher « Ouvrir
malgré le seuil » puis cliquer sur celui de gauche enregistrait l'autre réglage — la coche
était perdue en silence, et le secteur restait invisible aux clients sans qu'on sache
pourquoi. Un seul bouton enregistre désormais les deux clés, le second seulement si le
premier a réussi : une erreur suivie d'un « ✓ Sauvé » ferait croire que tout est passé.

### Le contrôle des tables mortes confondait « vide » et « jamais analysée »

**Corrigé le 17/08/2026, après l'avoir passé.** La septième requête de `npm run rls` lisait
`pg_class.reltuples` pour estimer le nombre de lignes. Or PostgreSQL y écrit **-1** tant que la
table n'a jamais été analysée — ce qui n'a rien à voir avec une table vide.

Sur la base réelle, onze tables ressortaient à `-1`, dont `messages`, `ratings` et `contracts`.
Prises pour vides, elles auraient été candidates à la suppression. **Le contrôle censé
identifier les tables mortes désignait des tables pleines.**

Il compte désormais réellement, via `query_to_xml` — un compte par table, sans écrire une
requête par table.

**Ce que le passage a donné.** Six tables sans aucune policy : `account_blacklist`, `bo_logs`,
`bo_rate_limits`, `booking_drafts`, `factures_archives`, `wallet_topups`. Aucune n'est touchée
depuis `src/` — vérifié. Zéro policy y est donc **la bonne réponse** : c'est ce qui les réserve
au serveur.

Une table sans policy n'est une anomalie que si l'application y accède : l'écran afficherait
alors une liste vide sans jamais dire pourquoi.

### Les jumelles invisibles

**Constaté après avoir fermé les quatre droits ouverts, le 17/08/2026.** Le relevé suivant a
montré que les policies fermées avaient des **jumelles** — invisibles jusque-là parce qu'elles
portent sur `authenticated` et non `public`, et que la requête de diagnostic ne remontait que
les secondes :

```
contracts    | contracts_insert / contracts_select / contracts_update
candidatures | cand_insert / cand_select / cand_update
documents    | docs_select   (en double avec documents_presta_own)
```

**Fermer une porte pendant qu'une seconde reste ouverte à côté ne ferme rien.** Ce ne sont pas
deux règles identiques : ce sont deux règles pour le même geste, écrites à deux moments, dont
une seule apparaissait dans le contrôle.

`contracts` : `src/` contient exactement **un** accès — une insertion à la signature. Aucune
lecture, l'écran de contrat lit `missions`. `contracts_update` permettait donc de modifier un
contrat signé, pour un geste que personne ne fait.

`candidatures` : un seul accès, une **lecture** côté client. `cand_insert` et `cand_update`
laissaient ouverte une écriture vers un chemin qui mène à de l'argent — une candidature
acceptée déclenche un PaymentIntent — pour une fonctionnalité qui n'existe pas.

**La leçon sur le contrôle lui-même** : filtrer sur `public` ne suffisait pas. Le relevé
complet, sans filtre de rôle, est celui qui a tout montré — et c'est celui qu'il faut passer.

### Quatre droits ouverts sur des gestes que l'application ne fait pas

**Dernier résultat du diagnostic RLS, le 17/08/2026.** Quatre policies `ALL` — donc SELECT,
INSERT, UPDATE **et DELETE** — et deux doublons. Chacune correctement bornée aux lignes de
l'intéressé ; aucune ne correspondant à un geste réel de l'application.

| Règle | Ce qu'elle permettait |
|---|---|
| `documents.docs_own` (ALL) | Un prestataire pouvait **supprimer ses propres pièces** — identité, Kbis, RC Pro — y compris après vérification. L'article 14.4 dit l'inverse : la trace de la vérification est conservée « ALANE devant pouvoir justifier de ses obligations de vigilance ». Une trace que l'intéressé efface ne justifie rien. L'application ne fait que déposer et lire |
| `contracts.contracts_client_own` (ALL) | Même défaut sur la pièce la plus lourde : le client pouvait réécrire ou **faire disparaître le contrat signé** — ce qui prouve ce qui a été commandé, à quel prix, par qui |
| `tracking_positions.tracking_presta_write` (ALL) | **Le contournement de la fenêtre de partage** fermée le matin même. Le contrôle vit dans `update_position` ; cette règle permettait d'écrire directement dans la table. L'application ne touche jamais cette table |
| `candidatures.candidatures_presta_insert` | Une écriture vers un chemin qui mène à de l'argent — une candidature acceptée déclenche un PaymentIntent — pour un geste que **l'application ne propose pas** : ni bouton « postuler », ni insertion dans `src/` |

Plus deux policies de lecture sur `missions` qui se répètent : les policies permissives
s'additionnent, `missions_select` n'ajoute rien à `missions_open_read` sinon la règle qu'on
oubliera de modifier le jour où la règle change.

`contracts` reçoit deux règles explicites — lecture et création — à la place de son `ALL`.

**C'est le même motif pour la cinquième fois de la journée** : un droit ouvert « au cas où »,
sur un geste que personne ne fait, et qui se trouve contourner un contrôle serveur écrit
ailleurs avec soin.

### La preuve et les dates étaient réécrivables

**Suite du précédent, le 17/08/2026.** Le relevé de ce qui restait modifiable après la première
migration a montré trois familles oubliées. La première visait l'argent et les droits ;
celle-ci vise **la preuve et les dates**.

| Colonne | Ce qu'elle permettait |
|---|---|
| `invoice_number` | Le numéro de facture, réécrivable par le client comme par le prestataire. `api/invoice.js` le dit lui-même : « numérotation continue, sans rupture ». C'est une obligation (art. 289 CGI), et le mandat de facturation qu'ALANE exerce repose entièrement sur cette séquence |
| `contrat_client_signe_at` / `contrat_presta_signe_at` | **Ces deux dates *sont* la signature** — il n'y a rien d'autre. L'article 11 du contrat leur donne la valeur d'une signature manuscrite (eIDAS, art. 1366 C. civ.). Chaque partie pouvait effacer la sienne, ou inscrire celle de l'autre |
| `date`, `date_debut`, `date_fin`, `heure_debut` | Tout en dépend : fenêtre de pointage, heures supplémentaires, délai de réclamation, échéance de versement. Déplacer la date d'une prestation réservée déplace toutes ces bornes d'un coup, sans que l'autre partie le sache |

La création n'est pas concernée — elle relève de l'INSERT. Un changement de date après
réservation est une modification du contrat, et passe donc par le serveur.

**Ce qui reste volontairement modifiable** : `validation_client` et `validation_prestataire`.
L'écran de validation les écrit directement, en même temps que les notes et commentaires ; les
fermer casserait ce geste. Elles ne déplacent pas d'argent par elles-mêmes — c'est `complete`
qui programme le versement, et elle refait ses propres contrôles. À reprendre le jour où cet
écran passera par `/api` comme le reste.

**Deux colonnes mortes découvertes au passage**, et supprimées le même jour : `nb_heures` et
`stripe_transfer_id_col` n'étaient référencées **nulle part** — ni dans `api/`, ni dans `src/`,
ni ici — et le comptage a confirmé qu'elles étaient vides.

La première ressemble à un ancien nom de `hours`, la seconde à une colonne créée par erreur à
côté de `stripe_transfer_id` : le suffixe `_col` a tout d'un copier-coller resté en place.

Le risque n'était pas ce qu'elles contenaient, mais ce qu'elles attendaient. Le jour où
quelqu'un écrit dans `stripe_transfer_id_col` en croyant écrire dans `stripe_transfer_id`, le
virement devient intraçable : `stripe-refund` lit la seconde pour annuler un transfert, et ne
trouverait rien. Aucun message — juste une colonne remplie que personne ne regarde, et une
autre restée vide.

Même raisonnement que pour les six tables mortes du 05/08/2026 (`2026-08-17_colonnes_mortes.sql`).

### Le navigateur pouvait fixer le montant de son propre virement

**Le résultat le plus grave du diagnostic RLS, le 17/08/2026.** Trois règles de mise à jour
sans aucune restriction de colonne :

```
missions  | missions_update | UPDATE | {public}        | USING (client_id = uid OR prestataire_id = uid)
profiles  | profiles_update | UPDATE | {authenticated} | USING (uid = id)
documents | docs_update     | UPDATE | {authenticated} | USING (uid = prestataire_id)
```

Elles décident correctement **quelles lignes** chacun peut modifier : les siennes. Elles ne
disent rien de **quelles colonnes** — et c'est là que tout se joue, parce qu'une ligne « à
soi » contient aussi ce qu'on se doit à soi-même.

| Table | Ce qu'on pouvait s'écrire |
|---|---|
| `missions` | `payout_amount = 9999`, `payout_status = 'pending'`, `payout_due_at = hier`. Le traitement des versements lit exactement ces colonnes et vire le montant : **chemin direct vers un virement choisi**. Côté client, `montant_total` et `hours` — donc le prix et ce qui reste de frais après clôture |
| `profiles` | `plan_abonnement = 'elite'` (illimité, sans payer), `missions_enabled = true` (accès sans vérification), `status = 'approved'`, `cashback_balance = 500` |
| `documents` | `verified = true` sur ses propres pièces : le badge « vérifié » sans qu'aucune pièce ait été regardée — l'obligation de vigilance qui tombe |

**La correction ne touche pas aux règles** : les lignes restent les bonnes. Elle retire
l'écriture sur les colonnes qui ne regardent que le serveur.

La méthode est volontairement **inverse d'une liste blanche** : on autorise toutes les colonnes
de la table sauf celles nommées. Une liste blanche écrite à la main aurait cassé la première
écriture légitime oubliée — et il y en a beaucoup, réparties dans l'inscription, l'édition de
profil, le dépôt de documents. L'inventaire vient d'`information_schema`, donc de la base
elle-même, jamais d'une liste recopiée qui divergerait.

**Le motif de la journée, une quatrième fois.** `messages_ecriture`, les deux `ratings_insert`,
et maintenant ces trois-là : à chaque fois, un contrôle serveur soigneusement écrit, et une
règle de base qui laissait le navigateur l'ignorer. **Un contrôle serveur ne protège rien tant
que la base accepte l'écriture directe.**

### Les avis pouvaient être déposés sans passer par les contrôles

**Troisième résultat du diagnostic RLS, le 17/08/2026.** `ratings` portait **deux** policies
d'insertion, toutes deux pour le rôle `public` :

```
ratings | ratings_insert               | INSERT | {public}
ratings | users can insert own ratings | INSERT | {public}
```

Le doublon n'est pas l'essentiel. Le dépôt d'un avis passe par `submit_rating`, qui vérifie que
la prestation existe, que l'appelant y a pris part, qu'elle est terminée, et qu'il n'a pas déjà
donné son avis. Ces contrôles ont été ajoutés **parce qu'ils manquaient** : « rien n'empêchait
de noter n'importe qui, autant de fois que voulu », et la note pilote le classement du
catalogue.

Or une policy d'INSERT laisse le navigateur écrire **directement** dans la table. Les quatre
contrôles étaient donc contournables — même forme que `messages_ecriture`, fermée quelques
heures plus tôt : **un contrôle serveur ne protège rien tant que la base accepte l'écriture
directe**.

Les deux règles sont retirées. Aucun code front n'en avait besoin : les trois usages de
`ratings` côté application sont des lectures.

### Messagerie : n'importe qui pouvait écrire à n'importe qui

**Deuxième résultat du diagnostic RLS, le 17/08/2026.** La règle d'écriture :

```
messages_ecriture | INSERT | {authenticated}
  WITH CHECK (sender_id = auth.uid()
              AND conversation_key LIKE '%' || auth.uid() || '%')
```

Elle vérifie que l'auteur déclaré est bien l'appelant, et que son identifiant figure dans la
clé. **Elle ne vérifie pas que l'autre participant ait le moindre rapport avec lui.**

La clé s'écrit `prov{prestataire}-user{client}`, et les identifiants des prestataires sont
publics — ils figurent dans le catalogue. N'importe quel compte pouvait donc fabriquer la clé
`prov{X}-user{moi}` et écrire dedans : sans prestation, sans relation, sans que X puisse s'y
opposer.

Le tag n'était pas contraint non plus. Un prestataire pouvait insérer un message portant
`sender_tag = 'client'` : l'écran affiche les messages selon ce tag, le message apparaissait
donc **du mauvais côté de la conversation**.

Ce n'est pas anodin. L'article 17.1 des CGPS fait des messages une **pièce** : « Les messages
échangés via la Plateforme ne peuvent être supprimés par leurs auteurs. Ils sont conservés en
l'état […] pour les besoins de la preuve. » Une preuve dont l'apparence d'auteur se falsifie
n'en est pas une.

**L'écriture est retirée au navigateur.** Tout passe par `envoyer_message`, qui exige une
prestation en commun puis dérive lui-même la clé et le tag. Le service role n'étant pas soumis
à la RLS, l'insertion serveur continue sans policy dédiée.

⚠️ La migration se passe **après** le déploiement de `envoyer_message` : appliquée avant, elle
couperait l'envoi.

**La lecture est laissée en l'état**, et elle tient — mais pour une raison fragile : la clé
contient les deux identifiants entiers, séparés par `-user`, qui n'apparaît dans aucun UUID. Un
identifiant ne peut donc ni s'y retrouver par accident, ni chevaucher la frontière. La règle est
juste **tant que le format de la clé ne change pas** : elle repose sur une convention de
nommage, pas sur un modèle. C'est le point de fond qui reste ouvert.

### Les avis étaient lisibles en entier, sans compte

**Premier résultat du diagnostic RLS, le 17/08/2026.** Deux règles sur `ratings`, toutes deux
`USING (true)`, toutes deux pour le rôle `public` :

```
ratings | ratings are readable by all | SELECT | {public} | true
ratings | ratings_read                | SELECT | {public} | true
```

`public` en PostgreSQL ne veut pas dire « visible de tous » mais **tous les rôles**, `anon`
compris — la clé embarquée dans le navigateur, lisible dans le code de la page.

La table entière était donc interrogeable sans compte : `reviewer_id`, `mission_id`,
`reviewee_provider_id`, `reviewee_name`, `comment`. Les trois premiers réunis dressent **la
carte de qui a travaillé avec qui, et quand**. Ce sont des données personnelles.

Rien dans l'application n'en avait besoin : l'écran de profil n'affiche que la note, la date et
le commentaire. `reviewer_id` était sélectionné par le front **sans jamais être utilisé**.

**La correction ne ferme pas la lecture publique** — les avis doivent être visibles d'un
visiteur non connecté, c'est leur raison d'être. Elle la ramène aux colonnes affichées, par des
droits de colonne : la RLS décide quelles **lignes** sont lisibles, les `GRANT` décident quelles
**colonnes**.

Une seule lecture avait réellement besoin de `reviewer_id` — « quelles prestations ai-je déjà
notées ? ». Elle filtrait dessus, et **filtrer sur une colonne exige de pouvoir la lire** :
c'est ce seul besoin qui maintenait la colonne ouverte à tous. Elle est passée par `/api`
(`mes_avis`), où le serveur filtre pour l'appelant sans rien exposer.

Et les deux règles n'en font plus qu'une. Deux policies identiques, c'est une que personne ne
relit.

### `npm run rls` — la seule zone qu'un audit du dépôt ne couvre pas

Les règles de sécurité vivent dans la base, pas dans le code. Aucun contrôle du dépôt ne peut
les voir — et ce sont elles qui décident qui lit quoi.

Le précédent est connu : six tables mortes portaient à elles seules **vingt-cinq règles que
plus personne ne relisait**, dont une ouverte au rôle `public`. Une table oubliée avec une
policy permissive n'encombre pas : elle expose.

`scripts/verifier-rls.sql` (affiché par `npm run rls`) pose sept questions, à passer dans
l'éditeur SQL Supabase :

| # | Question | Attendu |
|---|---|---|
| 1 | Tables **sans RLS** | 0 ligne — sans RLS, la clé du navigateur lit et écrit tout |
| 2 | Policies ouvertes à `public` ou `anon` | Chaque ligne justifiable ; une écriture, presque jamais |
| 3 | Policies **sans condition** (`USING (true)`) | 0 ligne, sauf justification écrite au §5 |
| 4 | Écritures autorisées sur les tables sensibles | L'argent et les statuts passent par `/api` |
| 5 | Les règles de `messages` | À lire en entier — le modèle de participants n'existe pas |
| 6 | Tables verrouillées (RLS active, zéro policy) | Pas une faille : un blocage silencieux |
| 7 | Tables vides portant encore des policies | Le précédent des six tables mortes |

Ce n'est pas un contrôle automatique et ça ne peut pas l'être. C'est une relecture, à faire
avant toute mise en production et après toute migration touchant aux droits.

### Messagerie : la clé de conversation ne vient plus du navigateur

**Corrigé le 17/08/2026.** L'insertion d'un message se faisait **depuis le navigateur**, et
c'est lui qui choisissait `conversation_key` et `sender_tag`.

Or ces deux valeurs sont **la seule chose** qui rattache un message à une conversation et à son
auteur : la table `messages` n'a pas de modèle de participants, et les règles de sécurité
elles-mêmes lisent la chaîne de caractères — c'est le point ouvert documenté depuis des mois.

L'action `envoyer_message` dérive désormais les deux **de la prestation partagée** : elle exige
une prestation en commun entre l'auteur et le destinataire — le même contrôle que `chat_notify`
appliquait déjà pour la notification, mais pas pour le message lui-même — puis construit la clé
et le tag à partir de `client_id` et `prestataire_id`. Le navigateur n'envoie plus que le
destinataire et le texte, tous deux bornés.

**Ce n'est pas la refonte du modèle de conversation**, qui reste à faire. C'est ce qu'on peut
faire sans elle : retirer au client la main sur ce qui l'identifie. La lecture reste gouvernée
par la RLS, qu'aucun code ne peut corriger depuis l'extérieur.

Le comptage des non-lus, lui, cherche toujours l'identifiant de l'utilisateur **par `ILIKE`
dans la clé**. Cela fonctionne, mais c'est le symptôme du même défaut de modèle : une
appartenance qui se prouve par une sous-chaîne. À reprendre avec la refonte.

### Prestations récurrentes : un paiement calculé sur un seul jour

**Trouvé le 17/08/2026** en auditant les calculs multi-jours. Le paiement d'une **candidature
acceptée** — le parcours où un prestataire se porte candidat sur une prestation ouverte, puis
le client règle — calculait `tarif × heures`. Sans les **jours**, sans les **frais de service**.

C'était une troisième version du montant, distincte de celle du tunnel de réservation et de
celle de la clôture.

Sur cinq jours à 8 h et 15 €/h : **120 € encaissés au lieu de 626,50 €**. La clôture, elle,
compte bien les cinq jours — et comme les frais se déduisent de ce qui reste du montant payé,
ils tombent à zéro par-dessus le marché :

| | Attendu | Ancien calcul |
|---|---|---|
| Encaissé | 626,50 € | **120,00 €** |
| Dû au prestataire | 600,00 € | 600,00 € |
| Frais de service | 26,50 € | **0,00 €** |

**480 € de perte** sur une seule prestation.

Le montant vient désormais de `nombreDeJours` et `calculerFrais`, les mêmes fonctions que le
tunnel. Et `montant_total` est écrit avec ce qui va réellement être encaissé : sans cette
écriture, la clôture déduirait les frais d'un montant périmé, ce qui est précisément ce qui les
faisait disparaître.

### L'audit des écritures qui suivent un mouvement d'argent

**Mené le 17/08/2026**, après que quatre pannes de la même famille sont apparues en une
journée. La question posée : `cancellation_reason` était-elle isolée ?

Non. `npm run ecritures` relève les PATCH/POST vers `missions` ou `profiles` qui touchent une
colonne d'argent ou de statut sans que le résultat soit exploité. **45 au premier passage.**
Trois d'entre elles suivaient un mouvement d'argent réel :

| Où | Ce qui se passait |
|---|---|
| `stripe-webhook` — `checkout.session.completed` | **L'abonnement était payé et le plan jamais accordé.** L'écriture dans `auth` était vérifiée, celle dans `profiles` non — or c'est `profiles` que lit l'application, `user_metadata` n'étant jamais consulté pour le plan |
| `stripe-webhook` — `subscription.updated` / `.deleted` | Même chose dans les deux sens : un abonnement résilié restant « premium » offre un quota que plus personne ne paie |
| `stripe-refund` | Remboursement parti, prestation jamais close : elle se clôturait d'elle-même et le prestataire était payé sur un montant déjà rendu |
| `presta_cancel` | Remboursement parti, prestation toujours attribuée au prestataire qui venait d'annuler |

Toutes vérifient désormais leur résultat. Les webhooks répondent **500**, ce qui fait réessayer
Stripe — c'est ce que le même fichier faisait déjà pour l'écriture voisine, et personne n'avait
remarqué que la seconde ne le faisait pas.

**Le script n'est pas branché sur `npm run coherence`, volontairement.** Il reste 41
signalements, et beaucoup sont légitimes : compteurs, horodatages accessoires, écritures dont
l'échec est sans conséquence. Le critère qui compte — « de l'argent a-t-il déjà bougé avant
cette ligne ? » — ne se décide pas automatiquement. C'est une liste à relire, pas une liste à
corriger ; en faire un bloqueur produirait un contrôle qu'on ignore.

### Le bouton « Ma facture » ne faisait rien sur iPhone

**Signalé par Alexandre le 17/08/2026.** On appuie, et rien ne se passe. Aucune erreur, aucun
message : impossible même de savoir que quelque chose avait échoué.

Les deux boutons — celui du client, celui du prestataire — appelaient `window.open()` **après
deux `await`** : la lecture de la session, puis la génération du jeton. À cet instant, le
navigateur ne rattache plus l'ouverture au clic, et **Safari sur iOS la bloque silencieusement**.
Sur un poste de bureau, l'ouverture passait ; c'est pourquoi le défaut n'avait jamais été vu.

`ouvrirFacture()` (`src/components/ui.jsx`) ouvre l'onglet **tout de suite, dans le geste**, y
affiche « Préparation de la facture… », puis y envoie l'adresse une fois le jeton obtenu.

Si l'ouverture est refusée malgré tout — bloqueur strict, mode restreint — la facture s'affiche
dans **l'onglet courant** plutôt que de ne rien faire. Un échec qui ne se voit pas est pire
qu'un échec.

Vérifié en navigateur, sur les trois propriétés qui comptent : `window.open` est bien appelé
avant le premier `await`, le repli s'active quand l'onglet est refusé, et le jeton arrive
intact à destination.

### Les heures supplémentaires sont payées avant d'être appliquées

**Corrigé le 17/08/2026.** Elles n'étaient facturées à **personne**. Le client demandait, le
prestataire acceptait, et le code se contentait d'augmenter `hours`.

À la clôture, la part du prestataire suit les heures et les frais de service se déduisent de ce
qui reste du montant encaissé. Avec des heures gonflées et un encaissement inchangé, **les deux
dérivent ensemble** :

| | Avant | Après +1 h |
|---|---|---|
| Encaissé auprès du client | 19,90 € | **19,90 €** |
| Dû au prestataire | 15,00 € | **30,00 €** |
| Frais de service | 4,90 € | **0,00 €** |

Soit **10,10 € de perte** sur une heure ; plus de 50 € sur une prestation de 8 h prolongée de
2 h à 25 €/h. Un test reproduit ce calcul, chiffres à l'appui — il n'existe pas pour vérifier
le code d'aujourd'hui, mais pour que personne ne rétablisse l'ancien comportement en croyant
simplifier.

**Le nouveau parcours.** `extra_hours_status` gagne l'état `accepte_presta` : le prestataire a
accepté et **annoncé son tarif**, le client n'a pas encore payé. Rien ne s'applique dans cet
état — ni la durée, ni le montant.

1. le client demande *n* heures ;
2. le prestataire accepte **et fixe son tarif** pour ces heures (`extra_hours_tarif`). Il fixe
   librement son prix (CGPS art. 6.1), et une prolongation imprévue n'a pas de raison d'être
   vendue au tarif d'un créneau réservé à l'avance ;
3. le client voit le détail — heures, frais, total — et règle ;
4. `confirmer_heures_supp` **vérifie le paiement auprès de Stripe** : statut `succeeded`,
   `metadata.mission` égale à la prestation, montant reçu ≥ montant dû. Alors seulement `hours`
   et `montant_total` bougent.

Se fier à ce que le navigateur affirme reviendrait à laisser le client s'accorder des heures
gratuitement. Le montant du PaymentIntent est lui aussi calculé côté serveur, depuis la
proposition enregistrée — jamais depuis ce que l'écran envoie.

**Les frais de service du complément ne comportent que leur part proportionnelle.** La part
fixe rémunère la mise en relation : elle a déjà eu lieu, et elle est déjà payée. La part
proportionnelle, elle, reste due — les CGPS disent qu'elle « couvre notamment les frais
prélevés par le prestataire de services de paiement », et ces frais-là s'appliquent bien au
nouvel encaissement. Le calcul vit dans `api/_heures_supp.js`, appelé par les trois chemins qui
doivent annoncer le même chiffre.

Deux verrous contre le double effet : le PATCH filtre sur `extra_hours_status=eq.accepte_presta`,
et un index unique sur `extra_hours_payment_intent` empêche qu'un même paiement serve deux fois.

Si l'application échoue **après** le paiement, la réponse le dit — « votre paiement est bien
enregistré mais la prolongation n'a pas pu être appliquée » — et l'incident part en erreur dans
les journaux. Laisser croire à un règlement perdu serait pire que l'échec.

### Les heures supplémentaires se ferment 20 minutes après la fin

**Demandé par Alexandre le 17/08/2026.** La demande n'était bornée par rien — ni à l'écran, ni
côté serveur. Elle restait proposée jusqu'à la validation de la prestation, donc parfois des
heures après le départ du prestataire.

Ce n'est pas seulement incohérent : **accepter une telle demande rallonge `hours`**, donc le
montant dû, donc le versement — sur des heures que personne n'a travaillées.

`fenetreHeuresSupp()` (`api/_temps.js`) ferme la demande **20 minutes après la fin**. Le délai
laisse le temps de se décider pendant que le prestataire est encore là ; au-delà, ce n'est plus
une prolongation, c'est une nouvelle prestation, et elle se réserve.

La règle est appliquée **aux trois endroits** : l'action `request_extra_hours`, l'écran de
suivi et l'historique des prestations. Le bouton disparaît, et le serveur refuse.

Fin illisible : la fenêtre reste **ouverte**. Refuser une prolongation sur une date mal formée
pénaliserait un client qui n'y est pour rien — et la demande reste de toute façon soumise à
l'accord du prestataire, qui, lui, sait s'il est encore sur place.

**`finMs()` suit désormais le pointage réel** dans `src/lib/accueil.js`, comme le fait déjà
`finPrestationMs` côté serveur : une prestation commencée avec du retard finit avec du retard.
Sans cet alignement, l'écran et la base auraient répondu différemment à la question « quand
cette prestation est-elle finie ? » — et c'est cette réponse qui ferme la fenêtre.

### La relance de validation ne créait aucune notification

**Signalé par Alexandre le 17/08/2026** : ni le prestataire ni le client ne reçoivent de
notification pour valider la fin d'une prestation.

Le traitement de relance existait pourtant, et il tournait. Mais il n'envoyait **que des
e-mails et des SMS** — jamais de notification dans l'application, jamais de notification
poussée. La cloche restait vide, alors que c'est le premier endroit où l'on regarde.

Pire : tout le bloc était conditionné à `if (pastMissions.length && RESEND_API_KEY)`. **Sans
clé Resend, plus rien ne partait du tout** — pas même ce qui n'a rien à voir avec l'e-mail.

Les notifications in-app et poussées partent désormais **d'abord**, indépendamment de toute
clé tierce. L'e-mail et le SMS restent, en plus.

L'horodatage anti-répétition (`last_validation_reminder_at`) est posé avec les notifications
et non plus avec les e-mails : il ne dépend donc plus d'un envoi tiers. Son échec est
journalisé — sans lui, la relance repart à chaque passage, toutes les deux heures.

**L'autre chemin de notification a une condition qui l'annule souvent.** L'action `notify_end`
crée bien les deux notifications, mais elle refuse si `started_at` est vide — donc si le
prestataire n'a jamais appuyé sur « Je commence », ce qui était précisément le cas tant que le
bouton de démarrage était inatteignable. Et elle n'est déclenchée que par l'écran du client,
donc seulement s'il a l'application ouverte. Le traitement automatique est le seul chemin
fiable ; c'est celui qui manquait.

**`sendWebPush` existait en deux exemplaires** — `api/missions.js` et `api/cron-abandon.js` —
déjà divergents. Le commentaire du second justifiait la copie par des « imports relatifs non
fiables sur Vercel », alors que `_temps.js`, `_email.js` et `_cloture.js` sont importés d'un
fichier à l'autre depuis toujours. Les deux fonctions vivent maintenant dans `api/_push.js`,
et les trois appelants l'importent.

### Pointage : cinq bornes différentes pour deux boutons

**Signalé par Alexandre le 17/08/2026** : à l'heure pile, aucun bouton ne permettait de
déclarer sa présence ni de démarrer.

La règle existait en **cinq exemplaires**, avec cinq bornes différentes :

| Où | Borne |
|---|---|
| « Je suis sur place », écran | à partir de l'heure de début |
| « Je suis sur place », **serveur** | **aucune** — on pouvait pointer trois jours avant |
| « Je commence », écran (cas GPS) | une heure avant |
| « Je commence », écran (cas arrivé) | cinq minutes avant |
| « Je commence », serveur | cinq minutes avant, jusqu'à H+2 h |

Conséquence directe : le bouton de démarrage apparaissait **une heure avant**, et le serveur
le refusait pendant cinquante-cinq minutes. Et un prestataire arrivé en avance ne pouvait rien
déclarer, alors que le serveur, lui, l'aurait accepté n'importe quand.

**La règle est désormais unique** — `fenetrePointage()` dans `api/_temps.js` :

- **arrivée** : de H−15 min à H+2 h ;
- **démarrage** : de H à H+2 h, et seulement après une arrivée déclarée.

Un quart d'heure d'avance couvre le prestataire ponctuel sans lui permettre de déclarer une
présence sans rapport avec la prestation. Au-delà de deux heures de retard, ce n'est plus un
pointage, c'est un litige.

**La fonction prend un instant, pas une prestation** — et c'est délibéré.
`debutPrestationMs()` interprète une date naïve dans le fuseau du runtime puis applique le
décalage français : juste sur Vercel, qui tourne en UTC, **faux dans un navigateur** déjà à
l'heure de Paris. Chaque côté calcule donc l'instant à sa façon (`debutLocalMs` côté écran) ;
seule la règle est partagée.

Horaire illisible : les deux gestes sont **autorisés**. Empêcher un prestataire de déclarer
qu'il travaille parce qu'une date est mal formée serait le punir d'un défaut qui n'est pas le
sien — et le client, lui, attend sur place.

### L'accueil client montre la prochaine prestation

**Ajouté le 17/08/2026, à la demande d'Alexandre.** Il fallait ouvrir « Prestations » puis
l'onglet « Assignées » pour voir une prestation réservée : deux clics pour l'information la
plus attendue de l'écran.

L'accueil avait pourtant déjà deux blocs — mais aucun ne couvrait ce cas :

| Bloc | Quand il s'affiche |
|---|---|
| « Prestation à valider » (bandeau fixe) | Le prestataire a confirmé la fin |
| « Prestation en cours » (carte flottante) | Uniquement **pendant** le créneau |
| **« Prochaine prestation »** (nouveau) | La prestation n'a pas encore commencé |

La nouvelle carte est **dans le flux**, et non en surimpression : trois éléments flottants
superposés rendraient l'accueil illisible, et celui-ci informe — il n'interrompt pas. Elle
couvre aussi `pending_acceptance`, l'état où le client a payé et attend une réponse : c'est
précisément le moment où il a besoin de voir sa prestation.

**Deux sources devenaient une.** « À valider » venait de `/api/missions` toutes les 8 s,
« en cours » d'une requête Supabase directe toutes les 60 s — et cette seconde requête
**oubliait `actual_hours` dans son `select`** : une prestation prolongée disparaissait de
l'écran avant d'être finie. Les trois états sont désormais dérivés du même chargement.

Le tri vit dans `src/lib/accueil.js` (`etatAccueil`), hors du composant, pour être testable :
les dates de bord — une prestation qui vient de commencer, une qui vient de finir, une
prolongée au-delà de son créneau — ne se vérifient pas en cliquant dans une interface.
Quatorze tests les couvrent.

Les trois états sont **exclusifs**. Sans cela, une prestation dont le prestataire a confirmé
la fin serait comptée à la fois « à valider » et « en cours » tant que son créneau n'est pas
écoulé, et le client verrait deux blocs se contredire.

**Le temps y est celui du navigateur**, et c'est assumé : `heure_debut` est une heure locale
française, exacte pour un client en France. Un client à l'étranger verrait l'horaire décalé de
son propre décalage. Côté serveur, la conversion reste obligatoire — Vercel tourne en UTC.

### Ce que `npm run colonnes` a trouvé du premier coup

**Une prestation clôturée sans versement n'apparaissait nulle part.** L'écran « Versements »
filtre sur `payout_status`, or celui de ces prestations vaut `NULL` : le prestataire attendait
un virement que rien n'émettrait, et personne ne pouvait le voir. L'écran les remonte
désormais en tête, avec le montant dû et un bouton « Programmer ».

L'action `programmer_versement` calcule ce montant par `montantsDeCloture` et l'échéance par
`echeanceVersementMs` — **les deux mêmes fonctions que la clôture normale**. C'est aussi la
raison pour laquelle ces reprises ne se font pas par un `UPDATE` en base : le refaire en SQL
en produirait une seconde version, qui divergerait. L'écriture est filtrée sur
`payout_status=is.null`, deux clics ne programment donc pas deux versements.

**Six colonnes manquantes**, relevées le 16/08/2026. Deux d'entre elles bloquaient le
versement aux prestataires depuis le 12/08.

| Colonne | Ce qu'elle cassait |
|---|---|
| `missions.payout_amount` | À la validation par le client, la mise en attente du versement échoue : **aucun virement n'est jamais programmé** |
| `missions.payout_due_at` | Idem. À l'auto-validation, pire : ces colonnes sont écrites dans le **même PATCH** que `status = 'completed'`, donc la prestation n'est même pas clôturée — elle reste `assigned` indéfiniment |
| `missions.cashback_credited` | Le garde-fou d'idempotence du cashback, dans ce même PATCH. Il tombait avec lui |
| `missions.last_validation_reminder_at` | L'horodatage qui empêche de relancer le même client toutes les deux heures. La relance repartait à chaque passage |
| `missions.broadcast_sent_at` | La remise à zéro de la diffusion quand une prestation repart en recherche |
| `bo_logs.details` | **Aucune action du backoffice transportant un détail n'a jamais été journalisée** |

`payout_amount` et `payout_due_at` étaient déclarées dans
`2026-08-12_versement_differe_48h.sql` : ce fichier n'a donc pas été appliqué en entier —
`payout_status` existe, ces deux-là non. Une migration partiellement passée est indiscernable
d'une migration passée, tant que rien ne la vérifie.

**Depuis le 12/08, aucune prestation n'a été auto-validée et aucune rémunération n'a été
programmée.** Le code journalisait pourtant l'échec en erreur, avec le nom du fichier à
appliquer — personne ne lisait les journaux. C'est la limite d'un signalement qui n'a pas de
destinataire.

`bo_logs.details` illustre l'autre moitié du problème : `journaliser()` n'attrapait que les
erreurs **réseau**. Un refus de PostgREST résout normalement, et passait donc inaperçu. Les
actions qui transportent un `details` sont précisément les plus sensibles — la justification
d'une exécution de litige sans accord des parties, le motif d'une suspension. Le résultat est
désormais vérifié.

Réparé par `2026-08-16_colonnes_manquantes.sql`. Ce que la migration ne répare **pas** : les
prestations traitées pendant la panne. Le fichier contient les deux requêtes qui les listent —
elles se reprennent depuis le backoffice, pas par un `UPDATE`, le montant dû dépendant d'un
plafonnement des heures que seul `montantsDeCloture` sait appliquer.

### `npm run colonnes` — l'outil qui aurait trouvé le défaut plus tôt

`missions.cancellation_reason` a été découverte par hasard, en écrivant une requête de
nettoyage. PostgREST refuse l'**intégralité** d'une requête qui mentionne une colonne
inconnue, et l'échec est invisible quand le résultat n'est pas vérifié — le client était
remboursé au prorata pendant que la prestation restait ouverte au montant plein.

`scripts/verifier-colonnes.mjs` relève toutes les colonnes écrites vers PostgREST depuis
`api/` — 16 tables, 130 colonnes — et imprime une requête SQL à passer sur la base. Elle ne
renvoie que les colonnes **absentes**. Attendu : zéro ligne.

À passer **après toute migration** et avant toute mise en production.

Ce n'est **pas** un contrôle de CI et il n'est pas branché sur `npm run coherence` : la
réponse est dans la base, pas dans le code. L'analyse est statique et se lit comme une liste
de candidats.

Le script a demandé quatre passes pour ne plus produire de faux positifs — chacune est
documentée dans le fichier. Il remontait successivement les clés imbriquées dans un JSON de
colonne (`tiers_declaration: { lieu }`), les mots français des commentaires ponctués de
deux-points (`personne`, `disciplinaire`), les accolades des gabarits `${…}` qui faisaient
déborder l'analyse sur le code suivant (`webhook`, `e` — la variable d'un `catch`), et enfin
`error` lorsqu'un corps passé par variable envoyait la recherche d'accolade dans une réponse
HTTP voisine. **Un contrôle qui crie sur du code légitime finit ignoré**, et un garde-fou
ignoré ne protège plus rien : le mettre au point valait mieux que le livrer bruyant.

**Trouvé en chemin** : `profiles.docs_verified` était écrit à la validation d'un document, et
lu nulle part — ni dans `/api`, ni dans `src/`, ni ici. L'échec était explicitement ignoré
« si la colonne n'existe pas encore ». Une écriture que personne ne lit ne prouve rien et ne
protège rien ; l'information exacte vit déjà dans `documents.verified` et
`documents.verified_at`. Supprimée.

### La position du prestataire n'est partageable que dans la fenêtre de la prestation

**Corrigé le 16/08/2026.** Le partage de position n'était borné par rien. Le bouton étant
visible dès l'affectation, un prestataire qui l'activait la veille — ou simplement en avance —
diffusait sa position en direct pendant des heures. C'est-à-dire, la plupart du temps, **son
domicile**.

Une fenêtre d'une heure existait déjà dans le code, mais elle ne gouvernait **que la
notification** « prestataire en route ». Ni le partage lui-même, ni la lecture par le client
n'étaient bornés.

Le rapport avec la prestation est ce qui rend ce traitement légitime : hors de ce rapport, il
n'y a plus de finalité, donc plus de base légale.

`fenetrePartagePosition()` (`api/_temps.js`) ouvre la fenêtre **une heure avant le début** — le
temps du trajet — et la ferme **une heure après la fin**, pour couvrir un dépassement
d'horaire. Elle suit le pointage réel quand la prestation a démarré en retard. Horaire
illisible : la fenêtre est **fermée** — à défaut de savoir si l'on est dans le rapport de la
prestation, on ne diffuse pas la position de quelqu'un.

Le contrôle est posé **trois fois**, et c'est voulu :

| Où | Ce que ça empêche |
|---|---|
| `update_position` | Enregistrer une position hors fenêtre. Ce qui n'est pas stocké ne peut pas fuir |
| `get_position` | Consulter une position légitimement enregistrée, mais après coup — le dernier point est souvent le lieu d'intervention |
| Traitement quotidien | Conserver les positions au-delà de 24 h. `tracking_positions` n'était purgée par rien : à l'échelle de quelques milliers de prestations, la table dessinait les déplacements des prestataires sur des mois |

Côté prestataire, le bouton **attend la réponse du serveur** avant d'annoncer « position
transmise ». Il l'affichait sans regarder le résultat, ce qui ferait croire au prestataire que
le client la voit alors qu'elle vient d'être refusée.

### Le cache figeait la décision, pas seulement le décompte

**Constaté en production le 16/08/2026, quelques minutes après la correction précédente.** Un
secteur venait d'être ouvert de force depuis le backoffice. Le client a réservé, **payé**, et
s'est fait refuser l'affectation — c'est-à-dire exactement le scénario que le contrôle avant
encaissement venait d'être écrit pour empêcher.

La cause : `etatSecteursAvecCache` mettait en cache **la décision complète**, réglages
compris, pendant cinq minutes. Or `/api/stripe-intent` et `/api/missions` sont deux fonctions
serverless **distinctes, chacune avec sa propre mémoire**. Après le changement, l'une avait un
cache frais — secteur ouvert, paiement accepté — et l'autre un cache vieux de quatre minutes —
secteur fermé, affectation refusée.

Deux contrôles portant sur la même règle, répondant le contraire l'un de l'autre, à quelques
secondes d'intervalle. Le client était débité puis remboursé pour rien, et le filet de
sécurité a joué son rôle — ce qui prouve son utilité, mais ne rend pas le défaut acceptable.

**Un réglage change par une décision humaine et doit prendre effet tout de suite ; l'effectif,
lui, bouge au rythme des inscriptions.** Ce sont deux temporalités différentes, et une seule
justifie un cache. Les réglages sont désormais relus à chaque appel — en une seule requête sur
les trois clés — et seul le recensement des comptes, qui est la partie coûteuse, reste en
cache cinq minutes.

Deux tests le verrouillent : les réglages sont relus même quand le décompte est en cache, et
le recensement n'est pas refait tant que le cache est valide.

### Une colonne inexistante annulait tout le PATCH

**Découvert le 16/08/2026**, en écrivant une requête de nettoyage : la base a refusé la
colonne `cancellation_reason`, que `api/missions.js` écrivait depuis longtemps.

PostgREST répond 400 (code `42703`) sur une colonne inconnue et **n'applique rien de la
requête** — pas seulement la colonne fautive. Le résultat du PATCH n'était pas vérifié :
l'échec était donc totalement invisible.

Ce que ça cassait, dans `cancel_in_progress` (interruption d'une prestation déjà commencée) :

1. le client était remboursé au prorata chez Stripe — **cette partie réussissait** ;
2. l'écriture en base — `status = 'cancelled'`, montant recalculé au prorata, motif —
   échouait entièrement.

La prestation restait donc `assigned`, **avec son montant d'origine**. Elle se clôturait
normalement à son terme par l'auto-validation, et le versement au prestataire se calculait
sur le montant complet : ALANE payait au prestataire une somme dont elle venait de rendre une
partie au client.

Deux corrections : la colonne est créée (`2026-08-16_motif_annulation.sql`), et le résultat du
PATCH est vérifié. En cas d'échec, le remboursement étant déjà parti, l'action répond 500 avec
un message qui le dit — « vous avez été remboursé, mais la prestation n'a pas pu être
clôturée » — et journalise le montant en erreur. Mentir serait pire que l'échec lui-même.

**Ce qui reste à surveiller** : 35 appels PATCH/POST vers `missions` ignorent encore leur
résultat. Aucune règle de `npm run coherence` ne les couvre — un contrôle qui crierait sur les
35 finirait ignoré, et beaucoup sont des notifications où l'échec est délibérément toléré. Le
critère utile serait « écriture d'argent ou de statut dont le résultat est jeté », et il reste
à écrire.

### Dénouer un litige — proposition, opposition, accord

**Réécrit le 16/08/2026.** Jusque-là, le backoffice tranchait seul : `resolve_dispute`,
`release_dispute` et `refund_dispute` remboursaient ou validaient dans la seconde, sans que
le client ni le prestataire aient été consultés, et sans qu'aucun des deux puisse s'y opposer.
Un remboursement Stripe partait immédiatement.

Le texte disait déjà autre chose — une « proposition sans caractère contraignant » — puis se
contredisait quelques lignes plus loin en autorisant ALANE à « donner instruction de verser,
de rembourser ou de maintenir les fonds indisponibles ». C'est un pouvoir de décision sur des
fonds qui ne lui appartiennent pas, et c'est précisément ce qu'un examen prudentiel regarde
en premier.

**L'article 17.1 ne connaît plus que trois causes de déblocage :**

| Cause | Qui la constate | Où c'est outillé |
|---|---|---|
| Accord des parties | La proposition notifiée, sans opposition dans les 48 h | `proposer_resolution` puis le traitement automatique |
| Procédures de l'établissement de paiement | Stripe (rétrofacturation, opposition, fraude) | `executer_decision` avec `cause: "psp"` |
| Décision de justice ou d'une autorité | Le juge | `executer_decision` avec `cause: "justice"` |

Le parcours normal, celui de l'accord :

1. **`proposer_resolution`** (backoffice) enregistre la proposition, son motif obligatoire,
   la date de notification et l'échéance à +48 h. **Aucun euro ne bouge.** Le client et le
   prestataire reçoivent le *même* texte : la proposition, son motif, la date limite et le
   moyen de s'y opposer. C'est cette notification qui fait courir le délai.
2. **`opposer_resolution`** (`api/missions.js`, client ou prestataire) enregistre une
   opposition. Elle n'a pas à être motivée, et **l'opposition d'une seule des deux parties
   suffit** à faire obstacle au déblocage. L'écriture est atomique
   (`resolution_opposition_at=is.null` en filtre) : deux oppositions simultanées ne se
   marchent pas dessus.
3. **À l'échéance, sans opposition**, le traitement des versements exécute la proposition —
   `verser_prestataire` remet `payout_status` à `pending`, `rembourser_client` rembourse via
   Stripe puis clôt. Le verrou d'exécution porte sur `resolution_executee_cause`, non sur
   `status` : inventer un statut intermédiaire aurait supposé de toucher à la contrainte de
   `missions.status`, et un statut inconnu du reste du code aurait fait disparaître la
   prestation de tous les écrans.

En cas d'opposition, **rien ne se débloque**. Les fonds restent chez Stripe et le différend
se poursuit entre les parties, par la médiation ou par les voies judiciaires.

**Le bouton d'opposition est la contrepartie indispensable du délai.** Sans moyen visible de
s'y opposer, l'absence d'opposition ne vaudrait pas accord et la « proposition » resterait
une décision d'ALANE sous un autre nom. Il vit dans `BlocPropositionResolution`
(`src/components/ui.jsx`), partagé entre le client et le prestataire : les deux ont
exactement le même droit, et un bloc recopié finit par diverger — c'est déjà arrivé quatre
fois sur les CGPS.

Corrigé au passage : `disputed` était absent de la liste des prestations du prestataire. Une
prestation contestée disparaissait de son écran — il ne voyait ni le litige, ni la
proposition qu'il avait 48 h pour contester. Un droit qu'on ne voit pas ne s'exerce pas.

Les actions du dénouement ne vivent plus qu'à **un seul endroit**, l'écran « Litiges » du
backoffice. Le gestionnaire de prestations les proposait aussi, en double, avec des libellés
et un comportement déjà divergents.

**Tranché le 16/08/2026 — le remboursement d'un litige ne porte pas sur les frais de
service.** Il portait auparavant sur l'intégralité du `payment_intent`, ce qui faisait une
troisième règle, différente de celle des annulations et de celle des CGPS. `montantRemboursable()`
(`api/_resolution.js`) déduit les frais de `montant_total` via `montantsDeCloture` — les frais
ne sont donc jamais recalculés depuis la grille tarifaire, qui a déjà divergé par le passé.

**Ajouté le 21/08/2026 — le remboursement peut être PARTIEL.** L'écran n'offrait que deux
issues, tout rendre ou ne rien rendre, alors que la plupart des litiges réels sont partiels :
deux heures sur trois faites, une partie du travail à refaire. `proposer_resolution` accepte
donc un champ `montant` facultatif, enregistré dans `missions.resolution_montant` ; laissé
vide, le comportement est inchangé. Le montant saisi est plafonné deux fois — à
`montant_total` au moment de la proposition, puis à ce que la carte a réellement supporté par
`plafonnerRemboursement()` au moment de l'exécution, cashback déduit. Il est repris dans la
notification envoyée aux deux parties : sans lui, l'opposition se déciderait à l'aveugle.

Le montant par défaut **n'est pas recalculé dans le navigateur** : les frais de service se
calculent côté serveur, et une deuxième formule dans le front finirait par diverger. Le champ
est donc laissé vide par défaut, et son absence signifie « remboursement par défaut ».

Quand les frais ne sont pas établissables — `montant_total` absent, tarif ou durée manquants —
la fonction renvoie `null` et l'appelant rembourse la **totalité**. À défaut de savoir ce qui
est dû, on ne retient rien au consommateur.

Le montant retenu est annoncé dans la proposition et dans la notification de clôture. Le taire
ferait découvrir l'écart sur le relevé bancaire, ce qui rouvre le litige qu'on vient de fermer.

### Une prestation faite ne s'annule plus

**Corrigé le 21/08/2026.** `presta_cancel` ne filtrait que sur le statut — `assigned` ou
`pending_acceptance`. Or une prestation reste `assigned` jusqu'à la validation du **client**,
c'est-à-dire bien après que le travail a été exécuté et confirmé par le prestataire.

Le bouton « Annuler la prestation » restait donc affiché sous « Validé — en attente client ».
L'utiliser remboursait intégralement un client qui avait reçu son service, et privait le
prestataire de son dû. Moins une possibilité qu'un piège.

Deux refus, aux deux moments où la question ne se pose plus : `validation_prestataire` est
vrai, ou `finPrestationMs` est dépassée. La borne est la même que celle du pointage et des
heures supplémentaires, pour que les trois ne divergent pas.

Le bouton est masqué **et** le serveur refuse : masquer ne protège de rien si l'action reste
possible par un autre chemin.

### Se faire remplacer

Un prestataire empêché a deux issues : annuler, ou **se faire remplacer** par un confrère
indépendant (CGPS art. 9). La seconde n'existait que dans le texte des CGPS jusqu'au
06/08/2026 — un droit écrit mais jamais exerçable se lit, devant un contrôle, comme de
l'habillage contractuel. C'est aussi l'indice d'indépendance le plus net : un salarié ne
peut jamais envoyer quelqu'un à sa place, parce que son contrat porte sur sa personne.

Quatre actions de `api/missions.js` :

| Action | Appelant | Rôle |
|---|---|---|
| `remplacants_possibles` | prestataire assigné | Liste **fermée** de confrères éligibles — il choisit dedans, il ne saisit pas d'identifiant |
| `proposer_remplacant` | prestataire assigné | Ouvre la demande, notifie le remplaçant **et** le client |
| `repondre_remplacement` | client **ou** remplaçant | Accord ou refus. Le rôle découle de l'identité de l'appelant, jamais du corps de la requête |
| `annuler_remplacement` | prestataire sortant | Retire sa demande |
| `mes_remplacements` | les trois | Demandes ouvertes le concernant |

**Les deux accords sont requis.** Le remplaçant est indépendant : il ne peut pas être
volontaire d'office. Le client reçoit quelqu'un chez lui, ou chez son propre client : son
accord préalable a été retenu comme condition. Tant qu'il en manque un, le sortant reste
titulaire et engagé — un refus n'annule rien, il laisse la prestation à son titulaire.

Contraintes appliquées par le serveur, jamais par le navigateur : le remplaçant est
recalculé éligible au moment de la demande (`candidatsPourMission`) puis revérifié libre au
moment de la bascule, le premier accord pouvant dater de plusieurs heures ; la demande doit
arriver **au moins 2 h avant le début**, sinon le client n'a aucun délai réel pour se
prononcer ; une prestation déjà commencée ne change plus de titulaire.

L'exécution se réduit à basculer `missions.prestataire_id`. Le virement de fin de prestation
lit ce champ : le remplaçant est payé de ce qu'il a réellement fait et facture en son nom,
ce qui est aussi ce qu'attend l'URSSAF. Aucun code de paiement n'a été modifié.

Une annulation par le prestataire (`presta_cancel`) clôt toute demande encore ouverte : sans
cela, le client pourrait accepter un remplaçant pour une prestation qui n'existe plus.

### Paiement

Le client paie via Stripe. Le webhook `stripe-webhook.js` confirme le paiement et fait passer
la mission en `assigned`. À la validation finale, le prestataire est payé et le cashback client
est crédité.

#### Le versement au prestataire

Le virement ne part **pas** à la validation. La clôture — quel que soit son chemin — se
contente d'inscrire sur la prestation :

| Colonne | Contenu |
|---|---|
| `payout_status` | `pending` |
| `payout_amount` | le montant exact dû, **figé** |
| `payout_due_at` | fin effective de la prestation + 48 h |

`api/cron-reset-monthly.js` repasse **toutes les deux heures** (route `?action=reminders`) et
émet les virements dont l'échéance est atteinte, à la seule condition que la prestation soit
toujours `completed` — un litige la fait passer en `disputed` et l'exclut d'office. Le verrou
est atomique (`pending` → `processing` avant l'appel Stripe) et la clé d'idempotence
`payout-<id>` interdit tout double virement.

#### Retenue (art. 7.4) et sommes dues (art. 8B.3)

Ces deux articles décrivaient des mécanismes que rien n'exécutait. Outillés le 14/08/2026.

**Retenue** — un cinquième état du versement, `held`. Il sort la prestation du traitement
automatique sans la marquer en échec : un `failed` signifie « Stripe a refusé », pas « ALANE
a décidé de retenir ». Le motif est pris dans l'énumération limitative de l'article
(`missions_payout_hold_reason_check`) : une retenue pour un motif non prévu au contrat serait
une retenue sans fondement. La notification écrite au prestataire — motif et montant — part
avec la retenue, parce que l'article en fait une condition et non une politesse. La retenue
se lève d'elle-même à `payout_hold_until` (90 jours au plus), sans qu'un humain ait à y penser.

**Sommes dues** — `creances_prestataires`, avec `compensations_versements` en journal. Le
calcul vit dans `api/_creances.js` et applique les trois limites de l'article : la moitié de
chaque versement au maximum, l'arrêt à l'extinction, et l'interdiction de compenser une
créance non notifiée ou contestée. Le plafond se calcule sur le versement **entier**, une
seule fois — appliquer « la moitié » créance par créance retiendrait 75 % avec deux créances.
Les imputations s'inscrivent **après** le virement : décrémenter une créance sur un virement
qui n'est jamais parti reviendrait à réclamer deux fois la même somme.

L'écran **Versements** du backoffice (`BOVersements`) montre les versements en attente,
retenus, échoués, et signale ceux dont l'échéance est dépassée de plus de six heures — le
symptôme d'un cron qui ne tourne plus.

Le montant est **figé à la clôture et jamais recalculé** : la clôture plafonne les heures
quand le client n'a jamais arbitré un décalage d'horaire, sans réécrire `actual_hours`. Un
traitement différé qui referait le calcul verserait plus que ce que le client a payé.

Il n'existe **qu'un seul chemin d'émission**. `account.updated` dans `stripe-webhook.js` en
émettait un second, avec son propre calcul et sans regarder `payout_due_at` : un prestataire
qui activait son compte Stripe pendant la fenêtre était payé aussitôt. Ce bloc a été retiré
le 14/08/2026 — le cron reprend seul les prestations restées en attente.

**Ce que reçoit le prestataire** (décision du 30/07/2026) : `tarif_horaire × heures × jours`,
soit la part horaire seule. Les frais de service restent acquis à ALANE — c'est sa
rémunération, et c'est ce qu'annonce le contrat signé par les deux parties (« Montant net dû
au Prestataire »). Les heures retenues sont les heures réelles (`actual_hours`) quand elles
existent, sinon les heures prévues.

**Une prestation prolongée porte DEUX tarifs.** Le prestataire annonce son prix pour les heures
supplémentaires (CGPS art. 6.2), et ce prix doit suivre jusqu'au versement. `partHoraire()` dans
`api/_cloture.js` scinde la durée :

    part = (heures − extra_hours_appliquees) × tarif_horaire
         +  extra_hours_appliquees          × extra_hours_tarif

`extra_hours_appliquees` (migration `2026-08-18_heures_supp_tarif_au_versement.sql`) porte le
nombre d'heures réellement ajoutées et réglées. Sans elle, la clôture recalculait tout au tarif
de base : une heure vendue 17 € sur une prestation à 15 € était versée 15 €, et les frais de
service paraissaient valoir 2 € de plus que ce qui avait été encaissé. Constaté le 18/08/2026,
au premier parcours complet de la prolongation payante.

Le plafonnement pour décalage d'horaire réduit **la part de base en premier** : le retard
concerne le début de la prestation, pas la prolongation acceptée en cours de route.

Trois endroits appellent ce calcul et doivent rester alignés : la clôture, `api/invoice.js`
(la facture montre les deux lignes, jamais un tarif moyen qui n'a jamais été convenu), et
`montantPrestataire()` dans `presta-screens.jsx`.

**Côté interface, `montantPrestataire()` dans `presta-screens.jsx` calcule la même chose** et
doit rester alignée : six copies d'une formule privilégiant `montant_total` surévaluaient tous
les montants montrés au prestataire — revenu du mois, fiche de fin de prestation, historique,
totaux et export comptable. Une prestation d'1 h à 15 €/h s'affichait « 19,90 € gagnés ».

Le calcul lui-même vit dans **`api/_cloture.js`** (`montantsDeCloture`), et nulle part
ailleurs. Il en existait quatre copies divergentes, toutes fausses à leur façon :
`api/missions.js` omettait le nombre de jours, `api/stripe-webhook.js` versait
`montant_total` frais compris, et l'auto-validation de `api/cron-reset-monthly.js` cumulait
l'oubli des jours, l'écrasement de `montant_total` par la seule part horaire — effaçant les
frais encaissés, donc la trace de ce que le client avait payé — et l'absence de plafonnement
des heures en cas de décalage non arbitré. Surtout, **elle ne programmait aucun virement** :
la prestation était clôturée, le prestataire recevait un e-mail lui annonçant un paiement
« sous 3 à 5 jours ouvrés », et rien n'était jamais émis.

La quatrième copie était `force_complete_mission` dans `api/bo-action.js` : mêmes défauts,
plus un cashback calculé sur le total frais compris, et là encore aucun virement programmé.
L'exécution d'une résolution remet `payout_status` à `pending` — sans quoi une prestation dont
le virement avait échoué avant le litige restait `failed`, le backoffice annonçant « fonds
libérés » au prestataire sans que rien ne reparte. Corrigé le 14/08/2026.

**La facture** (`api/invoice.js`) est celle du prestataire au client : son montant HT est
donc le même que ce qui lui est versé, `tarif_horaire × heures × jours`.

Les frais de service **n'entrent pas dans ce total** et ne doivent jamais y entrer : le
prestataire ne les encaisse pas, et les porter sur sa facture gonflerait son chiffre
d'affaires déclaré — donc ses cotisations URSSAF et son plafond de micro-entreprise — sur un
argent qu'il n'a jamais reçu. Ils apparaissent dans un bloc distinct, « Récapitulatif de
votre paiement », qui montre au client la prestation, les frais et le total réglé. Ce bloc
**ne vaut pas facture** pour les frais : leur facturation par ALANE suppose son SIRET et son
adresse, encore absents (voir §8, `VITE_ALANE_SIRET`). Les frais y sont déduits de
`montant_total` moins le TTC de la prestation ; un écart aberrant n'affiche rien plutôt qu'un
chiffre faux, et le journalise.

**Le numéro n'est tiré que si le prestataire a accepté le mandat de facturation**
(`profiles.mandat_facturation_at`, CGPS art. 6.3, art. 289 I-2 du CGI). Sans mandat, le
document reste une *attestation de prestation* sans numéro : tirer un numéro sans mandat
entamerait une numérotation qu'on ne pourrait plus justifier. Un numéro déjà attribué est en
revanche conservé — une numérotation continue ne se rétracte pas. Le prestataire peut
contester une facture émise en son nom (`missions.facture_contestee_at`), ce que le mandat
suppose.

`missions.invoice_number` conserve le numéro **attribué une seule fois**, à la première
consultation. La facture étant produite à la volée, un numéro était auparavant tiré à chaque
affichage : la même prestation en changeait à chaque ouverture et le compteur grimpait à
chaque coup d'œil, ce qu'interdit l'article 242 nonies A de l'annexe II au CGI (numérotation
continue et sans rupture).

`montant_total` porte **ce que le client a payé**, frais de service inclus. `complete` le
recalcule si la durée réelle diffère de la durée prévue, en conservant les frais d'origine.
Ne jamais y écrire la part du prestataire : la facture, le cashback et les remboursements en
dépendent.

Le **portefeuille prépayé est fermé depuis le 16/08/2026**. `pay_mission` et
`rembourser_solde` subsistent dans `api/wallet.js` le temps de vérifier qu'aucun solde résiduel
n'existe ; le tunnel ne propose plus que la carte et Apple Pay.

**Le cashback s'impute en réduction du paiement par carte** (`api/_cashback.js`, migration
`2026-08-17_cashback_en_reduction.sql`). Il l'était auparavant par `pay_mission`, seul code qui
le consommait : à la fermeture du portefeuille, il est devenu crédité, affiché, et dépensable
nulle part — alors que l'article 5B.1 des CGPS promet un crédit « utilisable pour le paiement
total ou partiel de futures Prestations ».

Trois règles gouvernent cette imputation, et il faut les trois :

- **`montant_total` ne bouge pas.** Il porte le PRIX de la prestation. `cashback_applique`
  porte la part réglée en cashback, et la différence est ce que la carte a supporté. Écrire la
  réduction dans `montant_total` aurait fait baisser la facture du prestataire, les frais de
  service constatés et le cashback de la prestation suivante — une remise commerciale d'ALANE
  serait devenue une baisse du prix de vente.
- **Le solde est débité à la CONFIRMATION du paiement**, jamais à la création de l'intention —
  `debiterCashback()`, appelé par `assign_after_payment` **et** par le webhook Stripe, le
  drapeau `cashback_debite` rendant le second appel sans effet. Réserver puis restituer aurait
  imposé une restitution sur une douzaine de chemins d'annulation : en oublier un aurait fait
  disparaître le cashback d'un client en silence.
- **Tout remboursement partiel est plafonné** à `montant_total − cashback_applique`
  (`plafonnerRemboursement()`). Stripe refuse de rendre plus qu'il n'a prélevé, et ce refus
  arriverait APRÈS l'annulation de la prestation.

Les helpers **relisent eux-mêmes** les deux colonnes quand le `select` de l'appelant les a
omises (`completerCashback`). Une douzaine de requêtes lisent `missions` pour rembourser :
exiger de chacune qu'elle pense à deux colonnes de plus, c'est accepter qu'une l'oublie — et
l'oubli serait silencieux.

Le cashback consommé est **restitué** quand la prestation est remboursée
(`restituerCashback()`, appelé par `rembourserPrestation` et par l'exécution d'une résolution) :
la prestation n'a pas eu lieu, l'avantage n'a pas été consommé.

---

### Le vocabulaire des états, côté client

**Unifié le 21/08/2026** dans `src/lib/statuts.js`. Le même état portait deux noms selon
l'écran : `assigned` s'affichait « Confirmée » sur la fiche d'une prestation et « Assignée »
dans l'historique.

Deux principes :

- **Un libellé décrit ce que le client vit, jamais l'état interne.** `completed` et `closed`
  sont distincts en base — validé des deux côtés, puis clos après versement — mais pour lui
  c'est la même chose : la prestation a eu lieu. Un seul mot, « Terminée ».
- **Un état inconnu rend son nom brut**, jamais un libellé inventé. Mieux vaut un mot étrange
  qu'un mot rassurant et faux.

| État en base | Ce que lit le client |
|---|---|
| `open` | Recherche en cours |
| `pending_acceptance` | Réponse attendue |
| `assigned` | Confirmée |
| `assigned`, fin dépassée, `validation_client` faux | **À valider** |
| `needs_replacement` | Remplaçant recherché |
| `completed`, `closed` | Terminée |
| `cancelled` | Annulée |
| `disputed` | Litige en cours |
| `refused`, `rejected` | Refusée |

**« À valider » n'existait pas.** Une prestation finie mais non validée reste `assigned` et
s'affichait « Confirmée », comme une prestation à venir — alors que c'est le seul moment où une
action est demandée au client, et que de cette action dépend le versement du prestataire. Elle
est la seule à porter une couleur d'appel.

La fin est calculée sur le pointage réel quand il existe, sinon sur l'horaire prévu : une
prestation démarrée en retard tourne encore quand l'horaire prévu est dépassé.

---

## 7. Navigation et URLs

L'application n'utilise pas de bibliothèque de routage. L'écran affiché vient d'un état
`screen` dans `App.jsx`, et [`src/lib/routes.js`](src/lib/routes.js) le reflète dans l'URL,
dans les deux sens.

Principales adresses :

| URL | Écran |
|---|---|
| `/` | Accueil |
| `/auth/signin` | Choix du profil, puis `/auth/signin/client` ou `/auth/signin/provider` |
| `/dashboard` | Espace client |
| `/provider/dashboard` | Espace prestataire |
| `/providers` | Catalogue |
| `/missions` | Historique des prestations |
| `/booking` | Réservation |
| `/settings`, `/notifications`, `/support` | Communs aux deux espaces |
| `/admin` | Backoffice |

Trois gardes s'appliquent automatiquement : sans session sur un écran protégé, on est renvoyé
vers `/auth/signin` ; avec une session sur un écran de connexion, vers son espace ; et un
compte non validé est renvoyé vers l'écran d'attente.

Certains écrans reçoivent un objet en mémoire (le prestataire, la mission). Ils ont une URL et
alimentent l'historique du navigateur, mais **ouvrir leur lien directement ramène à l'accueil** :
un identifiant dans l'URL ne suffit pas encore à les reconstruire. C'est une évolution
identifiée, pas un bug.

---

## 8. Variables d'environnement

Toutes configurées dans Vercel. **Attention** : elles contiennent des espaces invisibles, tout
fichier `/api` doit les nettoyer (CLAUDE.md §1.4).

| Variable | Usage |
|---|---|
| `VITE_SUPABASE_URL` | URL du projet Supabase |
| `VITE_SUPABASE_ANON_KEY` | Clé publique — exposée au navigateur |
| `SUPABASE_SERVICE_ROLE_KEY` | Clé privilégiée — `/api` uniquement |
| `VITE_STRIPE_PUBLIC_KEY` | Clé publique Stripe |
| `STRIPE_SECRET_KEY` | Clé secrète Stripe |
| `STRIPE_WEBHOOK_SECRET` | Signature du webhook Stripe |
| `VITE_SENTRY_DSN` | Remontée d'erreurs — si absente, Sentry est désactivé |
| `STRIPE_PRICE_PREMIUM_MONTHLY` | Identifiant du tarif Stripe (`price_…`). **Le nom hérité `STRIPE_PREMIUM_MONTHLY`, sans `PRICE_`, est aussi accepté** — c'est celui posé dans Vercel. Ces variables étant « Sensitive », donc illisibles après enregistrement, le code s'adapte plutôt que d'imposer une renomination |
| `STRIPE_PRICE_PREMIUM_YEARLY` | idem, abonnement annuel |
| `STRIPE_PRICE_ELITE_MONTHLY` | idem, plan Elite |
| `STRIPE_PRICE_ELITE_YEARLY` | idem |
| `VITE_VAPID_PUBLIC_KEY` | Contrepartie navigateur des clés VAPID, requise pour l'abonnement push |
| ~~`VITE_ALANE_SIRET`~~ | **Plus lue par aucun code depuis le 18/08/2026.** Elle n'alimentait que l'écran de facture « dans l'app », supprimé ce jour-là. La facture serveur (`api/invoice.js`) n'a jamais affiché les mentions d'ALANE : elle porte celles du prestataire et du client, ALANE n'étant pas l'émetteur. À rebrancher le jour où ALANE facturera ses frais de service en son nom propre |
| ~~`VITE_ALANE_ADRESSE`~~ | idem |
| ~~`VITE_ALANE_FORME`~~ | idem |
| `RESEND_API_KEY` | Envoi d'emails |
| `RESEND_FROM` | Expéditeur — **contient une espace significative**. Le nom affiché doit être `ALANE`, comme le contenu des emails et le domaine : un nom d'expéditeur qui ne correspond ni au domaine ni à la marque est lu comme une tentative d'usurpation par les filtres anti-spam. |
| `RESEND_REPLY_TO` | Adresse de réponse (`support@alane.fr`). Facultative, mais son absence combinée à un expéditeur `no-reply@` pénalise la délivrabilité. Si elle n'est pas renseignée, aucun `Reply-To` n'est envoyé. |
| `ADMIN_EMAIL` | Destinataire des tickets support |
| `BREVO_API_KEY` | SMS et emails de relance |
| `BO_PASSWORD` | Accès au backoffice |
| `BO_SESSION_SECRET` | Signature des sessions backoffice — doit être aléatoire |
| `BO_ALLOWED_IPS` | Filtrage IP du backoffice (optionnel) |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Notifications push |
| `CRON_SECRET` | Protection des tâches planifiées |
| `APP_URL` | URL publique |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | Limitation de débit (optionnel) |

Les variables préfixées `VITE_` sont **embarquées dans le code envoyé au navigateur** : elles
sont publiques par construction. N'y mettre aucun secret. Les autres ne sont lisibles que
depuis `/api`.

À ce jour `VITE_ALANE_SIRET` et `VITE_ALANE_ADRESSE` ne sont pas renseignées : les factures
sont donc émises **sans SIRET ni adresse d'émetteur**, ce qui ne satisfait pas les mentions
légales obligatoires d'une facture française. Les renseigner dans Vercel suffit à les faire
apparaître, aucun changement de code n'est nécessaire.

---

## 9. Développement en local

```bash
npm install
npm run dev      # http://localhost:5173
npm run lint     # doit rester à 0 erreur
npm run build
```

Le développement local nécessite un fichier `.env.local` contenant au minimum
`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` et `VITE_STRIPE_PUBLIC_KEY`. Ce fichier est
ignoré par git.

Les fonctions `/api` ne s'exécutent pas avec `npm run dev` — elles n'existent qu'une fois
déployées sur Vercel, ou via la commande `vercel dev`.

Tout push sur `main` déclenche un déploiement en production.
