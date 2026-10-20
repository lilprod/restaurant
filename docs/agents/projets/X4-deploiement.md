# X4 — Déploiement, Docker, CI, sauvegardes, stockage objet

> **Type** infra · **Dépend de** — · **En parallèle avec** tout (ne modifie pas le schéma) · **Taille** M · **Modèle** `sonnet`

## Objectif
Pouvoir mettre l'application en production de façon reproductible, surveillée et sauvegardée, sans dépendre d'un conteneur de développement.

## Existant
`docker-compose.yml` (PostgreSQL + Redis pour le dev), CI GitHub Actions (`.github/workflows/ci.yml` : lint, build, tests, e2e API sur PostgreSQL),
scripts `scripts/dev/*`. Fichiers stockés sur disque (`StorageService`, `UPLOAD_DIR`). Pas de Dockerfile, pas de point de santé.

## Périmètre
1. **Images Docker** multi-étapes : `docker/api.Dockerfile` (build pnpm/turbo, `prisma generate`, image finale node slim non-root,
   `HEALTHCHECK`) et `docker/web.Dockerfile` (build Vite → nginx, fallback SPA, cache long des assets, en-têtes de sécurité, proxy `/api`, `/uploads`,
   `/socket.io` avec WebSocket).
2. **`docker-compose.prod.yml`** : postgres (volume), redis, api, web ; variables via `.env` ; réseau interne ; seul le web exposé.
3. **Mise en service de la base** : script `scripts/deploy/migrate.sh` → `prisma migrate deploy`, création/droits du rôle applicatif **non superuser**
   (`GRANT` + `ALTER DEFAULT PRIVILEGES`), application de `prisma/sql/rls.sql`, seed plateforme si vide. Idempotent. Documenter pourquoi l'application
   ne doit pas tourner en superuser (la RLS serait ignorée).
4. **Point de santé** `GET /api/v1/health` (base + Redis si configuré) et **journaux JSON** (pino ou logger Nest au format JSON) avec identifiant de requête.
5. **Stockage objet** : pilote S3-compatible pour `StorageService` (S3, Cloudflare R2, MinIO) choisi par `STORAGE_DRIVER=disk|s3`, mêmes garanties
   (types vérifiés par signature, en-têtes `nosniff`, noms aléatoires, suppression à remplacement). Tests du pilote avec MinIO en CI ou un faux client.
6. **Sauvegardes** : `scripts/ops/backup.sh` (pg_dump compressé, rotation 7 jours / 4 semaines / 6 mois, copie vers stockage objet) et
   `scripts/ops/restore.md` (procédure testée : restauration dans une base vide puis `pnpm --filter api test:e2e` contre elle n'est pas requis, mais une
   vérification de cohérence oui).
7. **CI** : ajouter le job e2e **sous RLS** (rôle non superuser), le build des images, et un job web (lint + tests). Cache pnpm.
8. **Documentation** `docs/DEPLOIEMENT.md` : prérequis, variables (avec `DATA_ENCRYPTION_KEY`, `SEED_SUPERADMIN_PASSWORD`, `PUBLIC_API_URL`, `APP_URL`,
   `CORS_ORIGIN`), sous-domaines par restaurant (DNS joker `*.domaine` + certificat), première mise en service, mise à jour, retour arrière, sauvegarde/restauration.

## Hors périmètre
Choix de l'hébergeur (question ouverte), Kubernetes, CDN, cookies HttpOnly / CSP (→ X7).

## Critères d'acceptation
- [ ] `docker compose -f docker-compose.prod.yml up -d` sur une machine vierge donne une application fonctionnelle (connexion SuperAdmin, création d'un restaurant, commande, écran cuisine en temps réel à travers nginx).
- [ ] L'API tourne avec un rôle non superuser et la RLS est active (test qui le prouve dans le rapport).
- [ ] Sauvegarde puis restauration démontrées.
- [ ] CI verte avec les nouveaux jobs.

## Questions ouvertes (défaut retenu)
- Hébergeur ? → **agnostique (Docker Compose sur un VPS)** ; le propriétaire choisit (VPS local, OVH, Hetzner, Fly.io…).
- Stockage objet ? → **pilote S3 générique**, disque par défaut.
