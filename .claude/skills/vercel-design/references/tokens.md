# Jetons de design

Source de vérité : `apps/web/src/styles/globals.css` (Tailwind v4, `@theme inline`). Ce fichier résume les classes
à utiliser et fournit une base si tu démarres une nouvelle app (mobile, autre front).

## Couleurs sémantiques → classes Tailwind

| Rôle | Classe | Remarque |
|---|---|---|
| Fond de page | `bg-background` | blanc / #0a0a0a |
| Fond légèrement décalé (barre latérale, zones) | `bg-subtle` | |
| Fond neutre (puces, pistes, segments) | `bg-muted` | |
| Survol d'un élément neutre | `hover:bg-hover` | |
| Carte / popover | `bg-card` / `bg-popover` | toujours avec `border` |
| Texte principal | `text-foreground` | |
| Texte secondaire | `text-muted-foreground` | descriptions, libellés |
| Texte discret | `text-faint` | horodatages, aides |
| Bordure normale / appuyée | `border-border` / `border-border-strong` | 1px |
| Bordure des champs | `border-input` | |
| **Marque** : fond plein | `bg-brand text-brand-foreground` | bouton principal uniquement |
| Marque : texte/icône sur fond neutre | `text-brand-ink` | lien, nav active (lisible en clair ET sombre) |
| Marque : fond teinté | `bg-brand-tint` | élément de nav actif, badge « marque » |
| Anneau de focus | `ring-ring` | dérivé de la marque |
| Danger / succès / alerte | `bg-danger`, `text-danger`, `text-success`, `text-warning` | |
| Tons de statut | `bg-[var(--tone-green-bg)] text-[var(--tone-green-fg)]` | passer par `<Badge tone>` / `<StatusBadge>` |

Les variables de marque (`--color-primary`, `--color-on-primary`, `--color-primary-soft`, `--color-accent`,
`--color-on-accent`, `--radius`, `--font-family`) sont **injectées sur `<html>`** par `applyBranding()` à partir de
`cssVars` renvoyé par l'API. Ne les fixe jamais dans un composant.

## Typographie

| Usage | Classes |
|---|---|
| Titre de page | `text-2xl font-semibold tracking-tight` (mobile `text-xl`) |
| Titre de carte / section | `text-[15px] font-semibold` ou `text-base font-semibold` |
| Libellé de section | `text-xs font-medium uppercase tracking-wide text-muted-foreground` |
| Corps | `text-sm` (14px) |
| Aide / méta | `text-[13px] text-muted-foreground` ou `text-xs text-faint` |
| Chiffres, montants, codes | `font-mono tabular-nums` |
| Grand KPI | `text-3xl font-semibold tracking-tight tabular-nums` |
| Police de marque (page de connexion, nom du restaurant) | `font-brand` |

Polices : `@fontsource-variable/geist` et `@fontsource-variable/geist-mono` (auto-hébergées, pas de dépendance réseau).

## Rayons, ombres, espacements

- Rayons dérivés de la marque : `rounded-sm` (0.6×), `rounded-md` (= `--radius`), `rounded-lg` (1.35×), `rounded-xl`.
  Champs et boutons `rounded-md`, cartes `rounded-lg`, dialogues `rounded-xl`, pastilles `rounded-full`.
- Ombres : `shadow-xs` (boutons, champs), `shadow-sm` (cartes), `shadow-md` (menus, popovers), `shadow-lg` (dialogues).
- Espacements : multiples de 4px. Page `px-4 sm:px-6 lg:px-8 py-6`, largeur max `max-w-6xl` (formulaires `max-w-2xl`).
  Sections `space-y-6`/`gap-8`, intérieur de carte `p-5`/`p-6`, listes `gap-2`/`gap-3`.

## Base pour une nouvelle app (si `globals.css` n'existe pas)

Reprendre `apps/web/src/styles/globals.css` tel quel est la meilleure option. À défaut, le minimum :

```css
@import "tailwindcss";
@import "@fontsource-variable/geist";
@import "@fontsource-variable/geist-mono";
@custom-variant dark (&:where(.dark, .dark *));

:root {
  --color-primary: #171717; --color-on-primary: #fff; --radius: 8px;
  --background: #fff; --foreground: #0a0a0a; --subtle: #fafafa; --muted: #f2f2f2;
  --muted-foreground: #666; --faint-foreground: #8f8f8f; --border: #ebebeb; --border-strong: #d4d4d4;
  --input: #e0e0e0; --hover: #f4f4f4;
  --brand-ink: color-mix(in oklab, var(--color-primary) 92%, black);
  --brand-tint: color-mix(in oklab, var(--color-primary) 9%, var(--background));
  --ring: color-mix(in oklab, var(--color-primary) 55%, transparent);
}
.dark {
  --background: #0a0a0a; --foreground: #ededed; --subtle: #0f0f0f; --muted: #1a1a1a;
  --muted-foreground: #a1a1a1; --faint-foreground: #7a7a7a; --border: #262626; --border-strong: #3a3a3a;
  --input: #2e2e2e; --hover: #1c1c1c;
  --brand-ink: color-mix(in oklab, var(--color-primary) 55%, white);
  --brand-tint: color-mix(in oklab, var(--color-primary) 18%, var(--background));
}
@theme inline {
  --font-sans: "Geist Variable", system-ui, sans-serif;
  --font-mono: "Geist Mono Variable", ui-monospace, monospace;
  --color-background: var(--background); --color-foreground: var(--foreground);
  --color-muted: var(--muted); --color-muted-foreground: var(--muted-foreground);
  --color-border: var(--border); --color-hover: var(--hover);
  --color-brand: var(--color-primary); --color-brand-foreground: var(--color-on-primary);
  --color-brand-ink: var(--brand-ink); --color-brand-tint: var(--brand-tint); --color-ring: var(--ring);
  --radius-md: var(--radius); --radius-lg: calc(var(--radius) * 1.35);
}
```

React Native (phase mobile) : mêmes noms de jetons dans un objet `theme` (clair/sombre), alimenté par les mêmes
`cssVars` de l'API (retirer le préfixe `--`). Les helpers de `@restaurant/utils` (`readableTextOn`, `tint`) marchent tels quels.
