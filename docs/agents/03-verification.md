# Vérification avant de rendre, et format du rapport

Un sous-projet n'est **terminé** que si tout ce qui suit est vrai et **prouvé par une commande exécutée** (pas « devrait passer »).

## 1. Contrôles obligatoires

```bash
pnpm lint            # types stricts de tous les paquets (10 tâches)
pnpm build           # build de tous les paquets
pnpm test            # unitaires API (Jest) + web (Vitest)
pnpm --filter api test:e2e                       # e2e API sur PostgreSQL (migrations appliquées à la base de test)
```

Si le sous-projet touche l'API ou le schéma, rejouez aussi **toute** la suite e2e **sous RLS** (rôle non superuser `app_rls`) :
```bash
bash scripts/dev/test-rls.sh                 # migrations, rôle + droits, rls.sql, puis toute la suite sous app_rls
bash scripts/dev/test-rls.sh test/staff      # pendant le travail : seulement vos fichiers
```
`test/rls.e2e-spec.ts` échoue si une table portant `tenantId` n'a pas sa politique dans `rls.sql` (exemptions justifiées dans le test),
et `test/idor.e2e-spec.ts` parcourt toutes les routes déclarées (sans jeton → 401 ; identifiants d'un autre restaurant → jamais 2xx ;
compte client → 403 sur les routes du personnel). Une nouvelle route ou table y est couverte automatiquement.
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
- pnpm lint : … · pnpm build : … · pnpm test : API x/x, web y/y · e2e : n/n (deux exécutions) · e2e sous RLS (`scripts/dev/test-rls.sh`) : n/n
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
