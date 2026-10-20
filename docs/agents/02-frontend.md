# Guide frontend — ajouter des écrans

**Avant tout : chargez le skill `vercel-design`** (`.claude/skills/vercel-design/SKILL.md` et ses `references/`). Il fixe le style (Vercel/Geist),
les jetons, les composants, le mouvement, les textes français et la grille de relecture. Ce guide-ci couvre la plomberie de l'application.

## Où mettre quoi (`apps/web/src`)
| Élément | Emplacement |
|---|---|
| Routes | `app/router.tsx` (espaces `/admin/*`, `/r/:slug/*`, public) |
| Écrans du restaurant | `features/tenant/<domaine>/…` (ex. `orders/`, `pos/`, `kitchen/`) |
| Écrans plateforme | `features/platform/<domaine>/…` |
| Coque et navigation | `layouts/app-shell.tsx`, `features/tenant/tenant-shell.tsx` (`useTenantNav`), groupes de rôles `features/tenant/hooks.ts` (`ROLE_GROUPS`) |
| Protection par rôle | `RoleGate` (route), masquage/désactivation avec infobulle (action) |
| Composants réutilisables | `components/ui/*` (ajoutez-y vos nouveaux composants génériques) |
| Clés de cache TanStack Query | `lib/tenant-keys.ts` (centralisées) |
| Temps réel | `lib/realtime/connection.ts` (connexion, jeton, reconnexion), `lib/realtime/order-cache.ts` (mise à jour des caches), `providers/realtime.tsx` |
| Libellés FR des énumérations | `lib/labels.ts` · couleurs de statut : `@restaurant/ui-tokens` |
| Formats | `lib/format.ts` (`formatFcfa`, dates dans le fuseau du restaurant) |
| Session | `providers/session.tsx` (restriction, licence, déconnexion) |

## Recette
1. **Client API** : ajoutez types et endpoints dans `packages/api-client` (ou utilisez ceux déjà ajoutés par l'agent backend).
2. **Requêtes** : TanStack Query avec des clés de `lib/tenant-keys.ts` ; `placeholderData: keepPreviousData` pour les listes paginées ;
   filtres dans l'URL (`useSearchParams`) ; mutations qui mettent le cache à jour avec la réponse de l'API.
3. **Formulaires** : `react-hook-form` + `zodResolver(schéma de @restaurant/validation)` ; erreurs serveur `ApiError.errors[]` → `setError`.
4. **Temps réel** : abonnez-vous aux événements du domaine dans le fournisseur temps réel et mettez à jour les caches en place
   (suivez `applyOrderEvent`) ; refetch au retour de connexion.
5. **Navigation** : ajoutez l'entrée au bon groupe de rôles ; l'API reste l'arbitre (gérez 403 proprement).
6. **États** : chargement (squelette), vide (action suivante), erreur (« Réessayer »), droits insuffisants, licence en grâce (bandeau existant).
7. **Calculs** : jamais de recalcul maison de montants — utilisez `@restaurant/utils` (mêmes fonctions que l'API).

## Écrans particuliers
- **Tactiles / plein écran** (prise de commande, cuisine, plan de salle) : cibles ≥ 56 px, pas d'information au survol, fonctionnement à 1024×768 et sur grand écran.
- **Cuisine** : toujours sombre (`useForcedTheme("dark")`), aucune animation décorative.
- **Impression** : `@media print` + `@page` (voir le ticket 80 mm `features/tenant/orders/ticket-page.tsx`).
- **Public** (carte, réservation, espace client) : marque du restaurant appliquée (`applyBranding`), mobile d'abord, rapide, sans compte quand c'est possible.

## Tests web
Vitest (`pnpm --filter web test`) pour toute logique non triviale : calculs d'affichage, mise à jour des caches temps réel, réducteurs,
validation de formulaires complexes. Un scénario Playwright quand une fonctionnalité dépend du temps réel ou d'un enchaînement d'écrans.
