# Tesla GPS

PWA minimaliste conçue pour le navigateur de la Tesla Model 3 : carte satellite, vitesse GPS en km/h et silhouette personnalisée d’une Model 3 blanche à toit panoramique noir, vue du dessus.

La voiture est un repère géographique lié aux coordonnées GPS. Le déplacement manuel de la carte ne modifie pas sa position ; le recentrage automatique s’arrête après un glissement manuel et un bouton discret permet de revenir au suivi GPS.

Les radars fixes enregistrés dans OpenStreetMap sont affichés en Belgique. Un bip unique retentit à moins de 100 mètres uniquement si la vitesse GPS dépasse une limite connue, lue sur le radar ou sur la route OSM à proximité. Si la limite n’est pas renseignée, aucun bip n’est émis. Le bouton en haut à droite coupe ou réactive le son. Les avertissements radar sont désactivés hors de Belgique.

Les données radar et les limites de vitesse sont actualisées automatiquement toutes les 15 minutes et lorsque l’application entre dans une nouvelle zone. L’imagerie satellite vient d’Esri ; les routes et libellés viennent d’OpenStreetMap via OpenFreeMap. Le GPS et les données cartographiques nécessitent une connexion.

Le build statique sort dans dist. Les pushes sur main déclenchent un déploiement Vercel.
