# X3 — Application mobile « Équipe » (Expo) : livreur, serveur, cuisine

> **Type** mobile + API légère · **Dépend de** X2 (livraison), X5 (idempotence), X7 (sessions) · **En parallèle avec** — · **Taille** L · **Modèle** `sonnet`
> **Public** : le **personnel uniquement**. Les clients restent sur le web (carte, réservation, suivi par QR, avis : P2A, P2C).
> **Distribution** : interne (APK Android et distribution interne iOS via EAS), **pas de publication dans les stores** pour l'instant.

## Objectif
Une seule application native pour l'équipe d'un restaurant, qui s'adapte au rôle du compte connecté :
1. **Livreur** (priorité) : ses livraisons, appel, itinéraire, récupérée / livrée / échec, encaissement à la remise.
2. **Serveur** : prise de commande, commandes, tables, encaissement simple, alerte « plat prêt ».
3. **Cuisine** : écran cuisine sur tablette (toujours sombre), alerte à chaque nouvelle commande.

Ce qu'elle apporte par rapport à la PWA (X5) : des **notifications push fiables** (y compris iPhone, écran verrouillé) et une
application dédiée installée sur les appareils du restaurant. Gérants et administrateurs restent sur le web (rapports, stock, personnel, paramètres).

## Périmètre

### API (légère)
- Enregistrement des appareils : `POST /tenant/devices {expoPushToken, platform, appVersion}` et `DELETE /tenant/devices/:id` (le compte connecté seulement) ;
  table `PushDevice` (tenantId, userId, jeton unique, dernière activité) **avec son bloc dans `rls.sql`** ; purge des jetons inactifs (> 60 j)
  et des jetons signalés invalides par Expo (`DeviceNotRegistered`) dans `RetentionService`. Déconnexion ou désactivation du compte → appareils supprimés.
- Canal `push` dans `NotificationsService` (X1) : pilote `expo` (API Expo Push, `EXPO_ACCESS_TOKEN` facultatif, validé dans `config/env.ts`)
  et pilote `log` par défaut ; même journal, mêmes reprises, déduplication par `dedupeKey`. **Aucune donnée sensible** dans le texte d'une notification
  (pas de montant ni d'adresse complète) : titre court + identifiant ; l'app recharge le détail par l'API.
- Événements poussés (désactivables par événement dans les réglages de notifications) :
  - livreur : livraison attribuée, réattribuée à un autre, commande prête à récupérer ;
  - serveur : plat / commande prêt(e) pour ses commandes ;
  - cuisine : nouvelle commande, ajout d'articles.
- Migration unique nommée `mobile_push`. Tests e2e : rôles, isolation entre restaurants, idor et RLS toujours verts.

### Application `apps/mobile`
- Expo (SDK stable récent) + expo-router + TypeScript ; Metro configuré pour le monorepo ; réutilise `@restaurant/api-client`, `validation`,
  `utils`, `ui-tokens`, `shared-types`. **Aucun calcul de montant réimplémenté.**
- Connexion : saisie du code (slug) du restaurant puis email / mot de passe, 2FA, sessions restreintes (`pwd-change`, `2fa-setup` → renvoyer vers le web).
  Jetons : mode « jeton dans le corps » de l'API (X7 garde ce mode pour le mobile), stockés dans `expo-secure-store`, rafraîchissement avec rotation.
  Compte client (rôle `CUSTOMER`) refusé avec un message clair.
- Navigation selon le rôle : `DRIVER` → Livraisons ; `WAITER` → Salle (commandes, tables, prise de commande, encaissement simple) ;
  `KITCHEN` → Cuisine ; `ADMIN` / `MANAGER` → Salle + Cuisine + Livraisons (lecture du dispatch) avec un lien « Ouvrir le web » pour le reste.
- **Livreur** (reprend exactement les routes X2 `/tenant/delivery/mine…`) : liste du jour, fiche (client, téléphone avec appel direct, quartier,
  repère, lien d'itinéraire vers l'application de cartes), « Récupérée » grisé tant que la cuisine n'a pas fini, « Livrée » avec encaissement
  (espèces / Flooz / TMoney), « Échec » avec motif. Envois avec `Idempotency-Key` (X5) pour éviter les doubles validations sur réseau instable.
- **Serveur** : prise de commande (carte, options, formules P1B, horaires, promotions), commandes, tables, encaissement simple (espèces avec rendu,
  Flooz / TMoney) avec `Idempotency-Key` ; pas d'édition de la carte.
- **Cuisine** : écran cuisine temps réel (même protocole Socket.io que le web), lancer / prêt / tout lancer, mode paysage tablette, écran maintenu allumé.
- Temps réel Socket.io (même protocole et salles que le web, la socket du livreur reste privée comme sur le web) ; reconnexion au retour au premier plan.
- Thème : `cssVars` de l'API convertis en thème React Native (clair / sombre, cuisine toujours sombre), mêmes règles que le skill `vercel-design` ;
  interface en français, montants FCFA.
- Hors ligne : lecture du dernier état et indicateur « Hors ligne » ; les actions sont refusées hors ligne (pas de file d'attente native dans X3).

## Hors périmètre (à signaler dans « Écarts » si demandé)
Application client, publication App Store / Play Store, suivi GPS du livreur, impression Bluetooth depuis le mobile, paiement en ligne (X6),
écrans gérant / administrateur (rapports, stock, personnel, paramètres).

## Découpage conseillé
Deux agents successifs : **API** (push, appareils, événements) puis **mobile** (part de l'API intégrée).

## Critères d'acceptation
- [ ] Parcours livreur complet sur émulateur Android : notification d'attribution reçue (pilote `log` ou Expo en développement), récupérée puis
      livrée avec encaissement ; le dispatch web voit les changements en direct (capture).
- [ ] Parcours serveur : commande passée depuis l'app, reçue en direct sur l'app Cuisine et sur l'écran cuisine web ; « plat prêt » notifié au serveur.
- [ ] Un livreur ne voit que ses livraisons ; un client ne peut pas se connecter ; aucune donnée sensible dans le texte des notifications (tests).
- [ ] Aucun calcul de montant réimplémenté (fonctions partagées) ; tests unitaires des écrans critiques ; e2e API (push, appareils) + RLS + idor verts.
- [ ] Build EAS documenté (profils `development` et `preview`, distribution interne, APK Android) — sans publication dans les stores.
