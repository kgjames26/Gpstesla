const TILE_URL='https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const mapEl=document.getElementById('map'),geoLayer=document.getElementById('geo-layer'),tileLayer=document.getElementById('tiles'),radarLayer=document.getElementById('radars'),vehicle=document.getElementById('vehicle');
const vehicleImage=document.getElementById('vehicle-image'),carArtwork={north:'',rear:''};
const speedEl=document.getElementById('speed'),gpsEl=document.getElementById('gps-status'),recenter=document.getElementById('recenter'),soundButton=document.getElementById('sound-toggle'),orientationButton=document.getElementById('orientation-toggle'),guidance=document.getElementById('guidance'),form=document.getElementById('navigation'),searchToggle=document.getElementById('search-toggle'),destinationInput=document.getElementById('destination'),submitButton=document.getElementById('route-submit'),suggestions=document.getElementById('suggestions');
const state={center:[4.6,50.55],zoom:16,position:null,previousPosition:null,lastPosition:null,heading:null,speed:0,follow:true,tilesKey:'',tilesOrigin:null,radars:[],country:'',radarCell:'',radarFetchedAt:0,audio:null,beepOn:localStorage.getItem('radar-sound')!=='off',orientation:localStorage.getItem('map-orientation')||'north',destination:null,route:null,steps:[],stepIndex:0,turnReached:false,turnBestDistance:Infinity,navigating:false,offRouteCount:0,searchTimer:null,searchAbort:null};
const CONTINENT_COUNTRIES={
 EU:'AD AL AT AX BA BE BG BY CH CY CZ DE DK EE ES FI FO FR GB GG GI GR HR HU IE IM IS IT JE LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS SE SI SK SM UA VA XK',
 AS:'AE AF AM AZ BD BH BN BT CN CX GE HK ID IL IN IO IQ IR IR JP JO KG KH KP KR KW KZ LA LB LK MM MN MO MV MY NP OM PH PK PS QA RU SA SG SY TH TJ TM TL TR TW UZ VN YE',
 AF:'AO BF BI BJ BW CD CF CG CI CM CV DJ DZ EG ER ESW ET GA GH GM GN GQ GW KE KM LR LS LY MA MG ML MR MU MW MZ NA NE NG RW SC SD SN SO SS ST SZ TD TG TN TZ UG ZA ZM ZW EH',
 NA:'AG AI AN AW BB BL BM BQ BS BZ CA CR CU CW DM DO GD GL GP GT HN HT JM KN KY LC MF MQ MS MX NI PA PR SV SX TC TT US VC VG VI',
 SA:'AR BO BR CL CO EC FK GF GY PE PY SR UY VE',
 OC:'AS AU CK FJ FM GU KI MH MP NC NF NR NU NZ PF PG PW SB TK TO TV VU WF WS',
 AN:'AQ'
};
function continentCodesFor(countryCode,position){
 const code=String(countryCode||'').toUpperCase(),lon=Number(position?.longitude);
 if(!code)return[];
 let group=null;
 if(code==='RU')group=lon<60?'EU':'AS';
 else if(code==='TR')group=lon<30?'EU':'AS';
 else if(code==='KZ')group=lon<60?'EU':'AS';
 else if(code==='EG')group=lon>34.5?'AS':'AF';
 else group=Object.keys(CONTINENT_COUNTRIES).find(key=>CONTINENT_COUNTRIES[key].split(' ').includes(code))||null;
 const codes=group?CONTINENT_COUNTRIES[group].split(' '):[];if(!codes.includes(code))codes.push(code);return codes;
}
const alerted=new Set();
function mercator(lon,lat,z=state.zoom){const size=256*2**z,phi=Math.max(-85.0511,Math.min(85.0511,lat))*Math.PI/180;return{x:(lon+180)/360*size,y:(.5-Math.log((1+Math.sin(phi))/(1-Math.sin(phi)))/(4*Math.PI))*size}}
function unproject(x,y,z=state.zoom){const size=256*2**z,n=Math.PI-2*Math.PI*y/size;return[(x/size*360)-180,180/Math.PI*Math.atan(Math.sinh(n))]}
function tileUrl(x,y,z){const n=2**z;return TILE_URL.replace('{z}',String(z)).replace('{y}',String(y)).replace('{x}',String((x%n+n)%n))}
function drawTiles(){const w=mapEl.clientWidth,h=mapEl.clientHeight,c=mercator(...state.center),sx=Math.floor(c.x/256),sy=Math.floor(c.y/256),cols=Math.ceil(w/256)+2,rows=Math.ceil(h/256)+2,minX=sx-Math.floor(cols/2),minY=sy-Math.floor(rows/2),key=[state.zoom,minX,minY,cols,rows].join(':');
 if(key!==state.tilesKey){state.tilesKey=key;state.tilesOrigin=[minX,minY];tileLayer.replaceChildren();const n=2**state.zoom;for(let y=minY;y<minY+rows;y++)for(let x=minX;x<minX+cols;x++){if(y<0||y>=n)continue;const img=document.createElement('img');img.alt='';img.draggable=false;img.decoding='async';img.src=tileUrl(x,y,state.zoom);img.style.left=((x-minX)*256)+'px';img.style.top=((y-minY)*256)+'px';tileLayer.append(img)}}
 const o=state.tilesOrigin||[minX,minY];tileLayer.style.transform='translate('+(w/2-(c.x-o[0]*256))+'px,'+(h/2-(c.y-o[1]*256))+'px)'}
