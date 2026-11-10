const TILE_URL='https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const mapEl=document.getElementById('map'),geoLayer=document.getElementById('geo-layer'),tileLayer=document.getElementById('tiles'),radarLayer=document.getElementById('radars'),vehicle=document.getElementById('vehicle');
const vehicleImage=document.getElementById('vehicle-image'),carArtwork={north:'',rear:''};
const speedEl=document.getElementById('speed'),gpsEl=document.getElementById('gps-status'),mapViewToggle=document.getElementById('map-view-toggle'),soundButton=document.getElementById('sound-toggle'),orientationButton=document.getElementById('orientation-toggle'),guidance=document.getElementById('guidance'),form=document.getElementById('navigation'),searchToggle=document.getElementById('search-toggle'),countryPicker=document.getElementById('country-picker'),countryFlagEl=document.getElementById('country-flag'),countryMenu=document.getElementById('country-menu'),countryFilter=document.getElementById('country-filter'),countryOptions=document.getElementById('country-options'),destinationInput=document.getElementById('destination'),submitButton=document.getElementById('route-submit'),suggestions=document.getElementById('suggestions');
const startupCenter=(()=>{try{const p=JSON.parse(localStorage.getItem('last-gps-position')||'null');if(p&&Date.now()-p.timestamp<12*60*60*1000&&Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)&&Math.abs(p.latitude)<=90&&Math.abs(p.longitude)<=180)return[p.longitude,p.latitude]}catch{}return[4.6,50.55]})();
const state={center:startupCenter,zoom:16,zoomTarget:null,zoomRaf:0,zoomLastFrame:0,zoomLastRender:0,position:null,previousPosition:null,lastPosition:null,heading:null,speed:0,follow:true,initialCentered:false,lastPositionStoredAt:0,tilesKey:'',tilesOrigin:null,radars:[],country:'',countryLookupPending:false,countryLookupRetryAt:0,radarCell:'',radarFetchedAt:0,audio:null,beepOn:localStorage.getItem('radar-sound')!=='off',orientation:localStorage.getItem('map-orientation')||'north',destination:null,route:null,steps:[],stepIndex:0,turnReached:false,turnBestDistance:Infinity,navigating:false,offRouteCount:0,searchTimer:null,searchAbort:null,searchPromise:null,searchQuery:'',suggestionResults:[],activeSuggestion:-1,lastGeocodeAt:0,countryPromise:null,destinationCountry:(localStorage.getItem('destination-country')||'BE').toUpperCase()};
const COUNTRY_CODES='AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW';
const countryDisplay=Intl.DisplayNames?new Intl.DisplayNames(['fr'],{type:'region'}):null;
function countryName(code){try{return countryDisplay?.of(code)||code}catch{return code}}
function countryFlag(code){return String.fromCodePoint(...code.split('').map(letter=>127397+letter.charCodeAt(0)))}
const countryEntries=COUNTRY_CODES.split(' ').map(code=>({code,name:countryName(code)})).sort((a,b)=>a.name.localeCompare(b.name,'fr',{sensitivity:'base'}));
function destinationCountryName(){return countryName(state.destinationCountry)}
function updateCountryPicker(){
 countryFlagEl.textContent=countryFlag(state.destinationCountry);
 countryPicker.setAttribute('aria-label','Pays de destination : '+destinationCountryName());
 countryPicker.title='Pays de destination : '+destinationCountryName()
}
function renderCountryOptions(query=''){
 countryOptions.replaceChildren();
 const q=query.trim().toLocaleLowerCase('fr');
 const filtered=countryEntries.filter(country=>!q||country.name.toLocaleLowerCase('fr').includes(q)||country.code.toLowerCase().includes(q));
 for(const country of filtered){
  const button=document.createElement('button');
  button.type='button';button.className='country-option';button.setAttribute('role','option');button.setAttribute('aria-selected',String(country.code===state.destinationCountry));
  const flag=document.createElement('span');flag.className='country-option-flag';flag.textContent=countryFlag(country.code);flag.setAttribute('aria-hidden','true');
  const name=document.createElement('span');name.textContent=country.name;
  button.append(flag,name);button.addEventListener('click',()=>selectDestinationCountry(country.code));countryOptions.append(button)
 }
 if(!filtered.length){const empty=document.createElement('div');empty.className='suggestion-note';empty.textContent='Aucun pays trouvé';countryOptions.append(empty)}
}
function populateCountryMenu(){
 if(!countryEntries.some(country=>country.code===state.destinationCountry))state.destinationCountry='BE';
 updateCountryPicker();
 renderCountryOptions()
}
function selectDestinationCountry(code){
 if(!countryEntries.some(country=>country.code===code))return;
 state.destinationCountry=code;
 localStorage.setItem('destination-country',code);
 updateCountryPicker();
 countryMenu.hidden=true;countryPicker.setAttribute('aria-expanded','false');countryFilter.value='';
 clearTimeout(state.searchTimer);
 if(state.searchAbort)state.searchAbort.abort();
 state.searchPromise=null;state.searchQuery='';state.suggestionResults=[];state.activeSuggestion=-1;state.destination=null;
 destinationInput.value='';destinationInput.placeholder='Adresse ou ville';suggestions.hidden=true;
 destinationInput.removeAttribute('aria-activedescendant');destinationInput.focus()
}
countryPicker.addEventListener('click',()=>{
 const open=countryMenu.hidden;
 countryMenu.hidden=!open;
 countryPicker.setAttribute('aria-expanded',String(open));
 suggestions.hidden=true;
 if(open){countryFilter.value='';renderCountryOptions();countryFilter.focus()}
});
countryFilter.addEventListener('input',()=>renderCountryOptions(countryFilter.value));
countryFilter.addEventListener('keydown',event=>{
 if(event.key==='Enter'){event.preventDefault();return}
 if(event.key==='Escape'){event.preventDefault();countryMenu.hidden=true;countryPicker.setAttribute('aria-expanded','false');countryPicker.focus()}
});
const alerted=new Set();
function mercator(lon,lat,z=state.zoom){const size=256*2**z,phi=Math.max(-85.0511,Math.min(85.0511,lat))*Math.PI/180;return{x:(lon+180)/360*size,y:(.5-Math.log((1+Math.sin(phi))/(1-Math.sin(phi)))/(4*Math.PI))*size}}
function unproject(x,y,z=state.zoom){const size=256*2**z,n=Math.PI-2*Math.PI*y/size;return[(x/size*360)-180,180/Math.PI*Math.atan(Math.sinh(n))]}
function tileUrl(x,y,z){const n=2**z;return TILE_URL.replace('{z}',String(z)).replace('{y}',String(y)).replace('{x}',String((x%n+n)%n))}
function drawTiles(){const w=mapEl.clientWidth,h=mapEl.clientHeight,tileZoom=Math.max(3,Math.min(19,Math.floor(state.zoom))),tileScale=2**(state.zoom-tileZoom),c=mercator(...state.center,tileZoom),angle=state.orientation==='heading'&&state.heading!==null?-state.heading*Math.PI/180:0,extentW=(Math.abs(w*Math.cos(angle))+Math.abs(h*Math.sin(angle)))/tileScale,extentH=(Math.abs(w*Math.sin(angle))+Math.abs(h*Math.cos(angle)))/tileScale,minX=Math.floor((c.x-extentW/2)/256),maxX=Math.floor((c.x+extentW/2)/256),minY=Math.floor((c.y-extentH/2)/256),maxY=Math.floor((c.y+extentH/2)/256),cols=Math.max(1,maxX-minX+1),rows=Math.max(1,maxY-minY+1),key=[tileZoom,minX,minY,cols,rows].join(':');
 if(key!==state.tilesKey){state.tilesKey=key;state.tilesOrigin=[minX,minY];tileLayer.replaceChildren();const n=2**tileZoom;for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){if(y<0||y>=n)continue;const img=document.createElement('img');img.alt='';img.draggable=false;img.decoding='async';img.src=tileUrl(x,y,tileZoom);img.style.left=((x-minX)*256)+'px';img.style.top=((y-minY)*256)+'px';tileLayer.append(img)}}
 const o=state.tilesOrigin||[minX,minY];tileLayer.style.transform='translate('+(w/2-(c.x-o[0]*256)*tileScale)+'px,'+(h/2-(c.y-o[1]*256)*tileScale)+'px) scale('+tileScale+')'}
