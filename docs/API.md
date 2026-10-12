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
