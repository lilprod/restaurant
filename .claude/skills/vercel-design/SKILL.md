---
name: vercel-design
description: >-
  Construire ou retoucher une interface web dans le style Vercel / Geist pour le projet « Gestion Restaurant »
  (React + Vite + Tailwind v4, composants façon shadcn/ui sur Radix, Geist Sans/Mono, animations Motion, sonner,
  cmdk, lucide, Recharts), avec mode clair/sombre, thème de marque du restaurant injecté par l'API, interface en
  français, montants FCFA, accessibilité et responsive. Utilise ce skill dès qu'il faut créer, modifier, styliser,
  animer ou vérifier visuellement un écran, une page, un composant, un formulaire, un tableau, un tableau de bord,
  une modale ou une mise en page dans apps/web (ou le futur mobile), même si la demande ne dit pas « Vercel » —
  par exemple « fais l'écran des commandes », « ajoute une page réservations », « rends ce tableau plus joli »,
  « corrige l'affichage mobile », « mets le thème du restaurant », « build the KDS screen ».
---

# Design Vercel / Geist — Gestion Restaurant

Ce skill sert à produire des écrans **cohérents avec ceux qui existent déjà**, de qualité « produit fini ».
L'esthétique visée est celle de Vercel (Geist) : sobre, neutre, dense mais calme, rapide. La couleur de la
marque du restaurant n'apparaît que là où un accent a du sens. Le résultat doit fonctionner dans un restaurant
réel : écrans tactiles, cuisine sombre, personnel pressé, réseau parfois lent.

## 1. Avant d'écrire du code : partir de l'existant

L'application a déjà un système de design. Le réinventer produit des écrans qui détonnent — c'est l'erreur n°1.

1. Lis `apps/web/src/styles/globals.css` : ce sont **les** jetons (couleurs sémantiques, ombres, rayons, tons de statut).
2. Liste `apps/web/src/components/ui/` et réutilise ces composants (Button, Card, Badge/StatusBadge, Dialog, Confirm,
   Tabs, Segmented, Field, Input, Switch, Tooltip, Dropdown, useConfirm, EmptyState, Skeleton, AnimatedNumber, ProgressRing,
   CopyButton, Kbd…). N'en crée un nouveau que s'il manque, dans le même style (cva + `cn`), au même endroit.
