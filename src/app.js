(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const shell = document.querySelector('.app-shell');
  const styleUrls = { day: 'https://tiles.openfreemap.org/styles/bright', night: 'https://tiles.openfreemap.org/styles/dark' };
  const satelliteTiles = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  const defaultCenter = [4.533, 50.337];
  const state = {
    map:null, location:null, route:null, routeOptions:[], selectedRouteIndex:0, routeCoords:[], steps:[], stepIndex:0,
    gpsWatch:null, markers:[], carMarker:null, destinationPoints:[], waypoints:[],
    themeMode:'auto', theme:'day', mapMode:'map', cameraMode:'3d', navigating:false,
    heading:0, distanceToTurn:Infinity, lastVoiceBucket:Infinity, announcedStep:-1,
    safetyContext:null, safetyResult:null, safetyTimer:0, safetyBusy:false,
    alertKey:'', audioContext:null, lastSafetyCountry:'', gForce:0,
    searchTimer:0, toastTimer:0, styleToken:0, satErrorShown:false, wakeLock:null,
    lastFix:null, centeredOnFix:false, lastNominatimCall:0
  };

  function safeStorageGet(key,fallback){try{return localStorage.getItem(key)??fallback;}catch(_){return fallback;}}
  function safeStorageSet(key,value){try{localStorage.setItem(key,String(value));}catch(_){}}
  function toast(message){
    const node=$('toast');node.textContent=message;node.classList.add('show');
    clearTimeout(state.toastTimer);state.toastTimer=setTimeout(()=>node.classList.remove('show'),2800);
  }
  function formatDistance(m){
    if(!Number.isFinite(m))return '—';
    return m<1000?Math.max(10,Math.round(m/10)*10)+' m':(m/1000).toFixed(m<10000?1:0).replace('.',',')+' km';
  }
  function formatTime(seconds){
    const minutes=Math.max(0,Math.round(seconds/60));
    return minutes>=60?Math.floor(minutes/60)+' h '+String(minutes%60).padStart(2,'0'):minutes+' min';
  }
  function updateClock(){
    $('clock').textContent=new Intl.DateTimeFormat('fr-BE',{hour:'2-digit',minute:'2-digit'}).format(new Date());
  }
  function setGpsStatus(ok,label){
    const node=$('gps-status');node.querySelector('span').textContent=label;node.classList.toggle('online',ok);
  }
  function currentTheme(){
    if(state.themeMode==='day'||state.themeMode==='night')return state.themeMode;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches?'night':'day';
  }
  function syncThemeControls(){
    document.querySelectorAll('input[name="theme-mode"]').forEach(input=>{input.checked=input.value===state.themeMode;});
  }
  function applyTheme(){
    const next=currentTheme(),changed=next!==state.theme;
    state.theme=next;shell.dataset.theme=next;
    document.querySelector('meta[name="theme-color"]').content=next==='night'?'#070a0c':'#e8eef1';
    syncThemeControls();
    if(changed&&state.map)loadMapStyle();
  }
  function makeSatelliteStyle(style){
    const composed=JSON.parse(JSON.stringify(style));
    composed.sources=composed.sources||{};
    composed.sources['satellite-imagery']={type:'raster',tiles:[satelliteTiles],tileSize:256,minzoom:0,maxzoom:19,attribution:'Imagery © Esri'};
    const layers=composed.layers||[];
    let backgroundIndex=-1;
    for(let i=0;i<layers.length;i++){
      const layer=layers[i],layout={...(layer.layout||{})};
      if(layer.type==='background'){backgroundIndex=i;layout.visibility='none';}
      else{
        const text=Boolean(layout['text-field']);
        layout.visibility=layer.type==='symbol'&&text?'visible':'none';
      }
      layer.layout=layout;
    }
    const raster={id:'satellite-base',type:'raster',source:'satellite-imagery',paint:{'raster-fade-duration':0,'raster-opacity':1}};
    layers.splice(backgroundIndex<0?0:backgroundIndex+1,0,raster);
    return composed;
  }
  async function loadMapStyle(){
    if(!state.map)return;
    const token=++state.styleToken;
    if(state.mapMode==='map'){
      state.map.setStyle(styleUrls[state.theme],{diff:false});
      return;
    }
    try{
      const response=await fetch(styleUrls[state.theme],{cache:'force-cache'});
      if(!response.ok)throw new Error('Style cartographique indisponible');
      const style=makeSatelliteStyle(await response.json());
      if(token!==state.styleToken)return;
      state.map.setStyle(style,{diff:false});
    }catch(_){
      if(token!==state.styleToken)return;
      state.mapMode='map';syncMapButtons();state.map.setStyle(styleUrls[state.theme],{diff:false});
      toast('Fond satellite indisponible. La carte vectorielle est rétablie.');
    }
  }
  function syncMapButtons(){
    $('view-satellite').classList.toggle('active',state.mapMode==='satellite');
    $('view-map').classList.toggle('active',state.mapMode==='map');
  }
  function setMapMode(mode){
    if(!['map','satellite'].includes(mode))return;
    if(mode===state.mapMode){syncMapButtons();return;}
    state.mapMode=mode;state.satErrorShown=false;syncMapButtons();loadMapStyle();
  }
  function roadLayerDefinitions(){
    const classes=['motorway','motorway_link','trunk','trunk_link','primary','primary_link','secondary','secondary_link','tertiary','tertiary_link','minor','unclassified','residential','living_street','service','street','track','path','pedestrian','cycleway','footway'];
    const filter=['in',['get','class'],['literal',classes]];
    const width=['interpolate',['linear'],['zoom'],8,1.4,11,2,14,3.3,17,5.8,20,8.5];
    const palettes=state.theme==='night'
      ?[[['motorway','motorway_link','trunk','trunk_link'],'#fafcfd'],[['primary','primary_link','secondary','secondary_link'],'#edf1f3'],[['tertiary','tertiary_link','minor','unclassified'],'#dce3e7'],[['residential','living_street','service','street'],'#ced7dc'],[['track','path','pedestrian','cycleway','footway'],'#bec9ce']]
      :[[['motorway','motorway_link','trunk','trunk_link'],'#fff2cc'],[['primary','primary_link','secondary','secondary_link'],'#f0f7f8'],[['tertiary','tertiary_link','minor','unclassified'],'#dce8ec'],[['residential','living_street','service','street'],'#cbd9df'],[['track','path','pedestrian','cycleway','footway'],'#c4d8ce']];
    const color=['match',['get','class']];
    palettes.forEach(([labels,value])=>{color.push(labels,value);});
    color.push('#d4e0e5');
    return {classes,filter,width,color};
  }
  function addRoadContrast(){
    const layers=state.map.getStyle().layers||[];
    const transport=layers.find(layer=>layer['source-layer']==='transportation');
    if(!transport)return;
    const before=layers.find(layer=>layer.type==='symbol'&&layer.layout?.['text-field'])?.id;
    const road=roadLayerDefinitions();
    const casing={id:'vector-road-casing',source:transport.source,'source-layer':'transportation',type:'line',filter:road.filter,layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':state.theme==='night'?'#081014':'#2d3b40','line-width':['+',road.width,3],'line-opacity':.98}};
    const core={id:'vector-road-core',source:transport.source,'source-layer':'transportation',type:'line',filter:road.filter,layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':road.color,'line-width':road.width,'line-opacity':1}};
    state.map.addLayer(casing,before);state.map.addLayer(core,before);
  }
  function addBuildings(){
    const layers=state.map.getStyle().layers||[];
    const building=layers.find(layer=>layer['source-layer']==='building');
    if(!building)return;
    const before=layers.find(layer=>layer.type==='symbol'&&layer.layout?.['text-field'])?.id;
    state.map.addLayer({
      id:'osm-buildings-3d',source:building.source,'source-layer':building['source-layer'],
      type:'fill-extrusion',minzoom:14,
      paint:{
        'fill-extrusion-color':['interpolate',['linear'],['coalesce',['get','render_height'],10],10,state.theme==='night'?'#526469':'#aab9b6',60,state.theme==='night'?'#9aaeb1':'#d2ddda'],
        'fill-extrusion-height':['coalesce',['get','render_height'],['*',['coalesce',['get','building:levels'],3],3.2]],
        'fill-extrusion-base':['coalesce',['get','render_min_height'],0],
        'fill-extrusion-opacity':.84,'fill-extrusion-vertical-gradient':true
      }
    },before);
  }
  function addChevronPattern(){
    if(state.map.hasImage('route-chevron'))return;
    const canvas=document.createElement('canvas');canvas.width=64;canvas.height=32;
    const ctx=canvas.getContext('2d');ctx.clearRect(0,0,64,32);ctx.strokeStyle='#e2fff7';ctx.shadowColor='#51e6c2';ctx.shadowBlur=9;ctx.lineWidth=4;ctx.lineCap='round';ctx.lineJoin='round';
    for(let x=-20;x<64;x+=32){ctx.beginPath();ctx.moveTo(x,5);ctx.lineTo(x+14,16);ctx.lineTo(x,27);ctx.stroke();}
    state.map.addImage('route-chevron',canvas,{pixelRatio:2});
  }
  function featureCollection(features=[]){return {type:'FeatureCollection',features};}
  function addDynamicLayers(){
    state.map.addSource('active-route',{type:'geojson',lineMetrics:true,data:state.route?.geometry?{type:'Feature',geometry:state.route.geometry,properties:{}}:featureCollection()});
    state.map.addLayer({id:'route-underlay',type:'line',source:'active-route',layout:{'line-join':'round','line-cap':'round'},paint:{'line-color':'#061d1a','line-width':['interpolate',['linear'],['zoom'],10,8,16,16,19,21],'line-opacity':.9}});
    state.map.addLayer({id:'route-halo',type:'line',source:'active-route',layout:{'line-join':'round','line-cap':'round'},paint:{'line-color':'#45e4bd','line-width':14,'line-blur':7,'line-opacity':.33}});
    state.map.addLayer({id:'route-core',type:'line',source:'active-route',layout:{'line-join':'round','line-cap':'round'},paint:{'line-color':'#13d5ad','line-width':['interpolate',['linear'],['zoom'],10,3,16,6,19,8],'line-opacity':1}});
    state.map.addLayer({id:'route-ar-chevrons',type:'line',source:'active-route',layout:{'line-pattern':'route-chevron','line-width':['interpolate',['linear'],['zoom'],10,7,16,12,19,16],'line-opacity':.95}});
    state.map.addSource('safety-zones',{type:'geojson',data:state.safetyResult?featureCollection(state.safetyResult.zones):featureCollection()});
    state.map.addLayer({id:'safety-zone-outline',type:'line',source:'safety-zones',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#ffb645','line-width':12,'line-opacity':.24,'line-dasharray':[1,1.5]}});
    state.map.addLayer({id:'safety-zone-hatch',type:'line',source:'safety-zones',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#ffd06b','line-width':3,'line-opacity':.95,'line-dasharray':[1,1.5]}});
    state.map.addSource('safety-points',{type:'geojson',data:state.safetyResult?featureCollection(state.safetyResult.points):featureCollection()});
    state.map.addLayer({id:'safety-point-glow',type:'circle',source:'safety-points',paint:{'circle-radius':13,'circle-color':'#ffd06b','circle-opacity':.28,'circle-blur':.25}});
    state.map.addLayer({id:'safety-point-core',type:'circle',source:'safety-points',paint:{'circle-radius':6,'circle-color':'#ffd06b','circle-stroke-color':'#fff6dd','circle-stroke-width':2}});
    state.map.addSource('charger-pois',{type:'geojson',data:state.chargerGeo||featureCollection()});
    state.map.addLayer({id:'charger-poi-glow',type:'circle',source:'charger-pois',paint:{'circle-radius':11,'circle-color':'#4be5c1','circle-opacity':.35,'circle-blur':.25}});
    state.map.addLayer({id:'charger-poi-core',type:'circle',source:'charger-pois',paint:{'circle-radius':5,'circle-color':'#65f0d0','circle-stroke-color':'#e7fff8','circle-stroke-width':1.5}});
  }
  function installStyleLayers(){
    if(!state.map||!state.map.isStyleLoaded())return;
    try{
      const baseLayers=state.map.getStyle().layers||[];
      const hasSatellite=state.map.getSource('satellite-imagery');
      addRoadContrast();if(state.mapMode==='satellite'&&!hasSatellite)toast('Le fond satellite n’a pas chargé.');
      addBuildings();addChevronPattern();addDynamicLayers();syncMapButtons();
      if(state.location)drawVehicle();
      if(state.route)updateRouteCard();
      if(state.safetyResult)renderSafetyLayers();
      if(state.safetyContext)renderChargers(state.safetyContext);
      if(state.navigating&&state.location)updateChaseCamera();
    }catch(error){console.error('Carte:',error);toast('Une couche de carte ne s’est pas chargée.');}
  }

  function initMap(){
    if(!window.maplibregl){toast('Moteur cartographique indisponible.');return;}
    const themeMode=safeStorageGet('vector-theme','auto');
    state.themeMode=['day','night','auto'].includes(themeMode)?themeMode:'auto';state.theme=currentTheme();
    shell.dataset.theme=state.theme;syncThemeControls();
    state.map=new maplibregl.Map({container:'map',style:styleUrls[state.theme],center:defaultCenter,zoom:14.5,pitch:62,bearing:0,attributionControl:false,fadeDuration:0,maxPitch:72,renderWorldCopies:false,trackResize:true});
    state.map.on('style.load',installStyleLayers);
    state.map.on('rotate',drawVehicle);
    state.map.on('error',event=>{
      const sourceId=event?.sourceId||event?.source?.id;
      if(sourceId==='satellite-imagery'&&!state.satErrorShown){state.satErrorShown=true;toast('Tuiles satellite indisponibles par le réseau.');}
      if(event?.error)console.warn('MapLibre',sourceId,event.error.message||event.error);
    });
  }
  function setMapMode(mode){
    if(!['map','satellite'].includes(mode))return;
    if(mode===state.mapMode){syncMapButtons();return;}
    state.mapMode=mode;state.satErrorShown=false;syncMapButtons();
    if(state.map)loadMapStyle();
  }

  function makeVehicleElement(){
    const el=document.createElement('div');el.className='vehicle-marker';el.setAttribute('aria-label','Position GPS');
    el.innerHTML='<svg viewBox="0 0 48 84" aria-hidden="true"><path class="body" d="M24 3C17 3 13 8 11 17L5 47v20c0 5 3 8 8 8h22c5 0 8-3 8-8V47l-6-30C35 8 31 3 24 3Z"/><path class="car-glass" d="m14 24 3-10c1-3 3-5 7-5s6 2 7 5l3 10z"/><path class="roof" d="M13 29h22l4 18H9z"/><path class="lamp" d="M8 59h7v5H8zm25 0h7v5h-7z"/></svg>';
    return el;
  }
  function drawVehicle(){
    if(!state.map||!state.map.isStyleLoaded()||!state.location)return;
    const coordinates=[state.location.longitude,state.location.latitude];
    if(!state.carMarker){
      state.carMarker=new maplibregl.Marker({element:makeVehicleElement(),anchor:'center',rotationAlignment:'viewport',pitchAlignment:'viewport'}).setLngLat(coordinates).addTo(state.map);
    }else state.carMarker.setLngLat(coordinates);
    const mapBearing=state.map.getBearing();
    state.carMarker.setRotation(((state.heading-mapBearing)%360+360)%360);
  }
  function radians(degrees){return degrees*Math.PI/180;}
  function distanceMeters(a,b){
    const dLat=radians(b[1]-a[1]),dLon=radians(b[0]-a[0]);
    const h=Math.sin(dLat/2)**2+Math.cos(radians(a[1]))*Math.cos(radians(b[1]))*Math.sin(dLon/2)**2;
    return 6371000*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
  }
  function nearestProgress(point,coords){
    if(!coords||coords.length<2)return {distance:Infinity,along:0,total:0};
    let best={distance:Infinity,along:0},travelled=0;
    const metersLat=111320,metersLon=111320*Math.cos(radians(point[1]));
    for(let i=1;i<coords.length;i++){
      const a=coords[i-1],b=coords[i],ax=(a[0]-point[0])*metersLon,ay=(a[1]-point[1])*metersLat,bx=(b[0]-point[0])*metersLon,by=(b[1]-point[1])*metersLat;
      const dx=bx-ax,dy=by-ay,len2=dx*dx+dy*dy,t=len2?Math.max(0,Math.min(1,-(ax*dx+ay*dy)/len2)):0;
      const alongSegment=distanceMeters(a,b),dist=Math.hypot(ax+t*dx,ay+t*dy);
      if(dist<best.distance)best={distance:dist,along:travelled+t*alongSegment};
      travelled+=alongSegment;
    }
    return {...best,total:travelled};
  }
  function cameraZoom(){
    const speed=(state.location?.speed||0)*3.6;
    if(speed>80)return 15.75;
    if((state.distanceToTurn<200&&speed<40)||speed<30)return 17.5;
    return 16.55;
  }
  function updateChaseCamera(){
    if(!state.map||!state.location||!state.navigating||state.cameraMode==='global')return;
    const center=[state.location.longitude,state.location.latitude];
    const north=state.cameraMode==='north';
    state.map.easeTo({center,zoom:north?16.7:cameraZoom(),bearing:north?0:state.heading,pitch:north?0:71,offset:north?[0,0]:[0,Math.round((window.innerHeight||800)*.18)],duration:640,easing:t=>1-Math.pow(1-t,3)});
  }

  async function reverseGeocode(query){
    const wait=Math.max(0,1100-(Date.now()-state.lastNominatimCall));
    if(wait)await new Promise(resolve=>setTimeout(resolve,wait));
    state.lastNominatimCall=Date.now();
    const url='https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&addressdetails=1&q='+encodeURIComponent(query);
    const response=await fetch(url,{headers:{'Accept-Language':'fr-BE,fr;q=0.9'}});
    if(!response.ok)throw new Error('Recherche indisponible');
    return response.json();
  }
  function renderSearchResults(items,input){
    const root=$('search-results');root.replaceChildren();
    items.forEach(item=>{
      const button=document.createElement('button');button.type='button';button.className='search-result';button.textContent=item.display_name;
      button.addEventListener('click',()=>{
        input.value=item.display_name.split(',').slice(0,2).join(', ');
        input.dataset.lat=item.lat;input.dataset.lon=item.lon;input.dataset.label=input.value;
        root.replaceChildren();
      });
      root.append(button);
    });
  }
  function activeRouteInputs(){
    return [$('origin-input'),...Array.from(document.querySelectorAll('.waypoint-input')),$('destination-input')];
  }
  function addWaypoint(){
    const row=document.createElement('div');row.className='waypoint-row';
    row.innerHTML='<label class="route-input"><i class="origin-dot"></i><input class="waypoint-input" placeholder="Étape intermédiaire" autocomplete="off"><button type="button" class="waypoint-clear" aria-label="Effacer l’étape">×</button></label><button class="waypoint-remove" type="button" aria-label="Supprimer l’étape">−</button>';
    const input=row.querySelector('input');
    input.addEventListener('input',()=>onSearchInput(input));
    row.querySelector('.waypoint-clear').addEventListener('click',()=>{input.value='';delete input.dataset.lat;delete input.dataset.lon;});
    row.querySelector('.waypoint-remove').addEventListener('click',()=>row.remove());
    $('waypoint-list').append(row);input.focus();
  }
  async function onSearchInput(input){
    clearTimeout(state.searchTimer);
    const query=input.value.trim();delete input.dataset.lat;delete input.dataset.lon;delete input.dataset.label;
    if(query.length<3){$('search-results').replaceChildren();return;}
    state.searchTimer=setTimeout(async()=>{
      try{const items=await reverseGeocode(query);renderSearchResults(items,input);}
      catch(_){$('search-results').replaceChildren();}
    },700);
  }
  async function resolveInput(input,isOrigin=false){
    const text=input.value.trim();
    if(!text&&isOrigin&&state.location)return [state.location.longitude,state.location.latitude];
    if(Number.isFinite(Number(input.dataset.lat))&&Number.isFinite(Number(input.dataset.lon)))return [Number(input.dataset.lon),Number(input.dataset.lat)];
    if(!text&&isOrigin&&state.centeredOnFix&&state.location)return [state.location.longitude,state.location.latitude];
    if(!text)throw new Error(isOrigin?'Départ GPS indisponible.':'Complétez chaque étape du trajet.');
    const items=await reverseGeocode(text);
    if(!items.length)throw new Error('Adresse introuvable : '+text);
    input.dataset.lat=items[0].lat;input.dataset.lon=items[0].lon;input.dataset.label=items[0].display_name;
    return [Number(items[0].lon),Number(items[0].lat)];
  }
  function validOneWay(route){
    return route.legs.every(leg=>leg.steps.every(step=>(step.intersections||[]).every(intersection=>{
      if(!Number.isInteger(intersection.out)||!Array.isArray(intersection.entry))return true;
      return intersection.entry[intersection.out]!==false;
    })));
  }
  function routeFitOptions(duration=700){
    const compact=(window.innerWidth||1200)<900;
    return {padding:compact?{top:130,bottom:140,left:20,right:20}:{top:170,bottom:155,left:365,right:350},duration,maxZoom:16.5,bearing:0,pitch:0};
  }
  async function calculateRoute(){
    if(!state.map){toast('Carte en cours de chargement.');return;}
    $('calculate-route').disabled=true;$('calculate-route').textContent='CALCUL…';
    try{
      const inputs=activeRouteInputs(),coords=[];
      for(let i=0;i<inputs.length;i++){
        const value=await resolveInput(inputs[i],i===0);
        if(i>0&&value[0]===coords.at(-1)?.[0]&&value[1]===coords.at(-1)?.[1])continue;
        coords.push(value);
      }
      if(coords.length<2)throw new Error('Indiquez une destination.');
      if(!state.location&&inputs[0].value.trim()==='')throw new Error('Autorisez la localisation ou indiquez un départ.');
      const path=coords.map(pair=>pair.join(',')).join(';');
      const url='https://router.project-osrm.org/route/v1/driving/'+path+'?overview=full&geometries=geojson&steps=true&alternatives=true';
      const response=await fetch(url);if(!response.ok)throw new Error('Service de calcul indisponible.');
      const data=await response.json();if(data.code!=='Ok'||!data.routes?.length)throw new Error('Aucun itinéraire routier trouvé.');
      const alternatives=data.routes.filter(validOneWay);if(!alternatives.length)throw new Error('Itinéraire refusé : une sortie semble interdite.');
      state.routeOptions=alternatives;state.selectedRouteIndex=0;const route=alternatives[0];
      state.route=route;state.routeProgress=0;state.routeCoords=route.geometry.coordinates;state.steps=route.legs.flatMap(leg=>leg.steps||[]).filter(step=>step.distance>0);state.stepIndex=0;state.announcedStep=-1;state.lastVoiceBucket=Infinity;
      if(state.map.getSource('active-route'))state.map.getSource('active-route').setData({type:'Feature',geometry:route.geometry,properties:{}});
      state.markers.forEach(marker=>marker.remove());state.markers=[];
      coords.forEach((point,index)=>{
        const element=document.createElement('div');element.className='route-marker'+(index===0?' origin':'');
        state.markers.push(new maplibregl.Marker({element,anchor:'center'}).setLngLat(point).addTo(state.map));
      });
      state.destinationPoints=coords;
      const bounds=state.routeCoords.reduce((result,point)=>result.extend(point),new maplibregl.LngLatBounds(state.routeCoords[0],state.routeCoords[0]));
      state.map.fitBounds(bounds,routeFitOptions(700));
      updateRouteCard();renderRouteChoices();if(state.steps[0])setManeuver(state.steps[0],state.steps[0].distance);closeOverlay('search-overlay');toast('Itinéraire calculé avec les restrictions du réseau routier.');
      if(state.safetyContext)renderChargers(state.safetyContext);
    }catch(error){toast(error.message||'Calcul de trajet impossible.');}
    finally{$('calculate-route').disabled=false;$('calculate-route').innerHTML='CALCULER <b>→</b>';}
  }
  function renderRouteChoices(){
    const root=$('route-alternatives');root.replaceChildren();
    const choices=state.routeOptions||[];
    root.hidden=choices.length<2;
    choices.slice(0,3).forEach((route,index)=>{
      const button=document.createElement('button');button.type='button';button.className='route-choice'+(index===state.selectedRouteIndex?' selected':'');
      button.innerHTML='<b></b><span></span>';
      button.querySelector('b').textContent='OPTION '+(index+1);
      button.querySelector('span').textContent=formatTime(route.duration)+' · '+formatDistance(route.distance);
      button.addEventListener('click',()=>selectRoute(index));root.append(button);
    });
  }
  function selectRoute(index){
    const route=state.routeOptions[index];if(!route)return;
    state.selectedRouteIndex=index;state.route=route;state.routeCoords=route.geometry.coordinates;
    state.steps=route.legs.flatMap(leg=>leg.steps||[]).filter(step=>step.distance>0);state.stepIndex=0;state.routeProgress=0;state.announcedStep=-1;state.lastVoiceBucket=Infinity;
    if(state.map?.getSource('active-route'))state.map.getSource('active-route').setData({type:'Feature',geometry:route.geometry,properties:{}});
    state.markers.forEach(marker=>marker.remove());state.markers=[];
    state.destinationPoints.forEach((point,i)=>{const element=document.createElement('div');element.className='route-marker'+(i===0?' origin':'');state.markers.push(new maplibregl.Marker({element,anchor:'center'}).setLngLat(point).addTo(state.map));});
    const bounds=state.routeCoords.reduce((result,point)=>result.extend(point),new maplibregl.LngLatBounds(state.routeCoords[0],state.routeCoords[0]));
    state.map.fitBounds(bounds,routeFitOptions(600));
    updateRouteCard();renderRouteChoices();if(state.steps[0])setManeuver(state.steps[0],state.steps[0].distance);
    if(state.safetyContext)renderChargers(state.safetyContext);
  }
  function routeName(){
    const inputs=activeRouteInputs(),last=inputs[inputs.length-1];
    return last.dataset.label||last.value.trim()||'Destination';
  }
  function updateRouteCard(){
    if(!state.route)return;
    $('route-panel').classList.add('ready');$('route-title').textContent=routeName();
    const remaining=state.navigating?Math.max(0,state.route.distance-(state.routeProgress||0)):state.route.distance;
    const seconds=state.navigating?state.route.duration*(remaining/Math.max(1,state.route.distance)):state.route.duration;
    $('route-distance').textContent=formatDistance(remaining);$('route-time').textContent=formatTime(seconds);
    $('route-eta').textContent=new Intl.DateTimeFormat('fr-BE',{hour:'2-digit',minute:'2-digit'}).format(new Date(Date.now()+seconds*1000));
    $('route-status').textContent=state.navigating?'Guidage actif':state.route.legs.reduce((n,leg)=>n+(leg.steps?.length||0),0)+' segments · sens uniques vérifiés';
    $('start-nav').disabled=false;
  }
  function maneuverText(step){
    const type=step?.maneuver?.type,modifier=step?.maneuver?.modifier||'';
    if(type==='arrive')return'Arrivée';
    if(type==='depart'||type==='new name')return'Continuez';
    if(type==='roundabout'||type==='rotary')return'Rond-point, prenez la sortie';
    if(type==='merge')return'Rejoignez la voie';
    if(modifier.includes('uturn'))return'Demi-tour';
    if(modifier.includes('left'))return'Tournez à gauche';
    if(modifier.includes('right'))return'Tournez à droite';
    if(modifier.includes('straight'))return'Continuez tout droit';
    if(type==='fork')return'Prenez la branche';
    return'Continuez';
  }
  function maneuverPath(step){
    const modifier=step?.maneuver?.modifier||'';
    if(modifier.includes('right'))return'M10 39V24q0-7 7-7h18m0 0L25 7m10 10L25 28';
    if(modifier.includes('left'))return'M38 39V24q0-7-7-7H13m0 0L23 7m-10 10 10 11';
    if(modifier.includes('uturn'))return'M34 39V20q0-10-10-10t-10 10v2m0 0 8-8m-8 8-8-8';
    return'M24 39V11m0 0L13 22m11-11 11 11';
  }
  function updateLaneGuidance(step){
    const root=document.querySelector('.lane-indicator');if(!root)return;
    const intersection=(step?.intersections||[]).find(item=>Array.isArray(item.lanes)&&item.lanes.length);
    if(!intersection){root.hidden=true;return;}
    root.hidden=false;
    const lanes=intersection.lanes.slice(0,3),strips=[...root.querySelectorAll('span')];
    strips.forEach((strip,index)=>{
      strip.hidden=index>=lanes.length;
      strip.classList.toggle('recommended',Boolean(lanes[index]?.valid));
      strip.setAttribute('aria-label',lanes[index]?.valid?'Voie recommandée':'Autre voie');
    });
  }
  function setManeuver(step,distance){
    if(!step){updateLaneGuidance(null);$('maneuver-label').textContent='ARRIVÉE';$('maneuver-distance').textContent='';$('maneuver-street').textContent='Vous êtes arrivé';return;}
    $('maneuver-icon').querySelector('path').setAttribute('d',maneuverPath(step));
    $('maneuver-label').textContent=maneuverText(step).toUpperCase();
    $('maneuver-distance').textContent=formatDistance(distance??step.distance);
    $('maneuver-street').textContent=step.name||'Suivez la route';updateLaneGuidance(step);
  }
  function updateNavigation(){
    if(!state.route||!state.location)return;
    const progress=nearestProgress([state.location.longitude,state.location.latitude],state.routeCoords);
    state.routeProgress=Math.min(state.route.distance,Math.max(0,progress.along));
    const fraction=state.route.distance?state.routeProgress/state.route.distance:0,remaining=Math.max(0,state.route.distance-state.routeProgress);
    const remainingSeconds=state.route.duration*(1-fraction);
    $('progress-bar').style.width=(fraction*100).toFixed(1)+'%';
    $('route-distance').textContent=formatDistance(remaining);$('route-time').textContent=formatTime(remainingSeconds);
    $('route-eta').textContent=new Intl.DateTimeFormat('fr-BE',{hour:'2-digit',minute:'2-digit'}).format(new Date(Date.now()+remainingSeconds*1000));
    let cumulative=0,index=0;
    for(let i=0;i<state.steps.length;i++){cumulative+=state.steps[i].distance;if(state.routeProgress<cumulative){index=i;break;}index=Math.min(i+1,state.steps.length-1);}
    if(index!==state.stepIndex){state.stepIndex=index;state.announcedStep=-1;state.lastVoiceBucket=Infinity;}
    const step=state.steps[state.stepIndex],distance=Math.max(0,cumulative-state.routeProgress);
    state.distanceToTurn=distance;setManeuver(step,distance);
    if(progress.distance>100&&state.offRouteNotice!==true){state.offRouteNotice=true;toast('Écart au tracé détecté. Recalculez le trajet si nécessaire.');}
    if(progress.distance<60)state.offRouteNotice=false;
    if(step&&distance<=450&&distance>0){
      const bucket=distance>260?400:distance>140?200:distance>55?100:30;
      if(bucket<state.lastVoiceBucket){speak(maneuverText(step)+(step.name?' sur '+step.name:'')+' dans '+bucket+' mètres');state.lastVoiceBucket=bucket;}
    }
    updateRouteCard();
  }
  function speak(text){
    if(!('speechSynthesis'in window))return;
    window.speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(text);utterance.lang='fr-BE';utterance.rate=1;window.speechSynthesis.speak(utterance);
  }
  async function requestWakeLock(){try{if('wakeLock'in navigator)state.wakeLock=await navigator.wakeLock.request('screen');}catch(_){}}
  function releaseWakeLock(){try{state.wakeLock?.release();}catch(_){}state.wakeLock=null;}
  function beginNavigation(){
    if(!state.route){toast('Calculez un itinéraire d’abord.');return;}
    if(!state.location){toast('Attente de la position GPS.');return;}
    state.navigating=true;state.cameraMode='3d';shell.classList.add('nav-guiding');$('route-panel').classList.add('ready');
    try{state.audioContext=state.audioContext||new(window.AudioContext||window.webkitAudioContext)();state.audioContext.resume();}catch(_){}requestWakeLock();
    $('nav-footer')?.classList.add('active');$('start-nav').disabled=true;updateRouteCard();updateVehicleVisibility();updateChaseCamera();refreshSafety(true);
    if(state.steps[0])speak(maneuverText(state.steps[0])+(state.steps[0].name?' sur '+state.steps[0].name:'')+', dans '+formatDistance(state.steps[0].distance));
    toast('Guidage démarré. Gardez votre attention sur la route.');
  }
  function endNavigation(){
    state.navigating=false;releaseWakeLock();state.alertKey='';shell.classList.remove('nav-guiding');$('safety-alert').hidden=true;
    $('nav-footer')?.classList.remove('active');$('start-nav').disabled=false;window.speechSynthesis?.cancel?.();
    if(state.route){const bounds=state.routeCoords.reduce((result,p)=>result.extend(p),new maplibregl.LngLatBounds(state.routeCoords[0],state.routeCoords[0]));state.map.fitBounds(bounds,{padding:120,duration:600,bearing:0,pitch:0});}
    updateVehicleVisibility();
  }
  function updateVehicleVisibility(){
    if(!state.carMarker)return;
    state.carMarker.getElement().style.opacity='1';
  }
  function playAlertBeep(entering){
    if(!state.navigating||!state.audioContext)return;
    try{
      const context=state.audioContext,oscillator=context.createOscillator(),gain=context.createGain();
      oscillator.type='sine';oscillator.frequency.value=entering?850:640;
      gain.gain.setValueAtTime(.0001,context.currentTime);gain.gain.exponentialRampToValueAtTime(.05,context.currentTime+.025);gain.gain.exponentialRampToValueAtTime(.0001,context.currentTime+.16);
      oscillator.connect(gain);gain.connect(context.destination);oscillator.start();oscillator.stop(context.currentTime+.17);
    }catch(_){}
  }
  function renderSafetyLayers(){
    if(!state.map||!state.map.getSource('safety-zones'))return;
    state.map.getSource('safety-zones').setData(featureCollection(state.safetyResult?.zones||[]));
    state.map.getSource('safety-points').setData(featureCollection(state.safetyResult?.points||[]));
  }
  function renderChargers(context){
    if(!context||!Array.isArray(context.chargers)||!state.routeCoords.length){$('charger-strip').hidden=true;$('charger-list').replaceChildren();state.chargerGeo=featureCollection();if(state.map?.getSource('charger-pois'))state.map.getSource('charger-pois').setData(state.chargerGeo);return;}
    const current=state.location?[state.location.longitude,state.location.latitude]:state.routeCoords[0];
    const position=nearestProgress(current,state.routeCoords);
    const along=[];
    for(const charger of context.chargers){
      const projection=nearestProgress(charger.point,state.routeCoords);
      if(projection.distance>260)continue;
      const distance=projection.along-position.along;
      if(distance<-100||distance>60000)continue;
      along.push({...charger,distance});
    }
    along.sort((a,b)=>a.distance-b.distance);
    const root=$('charger-list');root.replaceChildren();
    along.slice(0,3).forEach(charger=>{
      const row=document.createElement('div');row.className='charger-entry';
      const name=document.createElement('span');name.textContent=(charger.tesla?'Superchargeur · ':'')+(charger.name||'Borne rapide');
      const power=document.createElement('b');power.textContent=(charger.powerKw?charger.powerKw+' kW':'Recharge')+' · '+formatDistance(charger.distance);
      row.append(name,power);root.append(row);
    });
    $('charger-strip').hidden=!along.length;
    const features=along.slice(0,20).map(charger=>({type:'Feature',geometry:{type:'Point',coordinates:charger.point},properties:{power:charger.powerKw||0}}));
    state.chargerGeo=featureCollection(features);
    if(state.map?.getSource('charger-pois'))state.map.getSource('charger-pois').setData(state.chargerGeo);
  }
  function renderSafety(result,context){
    state.safetyResult=result;
    renderSafetyLayers();renderChargers(context);
    const speedLimit=result?.speedLimit||null;
    $('speed-limit').textContent=speedLimit?speedLimit+' km/h':'—';
    const current=Math.round((state.location?.speed||0)*3.6);
    document.querySelector('.speed-readout').classList.toggle('over-limit',Boolean(speedLimit&&current>speedLimit+2));
    const alert=result?.alert,card=$('safety-alert');
    if(alert){
      const names={'speed-camera':'RADAR FIXE','redlight-camera':'CONTRÔLE FEU','road-hazard':'DANGER ROUTIER'};
      $('safety-title').textContent=alert.precise?(names[alert.kind]||'CONTRÔLE'):'ZONE DE VIGILANCE';
      $('safety-distance').textContent=(alert.precise?'Point dans ':'Zone dans ')+formatDistance(alert.distance);
      $('safety-limit').textContent=alert.speedLimit?alert.speedLimit+' km/h':'';
      card.hidden=false;
      if(state.alertKey!==alert.key){playAlertBeep(true);state.alertKey=alert.key;}
    }else{
      card.hidden=true;
      if(state.alertKey){playAlertBeep(false);state.alertKey='';}
    }
    if(context?.country&&state.lastSafetyCountry!==context.country){
      state.lastSafetyCountry=context.country;
      if(context.mode==='off')toast('Alertes de contrôle désactivées dans cette zone.');
      else if(context.stale)toast('Alertes OSM hors ligne : données potentiellement anciennes.');
    }
  }
  async function refreshSafety(force=false){
    if(!window.SafetyRadar||!state.location||state.safetyBusy)return;
    const now=Date.now();
    if(!force&&now-state.safetyTimer<12000&&state.safetyContext){
      const result=window.SafetyRadar.evaluate(state.safetyContext,state.location,state.location.speed,state.routeCoords);
      renderSafety(result,state.safetyContext);return;
    }
    state.safetyBusy=true;state.safetyTimer=now;
    try{
      const context=await window.SafetyRadar.update(state.location);
      state.safetyContext=context;
      if(context){const result=window.SafetyRadar.evaluate(context,state.location,state.location.speed,state.routeCoords);renderSafety(result,context);}
    }catch(_){ }
    finally{state.safetyBusy=false;}
  }
  function recalcForceG(location){
    const prev=state.lastFix;state.lastFix=location;
    if(!prev||!Number.isFinite(prev.timestamp)||location.timestamp<=prev.timestamp)return;
    const seconds=(location.timestamp-prev.timestamp)/1000;if(seconds<.2||seconds>8)return;
    const speed=(location.speed||0),old=(prev.speed||0);
    const accel=(speed-old)/seconds;
    let headingDelta=((state.heading-(prev.heading??state.heading)+540)%360)-180;
    const lateral=speed*radians(headingDelta)/seconds;
    state.gForce=Math.min(1.5,Math.hypot(accel,lateral)/9.81);
    $('gforce').textContent=state.gForce.toFixed(2).replace('.',',');
  }
  function startGps(){
    if(!navigator.geolocation){setGpsStatus(false,'GPS INDISPONIBLE');return;}
    state.gpsWatch=navigator.geolocation.watchPosition(position=>{
      const c=position.coords,previous=state.location;
      state.location={latitude:c.latitude,longitude:c.longitude,accuracy:c.accuracy,altitude:c.altitude,speed:c.speed,heading:c.heading,timestamp:position.timestamp};
      if(Number.isFinite(c.heading)&&c.speed>.8)state.heading=c.heading;
      recalcForceG(state.location);
      $('speed').textContent=Number.isFinite(c.speed)?String(Math.round(c.speed*3.6)):'0';
      $('altitude').textContent=Number.isFinite(c.altitude)?Math.round(c.altitude)+' m':'— m';
      $('accuracy').textContent=Number.isFinite(c.accuracy)?Math.round(c.accuracy)+' m':'— m';
      $('heading').textContent=Number.isFinite(state.heading)?Math.round(state.heading)+'°':'—';
      $('heading-arrow').style.transform='rotate('+state.heading+'deg)';
      setGpsStatus(true,'GPS ACTIF');drawVehicle();
      if(!state.centeredOnFix&&state.map){state.centeredOnFix=true;state.map.jumpTo({center:[c.longitude,c.latitude],zoom:15.6,pitch:60,bearing:0});}
      if(state.navigating&&previous){updateNavigation();updateChaseCamera();}
      refreshSafety(false);
    },error=>{
      setGpsStatus(false,error.code===1?'GPS REFUSÉ':'GPS FAIBLE');
      if(error.code===1)toast('Autorisez la localisation dans le navigateur.');
    },{enableHighAccuracy:true,maximumAge:1000,timeout:15000});
  }

  function openOverlay(id){
    const node=$(id);node.classList.add('open');node.setAttribute('aria-hidden','false');
    node.querySelector('input')?.focus();
  }
  function closeOverlay(id){const node=$(id);node.classList.remove('open');node.setAttribute('aria-hidden','true');}
  function bindEvents(){
    $('settings-open').addEventListener('click',()=>openOverlay('settings-overlay'));
    $('search-open').addEventListener('click',()=>openOverlay('search-overlay'));
    document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>closeOverlay(button.dataset.close)));
    document.querySelectorAll('.overlay').forEach(overlay=>overlay.addEventListener('click',event=>{if(event.target===overlay)closeOverlay(overlay.id);}));
    document.addEventListener('keydown',event=>{if(event.key==='Escape')document.querySelectorAll('.overlay.open').forEach(overlay=>closeOverlay(overlay.id));});
    document.querySelectorAll('input[name="theme-mode"]').forEach(input=>input.addEventListener('change',event=>{state.themeMode=event.target.value;safeStorageSet('vector-theme',state.themeMode);applyTheme();}));
    window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change',()=>{if(state.themeMode==='auto')applyTheme();});
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&state.navigating)requestWakeLock();});
    $('origin-current').addEventListener('click',()=>{$('origin-input').value='';delete $('origin-input').dataset.lat;delete $('origin-input').dataset.lon;});
    $('destination-clear').addEventListener('click',()=>{$('destination-input').value='';delete $('destination-input').dataset.lat;delete $('destination-input').dataset.lon;});
    $('add-waypoint').addEventListener('click',addWaypoint);
    $('calculate-route').addEventListener('click',calculateRoute);
    activeRouteInputs().forEach(input=>input.addEventListener('input',()=>onSearchInput(input)));
    $('destination-input').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();calculateRoute();}});
    $('start-nav').addEventListener('click',beginNavigation);$('end-nav').addEventListener('click',endNavigation);
    $('clear-route').addEventListener('click',clearRoute);
    $('view-3d').addEventListener('click',()=>setCameraMode('3d'));$('view-north').addEventListener('click',()=>setCameraMode('north'));$('view-global').addEventListener('click',()=>setCameraMode('global'));
    $('view-satellite').addEventListener('click',()=>setMapMode('satellite'));$('view-map').addEventListener('click',()=>setMapMode('map'));
    $('recenter').addEventListener('click',()=>{if(!state.location){toast('Attente du GPS.');return;}state.cameraMode='3d';if(state.navigating)updateChaseCamera();else state.map.easeTo({center:[state.location.longitude,state.location.latitude],zoom:16.5,bearing:state.heading,pitch:66,duration:600});drawVehicle();});
    $('soc-input').addEventListener('change',event=>{const value=Math.max(0,Math.min(100,Number(event.target.value)||0));event.target.value=String(value);safeStorageSet('vector-soc',value);});
    const soc=safeStorageGet('vector-soc',null);if(soc!==null)$('soc-input').value=soc;
  }
  function setCameraMode(mode){
    if(!state.map)return;
    state.cameraMode=mode;
    $('view-3d').classList.toggle('active',mode==='3d');$('view-north').classList.toggle('active',mode==='north');$('view-global').classList.toggle('active',mode==='global');
    if(mode==='global'&&state.route){
      const bounds=state.routeCoords.reduce((result,p)=>result.extend(p),new maplibregl.LngLatBounds(state.routeCoords[0],state.routeCoords[0]));
      state.map.fitBounds(bounds,{padding:130,duration:650,bearing:0,pitch:0});return;
    }
    if(state.navigating){updateChaseCamera();return;}
    if(state.location)state.map.easeTo({center:[state.location.longitude,state.location.latitude],zoom:mode==='north'?16.7:16.5,bearing:mode==='north'?0:state.heading,pitch:mode==='north'?0:71,duration:620});
  }
  function clearRoute(){
    endNavigation();state.route=null;state.routeOptions=[];state.selectedRouteIndex=0;state.routeCoords=[];state.steps=[];state.routeProgress=0;state.destinationPoints=[];
    $('route-panel').classList.remove('ready');$('progress-bar').style.width='0%';$('charger-strip').hidden=true;$('route-alternatives').replaceChildren();$('route-alternatives').hidden=true;state.chargerGeo=featureCollection();
    state.markers.forEach(marker=>marker.remove());state.markers=[];
    if(state.map?.getSource('active-route'))state.map.getSource('active-route').setData(featureCollection());
    if(state.map?.getSource('charger-pois'))state.map.getSource('charger-pois').setData(featureCollection());
    refreshSafety(true);
  }

  bindEvents();updateClock();setInterval(updateClock,15000);initMap();startGps();
  if('serviceWorker'in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('/service-worker.js').catch(()=>{});
})();