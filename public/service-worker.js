const CACHE='tesla-gps-navigation-v36';
const SHELL=['/','/index.html','/manifest.json','/src/styles.css','/src/app.js','/icons/tesla-nav.svg','/tesla-model3-top.png.b64','/tesla-3d-north.png.b64','/tesla-3d-rear.png.b64'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 const req=event.request,url=new URL(req.url);
 if(req.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return;
 event.respondWith(fetch(req).then(response=>{
  if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(req,copy))}
  return response;
 }).catch(async()=>{
  const cache=await caches.open(CACHE);
  return await cache.match(req)||await cache.match(url.pathname)||await cache.match('/index.html');
 }));
});