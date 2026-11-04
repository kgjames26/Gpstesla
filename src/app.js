(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const state = { map:null, location:null, destination:null, route:null, steps:[], stepIndex:0, watchId:null, navigating:false, heading:0, lastSpoken:-1, lastAnnouncedStep:-1, lastVoiceBucket:500, markers:[], routeCoords:[], lastRouteProgress:0, toastTimer:null, searchTimer:null };
  const defaultCenter = [4.533, 50.337];
  const styleUrl = 'https://tiles.openfreemap.org/styles/dark';
  const compact = new Intl.NumberFormat('fr-BE', { maximumFractionDigits: 0 });

  function toast(message) { const el=$('toast'); el.textContent=message; el.classList.add('show'); clearTimeout(state.toastTimer); state.toastTimer=setTimeout(()=>el.classList.remove('show'),2600); }
  function updateClock(){ $('clock').textContent=new Intl.DateTimeFormat('fr-BE',{hour:'2-digit',minute:'2-digit'}).format(new Date()); }
  function formatDistance(m){return m<1000?`${Math.max(10,Math.round(m/10)*10)} m`:`${(m/1000).toFixed(m<10000?1:0).replace('.',',')} km`;}
  function formatDuration(s){const mins=Math.max(1,Math.round(s/60));return mins>=60?`${Math.floor(mins/60)} h ${String(mins%60).padStart(2,'0')}`:`${mins} min`;}
  function setConnection(ok,label){$('gps-status').textContent=label;$('gps-status').parentElement.classList.toggle('online',ok);}
  function initMap(){
    if(!window.maplibregl){toast('La carte n’a pas pu charger. Vérifiez la connexion.');return;}
    state.map=new maplibregl.Map({container:'map',style:styleUrl,center:defaultCenter,zoom:15.4,pitch:62,bearing:12,antialias:false,attributionControl:false,fadeDuration:0,maxPitch:68,renderWorldCopies:false});
    state.map.addControl(new maplibregl.NavigationControl({showCompass:false,showZoom:false,visualizePitch:false}),'top-right');
    state.map.on('load',()=>{
      addBuildings();
      state.map.addSource('route',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
      state.map.addLayer({id:'route-glow',type:'line',source:'route',layout:{'line-join':'round','line-cap':'round'},paint:{'line-color':'#50e4bd','line-width':13,'line-blur':7,'line-opacity':.22}});
      state.map.addLayer({id:'route-line',type:'line',source:'route',layout:{'line-join':'round','line-cap':'round'},paint:{'line-color':'#61f1cb','line-width':['interpolate',['linear'],['zoom'],10,4,16,7,19,9],'line-opacity':.95}});
      if(state.location)drawLocation();
    });
    state.map.on('error',e=>{if(e?.error?.status>=500)console.warn('Map tile service unavailable',e.error);});
  }
  function drawLocation(){
    if(!state.map||!state.map.isStyleLoaded()||!state.location)return;
    if(state.carMarker)state.carMarker.remove();
    const el=document.createElement('div');el.className='car-marker';el.style.transform=`rotate(${state.heading}deg)`;
    state.carMarker=new maplibregl.Marker({element:el,anchor:'center'}).setLngLat([state.location.longitude,state.location.latitude]).addTo(state.map);
  }
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
      setConnection(true,'GPS ACTIF');drawLocation();
      if(state.map&&(!previous||state.navigating)){
        const far=!state.destination;
        state.map.easeTo({center:[c.longitude,c.latitude],zoom:far?16.3:state.map.getZoom(),bearing:state.navigating?state.heading:state.map.getBearing(),pitch:state.navigating?62:state.map.getPitch(),duration:700});
      }
      if(state.navigating&&previous) updateNavigation(pos);
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
      state.route=data.routes[0];state.routeCoords=state.route.geometry.coordinates;state.steps=state.route.legs.flatMap(leg=>leg.steps).filter(step=>step.distance>0);state.stepIndex=0;state.lastSpoken=-1;state.lastAnnouncedStep=-1;state.lastVoiceBucket=500;
      state.map.getSource('route').setData({type:'Feature',geometry:state.route.geometry,properties:{}});
      state.markers.forEach(m=>m.remove());state.markers=[];
      for(const [coord,cls] of [[start,'start'],[end,'']]){const el=document.createElement('div');el.className=`route-marker ${cls}`;state.markers.push(new maplibregl.Marker({element:el}).setLngLat(coord).addTo(state.map));}
      const bounds=state.routeCoords.reduce((b,p)=>b.extend(p),new maplibregl.LngLatBounds(state.routeCoords[0],state.routeCoords[0]));state.map.fitBounds(bounds,{padding:{top:185,bottom:190,left:370,right:360},duration:850,maxZoom:17});
      renderRouteCard();closeSearch();toast('Itinéraire prêt. Les consignes sont indicatives.');
    }catch(e){toast(e.message==='Failed to fetch'?'Service de calcul indisponible.':'Impossible de calculer cet itinéraire.');}
    finally{$('calculate-route').innerHTML='CALCULER L’ITINÉRAIRE <span>→</span>';}
  }
  function renderRouteCard(){
    $('route-panel').classList.add('visible');$('route-title').textContent=state.destination.name.split(',').slice(0,2).join(',');$('route-distance').textContent=`${(state.route.distance/1000).toFixed(1).replace('.',',')} km`;$('route-time').textContent=formatDuration(state.route.duration);
    $('route-eta').textContent=new Intl.DateTimeFormat('fr-BE',{hour:'2-digit',minute:'2-digit'}).format(new Date(Date.now()+state.route.duration*1000));$('route-status').textContent=`${state.route.legs[0].steps.length} segments · estimation routière`;$('start-nav').disabled=false;
    setManeuver(state.steps[0],0);
  }
  function maneuverDescription(step){const type=step?.maneuver?.type, mod=step?.maneuver?.modifier;const text={depart:'Continuez',arrive:'Vous êtes arrivé',turn:mod==='left'?'Tournez à gauche':mod==='right'?'Tournez à droite':`Tournez ${mod||''}`,fork:mod==='left'?'Prenez la branche gauche':'Prenez la branche droite',roundabout:'Au rond-point, prenez la sortie',merge:'Rejoignez la voie','new name':'Continuez sur'};return text[type]||'Continuez';}
  function arrowPath(step){const mod=step?.maneuver?.modifier||'';let d='M24 39V11m0 0L13 22m11-11 11 11';if(mod.includes('right'))d='M10 39V24q0-7 7-7h18m0 0L25 7m10 10L25 28';if(mod.includes('left'))d='M38 39V24q0-7-7-7H13m0 0L23 7m-10 10 10 11';if(mod.includes('uturn'))d='M34 39V20q0-10-10-10t-10 10v2m0 0 8-8m-8 8-8-8';return d;}
  function setManeuver(step, distance){if(!step){$('maneuver-label').textContent='ARRIVÉE';$('maneuver-distance').textContent='';$('maneuver-street').textContent='Vous êtes arrivé';return;}const icon=$('maneuver-icon').querySelector('svg path');icon.setAttribute('d',arrowPath(step));$('maneuver-label').textContent=maneuverDescription(step).toUpperCase();$('maneuver-distance').textContent=formatDistance(distance||step.distance);$('maneuver-street').textContent=step.name||'Suivez la route';$('next-step-short').textContent=`${maneuverDescription(step)} ${step.name||''}`;}
  function haversine(a,b){const rad=x=>x*Math.PI/180, dLat=rad(b[1]-a[1]),dLon=rad(b[0]-a[0]);const x=Math.sin(dLat/2)**2+Math.cos(rad(a[1]))*Math.cos(rad(b[1]))*Math.sin(dLon/2)**2;return 6371000*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));}
  function nearestRouteProgress(point){let best={distance:Infinity,index:0,progress:0};let total=0;for(let i=1;i<state.routeCoords.length;i++){const segment=haversine(state.routeCoords[i-1],state.routeCoords[i]);const d=haversine(point,state.routeCoords[i]);if(d<best.distance)best={distance:d,index:i,progress:total};total+=segment;}return {...best,total};}
  function updateNavigation(pos){if(!state.route||!state.location)return;const n=nearestRouteProgress([state.location.longitude,state.location.latitude]);const progress=Math.min(.99,n.progress/n.total);$('progress-bar').style.width=`${progress*100}%`;const remain=Math.max(0,state.route.distance-n.progress);$('route-distance').textContent=`${(remain/1000).toFixed(1).replace('.',',')} km`;$('route-time').textContent=formatDuration(Math.max(0,state.route.duration*(1-progress)));$('route-eta').textContent=new Intl.DateTimeFormat('fr-BE',{hour:'2-digit',minute:'2-digit'}).format(new Date(Date.now()+Math.max(0,state.route.duration*(1-progress))*1000));
    let cumulative=0,idx=0;for(let i=0;i<state.steps.length;i++){cumulative+=state.steps[i].distance;if(n.progress<cumulative){idx=i;break;}idx=Math.min(i+1,state.steps.length-1);}state.stepIndex=Math.max(state.stepIndex,idx);const step=state.steps[state.stepIndex];let distanceToStep=0;for(let i=0;i<=state.stepIndex;i++)distanceToStep+=state.steps[i].distance;distanceToStep=Math.max(0,distanceToStep-n.progress);setManeuver(step,distanceToStep);
    if(n.distance>90&&state.lastSpoken!==-2){toast('Vous semblez éloigné du tracé. Vérifiez la route.');state.lastSpoken=-2;}
    if(state.stepIndex!==state.lastAnnouncedStep){state.lastAnnouncedStep=state.stepIndex;state.lastVoiceBucket=500;}
    if(step&&distanceToStep<=450&&distanceToStep>0){const bucket=distanceToStep>250?400:distanceToStep>150?200:distanceToStep>65?100:30;if(bucket<state.lastVoiceBucket){speak(`${maneuverDescription(step)} ${step.name||''}, dans ${bucket} mètres`);state.lastVoiceBucket=bucket;}}
  }
  function speak(text){if(!('speechSynthesis'in window))return;speechSynthesis.cancel();speechSynthesis.speak(new SpeechSynthesisUtterance(text));}
  function beginNavigation(){if(!state.route)return;state.navigating=true;$('nav-footer').classList.add('active');$('start-nav').disabled=true;$('start-nav').textContent='GUIDAGE ACTIF';state.map.easeTo({center:state.location?[state.location.longitude,state.location.latitude]:state.routeCoords[0],zoom:17.2,pitch:64,bearing:state.heading,duration:950});toast('Guidage lancé. Gardez les yeux sur la route.');if(state.steps[0])speak(`${maneuverDescription(state.steps[0])}, ${formatDistance(state.steps[0].distance)}`);}
  function endNavigation(){state.navigating=false;$('nav-footer').classList.remove('active');$('start-nav').disabled=false;$('start-nav').innerHTML='COMMENCER <span>↗</span>';speechSynthesis?.cancel?.();if(state.route)state.map.fitBounds(state.routeCoords.reduce((b,p)=>b.extend(p),new maplibregl.LngLatBounds(state.routeCoords[0],state.routeCoords[0])),{padding:100,duration:650});}
  function clearRoute(){endNavigation();state.route=null;state.destination=null;state.steps=[];$('route-panel').classList.remove('visible');$('start-nav').disabled=true;$('progress-bar').style.width='0';$('destination-input').value='';if(state.map?.getSource('route'))state.map.getSource('route').setData({type:'FeatureCollection',features:[]});state.markers.forEach(m=>m.remove());state.markers=[];}
  function setView(mode){if(!state.map)return;const is3d=mode==='3d';$('view-3d').classList.toggle('active',is3d);$('view-2d').classList.toggle('active',!is3d);state.map.easeTo({pitch:is3d?62:0,bearing:is3d?state.heading:0,duration:500});}
  function bind(){
    $('search-open').addEventListener('click',openSearch);$('search-close').addEventListener('click',closeSearch);$('search-overlay').addEventListener('click',e=>{if(e.target===$('search-overlay'))closeSearch();});$('use-current').addEventListener('click',useCurrent);$('clear-destination').addEventListener('click',()=>{$('destination-input').value='';state.destination=null;$('suggestions').innerHTML='';});$('calculate-route').addEventListener('click',calculateRoute);$('start-nav').addEventListener('click',beginNavigation);$('close-route').addEventListener('click',clearRoute);$('end-nav').addEventListener('click',endNavigation);$('view-3d').addEventListener('click',()=>setView('3d'));$('view-2d').addEventListener('click',()=>setView('2d'));$('recenter').addEventListener('click',()=>{if(state.location)state.map.easeTo({center:[state.location.longitude,state.location.latitude],zoom:state.navigating?17.3:16.3,bearing:state.navigating?state.heading:state.map.getBearing(),pitch:state.navigating?64:state.map.getPitch(),duration:550});else toast('Attente d’une position GPS.');});
    $('soc-input').addEventListener('change',e=>{const v=Math.max(0,Math.min(100,Number(e.target.value)||0));e.target.value=v;localStorage.setItem('vector-soc',String(v));});const saved=localStorage.getItem('vector-soc');if(saved!==null)$('soc-input').value=saved;
    $('destination-input').addEventListener('input',e=>{clearTimeout(state.searchTimer);state.destination=null;const q=e.target.value.trim();if(q.length<3){$('suggestions').innerHTML='';return;}state.searchTimer=setTimeout(async()=>{try{showSuggestions(await geocode(q));}catch{$('suggestions').innerHTML='';}},350);});$('destination-input').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();calculateRoute();}});
    $('origin-input').addEventListener('focus',useCurrent);
    if('DeviceOrientationEvent'in window)window.addEventListener('deviceorientationabsolute',e=>{if(!Number.isFinite(e.alpha)||state.location?.speed>2)return;state.heading=(360-e.alpha)%360;$('heading').textContent=`${Math.round(state.heading)}°`;drawLocation();},{passive:true});
    if('serviceWorker'in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('/service-worker.js').catch(()=>{});
  }
  updateClock();setInterval(updateClock,15000);bind();initMap();startGps();
})();
