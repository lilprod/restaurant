# X2 — Livraison : zones, frais, livreurs, suivi

> **Type** API + web · **Dépend de** phase 1, X1 · **En parallèle avec** P5 · **Taille** M · **Modèle** `sonnet`
> **Plan** : fonctionnalité `delivery` ; réglage `deliveryEnabled`

## Existant
`OrderType.DELIVERY` (non utilisé), `DeliveryZone` (nom, `postalCodes`, frais, minimum), `Delivery` (adresse, téléphone, frais, statut
`PENDING|ASSIGNED|ON_THE_WAY|DELIVERED|FAILED`, livreur = `StaffProfile`, `eta`).

## Périmètre
- Zones par **quartier** (pas de codes postaux à Lomé : remplacer `postalCodes` par une liste de quartiers + repères), frais, minimum, délai estimé.
- Commande livraison dans la prise de commande : client, téléphone, quartier, adresse avec **point de repère**, frais ajoutés au total
  (étendre `computeTotals` : `deliveryFee`, TVA au taux par défaut), minimum de commande.
- Rôle **`DRIVER`** (nouveau) : vue mobile « Mes livraisons » (récupérer, en route, livré/échec avec motif), appel et itinéraire (lien carte).
- **Paiement à la livraison** encaissé par le livreur (espèces, Flooz, TMoney), rapproché à son retour (caisse).
- Dispatch : tableau des livraisons (à préparer, prêtes, en cours, livrées), attribution, temps réel (`delivery.updated`).
- SMS client (X1) : commande en route (avec numéro du livreur), livrée.

## Critères d'acceptation
- [ ] Parcours complet commande livraison → cuisine → attribution → en route → livrée et encaissée, en temps réel (Playwright).
- [ ] Frais et minimum appliqués ; ticket et rapports incluent la livraison.
- [ ] Un livreur ne voit que ses livraisons ; e2e rôles + isolation + RLS.
