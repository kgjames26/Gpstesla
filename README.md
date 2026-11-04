# VECTOR — PWA de navigation GPS

PWA statique en français, conçue pour un grand écran tactile et le navigateur Chromium embarqué. Interface sombre, carte vectorielle MapLibre, extrusions 3D OSM, position GPS, calcul de route routière, suivi de progression, consignes vocales, recherche d’adresse et mode installable.

## Déploiement Vercel

1. Importer `kgjames26/Gpstesla` dans Vercel.
2. Garder la configuration détectée depuis `vercel.json` : commande `npm run build`, sortie `dist`.
3. Déployer. Chaque push sur `main` déclenchera le déploiement si l’intégration Git Vercel est activée.
4. Ouvrir l’URL en HTTPS dans le navigateur Tesla et autoriser la localisation.

Le projet ne contient ni secret, ni clé d’API à configurer.

## Utilisation

- Le bouton de recherche permet de trouver une destination, puis de calculer un itinéraire.
- Le guidage GPS suit la progression, actualise distance/ETA et annonce la prochaine manœuvre lorsque le navigateur prend en charge la synthèse vocale.
- Les boutons `3D` et `NORD` changent la perspective ; le bouton de recentrage reprend la position GPS.
- L’état de charge est une estimation saisie manuellement et mémorisée dans le navigateur.
- La géolocalisation haute précision nécessite HTTPS et une autorisation du navigateur.

## Services et limites

- Carte et données cartographiques : OpenFreeMap / OpenStreetMap. La carte, ses tuiles et ses données de style sont chargées en ligne.
- Recherche d’adresse : Nominatim public.
- Routage : OSRM public avec profil voiture. Le profil ne connaît pas la motorisation Tesla, le trafic en direct, la charge batterie, les bornes réellement disponibles ni les préférences de recharge. L’itinéraire doit être vérifié avant de conduire.
- Les limites de vitesse, l’assistance de voie exacte, le capteur de force G, les données télématiques de la voiture et les POI de recharge enrichis ne sont pas fournis par ces API et ne sont pas simulés.
- La mémoire hors ligne concerne seulement l’interface. Les tuiles et les services de recherche/routage exigent une connexion. Les services publics sont soumis à leurs conditions, quotas et disponibilités ; pour une utilisation soutenue, configurer des fournisseurs dédiés.
- Le navigateur Tesla peut imposer ses propres restrictions au GPS, à l’audio, à l’installation PWA, au rendu WebGL et aux permissions en arrière-plan. Ces fonctions dépendent du véhicule et de la version logicielle.

## Structure

```text
index.html
public/
  icons/tesla-nav.svg
  manifest.json
  service-worker.js
src/
  app.js
  styles.css
vercel.json
package.json
scripts/build.mjs
```
