# Spécificités du projet « Gestion Restaurant »

## Espaces et routes
- **Plateforme (SuperAdmin)** : `/admin/*`, rôles `SUPER_ADMIN` (tout) et `SUPPORT` (lecture seule → masquer ou
  désactiver les actions d'écriture, avec infobulle « Réservé au super admin »).
- **Restaurant** : `/r/:slug/*` en développement ; en production le slug vient du sous-domaine (`resolveTenantSlug()`).
  Rôles `ADMIN`, `MANAGER`, `WAITER`, `KITCHEN` (+ `CUSTOMER` pour l'espace client futur). Visibilité par rôle :
  voir le tableau « Lecture » dans `docs/API.md` (ex. paramètres `security` = Admin seul, `operations` = tout le personnel).
- **Public** : `/inscription`, `/reset-password`, pages de connexion.
- Routes, formes des réponses et codes d'erreur : `docs/API.md` (source de vérité, plus à jour que ce fichier).

## Marque et thème
- `GET /api/v1/public/branding` (plateforme) et `GET /api/v1/public/tenants/:slug/branding` (restaurant) renvoient
  `displayName`, `tagline`, `logoUrl`, `logoDarkUrl`, `faviconUrl`, `theme` (`mode`, `primary`, `accent`, `fontFamily`,
  `radius`, `kitchenDark`) et `cssVars`. Appliquer avec `applyBranding(branding, titre)` au montage de l'espace :
  variables CSS sur `<html>`, favicon, police. `theme.mode` donne le mode par défaut ; le choix de l'utilisateur
  (clair/sombre/système) l'emporte et est mémorisé localement.
- La couleur lisible sur la marque (`--color-on-primary`) est calculée par l'API (contraste WCAG) : ne pas la recalculer.
- Logo : `logoDarkUrl` en mode sombre (repli automatique sur `logoUrl`). Sans logo : initiales du nom dans un carré `bg-brand`.
- **Aperçu en direct** dans les pages de marque : appliquer les `cssVars` calculées côté client
  (`themeToCssVars` de `@restaurant/utils`) **sur le conteneur de l'aperçu seulement**, pas sur `<html>`, tant que ce n'est
  pas enregistré. Afficher les `warnings` de contraste renvoyés par l'API.

## Statuts, libellés, couleurs
- Couleur : `statusTone(status)` de `@restaurant/ui-tokens` (une seule règle pour web et mobile).
- Libellés : `lib/labels.ts` (`TENANT_STATUS_LABEL`, `SUBSCRIPTION_STATUS_LABEL`, `PAYMENT_METHOD_LABEL`, `TENANT_ROLE_LABEL`…).
- Commandes (phase 1) : en attente = ambre, en préparation = bleu, prête = vert, servie = gris (`ORDER_STATUS_COLORS`).
  Sur l'écran cuisine, ajouter le temps écoulé (mono) qui passe à l'ambre puis au rouge au-delà du temps de préparation.

## Erreurs de l'API (classe `ApiError` de `@restaurant/api-client`)
| Cas | Réponse | UX attendue |
|---|---|---|
| Champs invalides | 400 + `errors[{path, message}]` | message sous chaque champ, focus sur le premier |
| Session restreinte | 403 `RESTRICTED_SESSION` + `restriction` | écran forcé : changer le mot de passe / activer la 2FA (géré globalement) |
| Licence bloquée | 403 `LICENSE_BLOCKED` | écran « Licence expirée » avec « Comment payer » (géré globalement) |
| Compte verrouillé | 423 `ACCOUNT_LOCKED` | message avec la durée restante, lien « Mot de passe oublié » |
| Conflit | 409 | message de l'API tel quel (déjà en français) |
| Session expirée | 401 après échec du rafraîchissement | retour à la connexion avec « Votre session a expiré » |

Les messages de l'API sont rédigés en français pour l'utilisateur final : les afficher tels quels plutôt que les réécrire.

## Montants, dates, nombres
- FCFA (XOF), **entiers sans décimales** : `formatFcfa(35000)` → « 35 000 FCFA ». Saisie : entier, suffixe « FCFA ».
- Dates : `formatDate`, `formatDateTime`, `formatRelative` (« il y a 3 min »), fuseau du restaurant (défaut `Africa/Lome`).
- Numéros de reçu, références Flooz/TMoney, identifiants : `font-mono`, avec `CopyButton`.
- Moyens de paiement, toujours dans cet ordre : Flooz, TMoney, Carte, Espèces (référence obligatoire sauf espèces).

## Glossaire (termes à employer)
restaurant (pas « tenant ») · licence · essai gratuit · période de grâce · plan · paiement · reçu · inscription ·
SuperAdmin · Support · administrateur · gérant · serveur · cuisine · client · double authentification (2FA) ·
code de secours · session · appareil · marque · thème · logo · favicon · commande · addition · table · plan de salle ·
réservation · liste d'attente · stock · fournisseur · écran cuisine.
Boutons : « Enregistrer », « Enregistrer le paiement », « Créer le restaurant », « Valider l'inscription », « Rejeter »,
« Suspendre », « Réactiver », « Annuler le paiement », « Se déconnecter », « Réessayer ».

## Contexte d'usage
Tablettes et téléphones en salle, PC au comptoir, grand écran en cuisine, connexion mobile parfois lente :
privilégier des écrans légers, du texte lisible à distance, des actions principales atteignables au pouce
(en bas sur mobile), et des confirmations explicites pour l'argent et les suppressions.
