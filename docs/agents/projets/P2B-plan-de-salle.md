# P2B — Plan de salle visuel et vue du service

> **Type** web (+ API légère) · **Dépend de** P2A · **En parallèle avec** P3, P4 · **Taille** M · **Modèle** `sonnet`

## Objectif
Voir et organiser la salle comme elle est : tables placées, couleur selon l'état, commande en cours, prochaine réservation ; déplacer une table
ou une commande en un geste.

## Existant
`FloorPlan` (nom, largeur, hauteur) et `RestaurantTable` (`posX`, `posY`, `shape`, `rotation`, `mergedIntoId`) ; une salle « Salle principale »
créée automatiquement ; écran Tables (cartes, phase 1) ; réservations (P2A).

## Périmètre
- **API** : salles `GET/POST/PATCH/DELETE /tenant/floor-plans` ; `PUT /tenant/floor-plans/:id/layout` (positions, formes, tailles, rotations en lot) ;
  `POST /tenant/tables/merge {tableIds}` et `/:id/split` (capacité cumulée, commande unique) ; `POST /tenant/orders/:id/move {tableId}` (transfert,
  statuts des deux tables mis à jour). Événement `table.updated`. Rôles : mise en page = responsables ; fusion, transfert = salle.
- **Éditeur** (responsables) : glisser-déposer sur grille aimantée, formes rond/carré/rectangle, rotation, duplication, zoom, plusieurs salles (onglets),
  alternative clavier/liste pour l'accessibilité, enregistrement explicite avec annulation.
- **Vue du service** (salle) : plan en direct (libre, occupée avec montant et durée, à débarrasser, réservée bientôt), toucher = actions
  (ouvrir/voir la commande, installer une réservation, déplacer, fusionner, marquer débarrassée). Tablette d'abord.

## Critères d'acceptation
- [ ] Mise en page enregistrée et restituée à l'identique sur un autre appareil ; mise à jour en direct des états (scénario Playwright à deux pages).
- [ ] Transfert d'une commande et fusion/séparation de tables cohérents avec réservations et encaissement (e2e).
- [ ] Utilisable au doigt à 1024×768 ; captures éditeur et vue du service, clair et sombre.
