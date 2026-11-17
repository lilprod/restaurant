# Déploiement en production

Solution **générique et portable** : Docker Compose sur une machine Linux (VPS, serveur dédié ou local). Rien n'est propre à un hébergeur, à un stockage objet
ni à un fournisseur d'email / SMS : tout se règle par variables d'environnement (`.env`). Aucun secret n'est dans le dépôt.

## 1. Vue d'ensemble

```
Internet ──TLS──> [terminateur TLS : Caddy, Traefik, nginx hôte, répartiteur du fournisseur…]
                       │ http://127.0.0.1:8080  (X-Forwarded-For / X-Forwarded-Proto)
                       ▼
     ┌───────────── réseau « edge » ─────────────┐
     │  web (nginx)  ──/api, /uploads, /socket.io──>  api (NestJS)  ──> e-mail / SMS / S3 (sorties Internet)
     └───────────────────────────────────────────┘          │
     ┌───────────── réseau « backend » (interne : aucune sortie, aucun port publié) ─────────────┐
     │  postgres 16 · redis 7 · migrate (job) · backup (pg_dump chiffré)                          │
     └────────────────────────────────────────────────────────────────────────────────────────────┘
```
Seul `web` publie un port (`127.0.0.1:8080` par défaut). Le navigateur ne parle qu'à **une seule origine** : nginx sert le site et relaie `/api`, `/uploads` et
`/socket.io` (WebSocket) vers l'API. C'est nécessaire : le cookie de session est `SameSite=Strict` (il n'est envoyé que sur le même site) ; une API sur un autre
site casserait la session. Il n'y a donc **aucun CORS à ouvrir**.

| Service | Image | Rôle |
|---|---|---|
| `postgres` | `postgres:16-alpine` | Base (volume `pgdata`) |
| `redis` | `redis:7-alpine` | File des notifications BullMQ (volume `redisdata`, AOF, mot de passe) |
| `migrate` | `docker/api.Dockerfile` cible `tools` | Job : rôles SQL, migrations, droits, `rls.sql`, seed. Rejoué à chaque `up` |
| `api` | `docker/api.Dockerfile` cible `runtime` | NestJS, utilisateur non root, `HEALTHCHECK` sur `/api/v1/health` |
| `web` | `docker/web.Dockerfile` | Build Vite + nginx non privilégié (port 8080) |
| `backup` | `docker/ops.Dockerfile` | Sauvegarde chiffrée quotidienne, rotation, copie hors site |

## 2. Prérequis

- Machine Linux 64 bits, **2 vCPU / 2 Go de RAM / 20 Go** de disque pour démarrer ; Docker Engine ≥ 24 et Docker Compose v2.
- Un **nom de domaine** (`monapp.com`) dont vous gérez le DNS :
  - `app.monapp.com` (ou le domaine nu) → adresse de la machine : accueil, inscription, SuperAdmin (`/admin`) ;
  - **DNS joker** `*.monapp.com` → même adresse : un restaurant = un sous-domaine (`chez-kofi.monapp.com`). Sans joker, les restaurants restent accessibles par `app.monapp.com/r/chez-kofi`.
- Un **certificat** couvrant `monapp.com` et `*.monapp.com`. Un joker exige la validation DNS-01 (liée à votre fournisseur DNS : Caddy avec le module DNS, Traefik,
  certbot `--dns-…`, ou le TLS géré par un CDN / répartiteur de charge). Le terminateur TLS relaie ensuite en HTTP vers `127.0.0.1:8080`.
- Un compte **SMTP** pour les emails (obligatoire : voir §5).

Exemple Caddy (certificat joker via un module DNS ; adaptez le fournisseur) :
```caddyfile
*.monapp.com, monapp.com, app.monapp.com {
  tls { dns <fournisseur> {env.DNS_API_TOKEN} }
  reverse_proxy 127.0.0.1:8080
}
```
Caddy pose `X-Forwarded-For` / `X-Forwarded-Proto` ; avec lui, **`TRUST_PROXY=2`** (voir §4).

## 3. Première mise en service

```bash
git clone <dépôt> /opt/restaurant && cd /opt/restaurant
cp .env.prod.example .env && chmod 600 .env
#  Remplir .env (§4). Générer chaque secret :  openssl rand -hex 24
docker compose -f docker-compose.prod.yml --env-file .env up -d --build
docker compose -f docker-compose.prod.yml --env-file .env ps          # tout « healthy » ; migrate « Exited (0) »
BASE_URL=http://127.0.0.1:8080 SMOKE_SUPERADMIN_EMAIL=… SMOKE_SUPERADMIN_PASSWORD=… bash scripts/deploy/smoke.sh
```
`up` enchaîne : PostgreSQL prêt → `migrate` (crée les rôles, applique les migrations, les droits, `rls.sql`, crée le SuperAdmin et les plans s'ils n'existent pas, puis
**vérifie** que le rôle applicatif n'est pas privilégié et que la RLS est active) → `api` → `web` ; `backup` fait une première sauvegarde tout de suite.
Ensuite : connectez-vous sur `https://app.monapp.com/admin` avec `SEED_SUPERADMIN_EMAIL`, **changez le mot de passe**, créez un restaurant.
`SEED_SUPERADMIN_PASSWORD` ne sert qu'à créer le premier compte (ignoré ensuite), mais le compose l'exige à chaque `up` : laissez-le dans `.env`.

## 4. Variables d'environnement (`.env`, modèle : `.env.prod.example`)

| Variable | Rôle |
|---|---|
| `APP_DOMAIN` | Domaine racine des restaurants. **Figé dans le JavaScript au build** : le changer exige `docker compose build web` (l'image web est propre à un domaine). |
| `APP_URL` | Adresse principale du site (liens des emails : mot de passe oublié, suivi, licence). |
| `PUBLIC_API_URL` | Origine qui sert `/uploads` : les URL des logos / photos sont enregistrées **en absolu** avec cette valeur. Prenez l'adresse principale (`https://app.monapp.com`). La CSP l'autorise pour les images. Ne la changez pas après coup sans migrer les URL déjà enregistrées. |
| `CORS_ORIGIN` | Inutile (même origine) ; défaut `APP_URL`. |
| `TRUST_PROXY` | Nombre **réel** de proxys devant l'API : `1` = seulement le nginx du conteneur `web` (exposé directement) ; `2` = + un terminateur TLS / répartiteur devant lui. Trop bas : toutes les requêtes semblent venir du proxy (limitation de débit commune) ; trop haut : un client peut falsifier son IP et contourner la limitation de débit. |
| `WEB_BIND` / `WEB_PORT` | Interface et port publiés par `web` (défaut `127.0.0.1:8080`). |
| `COOKIE_SECURE` | `on` (défaut) : cookie de session réservé à HTTPS. Mettre `off` seulement pour un essai en HTTP. |
| `SWAGGER` | `off` (défaut) : `/api/docs` fermé. |
| `PG_ADMIN_PASSWORD` | Compte d'administration PostgreSQL : création des rôles, sauvegardes. **Jamais utilisé par l'API.** |
| `DB_OWNER_PASSWORD` | Rôle propriétaire des tables, exécute les migrations. |
| `DB_APP_PASSWORD` | Rôle `restaurant_app` utilisé par l'API. |
| `REDIS_PASSWORD` | Mot de passe Redis. |
| `JWT_ACCESS_SECRET`, `DATA_ENCRYPTION_KEY`, `TRACKING_TOKEN_SECRET` | Trois secrets **différents**, 32 caractères minimum (l'API refuse de démarrer sinon). `DATA_ENCRYPTION_KEY` chiffre les secrets 2FA : **sauvegardez-la**, la perdre rend les 2FA illisibles. Changer `TRACKING_TOKEN_SECRET` invalide les liens de suivi imprimés. |
| `SEED_SUPERADMIN_EMAIL`, `SEED_SUPERADMIN_PASSWORD` | Premier compte SuperAdmin (créé si aucun compte plateforme n'existe). |
| `MAIL_DRIVER`, `SMTP_URL`, `MAIL_FROM` | Email (§5). |
| `SMS_DRIVER`, `SMS_*`, `TWILIO_*` | SMS : `log` (rien n'est envoyé), `twilio` ou `http` (agrégateur générique). |
| `STORAGE_DRIVER`, `S3_*` | Fichiers (§6). |
| `BACKUP_*` | Sauvegardes (§8). |
| `APP_VERSION` | Étiquette des images (retour arrière, §9). |

Les mots de passe de base n'acceptent que `[A-Za-z0-9._~-]`, 16 caractères minimum (ils entrent dans une URL) : `openssl rand -hex 24` convient.
Une variable laissée vide équivaut à une variable absente.

### Pourquoi l'API ne tourne PAS avec le compte administrateur
PostgreSQL **n'applique jamais** la Row Level Security aux superusers ni aux rôles `BYPASSRLS`. Une API connectée avec le compte administrateur ignorerait donc
l'isolation entre restaurants : un oubli de filtre dans le code suffirait à exposer les données d'un restaurant à un autre. Le déploiement sépare trois rôles :

| Rôle | Privilèges | Sert à |
|---|---|---|
| `postgres` (`PG_ADMIN_USER`) | superuser | créer les rôles / la base, sauvegarder. Jamais dans l'API. |
| `restaurant_owner` | propriétaire des tables, ni superuser ni `BYPASSRLS` ; `app.bypass_rls=on` au niveau du rôle | migrations de schéma et de données |
| `restaurant_app` | `SELECT/INSERT/UPDATE/DELETE` + séquences ; ni superuser ni `BYPASSRLS` ; pas de DDL ; pas d'accès à `_prisma_migrations` | l'API. La RLS s'applique. |

`scripts/deploy/migrate.sh` crée ces rôles, donne les droits (`GRANT` + `ALTER DEFAULT PRIVILEGES` pour les tables des futures migrations), rejoue `prisma/sql/rls.sql`
à chaque déploiement et **échoue** si le rôle applicatif est privilégié ou si le nombre de tables sous RLS est inférieur à celui de `rls.sql`. L'API refuse en plus de démarrer
en production avec un rôle superuser / `BYPASSRLS` (dérogation explicite : `ALLOW_PRIVILEGED_DB=on`, à éviter).

## 5. Email, SMS

- **Email** : `MAIL_DRIVER=smtp` et `SMTP_URL=smtp://utilisateur:motdepasse@hote:587` (Brevo, Mailjet, Amazon SES, Gmail SMTP, votre serveur…). `MAIL_FROM` doit être une adresse
  autorisée chez le fournisseur (SPF / DKIM). **En production, l'API refuse de démarrer avec `MAIL_DRIVER=log`** (les emails ne partiraient jamais : mots de passe oubliés,
  rappels de licence). Dérogation explicite : `ALLOW_MAIL_LOG=on`.
- **SMS** : `SMS_DRIVER=log` (défaut : journalisé, rien n'est envoyé), `twilio` ou `http` (voir `.env.example`). Le choix du fournisseur reste au propriétaire.
- La file d'envoi est **BullMQ sur Redis** (`NOTIFICATIONS_QUEUE=bullmq`, imposé par le compose) : 5 tentatives à intervalle croissant, reprises après un redémarrage.

## 6. Fichiers téléversés (logos, photos, avatars)

- `STORAGE_DRIVER=disk` (défaut) : volume Docker `uploads` monté sur `/data/uploads`. Simple ; à sauvegarder séparément (`scripts/ops/restore.md` §3).
- `STORAGE_DRIVER=s3` : tout service compatible S3 (AWS S3, Cloudflare R2, MinIO, Scaleway, OVH, Backblaze…). Variables : `S3_BUCKET`, `S3_REGION` (`auto` pour R2),
  `S3_ENDPOINT` (vide pour AWS), `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` (défaut : `on` si `S3_ENDPOINT`).
  - **Bucket privé** (défaut, recommandé) : l'API relaie `/uploads/*` avec les mêmes en-têtes qu'avec le disque (cache d'un an, `nosniff`, `Content-Security-Policy: sandbox`).
  - **Bucket public / CDN** : `S3_PUBLIC_URL=https://cdn.monapp.com` ; les URL pointent directement vers lui et la CSP du site l'autorise pour les images.
  Mêmes garanties dans les deux modes : type vérifié sur le **contenu** (signature binaire), nom aléatoire, remplacement = suppression de l'ancien fichier.
  Migrer du disque vers S3 : copier `UPLOAD_DIR` dans le bucket (mêmes clés `tenants/…`) ; les URL déjà enregistrées (`PUBLIC_API_URL/uploads/…`) continuent de fonctionner tant que l'API relaie.

## 6 bis. PWA et hors ligne (X5)

Le site est une PWA (manifeste `/manifest.webmanifest`, icônes `/icons/*`, service worker `/sw.js`, tous du même domaine : la CSP `script-src 'self'` / `worker-src 'self'` suffit).
nginx sert `sw.js` et le manifeste en `Cache-Control: no-cache` (un déploiement est vu tout de suite ; l'utilisateur est invité à recharger, jamais forcé) et `application/manifest+json`.
**Le service worker ne met en cache que des fichiers statiques** (shell de l'application, polices de base, images de la carte `/uploads/*`) : jamais `/api/*` (donc ni les routes d'authentification
ni le cookie de rafraîchissement), ni `/socket.io`, ni une requête portant `Authorization`. La carte, les tables et la file de commandes hors ligne vivent dans IndexedDB (une base par restaurant),
vidée à la déconnexion. Les ports série / USB des imprimantes thermiques exigent un contexte sécurisé (HTTPS) et Chrome ou Edge.

## 7. En-têtes de sécurité et journaux

nginx (`docker/nginx/`) pose sur le site : `Content-Security-Policy` (`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: <PUBLIC_API_URL>;
connect-src 'self' <hôte> wss://<hôte> <PUBLIC_API_URL>; font-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`), `Permissions-Policy: camera=(), microphone=(), geolocation=()`,
`Referrer-Policy: strict-origin-when-cross-origin`, `X-Content-Type-Options`, `X-Frame-Options: DENY`, et **HSTS** quand la requête d'origine était en HTTPS (`X-Forwarded-Proto: https`).
La CSP a été éprouvée dans un navigateur réel : 22 écrans restaurant, 10 écrans plateforme, ticket avec QR (`data:`), logo servi par `PUBLIC_API_URL`, temps réel WebSocket,
polices Geist : aucune violation. Le seul changement côté site : le script d'initialisation du thème est un fichier (`/theme-init.js`) et non plus un script en ligne,
et les polices ne sont jamais incorporées en `data:` (`vite.config.ts`).
Pas de cartes de sources (`.map`) dans l'image web.

Journaux : une ligne JSON par événement sur la sortie standard (`docker compose logs api`), avec `requestId` (le même que l'en-tête `X-Request-Id` et que la ligne nginx).
Les jetons de suivi des commandes (`/tracking/<jeton>`) sont masqués dans les journaux nginx et API ; ni corps ni chaîne de requête n'y figurent.
Rotation : 5 fichiers de 20 Mo par conteneur (`json-file`). Pour un collecteur central (Loki, ELK, fournisseur), changez le `logging.driver`.

## 8. Sauvegardes et supervision

- **Sauvegarde automatique** : le service `backup` exécute `scripts/ops/backup.sh` chaque jour à `BACKUP_AT` (UTC, 02:30) et au premier démarrage : `pg_dump` (format custom compressé,
  cohérent, sans propriétaires) → **chiffrement** → `daily/` ; copie le dimanche dans `weekly/`, le 1er du mois dans `monthly/` ; garde **7 quotidiennes, 4 hebdomadaires, 6 mensuelles**.
  Chaque fichier a sa somme SHA-256 et un manifeste (migrations, politiques RLS, lignes par table).
- **Chiffrement** : `BACKUP_PASSPHRASE` (AES-256, PBKDF2) ou, mieux, `BACKUP_AGE_RECIPIENT=age1…` (clé publique : la clé privée n'est jamais sur le serveur). **Conservez la clé hors du serveur** :
  sans elle, aucune restauration n'est possible, et un serveur perdu emporte `.env`.
- **Copie hors site** (conseillée : une sauvegarde sur la machine qu'elle protège ne couvre pas la perte de la machine) : `BACKUP_S3_BUCKET`, `BACKUP_S3_ENDPOINT`, `BACKUP_S3_REGION`,
  `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` (n'importe quel S3, autre fournisseur que le stockage des fichiers de préférence). La rétention distante se règle par une règle de cycle de vie du bucket.
- **Restauration** : `scripts/ops/restore.md` (vérification mensuelle conseillée ; la restauration réelle a été démontrée, voir le rapport X4). Test automatique : `scripts/ops/test-backup-restore.sh`.
- **Supervision minimale** : `HEALTHCHECK` de chaque conteneur (`docker compose ps`), `restart: unless-stopped`, et `scripts/ops/check.sh` (santé via nginx, conteneurs, âge de la dernière sauvegarde,
  disque) à lancer toutes les 5 minutes par cron ; avec `ALERT_WEBHOOK_URL` (Slack, Mattermost, Discord), il alerte au premier problème. Complétez par un moniteur externe
  (UptimeRobot, Better Stack…) sur `https://app.monapp.com/api/v1/health` : il vérifie aussi le certificat et la machine elle-même.

## 9. Mise à jour et retour arrière

```bash
cd /opt/restaurant
docker compose -f docker-compose.prod.yml --env-file .env exec backup /ops/backup.sh      # sauvegarde juste avant
git pull
APP_VERSION=$(git rev-parse --short HEAD) docker compose -f docker-compose.prod.yml --env-file .env up -d --build
bash scripts/deploy/smoke.sh
```
`up -d --build` reconstruit les images, rejoue `migrate` (migrations + droits + RLS, idempotent) puis recrée `api` et `web` (coupure de quelques secondes).
**Retour arrière** : redéployer l'étiquette précédente (images conservées localement) :
`APP_VERSION=<ancienne> docker compose -f docker-compose.prod.yml --env-file .env up -d --no-build`. Les migrations Prisma ne reviennent pas en arrière : si la nouvelle version a modifié le schéma,
l'ancien code peut ne plus s'accorder à la base ; dans ce cas restaurez la sauvegarde prise juste avant la mise à jour (`scripts/ops/restore.md` §2).

## 10. Dépannage

| Symptôme | Cause probable |
|---|---|
| `migrate` échoue : « Mot de passe de base : 16 caractères minimum… » | Mot de passe trop court ou avec un caractère spécial : `openssl rand -hex 24`. |
| `api` redémarre en boucle : « Configuration invalide… » | Le message nomme la variable (secret trop court, `MAIL_DRIVER=log`, S3 incomplet…). `docker compose logs api`. |
| `api` : « le rôle SQL … est superuser » | `DATABASE_URL` pointe un compte privilégié. Le compose utilise `restaurant_app` ; ne le surchargez pas. |
| Connexion impossible derrière HTTPS | `COOKIE_SECURE=on` exige HTTPS de bout en bout côté navigateur ; vérifiez que le terminateur envoie `X-Forwarded-Proto: https`. |
| « Trop de tentatives » pour tout le monde | `TRUST_PROXY` trop bas (toutes les IP = celle du proxy). |
| Logos cassés | `PUBLIC_API_URL` ne correspond pas à l'adresse servant `/uploads`, ou `S3_PUBLIC_URL` inaccessible. |
| Sous-domaine d'un restaurant : page « introuvable » | DNS joker absent, ou `APP_DOMAIN` modifié sans `docker compose build web`. |

## 11. Choix qui restent au propriétaire

| Sujet | Défaut retenu | À décider |
|---|---|---|
| Hébergeur | Docker Compose sur un VPS (agnostique) | OVH, Hetzner, Scaleway, Fly.io, serveur local… (Kubernetes / PaaS gérés : hors périmètre) |
| Domaine, DNS, TLS joker | Terminateur TLS externe en HTTP vers `127.0.0.1:8080` | Fournisseur DNS, Caddy / Traefik / CDN, qui renouvelle le certificat |
| Stockage des fichiers | `disk` (volume) | Bucket S3 / R2 / MinIO, privé ou public / CDN |
| Fournisseur email | SMTP générique | Brevo, SES, Mailjet… (+ SPF / DKIM du domaine d'envoi) |
| Fournisseur SMS | `log` (aucun envoi) | Twilio ou agrégateur local HTTP (Togo) |
| Sauvegardes | Disque local chiffré, rotation 7 / 4 / 6 | Cible hors site, passphrase ou clé age, fréquence, test de restauration planifié |
| Supervision | `check.sh` + `HEALTHCHECK` | Moniteur externe, canal d'alerte (webhook), collecteur de journaux |
| Images | Construites sur le serveur (`--build`) | Registre (GHCR…) et déploiement automatique depuis la CI |

## 12. Limites connues

- L'image `web` dépend du domaine (`VITE_ROOT_DOMAIN` est lu à la compilation) ; un registre d'images exige une image par domaine.
- Une seule machine : pas de haute disponibilité. `backup` + `restore.md` couvrent la reprise après sinistre, pas la continuité de service.
- Les fichiers du pilote `disk` ne sont pas inclus dans `pg_dump`.
- Le pilote SMS `log` reste accepté en production (seul l'email est bloqué).
