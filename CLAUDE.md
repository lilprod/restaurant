# Gestion Restaurant — consignes pour les agents

SaaS multi-restaurants (espace plateforme SuperAdmin + un espace par restaurant). Interface en français, montants en FCFA entiers (prix TTC).

Avant toute tâche, lire **`docs/agents/00-conventions.md`** (règles non négociables, environnement, commandes, pièges, économie de tokens).
- Travail délégué sur un sous-projet : sa fiche dans `docs/agents/projets/`, puis `docs/agents/01-backend.md` / `02-frontend.md`, puis `03-verification.md`.
- Orchestration (découpage, ordre, choix du modèle, relecture, intégration) : `docs/agents/04-orchestration.md`.
- Écrans : skill `.claude/skills/vercel-design`. Routes et rôles : `docs/API.md`.

Démarrage rapide : `bash scripts/dev/setup-db.sh` puis `bash scripts/dev/start.sh` (arrêt : `scripts/dev/stop.sh`).
Vérification : `pnpm lint && pnpm build && pnpm test && pnpm --filter api test:e2e`.
