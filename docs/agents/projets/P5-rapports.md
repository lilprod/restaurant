# P5 — Rapports, analyses et exports (PDF/CSV)

> **Type** API + web · **Dépend de** P3, P4, P2C · **En parallèle avec** X2 · **Taille** M–L · **Modèle** `sonnet`
> **Plan** : fonctionnalité `reports` · Graphiques : charger le skill `dataviz` en plus de `vercel-design`

## Objectif
Donner aux responsables (et au SuperAdmin pour la plateforme) des chiffres fiables et exportables pour piloter le restaurant.

## Périmètre
- **Ventes** jour/semaine/mois/période libre avec comparaison à la période précédente : par catégorie, plat, heure, jour de semaine, serveur,
  moyen de paiement, sur place/à emporter/livraison ; remises et annulations.
- **TVA collectée par taux** (déclaration), **caisse** (sessions, écarts), **coût matière et marges** par plat (P3), **pertes** valorisées,
  **performances du personnel** (P4), **avis** (P2C), **heures de pointe** (carte de chaleur jour × heure).
- **Plateforme** (SuperAdmin) : revenus de licences par mois et par moyen, restaurants actifs/essai/suspendus, renouvellements et résiliations.
- **Exports** : CSV en flux (gros volumes) et PDF côté API (bibliothèque PDF Node, gabarit à la marque du restaurant, polices embarquées) ;
  **facture PDF d'une commande** et **reçu PDF d'un paiement de licence** (numéro, mentions légales des paramètres).
- **Rapport quotidien** envoyé par email aux responsables (X1), activable.
- Calculs d'agrégats côté base (requêtes groupées, index adaptés), dans le fuseau du restaurant ; cohérence vérifiée contre le tableau de bord du jour.

## Critères d'acceptation
- [ ] Totaux identiques entre rapport, tableau de bord et somme des commandes/paiements (tests e2e avec jeu de données connu).
- [ ] Exports CSV et PDF corrects (contenu vérifié en test : en-têtes, totaux), PDF lisible (capture d'une page).
- [ ] Temps de réponse < 2 s sur 50 000 commandes générées (script de génération fourni, mesure dans le rapport).
- [ ] Graphiques conformes au skill `dataviz`, clair et sombre.
