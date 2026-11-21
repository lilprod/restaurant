# X5B — Notifications push web (PWA) pour l'équipe

> **Type** API + web · **Dépend de** X1 (notifications), X2 (livraison), X5 (PWA, `src/sw.ts`) · **Taille** S–M · **Modèle** `sonnet`
> Alternative légère à X3 (application native) : alerter le personnel **téléphone en poche, écran verrouillé**, via la PWA.
> Fiable sur Android (Chrome, Edge, Firefox) et ordinateur ; sur iPhone seulement si la PWA est **installée sur l'écran d'accueil** (iOS 16.4+).

## Objectif
Le livreur, le serveur et la cuisine reçoivent une notification système même quand l'application est fermée ou l'écran éteint.

## Périmètre

### API
- Norme Web Push (VAPID) avec la bibliothèque `web-push`. Variables validées dans `config/env.ts` et documentées (`.env.example`,
  `.env.prod.example`, `docs/DEPLOIEMENT.md`) : `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (mailto: ou https:).
  Sans clés : push désactivé proprement (pilote `log`), jamais d'erreur au démarrage hors production. Script de génération des clés documenté.
- Table `PushSubscription` (tenantId, userId, endpoint **unique**, clés `p256dh`/`auth`, userAgent abrégé, createdAt, lastSeenAt) **avec son bloc dans `rls.sql`**.
  Migration unique nommée `web_push`.
- Routes (compte du personnel connecté, jamais `CUSTOMER`) :
  `GET /tenant/push/config` (clé publique + push actif ou non), `POST /tenant/push/subscriptions` (création ou mise à jour idempotente par endpoint,
  rattachée au compte et au restaurant courants), `DELETE /tenant/push/subscriptions` (par endpoint), `POST /tenant/push/test` (notification de test à soi-même).
  Un même endpoint réutilisé par un autre compte est **réattribué** (un appareil = un compte à la fois).
- Canal `push` dans `NotificationsService` (X1) : pilote `webpush` (ou `log` par défaut / en test), même journal, mêmes reprises, déduplication `dedupeKey`.
  Réponse 404 / 410 du service de push → abonnement supprimé ; autres erreurs → reprises. TTL court (≤ 10 min) et `urgency: high`.
- **Aucune donnée sensible dans la charge utile** : titre court, texte sans montant, sans adresse complète ni téléphone, `url` interne relative
  (`/r/<slug>/...`) et `tag` pour regrouper ; l'application recharge le détail par l'API.
- Événements poussés (préférences par événement dans la section de réglages `notifications`, et coupure par utilisateur sur l'appareil) :
  - **livreur** : livraison attribuée, retirée (réattribuée), commande prête à récupérer ;
  - **serveur** : commande / plats prêts pour ses commandes (`waiterId`) ;
  - **cuisine** : nouvelle commande, ajout d'articles (vers les comptes KITCHEN actifs du restaurant).
- Déconnexion, révocation de session ou désactivation du compte → abonnements du compte supprimés. Purge des abonnements inactifs (> 60 j) dans `RetentionService`.
- Tests e2e : rôles, isolation entre restaurants (idor et RLS verts), réattribution d'endpoint, suppression sur 410 (pilote simulé), contenu de la charge utile
  sans donnée sensible, un seul envoi par événement.

### Web
- `src/sw.ts` (X5) : gestionnaires `push` (affiche la notification avec icône, badge, `tag`, `renotify`) et `notificationclick`
  (focalise un onglet existant du restaurant ou ouvre l'`url` ; refuse toute URL hors de l'origine). Sans réponse authentifiée mise en cache (règle X5).
- Carte « Notifications sur cet appareil » dans l'écran **Impression et hors ligne** (`/impression`) et rappel discret sur l'accueil livreur / serveur :
  état (non supporté, refusé, désactivé, activé), bouton **Activer** (demande d'autorisation uniquement sur geste de l'utilisateur), **Tester**, **Désactiver**.
  Sur iPhone non installé : explication pour « Ajouter à l'écran d'accueil ». Autorisation refusée : marche à suivre pour la réactiver.
- Déconnexion : `unsubscribe()` côté navigateur + `DELETE` côté API (avant l'effacement des données X5). Changement de restaurant sur le même appareil :
  l'abonnement suit le compte connecté.
- Les notifications ne doublonnent pas les toasts quand l'application est au premier plan et visible (le service worker vérifie les clients visibles).
- CSP stricte de X4 inchangée sauf nécessité démontrée (tester sous nginx).

## Hors périmètre
Notifications aux clients, application native (X3), contenu riche (images, actions « Accepter » dans la notification), SMS de secours.

## Critères d'acceptation
- [ ] Playwright sur build de production derrière nginx : autorisation accordée → abonnement enregistré ; un événement (attribution de livraison,
      commande prête, nouvelle commande) produit un envoi au journal X1 avec la bonne charge utile ; le gestionnaire `push` du service worker affiche la notification
      et `notificationclick` ouvre la bonne page (événements simulés si le navigateur de test ne reçoit pas de vrai push).
- [ ] Déconnexion → abonnement supprimé côté navigateur et API ; 410 → abonnement purgé ; aucun envoi vers un autre restaurant.
- [ ] Aucune donnée sensible dans les charges utiles (test) ; e2e complet, `scripts/dev/test-rls.sh` et `scripts/ci/audit.mjs` verts.
- [ ] Captures de la carte « Notifications sur cet appareil » (clair / sombre, 1440 et 390 px), dont l'état « iPhone non installé ».
- [ ] `docs/DEPLOIEMENT.md` : génération et rotation des clés VAPID ; limites iPhone expliquées pour le propriétaire.
