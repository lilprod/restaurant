# X1 — Notifications : email, SMS, tâches en file, relances

> **Type** API (+ réglages web) · **Dépend de** — · **En parallèle avec** X4, P3 · **Taille** M · **Modèle** `sonnet`
> **Prérequis de** P2A (confirmations, rappels), X2 (SMS livraison), P5 (rapport quotidien par email)

## Objectif
Un service unique pour envoyer des messages (email, SMS) aux clients, au personnel et aux restaurants, avec modèles en français,
envoi asynchrone avec reprises, journal consultable, et fournisseurs interchangeables. Aujourd'hui `MailService` se contente de journaliser.

## Existant
`apps/api/src/mail/mail.service.ts` (journal + boîte d'envoi en mémoire pour les tests) utilisé par « mot de passe oublié ».
Redis est déclaré dans `docker-compose.yml` mais pas utilisé. Le balayage des licences (`platform/licensing/licensing.service.ts`) tourne en cron
et `expiringSoon()` liste les licences à relancer (relances non envoyées).

## Périmètre
- **`NotificationsService`** (module global `src/notifications/`) : `send({ channel: "email"|"sms", to, template, data, tenantId?, locale })`.
- **Pilotes** derrière des interfaces : email `smtp` (nodemailer, compatible Brevo/Mailjet/Gmail SMTP) et `log` ; SMS `log`, `twilio`,
  et un pilote `http` générique configurable (beaucoup d'agrégateurs ouest-africains exposent une simple API HTTP). Choix par variables d'environnement
  (`MAIL_DRIVER`, `SMTP_URL`, `MAIL_FROM`, `SMS_DRIVER`, `SMS_*`), validées dans `config/env.ts`, documentées dans `.env.example`.
- **File de tâches** BullMQ + Redis (`REDIS_URL`) avec 5 reprises à intervalle croissant ; mode **`sync`** (sans Redis) pour le développement et les tests.
- **Modèles** en français, versionnés dans le code (`src/notifications/templates/*.ts`), variables typées, texte + HTML simple, nom/logo du restaurant
  (marque), pied de page avec coordonnées. SMS ≤ 160 caractères (test).
- **Journal** : table `NotificationLog` (tenantId nullable pour la plateforme, canal, destinataire **masqué** en affichage, modèle, statut
  `QUEUED|SENT|FAILED`, erreur, tentatives, dates) + RLS. Écrans : liste filtrable côté restaurant (Admin) et côté plateforme (SuperAdmin), renvoi manuel.
- **Réglages restaurant** (nouvelle section `notifications`) : canaux actifs, nom d'expéditeur, signature, préférences par événement.
- **Branchements immédiats** : « mot de passe oublié » (migrer depuis `MailService`), relances de licence J-7, J-1 et jour d'expiration aux
  administrateurs du restaurant (tâche planifiée, une seule fois par échéance — champ `reminderSentAt` existant à exploiter par palier),
  confirmation d'inscription d'un restaurant (demande reçue / validée / rejetée).
- **API d'abonnement pour les autres modules** : documenter comment un module déclare un modèle et envoie (P2A, X2, P5 s'y brancheront).

## Hors périmètre
Notifications push mobiles (X3), WhatsApp (question ouverte), campagnes marketing.

## Règles
- Un envoi ne bloque jamais la requête métier : on met en file, la requête répond.
- Désinscription : les messages non transactionnels (rapports, relances non critiques) respectent les préférences.
- Aucune donnée sensible (mot de passe, code 2FA) dans un SMS ; liens de réinitialisation uniquement par email.
- Numéros au format E.164 ; normalisation des numéros togolais (`+228`, 8 chiffres) dans `@restaurant/utils` avec tests.

## Tests
Unitaires (modèles : rendu, longueur SMS, normalisation des numéros), e2e en mode `sync` avec pilote `log` capturant les messages
(relances de licence à J-7/J-1/J0 une seule fois, mot de passe oublié, isolation du journal entre restaurants), test de reprise après échec du pilote.

## Critères d'acceptation
- [ ] Fournisseur réel activable sans changer de code (variables d'environnement), mode `log` par défaut.
- [ ] Relances de licence envoyées une seule fois par palier, visibles dans le journal.
- [ ] Journal consultable (restaurant et plateforme), destinataires masqués, renvoi possible.
- [ ] `MailService` retiré ou réduit à un adaptateur du nouveau service ; tests existants verts.

## Questions ouvertes (défaut retenu)
- Fournisseur email et SMS réels ? → **pilotes `smtp` et `http` génériques + `log` par défaut**, le propriétaire fournit ses identifiants.
- WhatsApp Business ? → **non** pour l'instant (à proposer au propriétaire).
