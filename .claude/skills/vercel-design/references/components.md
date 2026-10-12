# Recettes de composants et de pages

Toujours importer depuis `@/components/ui/*` quand le composant existe. Les extraits ci-dessous montrent
**l'assemblage attendu** ; adapte les noms exacts aux composants présents.

## Sommaire
1. En-tête de page · 2. Carte · 3. Liste de données (tableau → cartes) · 4. Formulaire · 5. KPI · 6. Badges de statut ·
7. États vides / chargement / erreur · 8. Dialogue et confirmation · 9. Onglets et contrôle segmenté ·
10. Envoi de fichier · 11. Saisie de code (OTP) · 12. Palette ⌘K · 13. Toasts · 14. Navigation (barre latérale) ·
15. Graphiques

## 1. En-tête de page

```tsx
<header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
  <div className="space-y-1">
    <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Paiements</h1>
    <p className="text-sm text-muted-foreground">Licences encaissées en espèces, carte, Flooz ou TMoney.</p>
  </div>
  <Button variant="primary"><Plus /> Enregistrer un paiement</Button>
</header>
```
Une seule action `primary` par écran. Les actions secondaires vont en `secondary`/`ghost` ou dans un menu `…`.

## 2. Carte

`<Card>` = `rounded-lg border bg-card shadow-sm`. En-tête avec titre 15px + description, contenu `p-5/p-6`,
pied optionnel séparé par une bordure (`border-t bg-subtle`) pour les boutons d'enregistrement d'un formulaire.

## 3. Liste de données

- Bureau : tableau `text-sm`, en-têtes `text-xs uppercase tracking-wide text-muted-foreground`, lignes `h-12`,
  séparateurs `divide-y`, survol `hover:bg-hover`, colonnes numériques alignées à droite en `font-mono tabular-nums`,
  dernière colonne = menu d'actions (`Dropdown` + bouton-icône `aria-label="Actions"`).
- Sous `md` : **pas de défilement horizontal** — même donnée en cartes empilées (titre + statut en haut, 2–3 lignes clé/valeur).
- Barre d'outils au-dessus : recherche (`Input` avec icône, debounce 250 ms), filtres (`Segmented` ou `Dropdown`), compteur.
- Pagination simple « Précédent / Suivant » + « 21–40 sur 134 ». Garder les filtres dans l'URL (`useSearchParams`)
  pour que le lien soit partageable et que « retour » fonctionne.
- Ligne cliquable → `Link` sur toute la ligne (accessible au clavier), pas `onClick` sur un `<tr>`.

## 4. Formulaire

- `react-hook-form` + `zodResolver(schemaPartagé)` depuis `@restaurant/validation` : **pas de validation réécrite à la main**.
- `Field` = libellé + champ + aide + erreur. Erreurs sous le champ, en `text-danger text-[13px]`, `role="alert"`.
- Erreurs serveur : `ApiError.errors[]` (`{ path, message }`) → `setError(path, { message })`.
- Bouton d'envoi `loading` pendant la requête ; désactivé seulement s'il n'y a rien à enregistrer (`!isDirty`).
- Formulaires longs : sections dans des cartes, pied collant `sticky bottom-0` avec « Annuler / Enregistrer » quand modifié.
- Choix courts (moyen de paiement, cycle) : `Segmented`, pas un `<select>`. Booléens : `Switch` avec une phrase d'explication.
- Montants : `inputMode="numeric"`, suffixe « FCFA » dans le champ, affichage du total formaté en direct.

## 5. KPI

```tsx
<Card className="p-5">
  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Encaissé ce mois</p>
  <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums"><AnimatedNumber value={total} format={formatFcfa} /></p>
  <p className="mt-1 text-[13px] text-muted-foreground">12 paiements · 4 restaurants</p>
</Card>
```
Grille `grid gap-4 sm:grid-cols-2 lg:grid-cols-4`, entrée en cascade (voir motion.md).

## 6. Badges de statut

`<StatusBadge status={tenant.status} labels={TENANT_STATUS_LABEL} />` — la couleur vient de `statusTone()`.
Ne jamais choisir la couleur d'un statut à la main dans un écran : ajoute la valeur dans `@restaurant/ui-tokens`.

