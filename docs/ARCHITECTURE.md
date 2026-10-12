# Architecture

Monorepo pnpm + Turborepo : `apps/api` (NestJS + Prisma), `apps/web` (React + Vite), `apps/mobile` (Expo),
`packages/*` (types, validation Zod, client API, utils, tokens UI).

## Modèle SaaS multi-tenant

Deux espaces distincts :

| Espace | Qui | Données |
|---|---|---|
| **Plateforme** (SuperAdmin) | `PlatformUser` (`SUPER_ADMIN`, `SUPPORT`) | `Tenant`, `Plan`, `Subscription`, `SubscriptionPayment`, `TenantRegistration`, `PlatformAuditLog` |
| **Tenant** (un restaurant) | `User` (`ADMIN`, `MANAGER`, `WAITER`, `KITCHEN`, `CUSTOMER`) | tout le reste, porte une colonne `tenantId` |

- **Isolation** : base PostgreSQL unique, `tenantId` sur chaque table métier + Row Level Security
  (`apps/api/prisma/sql/rls.sql`, à appliquer après les migrations). Chaque requête tenant fixe
  `app.tenant_id` dans sa transaction ; les opérations SuperAdmin fixent `app.bypass_rls = 'on'`.
  Le rôle SQL de l'application ne doit pas être superuser.
- **Résolution du tenant** : sous-domaine (`slug.monapp.com`), vérifié contre le `tenantId` du JWT.
- **Comptes** : un `User` appartient à un seul tenant (`email` unique par tenant). Un client a donc un compte par restaurant.
- **Monnaie** : FCFA (`XOF`), montants **entiers** sans centimes (`price`, `total`, `amount`…). Numérotation des commandes par tenant (`Tenant.nextOrderNumber`).

## Cycle de vie d'un tenant

1. **Inscription** : un restaurant remplit le formulaire public (`TenantRegistration`, statut `PENDING`),
   ou le SuperAdmin crée directement le tenant.
2. **Validation** par le SuperAdmin → création du `Tenant` + du `User` ADMIN + d'une `Subscription`
   `TRIALING` de **14 jours** (`TenantStatus.TRIAL`).
3. **Paiement de licence (V1, manuel)** : le SuperAdmin enregistre un `SubscriptionPayment`
   (`CASH`, `CARD`, `FLOOZ`, `TMONEY`, référence, période couverte, reçu `REC-AAAA-NNNNNN`).
   La licence passe `ACTIVE` et `currentPeriodEnd` est prolongé (mensuel ou annuel).
4. **Expiration** : à `currentPeriodEnd` → `GRACE` pendant 7 jours (accès maintenu, bandeau d'alerte),
   puis `EXPIRED` et `TenantStatus.SUSPENDED` (accès bloqué). Un nouveau paiement réactive le tenant.
5. Un job planifié (BullMQ) passe les statuts et envoie les rappels (J-7, J-1, expiration).

Plus tard, un intégrateur de paiement (CinetPay, PayDunya, Stripe…) pourra créer les mêmes
`SubscriptionPayment` automatiquement, sans changer le modèle.

## Plans
`Plan` : prix mensuel/annuel en FCFA, `trialDays`, limites (`maxUsers`, `maxTables`) et `features` (JSON des
modules activés). Les guards NestJS vérifient plan + statut de licence avant chaque requête tenant.

## Sécurité et paramètres

- **Comptes** : `PlatformUser` (éditeur) et `User` (restaurant) partagent la même logique (`apps/api/src/security/`) :
  connexion, verrouillage, 2FA TOTP + codes de secours, sessions révocables, mot de passe oublié, restrictions de session.
- **Sessions** : jeton d'accès de 15 min lié à une session (`RefreshToken`) ; fermer la session invalide aussitôt le jeton d'accès.
  L'état « mot de passe à changer » / « 2FA obligatoire » est relu en base à chaque requête, donc levé dès que l'utilisateur régularise.
- **Licence** : `LicenseGateService` bloque connexion, rafraîchissement et chaque requête d'un restaurant dont la licence est expirée ou qui est suspendu (la période de grâce reste accessible).
- **Réglages** : `SettingsEngine` (sections JSON validées par Zod, défauts + fusion profonde). Restaurant → table `Setting` (sous RLS) ; plateforme → `PlatformSetting`.
  Les URL des logos ne sont jamais saisies : elles viennent des routes d'envoi.
- **Thème** : couleurs de texte lisibles (contraste WCAG) et variables CSS calculées dans `packages/utils`, partagées par l'API, le web et le mobile.
- **Fichiers** : `StorageService` (disque, interchangeable) ; validation par signature binaire.
