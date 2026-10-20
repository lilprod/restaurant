# P2A — Réservations, disponibilités, liste d'attente, horaires

> **Type** API + web · **Dépend de** phase 1 (tables), X1 (sinon notifications en mode `log`) · **En parallèle avec** P3, X4 · **Taille** L
> **Modèle** `opus` pour l'API (disponibilités, contrainte d'exclusion, concurrence), `sonnet` pour les écrans (agent séparé)

## Objectif
Prendre des réservations (téléphone, comptoir, en ligne sans compte), éviter toute double réservation d'une table, gérer la liste d'attente,
et prévenir les clients (confirmation, rappel, annulation).

## Existant
Modèles `Reservation`, `ReservationTable`, `WaitlistEntry`, `OpeningHours` (inutilisés). Réglages `operations` : `onlineReservations`,
`reservationDurationMinutes` (90), `reservationSlotMinutes` (15), `maxPartySize`. Tables et statut d'occupation (phase 1). TODO dans `rls.sql`
sur la contrainte anti-double-réservation.

## Données
- `OpeningHours` : plusieurs plages par jour (midi, soir) ; nouveau modèle `ClosureDay { date, reason }` (fermetures exceptionnelles).
- `ReservationTable` : ajouter `startsAt`, `endsAt` (copiés de la réservation), `active Boolean` ; contrainte
  `EXCLUDE USING gist ("tableId" WITH =, tstzrange("startsAt","endsAt") WITH &&) WHERE (active)` (extension `btree_gist`, SQL dans la migration).
  Annulation / no-show / fin → `active = false`.
- `Reservation` : `code` court lisible (ex. `R7K2Q`), `manageTokenHash` (lien de gestion client), `source` (`PHONE|WALK_IN|ONLINE`), `notes` internes,
  `seatedAt`, `orderId` éventuel (commande ouverte à l'installation).
- Nouveaux réglages `reservations` : `requireConfirmation`, `bookingWindowDays` (60), `minNoticeMinutes` (60), `noShowGraceMinutes` (20), `bufferMinutes` (0).

## API (résumé)
- `GET /tenant/opening-hours`, `PUT` (responsables) ; `GET/POST/DELETE /tenant/closures`.
- `GET /tenant/reservations?date=&status=` · `POST` (salle) · `GET/PATCH /:id` · `POST /:id/(confirm|seat|complete|cancel|no-show)`.
- `GET /tenant/reservations/availability?date&partySize` → créneaux avec tables proposées (et combinaisons de 2 tables si aucune ne suffit).
- Liste d'attente : `GET/POST /tenant/waitlist`, `POST /:id/(notify|convert|remove)` ; sur annulation d'une réservation, proposer les entrées compatibles.
- Public (limité en débit, sans compte) : `GET /public/tenants/:slug/availability`, `POST /public/tenants/:slug/reservations`
  (nom, téléphone, email facultatif, taille, créneau, demandes) → `code` + lien de gestion ; `GET/PATCH/DELETE /public/reservations/:token`.
- Temps réel : `reservation.created|updated`, `waitlist.updated`. Notifications (X1) : confirmation, modification, annulation, rappel la veille, place libérée (liste d'attente).

## Règles métier
- Calcul des disponibilités dans `packages/utils/src/reservations.ts` (fonction pure : horaires, fermetures, durée, tampon, réservations existantes,
  capacités) → testé abondamment ; l'API l'utilise **et** la contrainte en base reste l'arbitre final (deux réservations simultanées : une seule réussit, 409 propre).
- Attribution automatique : plus petite table suffisante, puis combinaison ; choix manuel possible (responsable peut forcer une capacité dépassée avec motif).
- Fuseau du restaurant pour tout (créneaux, « aujourd'hui », rappel la veille à 18 h locale).
- « Installer » une réservation : table(s) occupée(s) ; ouvrir la commande depuis la réservation (lien `reservationId` sur `Order`, existant).
- No-show : proposé automatiquement après `noShowGraceMinutes` (tâche), confirmé par la salle.

## Écrans
Planning du jour (frise horaire par table, glisser pour déplacer), liste, nouvelle réservation (recherche de créneau), fiche, liste d'attente,
horaires et fermetures (paramètres), page publique `/r/:slug/reserver` (mobile d'abord) et page de gestion `/r/:slug/reservation/:token`.
Accueil serveur : arrivées de l'heure.

## Critères d'acceptation
- [ ] Double réservation impossible même en parallèle (test e2e de concurrence) et contrainte présente en base.
- [ ] Disponibilités justes : horaires, fermetures, durée, tampon, fuseau (tests unitaires dont changement d'heure).
- [ ] Réservation en ligne sans compte de bout en bout, avec confirmation et lien de gestion (modifier/annuler).
- [ ] Liste d'attente : annulation → proposition à l'entrée compatible → conversion.
- [ ] Rappel la veille envoyé une seule fois (journal X1).
- [ ] e2e (rôles, isolation, public limité en débit) aussi sous RLS ; captures planning (1440, 1024), page publique (390).

## Questions ouvertes (défaut retenu)
Acompte à la réservation → **non** (dépend de X6). Confirmation manuelle des réservations en ligne → **réglage, désactivé par défaut**.