function zoomForSpeed(speed){const v=Math.max(0,Math.min(260,Number(speed)||0));if(v<20)return 19;if(v<30)return 19+(17.7-19)*(v-20)/10;if(v<70)return 17.7-(v-30)*(.35/40);if(v<=130)return 17.35-(v-70)*(1.15/60);return Math.max(14.9,16.2-(v-130)*.01)}
function updateDynamicZoom(){if(!state.follow)return;state.zoomTarget=zoomForSpeed(state.speed);if(!state.zoomRaf){state.zoomLastFrame=0;state.zoomRaf=requestAnimationFrame(animateDynamicZoom)}}
function animateDynamicZoom(timestamp){state.zoomRaf=0;if(!state.follow||state.zoomTarget===null)return;const dt=state.zoomLastFrame?Math.min(100,timestamp-state.zoomLastFrame):16;state.zoomLastFrame=timestamp;const delta=state.zoomTarget-state.zoom;const step=Math.abs(delta)<.01?delta:Math.max(-dt*.00042,Math.min(dt*.00042,delta*(1-Math.exp(-dt/2200))));state.zoom+=step;if(Math.abs(state.zoomTarget-state.zoom)<.01)state.zoom=state.zoomTarget;if(timestamp-state.zoomLastRender>=60||state.zoom===state.zoomTarget){state.zoomLastRender=timestamp;render()}if(state.zoom!==state.zoomTarget)state.zoomRaf=requestAnimationFrame(animateDynamicZoom)}
function geoPoint(lon,lat){const p=mercator(lon,lat),c=mercator(...state.center);return{x:mapEl.clientWidth/2+p.x-c.x,y:mapEl.clientHeight/2+p.y-c.y}}
function placeElement(el,lon,lat){const p=geoPoint(lon,lat);el.style.left=p.x+'px';el.style.top=p.y+'px'}
function drawRoute(){const casing=document.getElementById('route-casing'),line=document.getElementById('route-line'),svg=document.getElementById('route-layer');if(!state.route){casing.setAttribute('d','');line.setAttribute('d','');return}svg.setAttribute('viewBox','0 0 '+mapEl.clientWidth+' '+mapEl.clientHeight);const d=state.route.geometry.coordinates.map((coord,i)=>{const p=geoPoint(coord[0],coord[1]);return(i?'L':'M')+p.x.toFixed(1)+' '+p.y.toFixed(1)}).join(' ');casing.setAttribute('d',d);line.setAttribute('d',d)}
function drawOverlays(){const angle=state.orientation==='heading'&&state.heading!==null?-state.heading:0;geoLayer.style.transform='rotate('+angle+'deg)';if(state.position){vehicle.hidden=false;placeElement(vehicle,state.position.longitude,state.position.latitude);vehicle.classList.toggle('heading-view',state.orientation==='heading');vehicle.classList.toggle('north-view',state.orientation==='north');vehicleImage.alt=state.orientation==='heading'?'Tesla Model 3 blanche vue arrière 3D':'Tesla Model 3 blanche vue du dessus';vehicleImage.style.setProperty('--car-rotation',((state.heading||0)+(state.orientation==='north'?90:0))+'deg');const mode=state.orientation==='heading'?'rear':'north',src=carArtwork[mode];if(src&&vehicleImage.dataset.artMode!==mode){vehicleImage.src=src;vehicleImage.dataset.artMode=mode}}else vehicle.hidden=true;radarLayer.replaceChildren();for(const radar of state.radars){const pin=document.createElement('i');pin.className='radar-pin';pin.setAttribute('aria-label','Radar fixe'+(radar.speedLimit?' · '+radar.speedLimit+' km/h':''));placeElement(pin,radar.geometry.coordinates[0],radar.geometry.coordinates[1]);radarLayer.append(pin)}drawRoute()}
function updateMapViewToggle(){
 const visible=!state.follow;
 mapViewToggle.hidden=!visible;
 mapViewToggle.classList.toggle('recenter-mode',visible);
 mapViewToggle.querySelector('.recenter-mark').hidden=false;
 mapViewToggle.setAttribute('aria-label','Recentrer sur la voiture');mapViewToggle.title='Recentrer sur la voiture'
}
function returnToVehicle(){
 state.follow=true;
 if(state.position){state.center=[state.position.longitude,state.position.latitude];state.zoomTarget=zoomForSpeed(state.speed)}
 updateDynamicZoom();render()
}
function render(){drawTiles();drawOverlays();orientationButton.classList.toggle('heading-up',state.orientation==='heading');orientationButton.classList.toggle('north-up',state.orientation==='north');orientationButton.setAttribute('aria-label',state.orientation==='north'?'Orientation : nord en haut':'Orientation : cap du véhicule en haut');orientationButton.title=state.orientation==='north'?'Passer au cap du véhicule':'Passer au nord en haut';document.getElementById('orientation-label').textContent=state.orientation==='north'?'N':'▲';updateMapViewToggle()}
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
async function detectCountryFromPosition(position){
 const query=new URLSearchParams({lat:position.latitude.toFixed(5),lon:position.longitude.toFixed(5)});
 const response=await fetch('/api/country?'+query,{cache:'no-store'});
 if(!response.ok)throw Error('Pays GPS non détecté');
 const result=await response.json(),code=String(result.countryCode||'').toUpperCase();
 if(/^[A-Z]{2}$/.test(code)){state.country=code;render();return code}
 throw Error('Pays GPS non détecté')
}
function ensureCountry(){
 if(state.country)return Promise.resolve(state.country);
 if(!state.position)return Promise.reject(Error('GPS indisponible'));
 if(state.countryPromise)return state.countryPromise;
 if(Date.now()<state.countryLookupRetryAt)return Promise.reject(Error('Pays GPS non détecté'));
 state.countryLookupPending=true;
 state.countryLookupRetryAt=Date.now()+30*1000;
 state.countryPromise=detectCountryFromPosition(state.position).finally(()=>{state.countryLookupPending=false;state.countryPromise=null});
 return state.countryPromise
}
async function refreshRadars(){if(!state.position)return;const now=Date.now(),cell=Math.floor(state.position.latitude/.05)+':'+Math.floor(state.position.longitude/.05);if(cell===state.radarCell&&now-state.radarFetchedAt<15*60*1000)return;state.radarCell=cell;state.radarFetchedAt=now;if(!state.country&&!state.countryLookupPending&&Date.now()>=state.countryLookupRetryAt){state.countryLookupPending=true;state.countryLookupRetryAt=Date.now()+5*60*1000;ensureCountry().catch(error=>console.warn('Pays GPS indisponible',error))}try{const query=new URLSearchParams({lat:state.position.latitude.toFixed(3),lon:state.position.longitude.toFixed(3)}),response=await fetch('/api/radars?'+query,{cache:'no-store'});if(!response.ok)throw Error('radar '+response.status);const data=await response.json();state.country=data.countryCode||state.country;state.radars=state.country==='BE'?(data.radars||[]).map(item=>{const c=[item.lon,item.lat];return{id:item.id,geometry:{coordinates:c},speedLimit:parseLimit(item.maxspeed)||roadLimit(c,data.roads)}}):[];render();checkRadars()}catch(error){console.warn('Radars indisponibles',error);state.radarFetchedAt=Date.now()-10*60*1000}}
async function loadCar(mode=state.orientation==='heading'?'rear':'north'){if(carArtwork[mode])return;const path=mode==='rear'?'/tesla-3d-rear.png.b64':'/tesla-model3-top.png.b64';try{const r=await fetch(path);if(!r.ok)throw Error(path+' '+r.status);carArtwork[mode]='data:image/png;base64,'+(await r.text()).trim();if((state.orientation==='heading'?'rear':'north')===mode)render()}catch(error){console.warn('Image 3D Tesla indisponible',error)}}
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
function maneuverIcon(step){
 const type=step?.maneuver?.type||'',mod=step?.maneuver?.modifier||'',exit=Number(step?.maneuver?.exit)||0;
 const path=d=>'<path d="'+d+'"/>';let shape='';
 if(type==='roundabout'||type==='rotary'){shape='<circle cx="12" cy="12" r="7.2"/>'+path('M7 6.8A7.5 7.5 0 0 1 18 7l1.8 2.2M19.8 9.2 16.5 9m3.3.2-.2-3.1')+path('M12 4.8v3.1');if(exit)shape+='<text x="12" y="15" text-anchor="middle" class="maneuver-number">'+exit+'</text>'}
 else if(type==='off ramp')shape=path('M7 21V4m0 8h7a5 5 0 0 1 5 5v1m-4-4 4 4 4-4');
 else if(type==='on ramp'||type==='merge')shape=path('M6 21V4m12 17v-5a6 6 0 0 0-6-6H8m3-3-3 3 3 3');
 else if(type==='fork'){shape=path('M12 21V12m0 0V8a4 4 0 0 0-4-4H5m3-3-3 3 3 3')+path('M12 12V8a4 4 0 0 1 4-4h3m-3-3 3 3-3 3');if(mod.includes('left'))shape=path('M12 21V12m0 0V8a4 4 0 0 0-4-4H5m3-3-3 3 3 3');if(mod.includes('right'))shape=path('M12 21V12m0 0V8a4 4 0 0 1 4-4h3m-3-3 3 3-3 3')}
 else if(mod==='uturn')shape=path('M6 21V11a6 6 0 0 1 12 0v3m-4-4 4 4 4-4');
 else if(mod.includes('left')){shape=path('M18 21v-8a5 5 0 0 0-5-5H5m4-4-4 4 4 4');if(mod.startsWith('slight'))shape=path('M18 21v-6a5 5 0 0 0-4-4.9L7 8m4-3-4 3 3 4');if(mod.startsWith('sharp'))shape=path('M18 21V9a4 4 0 0 0-4-4H5m4-4-4 4 4 4')}
 else if(mod.includes('right')){shape=path('M6 21v-8a5 5 0 0 1 5-5h8m-4-4 4 4-4 4');if(mod.startsWith('slight'))shape=path('M6 21v-6a5 5 0 0 1 4-4.9L17 8m-4-3 4 3-3 4');if(mod.startsWith('sharp'))shape=path('M6 21V9a4 4 0 0 1 4-4h9m-4-4 4 4-4 4')}
 else if(type==='arrive')shape=path('M6 21V4m0 1h12l-3 4 3 4H6');
 else if(type==='depart')shape='<circle cx="12" cy="17" r="3"/>'+path('M12 14V4m-4 4 4-4 4 4');
 else shape=path('M12 21V4m-4 4 4-4 4 4');
 return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'+shape+'</svg>'
}
function nextManeuver(){
 const actionable=new Set(['turn','fork','end of road','on ramp','off ramp','roundabout','rotary','merge','arrive']);
 for(let i=state.stepIndex+1;i<state.steps.length;i++){
  if(actionable.has(state.steps[i].maneuver?.type))return state.steps[i]
 }
 return null
}
function updateGuidance(){
 if(!state.route||!state.steps.length){guidance.hidden=true;return}
 guidance.hidden=false;
 let step=state.steps[state.stepIndex];
 if(!step){
  document.getElementById('turn-text').textContent='Vous êtes arrivé';
  document.getElementById('turn-road').textContent=state.destination?.name||'';
  document.getElementById('turn-distance').textContent='';document.getElementById('approach-progress').hidden=true;
  document.getElementById('route-summary').textContent='';
  document.getElementById('arrival-time').textContent='Vous êtes arrivé';
  document.getElementById('next-guidance').hidden=true;
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
 document.getElementById('turn-icon').innerHTML=maneuverIcon(step);
 document.getElementById('turn-text').textContent=ins.text;
 document.getElementById('turn-road').textContent=ins.road;
 const targetDistance=state.position?meters(state.position,turnProgressPoint(step)):metersTo;
 const passedPoint=state.turnReached&&targetDistance>state.turnBestDistance+8;
 document.getElementById('turn-distance').textContent=state.navigating?(passedPoint?'Passez le carrefour':'Dans '+formatDistance(metersTo)):formatDistance(state.route.distance);
 const approach=document.getElementById('approach-progress'),approachFill=document.getElementById('approach-progress-fill'),approachActive=state.navigating&&type!=='arrive'&&metersTo<=50;approach.hidden=!approachActive;if(approachActive){approachFill.style.width=(Math.max(0,Math.min(1,(50-metersTo)/50))*100)+'%';approach.classList.toggle('urgent',metersTo<=20)}
 const next=nextManeuver(),nextPanel=document.getElementById('next-guidance');
 if(!next)nextPanel.hidden=true;
 else{
  const nextInstruction=instructionFor(next),nextPoint=turnProgressPoint(next),nextDistance=state.position?meters(state.position,nextPoint):Number(next.distance)||0;
  document.getElementById('next-turn-icon').innerHTML=maneuverIcon(next);
  document.getElementById('next-turn-text').textContent=nextInstruction.text;
  document.getElementById('next-turn-road').textContent=nextInstruction.road;
  document.getElementById('next-turn-distance').textContent='Dans '+formatDistance(nextDistance);
  nextPanel.hidden=false
 }
 const remaining=metersTo+state.steps.slice(state.stepIndex+1).reduce((sum,x)=>sum+(Number(x.distance)||0),0);
 let secs=remaining/Math.max(state.speed/3.6,9);
 if(!state.navigating)secs=state.route.duration||secs;
 const eta=new Date(Date.now()+secs*1000),clock=eta.toLocaleTimeString('fr-BE',{hour:'2-digit',minute:'2-digit'});
 document.getElementById('route-summary').textContent=formatDistance(remaining)+' · '+clock;
 document.getElementById('arrival-time').textContent='Arrivée · '+clock;
}
function updatePosition(p){const c=p.coords,now={latitude:c.latitude,longitude:c.longitude,timestamp:p.timestamp,accuracy:c.accuracy||0};let speed=Number.isFinite(c.speed)&&c.speed>=0?c.speed*3.6:null;if(speed===null&&state.lastPosition){const dt=(p.timestamp-state.lastPosition.timestamp)/1000;if(dt>.2)speed=meters(state.lastPosition,now)/dt*3.6}state.speed=Math.min(260,Math.max(0,speed||0));speedEl.textContent=String(Math.round(state.speed));if(Number.isFinite(c.heading)&&c.heading>=0)state.heading=c.heading;else if(state.lastPosition&&meters(state.lastPosition,now)>1)state.heading=bearing(state.lastPosition,now);state.previousPosition=state.position;state.lastPosition=now;state.position=now;if(!state.lastPositionStoredAt||now.timestamp-state.lastPositionStoredAt>30000){try{localStorage.setItem('last-gps-position',JSON.stringify({latitude:now.latitude,longitude:now.longitude,timestamp:now.timestamp}));state.lastPositionStoredAt=now.timestamp}catch{}}if(!state.initialCentered){state.initialCentered=true;state.follow=true;state.center=[now.longitude,now.latitude]}else if(state.follow)state.center=[now.longitude,now.latitude];updateDynamicZoom();setGps('GPS actif · précision ±'+Math.round(now.accuracy)+' m','active');if(state.route&&state.navigating)checkOffRoute();render();updateGuidance();checkRadars();refreshRadars()}
function startGps(){if(!navigator.geolocation){setGps('GPS indisponible','error');return}navigator.geolocation.watchPosition(updatePosition,error=>{setGps(error.code===1?'Autorisez la localisation dans les réglages du navigateur':'Recherche du signal GPS','error');if(error.code===1)showMessage('Autorisez la localisation dans les réglages du navigateur.');else gpsEl.classList.add('searching')},{enableHighAccuracy:true,maximumAge:1000,timeout:20000})}
function photonFeatureToResult(feature){
 const props=feature.properties||{},coords=feature.geometry?.coordinates||[];
 const lon=Number(coords[0]),lat=Number(coords[1]),code=String(props.countrycode||props.country_code||state.destinationCountry).toUpperCase();
 if(!Number.isFinite(lon)||!Number.isFinite(lat)||code!==state.destinationCountry)return null;
 const street=props.street||(props.osm_key==='highway'?props.name:'');
 const primary=[props.housenumber,street].filter(Boolean).join(' ')||props.name||props.locality||props.city||'';
 const locality=props.city||props.town||props.village||props.hamlet||props.district||props.locality;
 const parts=[primary,props.postcode,locality,props.county,props.state,props.country].filter(Boolean);
 const unique=parts.filter((part,index)=>parts.findIndex(item=>item.toLocaleLowerCase('fr')===part.toLocaleLowerCase('fr'))===index);
 return{lon,lat,display_name:unique.join(', ')||props.name||props.country||'Adresse',address:{country_code:code.toLowerCase()},properties:props}
}
async function geocode(q,signal){
 const countryCode=String(state.destinationCountry||'').toUpperCase();
 const params={q,limit:'7',lang:'fr',countrycode:countryCode};
 if(state.position&&state.country===countryCode){params.lat=String(state.position.latitude);params.lon=String(state.position.longitude);params.zoom='15';params.location_bias_scale='0.25'}
 const wait=Math.max(0,800-(Date.now()-state.lastGeocodeAt));
 if(wait)await new Promise(resolve=>setTimeout(resolve,wait));
 if(signal.aborted)throw new DOMException('Recherche annulée','AbortError');
 const url=new URL('/api/suggest',location.origin);url.search=new URLSearchParams(params);
 state.lastGeocodeAt=Date.now();
 const response=await fetch(url,{signal});
 if(!response.ok)throw Error('Le service de suggestions ne répond pas. Réessayez dans un instant.');
 const payload=await response.json();
 return(payload.features||[]).map(photonFeatureToResult).filter(Boolean)
}
async function exactAddressSearch(q){
 const code=String(state.destinationCountry||'').toLowerCase();
 const url=new URL('/api/search',location.origin);url.search=new URLSearchParams({q,countrycodes:code});
 const response=await fetch(url);
 if(!response.ok)throw Error('Recherche d’adresse impossible');
 const results=await response.json();
 return results.filter(item=>String(item.address?.country_code||'').toLowerCase()===code)
}
function showSuggestionStatus(message){
 suggestions.replaceChildren();
 const item=document.createElement('div');
 item.className='suggestion-note';
 item.setAttribute('role','option');
 item.setAttribute('aria-disabled','true');
 item.textContent=message;
 suggestions.append(item);
 suggestions.hidden=false;
 state.suggestionResults=[];
 state.activeSuggestion=-1
}
function renderSuggestions(results){
 suggestions.replaceChildren();
 state.suggestionResults=[...new Map(results.map(item=>[item.display_name,item])).values()].slice(0,8);
 state.activeSuggestion=state.suggestionResults.length?0:-1;
 if(!state.suggestionResults.length){showSuggestionStatus('Aucune adresse trouvée. Essayez avec la ville ou le code postal.');return}
 state.suggestionResults.forEach((item,index)=>{
  const button=document.createElement('button');
  button.type='button';button.id='suggestion-'+index;button.className='suggestion';button.setAttribute('role','option');button.setAttribute('aria-selected',String(index===state.activeSuggestion));button.textContent=item.display_name;
  button.addEventListener('click',()=>selectSuggestion(index));
  suggestions.append(button)
 });
 suggestions.hidden=false;
 destinationInput.setAttribute('aria-activedescendant','suggestion-0')
}
function updateSuggestionSelection(){
 const items=suggestions.querySelectorAll('.suggestion');
 items.forEach((item,index)=>item.setAttribute('aria-selected',String(index===state.activeSuggestion)));
 const active=items[state.activeSuggestion];
 if(active){destinationInput.setAttribute('aria-activedescendant',active.id);active.scrollIntoView({block:'nearest'})}
}
function selectSuggestion(index){
 const item=state.suggestionResults[index];
 if(!item)return;
 suggestions.hidden=true;
 state.destination={longitude:Number(item.lon),latitude:Number(item.lat),name:item.display_name};
 destinationInput.value=item.display_name;
 destinationInput.removeAttribute('aria-activedescendant');
 startRoute()
}
async function runAddressSearch(q){
 if(state.searchPromise&&state.searchQuery===q)return state.searchPromise;
 if(state.searchAbort)state.searchAbort.abort();
 const controller=new AbortController();
 state.searchAbort=controller;
 state.searchQuery=q;
 state.searchPromise=(async()=>{
  try{
   const results=await geocode(q,controller.signal);
   if(controller.signal.aborted||destinationInput.value.trim()!==q)return[];
   renderSuggestions(results);
   return state.suggestionResults
  }catch(error){
   if(error.name==='AbortError')return[];
   if(state.searchAbort===controller)state.searchPromise=null;
   showSuggestionStatus('Le service de suggestions est indisponible. Vérifiez la connexion puis réessayez.');
   console.warn('Recherche d’adresse impossible',error);
   throw error
  }
 })();
 return state.searchPromise
}
destinationInput.addEventListener('input',()=>{
 clearTimeout(state.searchTimer);
 if(state.searchAbort)state.searchAbort.abort();
 state.searchPromise=null;state.searchQuery='';
 state.destination=null;state.suggestionResults=[];state.activeSuggestion=-1;
 const q=destinationInput.value.trim();
 submitButton.setAttribute('aria-label',q.length>=3?'Valider la destination':'Rechercher une destination');
 if(q.length<3){suggestions.hidden=true;destinationInput.removeAttribute('aria-activedescendant');return}
 showSuggestionStatus('Recherche des adresses…');
 state.searchTimer=setTimeout(()=>runAddressSearch(q).catch(()=>{}),850)
});
function setSearchExpanded(open){
 if(state.navigating)return;
 form.classList.toggle('expanded',open);
 searchToggle.setAttribute('aria-expanded',String(open));
 searchToggle.setAttribute('aria-label',open?'Fermer la recherche de destination':'Rechercher une destination');
 searchToggle.title=open?'Fermer la recherche':'Rechercher une destination';
 if(open)destinationInput.focus();
 else{suggestions.hidden=true;destinationInput.removeAttribute('aria-activedescendant')}
}
searchToggle.addEventListener('click',()=>setSearchExpanded(!form.classList.contains('expanded')));

destinationInput.addEventListener('keydown',event=>{
 if(event.key==='Escape'){event.preventDefault();suggestions.hidden=true;setSearchExpanded(false);searchToggle.focus();return}
 if(event.key==='ArrowDown'&&state.suggestionResults.length){event.preventDefault();state.activeSuggestion=Math.min(state.suggestionResults.length-1,state.activeSuggestion+1);updateSuggestionSelection();return}
 if(event.key==='ArrowUp'&&state.suggestionResults.length){event.preventDefault();state.activeSuggestion=Math.max(0,state.activeSuggestion-1);updateSuggestionSelection();return}
 if(event.key==='Enter'){event.preventDefault();submitDestination()}
});
document.addEventListener('click',event=>{
 if(!form.contains(event.target)){suggestions.hidden=true;if(!state.navigating)setSearchExpanded(false)}
});
form.addEventListener('submit',event=>{event.preventDefault();submitDestination()});
async function submitDestination(){
 const q=destinationInput.value.trim();
 if(state.destination){startRoute();return}
 if(q.length<3){showSuggestionStatus('Saisissez au moins 3 caractères.');return}
 if(state.searchQuery===q&&state.suggestionResults.length){selectSuggestion(state.activeSuggestion>=0?state.activeSuggestion:0);return}
 showSuggestionStatus('Recherche des adresses…');
 try{
  const results=await runAddressSearch(q);
  if(destinationInput.value.trim()!==q)return;
  if(results.length){selectSuggestion(state.activeSuggestion>=0?state.activeSuggestion:0);return}
  showSuggestionStatus('Recherche précise de l’adresse…');
  const exact=await exactAddressSearch(q);
  if(destinationInput.value.trim()!==q)return;
  if(exact.length){state.suggestionResults=exact;state.activeSuggestion=0;renderSuggestions(exact);selectSuggestion(0)}
  else showSuggestionStatus('Aucune adresse trouvée. Vérifiez le nom, le numéro et la localité.')
 }catch(error){if(error.name!=='AbortError')showMessage('Recherche de destination indisponible.')}
}
function routeHasForbiddenTurn(route){return(route.legs||[]).some(leg=>(leg.steps||[]).some(step=>(step.intersections||[]).some(intersection=>Number.isInteger(intersection.out)&&Array.isArray(intersection.entry)&&intersection.entry[intersection.out]===false)))}
async function startRoute(){if(!state.position){showMessage('Attendez le signal GPS avant de lancer le guidage.');return}if(!state.destination){showMessage('Choisissez une destination dans la liste.');return}suggestions.hidden=true;submitButton.disabled=true;submitButton.innerHTML='<span class="spinner"></span>';try{const a=state.position,d=state.destination,r=await fetch('/api/route',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({start:{latitude:a.latitude,longitude:a.longitude},destination:{latitude:d.latitude,longitude:d.longitude}})});if(!r.ok)throw Error('Route indisponible');const data=await r.json();if(data.code!=='Ok'||!data.routes?.length)throw Error('Aucun trajet trouvé');const safeRoute=data.routes.find(route=>!routeHasForbiddenTurn(route));if(!safeRoute)throw Error('Aucun itinéraire ne respecte les restrictions de circulation cartographiées.');state.route=safeRoute;state.steps=state.route.legs.flatMap(leg=>leg.steps||[]);state.stepIndex=Math.min(1,Math.max(0,state.steps.findIndex(s=>s.maneuver?.type!=='depart')));state.navigating=true;state.turnReached=false;state.turnBestDistance=Infinity;state.follow=true;state.offRouteCount=0;state.zoomTarget=zoomForSpeed(state.speed);state.center=[a.longitude,a.latitude];updateDynamicZoom();document.getElementById('arrival-card').hidden=false;document.getElementById('arrival-address').textContent=d.name;document.getElementById('arrival-address').title=d.name;form.classList.add('navigating');destinationInput.value='';destinationInput.placeholder='Navigation en cours';submitButton.textContent='Arrêter';submitButton.disabled=false;submitButton.setAttribute('aria-label','Arrêter la navigation');render();updateGuidance()}catch(error){console.warn('Calcul de trajet impossible',error);showMessage(error.message==='Aucun itinéraire ne respecte les restrictions de circulation cartographiées.'?error.message:'Impossible de calculer ce trajet. Réessayez.');submitButton.disabled=false;submitButton.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6"/></svg>'}}
function stopRoute(){state.route=null;state.steps=[];state.stepIndex=0;state.navigating=false;state.turnReached=false;state.turnBestDistance=Infinity;state.destination=null;state.offRouteCount=0;state.follow=true;document.getElementById('arrival-card').hidden=true;form.classList.remove('navigating','expanded');searchToggle.setAttribute('aria-expanded','false');searchToggle.setAttribute('aria-label','Rechercher une destination');destinationInput.placeholder='Où aller ?';submitButton.disabled=false;submitButton.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6"/></svg>';submitButton.setAttribute('aria-label','Calculer l’itinéraire');guidance.hidden=true;render()}
submitButton.addEventListener('click',e=>{if(state.navigating){e.preventDefault();stopRoute()}});
function checkOffRoute(){if(!state.route||!state.position)return;let best=Infinity;for(const [lon,lat] of state.route.geometry.coordinates){const d=meters(state.position,{longitude:lon,latitude:lat});if(d<best)best=d;if(best<25)break}if(best>85)state.offRouteCount++;else state.offRouteCount=0;if(state.offRouteCount>=3){state.offRouteCount=0;showMessage('Recalcul de l’itinéraire…');startRoute()}}
let drag=null;
mapEl.addEventListener('pointerdown',e=>{if(e.target.closest('button,input,.suggestion'))return;drag={x:e.clientX,y:e.clientY,center:mercator(...state.center),moved:false};mapEl.setPointerCapture(e.pointerId)});
mapEl.addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(!drag.moved&&Math.hypot(dx,dy)>4){drag.moved=true;state.follow=false;updateMapViewToggle()}if(!drag.moved)return;state.center=unproject(drag.center.x-dx,drag.center.y-dy);render()});
const release=()=>{if(drag){const moved=drag.moved;drag=null;if(moved)refreshRadars()}};mapEl.addEventListener('pointerup',release);mapEl.addEventListener('pointercancel',release);
mapEl.addEventListener('wheel',e=>{e.preventDefault();state.follow=false;state.zoom=Math.max(3,Math.min(19,state.zoom+(e.deltaY<0?1:-1)));render()},{passive:false});
mapViewToggle.addEventListener('click',returnToVehicle);
orientationButton.addEventListener('click',()=>{state.orientation=state.orientation==='north'?'heading':'north';localStorage.setItem('map-orientation',state.orientation);render();loadCar(state.orientation==='heading'?'rear':'north')});
soundButton.addEventListener('click',()=>{unlockAudio();state.beepOn=!state.beepOn;localStorage.setItem('radar-sound',state.beepOn?'on':'off');soundButton.classList.toggle('muted',!state.beepOn);soundButton.setAttribute('aria-pressed',String(state.beepOn));soundButton.setAttribute('aria-label',state.beepOn?'Bips radars activés':'Bips radars désactivés');soundButton.title=state.beepOn?'Couper les bips radars':'Activer les bips radars'});
window.addEventListener('resize',render);window.addEventListener('orientationchange',()=>setTimeout(render,150));
soundButton.classList.toggle('muted',!state.beepOn);soundButton.setAttribute('aria-pressed',String(state.beepOn));soundButton.title=state.beepOn?'Couper les bips radars':'Activer les bips radars';
populateCountryMenu();loadCar();render();startGps();refreshRadars();setInterval(refreshRadars,15*60*1000);
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('/service-worker.js').catch(()=>{}));