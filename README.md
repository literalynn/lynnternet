# Lynnternet Dashboard

## Objectif
Ce projet propose un tableau de bord pour visualiser l'état et les informations de plusieurs serveurs.

## Stack
- **Frontend** : HTML, CSS et JavaScript
- **Serveur** : Nginx

## Installation
1. Cloner le dépôt :
   ```bash
   git clone https://example.com/lynnternet.git
   cd lynnternet
   ```
2. Construire l'image Docker :
   ```bash
   docker build -t lynnternet .
   ```

## Usage
Lancer le conteneur :
```bash
 docker run -p 8080:80 lynnternet
```
Le tableau de bord est ensuite accessible sur http://localhost:8080.

## Licence
Ce projet est distribué sous licence MIT.
