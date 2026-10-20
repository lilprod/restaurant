# P1B — Compléments du menu : formules, disponibilité horaire, promotions

> **Type** API + web · **Dépend de** phase 1 · **En parallèle avec** P3, X1 · **Taille** S–M · **Modèle** `sonnet`

## Objectif
Couvrir ce que le cahier des charges demandait pour la carte et que la phase 1 a laissé de côté : menus à prix fixe, plats servis à certaines heures, promotions.

## Existant
Modèles `Formula`/`FormulaItem` (inutilisés), champs `MenuItem.availableFrom/availableTo` (« HH:MM », ignorés), `isDishOfDay` (affiché seulement).
Calculs de commande dans `packages/utils/src/orders.ts`, construction des lignes dans `OrdersService.buildLines`.

## Périmètre
1. **Formules** : nom, prix fixe, étapes (« Entrée », « Plat », « Dessert ») avec choix parmi des plats (refaire `FormulaItem` en étapes :
   `FormulaStep {name, minChoices, maxChoices, items[]}`), disponibilité. En commande : une ligne formule (prix de la formule) + lignes enfants à 0 FCFA
   envoyées en cuisine normalement (lien `parentItemId` sur `OrderItem`). TVA de la formule = taux par défaut (question ouverte).
2. **Disponibilité horaire** : un plat hors de sa plage (fuseau du restaurant) est refusé à la commande (409 clair) et grisé dans la prise de commande et la carte publique.
3. **Promotions simples** : remise en % ou en montant sur un plat ou une catégorie, période (dates, jours, heures). Prix figé remisé à la commande, ligne « dont remise » sur le ticket.
4. Écrans : gestion des formules et des promotions dans le menu ; formules dans la prise de commande (assistant d'étapes) et sur la carte publique.

## Hors périmètre
Codes promo clients, fidélité, prix différents sur place / à emporter (question ouverte).

## Règles
Remises et formules calculées dans `@restaurant/utils` (tests unitaires), jamais dans le web seul. Une ligne enfant de formule ne s'encaisse pas
séparément (partage par article : allouer la formule entière).

## Critères d'acceptation
- [ ] Commander une formule envoie ses plats en cuisine et facture le prix de la formule ; ticket lisible.
- [ ] Plat hors horaire refusé côté API, grisé côté web.
- [ ] Promotion appliquée automatiquement pendant sa période, visible sur le ticket.
- [ ] e2e couvrant formule, horaire (horloge du test maîtrisée), promotion ; captures prise de commande et carte.

## Questions ouvertes (défaut retenu)
TVA d'une formule mêlant taux différents → **taux par défaut du restaurant**. Prix sur place/à emporter → **identiques**.
