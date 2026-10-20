# P3 — Stock : recettes, déduction automatique, alertes, fournisseurs, pertes

> **Type** API + web · **Dépend de** phase 1 · **En parallèle avec** P2A, P2B, P2C · **Taille** L
> **Modèle** `opus` pour la déduction dans les commandes et les mouvements, `sonnet` pour le reste de l'API et les écrans, `haiku` pour la doc
> **Plan** : fonctionnalité `inventory` (Starter : non) → `403 {code: "PLAN_FEATURE"}`

## Objectif
Connaître le stock en temps réel, le déduire automatiquement à partir des recettes, alerter avant la rupture, gérer achats fournisseurs et pertes,
et calculer le coût matière de chaque plat.

## Existant
Modèles `Ingredient` (quantité, seuil, coût moyen, fournisseur), `RecipeLine` (plat → ingrédient), `StockMovement` (`PURCHASE|ORDER_DEDUCTION|WASTE|ADJUSTMENT|RETURN`,
`balanceAfter`), `WasteRecord`, `Supplier`, `PurchaseOrder(+Line)`. Commandes : `OrdersService.mutate` (transaction verrouillée) et transitions d'articles.

## Données
Unités (`g, kg, ml, cl, l, pièce`) avec conversions dans `@restaurant/utils` ; `OptionRecipeLine` (une option consomme aussi : « Alloco » → banane plantain) ;
`StockCount` + `StockCountLine` (inventaire physique) ; `Ingredient.category`, `autoDisable` (rendre indisponibles les plats concernés à zéro).

## Règles métier
- **Déduction** quand un article passe en préparation (`PENDING → IN_PROGRESS` ou directement `READY`), **dans la même transaction** que la commande
  (étendre `OrdersService` par un service `StockService.consumeForItem(tx, …)` ; verrou `FOR UPDATE` sur les ingrédients, ordre d'ID stable pour éviter les interblocages).
  Recette × quantité + options. Retour en arrière cuisine (`IN_PROGRESS → PENDING`) → mouvement `RETURN`.
- Annulation d'un article déjà lancé → mouvement `WASTE` automatique (motif « annulation »).
- Le stock peut devenir négatif (le service n'est jamais bloqué) mais c'est signalé ; à zéro, `autoDisable` rend les plats indisponibles (événement `menu.updated`).
- **Coût moyen pondéré** mis à jour à la réception d'une commande fournisseur ; réception partielle gérée.
- Inventaire : saisie des quantités comptées → mouvements `ADJUSTMENT` (écart valorisé).
- Alertes : seuil franchi → événement `stock.low` + notification aux responsables (X1), une fois par franchissement.
- Coût matière d'un plat = Σ(quantité × coût moyen) ; marge = prix TTC hors TVA − coût (fonction pure partagée, réutilisée par P5).

## API (résumé)
`/tenant/inventory/ingredients` (CRUD, archivage), `/tenant/menu/items/:id/recipe` (lignes), `/tenant/menu/options/:id/recipe`,
`/tenant/inventory/movements?ingredientId&type&from&to`, `/tenant/inventory/waste`, `/tenant/inventory/counts` (créer, saisir, valider),
`/tenant/suppliers` (CRUD), `/tenant/purchase-orders` (brouillon → envoyé → reçu partiel/total, `POST /:id/receive`), `/tenant/inventory/alerts`.
Rôles : lecture cuisine + responsables, écriture responsables ; pertes déclarables par la cuisine.

## Écrans
Ingrédients (stock, seuil, valeur, état), fiche recette dans l'éditeur de plat (coût et marge en direct), mouvements, pertes, inventaire guidé
(tablette), fournisseurs, commandes fournisseurs (création depuis les alertes), widget alertes sur l'accueil gérant et l'écran cuisine.

## Critères d'acceptation
- [ ] Préparer un plat déduit exactement sa recette et ses options ; annuler après lancement crée une perte ; retour arrière restitue.
- [ ] Deux préparations simultanées consommant le même ingrédient : solde final exact (test de concurrence).
- [ ] Réception fournisseur met à jour stock et coût moyen ; inventaire produit les ajustements valorisés.
- [ ] Alerte de stock bas émise une seule fois par franchissement ; `autoDisable` grise le plat partout en temps réel.
- [ ] Plan Starter : 403 `PLAN_FEATURE` ; e2e sous RLS ; captures des écrans principaux.

## Questions ouvertes (défaut retenu)
Moment de déduction → **passage en préparation** (alternative : à la commande). Stock négatif → **autorisé et signalé**.
