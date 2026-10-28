# Livraison de Pirates du Ping

La cible `vm-prod` est un serveur pédagogique Docker dans Docker, accessible
par SSH sur `localhost:2222`. Son moteur est indépendant de Docker Desktop.
Seul le front est accessible depuis le Mac sur http://localhost:3000.

## 1. Préparer la cible

Prérequis : Docker Desktop démarré, Docker Compose, SSH et un port 3000 libre.
Depuis la racine du dépôt, créer la clé seulement si elle n'existe pas :

```sh
test -f deploy_key || ssh-keygen -t ed25519 -f deploy_key -N '' -C flotte-deploy
docker compose -f compose.vm.yml up -d --build --wait
docker exec vm-prod sh -c 'printf "[localhost]:2222 "; cat /etc/ssh/ssh_host_ed25519_key.pub' > known_hosts
ssh -i deploy_key -p 2222 -o StrictHostKeyChecking=yes -o UserKnownHostsFile=known_hosts root@localhost 'docker info >/dev/null && docker compose version'
```

La clé serveur est obtenue directement depuis le conteneur local de confiance.
La clé privée `deploy_key`, `.env` et `known_hosts` sont ignorés par Git.

## 2. Configurer l'application

Copier `.env.example` en `.env` s'il n'existe pas encore. Renseigner le vrai
`GROUPE`, la couleur et un mot de passe de base. Ne pas écraser un `.env` existant.

Deux modes sont disponibles :

| Mode | Images dans `.env` | Politique |
| --- | --- | --- |
| Démonstration locale | `flotte-front:test`, `flotte-api:test`, `flotte-annexe:test` | `never` |
| Livraison depuis un registre | références publiées avec tag précis, ou `REGISTRY`, `GROUPE` et `TAG` | `always` |

`VERSION` apparaît dans les pulses ; si vide, elle reprend `TAG`.
Les images doivent être compatibles Linux ARM64 pour cette cible.
Pour un registre privé, connecter Docker au registre **dans vm-prod** avant
la livraison. Les identifiants du Mac ne sont pas transmis au moteur interne.

```sh
docker compose --env-file .env -f compose.prod.yml config --quiet
```

## 3. Construire et charger les images pour la démonstration locale

Avec les trois références `flotte-*:test` configurées dans `.env` :

```sh
docker compose --env-file .env -f compose.prod.yml build front api annexe
docker image save flotte-front:test flotte-api:test flotte-annexe:test | docker exec -i vm-prod docker image load
```

Le chargement est nécessaire : les images du Mac ne sont pas automatiquement
visibles dans la VM. Cette étape peut être remplacée par la publication des
images dans un registre par le membre du groupe chargé des images.

## 4. Livrer par SSH

```sh
DEPLOY_KEY="$PWD/deploy_key" \
DEPLOY_KNOWN_HOSTS="$PWD/known_hosts" \
DEPLOY_ENV_FILE="$PWD/.env" \
DEPLOY_PULL_POLICY=never sh scripts/deploy.sh
```

Pour des images publiées, remplacer `never` par `always` (valeur par défaut).
Le script valide la configuration, copie Compose et l'environnement, récupère
les images puis attend la santé des quatre services. Il ne construit rien sur
la cible. En mode `never`, seule l'image PostgreSQL est récupérée.

Un échec de téléchargement empêche le remplacement des services. Un échec
de santé fait échouer la livraison ; aucun retour automatique n'est prévu.
Pour revenir à une version précédente, remettre ses références d'images dans
l'environnement et relancer le script. Ne pas supprimer les volumes.

## 5. Vérifier et démontrer la persistance

```sh
curl --fail http://localhost:3000/sante
curl --fail http://localhost:3000/api/manche
curl --fail http://localhost:3000/annexe/api/historique
curl --fail http://localhost:3000/annexe/api/stats
```

La santé attendue est `{"statut":"ok","api":"ok","annexe":"ok"}`.
Ouvrir le front, enregistrer un buzz et un pavillon, puis relancer la livraison.
Vérifier que le buzz et le pavillon sont conservés. PostgreSQL utilise le
volume `flotte_postgres` et le pavillon `flotte_pavillon`.

```sh
docker compose -f compose.vm.yml restart vm-prod
docker compose -f compose.vm.yml ps
```

Après le redémarrage, attendre que la VM soit saine puis vérifier de nouveau
les routes. Pour arrêter la maquette, utiliser `docker compose -f compose.vm.yml stop`.
Ne pas utiliser `down -v`, qui supprime les volumes de la cible.

## 6. Finir GitHub Actions

Un administrateur du dépôt doit enregistrer un runner **macOS / ARM64** sur
le Mac, dans un dossier séparé, avec le label `flotte-deploy`. Le runner doit
avoir accès à Docker, SSH et au port local 2222. Le Mac doit rester allumé.

Créer les secrets Actions suivants dans les paramètres du dépôt :

- `DEPLOY_SSH_KEY` : contenu de `deploy_key`.
- `DEPLOY_KNOWN_HOSTS` : contenu de `known_hosts`.
- `PROD_ENV` : contenu complet du `.env` approprié au mode choisi.

Chaque push sur `main` construit les trois images Linux ARM64, les publie sur
GHCR sous `ghcr.io/<propriétaire>/<dépôt>-<service>:<sha>`, puis les déploie.
Le workflow remplace les références d'images, `TAG` et `VERSION` de `PROD_ENV`
par celles du commit livré. Le jeton GitHub du job permet de télécharger les
images privées ; son fichier d'identification sur la cible est nettoyé après
le déploiement. Aucun secret supplémentaire de registre n'est nécessaire.

Pour relancer la livraison du commit courant, ouvrir **Actions → Livraison
vers vm-prod → Run workflow** en laissant `image_tag` vide. Pour revenir en
arrière, y saisir le SHA complet d'un commit dont les trois images ont déjà
été publiées. Les images existantes sont alors déployées sans reconstruction.
Chronométrer cette opération et reporter la durée dans le carnet de la flotte.
Le workflow empêche deux livraisons simultanées. La vérification de santé
attend au maximum 30 secondes après le démarrage des services.

La livraison est complète quand le job GitHub est vert, les trois routes
répondent, les trois services apparaissent au tableau sous le vrai nom de
groupe et la persistance est démontrée après une nouvelle livraison.

## Diagnostic

```sh
docker compose -f compose.vm.yml logs --tail 80
docker exec vm-prod sh -c 'cd /srv/flotte && docker compose -f compose.prod.yml ps'
docker exec vm-prod sh -c 'cd /srv/flotte && docker compose -f compose.prod.yml logs --tail 80 front api annexe db'
```

Ne pas afficher ni partager la sortie de `docker compose config` sans
`--quiet` : elle contient les variables d'environnement, dont le mot de passe.
