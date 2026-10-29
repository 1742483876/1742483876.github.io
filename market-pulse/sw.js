'use strict';
const BUILD='729d34d40d2b2d0d';
const SCOPE=new URL(self.registration.scope);
const PREFIX='market-pulse-mobile:'+SCOPE.pathname+':';
const SHELL=PREFIX+'shell:'+BUILD, DATA=PREFIX+'data:'+BUILD;
const SHELL_FILES=['./','./index.html','./style.css','./app.js','./manifest.webmanifest','./icon.svg','./icon-192.png','./icon-512.png','./apple-touch-icon.png'];
const PINNED_DATA_PATHS=new Set(['data/catalog.json','data/research/catalog.json'].map(p=>new URL(p,SCOPE).pathname));
self.addEventListener('install',event=>event.waitUntil((async()=>{const cache=await caches.open(SHELL);await cache.addAll(SHELL_FILES.map(p=>new URL(p,SCOPE).href));await self.skipWaiting();})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const name of await caches.keys())if(name.startsWith(PREFIX)&&name!==SHELL&&name!==DATA)await caches.delete(name);await self.clients.claim();})()));
async function limitEntries(cache,maximum){
  // The two directories are needed to discover cached charts/results offline.
  // Count only leaf data toward the limit; query-versioned directories stay pinned.
  const leaves=(await cache.keys()).filter(request=>!PINNED_DATA_PATHS.has(new URL(request.url).pathname));
  for(let i=0;i<leaves.length-maximum;i++)await cache.delete(leaves[i]);
}
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==SCOPE.origin||!url.pathname.startsWith(SCOPE.pathname))return;
  const isData=url.pathname.startsWith(new URL('data/',SCOPE).pathname)&&url.pathname.endsWith('.json');
  const isShell=request.mode==='navigate'||SHELL_FILES.some(p=>new URL(p,SCOPE).pathname===url.pathname);
  if(!isData&&!isShell)return;
  event.respondWith((async()=>{
    const cache=await caches.open(isData?DATA:SHELL);
    try{
      const response=await fetch(request);
      if(response.ok){await cache.put(request,response.clone());if(isData)await limitEntries(cache,90);}
      if(response.ok||!isData)return response;
      return (await cache.match(request))||response;
    }catch(error){
      const stored=await cache.match(request);
      if(stored)return stored;
      if(request.mode==='navigate'){const home=await cache.match(new URL('./index.html',SCOPE).href);if(home)return home;}
      return new Response(isData?JSON.stringify({error:'离线时尚未缓存此快照。'}):'当前离线，尚未保存此页面。',{status:503,headers:{'Content-Type':isData?'application/json; charset=utf-8':'text/plain; charset=utf-8'}});
    }
  })());
});
