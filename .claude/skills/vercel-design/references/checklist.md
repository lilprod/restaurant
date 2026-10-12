# Relecture d'un écran (à passer avant de dire « terminé »)

Capturer avec `scripts/screenshots.mjs` (clair + sombre, 1440px + 390px), ouvrir les PNG, puis vérifier :

**Cohérence**
- [ ] Composants de `components/ui` réutilisés ; aucune couleur en dur (`#…`, `gray-500`, `bg-white`, `dark:`…).
- [ ] Marque utilisée seulement pour l'action principale, la nav active, le focus, les graphiques.
- [ ] Une seule action `primary` visible ; en-tête de page standard (titre, description, action).
- [ ] Statuts via `StatusBadge` + libellés de `lib/labels.ts`.

**Lisibilité**
- [ ] Rien ne déborde ni ne se chevauche à 390px ; pas de défilement horizontal de la page.
- [ ] Textes en français, sans faute ni anglais oublié ; montants en FCFA ; dates fr-FR.
- [ ] Chiffres et codes en `font-mono tabular-nums`, alignés à droite dans les tableaux.
- [ ] Mode sombre aussi soigné que le clair (bordures visibles, pas de blanc pur, logo sombre utilisé).
- [ ] Contraste AA (texte secondaire inclus) ; tester avec une marque très claire et une très foncée.

**États et interactions**
- [ ] Chargement (squelette), vide (avec action), erreur (avec « Réessayer »), succès (toast) présents.
- [ ] Actions interdites au rôle masquées ou désactivées avec explication.
- [ ] Actions destructrices confirmées, avec la conséquence écrite.
- [ ] Erreurs de champ affichées sous le champ ; focus sur le premier champ en erreur.
- [ ] Clavier : tout atteignable au Tab, focus visible, Échap ferme les dialogues, Entrée valide les formulaires.
- [ ] Cibles tactiles ≥ 44px sur mobile ; aucune information accessible uniquement au survol.

**Mouvement**
- [ ] 150–250 ms, rien de bloquant, pas d'animation en boucle décorative.
- [ ] `prefers-reduced-motion` respecté (capturer aussi avec `--reduced-motion` si l'écran est très animé).

**Technique**
- [ ] `pnpm --filter web lint` et `pnpm --filter web build` passent ; tests web passent.
- [ ] Pas d'appel API dupliqué (TanStack Query, clés stables) ; filtres dans l'URL.
