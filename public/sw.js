/* Caderno de Questões PWA: cache only same-origin, versioned static assets.
   Never intercept Supabase/auth/API calls or cache user data. */
const CACHE_NAME="caderno-static-v1";
const STATIC_ASSETS=["/","/offline.html"];
self.addEventListener("install",event=>{
  event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});
self.addEventListener("activate",event=>{
  event.waitUntil(Promise.all([
    caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith("caderno-static-")&&key!==CACHE_NAME).map(key=>caches.delete(key)))),
    self.clients.claim()
  ]));
});
self.addEventListener("fetch",event=>{
  const request=event.request;
  if(request.method!=="GET"||new URL(request.url).origin!==self.location.origin)return;
  const url=new URL(request.url);
  if(url.pathname.startsWith("/api/")||url.pathname.startsWith("/auth/"))return;
  if(request.mode==="navigate"){
    event.respondWith(fetch(request).catch(()=>caches.match("/offline.html")));
    return;
  }
  if(!url.pathname.startsWith("/assets/")&&!url.pathname.startsWith("/icons/"))return;
  event.respondWith(caches.match(request).then(hit=>hit||fetch(request).then(response=>{
    if(response.ok&&response.type==="basic"){
      const copy=response.clone();
      caches.open(CACHE_NAME).then(cache=>cache.put(request,copy));
    }
    return response;
  })));
});
