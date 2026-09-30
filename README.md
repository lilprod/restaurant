# Gestion de restaurant

Application full-stack (web + mobile) de gestion de restaurant, interface en français.

**Stack** : TypeScript, React + Vite, React Native (Expo), NestJS, Prisma, PostgreSQL, Redis, Socket.io.

## Démarrage
```bash
cp .env.example .env
docker compose up -d
pnpm install
pnpm db:migrate && pnpm db:seed
pnpm dev
```

## Structure
Voir `docs/ARCHITECTURE.md`. Schéma de données : `apps/api/prisma/schema.prisma`.

## Phases
1. Auth + menu + commandes + KDS  2. Réservations  3. Stock  4. Personnel  5. Rapports  6. Mobile
