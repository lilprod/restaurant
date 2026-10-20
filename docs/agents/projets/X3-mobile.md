# X3 — Application mobile (Expo) : serveur et cuisine, puis client

> **Type** mobile · **Dépend de** API stable (après P2C) · **En parallèle avec** P5 · **Taille** L · **Modèle** `sonnet`

## Objectif
Applications natives iOS/Android partageant la logique du web : d'abord **Serveur** (prise de commande, commandes, tables, encaissement)
et **Cuisine** (écran cuisine sur tablette), ensuite **Client** (carte, réservation, suivi, avis).

## Périmètre
- `apps/mobile` : Expo + expo-router + TypeScript ; réutilise `@restaurant/api-client`, `validation`, `utils`, `ui-tokens`, `shared-types` (Metro configuré pour le monorepo).
- Authentification restaurant (sous-domaine ou saisie du code restaurant), jetons dans `expo-secure-store`, rafraîchissement, 2FA, sessions restreintes.
- Temps réel Socket.io (même protocole que le web), notifications push (Expo) pour « plat prêt » et nouvelles commandes (API : enregistrement des jetons d'appareil).
- Thème du restaurant : `cssVars` de l'API convertis en thème React Native (clair/sombre ; cuisine toujours sombre) ; mêmes règles que le skill `vercel-design`.
- Écrans prioritaires : connexion, prise de commande, commandes, encaissement simple, écran cuisine.

## Critères d'acceptation
- [ ] Parcours serveur complet sur émulateur Android (capture), commande reçue en direct par l'app Cuisine.
- [ ] Aucun calcul de montant réimplémenté (fonctions partagées) ; tests unitaires des écrans critiques.
- [ ] Build EAS documenté (sans publier dans les stores).
