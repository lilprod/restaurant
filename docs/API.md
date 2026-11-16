# API — Plateforme SaaS (espace SuperAdmin)

Base : `/api/v1` · Documentation interactive (Swagger) : `/api/docs` (corps et paramètres de requête générés depuis les schémas Zod partagés) · Montants en **FCFA** (entiers).
Authentification : `Authorization: Bearer <accessToken>` (15 min) + refresh token à rotation (30 j).
Rôles plateforme : `SUPER_ADMIN` (lecture + écriture), `SUPPORT` (lecture seule).

## Public
| Méthode | Route | Description |
|---|---|---|
| GET | `/public/plans` | Plans actifs (formulaire d'inscription) |
| POST | `/public/registrations` | Demande d'inscription d'un restaurant (5/h/IP). Crée une demande **PENDING**, aucun tenant |

## Authentification
| POST | `/platform/auth/login` · `/refresh` · `/logout` | GET `/platform/auth/me` |
|---|---|---|

## Gestion (SuperAdmin)
| Méthode | Route | Rôle | Description |
|---|---|---|---|
| GET/POST/PATCH | `/platform/plans[/:id]` | écriture SUPER_ADMIN | Plans (désactivés, jamais supprimés) |
| GET/POST | `/platform/tenants` | création SUPER_ADMIN | Liste filtrable (`status`, `search`, pagination) / création directe (tenant + admin + essai) |
| GET/PATCH | `/platform/tenants/:id` | | Détail (licence, nb utilisateurs, nb paiements) |
| GET | `/platform/tenants/:id/subscriptions` | | Historique des licences et paiements |
| POST | `/platform/tenants/:id/suspend` · `/reactivate` | SUPER_ADMIN | Suspension manuelle / levée (refusée si la licence est expirée) |
| GET | `/platform/registrations?status=` | | Demandes d'inscription |
| POST | `/platform/registrations/:id/approve` · `/reject` | SUPER_ADMIN | Valide (crée tenant + admin + essai 14 j, atomique) / rejette avec motif |
| POST | `/platform/payments` | SUPER_ADMIN | **Enregistre un paiement** `CASH`/`CARD`/`FLOOZ`/`TMONEY` et prolonge la licence |
| GET | `/platform/payments` · `/platform/payments/:id` | | Liste filtrable (tenant, mode, dates `from`/`to` — une date seule inclut toute la journée) avec total / reçu |
| POST | `/platform/payments/:id/void` | SUPER_ADMIN | Annule le **dernier** paiement d'une licence (restitue la période) |
| GET | `/platform/dashboard` | | Tenants par statut, CA du mois par mode, licences expirant sous 7 jours |
| POST | `/platform/licensing/sweep` | SUPER_ADMIN | Force le passage des licences échues (déjà exécuté chaque heure) |

## Enregistrer un paiement
```json
POST /platform/payments
{ "tenantId": "<uuid>", "method": "FLOOZ", "reference": "FL-778899",
  "billingCycle": "MONTHLY", "periods": 3, "amount": 40000, "planId": "<uuid optionnel>" }
```
- `reference` obligatoire hors espèces ; `amount` par défaut = prix du plan × `periods` ; `paidAt` par défaut = maintenant.
- Paiement **avant** l'échéance : la nouvelle période commence à la fin de la licence en cours (aucun jour perdu).
  Licence échue : une **nouvelle licence** démarre à la date du paiement.
- Retourne un numéro de reçu continu `REC-AAAA-NNNNNN`.
- Une suspension **manuelle** du restaurant n'est pas levée par un paiement.

## Règles de licence
`TRIALING` (14 j) → `ACTIVE` (paiement) → échéance → `GRACE` (7 j, accès maintenu) → `EXPIRED` (restaurant `SUSPENDED`).
Un paiement relance le cycle. Logique pure et testée : `apps/api/src/platform/licensing/licensing.ts`.

## Tests
`pnpm --filter api test` (unitaires) · `pnpm --filter api test:e2e` (PostgreSQL requis, variable `TEST_DATABASE_URL`,
vérifie aussi l'isolation RLS avec un rôle SQL non-superuser).

---

# Sécurité, paramètres et marque

Deux **espaces** aux routes jumelles : `/platform/...` (éditeur : SuperAdmin / Support) et `/tenant/...` (un restaurant).
Les jetons ne sont pas interchangeables : un jeton plateforme est refusé côté restaurant, et inversement.

## Authentification (les deux espaces)
| Méthode | Route | Description |
|---|---|---|
| POST | `/platform/auth/login` · `/tenant/auth/login` | `{email, password}` (+ `tenantSlug` côté restaurant). Renvoie les jetons, ou `{twoFactorRequired, challengeToken}` si la 2FA est active |
| POST | `.../auth/2fa/verify` | `{challengeToken, code}` : code de l'application d'authentification **ou code de secours** |
| POST | `.../auth/refresh` · `.../auth/logout` | Renouvellement avec rotation (un jeton rejoué est refusé) · fermeture de session |
| POST | `.../auth/forgot-password` · `.../auth/reset-password` | Lien envoyé par email (1 h, usage unique) ; réponse identique que le compte existe ou non |

Réponse de connexion : `{accessToken, refreshToken, user, restriction, license}`.
Le rafraîchissement renvoie `{accessToken, refreshToken, expiresIn, license}` (côté restaurant : `license = {status, inGrace, currentPeriodEnd}`,
comme à la connexion) : le bandeau de période de grâce n'attend pas une nouvelle connexion.

**Limitation de débit** (`429`) sur `login` et `2fa/verify` : **10 par minute et par couple IP + email** (ou défi 2FA) **et 60 par minute par IP**
(une équipe derrière le même réseau n'est donc pas bloquée par un seul compte fautif). Autres routes : 120/min par IP.

- `restriction` vaut `"pwd-change"` (mot de passe temporaire ou expiré) ou `"2fa-setup"` (2FA obligatoire pour ce rôle) :
  la session ne peut alors appeler que les routes « Mon compte » ; les autres répondent `403 {code: "RESTRICTED_SESSION"}`.
- Licence expirée ou restaurant suspendu : `403 {code: "LICENSE_BLOCKED"}` (connexion, rafraîchissement et toutes les routes du restaurant).
- Compte verrouillé : `423 {code: "ACCOUNT_LOCKED"}`. Compte désactivé : `401`, journalisé `ACCOUNT_DISABLED`.

## Mon compte — `/platform/account/...` et `/tenant/account/...`
`GET me` (profil + `restriction`, `mustChangePassword`, `passwordPolicy`) · `PATCH profile` · `POST avatar` · `POST change-password` · `GET sessions` · `DELETE sessions/:id` · `DELETE sessions` (toutes les autres) ·
`POST 2fa/setup` (secret + QR) · `POST 2fa/enable` (premier code → 8 codes de secours, affichés une seule fois) ·
`POST 2fa/disable` · `POST 2fa/recovery-codes` (mot de passe + code requis) · `GET login-history`.

## Paramètres du restaurant — `/tenant/settings`
Sections : `business` (identité légale, NIF, RCCM, adresse, contacts, réseaux sociaux, ticket de caisse), `branding` (nom affiché, slogan, thème),
`operations` (TVA, service, pourboires, réservations, livraison…), `localization` (langue, fuseau, format de date), `security` (politique ci-dessous),
`notifications` (canaux email/SMS actifs, nom d'expéditeur, signature, préférences par événement `events.<clé>` ; Admin en lecture et écriture),
`reservations` (confirmation manuelle, fenêtre, délai, absence, tampon : voir P2A ; lecture personnel).

`GET /tenant/settings` (tout) · `GET|PATCH /tenant/settings/:section` · `POST|DELETE /tenant/settings/assets/:kind` (`logo`, `logoDark`, `favicon` ; champ `file`).
`PATCH` fusionne avec l'existant puis valide l'ensemble ; une chaîne vide efface un champ optionnel.
Lecture : `business`/`branding` Admin + Manager · `operations`/`localization` personnel · `security` Admin. Écriture : Admin.

## Paramètres de la plateforme — `/platform/settings`
Sections : `branding`, `company` (raison sociale, NIF, RCCM, adresse, support, réseaux), `localization`, `security`,
`paymentInstructions` (numéros Flooz / TMoney, banque, espèces — affichés aux restaurants), `licensing` (`graceDays`, 0–30).
Mêmes routes `GET|PATCH` et `assets/:kind`. `security` est réservé au SuperAdmin ; le Support lit sans modifier.

## Marque publique (sans authentification)
`GET /public/branding` (plateforme + contacts de support) · `GET /public/tenants/:slug/branding` (restaurant, pour sa page de connexion).
Renvoie `displayName`, `logoUrl`, `logoDarkUrl` (repli sur `logoUrl`), `faviconUrl`, `theme` et **`cssVars`** prêtes à appliquer sur `:root`
(`--color-primary`, `--color-on-primary` calculée pour rester lisible, `--radius`, `--font-family`…).

## Sécurité du restaurant — `/tenant/security` (Admin)
`GET users` (état 2FA, verrouillage…) · `POST users/:id/(reset-password|unlock|disable-2fa|revoke-sessions)` · `PATCH users/:id/active` · `GET login-events`.
La réinitialisation renvoie un **mot de passe temporaire** (une seule fois) que l'utilisateur doit changer.
`GET /tenant/license` (Admin, Manager) : plan, échéance, historique des paiements et **comment payer**.

## Support (SuperAdmin)
- `/platform/users` : équipe plateforme (création avec mot de passe temporaire, rôle, activation, réinitialisation, déverrouillage, retrait de la 2FA).
- `/platform/security/login-events` : connexions de toute la plateforme.
- `/platform/tenants/:id/settings[/:section]`, `/assets/:kind`, `/security/users/...`, `/security/login-events` : intervenir sur un restaurant.
  Lecture ouverte au Support ; modifications, envois de fichiers et actions sur les comptes réservés au SuperAdmin.
  `PATCH /platform/tenants/:tenantId/security/users/:userId/active {isActive}` (SuperAdmin) : active / désactive un compte du restaurant
  (la désactivation ferme ses sessions ; audit `security.activate|deactivate`) ; 404 si le compte est d'un autre restaurant.

## Politique de sécurité (modifiable par espace)
| Réglage | Plage | Défaut restaurant / plateforme |
|---|---|---|
| Mot de passe : longueur, majuscule, minuscule, chiffre, symbole | 8–64 | 10, sans symbole / 12, avec symbole |
| `maxFailedAttempts` avant verrouillage | 3–10 | 5 |
| `lockoutMinutes` | 5–1440 | 15 / 30 |
| `sessionDays` (durée d'une session) | 1–90 | 30 / 14 |
| `passwordExpiryDays` (0 = jamais) | 0–365 | 0 |
| 2FA obligatoire | `require2faRoles` / `require2fa` | aucun |

Toujours actifs : mots de passe courants refusés, ni email ni nom dans le mot de passe, hachage argon2, secrets 2FA chiffrés (AES-256-GCM),
codes de secours hachés, verrouillage aussi sur les codes 2FA faux, révocation de session immédiate, journal des connexions,
audit des changements, en-têtes HTTP de sécurité (Helmet), limitation de débit sur la connexion.

## Images (logo, favicon, avatar)
PNG / JPEG / WebP (favicon : PNG / ICO / WebP). Le format est vérifié sur le **contenu** du fichier, pas sur l'extension. SVG refusé (script embarqué).
Logo 2 Mo, favicon 512 Ko, avatar 1 Mo. Fichiers servis sous `/uploads/...` avec `nosniff` et `Content-Security-Policy: sandbox`, nom aléatoire,
isolés par restaurant ; l'ancien fichier est supprimé au remplacement. Le stockage passe par `StorageService` (disque aujourd'hui, Cloudinary / S3 plus tard).

---

# Phase 1 — Menu, commandes, cuisine, encaissement (`/tenant/...`)

Rôles : **personnel** = ADMIN, MANAGER, WAITER, KITCHEN · **salle** = ADMIN, MANAGER, WAITER ·
**cuisine** = ADMIN, MANAGER, KITCHEN · **responsables** = ADMIN, MANAGER. Prix du menu **TTC** en FCFA entiers.

## Équipe — `/tenant/staff`
`GET` (responsables) · `POST` (Admin : `{email, firstName, lastName, phone?, role}` → `temporaryPassword` affiché une fois) ·
`PATCH /:id` (Admin ; pas son propre rôle). Activation, réinitialisation, 2FA : routes `/tenant/security/users/...`.
Limite `maxUsers` du plan → `409 {code: "PLAN_LIMIT"}`.

## Tables — `/tenant/tables`
`GET` (personnel ; `openOrders` = commandes ouvertes) · `POST`/`PATCH /:id`/`DELETE /:id` (responsables ; une table déjà utilisée est désactivée)
· `PATCH /:id/status` (salle : `FREE`, `CLEANING`…). Statut `OCCUPIED`/`FREE` mis à jour automatiquement par les commandes. Limite `maxTables`.
Forme d'une table : `{ id, label, capacity, minCapacity, status, isActive, openOrders[], floorPlanId, posX, posY, width, height, shape, rotation, mergedIntoId, mergedTables[] }`
(`capacity` = capacité **cumulée** d'une table fusionnée). `POST` accepte en plus `floorPlanId?`, `posX?`, `posY?`, `width?`, `height?`, `shape?`, `rotation?` (voir « P2B — Plan de salle »).
Les tables absorbées par une fusion (`mergedIntoId`) ne reçoivent ni commande ni réservation (409).

## Menu — `/tenant/menu`
`GET` (carte complète) · `GET allergens` · catégories `POST|PATCH|DELETE categories[/:id]`, `POST categories/reorder` ·
plats `POST|PATCH|DELETE items[/:id]` (options : `optionGroups[{name, minChoices, maxChoices, options[{name, extra}]}]` remplacés en bloc ;
`allergenCodes[]` ; `vatRate` par défaut = paramètre « exploitation ») · `POST items/reorder` · `PATCH items/:id/availability` (cuisine : « épuisé ») ·
`POST|DELETE items/:id/image` (PNG/JPEG/WebP, 3 Mo). Un plat déjà commandé est **archivé** (retiré de la carte, historique conservé).
Carte publique : `GET /public/tenants/:slug/menu` (catégories actives, plats non épuisés, sans données internes). Chaque plat porte
`availableNow` (faux hors de sa plage horaire : à griser), `availableFrom/availableTo` et `promotion: {name, unitPrice} | null` (prix remisé en cours) ;
`formulas[]` : formules actives avec `availableNow`, étapes et plats proposés non épuisés.

### Disponibilité horaire, formules, promotions (P1B)
- **Plage horaire d'un plat** : `availableFrom` / `availableTo` (« HH:MM », fuseau du restaurant, `""` = toute la journée ; les deux ou aucune, sinon 400).
  Bornes `[de, à[` ; une plage qui passe minuit (22:00–02:00) est acceptée. Hors plage, la commande est refusée en **409**
  (« « Soupe » n'est servi que de 11:30 à 15:00 »). Règles dans `@restaurant/utils` (`availabilityAt`, `menu-extras.ts`), horloge injectable (`Clock`) pour les tests.
- **Formules** (`/tenant/menu/formulas`, lecture : personnel · écriture : responsables) : `GET` · `POST` · `PATCH /:id` · `DELETE /:id` (archivée si déjà commandée).
  Corps : `{name, description?, price (TTC), isActive, availableFrom?, availableTo?, sortOrder, steps[{name, minChoices, maxChoices, menuItemIds[]}]}`
  (étapes remplacées en bloc). Un plat à options obligatoires ne peut pas être proposé (409). TVA d'une formule = taux par défaut du restaurant.
- **Promotions** (`/tenant/menu/promotions`, lecture : personnel · écriture : responsables) : `GET` · `POST` · `PUT /:id` · `PATCH /:id {isActive}` · `DELETE /:id`.
  Corps : `{name, kind: PERCENT|AMOUNT, value, menuItemId | categoryId, startsOn?, endsOn?, days[1..7 ISO], fromTime?, toTime?, isActive}`.
  Appliquée automatiquement à la commande si elle est en cours (fuseau du restaurant) ; **la plus avantageuse l'emporte, sans cumul** ; les suppléments d'options ne sont pas remisés.
- **Commander une formule** : ligne `{formulaId, quantity, choices[{stepId, menuItemId}], instructions?, course?}` (au lieu de `menuItemId`). Elle crée une **ligne formule**
  (`formulaId`, `menuItemId: null`, prix de la formule, TVA par défaut) et une **ligne enfant par plat choisi** (`parentItemId`, `stepName`, `unitPrice: 0`) :
  seules les lignes enfants vont en cuisine (`GET /tenant/kitchen` ne renvoie pas la ligne formule), avancent (`status`, `advance`) et déduisent leur recette de stock (P3) ;
  le statut de la ligne formule est déduit de ses plats. Quantité (`PATCH`) et annulation (`cancel`) s'appliquent à la formule entière (ses plats suivent) ; un plat de formule
  ne se modifie, ne s'annule et ne s'encaisse jamais seul (409 / 400 « sélectionnez la formule »).
- **Remise sur la commande** : `OrderItem.discount` (total de la ligne), `promotionName` ; `unitPrice` est le prix remisé **figé** ; `Order.discountTotal` (« dont remise » du ticket).
- Choix invalides (étape manquante, trop de choix, plat étranger à l'étape) : 400 ; formule masquée/hors horaires : 409.

## Commandes — `/tenant/orders`
| Méthode | Route | Rôle | Description |
|---|---|---|---|
| GET | `/` | personnel | Filtres `status`, `paymentStatus`, `type`, `tableId`, `open=true`, `date=AAAA-MM-JJ` (fuseau du restaurant), pagination |
| POST | `/` | salle | `{type: DINE_IN\|TAKEAWAY, tableId?, customerName?, notes?, items[{menuItemId \| formulaId+choices[], quantity, optionIds[], instructions?, course?}]}` |

| POST | `/` | salle | `{type: DINE_IN\|TAKEAWAY, tableId?, reservationId?, customerName?, notes?, items[{menuItemId, quantity, optionIds[], instructions?, course?}]}` (`reservationId` : voir P2A) |
| GET | `/:id` · `/:id/receipt` | personnel · salle | Détail · ticket (identité du restaurant, TVA par taux, paiements) |
| POST | `/:id/items` | salle | Ajouter des articles (commande ouverte) |
| PATCH | `/:id/items/:itemId` | salle | Quantité / instructions (`""` efface les consignes) (article encore en attente et non encaissé) |
| POST | `/:id/items/:itemId/status` | cuisine ou salle | `PENDING → IN_PROGRESS → READY` (cuisine, retour d'un cran possible) · `READY → SERVED` (salle) |
| POST | `/:id/advance` | cuisine ou salle | Tous les articles éligibles : `IN_PROGRESS`, `READY` (cuisine) ou `SERVED` (salle) |
| POST | `/:id/items/:itemId/cancel` | salle | `{reason}` ; article déjà lancé : responsables seulement ; article encaissé : refusé |
| POST | `/:id/cancel` | responsables | `{reason}` ; refusé s'il reste des paiements encaissés |
| POST | `/:id/payments` | salle | `{method: CASH\|CARD\|FLOOZ\|TMONEY\|OTHER, amount, tip?, tendered?, reference?, allocations?[{orderItemId, quantity}]}` → `{order, paymentId, change}` |
| POST | `/:id/payments/:pid/refund` | responsables | `{reason}` ; rouvre la commande si elle n'est plus réglée |

- Les prix, noms, options et TVA sont **figés** à la commande. Numérotation continue par restaurant.
- Statut de commande déduit des articles : `PENDING`, `IN_PROGRESS`, `READY`, `DELIVERED` (tout servi), `CANCELLED`.
- `paymentStatus` : `UNPAID`, `PARTIAL`, `PAID` ; `remaining` = reste à payer. Un encaissement ne peut pas dépasser le reste
  (verrou en base : deux encaissements simultanés ne dépassent jamais le total). Référence obligatoire pour Flooz / TMoney.
- Clôture automatique quand tout est **servi et réglé** ; la table redevient libre. Service : `serviceChargePercent` des paramètres.

## Cuisine et temps réel
`GET /tenant/kitchen` : commandes ouvertes avec des articles en attente, en préparation ou prêts (les plus anciennes d'abord).
Socket.io, espace de noms **`/realtime`** (chemin `/socket.io`, hors préfixe `/api/v1`) :
`io(API_URL + "/realtime", { auth: { token: accessToken } })` → `ready` ou `auth_error` puis déconnexion.
Événements diffusés au restaurant (charge utile = même forme que l'API, émis après la transaction) :
- **`order.created`**, **`order.updated`** : commande complète.
- **`menu.updated`** : plat (`menuItemView`) créé, modifié, rendu (in)disponible, photo changée ou archivé (`archived: true`) ;
  `{ id, deleted: true }` pour un plat supprimé.
- **`menu.extras.updated`** `{ kind: "formula" | "promotion" }` : formule ou promotion créée, modifiée ou supprimée (les écrans rechargent `GET formulas|promotions`).
- **`table.updated`** : table au format de `GET /tenant/tables` (création, modification, statut — y compris le passage `OCCUPIED`/`FREE` dû aux commandes —,
  désactivation) ; `{ id, deleted: true }` pour une table supprimée.
- **`floorplan.updated`** : salle `{ id, name, width, height, tableCount }` (création, modification) ; `{ id, deleted: true }` si supprimée.
- **`stock.updated`** `{ ingredients: StockLight[] }` et **`stock.low`** (`StockLight`, une fois par franchissement de seuil) : voir « Stock ».
- **`reservation.created`**, **`reservation.updated`**, **`waitlist.updated`** : voir « P2A — Réservations ».
Les contrôles sont ceux de l'API (jeton, session, compte actif, licence).

## Caisse — `/tenant/register`
`GET current` (salle : fond, encaissements par moyen, espèces attendues) · `POST open {opening}` · `POST close {counted, notes?}`
(responsables ; écart = compté − attendu) · `GET sessions` (historique). Les paiements sont rattachés à la caisse ouverte.

## Tableau de bord — `GET /tenant/dashboard?date=` (responsables)
Chiffre d'affaires encaissé, pourboires, nombre de commandes, ticket moyen, commandes ouvertes, répartition sur place / à emporter,
par moyen de paiement, par heure, 5 plats les plus vendus — sur la journée du restaurant (son fuseau).

## Notifications (X1) — email, SMS, journal
Service unique `NotificationsService` (module global `src/notifications/`). `MailService` n'est plus qu'un adaptateur déprécié.

### Routes
| Route | Rôles | Rôle |
|---|---|---|
| `GET /tenant/notifications?channel=&status=&template=&page=&pageSize=` | Admin | Journal du restaurant (destinataires masqués : `k••••@gmail.com`, `+228 •• •• 34 56`) |
| `POST /tenant/notifications/:id/resend` | Admin | Renvoi manuel (nouvelle ligne, `resendOfId`). 409 si le message est en cours ou confidentiel (mot de passe oublié), 404 si autre restaurant |
| `GET /platform/notifications?tenantId=` | SuperAdmin, Support | Journal global ; `tenantId=none` = messages de la plateforme |
| `POST /platform/notifications/:id/resend` | SuperAdmin | Renvoi manuel (audité) |

Statuts : `QUEUED` (en file, éventuellement en cours de reprise) → `SENT` ou `FAILED` (après 5 tentatives, délai doublé à chaque fois).

### Configuration (variables d'environnement, voir `.env.example`)
- Email : `MAIL_DRIVER=log|smtp`, `SMTP_URL`, `MAIL_FROM` (Brevo, Mailjet, Gmail SMTP : seule l'URL change).
- SMS : `SMS_DRIVER=log|twilio|http` ; `twilio` : `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `SMS_FROM` ; `http` (agrégateur générique) :
  `SMS_HTTP_URL`, `SMS_HTTP_METHOD`, `SMS_HTTP_HEADERS` (JSON), `SMS_HTTP_CONTENT_TYPE=json|form`, `SMS_HTTP_BODY` (gabarit avec `{{to}}`, `{{message}}`, `{{from}}`) ; tout code 2xx = succès.
- File : `NOTIFICATIONS_QUEUE=sync|bullmq` (`bullmq` exige `REDIS_URL`), `NOTIFICATIONS_RETRY_BASE_MS` (défaut 30 000).
  `sync` (défaut, sans Redis) : première tentative immédiate, reprises en mémoire (perdues au redémarrage) : développement et tests seulement.
- Défaut : `log` + `sync` ; une configuration incomplète empêche le démarrage (validation dans `config/env.ts`).

### Envoyer un message depuis un module (P2A, X2, P5…)
1. Créer `src/notifications/templates/<domaine>.ts` avec un `TemplateDef<Variables>` : `category` (`transactional` = toujours envoyé, `reminder` = respecte canaux et préférences),
   `event` (clé de préférence), `sensitive` (secret dans les variables : rien n'est conservé, pas de renvoi), `email(data, brand)` → `{ subject, paragraphs, action?, note? }`,
   `sms(data, brand)` → texte (tronqué à 160 caractères ; jamais de secret ni de code 2FA).
2. L'enregistrer dans `templates/index.ts` (`TemplateDataMap` + `TEMPLATES`) et, pour un événement désactivable, dans `NOTIFICATION_EVENTS` (`packages/validation/src/notifications.ts`).
3. Ajouter le libellé du modèle dans `apps/web/src/lib/labels.ts` (`NOTIFICATION_TEMPLATE_LABEL`).
4. Envoyer, **après** la transaction métier : `await notifications.send({ channel: "EMAIL"|"SMS", to, template: "domaine.nom", data, tenantId, dedupeKey? })`.
   `send` ne lève jamais d'exception, ne bloque pas sur le fournisseur (mise en file) et retourne `{ status: "queued", id }` ou `{ status: "skipped", reason }`.
   `dedupeKey` garantit « une seule fois » (ex. `license:<abonnement>:<échéance>:<palier>:<destinataire>`). Numéros normalisés en E.164 (`normalizePhone` de `@restaurant/utils`, 8 chiffres = Togo).
La marque (nom, logo), les coordonnées et la signature du restaurant sont ajoutées automatiquement.

### Branchements livrés
Mot de passe oublié (email, lien jamais conservé) · relances de licence J-7 / J-1 / jour d'expiration aux administrateurs (tâche planifiée toutes les heures,
`LicenseRemindersService.run()`, une seule fois par palier et par échéance ; SMS au numéro du restaurant si le canal est activé) ·
inscription d'un restaurant (demande reçue, validée, rejetée). Aucun événement temps réel.

# P3 — Stock (`/tenant/inventory`, `/tenant/suppliers`, `/tenant/purchase-orders`)

Module du plan **`inventory`** (`plan.features.inventory === true`) ; sinon **`403 {code: "PLAN_FEATURE", feature: "inventory"}`** sur toutes ces routes
(et sur les recettes). Rôles : **lecture cuisine + responsables** (`ADMIN, MANAGER, KITCHEN`), **écriture responsables** ; les **pertes** sont déclarables par la cuisine.
Unités de stock : `g, kg, ml, cl, l, piece` (conversions g↔kg, ml↔cl↔l dans `@restaurant/utils`) ; quantités à 3 décimales ; montants entiers FCFA.

## Ingrédients — `/tenant/inventory/ingredients`
`GET ?search&category&state=LOW|OUT|NEGATIVE|OK|ALERT&archived=true` · `GET categories` · `GET :id` ·
`POST {name, unit, category?, lowStockThreshold, reorderQty?, avgCost, supplierId?, autoDisable, initialQuantity?}` (stock initial = mouvement `ADJUSTMENT`) ·
`PATCH :id` (unité figée dès qu'il y a mouvement ou recette → 409 ; `isActive: true` restaure) ·
`DELETE :id` (supprimé s'il n'a aucun historique, sinon archivé ; 409 s'il figure dans une recette) · `POST :id/adjust {delta, reason}` (correction).
Vue : `quantity, lowStockThreshold, avgCost` (FCFA / unité), `value` (stock × coût moyen, 0 si négatif), `state` (`OK|LOW|OUT|NEGATIVE`), `supplier`.

## Recettes — `/tenant/menu/items/:id/recipe`, `/tenant/menu/options/:id/recipe`
`GET` (cuisine + responsables) : lignes (`quantity`, `unit` de saisie, `cost`), `cost` (coût matière = Σ quantité × coût moyen), `net` (prix TTC hors TVA),
`margin`, `marginRate` ; pour un plat, `options[]` avec leur recette. `PUT {lines: [{ingredientId, quantity, unit?}]}` (responsables) remplace la recette ;
unité incompatible → 400 `errors[lines.N.unit]`. Quand un plat est réenregistré, les recettes des options suivent l'option de même nom dans le groupe de même nom.
`GET /tenant/inventory/dish-costs` (responsables) : coût et marge de chaque plat (fonction pure `dishMargin`, réutilisable par les rapports).

## Déduction automatique (commandes)
Dans la **même transaction** que la commande (`OrdersService.mutate`, commande verrouillée), via `StockService.onItemTransitions` ;
ingrédients verrouillés `SELECT … FOR UPDATE` **dans l'ordre des ID** (pas d'interblocage) :
- article `PENDING → IN_PROGRESS | READY` (y compris « Tout lancer ») : `ORDER_DEDUCTION` = recette × quantité + recettes des options, une seule fois par article ;
- `IN_PROGRESS → PENDING` : `RETURN` de ce qui a réellement été déduit (calculé depuis les mouvements, pas depuis la recette actuelle) ;
- annulation d'un article lancé (ou de la commande) : `RETURN` puis `WASTE` (motif « Annulation (Commande n° X) : … ») + perte valorisée (`automatic: true`) ;
  le stock reste consommé ; un article encore en attente n'a rien consommé.
Le stock peut devenir **négatif** (le service n'est jamais bloqué) : `state: "NEGATIVE"`. À zéro, un ingrédient `autoDisable` rend indisponibles les plats
dont la recette l'utilise (`menu.updated`, plat grisé partout). Les recettes servent telles qu'elles sont au moment du lancement.

## Mouvements, pertes, alertes
`GET /tenant/inventory/movements?ingredientId&type&from&to&page&pageSize` : `quantity` signée, `balanceAfter`, `unitCost`, `value`, `reason`, liens
(`orderItemId`, `purchaseOrderId`, `stockCountId`), `user`. `GET /tenant/inventory/waste?from&to` (`totalCost`) · `POST /tenant/inventory/waste {ingredientId, quantity, unit?, reason}` (cuisine).
`GET /tenant/inventory/alerts` : ingrédients actifs `LOW | OUT | NEGATIVE` (les plus graves d'abord) avec `suggestedQty` (quantité de réapprovisionnement, sinon 2 × seuil − stock).
**Alerte** : quand le stock franchit le seuil (`quantity ≤ lowStockThreshold`, ou ≤ 0), `stock.low` est émis **une seule fois** (`Ingredient.lowAlertedAt`), réarmé quand le
stock repasse au-dessus du seuil. Point d'accroche des notifications aux responsables (X1) : `StockService.publish` (TODO X1).

## Inventaire physique — `/tenant/inventory/counts`
`GET` · `GET :id` (lignes : théorique, compté, écart, écart valorisé) · `POST {category?, notes?}` (un seul inventaire ouvert → 409) ·
`PATCH :id/lines {lines: [{ingredientId, countedQty|null}]}` · `POST :id/validate` (écart = compté − stock lu sous verrou → `ADJUSTMENT` valorisé au coût moyen ;
lignes vides ignorées) · `POST :id/cancel`. Écriture : responsables.

## Fournisseurs et commandes fournisseurs
`/tenant/suppliers` : `GET ?all=true` · `POST` · `PATCH :id` · `DELETE :id` (archivé s'il est référencé).
`/tenant/purchase-orders` : `GET ?status&supplierId` · `GET :id` · `POST {supplierId, expectedAt?, notes?, lines: [{ingredientId, quantity, unitCost}]}` (brouillon) ·
`PATCH :id` (brouillon seulement, 409 sinon) · `POST :id/send` · `POST :id/receive {lines: [{lineId, quantity, unitCost?}]}` (commande verrouillée ; `PURCHASE`,
**coût moyen pondéré** `(max(stock,0) × coût + reçu × prix) / (max(stock,0) + reçu)`, statut `PARTIAL` puis `RECEIVED` ; 409 si déjà reçue ou annulée) ·
`POST :id/cancel`. Audit : `purchase.receive`, `purchase.cancel`, `inventory.waste`, `inventory.adjust`, `inventory.count.validate`, `inventory.ingredient.archive`.

## Temps réel
- **`stock.updated`** `{ ingredients: [{ id, name, unit, quantity, lowStockThreshold, state }] }` après chaque transaction de stock (sans coûts).
- **`stock.low`** `{ id, name, unit, quantity, lowStockThreshold, state }` : une fois par franchissement de seuil.
- **`menu.updated`** pour chaque plat rendu indisponible par `autoDisable`.

# P2A — Réservations (`/tenant/reservations`, `/tenant/opening-hours`, `/tenant/closures`, `/tenant/waitlist`, `/public/...`)

Pas de restriction de plan. Rôles : **lecture personnel** (`ADMIN, MANAGER, WAITER, KITCHEN`), **écriture salle** (`ADMIN, MANAGER, WAITER`),
**horaires, fermetures et forçage : responsables** (`ADMIN, MANAGER`). Tout est calculé dans le **fuseau du restaurant** (`Tenant.timezone`) ;
les instants circulent en ISO 8601 UTC. Logique pure partagée (web possible) : `@restaurant/utils` → `computeAvailability`, `slotStarts`,
`openingWindows`, `pickTables`, `localTimeToInstant`, `canTransitionReservation`, `reminderInstant`. Schémas : `@restaurant/validation` (`reservations.ts`).

## Réglages
- `operations` (existant) : `onlineReservations` (réservation en ligne), `reservationDurationMinutes` (90), `reservationSlotMinutes` (15, pas par défaut), `maxPartySize` (20).
- Nouvelle section **`reservations`** (`GET|PATCH /tenant/settings/reservations` ; lecture personnel, écriture Admin) :
  `requireConfirmation` (false : en ligne = confirmée d'office ; true = `PENDING` jusqu'à `confirm`), `bookingWindowDays` (60), `minNoticeMinutes` (60),
  `noShowGraceMinutes` (20), `bufferMinutes` (0, tampon de remise en place entre deux réservations d'une table).

## Horaires et fermetures
| Méthode | Route | Rôle | Description |
|---|---|---|---|
| GET | `/tenant/opening-hours` | personnel | `{ ranges: [{ weekday, opensAt, closesAt, slotMinutes }] }` (tri jour, heure) |
| PUT | `/tenant/opening-hours` | responsables | `{ ranges: [{ weekday 0=dim…6=sam, opensAt "HH:MM", closesAt "HH:MM", slotMinutes? 10\|15\|20\|30\|60 }] }` remplace **toute** la semaine ; plusieurs plages par jour (midi, soir) ; `closesAt ≤ opensAt` = fermeture après minuit, `"24:00"` accepté ; chevauchement d'un même jour → 400 (`errors[].path` = `ranges.<i>.opensAt`) ; audité |
| GET | `/tenant/closures?from=&to=` | personnel | Fermetures exceptionnelles `[{ id, date, reason, createdAt }]` à partir d'aujourd'hui par défaut |
| POST | `/tenant/closures` | responsables | `{ date: "AAAA-MM-JJ", reason? }` → fermeture + `affectedReservations` (réservations `PENDING`/`CONFIRMED` de ce jour, à prévenir) ; doublon → 409 ; audité |
| DELETE | `/tenant/closures/:id` | responsables | 204 ; audité |

Sans horaires, aucun créneau n'est proposé (le seed de démo crée 11:30–15:00 et 18:30–23:00 tous les jours).

## Disponibilités — `GET /tenant/reservations/availability?date=&partySize=&durationMinutes?=&excludeReservationId?=` (personnel)
```json
{ "date": "2026-11-14", "timezone": "Africa/Lome", "partySize": 3, "durationMinutes": 90, "closed": false, "closureReason": null,
  "openingWindows": [{ "start": "…", "end": "…" }],
  "slots": [{ "startsAt": "2026-11-14T19:00:00.000Z", "endsAt": "2026-11-14T20:30:00.000Z", "available": true,
              "tables": [{ "id": "…", "label": "T4", "capacity": 4 }] },
            { "startsAt": "…", "endsAt": "…", "available": false, "reason": "full", "tables": [] }] }
```
- Créneaux en heure locale tous les `slotMinutes` depuis l'ouverture ; la réservation **entière** doit tenir avant la fermeture ; changement d'heure géré
  (heure inexistante sautée). `reason` : `past` (créneau passé) ou `full` (aucune table). `closed` : fermeture exceptionnelle ou aucun horaire ce jour.
- Tables proposées : **la plus petite table suffisante** (capacité ≥ convives ≥ `minCapacity`), sinon la **combinaison de 2 tables** de capacité totale minimale.
- Occupation d'une table = `[début, fin + bufferMinutes)` ; bornes « [) » (une fin à 20:30 laisse la table libre à 20:30).
- `excludeReservationId` : ignorer une réservation (recherche de créneau pour la déplacer).

## Réservations — `/tenant/reservations`
| Méthode | Route | Rôle | Description |
|---|---|---|---|
| GET | `/?date=&from=&to=&status=&search=` | personnel | Journée de service `date` (défaut : aujourd'hui) ou intervalle `from`/`to` (ISO ; « arrivées de l'heure ») ; `status=CONFIRMED,SEATED` ; `search` = nom, téléphone ou code ; tri par heure |
| POST | `/` | salle | `{ guestName, guestPhone?, guestEmail?, partySize, startsAt?, durationMinutes?, source?: PHONE\|WALK_IN, tableIds?, specialRequests?, notes?, force?, overrideReason? }` → 201 `Reservation` (`CONFIRMED`) |
| GET | `/:id` | personnel | Fiche |
| PATCH | `/:id` | salle | Mêmes champs (sauf `source`) ; `""`/`null` efface téléphone, email, demandes, notes ; heure/durée/taille/tables → nouvelle attribution (tables actuelles gardées si elles conviennent) ; client prévenu si heure ou taille change ; installée : heure d'arrivée figée |
| POST | `/:id/confirm` | salle | `PENDING → CONFIRMED` (message « confirmée » au client) |
| POST | `/:id/seat` | salle | `PENDING/CONFIRMED → SEATED` : table(s) `OCCUPIED` (`table.updated`) ; au plus 60 min avant l'heure (la réservation est alors avancée, si la table est libre) ; 409 si une commande ouverte ou une autre réservation installée occupe la table |
| POST | `/:id/complete` | salle | `SEATED → COMPLETED` : créneau libéré ; table `FREE` sauf commande encore ouverte |
| POST | `/:id/cancel` | salle | `{ reason?, notifyGuest? = true }` (`PENDING/CONFIRMED`) → `Reservation` + **`waitlistMatches`** (entrées compatibles) ; audité |
| POST | `/:id/no-show` | salle | `PENDING/CONFIRMED → NO_SHOW`, seulement après l'heure prévue ; créneau libéré ; audité |
| GET | `/:id/waitlist-matches` | salle | Entrées compatibles de la liste d'attente (voir plus bas) |

Forme `Reservation` (réponses et temps réel) :
`{ id, code, status, source, guestName, guestPhone, guestEmail, partySize, startsAt, endsAt, durationMinutes, tables: [{id,label,capacity}],
specialRequests, notes, overrideReason, orderId, noShowSuggested, confirmedAt, seatedAt, completedAt, cancelledAt, cancelReason, noShowAt,
reminderSentAt, createdAt, updatedAt }`. `code` : 5 caractères lisibles (sans 0/O/1/I/L), unique par restaurant. `notes` : internes, jamais montrées au client.

Statuts : `PENDING → CONFIRMED → SEATED → COMPLETED` ; `PENDING|CONFIRMED → CANCELLED|NO_SHOW` ; transition interdite → 409 « Action impossible : la réservation est … ».

Règles et erreurs :
- `WALK_IN` (client sans réservation) : `startsAt` = maintenant par défaut, pas de contrôle d'horaires, pas de message au client.
- `PHONE` : dans les horaires (la réservation entière), pas dans le passé, pas un jour fermé → sinon **409** ; `partySize > maxPartySize` → **400** (`errors[0].path = "partySize"`).
- `tableIds` (choix manuel) : table prise → **409** « La table T2 est déjà réservée de 19:00 à 20:30 » ; capacité insuffisante → **409**.
- Attribution automatique impossible → **409** « Plus de table disponible sur ce créneau ».
- **`force: true`** (responsables seulement, sinon **403** ; `overrideReason` obligatoire, sinon 400) : passe outre capacité, horaires, passé, taille max.
  **Jamais** la double réservation. Audité (`reservation.force`), motif visible (`overrideReason`).
- **Double réservation impossible** : écritures sérialisées par restaurant (verrou consultatif) **et** contrainte en base
  `EXCLUDE USING gist ("tableId" WITH =, tsrange("startsAt","endsAt",'[)') WITH &&) WHERE (active)` sur `ReservationTable` (plage copiée, tampon inclus ;
  `active = false` à l'annulation, l'absence et la fin). Deux demandes simultanées : une seule réussit, l'autre reçoit un **409** propre.
- Commande depuis une réservation : `POST /tenant/orders` accepte **`reservationId`** (réservation `SEATED`, `type: DINE_IN`, `tableId` parmi ses tables, sinon 409) ;
  la commande expose `reservationId`, la réservation `orderId`.

## Liste d'attente — `/tenant/waitlist` (salle)
| Méthode | Route | Description |
|---|---|---|
| GET | `/?date=&status=` | Défaut : entrées actives (`WAITING`, `NOTIFIED`) ; `date` = jour local de l'heure souhaitée |
| POST | `/` | `{ guestName, guestPhone?, guestEmail?, partySize, desiredAt, notes? }` → 201 `WaitlistEntry` |
| POST | `/:id/notify` | Message « une table s'est libérée » (email et/ou SMS) → `NOTIFIED` ; 409 sans coordonnées ou entrée close ; réponse + `notifications: ["queued"\|"skipped"]` |
| POST | `/:id/convert` | `{ startsAt? (défaut desiredAt), durationMinutes?, tableIds?, force?, overrideReason? }` → 201 `{ entry (CONVERTED, reservationId), reservation }` ; mêmes règles que `POST /tenant/reservations` ; une seule fois (409 ensuite) |
| POST | `/:id/remove` | → `REMOVED` |

`WaitlistEntry` : `{ id, status: WAITING|NOTIFIED|CONVERTED|EXPIRED|REMOVED, guestName, guestPhone, guestEmail, partySize, desiredAt, notes, notifiedAt, reservationId, createdAt, updatedAt }`.
**Entrées compatibles** (après annulation) : actives, heure souhaitée à ± une durée de repas du créneau libéré, groupe ≤ capacité des tables libérées, les plus anciennes d'abord.
Les entrées dont l'heure souhaitée est passée de plus de 3 h passent `EXPIRED` (tâche planifiée).

## Réservation en ligne sans compte — `/public` (limitation de débit par IP)
| Méthode | Route | Limite | Description |
|---|---|---|---|
| GET | `/public/tenants/:slug/availability?date=&partySize=` | 60/min | `{ date, timezone, partySize, durationMinutes, closed, closureReason, slots: [{ startsAt, endsAt }] }` : créneaux **disponibles** seulement (délai `minNoticeMinutes`, fenêtre `bookingWindowDays`), sans tables |
| POST | `/public/tenants/:slug/reservations` | 10/h | `{ guestName, guestPhone (obligatoire), guestEmail?, partySize, startsAt, specialRequests? }` → 201 `{ code, status, manageToken, manageUrl, reservation: PublicReservation }` |
| GET | `/public/reservations/:token` | 30/min | `PublicReservation` |
| PATCH | `/public/reservations/:token` | 10/min | `{ partySize?, startsAt?, specialRequests? }` (au moins un champ) → `PublicReservation` ; client prévenu |
| DELETE | `/public/reservations/:token` | 10/min | Annule (motif « Annulée par le client ») → `PublicReservation` ; client prévenu |

- `PublicReservation` : `{ code, status, guestName, partySize, startsAt, endsAt, specialRequests, createdAt, restaurant: { name, slug, phone, timezone }, canModify, canCancel }`
  (ni tables, ni notes, ni coordonnées). `canCancel` : `PENDING/CONFIRMED` et pas encore commencée ; `canModify` : idem et au-delà du délai `minNoticeMinutes`.
- `manageUrl` = `${APP_URL}/r/:slug/reservation/:token` (page web de gestion). Le jeton n'est conservé que **haché** (SHA-256) : il n'est donné qu'à la création
  (réponse + email de confirmation). Jeton inconnu ou mal formé → 404.
- `startsAt` doit être **un créneau de la grille** (sinon 409), au-delà du délai minimal (409), dans la fenêtre (409) ; jour fermé → 409 ; plus de table → 409.
- Restaurant inconnu, suspendu ou licence expirée → **404**. `operations.onlineReservations = false` → **403 `{ code: "RESERVATIONS_DISABLED" }`**.
- Statut à la création : `CONFIRMED`, ou `PENDING` si `reservations.requireConfirmation` (la salle confirme avec `POST /:id/confirm`). `source = ONLINE`.
- Dépassement de débit → 429.

## Notifications (X1)
Modèles (`src/notifications/templates/reservations.ts`), catégorie `reminder` : envoyés par email si `guestEmail`, par SMS si `guestPhone` **et** canal SMS actif ;
désactivables par événement dans `notifications.events` :
| Modèle | Événement | Déclencheur |
|---|---|---|
| `reservation.confirmed` | `reservations` | Création confirmée (salle, en ligne) — contient le lien de gestion : variables non conservées, pas de renvoi |
| `reservation.pending` | `reservations` | Demande en ligne en attente (`requireConfirmation`) — idem |
| `reservation.updated` | `reservations` | Confirmation par la salle (`confirmedNow`) ; changement d'heure, de durée ou de taille (salle ou client) |
| `reservation.cancelled` | `reservations` | Annulation (salle avec `notifyGuest`, ou client) |
| `reservation.reminder` | `reservationReminders` | **La veille à 18 h locale**, réservations `CONFIRMED`, une seule fois (`reminderSentAt` + `dedupeKey` `reservation:<id>:reminder:<startsAt>:email\|sms`) ; pas de rappel si la réservation a été prise après cette heure ; remis à zéro si l'heure change |
| `waitlist.available` | `waitlist` | `POST /tenant/waitlist/:id/notify` |

## Tâches planifiées — `ReservationsTasks` (toutes les 5 minutes, coupées par `DISABLE_CRON`)
Rappels de la veille · proposition d'absence : réservation `PENDING/CONFIRMED` non installée `noShowGraceMinutes` après l'heure → `noShowSuggested = true`
(+ `reservation.updated`) ; la salle confirme avec `POST /:id/no-show` · expiration de la liste d'attente.

## Temps réel
- **`reservation.created`**, **`reservation.updated`** : `Reservation` complète (création salle ou en ligne ; modification, changement de statut, proposition d'absence).
- **`waitlist.updated`** : `WaitlistEntry` (création, message, conversion, retrait).
- **`table.updated`** à l'installation, à la fin et au changement de table d'une réservation installée.

---

# P4 — Personnel : fiches, planning, pointage, absences, performances, paie, messagerie (`/tenant/staff/...`, `/tenant/messaging/...`)

Module **`staff`** du plan (Starter : non) : toutes les routes `/tenant/staff/...` répondent `403 {code: "PLAN_FEATURE"}` sans lui
(garde `PlanFeatureGuard`). La **messagerie est ouverte à tous les plans**. Jours = `AAAA-MM-JJ` dans le fuseau du restaurant ; semaine = lundi→dimanche
(`localization.firstDayOfWeek`). Mêmes routes `GET /tenant/staff` (liste des comptes) et `PATCH /tenant/staff/:id` que la phase 1 (inchangées).

## Réglages — section `staff` (`GET/PATCH /tenant/settings/staff`, lecture responsables, écriture administrateur)
`{ overtimeThresholdHours: 40, leaveDaysPerYear: 24 }` : seuil hebdomadaire d'heures supplémentaires, congés payés annuels.

## Fiches (responsables ; taux horaire : administrateur)
| Méthode | Route | Rôle | Description |
|---|---|---|---|
| GET | `/profiles` · `/profiles/:userId` | responsables | Comptes (hors clients) avec leur fiche ou `profile: null`. `hourlyRate` et `overtimeMultiplier` valent `null` sauf pour l'administrateur |
| PUT | `/profiles/:userId` | responsables | Crée ou met à jour `{position, contractType: CDI\|CDD\|EXTRA\|INTERN\|OTHER, hiredAt, contractEndsAt?, emergencyContact?, notes?, hourlyRate?, overtimeMultiplier?}` ; `hourlyRate`/`overtimeMultiplier` par un gérant → **403** |
| GET | `/me` | personnel | Ma fiche (mon taux inclus) |
| PUT | `/profiles/:userId/kiosk-code` | responsables | `{code}` 4–6 chiffres, ni répétés ni en suite ; **haché** (argon2), jamais renvoyé (`kioskCodeSet`) ; 409 sans fiche |
| DELETE | `/profiles/:userId/kiosk-code` · POST `/profiles/:userId/kiosk-unlock` | responsables | Retirer le code · lever le verrouillage |

## Planning (responsables) et « mon planning »
| Méthode | Route | Rôle | Description |
|---|---|---|---|
| GET | `/planning?week=` | responsables | `{weekStart, weekEnd, days[7], timezone, shifts[], absences[] (en attente ou validées), staff[], draftCount, missingProfiles}` ; `week` = n'importe quel jour de la semaine |
| GET | `/planning/mine?week=` | personnel | Mes créneaux **publiés** et mes absences |
| POST · PATCH · DELETE | `/shifts` · `/shifts/:id` | responsables | `{staffId, startsAt, endsAt, position?, notes?}` (16 h au plus, fin > début). **409** `SHIFT_OVERLAP` (autre créneau de la personne ; bout à bout accepté), **409** `ABSENCE_CONFLICT` (absence validée), 404 autre restaurant. Verrou consultatif par personne : deux créneaux simultanés → un seul passe |
| POST | `/planning/copy` | responsables | `{fromWeek, toWeek}` → `{copied, skipped, week}` : copie en **brouillon** (même heure murale, changement d'heure compris) ; ce qui chevauche un créneau/absence est ignoré |
| POST | `/planning/publish` | responsables | `{week}` → `{published, people, notified, week}` : passe les brouillons en publiés et prévient **chaque personne concernée** (ses créneaux seulement) |

Notification X1 `staff.planning-published` (catégorie `reminder`, événement `staffPlanning` désactivable) : email, et SMS si numéro + canal actif.

## Pointage
| Méthode | Route | Rôle | Description |
|---|---|---|---|
| GET | `/me/attendance` | personnel | `{hasProfile, state: OFF\|CLOCKED_IN\|ON_BREAK, open, today[], shift}` |
| POST | `/me/punch` | personnel | `{action: IN\|OUT\|BREAK_START\|BREAK_END}` → pointage. `IN` se rattache au créneau **publié** le plus proche non déjà pris (de 2 h avant son début à sa fin). 409 : déjà pointé, pas de pointage ouvert, pause en cours / absente ; 409 sans fiche. Sérialisé par personne (deux appareils simultanés : un seul pointage ouvert) |
| GET | `/kiosk` | personnel (compte de la tablette) | Personnes ayant un code : `[{staffId, name, position, state}]` |
| POST | `/kiosk/punch` | personnel (compte de la tablette) | `{staffId, code, action}` → pointage + `name`, `source: KIOSK`. Code faux : **400 `KIOSK_CODE_INVALID`** (essais restants dans le message) ; après `security.maxFailedAttempts` échecs : **423 `KIOSK_LOCKED`** pendant `security.lockoutMinutes` (le bon code est alors refusé aussi) ; levée par un responsable. Audité |
| GET | `/attendance?from=&to=&staffId?` · `/attendance/present` | responsables | Pointages d'une période (500 max) · pointages ouverts |
| POST | `/attendance` | responsables | Saisie manuelle `{staffId, clockIn, clockOut, breakMinutes?, note}` (`source: MANUAL`, motif obligatoire) ; 409 si chevauchement |
| PATCH | `/attendance/:id` | responsables | Correction `{clockIn?, clockOut?, breakMinutes?, note}` (motif obligatoire) ; audit `staff.attendance.correct` avec avant / après |

## Absences et congés
| Méthode | Route | Rôle | Description |
|---|---|---|---|
| GET | `/absences?status=&mine=` | personnel | Responsables : toutes ; autres : les leurs |
| POST | `/absences` | personnel | `{type: PAID_LEAVE\|SICK\|UNPAID\|OTHER, from, to (inclus), reason?, staffId?}` → `PENDING`. `staffId` (responsables seulement, sinon 403) : saisie pour quelqu'un, **validée d'office**. 409 : chevauche une absence ; **solde de congés insuffisant** |
| POST | `/absences/:id/decision` | responsables | `{decision: APPROVED\|REJECTED, note?}` ; 409 si déjà traitée ; **jamais sa propre demande** (403) |
| DELETE | `/absences/:id` | personnel | La personne retire sa demande **en attente** ; un responsable supprime toute absence |
| GET | `/absences/balance?userId?&year?` | personnel | `{year, allowance, taken, pending, remaining}` (jours calendaires de congés payés, année civile) ; `userId` réservé aux responsables |

## Performances et paie
| Méthode | Route | Rôle | Description |
|---|---|---|---|
| GET | `/performance?from=&to=` | responsables | Par serveur : `{rank, name, orders, revenue, tips, cancellations, averageTicket}` + `totals` + `unassigned`. Mêmes définitions que le tableau de bord : commandes non annulées créées sur la période, encaissé = paiements `PAID` (date de paiement), ticket moyen = total des commandes ÷ nombre. Pourboires par serveur, **sans répartition**. Période ≤ 93 jours |
| GET | `/payroll?from=&to=` | **administrateur** | Par personne : `normalMinutes`, `overtimeMinutes`, `gross` (FCFA entiers) ; `thresholdHours` |
| GET | `/payroll/export?from=&to=` | **administrateur** | CSV (`;`, virgule décimale, BOM, protégé contre l'injection de formule) |

Règles d'heures (`@restaurant/utils` `computeHours`, testées) : heures = pointage − pause ; un pointage à cheval sur deux semaines est **coupé à la frontière de semaine locale**
(pause au prorata) ; au-delà du seuil hebdomadaire, les minutes les plus récentes de la semaine sont supplémentaires ; un morceau est compté dans la période où il commence
(les pointages de la semaine précédant la période servent au cumul) ; pointages ouverts ignorés ; brut = normales × taux + sup. × taux × majoration, arrondi à l'entier.

## Messagerie (tout le personnel, tous plans) — `/tenant/messaging`
Canaux communs créés à la demande : **Tous** (tout le personnel), **Salle** (administrateur, gérant, serveur), **Cuisine** (administrateur, gérant, cuisine), membres alignés sur le rôle.
Messages directs privés (clé `dm:<idA>:<idB>`, sans doublon même en concurrence ; invisibles pour tout autre, responsables compris).
| Méthode | Route | Description |
|---|---|---|
| GET | `/channels` | Mes canaux : `{id, kind: ALL\|FLOOR\|KITCHEN\|DIRECT, name, members[], unread, unreadMentions, lastMessage}` (un message direct vide n'apparaît pas chez l'autre) |
| GET | `/unread` · `/people` | Total des non-lus · personnes joignables |
| POST | `/direct` | `{userId}` → canal direct (400 soi-même, 404 autre restaurant) |
| GET | `/channels/:id/messages?before=&limit=` | Historique paginé `{messages[], hasMore}` — **404 si je ne suis pas membre** |
| POST | `/channels/:id/messages` | `{body (≤ 2000), mentions[]}` (mentions limitées aux membres, jamais soi-même) ; 404 si non membre |
| POST | `/channels/:id/read` | Marque lu |

## Temps réel (privé)
`message.created` (`{id, channelId, senderId, senderName, body, mentions, createdAt}`) est émis **uniquement aux appareils des membres du canal** (salle `tenant:<id>:user:<userId>`,
`RealtimeService.emitToUsers`) ; `planning.published` `{week}` aux personnes dont des créneaux viennent d'être publiés.

---

# P2B — Plan de salle

Salles, mise en page des tables, fusion/séparation, transfert de commande. Lecture : personnel ; mise en page : responsables ; fusion, séparation, transfert : salle (ADMIN, MANAGER, WAITER).
Unités du plan : entiers, origine en haut à gauche, rotation en degrés (0–359) ; la salle par défaut fait 1000 × 700 ; table 40–400 de côté ; formes `round`, `square`, `rect`.

## Salles — `/tenant/floor-plans`
| Méthode | Route | Rôles | Rôle de la route |
|---|---|---|---|
| GET | `/` | personnel | `[{ id, name, width, height, tableCount }]` dans l'ordre de création |
| POST | `/` | responsables | `{ name, width?, height? }` → 201 ; 409 si le nom existe déjà (sans tenir compte de la casse) |
| PATCH | `/:id` | responsables | Nom, dimensions ; 409 si une table dépasserait de la nouvelle salle |
| DELETE | `/:id` | responsables | 409 si c'est la dernière salle ou si elle contient encore des tables (même désactivées) |
| PUT | `/:id/layout` | responsables | `{ tables: [{ id, posX, posY, width, height, shape, rotation }] }` en lot (une transaction) → tables de la salle. 404 si une table n'est pas de cette salle ; 400 si elle sort de la salle ou apparaît deux fois. Audit `floorplan.layout` ; `table.updated` pour chaque table modifiée |

## Fusion et séparation — `/tenant/tables`
- `POST /merge {tableIds}` (2 à 6 tables, même salle, actives, non absorbées) → table principale. La principale est celle qui porte la commande ouverte,
  sinon celle qui est déjà fusionnée, sinon la première citée ; **capacité cumulée**, commande unique. Verrou de ligne : deux fusions simultanées d'une même table, une seule aboutit.
  409 : commandes ouvertes sur plusieurs tables, table absorbée occupée, réservation en cours ou dans les 2 h sur une table absorbée.
  Les disponibilités de réservation traitent le groupe comme **une** table de capacité cumulée ; une table absorbée n'est plus proposée.
- `POST /:id/split` (principale ou absorbée) : 409 tant que la table est occupée (commande ouverte ou réservation installée) ; les tables absorbées redeviennent indépendantes et libres.
- Audit `table.merge`, `table.split` ; `table.updated` pour chaque table du groupe.

## Transfert — `POST /tenant/orders/:id/move {tableId}` (salle)
Commande ouverte **sur place** vers une table active, non absorbée, **sans commande ouverte ni réservation installée** (409 sinon ; 404 table inconnue). Verrou sur la commande et les deux tables
(deux transferts simultanés vers la même table : un seul aboutit). Statuts des deux tables recalculés ; si la commande vient d'une réservation **installée**, la réservation change de table
(409 si la contrainte d'exclusion refuse, p. ex. table réservée au même moment). Audit `order.move` ; `order.updated`, `reservation.updated`, `table.updated` × 2.

# P2C — Espace client (module `src/customers`)
Comptes clients d'un restaurant (rôle `CUSTOMER`, un compte par restaurant), réservations rattachées, suivi de commande par lien de ticket, avis. Migration `customer_space`.
**Un client ne peut appeler aucune route du personnel** : toutes les routes `/tenant/*` portent `@TenantRoles` ; le test `test/customers.e2e-spec.ts` parcourt la documentation OpenAPI et vérifie 403 sur chacune
avec un jeton client (seules `/tenant/auth/*`, `/tenant/account/*` et `/tenant/customer/*` sont ouvertes au client). Les routes `/tenant/customer/*` sont réservées au rôle `CUSTOMER` (le personnel reçoit 403).

## Sans compte — `/public` (limitation de débit par IP)
| Méthode | Route | Limite | Description |
|---|---|---|---|
| POST | `/public/tenants/:slug/customers` | 5/h | `{ firstName, lastName, email, phone?, password, consent: true }` → 201 `{ id, email, emailVerificationSent }`. Politique de mot de passe du restaurant ; 409 si l'email existe déjà dans ce restaurant. Un code à 6 chiffres est envoyé par email. Connexion ensuite par `POST /tenant/auth/login` |
| GET | `/public/tracking/:token` | 60/min | Suivi : `{ number, type, typeLabel, stage: received\|preparing\|ready\|done\|cancelled, table, items: [{name, quantity}], expiresAt, canReview, review, restaurant }`. Sans prix, nom ni téléphone. **À interroger toutes les 5 s** (pas de socket publique). 404 jeton inconnu ; **410 `TRACKING_EXPIRED`** |
| POST | `/public/tracking/:token/review` | 10/h | `{ rating 1–5, comment?, authorName? }` → suivi mis à jour. 409 si la commande n'est pas clôturée ou déjà notée |
| GET | `/public/tenants/:slug/reviews?page=&pageSize=` | 60/min | `{ enabled, summary: { count, average, distribution } \| null, items: [{ rating, comment, author, reply, createdAt }], total }`. `enabled = false` (liste vide) tant que `operations.publicReviews` est faux |

- La carte publique (`GET /public/tenants/:slug/menu`) renvoie en plus `reviews` (`{ count, average, distribution }` ou `null` si l'affichage est désactivé).
- **Jeton de suivi** : HMAC-SHA256 du secret serveur et de l'identifiant de commande (stable : réimprimer le ticket ne change pas le lien, indevinable sans le secret) ; **seule l'empreinte SHA-256 est stockée** (`Order.trackTokenHash`).
  Le lien expire **24 h après la clôture** (ou l'annulation) de la commande ; 72 h après la création si elle n'est jamais clôturée. Lien : `${APP_URL}/r/:slug/suivi/:token` (page d'avis : `/r/:slug/avis/:token`).

## Personnel
| Méthode | Route | Rôles | Description |
|---|---|---|---|
| GET | `/tenant/orders/:id/tracking-link` | salle | `{ token, url }` à imprimer en QR sur le ticket (le ticket 80 mm le fait) ; idempotent (enregistre l'empreinte au premier appel) |
| GET | `/tenant/reviews?status=all\|visible\|hidden&rating=&unanswered=&page=&pageSize=` | responsables | `{ items: [{ id, rating, comment, author, hasAccount, order, hidden, reply, repliedAt, createdAt }], total, page, pageSize }` |
| GET | `/tenant/reviews/stats` | responsables | `{ count, average, distribution, visible: {count, average, distribution}, hiddenCount, unanswered }` (moyenne à une décimale ; `visible` = ce que voit le public) |
| POST | `/tenant/reviews/:id/hide` · `/unhide` | responsables | Modération (audit `review.hide` / `review.unhide`) |
| PUT · DELETE | `/tenant/reviews/:id/reply` | responsables | `{ text }` réponse publique / suppression (audit `review.reply` / `review.reply_delete`) |

## Client connecté (rôle `CUSTOMER`) — `/tenant/customer`
| Méthode | Route | Description |
|---|---|---|
| GET · PATCH | `/profile` | `{ id, email, firstName, lastName, phone, emailVerified, notificationPrefs }` ; PATCH `{ firstName?, lastName?, phone? }` (chaîne vide = effacer le téléphone) |
| PUT | `/notification-prefs` | `{ reservationReminders, orderReadySms }` |
| POST | `/verify-email/send` · `/verify-email` | Renvoie un code (3/10 min) · `{ code }` (5 essais, 15 min) → `{ verified, reservationsLinked }` |
| GET | `/reservations` | Réservations du client (forme publique + `id`, `canModify`, `canCancel`) |
| GET · PATCH · POST | `/reservations/:id/availability` · `/reservations/:id` · `/reservations/:id/cancel` | Mêmes règles que le lien de gestion (délais, créneaux, notifications) ; la réservation d'un autre client → 404 |
| GET | `/orders` | Commandes rattachées (`customerId` du client ou d'une de ses réservations) : `{ id, number, items, total, canReview, review }` |
| POST | `/orders/claim` | `{ token }` : rattache une commande avec le lien de son ticket (409 si déjà à un autre compte) |
| POST | `/orders/:id/review` | `{ rating, comment? }` : une fois la commande clôturée, une fois par commande (409 sinon) |
| GET | `/export` | JSON de toutes les données du client (profil, réservations, commandes, avis) |
| POST | `/delete` | `{ password }` : réservations à venir annulées ; réservations, commandes et avis **conservés mais anonymisés** (`customerId` nul, nom « Client supprimé », email/téléphone effacés, jeton de gestion supprimé, journal de notifications masqué) ; compte désactivé (`anonymizedAt`), sessions révoquées. Audit `customer.delete` |
Mot de passe, sessions : `/tenant/account/*` (inchangé).

## Règles
- **Rattachement des réservations** : par **email vérifié** uniquement (`User.emailVerifiedAt`, code à 6 chiffres envoyé par email). À la vérification, les réservations sans compte faites avec cette adresse sont rattachées ; ensuite, toute réservation en ligne faite avec cette adresse l'est d'office. Le téléphone n'est pas un identifiant de rattachement (un SMS ne porte jamais de code, voir X1).
- **Avis** : un par commande (`Feedback.orderId` unique, 409 sinon, y compris deux requêtes simultanées), commande **clôturée** et non annulée. Un avis masqué disparaît du public, de la moyenne publique et de la réponse affichée au client ; le restaurant le garde (`hidden`).
- **SMS « commande prête »** (à emporter, modèle `order.ready`) : envoyé **une seule fois** quand la commande passe à `READY`, si le canal SMS est actif (réglage `notifications.channels.sms`, désactivé par défaut), l'événement `orderReady` n'est pas coupé, un téléphone est connu (`Order.customerPhone` saisi en caisse, ou téléphone du compte rattaché) et le client n'a pas désactivé `orderReadySms`. Les rappels de réservation respectent `reservationReminders`.
- Réglage `operations.publicReviews` (administrateur) : affiche la moyenne et les avis publiés sur la carte publique.
