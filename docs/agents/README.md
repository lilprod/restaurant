# Délégation aux sous-agents — mode d'emploi

Ce dossier contient tout ce qu'un sous-agent doit lire pour travailler sur le projet **sans contexte préalable**,
et tout ce dont l'orchestrateur (l'agent principal) a besoin pour découper, lancer, relire et intégrer le travail.

| Document | Pour qui | Contenu |
|---|---|---|
| [`00-conventions.md`](00-conventions.md) | **Tous les agents (obligatoire)** | Stack, structure du dépôt, règles non négociables (multi-tenant, sécurité, français, FCFA), environnement, commandes, pièges |
| [`01-backend.md`](01-backend.md) | Agents API | Recette pour ajouter un module NestJS : schéma Prisma, migration, RLS, rôles, validation partagée, temps réel, tests |
| [`02-frontend.md`](02-frontend.md) | Agents web / mobile | Recette pour ajouter des écrans : skill `vercel-design`, client API, requêtes, temps réel, navigation par rôle |
| [`03-verification.md`](03-verification.md) | Tous | Contrôles à faire avant de rendre, format du rapport final |
| `scripts/dev/` | Tous | `setup-db.sh` (base + données de démo), `start.sh` / `stop.sh` (serveurs) |
| [`04-orchestration.md`](04-orchestration.md) | Orchestrateur | Ordre des sous-projets, parallélisation, gabarit de lancement, relecture et intégration |
| [`projets/`](projets/) | Un agent par fiche | Une fiche par sous-projet : objectif, existant, périmètre, données, API, écrans, règles métier, tests, critères d'acceptation, prompt de lancement |

## État du projet (à tenir à jour par l'orchestrateur)

| Phase | Contenu | État |
|---|---|---|
| 0 | Plateforme SaaS : SuperAdmin, restaurants, plans, licences, paiements manuels (espèces, carte, Flooz, TMoney), inscriptions | ✅ livré |
| 0 | Sécurité (2FA, sessions, verrouillage, politiques), paramètres, marque, thèmes, logo/favicon | ✅ livré |
| 0b | Application web (espaces SuperAdmin et restaurant), design Vercel/Geist | ✅ livré |
| 1 | Équipe, tables, menu, commandes, écran cuisine temps réel, encaissement, caisse, tableau de bord du jour | ✅ livré |
| 2+ | Voir la carte des sous-projets ci-dessous | ⏳ à déléguer |

## Carte des sous-projets

| Fiche | Sous-projet | Type | Modèle | Dépend de | En parallèle avec |
|---|---|---|---|---|---|
| [`X0`](projets/X0-dette-technique.md) | Dette technique et petites corrections | API + web | sonnet (+ haiku) | — | X4 |
| [`X1`](projets/X1-notifications.md) | Notifications : email, SMS, file de tâches, relances | API (+ web) | sonnet | — | X4, P3 |
| [`X4`](projets/X4-deploiement.md) | Déploiement, Docker, CI, sauvegardes, stockage objet | infra | sonnet | — | tout |
| [`P1B`](projets/P1B-complements-menu.md) | Formules, disponibilité horaire, promotions | API + web | sonnet | phase 1 | P3, X1 |
| [`P2A`](projets/P2A-reservations.md) | Réservations, disponibilités, liste d'attente, horaires | API + web | opus (API) + sonnet (web) | X1 | P3, X4 |
| [`P3`](projets/P3-stock.md) | Stock : recettes, déduction, alertes, fournisseurs, pertes | API + web | opus (déduction) + sonnet | phase 1 | P2A, P2B, P2C |
| [`P2B`](projets/P2B-plan-de-salle.md) | Plan de salle visuel, fusion, transfert, vue du service | web (+ API) | sonnet | P2A | P3, P4 |
| [`P2C`](projets/P2C-espace-client.md) | Espace client : compte, réservations, suivi, avis | API + web | sonnet | P2A | P3, P4 |
| [`P4`](projets/P4-personnel.md) | Personnel : planning, pointage, performances, paie, messagerie | API + web | sonnet | phase 1 | P2B, P2C, P3 |
| [`P5`](projets/P5-rapports.md) | Rapports, analyses, exports PDF/CSV | API + web | sonnet | P3, P4, P2C | X2 |
| [`X2`](projets/X2-livraison.md) | Livraison : zones, frais, livreurs, suivi | API + web | sonnet | phase 1, X1 | P5 |
| [`X5`](projets/X5-hors-ligne-impression.md) | Hors-ligne (PWA), impression des tickets | web (+ API) | sonnet | phase 1 | P3, P4 |
| [`X7`](projets/X7-securite.md) | Durcissement sécurité, RGPD | API + web | opus | X4 | P5, X2 |
| [`X3`](projets/X3-mobile.md) | Application mobile Expo | mobile | sonnet | API stable (après P2C) | P5 |
| [`X6`](projets/X6-paiement-en-ligne.md) | Paiement en ligne (agrégateur) | API + web | opus | **décision du propriétaire** | — |

Ordre recommandé et règles de parallélisation : [`04-orchestration.md`](04-orchestration.md).