3. Regarde un écran voisin déjà fait (même espace, même type de page) et copie sa structure.
4. Utilitaires à connaître : `lib/motion.ts` (durées, courbes), `lib/format.ts` (`formatFcfa`, `formatDate`, `formatRelative`, `daysUntil`), `lib/labels.ts`
   (libellés FR des énumérations), `lib/branding.ts` (`applyBranding`), `@restaurant/ui-tokens` (`statusTone`),
   `@restaurant/utils` (thème, contraste, `validatePassword`, `formatFcfa`), `@restaurant/validation` (schémas Zod
   partagés avec l'API), `@restaurant/api-client` (client typé, erreurs `ApiError`).

Si un de ces fichiers n'existe pas encore (nouvelle app, mobile), pars de `references/tokens.md`, qui en donne la base.

## 2. Règles de design (et pourquoi)

- **Neutre d'abord, marque ensuite.** Fond, texte, bordures, survols : uniquement les jetons neutres
  (`bg-background`, `text-muted-foreground`, `border-border`, `bg-hover`…). La marque (`bg-brand`, `text-brand-ink`,
  `bg-brand-tint`, `ring-ring`) est réservée au bouton principal, à l'élément de navigation actif, à l'anneau de focus,
  aux graphiques et à quelques badges. Chaque restaurant choisit sa couleur : si elle est partout, un restaurant
  « rouge bordeaux » obtient une interface criarde et illisible.
- **Jamais de couleur en dur.** Pas de `#hex`, `text-gray-500`, `bg-white`, `dark:bg-zinc-900` dans les écrans :
  seulement les jetons. C'est ce qui rend le mode sombre et le thème du restaurant automatiques.
- **Bordures 1px nettes, ombres discrètes.** Les cartes ont une bordure + `shadow-xs`/`shadow-sm` ; les surfaces
  flottantes (menus, dialogues) `shadow-md`/`shadow-lg`. Pas de dégradés décoratifs, pas d'ombres colorées.
- **Typographie Geist.** Texte 14px (`text-sm`) par défaut, titres de page 20–24px `font-semibold tracking-tight`,
  libellés de section 12px en majuscules `text-muted-foreground tracking-wide`. **Monospace (`font-mono tabular-nums`)**
  pour montants, identifiants, numéros de reçu, heures, codes : l'alignement des chiffres aide à lire vite.
- **Densité calme.** Grille de 4px, espacements généreux entre sections (`gap-6`/`gap-8`), serrés dans les listes.
  Une page = un en-tête (titre, description courte, action principale à droite) puis le contenu.
- **Statuts toujours via `statusTone`** (essai bleu, actif vert, grâce ambre, expiré/suspendu/rejeté rouge,
  en attente/annulé/résilié gris ; commandes : en attente ambre, en préparation bleu, prête verte, servie grise).
  Un statut a toujours un libellé texte en plus de la couleur (daltonisme, écrans au soleil).
- **Mobile et tactile.** Cibles ≥ 44px sous `sm` (les composants le gèrent déjà : `h-11 sm:h-9`). Barre latérale →
  tiroir sous `md`. Tableaux → cartes empilées sous `md`. Pas de survol indispensable : tout doit marcher au doigt.
- **Accessibilité.** Contraste AA (le texte sur la marque utilise `text-brand-foreground`, calculé par l'API),
  focus visible (`focus-visible:ring-2 ring-ring`), `aria-label` sur les boutons-icônes, ordre de tabulation logique,
  libellés reliés aux champs, messages d'erreur annoncés (`role="alert"`/`aria-live`).
- **Écran cuisine (KDS) et tablettes de salle.** Toujours sombre (`theme.kitchenDark`), gros caractères, contrastes
  forts, boutons 56–64px, aucune animation décorative, informations lisibles à 2 mètres.

## 3. États : un écran n'est fini que s'ils existent tous

Pour chaque vue alimentée par l'API : **chargement** (squelette à la forme du contenu, pas de spinner plein écran),
**vide** (`EmptyState` avec une phrase utile et l'action suivante), **erreur** (message de l'API + « Réessayer »),
**succès** (toast `sonner` court), **droits insuffisants** (masquer ou désactiver avec une infobulle, selon le rôle),
**hors ligne / lent** quand c'est pertinent. Les actions destructrices passent par `useConfirm()` et disent ce qui va
se passer (« Le paiement REC-2026-000014 sera annulé et la période restituée »).

Erreurs de l'API à traiter (voir `references/restaurant-project.md`) : `errors[]` → sous chaque champ ;
`RESTRICTED_SESSION`, `LICENSE_BLOCKED`, `ACCOUNT_LOCKED` → écrans dédiés, déjà gérés globalement : ne les
réimplémente pas page par page.

## 4. Mouvement

Le mouvement sert la compréhension (d'où vient ce panneau, qu'est-ce qui a changé), jamais la décoration.
150–250 ms, courbe `EASE_OUT`, sortie plus rapide que l'entrée, jamais bloquant, et **toujours** désactivé avec
`prefers-reduced-motion` (`useReducedMotion` de `motion/react`). Détails et recettes : `references/motion.md`.

## 5. Textes en français

Vouvoiement, phrases courtes, verbes d'action sur les boutons (« Enregistrer le paiement », pas « Valider »),
pas de jargon technique (« Session expirée, reconnectez-vous » plutôt que « 401 »). Montants `formatFcfa(12500)`
→ « 12 500 FCFA », dates en fr-FR, fuseau du restaurant (défaut `Africa/Lome`). Tous les libellés d'énumération
viennent de `lib/labels.ts` — ajoute-les là s'ils manquent. Glossaire : `references/restaurant-project.md`.

## 6. Vérifier visuellement avant de rendre

Ne déclare pas un écran terminé sans l'avoir **vu**. Lance l'API et le web, puis :

```bash
export PW_DIR=<scratchpad>/pw && npm i --prefix "$PW_DIR" playwright-core   # une fois, hors du dépôt
node .claude/skills/vercel-design/scripts/screenshots.mjs --url http://localhost:5173 \
  --routes "/admin,/admin/restaurants" --out <scratchpad>/screens \
  --login .claude/skills/vercel-design/scripts/login-example.mjs   # identifiants via SHOT_EMAIL / SHOT_PASSWORD
```

Le script capture chaque route en clair et en sombre, à 1440px et 390px, et signale les erreurs JavaScript,
les erreurs console et tout **débordement horizontal** (code de sortie 1). Options dans l'en-tête du script. Ouvre les PNG (outil Read) et passe la grille de `references/checklist.md`.
Corrige, recapture, jusqu'à ce que ce soit propre. Termine par `pnpm --filter web lint` et `pnpm --filter web build`.

## Références (à lire selon le besoin)

| Fichier | Quand le lire |
|---|---|
| `references/tokens.md` | Choisir une classe de couleur, d'ombre, de rayon, de typo ; démarrer une app sans jetons |
| `references/components.md` | Construire une page : en-tête, tableau/cartes, formulaire, KPI, upload, OTP, palette ⌘K… |
| `references/motion.md` | Ajouter une transition, une liste animée, un compteur, un squelette |
| `references/restaurant-project.md` | Marque du restaurant, rôles, statuts, erreurs API, FCFA, glossaire FR, KDS |
| `references/checklist.md` | Relecture finale d'un écran (à passer à chaque fois) |
