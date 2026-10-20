# Conventions communes — à lire par tout agent avant de commencer

Projet : **SaaS de gestion de restaurants** (Togo / Afrique de l'Ouest d'abord). Un **espace plateforme** (l'éditeur : SuperAdmin, Support)
gère des **restaurants** (tenants). Chaque restaurant a son personnel (ADMIN, MANAGER, WAITER, KITCHEN) et ses clients (CUSTOMER).
Interface **en français**, montants **en FCFA (XOF), entiers, prix TTC**, fuseau par défaut `Africa/Lome`.

## 1. Stack et structure

| Zone | Techno | Emplacement |
|---|---|---|
| API | NestJS 11, Prisma 5, PostgreSQL 16, Socket.io, Zod | `apps/api` |
| Web | React 19, Vite 6, Tailwind v4, Radix (façon shadcn/ui), TanStack Query, React Router 6, react-hook-form, Motion, Recharts | `apps/web` |
| Mobile | Expo (à créer, fiche X3) | `apps/mobile` |
| Types partagés | énumérations, constantes | `packages/shared-types` |
| Validation partagée | schémas Zod utilisés par l'API **et** les formulaires | `packages/validation` |
| Logique pure partagée | thèmes/contraste, politique de mot de passe, **calculs de commande** (`computeTotals`, `splitEqually`…), fuseaux horaires | `packages/utils` |
| Client API typé | fetch + rafraîchissement de session, erreurs typées, endpoints | `packages/api-client` |
| Couleurs de statut | `statusTone`, `orderStatusTone`… | `packages/ui-tokens` |
| Design | skill `vercel-design` (règles, jetons, recettes, script de captures) | `.claude/skills/vercel-design` |
| Documentation | API (routes, rôles, erreurs), architecture | `docs/API.md`, `docs/ARCHITECTURE.md` |

Monorepo **pnpm + Turborepo**. Avant de modifier `turbo.json` ou les commandes turbo, lire `AGENTS.md` (bloc géré par turbo).

Organisation de l'API (`apps/api/src`) :
- `platform/` espace SuperAdmin · `tenant/` authentification, paramètres, sécurité, licence côté restaurant
- `security/` comptes, sessions, 2FA, gardes (`SpaceAuthGuard`, `TenantAuthGuard`, `PlatformAuthGuard`, `Roles`, `AllowRestricted`)
- `settings/` moteur de réglages par sections · `storage/` fichiers (validation par signature binaire) · `mail/` emails
- `restaurant/` phase 1 (équipe, tables, menu, commandes, caisse, tableau de bord) · `realtime/` Socket.io
- Les dossiers vides hérités (`inventory/`, `reservations/`, `staff/`, `notifications/`…) sont des emplacements prévus :
  **un nouveau domaine = un module dans son dossier** (`src/reservations/reservations.module.ts`…), branché dans `app.module.ts`.

## 2. Règles non négociables

1. **Isolation des restaurants (RLS)**. Toute table métier porte `tenantId`. Toute lecture/écriture de ces tables passe par
   `prisma.asTenant(tenantId, tx => …)` (ou `asPlatform` pour la plateforme). La base applique en plus une politique RLS
   (`apps/api/prisma/sql/rls.sql`) : un oubli de filtre ne doit jamais exposer un autre restaurant. Une **nouvelle table métier**
   doit être ajoutée à `rls.sql` (même bloc que les autres) et testée avec le rôle non superuser (voir `03-verification.md`).
2. **Le tenant vient du jeton, jamais du client**. Côté restaurant, `acc.tenantId` (compte authentifié) ; jamais un `tenantId` reçu dans le corps ou l'URL.
3. **Rôles vérifiés côté API** (`@TenantRoles(...)`, groupes `STAFF`, `FLOOR`, `KITCHEN`, `MANAGERS` de `src/restaurant/common.ts`).
   Le web masque/désactive ce qui est interdit, mais l'API reste l'arbitre.
4. **Licence** : toutes les routes restaurant passent par `TenantAuthGuard` (qui bloque une licence expirée). Ne pas créer de route restaurant sans cette garde.
5. **Validation** : chaque corps / requête est validé par un schéma Zod de `packages/validation` (via `ZodPipe`) ; les formulaires web réutilisent **le même schéma**.
   Messages en français (`installFrenchErrors`, déjà actif côté API et web).
6. **Argent** : entiers FCFA, prix TTC, TVA « dont TVA » via `vatIncluded` ; aucun flottant pour un montant ; prix **figés** au moment de l'achat.
7. **Erreurs** : messages en français destinés à l'utilisateur final (l'interface les affiche tels quels). Codes métier quand le web doit réagir :
   `RESTRICTED_SESSION`, `LICENSE_BLOCKED`, `ACCOUNT_LOCKED`, `PLAN_LIMIT` ; 409 pour les conflits métier, 404 pour « introuvable » (aussi quand la ressource appartient à un autre restaurant).
8. **Audit** : actions sensibles (annulations, remboursements, réglages, sécurité, argent) → `AuditLog` (restaurant) ou `PlatformAuditLog` (plateforme).
9. **Secrets** : jamais de secret, mot de passe réel, jeton ou clé dans le dépôt, les journaux ou les rapports. Les comptes de démonstration ci-dessous sont des comptes locaux de développement.
10. **Pas de régression** : les suites existantes doivent rester vertes ; on ne désactive, ne saute ni n'affaiblit jamais un test pour passer.
11. **Pas de commit ni de push** par les sous-agents : le travail reste dans l'arbre de travail (ou la branche de worktree fournie) ; l'orchestrateur relit, revérifie et intègre.

