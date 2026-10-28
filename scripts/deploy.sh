#!/bin/sh
set -eu

# L'identité SSH et le fichier known_hosts sont fournis par le poste ou le runner.
: "${DEPLOY_KEY:?Chemin de la clé SSH requis}"
: "${DEPLOY_KNOWN_HOSTS:?Chemin du fichier known_hosts requis}"
: "${DEPLOY_ENV_FILE:?Chemin du fichier .env de production requis}"
test -s "$DEPLOY_KEY"
test -s "$DEPLOY_KNOWN_HOSTS"
test -s "$DEPLOY_ENV_FILE"
cd "$(dirname "$0")/.."

# Valider sans imprimer la configuration contenant les secrets.
docker compose --env-file "$DEPLOY_ENV_FILE" -f compose.prod.yml config --quiet

ssh -i "$DEPLOY_KEY" -p 2222 -o BatchMode=yes \
  -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$DEPLOY_KNOWN_HOSTS" \
  root@localhost 'mkdir -p /srv/flotte && chmod 700 /srv/flotte'
scp -i "$DEPLOY_KEY" -P 2222 -o BatchMode=yes \
  -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$DEPLOY_KNOWN_HOSTS" \
  compose.prod.yml root@localhost:/srv/flotte/compose.prod.yml
scp -i "$DEPLOY_KEY" -P 2222 -o BatchMode=yes \
  -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$DEPLOY_KNOWN_HOSTS" \
  "$DEPLOY_ENV_FILE" root@localhost:/srv/flotte/.env
ssh -i "$DEPLOY_KEY" -p 2222 -o BatchMode=yes \
  -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$DEPLOY_KNOWN_HOSTS" \
  root@localhost 'set -eu
    cd /srv/flotte
    chmod 600 .env
    docker compose -f compose.prod.yml config --quiet
    docker compose -f compose.prod.yml pull
    docker compose -f compose.prod.yml up -d --wait --wait-timeout 120
    docker compose -f compose.prod.yml ps'