function geoPoint(lon,lat){const p=mercator(lon,lat),c=mercator(...state.center);return{x:mapEl.clientWidth/2+p.x-c.x,y:mapEl.clientHeight/2+p.y-c.y}}
function placeElement(el,lon,lat){const p=geoPoint(lon,lat);el.style.left=p.x+'px';el.style.top=p.y+'px'}
function drawRoute(){const casing=document.getElementById('route-casing'),line=document.getElementById('route-line'),svg=document.getElementById('route-layer');if(!state.route){casing.setAttribute('d','');line.setAttribute('d','');return}svg.setAttribute('viewBox','0 0 '+mapEl.clientWidth+' '+mapEl.clientHeight);const d=state.route.geometry.coordinates.map((coord,i)=>{const p=geoPoint(coord[0],coord[1]);return(i?'L':'M')+p.x.toFixed(1)+' '+p.y.toFixed(1)}).join(' ');casing.setAttribute('d',d);line.setAttribute('d',d)}
function drawOverlays(){const angle=state.orientation==='heading'&&state.heading!==null?-state.heading:0;geoLayer.style.transform='rotate('+angle+'deg)';if(state.position){vehicle.hidden=false;placeElement(vehicle,state.position.longitude,state.position.latitude);vehicle.classList.toggle('heading-view',state.orientation==='heading');vehicle.classList.toggle('north-view',state.orientation==='north');vehicleImage.alt=state.orientation==='heading'?'Tesla Model 3 blanche vue arrière 3D':'Tesla Model 3 blanche vue 3D du dessus';vehicleImage.style.setProperty('--car-rotation',(state.heading||0)+'deg');const mode=state.orientation==='heading'?'rear':'north',src=carArtwork[mode];if(src&&vehicleImage.dataset.artMode!==mode){vehicleImage.src=src;vehicleImage.dataset.artMode=mode}}else vehicle.hidden=true;radarLayer.replaceChildren();for(const radar of state.radars){const pin=document.createElement('i');pin.className='radar-pin';pin.setAttribute('aria-label','Radar fixe'+(radar.speedLimit?' · '+radar.speedLimit+' km/h':''));placeElement(pin,radar.geometry.coordinates[0],radar.geometry.coordinates[1]);radarLayer.append(pin)}drawRoute()}
function render(){drawTiles();drawOverlays();orientationButton.classList.toggle('heading-up',state.orientation==='heading');orientationButton.classList.toggle('north-up',state.orientation==='north');orientationButton.setAttribute('aria-label',state.orientation==='north'?'Orientation : nord en haut':'Orientation : cap du véhicule en haut');orientationButton.title=state.orientation==='north'?'Passer au cap du véhicule':'Passer au nord en haut';document.getElementById('orientation-label').textContent=state.orientation==='north'?'N':'▲'}
function setGps(text,kind='searching'){gpsEl.className='gps-status '+kind;gpsEl.title=text;gpsEl.setAttribute('aria-label',text)}
function showMessage(text){const el=document.getElementById('message');el.textContent=text;el.hidden=false;clearTimeout(showMessage.timer);showMessage.timer=setTimeout(()=>el.hidden=true,5000)}
function bearing(a,b){const r=n=>n*Math.PI/180,lat1=r(a.latitude),lat2=r(b.latitude),dlon=r(b.longitude-a.longitude),y=Math.sin(dlon)*Math.cos(lat2),x=Math.cos(lat1)*Math.sin(lat2)-Math.sin(lat1)*Math.cos(lat2)*Math.cos(dlon);return(Math.atan2(y,x)*180/Math.PI+360)%360}
function meters(a,b){const r=n=>n*Math.PI/180,dl=r(b.latitude-a.latitude),dn=r(b.longitude-a.longitude),q=Math.sin(dl/2)**2+Math.cos(r(a.latitude))*Math.cos(r(b.latitude))*Math.sin(dn/2)**2;return 6371000*2*Math.atan2(Math.sqrt(q),Math.sqrt(1-q))}
function formatDistance(m){return m<1000?Math.max(10,Math.round(m/10)*10)+' m':(m/1000).toLocaleString('fr-BE',{maximumFractionDigits:1})+' km'}
function parseLimit(value){if(!value)return null;const m=String(value).toLowerCase().match(/(\d+(?:[.,]\d+)?)/);if(!m)return null;let n=Number(m[1].replace(',','.'));if(String(value).toLowerCase().includes('mph'))n*=1.60934;return n>0&&Number.isFinite(n)?n:null}
function roadLimit(point,roads){let best=35,result=null;for(const road of roads||[]){const pts=road.geometry||[],limit=parseLimit(road.maxspeed);if(!limit)continue;for(let i=1;i<pts.length;i++){const a=pts[i-1],b=pts[i],ls=111320,os=111320*Math.cos(point[1]*Math.PI/180),ax=(a[0]-point[0])*os,ay=(a[1]-point[1])*ls,bx=(b[0]-point[0])*os,by=(b[1]-point[1])*ls,dx=bx-ax,dy=by-ay,t=Math.max(0,Math.min(1,-(ax*dx+ay*dy)/(dx*dx+dy*dy||1))),d=Math.hypot(ax+t*dx,ay+t*dy);if(d<best){best=d;result=limit}}}return result}
function unlockAudio(){const A=window.AudioContext||window.webkitAudioContext;if(!A)return;try{state.audio||=new A();if(state.audio.state==='suspended')state.audio.resume()}catch{}}
document.addEventListener('pointerdown',unlockAudio,{once:true,passive:true});
function playBeep(){if(!state.beepOn||!state.audio||state.audio.state!=='running')return;try{const o=state.audio.createOscillator(),g=state.audio.createGain(),t=state.audio.currentTime;o.type='sine';o.frequency.value=880;g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.12,t+.02);g.gain.exponentialRampToValueAtTime(.0001,t+.2);o.connect(g);g.connect(state.audio.destination);o.start(t);o.stop(t+.21)}catch{}}
function checkRadars(){if(!state.position||state.country!=='BE')return;for(const radar of state.radars){const id=String(radar.id),d=meters(state.position,{latitude:radar.geometry.coordinates[1],longitude:radar.geometry.coordinates[0]}),limit=Number(radar.speedLimit);if(d>500){alerted.delete(id);continue}if(d<=100&&limit>0&&state.speed>limit&&!alerted.has(id)){alerted.add(id);playBeep()}}}
async function refreshRadars(){if(!state.position)return;const now=Date.now(),cell=Math.floor(state.position.latitude/.05)+':'+Math.floor(state.position.longitude/.05);if(cell===state.radarCell&&now-state.radarFetchedAt<15*60*1000)return;state.radarCell=cell;state.radarFetchedAt=now;try{const query=new URLSearchParams({lat:state.position.latitude.toFixed(3),lon:state.position.longitude.toFixed(3)}),response=await fetch('/api/radars?'+query,{cache:'no-store'});if(!response.ok)throw Error('radar '+response.status);const data=await response.json();state.country=data.countryCode||state.country;state.radars=state.country==='BE'?(data.radars||[]).map(item=>{const c=[item.lon,item.lat];return{id:item.id,geometry:{coordinates:c},speedLimit:parseLimit(item.maxspeed)||roadLimit(c,data.roads)}}):[];render();checkRadars()}catch(error){console.warn('Radars indisponibles',error);state.radarFetchedAt=Date.now()-10*60*1000}}
async function loadCar(){try{const [north,rear]=await Promise.all(['/tesla-3d-north.png.b64','/tesla-3d-rear.png.b64'].map(async path=>{const r=await fetch(path);if(!r.ok)throw Error(path+' '+r.status);return'data:image/png;base64,'+(await r.text()).trim()}));carArtwork.north=north;carArtwork.rear=rear;render()}catch(error){console.warn('Images 3D Tesla indisponibles',error)}}
function instructionFor(step){
 const m=step.maneuver||{},type=m.type||'',mod=m.modifier||'',road=step.name||step.ref||'',left=mod.includes('left'),right=mod.includes('right');
 let text='Continuez tout droit';
 if(type==='depart')text='Démarrez';
 else if(type==='arrive')text='Vous êtes arrivé';
 else if(type==='turn'){
  if(mod==='uturn')text='Faites demi-tour au carrefour';
  else if(mod==='slight left')text='Au carrefour, obliquez légèrement à gauche';
  else if(mod==='slight right')text='Au carrefour, obliquez légèrement à droite';
  else if(mod==='sharp left')text='Au carrefour, tournez franchement à gauche';
  else if(mod==='sharp right')text='Au carrefour, tournez franchement à droite';
  else text='Au carrefour, tournez '+(left?'à gauche':right?'à droite':'tout droit');
 }else if(type==='fork')text='À la bifurcation, prenez '+(left?'la branche de gauche':right?'la branche de droite':'la branche tout droit');
 else if(type==='end of road')text='Au bout de la route, tournez '+(left?'à gauche':right?'à droite':'tout droit');
 else if(type==='on ramp')text='Prenez la bretelle d’accès '+(left?'à gauche':right?'à droite':'tout droit');
 else if(type==='off ramp')text='Prenez la sortie '+(left?'à gauche':right?'à droite':'tout droit');
 else if(type==='roundabout'||type==='rotary'){
  const exit=Number(m.exit),ordinal=exit===1?'1re':exit>1?exit+'e':'';
  text='Au rond-point, prenez '+(ordinal?ordinal+' sortie':'la sortie indiquée');
 }else if(type==='merge')text='Insérez-vous '+(left?'à gauche':right?'à droite':'sur la voie');
 else if(type==='new name'||type==='continue'||type==='notification')text='Continuez tout droit';
 return{text,road}
}
function turnProgressPoint(step){
 const type=step.maneuver?.type||'',coords=step.geometry?.coordinates||[];
 const coord=(type==='roundabout'||type==='rotary')&&coords.length>1?coords.at(-1):step.maneuver?.location||coords[0]||state.route.geometry.coordinates.at(-1);
 return{longitude:coord[0],latitude:coord[1]}
}
function headingMatchesStep(step){
 if(!Number.isFinite(state.heading)||state.speed<8)return true;
 const coords=step.geometry?.coordinates||[];
 if(coords.length<2)return true;
 const type=step.maneuver?.type||'',a=(type==='roundabout'||type==='rotary')?coords.at(-2):coords[0],b=(type==='roundabout'||type==='rotary')?coords.at(-1):coords[1];
 const expected=bearing({longitude:a[0],latitude:a[1]},{longitude:b[0],latitude:b[1]});
 const delta=Math.abs(((state.heading-expected+540)%360)-180);
 return delta<72;
}
function advanceTurnIfPassed(step){
 if(!state.navigating||state.stepIndex>=state.steps.length-1||!state.position)return false;
 const target=turnProgressPoint(step),distanceToTarget=meters(state.position,target),accuracy=state.position.accuracy||10;
 state.turnBestDistance=Math.min(state.turnBestDistance,distanceToTarget);
 if(distanceToTarget<=Math.max(18,Math.min(32,accuracy*1.2)))state.turnReached=true;
 const moved=state.previousPosition?meters(state.previousPosition,state.position):0;
 const margin=Math.max(14,Math.min(24,accuracy*.8));
 return state.turnReached&&moved>=Math.max(4,accuracy*.3)&&distanceToTarget>=state.turnBestDistance+margin&&headingMatchesStep(step);
}
function updateGuidance(){
 if(!state.route||!state.steps.length){guidance.hidden=true;return}
 guidance.hidden=false;
 let step=state.steps[state.stepIndex];
 if(!step){
  document.getElementById('turn-text').textContent='Vous êtes arrivé';
  document.getElementById('turn-road').textContent=state.destination?.name||'';
  document.getElementById('turn-distance').textContent='';
  document.getElementById('route-summary').textContent='';
  document.getElementById('arrival-time').textContent='Vous êtes arrivé';
  return
 }
 const loc=step.maneuver?.location||step.geometry?.coordinates?.[0]||state.route.geometry.coordinates.at(-1),to={longitude:loc[0],latitude:loc[1]},metersTo=state.position?meters(state.position,to):Number(step.distance)||0;
 if(advanceTurnIfPassed(step)){
  state.stepIndex++;
  state.turnReached=false;
  state.turnBestDistance=Infinity;
  return updateGuidance()
 }
 const ins=instructionFor(step),mod=step.maneuver?.modifier||'',type=step.maneuver?.type||'';
 document.getElementById('turn-icon').textContent=type==='roundabout'||type==='rotary'?'↻':mod==='uturn'?'↶':mod==='slight left'?'↖':mod==='slight right'?'↗':mod.includes('left')?'↰':mod.includes('right')?'↱':'↑';
 document.getElementById('turn-text').textContent=ins.text;
 document.getElementById('turn-road').textContent=ins.road;
 const targetDistance=state.position?meters(state.position,turnProgressPoint(step)):metersTo;
 const passedPoint=state.turnReached&&targetDistance>state.turnBestDistance+8;
 document.getElementById('turn-distance').textContent=state.navigating?(passedPoint?'Passez le carrefour':'Dans '+formatDistance(metersTo)):formatDistance(state.route.distance);
 const remaining=metersTo+state.steps.slice(state.stepIndex+1).reduce((sum,x)=>sum+(Number(x.distance)||0),0);
 let secs=remaining/Math.max(state.speed/3.6,9);
 if(!state.navigating)secs=state.route.duration||secs;
 const eta=new Date(Date.now()+secs*1000),clock=eta.toLocaleTimeString('fr-BE',{hour:'2-digit',minute:'2-digit'});
 document.getElementById('route-summary').textContent=formatDistance(remaining)+' · '+clock;
 document.getElementById('arrival-time').textContent='Arrivée · '+clock;
}
function updatePosition(p){const c=p.coords,now={latitude:c.latitude,longitude:c.longitude,timestamp:p.timestamp,accuracy:c.accuracy||0};let speed=Number.isFinite(c.speed)&&c.speed>=0?c.speed*3.6:null;if(speed===null&&state.lastPosition){const dt=(p.timestamp-state.lastPosition.timestamp)/1000;if(dt>.2)speed=meters(state.lastPosition,now)/dt*3.6}state.speed=Math.min(260,Math.max(0,speed||0));speedEl.textContent=String(Math.round(state.speed));if(Number.isFinite(c.heading)&&c.heading>=0)state.heading=c.heading;else if(state.lastPosition&&meters(state.lastPosition,now)>1)state.heading=bearing(state.lastPosition,now);state.previousPosition=state.position;state.lastPosition=now;state.position=now;if(state.follow)state.center=[now.longitude,now.latitude];setGps('GPS actif · précision ±'+Math.round(now.accuracy)+' m','active');if(state.route&&state.navigating)checkOffRoute();render();updateGuidance();checkRadars();refreshRadars()}
function startGps(){if(!navigator.geolocation){setGps('GPS indisponible','error');return}navigator.geolocation.watchPosition(updatePosition,error=>{setGps(error.code===1?'Autorisez la localisation dans les réglages du navigateur':'Recherche du signal GPS','error');if(error.code===1)showMessage('Autorisez la localisation dans les réglages du navigateur.');else gpsEl.classList.add('searching')},{enableHighAccuracy:true,maximumAge:1000,timeout:20000})}
async function geocode(q){
 if(state.searchAbort)state.searchAbort.abort();
 state.searchAbort=new AbortController();
 const countryCode=String(state.country||'').toUpperCase();
 if(!countryCode)return[];
 const allowed=continentCodesFor(countryCode,state.position),allowedSet=new Set(allowed);
 const url=new URL('https://nominatim.openstreetmap.org/search');
 url.search=new URLSearchParams({q,format:'jsonv2',limit:'40',addressdetails:'1',accept_language:'fr',countrycodes:allowed.join(',').toLowerCase()});
 const r=await fetch(url,{signal:state.searchAbort.signal,headers:{'Accept':'application/json'}});
 if(!r.ok)throw Error('Recherche indisponible');
 const results=await r.json(),local=[],nearby=[];
 for(const item of results){
  const code=String(item.address?.country_code||'').toUpperCase();
  if(!allowedSet.has(code))continue;
  (code===countryCode?local:nearby).push(item)
 }
 return local.concat(nearby)
}
function renderSuggestions(results){suggestions.replaceChildren();const unique=[...new Map(results.map(item=>[item.display_name,item])).values()].slice(0,7);for(const item of unique){const b=document.createElement('button');b.type='button';b.className='suggestion';b.textContent=item.display_name;b.addEventListener('click',()=>{suggestions.hidden=true;destinationInput.value=item.display_name;state.destination={longitude:Number(item.lon),latitude:Number(item.lat),name:item.display_name};startRoute()});suggestions.append(b)}suggestions.hidden=unique.length===0}
destinationInput.addEventListener('input',()=>{clearTimeout(state.searchTimer);state.destination=null;const q=destinationInput.value.trim();if(q.length<3){suggestions.hidden=true;return}state.searchTimer=setTimeout(async()=>{try{if(!state.country){showMessage('Attendez la détection du pays par le GPS.');return}renderSuggestions(await geocode(q))}catch(error){if(error.name!=='AbortError')console.warn(error)}},1000)});
function setSearchExpanded(open){if(state.navigating)return;form.classList.toggle('expanded',open);searchToggle.setAttribute('aria-expanded',String(open));searchToggle.setAttribute('aria-label',open?'Fermer la recherche de destination':'Rechercher une destination');searchToggle.title=open?'Fermer la recherche':'Rechercher une destination';if(open)destinationInput.focus();else suggestions.hidden=true}
searchToggle.addEventListener('click',()=>setSearchExpanded(!form.classList.contains('expanded')));
destinationInput.addEventListener('keydown',e=>{if(e.key==='Escape'){suggestions.hidden=true;setSearchExpanded(false);searchToggle.focus()}});
document.addEventListener('click',e=>{if(!form.contains(e.target)){suggestions.hidden=true;if(!state.navigating)setSearchExpanded(false)}});
form.addEventListener('submit',async e=>{e.preventDefault();const q=destinationInput.value.trim();if(state.destination){startRoute();return}if(q.length<3){showMessage('Saisissez une destination.');return}try{if(!state.country){showMessage('Attendez la détection du pays par le GPS.');return}const results=await geocode(q);if(results.length===1){const item=results[0];state.destination={longitude:Number(item.lon),latitude:Number(item.lat),name:item.display_name};startRoute()}else renderSuggestions(results)}catch{showMessage('Recherche de destination indisponible.')}});
async function startRoute(){if(!state.position){showMessage('Attendez le signal GPS avant de lancer le guidage.');return}if(!state.destination){showMessage('Choisissez une destination dans la liste.');return}suggestions.hidden=true;submitButton.disabled=true;submitButton.innerHTML='<span class="spinner"></span>';try{const a=state.position,d=state.destination,url='https://router.project-osrm.org/route/v1/driving/'+a.longitude+','+a.latitude+';'+d.longitude+','+d.latitude+'?overview=full&geometries=geojson&steps=true';const r=await fetch(url);if(!r.ok)throw Error('Route indisponible');const data=await r.json();if(data.code!=='Ok'||!data.routes?.length)throw Error('Aucun trajet trouvé');state.route=data.routes[0];state.steps=state.route.legs.flatMap(leg=>leg.steps||[]);state.stepIndex=Math.min(1,Math.max(0,state.steps.findIndex(s=>s.maneuver?.type!=='depart')));state.navigating=true;state.turnReached=false;state.turnBestDistance=Infinity;state.follow=true;state.offRouteCount=0;state.zoom=16;state.center=[a.longitude,a.latitude];document.getElementById('arrival-card').hidden=false;document.getElementById('arrival-address').textContent=d.name;document.getElementById('arrival-address').title=d.name;form.classList.add('navigating');destinationInput.value='';destinationInput.placeholder='Navigation en cours';submitButton.textContent='Arrêter';submitButton.disabled=false;submitButton.setAttribute('aria-label','Arrêter la navigation');render();updateGuidance();showMessage('Guidage démarré · '+formatDistance(state.route.distance))}catch(error){console.warn('Calcul de trajet impossible',error);showMessage('Impossible de calculer ce trajet. Réessayez.');submitButton.disabled=false;submitButton.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6"/></svg>'}}
function stopRoute(){state.route=null;state.steps=[];state.stepIndex=0;state.navigating=false;state.turnReached=false;state.turnBestDistance=Infinity;state.destination=null;state.offRouteCount=0;state.follow=true;document.getElementById('arrival-card').hidden=true;form.classList.remove('navigating','expanded');searchToggle.setAttribute('aria-expanded','false');searchToggle.setAttribute('aria-label','Rechercher une destination');destinationInput.placeholder='Où aller ?';submitButton.disabled=false;submitButton.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6"/></svg>';submitButton.setAttribute('aria-label','Calculer l’itinéraire');guidance.hidden=true;render()}
submitButton.addEventListener('click',e=>{if(state.navigating){e.preventDefault();stopRoute()}});
function checkOffRoute(){if(!state.route||!state.position)return;let best=Infinity;for(const [lon,lat] of state.route.geometry.coordinates){const d=meters(state.position,{longitude:lon,latitude:lat});if(d<best)best=d;if(best<25)break}if(best>85)state.offRouteCount++;else state.offRouteCount=0;if(state.offRouteCount>=3){state.offRouteCount=0;showMessage('Recalcul de l’itinéraire…');startRoute()}}
let drag=null;
mapEl.addEventListener('pointerdown',e=>{if(e.target.closest('button,input,.suggestion'))return;drag={x:e.clientX,y:e.clientY,center:mercator(...state.center)};mapEl.setPointerCapture(e.pointerId);state.follow=false;recenter.hidden=false});
mapEl.addEventListener('pointermove',e=>{if(!drag)return;state.center=unproject(drag.center.x-(e.clientX-drag.x),drag.center.y-(e.clientY-drag.y));render()});
const release=()=>{if(drag){drag=null;refreshRadars()}};mapEl.addEventListener('pointerup',release);mapEl.addEventListener('pointercancel',release);
mapEl.addEventListener('wheel',e=>{e.preventDefault();state.zoom=Math.max(3,Math.min(19,state.zoom+(e.deltaY<0?1:-1)));render()},{passive:false});
recenter.addEventListener('click',()=>{if(!state.position){startGps();return}state.follow=true;recenter.hidden=true;state.center=[state.position.longitude,state.position.latitude];render()});
orientationButton.addEventListener('click',()=>{state.orientation=state.orientation==='north'?'heading':'north';localStorage.setItem('map-orientation',state.orientation);render()});
soundButton.addEventListener('click',()=>{unlockAudio();state.beepOn=!state.beepOn;localStorage.setItem('radar-sound',state.beepOn?'on':'off');soundButton.classList.toggle('muted',!state.beepOn);soundButton.setAttribute('aria-pressed',String(state.beepOn));soundButton.setAttribute('aria-label',state.beepOn?'Bips radars activés':'Bips radars désactivés');soundButton.title=state.beepOn?'Couper les bips radars':'Activer les bips radars'});
window.addEventListener('resize',render);window.addEventListener('orientationchange',()=>setTimeout(render,150));
soundButton.classList.toggle('muted',!state.beepOn);soundButton.setAttribute('aria-pressed',String(state.beepOn));soundButton.title=state.beepOn?'Couper les bips radars':'Activer les bips radars';
loadCar();render();startGps();refreshRadars();setInterval(refreshRadars,15*60*1000);
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('/service-worker.js').catch(()=>{}));