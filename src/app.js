(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const state = { map:null, location:null, destination:null, route:null, steps:[], stepIndex:0, watchId:null, navigating:false, heading:0, lastSpoken:-1, lastAnnouncedStep:-1, lastVoiceBucket:500, markers:[], routeCoords:[], lastRouteProgress:0, distanceToManeuver:Infinity, mapMode:'map', cameraMode:'3d', nativeLayers:[], carMarker:null, toastTimer:null, searchTimer:null, themeMode:'auto', effectiveTheme:'day', safetyContext:null, safetyLastFetch:0, safetyPromise:null, safetyAlertKey:'', audioContext:null, lastSafetyCountry:'' };
  const defaultCenter = [4.533, 50.337];
  const styleUrls = { day:'https://tiles.openfreemap.org/styles/bright', night:'https://tiles.openfreemap.org/styles/dark' };
  const satelliteUrl = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

  function toast(message) { const el=$('toast'); el.textContent=message; el.classList.add('show'); clearTimeout(state.toastTimer); state.toastTimer=setTimeout(()=>el.classList.remove('show'),2600); }
  function updateClock(){ $('clock').textContent=new Intl.DateTimeFormat('fr-BE',{hour:'2-digit',minute:'2-digit'}).format(new Date()); }
  function formatDistance(m){return m<1000?`${Math.max(10,Math.round(m/10)*10)} m`:`${(m/1000).toFixed(m<10000?1:0).replace('.',',')} km`;}
  function formatDuration(s){const mins=Math.max(1,Math.round(s/60));return mins>=60?`${Math.floor(mins/60)} h ${String(mins%60).padStart(2,'0')}`:`${mins} min`;}
  function setConnection(ok,label){$('gps-status').textContent=label;$('gps-status').parentElement.classList.toggle('online',ok);}
  function effectiveTheme(){
    if(state.themeMode==='day'||state.themeMode==='night')return state.themeMode;
    return window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'night':'day';
  }
  function applyTheme(){
    const next=effectiveTheme(), changed=next!==state.effectiveTheme;
    state.effectiveTheme=next;
    const shell=document.querySelector('.app-shell');
    shell.dataset.theme=next;
    document.querySelector('meta[name="theme-color"]').content=next==='night'?'#050709':'#e9eef1';
    document.querySelectorAll('input[name="theme-mode"]').forEach(input=>input.checked=input.value===state.themeMode);
    if(changed&&state.map&&state.map.isStyleLoaded())state.map.setStyle(styleUrls[next]);
  }
  function installMapStyle(){
    if(!state.map||!state.map.isStyleLoaded())return;
    state.nativeLayers=state.map.getStyle().layers.map(layer=>({id:layer.id,visibility:layer.layout?.visibility||'visible',keepLabel:layer.type==='symbol'&&Boolean(layer.layout?.['text-field'])}));
    addSatelliteLayer();addRoadContrast();addBuildings();addRouteChevronPattern();
    state.map.addSource('route',{type:'geojson',lineMetrics:true,data:state.route?{type:'Feature',geometry:state.route.geometry,properties:{}}:{type:'FeatureCollection',features:[]}});
    state.map.addLayer({id:'route-casing',type:'line',source:'route',layout:{'line-join':'round','line-cap':'round'},paint:{'line-color':'#073c38','line-width':['interpolate',['linear'],['zoom'],10,9,16,18,19,23],'line-opacity':.9}});
    state.map.addLayer({id:'route-glow',type:'line',source:'route',layout:{'line-join':'round','line-cap':'round'},paint:{'line-color':'#50e4bd','line-width':15,'line-blur':8,'line-opacity':.42}});
    state.map.addLayer({id:'route-core',type:'line',source:'route',layout:{'line-join':'round','line-cap':'round'},paint:{'line-color':'#12ddb2','line-width':['interpolate',['linear'],['zoom'],10,3,16,6,19,8],'line-opacity':1}});
    state.map.addLayer({id:'route-line',type:'line',source:'route',layout:{'line-pattern':'route-chevron','line-width':['interpolate',['linear'],['zoom'],10,8,16,13,19,17],'line-opacity':.98}});
    state.map.addSource('safety-zones',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    state.map.addLayer({id:'safety-zone-casing',type:'line',source:'safety-zones',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#ff9b35','line-width':13,'line-opacity':.2,'line-dasharray':[1,1.5]}});
    state.map.addLayer({id:'safety-zone-line',type:'line',source:'safety-zones',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#ffc65c','line-width':4,'line-opacity':.95,'line-dasharray':[1,1.5]}});
    state.map.addSource('safety-points',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    state.map.addLayer({id:'safety-points-glow',type:'circle',source:'safety-points',paint:{'circle-radius':14,'circle-color':'#ffb648','circle-opacity':.28,'circle-blur':.3}});
    state.map.addLayer({id:'safety-points-core',type:'circle',source:'safety-points',paint:{'circle-radius':6,'circle-color':'#ffd36a','circle-stroke-color':'#fff5db','circle-stroke-width':2}});
    setMapMode(state.mapMode);
    if(state.location)drawLocation();
    if(state.location)refreshSafety(true);
  }
  function initMap(){
    if(!window.maplibregl){toast('La carte n’a pas pu charger. Vérifiez la connexion.');return;}
    state.themeMode=localStorage.getItem('vector-theme')||'auto';
    applyTheme();
    state.map=new maplibregl.Map({container:'map',style:styleUrls[state.effectiveTheme],center:defaultCenter,zoom:16.2,pitch:71,bearing:12,antialias:false,attributionControl:false,fadeDuration:0,maxPitch:75,renderWorldCopies:false});
    state.map.addControl(new maplibregl.NavigationControl({showCompass:false,showZoom:false,visualizePitch:false}),'top-right');
    state.map.on('style.load',installMapStyle);
    state.map.on('rotate',drawLocation);
    state.map.on('error',e=>{if(e?.error?.status>=500)console.warn('Map tile service unavailable',e.error);});
  }
  function addSatelliteLayer(){
    const map=state.map;
    map.addSource('satellite-imagery',{type:'raster',tiles:[satelliteUrl],tileSize:256,maxzoom:19,attribution:'Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community'});
    map.addLayer({id:'satellite-base',type:'raster',source:'satellite-imagery',paint:{'raster-fade-duration':0,'raster-opacity':1,'raster-resampling':'linear'}},map.getStyle().layers[0]?.id);
  }
  function addRouteChevronPattern(){
    const canvas=document.createElement('canvas');canvas.width=64;canvas.height=32;
    const ctx=canvas.getContext('2d');ctx.clearRect(0,0,64,32);
    ctx.shadowColor='#43ffd0';ctx.shadowBlur=10;ctx.strokeStyle='#b6ffed';ctx.lineWidth=4;ctx.lineCap='round';ctx.lineJoin='round';
    for(let x=-20;x<64;x+=32){ctx.beginPath();ctx.moveTo(x,5);ctx.lineTo(x+14,16);ctx.lineTo(x,27);ctx.stroke();}
    state.map.addImage('route-chevron',canvas,{pixelRatio:2});
  }
  function addRoadContrast(){
    const map=state.map;
    const road=map.getStyle().layers.find(layer=>layer['source-layer']==='transportation');
    if(!road)return;
    const before=map.getStyle().layers.find(layer=>layer.type==='symbol'&&layer.layout?.['text-field'])?.id;
    const classes=['motorway','trunk','primary','secondary','tertiary','minor','service','street','track','path','pedestrian'];
    const filter=['in',['get','class'],['literal',classes]];
    const width=['interpolate',['linear'],['zoom'],8,.9,11,1.5,14,2.6,17,4.8,20,7];
    map.addLayer({id:'road-contrast-casing',source:road.source,'source-layer':'transportation',type:'line',filter,layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#16232d','line-width':['+',width,2.2],'line-opacity':.96}},before);
    map.addLayer({id:'road-contrast-core',source:road.source,'source-layer':'transportation',type:'line',filter,layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':['match',['get','class'],['motorway','trunk'],'#ffe19a',['primary','secondary'],'#e9f2f5',['tertiary','minor'],'#cfe0ea',['service','street'],'#bdcfda',['track','path','pedestrian'],'#b9d0c6','#d5e4ec'],'line-width':width,'line-opacity':1}},before);
  }
  function addBuildings(){
    const map=state.map, style=map.getStyle();
    const building=style.layers.find(l=>l['source-layer']==='building');
    if(!building)return;
    const source=building.source, sourceLayer=building['source-layer'];
    const before=style.layers.find(l=>l.type==='symbol'&&l.layout?.['text-field'])?.id;
    map.addLayer({id:'buildings-3d',source,'source-layer':sourceLayer,type:'fill-extrusion',minzoom:14,paint:{'fill-extrusion-color':['interpolate',['linear'],['coalesce',['get','render_height'],10],10,'#a8b8b3',60,'#d1ddd7'],'fill-extrusion-height':['coalesce',['get','render_height'],['*',['coalesce',['get','building:levels'],3],3.2]],'fill-extrusion-base':['coalesce',['get','render_min_height'],0],'fill-extrusion-opacity':.9,'fill-extrusion-vertical-gradient':true}},before);
  }
  function setMapMode(mode){
    if(!state.map)return;
    state.mapMode=mode;
    const satellite=mode==='satellite';
    if(state.map.getLayer('satellite-base'))state.map.setLayoutProperty('satellite-base','visibility',satellite?'visible':'none');
    for(const layer of state.nativeLayers){
      if(!state.map.getLayer(layer.id))continue;
      state.map.setLayoutProperty(layer.id,'visibility',satellite?(layer.keepLabel?'visible':'none'):layer.visibility);
    }
    for(const id of ['road-contrast-casing','road-contrast-core'])if(state.map.getLayer(id))state.map.setLayoutProperty(id,'visibility',satellite?'none':'visible');
    $('view-satellite')?.classList.toggle('active',satellite);
    $('view-map')?.classList.toggle('active',!satellite);
  }
  function cameraZoom(){
    const speed=(state.location?.speed||0)*3.6;
    if(state.distanceToManeuver<180&&speed<40)return 18.9;
    if(speed>70)return 16.35;
    if(speed<30)return 18.1;
    if(state.distanceToManeuver<180)return 17.8;
    return 17.35;
  }
  function updateChaseCamera(){
    if(!state.map||!state.location||!state.navigating)return;
    if(state.cameraMode==='north'){
      state.map.easeTo({center:[state.location.longitude,state.location.latitude],zoom:17.3,bearing:0,pitch:0,duration:760,easing:t=>1-Math.pow(1-t,3)});
      return;
    }
    const height=window.innerHeight||800;
    state.map.easeTo({center:[state.location.longitude,state.location.latitude],zoom:cameraZoom(),bearing:state.heading,pitch:71,offset:[0,Math.round(height*.17)],duration:760,easing:t=>1-Math.pow(1-t,3)});
  }
  function drawLocation(){
    if(!state.map||!state.map.isStyleLoaded()||!state.location)return;
    if(!state.carMarker){
      const el=document.createElement('div');el.className='car-marker';
      el.innerHTML='<svg viewBox="0 0 48 84" aria-hidden="true"><path class="car-shadow" d="M24 3C17 3 13 8 11 17L5 47v20c0 5 3 8 8 8h22c5 0 8-3 8-8V47l-6-30C35 8 31 3 24 3Z"/><path class="car-glass" d="m14 24 3-10c1-3 3-5 7-5s6 2 7 5l3 10z"/><path class="car-body" d="M11 30h26l4 19v17H7V49z"/><path class="car-roof" d="M13 29h22l4 18H9z"/><path class="car-light" d="M9 58h6m18 0h6"/></svg>';
      state.carMarker=new maplibregl.Marker({element:el,anchor:'center',rotationAlignment:'viewport'}).setLngLat([state.location.longitude,state.location.latitude]).addTo(state.map);
    }else state.carMarker.setLngLat([state.location.longitude,state.location.latitude]);
    state.carMarker.setRotation(state.heading-state.map.getBearing());
    state.carMarker.getElement().style.opacity=state.navigating&&state.cameraMode==='3d'?'0':'1';
  }
  function safetyBeep(direction){
    if(!state.navigating||!state.audioContext)return;
    try{const ctx=state.audioContext,osc=ctx.createOscillator(),gain=ctx.createGain();osc.type='sine';osc.frequency.value=direction==='in'?880:660;gain.gain.setValueAtTime(.0001,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(.055,ctx.currentTime+.025);gain.gain.exponentialRampToValueAtTime(.0001,ctx.currentTime+.18);osc.connect(gain);gain.connect(ctx.destination);osc.start();osc.stop(ctx.currentTime+.19);}catch(_){}
  }
  function renderSafety(result,context){
    if(!result)return;
    const zones=state.map?.getSource('safety-zones'),points=state.map?.getSource('safety-points');
    if(zones)zones.setData({type:'FeatureCollection',features:result.zones||[]});
    if(points)points.setData({type:'FeatureCollection',features:result.points||[]});
    const limit=result.speedLimit;
    $('speed-limit').textContent=limit?String(limit):'—';
    const current=Math.round((state.location?.speed||0)*3.6), over=Boolean(limit&&current>limit+2);
    document.querySelector('.speed-readout').classList.toggle('over-limit',over);
    const alert=result.alert, card=$('safety-alert');
    if(alert){
      const labels={'speed-camera':'RADAR FIXE','redlight-camera':'CONTRÔLE FEU','road-hazard':'DANGER ROUTIER'};
      $('safety-alert-title').textContent=alert.precise?labels[alert.kind]||'CONTRÔLE':'ZONE DE VIGILANCE';
      $('safety-alert-distance').textContent=(alert.precise?'Point dans ':'Zone dans ')+formatDistance(alert.distance);
      $('safety-alert-limit').textContent=alert.speedLimit?alert.speedLimit+' km/h':'';
      card.classList.add('visible');
      if(state.safetyAlertKey!==alert.key){safetyBeep('in');state.safetyAlertKey=alert.key;}
    }else{
      card.classList.remove('visible');
      if(state.safetyAlertKey){safetyBeep('out');state.safetyAlertKey='';}
    }
    if(context&&context.country!==state.lastSafetyCountry){
      state.lastSafetyCountry=context.country;
      if(context.mode==='off')toast('Alertes de contrôle désactivées dans cette zone.');
      else if(context.stale)toast('Données de vigilance hors ligne, potentiellement anciennes.');
    }
  }
  async function refreshSafety(force){
    if(!window.SafetyRadar||!state.location)return;
    const now=Date.now();
    if(state.safetyPromise)return;
    if(force||!state.safetyContext||now-state.safetyLastFetch>12000){
      state.safetyLastFetch=now;
      state.safetyPromise=window.SafetyRadar.update(state.location).then(context=>{state.safetyContext=context;return context;}).catch(()=>state.safetyContext).finally(()=>{state.safetyPromise=null;});
    }
    const context=state.safetyPromise?await state.safetyPromise:state.safetyContext;
    if(!context)return;
    const result=window.SafetyRadar.evaluate(context,state.location,state.location.speed,state.routeCoords);
    renderSafety(result,context);
  }
  function closeSettings(){ $('settings-overlay').classList.remove('open');$('settings-overlay').setAttribute('aria-hidden','true'); }
  function openSettings(){ $('settings-overlay').classList.add('open');$('settings-overlay').setAttribute('aria-hidden','false');$('settings-close').focus(); }
  function startGps(){
    if(!('geolocation'in navigator)){setConnection(false,'GPS INDISPONIBLE');return;}
    state.watchId=navigator.geolocation.watchPosition(pos=>{
      const c=pos.coords; const previous=state.location;
      state.location={latitude:c.latitude,longitude:c.longitude,accuracy:c.accuracy,altitude:c.altitude,speed:c.speed,heading:c.heading,timestamp:pos.timestamp};
      if(Number.isFinite(c.heading))state.heading=c.heading;
      $('speed').textContent=Number.isFinite(c.speed)?Math.round(c.speed*3.6):'0';
      $('altitude').innerHTML=Number.isFinite(c.altitude)?`${Math.round(c.altitude)}<small> m</small>`:'—<small> m</small>';
      $('accuracy').innerHTML=Number.isFinite(c.accuracy)?`${Math.round(c.accuracy)}<small> m</small>`:'—<small> m</small>';
      $('heading').textContent=Number.isFinite(state.heading)?`${Math.round(state.heading)}°`:'—';$('heading-arrow').style.transform=`rotate(${state.heading}deg)`;
      setConnection(true,'GPS ACTIF');drawLocation();refreshSafety(false);
      if(state.map&&!previous)state.map.easeTo({center:[c.longitude,c.latitude],zoom:16.5,pitch:64,duration:700});
      if(state.navigating&&previous){updateNavigation(pos);updateChaseCamera();}if(state.navigating)refreshSafety(false);
    },err=>{setConnection(false,err.code===1?'GPS REFUSÉ':'GPS FAIBLE');if(err.code===1)toast('Autorisez la localisation dans les réglages du navigateur.');},{enableHighAccuracy:true,maximumAge:1000,timeout:12000});
  }
  function addBuildings(){
    const map=state.map, style=map.getStyle();
    const building=style.layers.find(l=>l['source-layer']==='building');
    if(!building)return;
    const source=building.source, sourceLayer=building['source-layer'];
    const before=style.layers.find(l=>l.type==='symbol'&&l.layout?.['text-field'])?.id;
    map.addLayer({id:'buildings-3d',source,'source-layer':sourceLayer,type:'fill-extrusion',minzoom:14,paint:{'fill-extrusion-color':['interpolate',['linear'],['coalesce',['get','render_height'],10],10,'#202f31',60,'#435657'],'fill-extrusion-height':['coalesce',['get','render_height'],['*',['coalesce',['get','building:levels'],3],3.2]],'fill-extrusion-base':['coalesce',['get','render_min_height'],0],'fill-extrusion-opacity':.78,'fill-extrusion-vertical-gradient':true}},before);
  }
  function routeRespectsOneWay(route){
    return route.legs.every(leg=>leg.steps.every(step=>(step.intersections||[]).every(intersection=>{
      if(!Number.isInteger(intersection.out)||!Array.isArray(intersection.entry))return true;
      return intersection.entry[intersection.out]!==false;
    })));
  }
  function openSearch(){ $('search-overlay').classList.add('open');$('search-overlay').setAttribute('aria-hidden','false');setTimeout(()=>$('destination-input').focus(),60); }
  function closeSearch(){ $('search-overlay').classList.remove('open');$('search-overlay').setAttribute('aria-hidden','true');$('suggestions').innerHTML=''; }
  function geocode(query){ return fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&addressdetails=1&q=${encodeURIComponent(query)}`,{headers:{'Accept-Language':'fr-BE,fr;q=0.9'}}).then(r=>{if(!r.ok)throw Error('Recherche indisponible');return r.json();}); }
  function showSuggestions(items){ const box=$('suggestions');box.innerHTML='';items.forEach(item=>{const b=document.createElement('button');b.className='suggestion';b.innerHTML='<i>⌖</i><span></span>';b.querySelector('span').textContent=item.display_name;b.addEventListener('click',()=>{state.destination={lat:Number(item.lat),lon:Number(item.lon),name:item.display_name};$('destination-input').value=item.display_name.split(',').slice(0,2).join(',');box.innerHTML='';});box.appendChild(b);}); }
  function useCurrent(){ if(!state.location){toast('Position GPS pas encore disponible.');return;} $('origin-input').value='Ma position actuelle'; }
  async function calculateRoute(){
    const query=$('destination-input').value.trim();
    if(!state.destination&&query){try{const found=await geocode(query);if(!found.length){toast('Destination introuvable.');return;}state.destination={lat:Number(found[0].lat),lon:Number(found[0].lon),name:found[0].display_name};}catch{toast('Recherche indisponible. Réessayez.');return;}}
    if(!state.destination){toast('Saisissez une destination.');return;}
    const start=state.location?[state.location.longitude,state.location.latitude]:defaultCenter;
    const end=[state.destination.lon,state.destination.lat];
    $('calculate-route').textContent='CALCUL EN COURS…';
    try{
      const url=`https://router.project-osrm.org/route/v1/driving/${start.join(',')};${end.join(',')}?overview=full&geometries=geojson&steps=true&alternatives=true`;
      const response=await fetch(url);if(!response.ok)throw Error('Route indisponible');const data=await response.json();if(data.code!=='Ok'||!data.routes?.length)throw Error('Aucun itinéraire trouvé');
      if(!routeRespectsOneWay(data.routes[0]))throw new Error('ROUTE_RESTRICTED');
      state.route=data.routes[0];state.routeCoords=state.route.geometry.coordinates;state.steps=state.route.legs.flatMap(leg=>leg.steps).filter(step=>step.distance>0);state.stepIndex=0;state.lastSpoken=-1;state.lastAnnouncedStep=-1;state.lastVoiceBucket=500;
      if(state.map.getSource('route'))state.map.getSource('route').setData({type:'Feature',geometry:state.route.geometry,properties:{}});
      state.markers.forEach(m=>m.remove());state.markers=[];
      for(const [coord,cls] of [[start,'start'],[end,'']]){const el=document.createElement('div');el.className=`route-marker ${cls}`;state.markers.push(new maplibregl.Marker({element:el}).setLngLat(coord).addTo(state.map));}
      const bounds=state.routeCoords.reduce((b,p)=>b.extend(p),new maplibregl.LngLatBounds(state.routeCoords[0],state.routeCoords[0]));state.map.fitBounds(bounds,{padding:{top:185,bottom:190,left:370,right:360},duration:850,maxZoom:17});
      renderRouteCard();closeSearch();toast('Itinéraire prêt. Les consignes sont indicatives.');
    }catch(e){toast(e.message==='Failed to fetch'?'Service de calcul indisponible.':e.message==='ROUTE_RESTRICTED'?'Trajet refusé : une sortie semble interdite.':'Impossible de calculer cet itinéraire.');}
    finally{$('calculate-route').innerHTML='CALCULER L’ITINÉRAIRE <span>→</span>';}
  }
  function renderRouteCard(){
    $('route-panel').classList.add('visible');$('route-title').textContent=state.destination.name.split(',').slice(0,2).join(',');$('route-distance').textContent=`${(state.route.distance/1000).toFixed(1).replace('.',',')} km`;$('route-time').textContent=formatDuration(state.route.duration);
    $('route-eta').textContent=new Intl.DateTimeFormat('fr-BE',{hour:'2-digit',minute:'2-digit'}).format(new Date(Date.now()+state.route.duration*1000));$('route-status').textContent=`${state.route.legs[0].steps.length} segments · sens uniques OSM`;$('start-nav').disabled=false;
    setManeuver(state.steps[0],0);
  }
  function maneuverDescription(step){const type=step?.maneuver?.type, mod=step?.maneuver?.modifier;const text={depart:'Continuez',arrive:'Vous êtes arrivé',turn:mod==='left'?'Tournez à gauche':mod==='right'?'Tournez à droite':`Tournez ${mod||''}`,fork:mod==='left'?'Prenez la branche gauche':'Prenez la branche droite',roundabout:'Au rond-point, prenez la sortie',merge:'Rejoignez la voie','new name':'Continuez sur'};return text[type]||'Continuez';}
  function arrowPath(step){const mod=step?.maneuver?.modifier||'';let d='M24 39V11m0 0L13 22m11-11 11 11';if(mod.includes('right'))d='M10 39V24q0-7 7-7h18m0 0L25 7m10 10L25 28';if(mod.includes('left'))d='M38 39V24q0-7-7-7H13m0 0L23 7m-10 10 10 11';if(mod.includes('uturn'))d='M34 39V20q0-10-10-10t-10 10v2m0 0 8-8m-8 8-8-8';return d;}
  function setManeuver(step, distance){if(!step){$('maneuver-label').textContent='ARRIVÉE';$('maneuver-distance').textContent='';$('maneuver-street').textContent='Vous êtes arrivé';return;}const icon=$('maneuver-icon').querySelector('svg path');icon.setAttribute('d',arrowPath(step));$('maneuver-label').textContent=maneuverDescription(step).toUpperCase();$('maneuver-distance').textContent=formatDistance(distance||step.distance);$('maneuver-street').textContent=step.name||'Suivez la route';$('next-step-short').textContent=`${maneuverDescription(step)} ${step.name||''}`;}
  function haversine(a,b){const rad=x=>x*Math.PI/180, dLat=rad(b[1]-a[1]),dLon=rad(b[0]-a[0]);const x=Math.sin(dLat/2)**2+Math.cos(rad(a[1]))*Math.cos(rad(b[1]))*Math.sin(dLon/2)**2;return 6371000*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));}
  function nearestRouteProgress(point){let best={distance:Infinity,index:0,progress:0};let total=0;for(let i=1;i<state.routeCoords.length;i++){const segment=haversine(state.routeCoords[i-1],state.routeCoords[i]);const d=haversine(point,state.routeCoords[i]);if(d<best.distance)best={distance:d,index:i,progress:total};total+=segment;}return {...best,total};}
  function updateNavigation(pos){if(!state.route||!state.location)return;const n=nearestRouteProgress([state.location.longitude,state.location.latitude]);const progress=Math.min(.99,n.progress/n.total);$('progress-bar').style.width=`${progress*100}%`;const remain=Math.max(0,state.route.distance-n.progress);$('route-distance').textContent=`${(remain/1000).toFixed(1).replace('.',',')} km`;$('route-time').textContent=formatDuration(Math.max(0,state.route.duration*(1-progress)));$('route-eta').textContent=new Intl.DateTimeFormat('fr-BE',{hour:'2-digit',minute:'2-digit'}).format(new Date(Date.now()+Math.max(0,state.route.duration*(1-progress))*1000));
    let cumulative=0,idx=0;for(let i=0;i<state.steps.length;i++){cumulative+=state.steps[i].distance;if(n.progress<cumulative){idx=i;break;}idx=Math.min(i+1,state.steps.length-1);}state.stepIndex=Math.max(state.stepIndex,idx);const step=state.steps[state.stepIndex];let distanceToStep=0;for(let i=0;i<=state.stepIndex;i++)distanceToStep+=state.steps[i].distance;distanceToStep=Math.max(0,distanceToStep-n.progress);state.distanceToManeuver=distanceToStep;setManeuver(step,distanceToStep);
    if(n.distance>90&&state.lastSpoken!==-2){toast('Vous semblez éloigné du tracé. Vérifiez la route.');state.lastSpoken=-2;}
    if(state.stepIndex!==state.lastAnnouncedStep){state.lastAnnouncedStep=state.stepIndex;state.lastVoiceBucket=500;}
    if(step&&distanceToStep<=450&&distanceToStep>0){const bucket=distanceToStep>250?400:distanceToStep>150?200:distanceToStep>65?100:30;if(bucket<state.lastVoiceBucket){speak(`${maneuverDescription(step)} ${step.name||''}, dans ${bucket} mètres`);state.lastVoiceBucket=bucket;}}
  }
  function speak(text){if(!('speechSynthesis'in window))return;speechSynthesis.cancel();speechSynthesis.speak(new SpeechSynthesisUtterance(text));}
  function beginNavigation(){if(!state.route)return;state.navigating=true;try{state.audioContext=state.audioContext||new (window.AudioContext||window.webkitAudioContext)();state.audioContext.resume();}catch(_){}document.querySelector('.app-shell').classList.add('nav-guiding','camera-3d');$('nav-footer').classList.add('active');$('start-nav').disabled=true;$('start-nav').textContent='GUIDAGE ACTIF';drawLocation();updateChaseCamera();refreshSafety(true);toast('Guidage lancé. Gardez les yeux sur la route.');if(state.steps[0])speak(`${maneuverDescription(state.steps[0])}, ${formatDistance(state.steps[0].distance)}`);}
  function endNavigation(){state.navigating=false;state.safetyAlertKey='';$('safety-alert').classList.remove('visible');document.querySelector('.app-shell').classList.remove('nav-guiding','camera-3d');$('nav-footer').classList.remove('active');$('start-nav').disabled=false;$('start-nav').innerHTML='COMMENCER <span>↗</span>';speechSynthesis?.cancel?.();if(state.route)state.map.fitBounds(state.routeCoords.reduce((b,p)=>b.extend(p),new maplibregl.LngLatBounds(state.routeCoords[0],state.routeCoords[0])),{padding:100,duration:650});}
  function clearRoute(){endNavigation();state.route=null;state.destination=null;state.steps=[];state.routeCoords=[];$('route-panel').classList.remove('visible');$('start-nav').disabled=true;$('progress-bar').style.width='0';$('destination-input').value='';if(state.map?.getSource('route'))state.map.getSource('route').setData({type:'FeatureCollection',features:[]});state.markers.forEach(m=>m.remove());state.markers=[];if(state.map?.getSource('safety-zones'))state.map.getSource('safety-zones').setData({type:'FeatureCollection',features:[]});refreshSafety(true);}
  function setView(mode){if(!state.map)return;if(mode==='satellite'||mode==='map'){setMapMode(mode);return;}const is3d=mode==='3d';state.cameraMode=is3d?'3d':'north';document.querySelector('.app-shell').classList.toggle('camera-3d',is3d);drawLocation();$('view-3d').classList.toggle('active',is3d);$('view-2d').classList.toggle('active',!is3d);if(state.navigating){updateChaseCamera();return;}state.map.easeTo({pitch:is3d?71:0,bearing:is3d?state.heading:0,duration:650});}
  function bind(){
    $('settings-open').addEventListener('click',openSettings);$('settings-close').addEventListener('click',closeSettings);$('settings-overlay').addEventListener('click',e=>{if(e.target===$('settings-overlay'))closeSettings();});document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeSearch();closeSettings();}});document.querySelectorAll('input[name="theme-mode"]').forEach(input=>input.addEventListener('change',e=>{state.themeMode=e.target.value;localStorage.setItem('vector-theme',state.themeMode);applyTheme();}));if(window.matchMedia){window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change',()=>{if(state.themeMode==='auto')applyTheme();});}
    $('search-open').addEventListener('click',openSearch);$('search-close').addEventListener('click',closeSearch);$('search-overlay').addEventListener('click',e=>{if(e.target===$('search-overlay'))closeSearch();});$('use-current').addEventListener('click',useCurrent);$('clear-destination').addEventListener('click',()=>{$('destination-input').value='';state.destination=null;$('suggestions').innerHTML='';});$('calculate-route').addEventListener('click',calculateRoute);$('start-nav').addEventListener('click',beginNavigation);$('close-route').addEventListener('click',clearRoute);$('end-nav').addEventListener('click',endNavigation);$('view-3d').addEventListener('click',()=>setView('3d'));$('view-2d').addEventListener('click',()=>setView('2d'));$('view-satellite').addEventListener('click',()=>setView(state.mapMode==='satellite'?'map':'satellite'));$('view-map').addEventListener('click',()=>setView('map'));$('recenter').addEventListener('click',()=>{if(state.location){if(state.navigating)updateChaseCamera();else state.map.easeTo({center:[state.location.longitude,state.location.latitude],zoom:16.5,pitch:64,duration:600});}else toast('Attente d’une position GPS.');});
    $('soc-input').addEventListener('change',e=>{const v=Math.max(0,Math.min(100,Number(e.target.value)||0));e.target.value=v;localStorage.setItem('vector-soc',String(v));});const saved=localStorage.getItem('vector-soc');if(saved!==null)$('soc-input').value=saved;
    $('destination-input').addEventListener('input',e=>{clearTimeout(state.searchTimer);state.destination=null;const q=e.target.value.trim();if(q.length<3){$('suggestions').innerHTML='';return;}state.searchTimer=setTimeout(async()=>{try{showSuggestions(await geocode(q));}catch{$('suggestions').innerHTML='';}},350);});$('destination-input').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();calculateRoute();}});
    $('origin-input').addEventListener('focus',useCurrent);
    if('DeviceOrientationEvent'in window)window.addEventListener('deviceorientationabsolute',e=>{if(!Number.isFinite(e.alpha)||state.location?.speed>2)return;state.heading=(360-e.alpha)%360;$('heading').textContent=`${Math.round(state.heading)}°`;drawLocation();},{passive:true});
    if('serviceWorker'in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('/service-worker.js').catch(()=>{});
  }
  updateClock();setInterval(updateClock,15000);bind();initMap();startGps();
})();
