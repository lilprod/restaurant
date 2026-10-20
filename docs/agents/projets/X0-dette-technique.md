# X0 — Dette technique et petites corrections

> **Type** API + web · **Dépend de** — · **En parallèle avec** X4 · **Taille** S–M · **Modèle** `sonnet` (points 6–7 : `haiku`)

## Objectif
Solder les écarts relevés lors des phases 0 et 1 avant d'empiler de nouveaux modules, pour que chaque sous-projet suivant parte d'une base propre.

## Travail à faire

1. **Modifier un article en attente depuis le détail de commande** (web) : l'API `PATCH /tenant/orders/:id/items/:itemId` (quantité, instructions)
   existe mais aucun écran ne l'appelle. Ajouter l'action (stepper + instructions) sur les articles `PENDING` non encaissés, avec mise à jour du cache.
2. **Licence au rafraîchissement de session** (API + web) : `POST /tenant/auth/refresh` doit renvoyer `license: { status, inGrace, currentPeriodEnd }`
   (comme la connexion, `security/auth.service.ts` → `refresh`). Le web met à jour le bandeau de grâce sans dépendre de l'état mémorisé à la connexion.
3. **Événements temps réel manquants** (API + web) : émettre `menu.updated` (disponibilité, création, modification, archivage d'un plat — charge utile
   = `menuItemView`) et `table.updated` (statut, ouverture/fermeture) ; le web met à jour ses caches (prise de commande, panneau « Épuisé », tables).
   Mettre à jour `realtime.service.ts` (commentaire) et `docs/API.md`.
4. **Limitation de connexion plus juste** (API) : aujourd'hui 10/min **par IP** (`security/auth.controllers.ts`) — une équipe derrière le même réseau
   peut être bloquée. Passer à : 10/min par **couple IP + email** (tracker personnalisé du `ThrottlerGuard`) **et** 60/min par IP. Tests e2e des deux plafonds
   (désactiver `DISABLE_THROTTLE` seulement dans ce test).
5. **Activation des comptes d'un restaurant par la plateforme** (API + web) : endpoint SuperAdmin `PATCH /platform/tenants/:tenantId/security/users/:userId/active`
   (même logique que `AccountAdminService.setActive`), bouton dans l'onglet Sécurité de la fiche restaurant.
6. **Parcours non vérifiés en navigateur** : écrire des scénarios Playwright (dossier `apps/web/e2e/`, lancés à la demande, pas en CI pour l'instant)
   couvrant : création puis modification d'un membre de l'équipe, message `PLAN_LIMIT` (réduire temporairement `maxTables` d'un plan en base),
   ouverture puis clôture de caisse avec écart. Corriger ce qui casse.
7. **Swagger** : les corps de requête ne sont pas décrits (validation Zod). Générer les schémas OpenAPI depuis les schémas Zod partagés
   (`@asteasolutions/zod-to-openapi` ou équivalent) pour les routes de la phase 1 au minimum.

## Hors périmètre
Refresh token en cookie HttpOnly, CSP (→ X7) ; nouvelles fonctionnalités.

## Critères d'acceptation
- [ ] Les 7 points livrés, chacun couvert par un test (unitaire, e2e ou Playwright) cité dans le rapport.
- [ ] Deux appareils sur le même restaurant : marquer un plat épuisé sur l'un le grise sur l'autre sans rechargement (scénario Playwright).
- [ ] Aucune régression : toutes les suites vertes, e2e aussi sous RLS.

## À lire
`security/auth.service.ts`, `security/auth.controllers.ts`, `restaurant/menu.service.ts`, `restaurant/tables.service.ts`, `realtime/*`,
`apps/web/src/lib/realtime/*`, `features/tenant/orders/*`, `features/platform/tenants/tenant-detail-page.tsx`.
