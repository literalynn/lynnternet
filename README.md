# Lynnternet Dashboard

## Présentation
Lynnternet Dashboard est un site web de supervision qui offre une vue d'ensemble de plusieurs serveurs.
Il affiche en temps réel l'état de connexion, la charge CPU, la mémoire, le réseau et l'espace disque de chaque machine.

## Prérequis
- Docker installé sur la machine de déploiement
- Un navigateur moderne pour consulter le tableau de bord

## Déploiement
1. Cloner le dépôt :
   ```bash
   git clone https://example.com/lynnternet.git
   cd lynnternet
   ```
2. Construire l'image Docker :
   ```bash
   docker build -t lynnternet .
   ```
3. Lancer le conteneur :
   ```bash
   docker run -p 8080:80 lynnternet
   ```
Le site est ensuite accessible sur [http://localhost:8080](http://localhost:8080).

## Structure du projet
- `index.html` : page principale du tableau de bord
- `panels.html` : affichage des panneaux de statut
- `info.html`, `tuto.html` : pages d'informations complémentaires
- `nav.html`, `footer.html` : fragments HTML inclus dynamiquement
- `main.js` : gestion de l'interface et du contenu
- `multiServer.js` : collecte et mise à jour des statistiques des serveurs
- `style.css` : styles globaux
- `nginx.conf` : configuration du serveur Nginx
- `Dockerfile` : construction de l'image de déploiement

## Commandes utiles
- Construire l'image : `docker build -t lynnternet .`
- Lancer le conteneur : `docker run -p 8080:80 lynnternet`
- Arrêter le conteneur : `docker stop <id>`
- Consulter les logs : `docker logs <id>`

## Stack
- **Frontend** : HTML, CSS et JavaScript
- **Serveur** : Nginx

## Licence
Ce projet est distribué sous licence MIT.

