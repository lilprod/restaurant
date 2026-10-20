# P2C — Espace client : compte, réservations, suivi de commande, avis

> **Type** API + web · **Dépend de** P2A · **En parallèle avec** P3, P4 · **Taille** M–L · **Modèle** `sonnet`

## Objectif
Donner aux clients d'un restaurant un espace simple : se créer un compte, réserver et retrouver ses réservations, suivre une commande à emporter,
laisser un avis ; et donner au restaurant la vue des avis.

## Existant
Rôle `CUSTOMER` (comptes par restaurant), authentification restaurant (`/tenant/auth/*`), `Feedback` (une note 1–5 + commentaire par commande),
réservation en ligne sans compte et lien de gestion (P2A), carte publique (phase 1).

## Périmètre
- **Comptes clients** : inscription (`POST /public/tenants/:slug/customers`, email ou téléphone + mot de passe, consentement), connexion via
  `/tenant/auth/login` (rôle `CUSTOMER`), profil, préférences de notification, **export et suppression du compte** (RGPD).
- **Sécurité** : test automatique qui appelle **toutes** les routes du personnel avec un jeton client → 403 partout (aucune route sans `@TenantRoles`).
- **Réservations** : rattachement automatique des réservations faites avec le même email/téléphone vérifié ; historique ; modifier/annuler.
- **Suivi de commande** : lien/QR imprimé sur le ticket (`/r/:slug/suivi/:token`, jeton aléatoire stocké haché) → statut en direct (attente, en préparation, prête),
  sans compte ; SMS « commande prête » pour l'à-emporter si X1 et le réglage le permettent.
- **Avis** : depuis le lien du ticket ou l'espace client, une fois la commande clôturée, une fois par commande ; note, commentaire, modération
  (masquer) et réponse publique du restaurant ; moyenne et répartition pour les responsables ; affichage facultatif sur la carte publique.
- **Écrans** : `/r/:slug/compte` (connexion, inscription, profil, réservations, avis), page de suivi, page d'avis, écran « Avis » côté restaurant.

## Hors périmètre
Commande en ligne / click & collect et paiement en ligne (→ X6), fidélité.

## Critères d'acceptation
- [ ] Un client ne peut accéder à aucune donnée du personnel ni d'un autre client (tests dédiés, aussi sous RLS).
- [ ] Suivi de commande en direct sans compte ; jeton non devinable ; expiré 24 h après clôture.
- [ ] Avis unique par commande, après clôture ; modération et réponse ; statistiques justes.
- [ ] Export (JSON) et suppression de compte (anonymisation des réservations et avis conservés pour l'historique).
- [ ] Captures mobile (390) de tout l'espace client.
