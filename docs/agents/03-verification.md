# Vérification avant de rendre, et format du rapport

Un sous-projet n'est **terminé** que si tout ce qui suit est vrai et **prouvé par une commande exécutée** (pas « devrait passer »).

## 1. Contrôles obligatoires

```bash
pnpm lint            # types stricts de tous les paquets (10 tâches)
pnpm build           # build de tous les paquets
pnpm test            # unitaires API (Jest) + web (Vitest)
pnpm --filter api test:e2e                       # e2e API sur PostgreSQL (migrations appliquées à la base de test)
```

Si le sous-projet touche l'API ou le schéma, rejouez aussi l'e2e **sous RLS** (rôle non superuser) :
```bash
psql postgresql://app:app@localhost:5433/restaurant_test -qc "GRANT ALL ON ALL TABLES IN SCHEMA public TO app_rls"
psql postgresql://app:app@localhost:5433/restaurant_test -qf apps/api/prisma/sql/rls.sql
cd apps/api && TEST_DATABASE_URL=postgresql://app_rls:rls@localhost:5433/restaurant_test \
  npx jest --config test/jest-e2e.json --runInBand test/platform test/security test/restaurant test/<votre-domaine>
```
Lancez la suite e2e **deux fois** : elle doit être stable (pas de dépendance à l'ordre, à l'heure ou à l'aléatoire).

## 2. Contrôles fonctionnels

- **Rôles** : chaque route nouvelle testée avec un rôle autorisé **et** un rôle interdit.
- **Isolation** : un second restaurant ne voit rien (404 / liste vide / aucun événement temps réel).
- **Concurrence** : toute opération sur de l'argent, du stock ou un créneau testée avec deux requêtes simultanées.
- **Temps réel** (si concerné) : un scénario Playwright à deux pages prouve la mise à jour sans rechargement.
- **Écrans** : captures avec `.claude/skills/vercel-design/scripts/screenshots.mjs` (clair + sombre, 1440 + 390 px, + 1024×768 pour les écrans tactiles),
  **regardées** une à une (outil Read sur les PNG), grille `references/checklist.md` du skill passée. Le script doit sortir sans erreur JS ni débordement horizontal.
- **Navigateur réel** : au moins un parcours complet du sous-projet effectué dans l'application lancée (`scripts/dev/start.sh`), pas seulement les tests.

## 3. Hygiène

- `git status` : aucun fichier parasite (journaux, captures, `.env`, `uploads/`, `dist/`, scripts temporaires). Les fichiers temporaires vont dans votre dossier de travail hors dépôt.
- Aucun secret, jeton ou mot de passe réel dans le code, les tests ou le rapport.
- Serveurs arrêtés par PID (`scripts/dev/stop.sh`).
- `docs/API.md` et, si l'architecture change, `docs/ARCHITECTURE.md` mis à jour. Nouvelle variable d'environnement → `.env.example` + `config/env.ts` (validée).
- Ne pas commiter : l'orchestrateur intègre.

## 4. Format du rapport final (à rendre tel quel, concis)

```markdown
## Rapport — <ID fiche> <titre>

### 1. Livré
- API : routes (méthode, chemin, rôles) — une ligne chacune
- Données : modèles/colonnes ajoutés, migration(s) `<nom>`, ajouts à rls.sql
- Écrans : route → rôle → ce qu'on y fait
- Temps réel / tâches planifiées / notifications : événements et déclencheurs

### 2. Vérifications (commandes exécutées et résultats chiffrés)
- pnpm lint : … · pnpm build : … · pnpm test : API x/x, web y/y · e2e : n/n (deux exécutions) · e2e sous RLS : n/n
- Parcours testés dans le navigateur : …
- Captures : chemins absolus des plus représentatives

### 3. Critères d'acceptation de la fiche
- [x] critère 1 — preuve (test ou capture)
- [ ] critère non tenu — pourquoi

### 4. Écarts, compromis, questions
- Décisions prises faute de réponse (et alternative)
- Problèmes trouvés hors périmètre (fichier:ligne), non corrigés
- Dette laissée volontairement
```
