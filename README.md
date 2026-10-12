# Gestion de restaurant

Application full-stack (web + mobile) de gestion de restaurant, interface en français.

**Stack** : TypeScript, React + Vite, React Native (Expo), NestJS, Prisma, PostgreSQL, Redis, Socket.io.

## Modèle SaaS
Plateforme multi-tenant : un **espace SuperAdmin** (tenants, plans, licences, paiements enregistrés manuellement
en espèces / carte / Flooz / TMoney) et un **espace par restaurant**. Essai de 14 jours, licence mensuelle ou
annuelle, montants en FCFA. Détails : `docs/ARCHITECTURE.md`.

## Démarrage
```bash
cp .env.example .env
docker compose up -d
pnpm install
pnpm --filter api prisma:generate
pnpm db:migrate
psql "$DATABASE_URL" -f apps/api/prisma/sql/rls.sql   # isolation par tenant (RLS)
pnpm db:seed
pnpm dev
```

API : `http://localhost:3000/api/v1` · Swagger : `/api/docs` · SuperAdmin de dev créé par le seed
(`superadmin@restaurant.local`, mot de passe `ChangeMe123!` — à changer via `SEED_SUPERADMIN_PASSWORD`).
Documentation des routes : `docs/API.md`.

## Structure
Voir `docs/ARCHITECTURE.md`. Schéma de données : `apps/api/prisma/schema.prisma`.

## Phases
0. Plateforme SaaS (tenants, plans, licences, paiements manuels, inscription)
1. Auth + menu + commandes + KDS  2. Réservations  3. Stock  4. Personnel  5. Rapports  6. Mobile