## 7. États

- Chargement : `Skeleton` reproduisant la forme finale (lignes de tableau, cartes KPI). Pas de spinner plein écran.
- Vide : `EmptyState` = icône dans un carré `bg-muted rounded-lg`, titre court, une phrase, **une action**.
  Ex. « Aucun paiement ce mois-ci » + « Enregistrer un paiement ».
- Erreur : carte bordée `border-danger/30`, message de l'API, bouton « Réessayer » (`refetch`).
- Données qui se rafraîchissent : garder l'ancien contenu affiché (`placeholderData: keepPreviousData`), indicateur discret.

## 8. Dialogue et confirmation

Dialogue Radix : `max-w-lg`, `rounded-xl shadow-lg`, titre + description, contenu, pied à droite
(« Annuler » `ghost` puis action). Sur mobile : pleine largeur ancrée en bas (feuille). Fermeture Échap et clic extérieur,
sauf pendant l'envoi. `const confirm = useConfirm()` pour toute action destructrice : titre-question, conséquence concrète, bouton `danger`
avec le verbe exact (« Suspendre le restaurant »). Motif obligatoire quand l'API le demande (rejet, annulation).

## 9. Onglets / contrôle segmenté

Onglets de page : soulignement animé sous l'onglet actif (`layoutId`, voir motion.md), état dans l'URL (`?tab=`).
`Segmented` pour 2–5 options exclusives dans un formulaire ou une barre de filtres.

## 10. Envoi de fichier (logo, favicon, avatar)

Zone de dépôt `border border-dashed rounded-lg` + bouton « Choisir un fichier », aperçu immédiat (`URL.createObjectURL`),
**vérification côté client identique à l'API** (PNG/JPEG/WebP, favicon + ICO, pas de SVG ; logo 2 Mo, favicon 512 Ko,
avatar 1 Mo) pour un message instantané, puis envoi multipart (champ `file`). Aperçu du favicon dans un faux onglet de navigateur,
du logo sur fond clair ET sombre. Bouton « Retirer » avec confirmation.

## 11. Saisie de code (OTP 2FA)

6 cases `inputMode="numeric" autoComplete="one-time-code"`, avance automatique, retour arrière, **collage du code
entier**, validation automatique à la 6ᵉ saisie, secousse légère + effacement si faux (sauf `reduced-motion`).
Lien « Utiliser un code de secours » qui bascule vers un champ texte unique (format `XXXXX-XXXXX`).

## 12. Palette de commandes ⌘K

`cmdk` dans un `Dialog` : groupes « Aller à », « Restaurants » (recherche API debouncée), « Actions ». Raccourci affiché
avec `<Kbd>⌘K</Kbd>` (ou Ctrl K hors Mac) dans la barre supérieure. Ne propose que ce que le rôle peut faire.

## 13. Toasts

`sonner` en bas à droite (en haut au centre sur mobile). Succès court (« Paiement enregistré — REC-2026-000014 »),
erreurs avec le message de l'API. Pas de toast pour ce qui est déjà visible à l'écran.

## 14. Navigation

Barre latérale 240px `bg-subtle border-r` : logo/nom (marque) en haut, groupes de liens (icône lucide 16px + libellé),
élément actif `bg-brand-tint text-brand-ink font-medium`, compte utilisateur en bas (menu : Mon compte, thème, déconnexion).
Sous `md` : barre supérieure + tiroir. Fil d'Ariane sur les pages de détail. Bandeau d'alerte global (licence en grâce)
au-dessus du contenu, ton ambre, avec action « Voir comment payer ».

## 15. Graphiques (Recharts)

Couleur principale = `var(--color-primary)`, séries secondaires = tons neutres ou tons de statut ; grille `var(--border)`,
axes `var(--muted-foreground)` 12px, pas de bordure de graphique, infobulle = carte `bg-popover border shadow-md` avec
valeurs en `font-mono` formatées FCFA. Toujours un résumé chiffré à côté du graphique (accessibilité, lecture rapide).
Pour une analyse plus poussée des palettes, le skill `dataviz` est complémentaire.
