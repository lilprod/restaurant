# Restaurer une sauvegarde PostgreSQL

Procédure **testée** (restauration réelle d'une sauvegarde de la pile `docker-compose.prod.yml`, puis connexion SuperAdmin et restaurant). Les commandes
supposent la racine du dépôt sur le serveur et un `.env` rempli. Abréviation : `DC="docker compose -f docker-compose.prod.yml --env-file .env"`.

## 0. Ce qu'il faut avoir
- Le **fichier de sauvegarde** (`restaurant-AAAAMMJJThhmmssZ.dump.enc` ou `.age`) et ses compagnons `.sha256` et `.manifest`. Ils sont dans le volume `backups`
  (`$DC run --rm --no-deps backup ls /backups/daily`) et, si configurée, dans la copie hors site (`BACKUP_S3_BUCKET`).
- La **clé de déchiffrement** : `BACKUP_PASSPHRASE` (déjà dans `.env`) ou, pour un fichier `.age`, la clé privée age (conservée hors du serveur).
  Sans elle, la sauvegarde est illisible : conservez-la dans un gestionnaire de mots de passe, à part.

## 1. Vérifier sans rien toucher (recommandé chaque mois)
Restaure dans une base temporaire et compare au manifeste (migrations, politiques RLS, nombre de lignes de chaque table). La production n'est pas touchée.
```bash
$DC run --rm --no-deps -e VERIFY_STRICT=1 backup /ops/restore.sh /backups/daily/<fichier> restaurant_verif
$DC exec postgres psql -U "${PG_ADMIN_USER:-postgres}" -c "DROP DATABASE restaurant_verif"      # nettoyage
```
Sortie attendue : `✔ Restauration vérifiée` (code 0). Un écart ou une base incohérente donne `✘ … NON conforme` (code 3). `VERIFY_STRICT=1` refuse tout écart de
comptage : à n'utiliser que si la sauvegarde a été faite hors activité ; sinon laissez la valeur par défaut (les écarts sont signalés mais tolérés).
Fichier `.age` : ajoutez `-v /chemin/cle.age:/age.key:ro -e BACKUP_AGE_IDENTITY_FILE=/age.key`.

## 2. Remplacer la base de production (sinistre ou retour arrière)
```bash
# a. Arrêter l'application (plus aucune connexion à la base) ; PostgreSQL et Redis restent démarrés
$DC stop web api backup

# b. Restaurer dans une base neuve, propriétaire = rôle propriétaire des tables
$DC run --rm --no-deps -e RESTORE_OWNER="${DB_OWNER_USER:-restaurant_owner}" backup /ops/restore.sh /backups/daily/<fichier> restaurant_restore

# c. Permuter : l'ancienne base est conservée (restaurant_old) jusqu'à vérification
$DC exec postgres psql -U "${PG_ADMIN_USER:-postgres}" \
  -c "ALTER DATABASE restaurant RENAME TO restaurant_old" \
  -c "ALTER DATABASE restaurant_restore RENAME TO restaurant"

# d. Réappliquer droits du rôle applicatif, rls.sql et migrations éventuellement postérieures à la sauvegarde (idempotent), puis redémarrer
$DC run --rm migrate
$DC up -d
bash scripts/deploy/smoke.sh        # santé, en-têtes, connexion SuperAdmin

# e. Après contrôle fonctionnel (connexion d'un restaurant, une commande) : supprimer l'ancienne base
$DC exec postgres psql -U "${PG_ADMIN_USER:-postgres}" -c "DROP DATABASE restaurant_old"
```
Si la base s'appelle autrement (`DB_NAME`), remplacez `restaurant` ci-dessus. Si l'étape b échoue, rien n'a été permuté : la production reste intacte (arrêtée),
relancez `$DC up -d` ; la base `restaurant_restore` partielle se supprime avec `DROP DATABASE`.

## 3. Ce qui n'est PAS dans la sauvegarde
- Les **fichiers téléversés** (logos, photos) : volume `uploads` (pilote `disk`) ou bucket (pilote `s3`). Sauvegardez-les séparément :
  `docker run --rm -v restaurant_uploads:/d -v "$PWD":/o alpine tar czf /o/uploads.tgz -C /d .` (disque) ou la réplication / le versionnage du bucket.
- Les **files Redis** (envois en attente) : volatiles, reprises seulement si le volume `redisdata` survit.
- Les **secrets** (`.env`) : à conserver à part. `DATA_ENCRYPTION_KEY` perdue = secrets 2FA illisibles (les utilisateurs devront réactiver la 2FA).

## 4. Ce que vérifie `restore.sh`
Somme SHA-256 du fichier ; refus d'une cible non vide (jamais de suppression automatique) ; déchiffrement ; `pg_restore --exit-on-error` ; migrations toutes achevées ;
contraintes validées et clés étrangères sans orphelin ; tables sous RLS forcée ; comparaison au manifeste (migrations, politiques, lignes par table).
Test automatique : `PGDATABASE=<base> bash scripts/ops/test-backup-restore.sh` (aussi exécuté en CI).
