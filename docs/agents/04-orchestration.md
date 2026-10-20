# Orchestration — découper, lancer, relire, intégrer

Rôle de l'orchestrateur (l'agent principal de la session) : choisir le prochain sous-projet, lancer un sous-agent avec la bonne fiche,
**ne jamais croire un rapport sur parole** (relancer soi-même les vérifications), intégrer, pousser, mettre à jour l'état dans `README.md`.

## 1. Ordre recommandé (vagues)

```
Vague 1  ─ X0 dette technique ── X1 notifications ── X4 déploiement (infra, en parallèle de tout)
Vague 2  ─ P2A réservations ──── P3 stock ────────── P1B compléments du menu
Vague 3  ─ P2B plan de salle ─── P2C espace client ─ P4 personnel ── X7 sécurité (après X4)
Vague 4  ─ P5 rapports ───────── X2 livraison ────── X5 hors-ligne & impression
Vague 5  ─ X3 mobile             (X6 paiement en ligne : dès que le propriétaire a choisi l'agrégateur)
```

Pourquoi cet ordre :
- **X1 avant P2A/X2** : réservations et livraison envoient emails et SMS ; mieux vaut le service de notifications d'abord que des appels directs à remplacer ensuite.
- **P3 tôt** : la déduction de stock se branche sur les commandes (phase 1, stable) et alimente les coûts des rapports (P5).
- **P2C après P2A** : la réservation en ligne du client réutilise toute la logique de disponibilité de P2A.
- **P5 en fin** : les rapports agrègent stock, personnel, avis.
- **X3 en dernier** : l'application mobile consomme une API stabilisée.

## 2. Règles de parallélisation

- **Deux sous-projets qui modifient `schema.prisma` en même temps** : autorisé seulement en **worktrees isolés** (`isolation: "worktree"`)
  et intégrés **l'un après l'autre**. Au second, si `schema.prisma` entre en conflit : fusionner le schéma à la main, **supprimer la migration du
  second agent et la régénérer** (`prisma migrate dev --name <même nom>`) sur la base qui a déjà la première, puis relancer toutes les vérifications.
- Fichiers partagés à risque de conflit : `app.module.ts`, `packages/api-client/src/{types,endpoints}.ts`, `packages/validation/src/index.ts`,
  `apps/web/src/app/router.tsx`, `features/tenant/tenant-shell.tsx`, `lib/labels.ts`, `docs/API.md`, `prisma/sql/rls.sql`. Conflits attendus et simples (ajouts) : les résoudre en gardant les deux.
- Un sous-projet **API + web** peut être confié à **un seul agent** (petit périmètre) ou à **deux agents successifs** (API puis web, comme la phase 1) :
  préférer deux agents dès que la fiche dépasse ~10 écrans ou ~15 routes. L'agent web part alors de l'API déjà intégrée.
- Infra (X4) et documentation peuvent tourner en parallèle de tout.

## 3. Choix du modèle (économie de tokens)

Paramètre `model` de l'outil `Agent`. Prendre **le plus léger qui suffit** ; monter d'un cran seulement si l'agent échoue ou si la tâche touche à l'argent, la concurrence ou la sécurité.

| Modèle | Pour | Exemples |
|---|---|---|
| `haiku` | Tâches simples, bornées, sans conception : un fichier ou deux, recette déjà écrite | mise à jour de docs, libellés/traductions, test manquant sur un comportement existant, relecture de captures avec la grille, petite correction ciblée |
| `sonnet` | **Défaut** : modules métier qui suivent les recettes (01-backend, 02-frontend) | P1B, P2B, P2C, P4, P5, X0, X1, X2, X3, X4, X5, écrans d'une fiche |
| `opus` | Logique critique ou délicate : concurrence, argent, contraintes en base, sécurité | P2A (disponibilités + contrainte d'exclusion), P3 (déduction de stock dans la transaction des commandes), X6 (paiements, webhooks), X7 (sécurité) |

Découper une fiche lourde en **sous-tâches** permet souvent d'en confier une partie à un modèle plus léger
(ex. P3 : logique de déduction en `opus`, écrans de stock en `sonnet`, documentation en `haiku`).

## 4. Gabarit de lancement d'un sous-agent

Outil `Agent` (type `general-purpose`, `model` selon la section 3 et la fiche), en arrière-plan. Prompt :

```
Tu es un ingénieur senior chargé du sous-projet <ID> — <titre> du SaaS de gestion de restaurants (monorepo /home/user/restaurant).

Lis d'abord, dans cet ordre :
1. docs/agents/00-conventions.md (règles non négociables, environnement, pièges)
2. docs/agents/projets/<fiche>.md (ta mission : périmètre, règles métier, critères d'acceptation)
3. docs/agents/01-backend.md et/ou 02-frontend.md selon la fiche ; pour tout écran, charge le skill .claude/skills/vercel-design
4. docs/agents/03-verification.md (contrôles et format du rapport)

Prépare l'environnement avec `bash scripts/dev/setup-db.sh`. Respecte strictement le périmètre de la fiche ; ce qui en sort va dans la section
« Écarts » du rapport. Sois concis, précis et économe (section 7 de 00-conventions.md). Ne commite pas et ne pousse pas.
Termine par le rapport au format de 03-verification.md.
<précisions éventuelles : décisions déjà prises, choix du propriétaire, contraintes de la vague>
```

Pour un agent web qui suit un agent API : ajouter « L'API du sous-projet est intégrée (commit <hash>) ; ne modifie pas apps/api sauf bug avéré, à signaler avec fichier:ligne ».

## 5. Relecture et intégration (à chaque retour d'agent)

1. Lire le rapport ; noter les critères non tenus et les écarts.
2. `git status` / `git diff --stat` : périmètre respecté, pas de fichier parasite, pas de secret (`grep` des mots de passe de démo et motifs de clés).
3. **Relancer soi-même** : `pnpm install --frozen-lockfile && pnpm lint && pnpm build && pnpm test && pnpm --filter api test:e2e`, puis l'e2e **sous RLS**.
4. Regarder 3 à 5 captures clés (écrans principaux, mobile, sombre).
5. Corriger soi-même les petits écarts ; renvoyer à l'agent (SendMessage) ce qui est substantiel.
6. Commit en français, message décrivant le livré ; push sur la branche convenue avec le propriétaire (actuellement `master`).
7. Mettre à jour le tableau d'état de `docs/agents/README.md` et, si la fiche a révélé des choses, la fiche suivante concernée.
8. Résumer au propriétaire : livré, vérifié (chiffres), limites, décisions à prendre.

## 6. Décisions réservées au propriétaire (ne pas les trancher en silence)

- Fournisseurs externes payants : email (Brevo, SMTP…), SMS (Twilio, opérateur local…), stockage (S3, Cloudinary), hébergement, agrégateur de paiement (CinetPay, PayDunya, FedaPay…).
- Prix, contenus des plans, fonctionnalités réservées à certains plans.
- Règles légales et fiscales (taux de TVA par défaut, mentions obligatoires des factures, conservation des données).
- Tout ce qui change un comportement déjà livré et utilisé.

Quand une fiche contient une « question ouverte », l'agent applique le **choix par défaut indiqué** et le signale ; l'orchestrateur le soumet au propriétaire.
