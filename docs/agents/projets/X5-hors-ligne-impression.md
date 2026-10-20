# X5 — Hors-ligne (PWA) et impression des tickets

> **Type** web (+ API légère) · **Dépend de** phase 1 · **En parallèle avec** P3, P4 · **Taille** M · **Modèle** `sonnet`

## Objectif
Continuer à prendre des commandes et à faire tourner la cuisine pendant une coupure réseau courte, et imprimer automatiquement
les tickets cuisine et caisse sur imprimante thermique.

## Périmètre
- **PWA** (vite-plugin-pwa) : installation sur tablette, cache de l'application, de la carte et des tables ; indicateur hors ligne.
- **File d'attente locale** (IndexedDB) des créations de commande et ajouts d'articles hors ligne, rejouée au retour du réseau.
  **API** : en-tête `Idempotency-Key` sur `POST /tenant/orders`, `/orders/:id/items` et `/payments` (table `IdempotencyKey`, réponse rejouée,
  durée 24 h) pour qu'une requête rejouée ne crée jamais de doublon (test e2e).
- Encaissement hors ligne : **interdit** (affiché clairement).
- **Impression** : ticket cuisine (gros caractères, regroupé par poste) et ticket caisse ; impression automatique par appareil (réglage local)
  à la création d'une commande ; pilote navigateur (`window.print` 80 mm, déjà existant) et pilote **ESC/POS** via Web Serial/WebUSB (Chrome)
  pour les imprimantes thermiques USB ; réimpression manuelle.

## Critères d'acceptation
- [ ] Couper le réseau (Playwright `offline`) : la commande est mise en file, envoyée au retour, une seule fois (idempotence prouvée).
- [ ] Ticket cuisine imprimé automatiquement à la nouvelle commande (pilote navigateur ; ESC/POS testé avec un faux port).
- [ ] Aucune régression des écrans existants ; captures de l'indicateur hors ligne et des tickets.

## Questions ouvertes (défaut retenu)
Modèles d'imprimantes utilisés par les restaurants → **ESC/POS générique 80 mm** ; le propriétaire confirmera le matériel.
