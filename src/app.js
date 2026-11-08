const MAP_STYLE_URL='https://tiles.openfreemap.org/styles/liberty';
const SATELLITE_TILES='https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const speedNode=document.getElementById('speed'),gpsNode=document.getElementById('gps-status'),messageNode=document.getElementById('message');
let map=null,lastPosition=null,lastHeading=null,displaySpeed=0,gpsSpeedKmh=0,watchId=null,vehicleMarker=null,followGps=true;
let radarRefreshTimer=null,lastRadarCell='',lastRadarFetchAt=0,radarFeatures=[],radarCountryCode='',audioContext=null,soundEnabled=localStorage.getItem('radar-sound')!=='off';
const alertedRadars=new Map();
const soundButton=document.getElementById('sound-toggle'),recenterButton=document.getElementById('recenter');
function renderSoundButton(){soundButton.classList.toggle('muted',!soundEnabled);soundButton.setAttribute('aria-pressed',String(soundEnabled));soundButton.setAttribute('aria-label',soundEnabled?'Bips radars activés':'Bips radars désactivés')}
function unlockAudio(){const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)return;try{audioContext ||= new Audio();if(audioContext.state==='suspended')audioContext.resume()}catch(error){console.warn('Audio indisponible',error)}}
document.addEventListener('pointerdown',event=>{if(!event.target.closest('#sound-toggle'))unlockAudio()},{passive:true});
soundButton.addEventListener('click',()=>{if(!audioContext){unlockAudio();return}soundEnabled=!soundEnabled;localStorage.setItem('radar-sound',soundEnabled?'on':'off');renderSoundButton()});
renderSoundButton();
recenterButton.addEventListener('click',()=>{if(!map||!lastPosition)return;followGps=true;recenterButton.hidden=true;map.easeTo({center:[lastPosition.longitude,lastPosition.latitude],...(lastHeading!==null?{bearing:lastHeading}:{}),duration:650,essential:true})});
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
  if(!vehicleMarker)vehicleMarker=new maplibregl.Marker({element:vehicle,anchor:'center',rotationAlignment:'viewport'}).setLngLat([longitude,latitude]).addTo(map);
  else vehicleMarker.setLngLat([longitude,latitude]);
  if(targetBearing!==null&&vehicleArt)vehicleArt.style.setProperty('--car-angle',(targetBearing-map.getBearing())+'deg');
  if(followGps){map.easeTo({center:[longitude,latitude],...(targetBearing!==null?{bearing:targetBearing}:{}),duration:vehicleMarker._gpsCentered?700:0,essential:true});vehicleMarker._gpsCentered=true}
 }
}
function startGps(){
 if(!('geolocation'in navigator)){setGpsState('error','GPS indisponible');showMessage('Ce navigateur ne donne pas accès au GPS.');return}
 watchId=navigator.geolocation.watchPosition(updatePosition,error=>{setGpsState('error','Signal GPS indisponible');if(error.code===1)showMessage('Autorisez la localisation GPS dans les réglages du navigateur.');else{gpsNode.classList.add('searching');showMessage('Recherche du signal GPS…')}},{enableHighAccuracy:true,maximumAge:1000,timeout:20000});
}
async function radarCell(lat,lon){return Math.floor(lat/.05)+':'+Math.floor(lon/.05)}
function addRadarLayers(){
 map.addSource('radars',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
 map.addLayer({id:'radar-points',type:'circle',source:'radars',paint:{'circle-radius':['interpolate',['linear'],['zoom'],10,6,15,9,18,12],'circle-color':'#ec4654','circle-stroke-color':'#fff','circle-stroke-width':2,'circle-opacity':.97}});
 map.addLayer({id:'radar-lenses',type:'circle',source:'radars',paint:{'circle-radius':['interpolate',['linear'],['zoom'],10,1.8,18,3.2],'circle-color':'#351116'}});
 map.on('mouseenter','radar-points',()=>{map.getCanvas().style.cursor='pointer'});
 map.on('mouseleave','radar-points',()=>{map.getCanvas().style.cursor=''});
 map.on('click','radar-points',event=>{
  const feature=event.features?.[0];if(!feature)return;
  const tags=feature.properties||{},speed=tags.maxspeed&&tags.maxspeed!=='null'?' · '+tags.maxspeed+' km/h':'';
  new maplibregl.Popup({closeButton:false,closeOnClick:true,offset:12}).setLngLat(event.lngLat).setText('Radar fixe'+speed+' · OpenStreetMap').addTo(map);
 });
}
async function refreshRadars(){
 if(!lastPosition||!map)return;
 const key=radarCell(lastPosition.latitude,lastPosition.longitude),now=Date.now();
 if(key===lastRadarCell&&now-lastRadarFetchAt<15*60*1000)return;
 lastRadarCell=key;lastRadarFetchAt=now;
 try{
  const query=new URLSearchParams({lat:lastPosition.latitude.toFixed(3),lon:lastPosition.longitude.toFixed(3)});
  const response=await fetch('/api/radars?'+query.toString(),{cache:'no-store'});
  if(!response.ok)throw new Error('radar feed '+response.status);
  const result=await response.json();
  radarCountryCode=result.countryCode||'';
  radarFeatures=radarCountryCode==='BE'?(result.radars||[]).map(item=>({type:'Feature',id:item.id,geometry:{type:'Point',coordinates:[item.lon,item.lat]},properties:{maxspeed:item.maxspeed||'',speedLimit:item.speedLimit}})):[];
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
  if(distance<=100&&Number.isFinite(limit)&&gpsSpeedKmh>limit&&!alertedRadars.has(String(radar.id))&&(!nearest||distance<nearest.distance))nearest={id:String(radar.id),distance};
 }
 if(nearest){
  alertedRadars.set(nearest.id,now);
  playRadarBeep();
 }
}
function scheduleRadarRefresh(){
 clearTimeout(radarRefreshTimer);radarRefreshTimer=setTimeout(()=>refreshRadars(),900);
}
function startMap(){
 let osmStyle=null;try{const response=await fetch(MAP_STYLE_URL,{mode:'cors'});if(response.ok)osmStyle=await response.json()}catch(error){console.warn('Le fond OSM ne peut pas être chargé.',error)}
 map=new maplibregl.Map({container:'map',style:satelliteStyle(osmStyle),center:[4.6,50.55],zoom:16,minZoom:3,maxZoom:19,pitch:0,bearing:0,attributionControl:false,dragRotate:false,keyboard:false,logoPosition:'bottom-right'});
 map.on('error',event=>console.warn('Erreur de carte',event.error));map.on('dragstart',()=>{followGps=false;recenterButton.hidden=false});map.once('load',()=>{addRadarLayers();startGps();map.on('moveend',scheduleRadarRefresh);setInterval(refreshRadars,15*60*1000)});
}
startMap();window.addEventListener('pagehide',()=>{if(watchId!==null)navigator.geolocation.clearWatch(watchId)});
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('/service-worker.js').catch(()=>{}));