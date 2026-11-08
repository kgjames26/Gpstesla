# Tesla GPS

PWA minimaliste conçue pour le navigateur de la Tesla Model 3.

L’écran affiche uniquement une carte satellite centrée sur la position GPS, une silhouette originale de Model 3 vue du dessus et la vitesse GPS en km/h.

La carte est orientée selon le déplacement quand le navigateur fournit un cap. L’imagerie provient d’Esri ; les routes et libellés superposés utilisent OpenStreetMap via OpenFreeMap. Le GPS fonctionne avec l’autorisation de localisation du navigateur et une connexion HTTPS.

## Déploiement

Le dépôt est lié à Vercel. La sortie du build statique est dist et chaque push sur main déclenche le déploiement si l’intégration Git est active.

## PWA

Le shell de l’interface peut être mis en cache. L’imagerie et les données cartographiques nécessitent une connexion. La position GPS ne part pas vers un serveur applicatif.