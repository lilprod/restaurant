# Gestion de restaurant

SaaS multi-restaurants de gestion de restaurant : un **espace plateforme** (SuperAdmin) et un **espace par restaurant**
(personnel et clients). Interface en français, montants en **FCFA** entiers (prix TTC), fuseau horaire propre à chaque restaurant.

**Stack** : TypeScript · pnpm + Turborepo · API NestJS 11 + Prisma 5 + PostgreSQL 16 (RLS) + Redis (BullMQ) + Socket.io ·
web React 19 + Vite + Tailwind v4 + Radix + TanStack Query (PWA) · Docker + nginx.

## Fonctionnalités

| Domaine | Contenu |
|---|---|
| **Plateforme SaaS** | Restaurants créés par le SuperAdmin ou inscrits en ligne, plans (Starter / Pro / Premium), essai 14 jours, licences mensuelles ou annuelles, paiements enregistrés manuellement (espèces, carte, Flooz, TMoney) avec reçus PDF, relances d'échéance, période de grâce, rapports de revenus |
| **Sécurité** | Cloisonnement des données par restaurant au niveau de la base (RLS), 2FA (TOTP + codes de secours), sessions avec jeton de rafraîchissement en cookie HttpOnly, verrouillage, limitation de débit, journal d'audit, purges RGPD, test anti-IDOR sur toutes les routes |
| **Paramètres et marque** | Informations complètes, logo, favicon, couleurs et thèmes clair / sombre appliqués automatiquement |
| **Salle et cuisine** | Équipe, tables et **plan de salle** (éditeur multi-salles, fusion, transfert), carte (options, allergènes, **formules**, horaires, **promotions**), prise de commande, **écran cuisine temps réel**, encaissement (rendu, partage, remboursement), caisse, tableau de bord |
| **Réservations** | Disponibilités, aucune double réservation (contrainte en base), réservation en ligne sans compte avec lien de gestion, liste d'attente, rappels |
| **Stock** | Ingrédients, fiches recettes, déduction automatique à la préparation, alertes, pertes, inventaire, fournisseurs et commandes fournisseurs, marges |
| **Personnel** | Fiches, planning publié, pointage (compte ou tablette avec code), absences et congés, performances, paie et export CSV, messagerie interne |
| **Espace client** | Compte par restaurant, suivi de commande par QR sans compte, avis et modération, export et suppression des données |
| **Livraison** | Zones par quartier (repères, frais, minimum, délai), dispatch, écran livreur mobile, paiement à la livraison et rapprochement, SMS au client |
| **Rapports** | Ventes, TVA, caisse, marges, pertes, personnel, avis, heures de pointe ; exports CSV / PDF, factures PDF, rapport quotidien par email |
| **Notifications** | Email et SMS à pilotes interchangeables (log, SMTP, Twilio, HTTP générique), file avec reprises, journal consultable |
| **PWA et impression** | Application installable, prise de commande hors ligne sans doublon (idempotence), tickets cuisine et caisse (navigateur ou imprimante thermique ESC/POS en série / USB) |

En cours ou à venir : notifications push web pour l'équipe (X5B), paiement en ligne (X6, selon l'agrégateur choisi),
application mobile native « Équipe » (X3, optionnelle). Suivi détaillé : [`docs/agents/README.md`](docs/agents/README.md).

## Démarrage en développement

Prérequis : Node 22, pnpm, PostgreSQL 16 (le script crée un cluster local sur le port 5433).

```bash
pnpm install
bash scripts/dev/setup-db.sh   # bases restaurant + restaurant_test, migrations, RLS, seed, restaurant de démo « demo »
bash scripts/dev/start.sh      # API :3000 et web :5173 en arrière-plan (arrêt : bash scripts/dev/stop.sh)
```

| Accès | Adresse / identifiants |
|---|---|
| Web | `http://localhost:5173` — SuperAdmin `/admin`, restaurant `/r/<slug>`, inscription `/inscription` |
| API | `http://localhost:3000/api/v1` · Swagger `/api/docs` (désactivé par défaut en production) |
| SuperAdmin de dev | `superadmin@restaurant.local` / `ChangeMe123!` (via `SEED_SUPERADMIN_PASSWORD` ailleurs qu'en dev) |
| Restaurant de démo | `admin`, `manager`, `waiter`, `kitchen` ou `driver` `@demo.demo` / `Demo-Resto-2026` — autre restaurant : `pnpm --filter api seed:demo -- <slug> --create` |

Variables d'environnement : `.env.example` (développement) et `.env.prod.example` (production), validées au démarrage par `apps/api/src/config/env.ts`.

## Vérification

```bash
pnpm lint && pnpm build && pnpm test       # lint, build, tests unitaires (API + web)
pnpm --filter api test:e2e                 # tests e2e de l'API (PostgreSQL)
bash scripts/dev/test-rls.sh               # toute la suite e2e sous un rôle SQL non superuser (RLS réellement appliquée)
node scripts/ci/audit.mjs                  # audit des dépendances (hautes et critiques bloquantes)
E2E_DATABASE_URL=postgresql://app:app@localhost:5433/<base vide> bash scripts/ci/web-e2e.sh   # 20 parcours Playwright (build de production)
```

La CI GitHub (`.github/workflows/ci.yml`, 6 jobs) exécute tout cela, plus l'analyse des scripts et Dockerfiles, la sauvegarde / restauration réelles
et la construction des images avec la pile Docker de production.

## Production

Images Docker (API, web servi par nginx, migrations, sauvegardes) et `docker-compose.prod.yml` : PostgreSQL, Redis, API, web, sauvegardes.
Rôles SQL séparés (l'application tourne sans superuser ni BYPASSRLS), en-têtes de sécurité (CSP stricte, HSTS), stockage des fichiers sur disque
ou compatible S3, sauvegardes chiffrées avec rotation et copie hors site, contrôle de santé `/api/v1/health`.
Procédure complète, variables et choix restant au propriétaire : [`docs/DEPLOIEMENT.md`](docs/DEPLOIEMENT.md).

## Structure

```
apps/api            API NestJS (Prisma, RLS, Socket.io, tâches planifiées)
apps/web            application web React (PWA)
packages/           shared-types, validation (Zod), utils (calculs partagés), api-client (client typé), ui-tokens
docker/             Dockerfiles et configuration nginx
scripts/            dev (base, serveurs, RLS), deploy (migrations, smoke), ops (sauvegardes, supervision), ci (audit)
docs/               API.md, ARCHITECTURE.md, DEPLOIEMENT.md, agents/
```

## Documentation

| Document | Contenu |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Architecture, multi-tenant, sécurité, modèle de données (`apps/api/prisma/schema.prisma`) |
| [`docs/API.md`](docs/API.md) | Routes, rôles, événements temps réel, notifications, exports |
| [`docs/DEPLOIEMENT.md`](docs/DEPLOIEMENT.md) | Mise en production, variables, sauvegardes, supervision, mise à jour |
| [`CLAUDE.md`](CLAUDE.md) et [`docs/agents/`](docs/agents/) | Travail avec des agents : conventions, recettes backend / frontend, vérification, orchestration, fiches des sous-projets |
| [`.claude/skills/vercel-design`](.claude/skills/vercel-design) | Système de design des écrans (Geist, clair / sombre, thème du restaurant) |
