const MAP_STYLE_URL='https://tiles.openfreemap.org/styles/liberty';
const SATELLITE_TILES='https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const speedNode=document.getElementById('speed'),gpsNode=document.getElementById('gps-status'),messageNode=document.getElementById('message');
let map=null,rasterFallback=null,lastPosition=null,lastHeading=null,displaySpeed=0,gpsSpeedKmh=0,watchId=null,vehicleMarker=null,followGps=true;
let radarRefreshTimer=null,lastRadarCell='',lastRadarFetchAt=0,radarFeatures=[],radarCountryCode='',audioContext=null,soundEnabled=localStorage.getItem('radar-sound')!=='off';
const alertedRadars=new Map();
const soundButton=document.getElementById('sound-toggle'),recenterButton=document.getElementById('recenter');
function renderSoundButton(){soundButton.classList.toggle('muted',!soundEnabled);soundButton.setAttribute('aria-pressed',String(soundEnabled));soundButton.setAttribute('aria-label',soundEnabled?'Bips radars activés':'Bips radars désactivés')}
function unlockAudio(){const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)return;try{audioContext ||= new Audio();if(audioContext.state==='suspended')audioContext.resume()}catch(error){console.warn('Audio indisponible',error)}}
document.addEventListener('pointerdown',event=>{if(!event.target.closest('#sound-toggle'))unlockAudio()},{passive:true});
soundButton.addEventListener('click',()=>{if(!audioContext){unlockAudio();return}soundEnabled=!soundEnabled;localStorage.setItem('radar-sound',soundEnabled?'on':'off');renderSoundButton()});
renderSoundButton();
recenterButton.addEventListener('click',()=>{if(!lastPosition)return;followGps=true;recenterButton.hidden=true;if(map)map.easeTo({center:[lastPosition.longitude,lastPosition.latitude],...(lastHeading!==null?{bearing:lastHeading}:{}),duration:650,essential:true});else if(rasterFallback){rasterFallback.center=[lastPosition.longitude,lastPosition.latitude];renderFallbackMap()}});
function satelliteStyle(osmStyle){
 const style={version:8,glyphs:osmStyle?.glyphs,sources:{imagery:{type:'raster',tiles:[SATELLITE_TILES],tileSize:256,attribution:'Imagerie © Esri'}},layers:[{id:'satellite',type:'raster',source:'imagery',minzoom:0,maxzoom:19}]};
 if(!osmStyle)return style;
 const vectorSource=Object.entries(osmStyle.sources||{}).find(([,source])=>source.type==='vector');
 if(!vectorSource)return style;
 style.sources.osm=vectorSource[1];
 const selected=(osmStyle.layers||[]).filter(layer=>{
  if(layer.type==='background'||layer.source!==vectorSource[0]||!layer['source-layer'])return false;
  const key=(layer.id+' '+layer['source-layer']).toLowerCase();
  return(layer.type==='line'&&/(transportation|road)/.test(key))||(layer.type==='symbol'&&layer.layout?.['text-field']&&/(transportation|road|place)/.test(key));
 });
 for(const original of selected){
  const layer=structuredClone(original);layer.source='osm';
  if(layer.type==='line')layer.paint={...(layer.paint||{}),'line-color':'#f5f1e8','line-opacity':0.58,'line-width':['interpolate',['linear'],['zoom'],8,0.25,14,1.2,18,3]};
  else{layer.layout={...(layer.layout||{})};for(const key of ['icon-image','icon-size','icon-offset','icon-anchor','icon-rotate'])delete layer.layout[key];layer.paint={...(layer.paint||{}),'text-color':'#fff','text-halo-color':'rgba(0,0,0,0.92)','text-halo-width':1.5,'text-halo-blur':.3};if(layer.layout['text-field'])layer.layout['text-size']=12}
  style.layers.push(layer);
 }
 return style;
}
function setGpsState(state,label){gpsNode.className='gps-status '+state;gpsNode.setAttribute('aria-label',label)}
function showMessage(text){messageNode.textContent=text;messageNode.hidden=false;clearTimeout(showMessage.timer);showMessage.timer=setTimeout(()=>messageNode.hidden=true,5200)}
function smoothBearing(next){
 if(!Number.isFinite(next))return lastHeading;if(lastHeading===null){lastHeading=(next+360)%360;return lastHeading}
 const difference=((next-lastHeading+540)%360)-180;lastHeading=(lastHeading+difference*.22+360)%360;return lastHeading;
}
function updatePosition(position){
 const {latitude,longitude,speed,heading,accuracy}=position.coords;let kmh=Number.isFinite(speed)&&speed>=0?speed*3.6:null;
 if(kmh===null&&lastPosition){const elapsed=(position.timestamp-lastPosition.timestamp)/1000;if(elapsed>.2){const rad=value=>value*Math.PI/180,dLat=rad(latitude-lastPosition.latitude),dLon=rad(longitude-lastPosition.longitude),a=Math.sin(dLat/2)**2+Math.cos(rad(lastPosition.latitude))*Math.cos(rad(latitude))*Math.sin(dLon/2)**2;kmh=2*6371000*Math.atan2(Math.sqrt(a),Math.sqrt(1-a))/elapsed*3.6}}
 if(kmh===null)kmh=0;gpsSpeedKmh=Math.min(260,kmh);displaySpeed=displaySpeed*.55+gpsSpeedKmh*.45;speedNode.textContent=String(Math.round(displaySpeed));
 let bearing=Number.isFinite(heading)&&heading>=0?heading:null;
 if(bearing===null&&lastPosition){const lat1=lastPosition.latitude*Math.PI/180,lat2=latitude*Math.PI/180,dLon=(longitude-lastPosition.longitude)*Math.PI/180,y=Math.sin(dLon)*Math.cos(lat2),x=Math.cos(lat1)*Math.sin(lat2)-Math.sin(lat1)*Math.cos(lat2)*Math.cos(dLon);bearing=(Math.atan2(y,x)*180/Math.PI+360)%360}
 lastPosition={latitude,longitude,timestamp:position.timestamp};checkRadarProximity();setGpsState('','Signal GPS actif, précision ±'+Math.round(accuracy||0)+' mètres');
 if(map){
  const targetBearing=smoothBearing(bearing),vehicle=document.getElementById('vehicle-marker'),vehicleArt=document.getElementById('vehicle-art');
  if(!vehicleMarker){vehicle.style.display='block';vehicleMarker=new maplibregl.Marker({element:vehicle,anchor:'center',rotationAlignment:'viewport'}).setLngLat([longitude,latitude]).addTo(map)}
  else vehicleMarker.setLngLat([longitude,latitude]);
  if(targetBearing!==null&&vehicleArt)vehicleArt.style.setProperty('--car-angle',(targetBearing-map.getBearing())+'deg');
  if(followGps){map.easeTo({center:[longitude,latitude],...(targetBearing!==null?{bearing:targetBearing}:{}),duration:vehicleMarker._gpsCentered?700:0,essential:true});vehicleMarker._gpsCentered=true}
 }
}
function startGps(){
 if(!('geolocation'in navigator)){setGpsState('error','GPS indisponible');showMessage('Ce navigateur ne donne pas accès au GPS.');return}
 watchId=navigator.geolocation.watchPosition(updatePosition,error=>{setGpsState('error','Signal GPS indisponible');if(error.code===1)showMessage('Autorisez la localisation GPS dans les réglages du navigateur.');else{gpsNode.classList.add('searching');showMessage('Recherche du signal GPS…')}},{enableHighAccuracy:true,maximumAge:1000,timeout:20000});
}
function radarCell(lat,lon){return Math.floor(lat/.05)+':'+Math.floor(lon/.05)}
function addRadarLayers(){
 map.addSource('radars',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
 map.addLayer({id:'radar-points',type:'circle',source:'radars',paint:{'circle-radius':['interpolate',['linear'],['zoom'],10,6,15,9,18,12],'circle-color':'#ec4654','circle-stroke-color':'#fff','circle-stroke-width':2,'circle-opacity':.97}});
 map.addLayer({id:'radar-lenses',type:'circle',source:'radars',paint:{'circle-radius':['interpolate',['linear'],['zoom'],10,1.8,18,3.2],'circle-color':'#351116'}});
 map.on('mouseenter','radar-points',()=>{map.getCanvas().style.cursor='pointer'});
 map.on('mouseleave','radar-points',()=>{map.getCanvas().style.cursor=''});
 map.on('click','radar-points',event=>{
  const feature=event.features?.[0];if(!feature)return;
  const tags=feature.properties||{},speed=tags.speedLimit?' · '+tags.speedLimit+' km/h':'';
  new maplibregl.Popup({closeButton:false,closeOnClick:true,offset:12}).setLngLat(event.lngLat).setText('Radar fixe'+speed+' · OpenStreetMap').addTo(map);
 });
}
function parseSpeedLimit(value){
 if(!value)return null;
 const text=String(value).trim().toLowerCase(),match=text.match(/(\d+(?:[.,]\d+)?)/);
 if(!match)return null;
 let limit=Number(match[1].replace(',','.'));
 if(text.includes('mph'))limit*=1.60934;
 return Number.isFinite(limit)&&limit>0?limit:null;
}
function roadLimitForRadar(point,roads){
 let bestDistance=Infinity,bestLimit=null;
 for(const road of roads||[]){
  const coords=road.geometry||[];if(coords.length<2)continue;
  const rad=value=>value*Math.PI/180,latScale=111320,lonScale=111320*Math.cos(rad(point[1]));
  for(let i=1;i<coords.length;i++){
   const a=coords[i-1],b=coords[i],ax=(a[0]-point[0])*lonScale,ay=(a[1]-point[1])*latScale,bx=(b[0]-point[0])*lonScale,by=(b[1]-a[1])*latScale,dx=bx-ax,dy=by-ay,length2=dx*dx+dy*dy,t=length2?Math.max(0,Math.min(1,-(ax*dx+ay*dy)/length2)):0,distance=Math.hypot(ax+t*dx,ay+t*dy),limit=parseSpeedLimit(road.maxspeed);
   if(distance<bestDistance&&distance<=35&&limit){bestDistance=distance;bestLimit=limit}
  }
 }
 return bestLimit;
}
async function refreshRadars(){
 if(!lastPosition||(!map&&!rasterFallback))return;
 const key=radarCell(lastPosition.latitude,lastPosition.longitude),now=Date.now();
 if(key===lastRadarCell&&now-lastRadarFetchAt<15*60*1000)return;
 lastRadarCell=key;lastRadarFetchAt=now;
 try{
  const query=new URLSearchParams({lat:lastPosition.latitude.toFixed(3),lon:lastPosition.longitude.toFixed(3)});
  const response=await fetch('/api/radars?'+query.toString(),{cache:'no-store'});
  if(!response.ok)throw new Error('radar feed '+response.status);
  const result=await response.json();
  radarCountryCode=result.countryCode||'';
  radarFeatures=radarCountryCode==='BE'?(result.radars||[]).map(item=>{const coordinates=[item.lon,item.lat],speedLimit=parseSpeedLimit(item.maxspeed)||roadLimitForRadar(coordinates,result.roads);return{type:'Feature',id:item.id,geometry:{type:'Point',coordinates},properties:{maxspeed:item.maxspeed||'',speedLimit}}}):[];
  if(radarCountryCode!=='BE')alertedRadars.clear();
  map.getSource('radars')?.setData({type:'FeatureCollection',features:radarFeatures});
  checkRadarProximity();
 }catch(error){console.warn('Mise à jour des radars impossible.',error);lastRadarFetchAt=Date.now()-14*60*1000}
}
function distanceBetween(lat1,lon1,lat2,lon2){
 const rad=value=>value*Math.PI/180,dLat=rad(lat2-lat1),dLon=rad(lon2-lon1),a=Math.sin(dLat/2)**2+Math.cos(rad(lat1))*Math.cos(rad(lat2))*Math.sin(dLon/2)**2;
 return 6371000*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
function playRadarBeep(){
 if(!soundEnabled||!audioContext||audioContext.state!=='running')return;
 try{const oscillator=audioContext.createOscillator(),gain=audioContext.createGain(),now=audioContext.currentTime;oscillator.type='sine';oscillator.frequency.value=880;gain.gain.setValueAtTime(.0001,now);gain.gain.exponentialRampToValueAtTime(.12,now+.015);gain.gain.exponentialRampToValueAtTime(.0001,now+.18);oscillator.connect(gain);gain.connect(audioContext.destination);oscillator.start(now);oscillator.stop(now+.19)}catch(error){console.warn('Bip radar impossible',error)}
}
function checkRadarProximity(){
 if(!lastPosition||!radarFeatures.length||radarCountryCode!=='BE')return;
 const now=Date.now();let nearest=null;
 for(const radar of radarFeatures){
  const distance=distanceBetween(lastPosition.latitude,lastPosition.longitude,radar.geometry.coordinates[1],radar.geometry.coordinates[0]);
  if(distance>500){alertedRadars.delete(String(radar.id));continue}
  const limit=Number(radar.properties?.speedLimit);
  if(distance<=100&&Number.isFinite(limit)&&limit>0&&gpsSpeedKmh>limit&&!alertedRadars.has(String(radar.id))&&(!nearest||distance<nearest.distance))nearest={id:String(radar.id),distance};
 }
 if(nearest){
  alertedRadars.set(nearest.id,now);
  playRadarBeep();
 }
}
function scheduleRadarRefresh(){
 clearTimeout(radarRefreshTimer);radarRefreshTimer=setTimeout(()=>refreshRadars(),900);
}
function mercatorPoint(lon,lat,zoom){const scale=256*2**zoom,sine=Math.sin(Math.max(-85.0511,Math.min(85.0511,lat))*Math.PI/180);return{x:(lon+180)/360*scale,y:(.5-Math.log((1+sine)/(1-sine))/(4*Math.PI))*scale}}
function renderFallbackMap(){if(!rasterFallback)return;const{container,center,zoom}=rasterFallback,w=container.clientWidth,h=container.clientHeight,mid=mercatorPoint(center[0],center[1],zoom),left=mid.x-w/2,top=mid.y-h/2;container.replaceChildren();const tiles=document.createElement('div');tiles.className='raster-tiles';container.append(tiles);const minX=Math.floor(left/256)-1,maxX=Math.floor((left+w)/256)+1,minY=Math.floor(top/256)-1,maxY=Math.floor((top+h)/256)+1,count=2**zoom;for(let ty=minY;ty<=maxY;ty++)for(let tx=minX;tx<=maxX;tx++){if(ty<0||ty>=count)continue;const img=document.createElement('img');img.alt='';img.draggable=false;img.src=SATELLITE_TILES.replace('{z}',zoom).replace('{x}',((tx%count)+count)%count).replace('{y}',ty);img.style.left=(tx*256-left)+'px';img.style.top=(ty*256-top)+'px';tiles.append(img)}const vehicle=document.getElementById('vehicle-marker');if(lastPosition){const p=mercatorPoint(lastPosition.longitude,lastPosition.latitude,zoom);vehicle.style.display='block';vehicle.style.position='absolute';vehicle.style.zIndex='2';vehicle.style.left=(p.x-left)+'px';vehicle.style.top=(p.y-top)+'px';vehicle.style.transform='translate(-50%,-50%)';const art=document.getElementById('vehicle-art');if(lastHeading!==null)art.style.setProperty('--car-angle',lastHeading+'deg')}else vehicle.style.display='none';const pins=document.createElement('div');pins.className='fallback-radars';for(const radar of radarFeatures){const p=mercatorPoint(radar.geometry.coordinates[0],radar.geometry.coordinates[1],zoom),pin=document.createElement('i');pin.className='fallback-radar';pin.style.left=(p.x-left)+'px';pin.style.top=(p.y-top)+'px';pins.append(pin)}container.append(pins)}
function startRasterFallback(){const container=document.getElementById('map');rasterFallback={container,center:[4.6,50.55],zoom:16};let drag=null;container.addEventListener('pointerdown',event=>{if(event.target.closest('.vehicle'))return;drag={x:event.clientX,y:event.clientY,center:mercatorPoint(...rasterFallback.center,rasterFallback.zoom)};container.setPointerCapture(event.pointerId);followGps=false;recenterButton.hidden=false});container.addEventListener('pointermove',event=>{if(!drag)return;const p={x:drag.center.x-(event.clientX-drag.x),y:drag.center.y-(event.clientY-drag.y)},scale=256*2**rasterFallback.zoom,lon=p.x/scale*360-180,n=Math.PI-2*Math.PI*p.y/scale,lat=180/Math.PI*Math.atan(Math.sinh(n));rasterFallback.center=[lon,lat];renderFallbackMap()});const release=()=>{drag=null};container.addEventListener('pointerup',release);container.addEventListener('pointercancel',release);container.addEventListener('wheel',event=>{event.preventDefault();rasterFallback.zoom=Math.max(3,Math.min(19,rasterFallback.zoom+(event.deltaY<0?1:-1)));renderFallbackMap()},{passive:false});renderFallbackMap()}

function startMap(){
 let readyOsmStyle=null,osmStyleApplied=false,gpsStarted=false,radarTimerStarted=false;
 try{map=new maplibregl.Map({container:'map',style:satelliteStyle(null),center:[4.6,50.55],zoom:16,minZoom:3,maxZoom:19,pitch:0,bearing:0,attributionControl:false,dragRotate:false,keyboard:false,logoPosition:'bottom-right'})}catch(error){console.warn('WebGL indisponible ; affichage raster activé.',error);startRasterFallback();startGps();return}
 map.on('error',event=>console.warn('Erreur de carte',event.error));
 map.on('dragstart',()=>{followGps=false;recenterButton.hidden=false});
 map.on('style.load',()=>{
  if(readyOsmStyle&&!osmStyleApplied){osmStyleApplied=true;map.setStyle(satelliteStyle(readyOsmStyle));return}
  if(!map.getSource('radars'))addRadarLayers();
  map.getSource('radars')?.setData({type:'FeatureCollection',features:radarFeatures});
  if(!gpsStarted){gpsStarted=true;startGps()}
  if(!radarTimerStarted){radarTimerStarted=true;map.on('moveend',scheduleRadarRefresh);setInterval(refreshRadars,15*60*1000)}
 });
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),5000);
 fetch(MAP_STYLE_URL,{mode:'cors',signal:controller.signal})
  .then(response=>{if(!response.ok)throw new Error('Style OSM indisponible');return response.json()})
  .then(style=>{readyOsmStyle=style;if(map.isStyleLoaded()&&!osmStyleApplied){osmStyleApplied=true;map.setStyle(satelliteStyle(readyOsmStyle))}})
  .catch(error=>console.warn('Routes OSM ignorées ; la carte satellite reste active.',error))
  .finally(()=>clearTimeout(timeout));
}
startMap();window.addEventListener('pagehide',()=>{if(watchId!==null)navigator.geolocation.clearWatch(watchId)});
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('/service-worker.js').catch(()=>{}));