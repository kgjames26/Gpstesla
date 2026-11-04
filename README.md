# VECTOR — Navigation GPS PWA

Application Web progressive, pensée pour un grand écran tactile et Chromium embarqué. Interface française, pilotable au toucher, sans compte ni clés API côté client.

## Fonctions

- Carte MapLibre avec styles vectoriels jour et nuit, bâtiments OpenStreetMap extrudés en 3D et routes nocturnes éclaircies par catégorie.
- Fond SAT indépendant du thème : imagerie World Imagery sous les routes, libellés et extrusions de bâtiments OSM.
- Centrage automatique sur la première position GPS, repère véhicule vectoriel orienté à plat, vues poursuite 3D, nord 2D et globale.
- Caméra de poursuite lissée, recul à vitesse élevée et zoom plus proche à faible vitesse ou avant une manœuvre.
- Recherche Nominatim, départ GPS ou adresse, étapes intermédiaires, itinéraire automobile OSRM avec étapes vocales et contrôle des sorties interdites signalées dans les données.
- Distance, durée, ETA, progression, vitesse, cap, altitude, précision GPS, force G calculée depuis le GPS et état de charge saisi manuellement.
- Alertes OSM de radars fixes, feux de contrôle et dangers routiers, affichées en point ou en zone selon le pays détecté. Cache IndexedDB pour les zones consultées. Bips pendant le guidage.
- Bornes de recharge OSM affichées sur le trajet quand elles sont présentes dans la cellule Overpass consultée, avec puissance quand renseignée.
- Paramètres Jour / Nuit / Automatique mémorisés localement. Automatique suit la préférence de thème du système. Le choix MAP / SAT reste séparé.
- PWA installable ; shell de l’interface disponible hors ligne et écran maintenu actif pendant le guidage si le navigateur prend en charge Screen Wake Lock.

## Déploiement Vercel

Le dépôt est prêt pour l’intégration Git Vercel :

1. Projet Vercel relié à `kgjames26/Gpstesla`.
2. Build : `npm run build`.
3. Sortie statique : `dist`.
4. Le dossier `api/` publie la fonction serverless `/api/safety-zones`.
5. Chaque push sur `main` déclenche un déploiement si l’intégration Git est active.

## Sources et vie privée

- Carte et bâtiments : OpenFreeMap / OpenStreetMap.
- Images satellite : service World Imagery d’Esri.
- Recherche et détection de pays : Nominatim.
- Calcul de trajet : service OSRM public.
- Contrôles, dangers et bornes : Overpass, avec une emprise arrondie de 0,2° côté serveur. Les résultats sont conservés six heures dans IndexedDB.
- La position GPS est transmise à Nominatim lors de la détection du pays, à OSRM lors du calcul d’un trajet et à l’API Vercel pour les données OSM. Les requêtes Overpass utilisent le centre d’une cellule géographique plutôt que les coordonnées exactes.
- Les fournisseurs publics ont leurs propres disponibilités et quotas. L’application ne garde pas la position GPS dans un serveur privé.

## Limites connues

- Les cartes et calculs nécessitent une connexion. Hors ligne, seul l’habillage PWA et le cache local des alertes déjà téléchargées restent disponibles.
- La qualité du satellite varie selon la zone et le niveau de zoom ; l’imagerie ne peut pas fonctionner sans accès aux tuiles Esri.
- Les sens uniques, vitesses, voies et bornes dépendent des données OSM. Une voie de circulation et une limite ne sont affichées que si les données correspondantes sont fournies.
- Le mode juridique des alertes est conservateur : Belgique, points précis pour radars fixes en Espagne, zones généralisées en France et aux États-Unis, contrôles désactivés en Allemagne et en Suisse ; pays non déterminé, pas de caméra chargée. Les longueurs des zones de vigilance sont des heuristiques d’affichage et non des distances légales.
- Pas d’API de télémétrie Tesla : charge et vitesse viennent du navigateur/GPS ou d’une saisie manuelle. L’application ne pilote pas le véhicule.
- La silhouette du véhicule est une icône vectorielle, et la ligne d’itinéraire est une surcouche cartographique, pas une projection AR calibrée sur la chaussée. Le relief altimétrique n’est pas fourni par OSRM.

## Structure

```text
api/safety-zones.js
public/icons/tesla-nav.svg
public/manifest.json
public/service-worker.js
src/app.js
src/safety.js
src/styles.css
scripts/build.mjs
index.html
package.json
vercel.json
```
