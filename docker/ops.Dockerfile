# syntax=docker/dockerfile:1.7
# Image d'exploitation : sauvegarde / restauration PostgreSQL. Même version majeure que le serveur (pg_dump ne lit pas un serveur plus récent).
# Contexte : la racine du dépôt.  docker build -f docker/ops.Dockerfile -t restaurant-ops .
FROM postgres:16-bookworm
# hadolint ignore=DL3008
RUN apt-get update && apt-get install -y --no-install-recommends age curl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /backups && chown postgres:postgres /backups
COPY scripts/ops/ /ops/
RUN chmod 0755 /ops/*.sh
USER postgres
ENV BACKUP_DIR=/backups
ENTRYPOINT []
CMD ["/ops/backup-scheduler.sh"]
