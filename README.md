# Tesla GPS

PWA minimaliste conçue pour le navigateur de la Tesla Model 3. L’écran affiche une carte satellite, une silhouette de Model 3 vue du dessus et la vitesse GPS en km/h.

Les radars fixes enregistrés dans OpenStreetMap sont affichés en Belgique. Un bip unique retentit à moins de 500 mètres d’un radar, si le navigateur a été déverrouillé par une interaction tactile. Le bouton haut droit coupe ou réactive le son. Les repères et bips radar sont désactivés hors de Belgique.

Les requêtes radar partent vers l’API Vercel puis Overpass pour rechercher les objets OSM proches. La réponse est actualisée automatiquement toutes les 15 minutes et à l’entrée dans une nouvelle zone. L’imagerie satellite provient d’Esri ; les routes et libellés utilisent OpenStreetMap via OpenFreeMap.

Le build statique sort dans dist. Le dépôt est relié à Vercel et les pushes sur main déclenchent le déploiement.
