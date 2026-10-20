# P4 — Personnel : fiches, planning, pointage, performances, paie, messagerie

> **Type** API + web · **Dépend de** phase 1 · **En parallèle avec** P2B, P2C, P3 · **Taille** L · **Modèle** `sonnet`
> **Plan** : fonctionnalité `staff` (Starter : non) → `403 PLAN_FEATURE` (sauf messagerie, ouverte à tous)

## Existant
Comptes du personnel (`/tenant/staff`, phase 1), `StaffProfile` (poste, taux horaire, multiplicateur heures sup., embauche, contact d'urgence),
`Shift`, `Attendance`, `Absence`, `Channel`/`ChannelMember`/`Message`, `Order.waiterId`, paiements et pourboires.

## Périmètre
- **Fiches** : profil RH lié au compte (poste, contrat, taux horaire FCFA, date d'embauche, contacts), documents non requis.
- **Planning** : semaine par poste, glisser pour créer/déplacer un créneau, copie de semaine, détection des chevauchements et des absences,
  publication (notification X1 aux concernés), vue « mon planning » sur mobile.
- **Pointage** : arrivée/départ/pause depuis son compte **ou** une tablette commune en mode kiosque avec code personnel (4–6 chiffres, haché,
  verrouillage après échecs) ; rattachement au créneau ; correction par un responsable (audit).
- **Absences/congés** : demande, validation, solde simple.
- **Performances** : par serveur et période — commandes, chiffre encaissé, ticket moyen, pourboires, annulations ; classement.
- **Récapitulatif de paie** : heures normales/supplémentaires (seuil hebdomadaire réglable, défaut 40 h), montant brut estimé, export CSV. Pas de bulletin.
- **Messagerie interne** : canaux (« Salle », « Cuisine », « Tous ») et messages directs, temps réel (`message.created`), non-lus, mentions.

## Critères d'acceptation
- [ ] Planning sans chevauchement, publication notifiée ; pointage kiosque sécurisé (code haché, verrouillage) et rattaché au bon créneau.
- [ ] Heures et heures sup. justes (tests unitaires sur semaines à cheval, fuseau) ; performances cohérentes avec les commandes/paiements.
- [ ] Messagerie en direct entre deux appareils (Playwright) ; un membre ne lit que ses canaux.
- [ ] e2e rôles + isolation + RLS ; captures planning, pointage tablette, messagerie mobile.

## Questions ouvertes (défaut retenu)
Seuil d'heures sup. → **40 h/semaine, réglable**. Pourboires → **affichés par serveur, pas de répartition automatique**.
