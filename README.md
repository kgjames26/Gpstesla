# VECTOR — PWA de navigation GPS

PWA pour grand écran tactile et navigateur Chromium embarqué. L’interface reste sombre, mais la carte vectorielle par défaut utilise le style clair Bright pour rendre les routes et les intersections lisibles. Le fond satellite est disponible à la demande.

## Déploiement Vercel

1. Importer `kgjames26/Gpstesla` dans Vercel.
2. Utiliser la commande `npm run build` et le dossier de sortie `dist` définis dans `vercel.json`.
3. Si l’intégration Git Vercel est reliée à ce dépôt, chaque push sur `main` déclenche un nouveau déploiement.
4. Ouvrir le site en HTTPS dans le navigateur Tesla et autoriser la localisation.

## Navigation

- `3D` active la caméra inclinée en poursuite ; `NORD` rétablit la vue de dessus.
- La caméra suit le cap GPS avec transition adoucie. Elle recule au-dessus de 70 km/h et zoome à basse vitesse ou à l’approche d’une manœuvre lente.
- `SAT` affiche l’imagerie World Imagery ; `MAP` revient au fond vectoriel clair.
- Le tracé combine un contour contrasté, un ruban turquoise et des chevrons directionnels.
- OSRM calcule en profil automobile à partir du réseau OpenStreetMap. Les sens uniques et restrictions présents dans les données sont pris en compte par le profil voiture ; l’application vérifie aussi les drapeaux `entry`/`out` des intersections et bloque un tracé si la sortie sélectionnée est déclarée restreinte. Une erreur ou une donnée OSM manquante reste possible.
- L’état de charge est saisi manuellement et mémorisé dans le navigateur. La synthèse vocale dépend des capacités du navigateur.

## Données, attribution et limites

- Fond vectoriel et empreintes de bâtiments : OpenFreeMap / OpenStreetMap.
- Imagerie satellite : Esri World Imagery, créditant Esri, Vantor, Earthstar Geographics et GIS User Community. La disponibilité et la résolution varient selon le lieu.
- Les empreintes OSM sont extrudées au-dessus du fond. Les toits et façades restent stylisés : cette version ne projette pas les pixels satellite sur les surfaces 3D et n’ajoute pas de shader SSAO.
- Le véhicule visible en poursuite est une illustration SVG en perspective, pas un modèle 3D glTF.
- Le ruban lumineux est un motif vectoriel posé sur l’itinéraire, pas une projection AR réelle. L’imagerie satellite fournit la texture routière visible, selon la résolution locale.
- OSRM public n’apporte ni trafic temps réel, ni profil Tesla, ni état de batterie, ni planification de recharge. Les limites de vitesse et les données de voies fiables ne sont pas intégrées.
- Seule l’interface est mise en cache hors ligne ; cartes, géocodage et routage nécessitent une connexion. Les services publics peuvent appliquer leurs propres quotas et conditions.
- L’accès GPS, l’audio, WebGL et l’installation PWA dépendent des permissions et capacités du navigateur Tesla.

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
scripts/build.mjs
package.json
vercel.json
```