## 3. Environnement de développement

Un conteneur neuf n'a ni base ni données. Depuis la racine du dépôt :

```bash
bash scripts/dev/setup-db.sh      # PostgreSQL local (port 5433), bases restaurant + restaurant_test, migrations, RLS, seed, restaurant « demo »
bash scripts/dev/start.sh         # API http://localhost:3000/api/v1 (Swagger /api/docs) + web http://localhost:5173 (PID dans .dev-pids)
bash scripts/dev/stop.sh          # arrête ce que start.sh a lancé
```

Comptes locaux créés par le script (développement uniquement) :
- SuperAdmin : `superadmin@restaurant.local` / `ChangeMe123!`
- Restaurant `demo` (carte togolaise de 14 plats, 8 tables) : `admin|manager|waiter|kitchen@demo.demo` / `Demo-Resto-2026`
- Autre restaurant de démo : `pnpm --filter api seed:demo -- <slug> --create`

URL de base : dev `postgresql://app:app@localhost:5433/restaurant`, tests `postgresql://app:app@localhost:5433/restaurant_test`,
rôle restreint pour la RLS `postgresql://app_rls:rls@localhost:5433/restaurant_test`.
Sans paquet PostgreSQL installé : `docker compose up -d` (voir `docker-compose.yml`) et adaptez les URL.

## 4. Commandes

| But | Commande |
|---|---|
| Tout vérifier | `pnpm lint && pnpm build && pnpm test` (racine) |
| Tests e2e de l'API (PostgreSQL requis) | `pnpm --filter api test:e2e` |
| e2e sous RLS (rôle non superuser) | `cd apps/api && TEST_DATABASE_URL=postgresql://app_rls:rls@localhost:5433/restaurant_test npx jest --config test/jest-e2e.json --runInBand test/platform test/security test/restaurant` |
| Nouvelle migration | `cd apps/api && DATABASE_URL=postgresql://app:app@localhost:5433/restaurant npx prisma migrate dev --name <nom>` puis `DATABASE_URL=x npx prisma generate` |
| Rebâtir les paquets partagés | `pnpm --filter @restaurant/utils --filter @restaurant/validation --filter @restaurant/shared-types build` (l'API consomme leur `dist/`) |
| Tests web | `pnpm --filter web test` (Vitest) · types `pnpm --filter web lint` |
| Captures d'écran | `node .claude/skills/vercel-design/scripts/screenshots.mjs --help` (voir l'en-tête du script) |

## 5. Pièges connus de cet environnement

- **N'arrêtez jamais un serveur avec `pkill -f <motif>`** : le motif correspond aussi à votre propre shell, qui est tué. Utilisez les PID (`echo $!`, `kill <pid>`) ou `scripts/dev/stop.sh`.
- **Jamais `cat > fichier` sans heredoc** : la commande attend l'entrée standard indéfiniment.
- Dans un test supertest, ne placez pas d'`await` **dans les arguments** d'une requête en cours de construction (`api().post(...).send({ x: await … })`) : calculez la valeur avant.
- La connexion est limitée à 10 tentatives/minute par IP : espacez les connexions dans les scripts de captures, ou réutilisez une session (le script du skill le fait).
- La rotation des jetons de rafraîchissement déconnecte une session réutilisée dans un second navigateur : une seule session par script.
- Les sorties HTTP vers Internet passent par un proxy et certains hôtes (images, CDN) sont bloqués : pas de dépendance réseau à l'exécution.
- Après une migration, la base de test reçoit les migrations via `pretest:e2e` ; si vous testez sous RLS, redonnez les droits (`GRANT ALL ON ALL TABLES IN SCHEMA public TO app_rls`) et relancez `prisma/sql/rls.sql`.

## 6. Langue et ton

Code, identifiants et commentaires techniques : anglais ou français selon le fichier voisin (le code existant commente en français).
Tout texte visible par l'utilisateur : **français**, vouvoiement, phrases courtes, verbes d'action. Glossaire : `.claude/skills/vercel-design/references/restaurant-project.md`.

## 7. Économie de tokens — être concis, précis, efficace

- **Lire juste ce qu'il faut** : `grep -n` pour localiser, puis lire la plage utile (`sed -n 'a,bp'` ou Read avec offset/limit) ; ne pas relire un fichier déjà lu.
  Les fiches indiquent les fichiers à lire : commencer par eux, pas par une exploration générale.
- **Filtrer les sorties** : `… 2>&1 | grep -E "Tests:|✕|error|Tasks:" | head` plutôt que des journaux complets ; `| tail -n 20` pour une erreur.
- **Écrire en une fois** : préparer le code complet d'un fichier avant de l'écrire, éviter les allers-retours de petites retouches.
- **Vérifier par paliers** : types (`tsc --noEmit`) et tests ciblés pendant le travail ; la suite complète une fois à la fin (deux fois pour l'e2e).
- **Captures** : ne regarder que les écrans du sous-projet (une variante claire et une sombre, bureau et mobile), pas toute l'application.
- **Pas de prose inutile** : pas de récapitulatif intermédiaire, pas de réexplication de la fiche ; le rapport final suit le format de `03-verification.md`, sans plus.
- **Ne pas déborder** : ce qui sort du périmètre est noté dans le rapport, pas implémenté.
