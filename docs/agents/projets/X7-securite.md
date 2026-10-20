# X7 — Durcissement de la sécurité et RGPD

> **Type** API + web · **Dépend de** — (idéalement après X4) · **Taille** M · **Modèle** `opus`

## Périmètre
- **Jetons** : refresh token en cookie `HttpOnly; Secure; SameSite=Strict`, chemin restreint aux routes d'authentification, jeton d'accès en mémoire ;
  protection CSRF adaptée ; migration douce des sessions existantes (web et futur mobile, qui garde le stockage sécurisé natif).
- **CSP** stricte pour le web (nginx), `Permissions-Policy`, `Referrer-Policy` ; revue des en-têtes Helmet de l'API.
- **Test anti-IDOR automatisé** : parcourt toutes les routes `/tenant/*` déclarées (introspection des contrôleurs) avec des identifiants appartenant à un
  autre restaurant → aucune réponse 2xx. Même chose rôle par rôle (matrice rôles × routes générée et comparée à la documentation).
- **Audit des dépendances** (`pnpm audit`) en CI, mise à jour des vulnérabilités hautes.
- **RGPD** : registre des données, durées de conservation (journaux de connexion, notifications) avec purge planifiée, export/suppression pour le personnel.
- **Journal d'audit consultable** par l'administrateur du restaurant (filtrable) et le SuperAdmin.
- Exécuter le skill `security-review` sur l'ensemble et traiter les constats.

## Critères d'acceptation
- [ ] Plus aucun refresh token lisible en JavaScript côté web ; parcours de connexion, rafraîchissement, déconnexion, 2FA inchangés pour l'utilisateur.
- [ ] Test anti-IDOR et matrice des rôles verts et intégrés à la CI.
- [ ] Purges planifiées actives et documentées.
