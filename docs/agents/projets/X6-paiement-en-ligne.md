# X6 — Paiement en ligne (mobile money et carte via un agrégateur)

> **Type** API + web · **Bloqué par une décision du propriétaire** (agrégateur et compte marchand) · **Taille** M–L · **Modèle** `opus`

## Objectif
1. Les restaurants **renouvellent leur licence en ligne** (Flooz, TMoney, carte) : le paiement confirmé crée automatiquement le `SubscriptionPayment`
   et prolonge la licence (même logique que la saisie manuelle).
2. Plus tard : acompte de réservation et paiement de commande en ligne par les clients.

## Périmètre
- Abstraction `PaymentGateway` (initier, vérifier, rembourser) + un pilote pour l'agrégateur choisi (CinetPay, PayDunya, FedaPay, KkiaPay…)
  et un pilote `fake` pour les tests.
- **Webhooks** : signature vérifiée, idempotence (événement traité une fois), réconciliation périodique des paiements en attente, journal.
- Écran « Renouveler ma licence » côté restaurant (plan, cycle, moyen), page de retour, reçu (P5).
- Sécurité : montants recalculés côté serveur, jamais repris du client ; secrets en variables d'environnement ; tests de rejeu et de falsification.

## Critères d'acceptation
- [ ] Paiement de licence de bout en bout avec le pilote `fake`, puis en bac à sable de l'agrégateur choisi.
- [ ] Webhook rejoué ou falsifié sans effet (tests) ; réconciliation corrige un paiement dont le webhook est perdu.

## Décision à obtenir avant lancement
Agrégateur, compte marchand, frais acceptés, devise/pays couverts.
