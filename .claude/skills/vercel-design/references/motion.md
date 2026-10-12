# Mouvement (bibliothèque `motion`, ex-Framer Motion)

Import : `import { motion, AnimatePresence, useReducedMotion } from "motion/react"`.
Constantes : `EASE_OUT = [0.16, 1, 0.3, 1]`, `DURATION = { fast: 0.15, base: 0.2, slow: 0.25 }` (`@/lib/motion`).

## Principes
- **Rapide** : 150–250 ms ; les sorties ~30 % plus courtes que les entrées. Rien au-delà de 300 ms sauf chargement.
- **Utile** : montrer l'origine (menu qui sort de son bouton), la continuité (onglet actif qui glisse), le changement
  (compteur qui monte, ligne ajoutée qui apparaît). Pas d'animation en boucle décorative.
- **Jamais bloquant** : l'utilisateur peut cliquer pendant une transition ; pas d'`await` d'animation avant navigation.
- **Accessible** : avec `useReducedMotion()` → pas de déplacement ni d'échelle, seulement un fondu (ou rien).
- Animer `opacity` et `transform` (GPU), pas `height`/`top`/`box-shadow` en continu ; pour une hauteur, `layout`.

## Recettes

Transition de page (dans le layout, clé = pathname) :
```tsx
const reduce = useReducedMotion();
<AnimatePresence mode="wait" initial={false}>
  <motion.main key={location.pathname}
    initial={{ opacity: 0, y: reduce ? 0 : 6 }} animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, transition: { duration: DURATION.fast } }}
    transition={{ duration: DURATION.base, ease: EASE_OUT }}>
    <Outlet />
  </motion.main>
</AnimatePresence>
```

Entrée en cascade (cartes KPI, listes courtes ≤ 12 éléments) :
```tsx
const list = { animate: { transition: { staggerChildren: 0.04 } } };
const item = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0, transition: { duration: DURATION.base, ease: EASE_OUT } } };
<motion.div variants={list} initial="initial" animate="animate">{kpis.map(k => <motion.div key={k.id} variants={item}>…</motion.div>)}</motion.div>
```

Indicateur actif qui glisse (onglets, segmenté, navigation) : un `motion.span layoutId="tab-indicator"` rendu sous l'élément
actif ; `transition={{ type: "spring", stiffness: 500, damping: 40 }}`.

Liste qui change (ajout/suppression) : `<AnimatePresence initial={false}>` + `motion.li layout` avec `exit={{ opacity: 0, height: 0 }}`.

Compteur KPI : composant `AnimatedNumber` (animation de 0 → valeur la première fois, puis de l'ancienne à la nouvelle, ~600 ms),
formaté (`formatFcfa`) ; affiche directement la valeur finale si `reduced-motion`.

Micro-interactions : boutons `active:scale-[0.98]` (déjà dans `Button`), `Switch` qui glisse, copie → icône ✓ pendant 1,5 s,
erreur OTP → `x: [0, -6, 6, -4, 4, 0]` en 300 ms.

Squelettes : `animate-shimmer` (dégradé qui défile), même forme que le contenu final, apparition après 150 ms seulement
pour éviter le flash sur les réponses rapides.

Dialogues et menus : Radix gère l'accessibilité ; animer l'entrée `opacity 0→1` + `scale 0.97→1` depuis le
`transform-origin` du déclencheur (`--radix-*-content-transform-origin`), 150 ms.
