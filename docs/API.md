# API — Plateforme SaaS (espace SuperAdmin)

Base : `/api/v1` · Documentation interactive (Swagger) : `/api/docs` · Montants en **FCFA** (entiers).
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
| GET | `/platform/payments` · `/platform/payments/:id` | | Liste filtrable (tenant, mode, dates) avec total / reçu |
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

- `restriction` vaut `"pwd-change"` (mot de passe temporaire ou expiré) ou `"2fa-setup"` (2FA obligatoire pour ce rôle) :
  la session ne peut alors appeler que les routes « Mon compte » ; les autres répondent `403 {code: "RESTRICTED_SESSION"}`.
- Licence expirée ou restaurant suspendu : `403 {code: "LICENSE_BLOCKED"}` (connexion, rafraîchissement et toutes les routes du restaurant).
- Compte verrouillé : `423 {code: "ACCOUNT_LOCKED"}`.

## Mon compte — `/platform/account/...` et `/tenant/account/...`
`GET me` · `PATCH profile` · `POST avatar` · `POST change-password` · `GET sessions` · `DELETE sessions/:id` · `DELETE sessions` (toutes les autres) ·
`POST 2fa/setup` (secret + QR) · `POST 2fa/enable` (premier code → 8 codes de secours, affichés une seule fois) ·
`POST 2fa/disable` · `POST 2fa/recovery-codes` (mot de passe + code requis) · `GET login-history`.

## Paramètres du restaurant — `/tenant/settings`
Sections : `business` (identité légale, NIF, RCCM, adresse, contacts, réseaux sociaux, ticket de caisse), `branding` (nom affiché, slogan, thème),
`operations` (TVA, service, pourboires, réservations, livraison…), `localization` (langue, fuseau, format de date), `security` (politique ci-dessous).

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
