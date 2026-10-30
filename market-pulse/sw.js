'use strict';
const BUILD='6ee45ae91843277b';
const SCOPE=new URL(self.registration.scope);
const PREFIX='market-pulse-mobile:'+SCOPE.pathname+':';
const SHELL=PREFIX+'shell:'+BUILD, DATA=PREFIX+'data:v2';
const SHELL_FILES=['./','./index.html','./style.css','./app.js','./offline.js','./recent-signals.js','./recent-signals.css','./mobile-shell.js','./mobile-shell.css','./market-pages.js','./market-pages.css','./theme.js','./theme.css','./upgrade.html','./manifest.webmanifest','./icon.svg','./icon-192.png','./icon-512.png','./apple-touch-icon.png'];
const SHELL_PATHS=new Set(SHELL_FILES.map(p=>new URL(p,SCOPE).pathname));
const PINNED_DATA_PATHS=new Set(['data/catalog.json','data/research/catalog.json','data/archive/catalog.json','data/signals/recent.json','data/analytics/catalog.json'].map(p=>new URL(p,SCOPE).pathname));
const ANALYTICS_FILES=new Set(['catalog','sectors-CN','sectors-HK','sectors-US','environment-CN','environment-HK','environment-US','environment-BTC']);
const CODE='(?:BTC-USD|(?:sh|sz)[0-9]{6}|hk[0-9]{5}|us[A-Z][A-Z0-9.\\-]{0,12})';
const CHART=new RegExp('^data/charts/('+CODE+')/day\\.json$');
const RESULT=new RegExp('^data/research/(baseline|trend60|breakout_only|hold20|half_1r_2r|donchian20|rsi_pullback|boll_reentry|compression_breakout)/('+CODE+')/(full|development|validation|recent)\\.json$');
// Public Pages TTFB can exceed five seconds on mobile networks. These bounds
// protect genuinely cold reads; cached responses never wait for these timers.
const CATALOG_TIMEOUT=20000, DATA_TIMEOUT=20000, VERSION_TIMEOUT=15000;
const BUILD_HEADER='X-Pulse-Build';
let writes=Promise.resolve();
const pendingData=new Map();

// Exact query identity is essential: no ignoreSearch or fallback to another v.
// Only legacy unversioned S summaries may gain an alias after body validation.
function dataIdentity(value){
  try{
    const raw=typeof value==='string'?value:value.url;
    if(raw.length>2048||/(?:\/|%2f)(?:\.|%2e){1,2}(?:\/|%2f|[?#]|$)/i.test(raw))return null;
    const url=new URL(raw,SCOPE);
    if(url.origin!==SCOPE.origin||!url.pathname.startsWith(SCOPE.pathname)||url.hash||url.username||url.password)return null;
    const path=url.pathname.slice(SCOPE.pathname.length),query=[...url.searchParams];
    if(query.length>1||(query.length===1&&(query[0][0]!=='v'||!query[0][1]||query[0][1].length>128)))return null;
    const version=query[0]?.[1]||null;
    if(path==='data/catalog.json'||path==='data/research/catalog.json')return {url,path,version,kind:path==='data/catalog.json'?'catalog':'research-catalog'};
    if(path==='data/archive/catalog.json')return {url,path,version,kind:'archive-catalog'};
    if(path==='data/signals/recent.json')return {url,path,version,kind:'signal-index'};
    const analytics=/^data\/analytics\/([A-Za-z-]+)\.json$/.exec(path);
    if(analytics&&ANALYTICS_FILES.has(analytics[1])){
      const [type,market]=analytics[1].split('-');return {url,path,version,kind:'analytics-'+type,market};
    }
    if(!version)return null;
    const archive=/^data\/archive\/charts\/((?:sh|sz|bj)[0-9]{6})\.json$/.exec(path);
    if(archive)return {url,path,version,kind:'archive-chart',code:archive[1]};
    let match=CHART.exec(path);if(match)return {url,path,version,kind:'chart',code:match[1]};
    match=RESULT.exec(path);if(match)return {url,path,version,kind:'result',profile:match[1],code:match[2],phase:match[3]};
  }catch(_){}
  return null;
}
function unavailable(message='离线时尚未缓存此快照。'){
  return new Response(JSON.stringify({error:message}),{status:503,headers:{'Content-Type':'application/json; charset=utf-8'}});
}
async function timedFetch(request,timeout,cacheMode='no-store'){
  const controller=new AbortController();let timer;
  try{
    const read=async()=>{
      const response=await fetch(request,{signal:controller.signal,cache:cacheMode});
      // A fast header with a stalled body must not defeat the offline deadline.
      const payload=response.ok?await response.clone().json():null;
      return {response,payload};
    };
    return await Promise.race([read(),new Promise((_,reject)=>{
      timer=setTimeout(()=>{controller.abort();reject(new Error('network timeout'));},timeout);
    })]);
  }finally{clearTimeout(timer);}
}
async function limitEntries(cache,maximum){
  const keys=await cache.keys(),leaves=keys.filter(request=>!PINNED_DATA_PATHS.has(new URL(request.url).pathname));
  for(let i=0;i<leaves.length-maximum;i++)await cache.delete(leaves[i]);
  // Keep the unversioned directory and the last three versioned copies.
  for(const path of PINNED_DATA_PATHS){
    const versions=keys.filter(request=>{const u=new URL(request.url);return u.pathname===path&&u.searchParams.has('v');});
    for(let i=0;i<versions.length-3;i++)await cache.delete(versions[i]);
  }
}
async function saveData(request,response){
  // Mark only a successfully validated source response, never a migrated or
  // offline fallback entry. A new shell must verify inherited directories.
  const copy=withHeaders(response,{[BUILD_HEADER]:BUILD});
  const pending=writes.catch(()=>{}).then(async()=>{
    try{const cache=await caches.open(DATA);await cache.put(request,copy);await limitEntries(cache,90);return true;}catch(_){return false;}
  });
  writes=pending;return pending;
}
function withHeaders(response,values){
  const headers=new Headers(response.headers);
  // Fetch bodies are decoded already; synthetic responses must not advertise
  // the old wire compression/length after adding our local metadata.
  headers.delete('Content-Encoding');headers.delete('Content-Length');
  for(const [key,value] of Object.entries(values))headers.set(key,value);
  return new Response(response.clone().body,{status:response.status,statusText:response.statusText,headers});
}
async function previousBuildFallback(request,id,stored){
  if(id.version||stored.headers.get(BUILD_HEADER)===BUILD)return stored;
  const cacheBuild=stored.headers.get(BUILD_HEADER)||'unmarked';
  try{
    if(self.clients.matchAll)for(const client of await self.clients.matchAll({type:'window',includeUncontrolled:true})){
      const url=new URL(client.url);if(url.origin===SCOPE.origin&&url.pathname.startsWith(SCOPE.pathname))client.postMessage({type:'PULSE_PREVIOUS_BUILD_FALLBACK',url:request.url,build:BUILD,cache_build:cacheBuild});
    }
  }catch(_){}
  return withHeaders(stored,{'X-Pulse-Cache-State':'previous-build-fallback','X-Pulse-Active-Build':BUILD});
}
async function cachedData(request){
  const cache=await caches.open(DATA),hit=await cache.match(request);
  if(hit)return hit;
  const names=(await caches.keys()).reverse(),stores=[cache];
  // A quota-constrained migration may leave an exact legacy entry in place.
  for(const name of names){
    if(name.startsWith(PREFIX+'data:')&&name!==DATA){const legacy=await caches.open(name),stored=await legacy.match(request);if(stored)return stored;stores.push(legacy);}
  }
  const id=dataIdentity(request);
  if(id?.kind==='signal-index'&&id.version){
    // Older shells saved this one directory without a query. Reuse it only
    // when its declared snapshot exactly matches the requested version.
    const unversioned=new URL(id.url);unversioned.search='';
    for(const store of stores){
      const stored=await store.match(unversioned.href);if(!stored?.ok)continue;
      try{if(!validPayload(await stored.clone().json(),id))continue;}catch(_){continue;}
      const copy=stored.clone();
      const pending=writes.catch(()=>{}).then(async()=>{
        // Keep its original build/source headers: this is a saved response,
        // not newly fetched data. A quota error must not lose the readable body.
        try{if(!await cache.match(request)){await cache.put(request,copy);await limitEntries(cache,90);}}catch(_){}
      });
      writes=pending;await pending;return stored;
    }
  }
  return null;
}
function validPayload(payload,id,expected){
  if(id.kind==='catalog')return Array.isArray(payload.assets)&&typeof payload.snapshot_at==='string'&&(!id.version||payload.snapshot_at===id.version);
  if(id.kind==='archive-catalog')return payload.schema_version==='cn-archive-1'&&payload.archive_only===true&&Array.isArray(payload.assets)&&typeof payload.generated_at==='string'&&(!id.version||payload.generated_at===id.version);
  if(id.kind==='archive-chart')return payload.schema_version==='cn-archive-1'&&payload.archive_only===true&&payload.code===id.code&&payload.generated_at===id.version&&Array.isArray(payload.rows)&&JSON.stringify(payload.columns)===JSON.stringify(['date','open','high','low','close','volume']);
  if(id.kind==='signal-index')return payload.schema_version==='recent-signals-1'&&payload.historical_only===true&&payload.window_bars===30&&Array.isArray(payload.signals)&&typeof payload.snapshot_at==='string'&&(!id.version||payload.snapshot_at===id.version);
  if(id.kind.startsWith('analytics-')){
    if(payload.schema_version!=='mobile-analytics-1'||payload.historical_only!==true||typeof payload.snapshot_at!=='string'||id.version&&payload.snapshot_at!==id.version)return false;
    if(id.kind==='analytics-catalog')return Array.isArray(payload.markets)&&Array.isArray(payload.core_chart_codes);
    if(payload.market!==id.market)return false;
    return id.kind==='analytics-sectors'?Array.isArray(payload.sectors):Array.isArray(payload.index_series)&&Array.isArray(payload.breadth_series)&&Array.isArray(payload.pcr_series);
  }
  if(expected&&payload.data_asof!==expected.data_asof)return false;
  if(id.kind==='research-catalog')return Array.isArray(payload.profiles)&&Array.isArray(payload.phases)&&typeof payload.generated_at==='string';
  if(id.kind==='chart')return payload.code===id.code&&payload.period==='day'&&payload.snapshot_at===id.version&&Array.isArray(payload.bars);
  return payload.code===id.code&&payload.phase===id.phase&&payload.profile?.id===id.profile&&['ok','excluded'].includes(payload.status);
}
async function checkResearchVersion(id){
  // A static host ignores query strings. Check its current directory before
  // labelling an uncached research body as an older requested version.
  const directory=id.kind==='result'?'data/research/catalog.json':'data/catalog.json';
  const {response,payload}=await timedFetch(new Request(new URL(directory,SCOPE)),VERSION_TIMEOUT);
  if(!response.ok)throw new Error('directory unavailable');
  const current=id.kind==='result'?payload.generated_at:payload.snapshot_at;
  const data_asof=id.kind==='result'?payload.data_asof:payload.research_snapshot_at;
  if(current!==id.version||typeof data_asof!=='string')throw new Error('snapshot changed');
  return {version:current,data_asof};
}
async function announceUpdate(request,stored,payload){
  try{
    const previous=await stored.clone().json(),oldVersion=previous.snapshot_at||previous.generated_at,newVersion=payload.snapshot_at||payload.generated_at;
    if(!oldVersion||!newVersion||oldVersion===newVersion||!self.clients.matchAll)return;
    for(const client of await self.clients.matchAll({type:'window',includeUncontrolled:true})){
      const url=new URL(client.url);if(url.origin===SCOPE.origin&&url.pathname.startsWith(SCOPE.pathname))client.postMessage({type:'PULSE_SNAPSHOT_UPDATED',url:request.url,previous_version:oldVersion,version:newVersion});
    }
  }catch(_){}
}
async function refreshData(request,id,stored,cacheMode='no-store'){
  try{
    const research=id.version&&(id.kind==='result'||id.kind==='research-catalog');
    const before=research?await checkResearchVersion(id):null;
    const deadline=id.kind.includes('catalog')?CATALOG_TIMEOUT:DATA_TIMEOUT;
    const {response,payload}=await timedFetch(request,deadline,cacheMode);
    if(!response.ok)return stored?previousBuildFallback(request,id,stored):response;
    if(!validPayload(payload,id,before))return stored?previousBuildFallback(request,id,stored):unavailable('发布版本已变化，请刷新目录；不会混用不同快照。');
    if(research){
      // Bracket the body with directory checks to catch a deployment between
      // either request; data_asof also binds the body to its frozen data range.
      const after=await checkResearchVersion(id);
      if(after.version!==before.version||after.data_asof!==before.data_asof)return stored?previousBuildFallback(request,id,stored):unavailable('发布版本已变化，请刷新目录。');
    }
    const saved=await saveData(request,response); // quota failures must not discard a valid network response
    if(saved&&stored&&!id.version)await announceUpdate(request,stored,payload);
    return response;
  }catch(_){return stored?previousBuildFallback(request,id,stored):unavailable();}
}
async function refreshOnce(request,id,stored,cacheMode){
  // A strict retry must not inherit an ordinary background refresh's stale
  // fallback. Repeated strict retries still share one source request.
  const key=(cacheMode==='reload'?'reload:':'normal:')+request.url;
  if(!pendingData.has(key))pendingData.set(key,refreshData(request,id,stored,cacheMode).finally(()=>pendingData.delete(key)));
  return (await pendingData.get(key)).clone();
}
async function dataResponse(request,id,background,cacheMode='no-store'){
  // An explicit retry may follow a stricter page-level validation failure.
  // Re-read this exact version, without returning the rejected cached body on
  // failure or deleting other saved snapshots.
  if(request.cache==='reload')return refreshOnce(request,id,null,'reload');
  let stored=null;try{stored=await cachedData(request);}catch(_){}
  if(stored){
    if(!id.version){
      // One network verification per unversioned directory on shell upgrade.
      // Keep the inherited entry untouched if the network is unavailable.
      if(stored.headers.get(BUILD_HEADER)!==BUILD)return refreshOnce(request,id,stored.clone(),'no-store');
      const task=refreshOnce(request,id,stored.clone(),cacheMode);
      if(background)background.push(task);else void task.catch(()=>{});
    }
    return stored;
  }
  return refreshOnce(request,id,null,cacheMode);
}
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(SHELL);
  await cache.addAll(SHELL_FILES.map(p=>new Request(new URL(p,SCOPE),{cache:'reload'})));
  await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  const cache=await caches.open(DATA),names=await caches.keys();
  for(const name of names.slice().reverse()){
    if(!name.startsWith(PREFIX+'data:')||name===DATA)continue;
    const old=await caches.open(name);let complete=true;
    for(const request of await old.keys()){
      const id=dataIdentity(request);if(!id){await old.delete(request);continue;}
      try{
        if(!await cache.match(request)){const response=await old.match(request);if(response?.ok)await cache.put(request,response);}
        await old.delete(request);
      }catch(_){complete=false;}
    }
    if(complete)await caches.delete(name);
  }
  try{await limitEntries(cache,90);}catch(_){}
  for(const name of await caches.keys())if(name.startsWith(PREFIX)&&name.startsWith(PREFIX+'shell:')&&name!==SHELL)await caches.delete(name);
  await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==SCOPE.origin||!url.pathname.startsWith(SCOPE.pathname))return;
  const id=dataIdentity(request);
  if(id){
    const background=[],response=dataResponse(request,id,background);
    // Register lifetime work synchronously; the response itself need not wait.
    event.respondWith(response);event.waitUntil(response.then(()=>Promise.allSettled(background)));return;
  }
  if(!SHELL_PATHS.has(url.pathname))return;
  event.respondWith((async()=>{
    // HTML, JS and CSS all come from one fully installed build.
    const cache=await caches.open(SHELL),key=new URL(url.pathname,SCOPE.origin).href;
    const stored=await cache.match(key);if(stored)return stored;
    return new Response('页面资源尚未完整保存，请联网重新打开页面。',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});
  })());
});
self.addEventListener('message',event=>{
  if(event.data?.type==='PULSE_VERSION'){
    const reply={type:'PULSE_VERSION',build:BUILD};
    try{const url=new URL(event.source?.url);if(url.origin===SCOPE.origin&&url.pathname.startsWith(SCOPE.pathname)){if(event.ports?.[0])event.ports[0].postMessage(reply);else event.source.postMessage(reply);}}catch(_){}
    return;
  }
  if(event.data?.type!=='PULSE_CACHE_VISITED')return;
  event.waitUntil((async()=>{
    const result={type:'PULSE_CACHE_VISITED_RESULT',cached:[],rejected:[],failed:[]};
    let clientOK=false;try{const client=new URL(event.source?.url);clientOK=client.origin===SCOPE.origin&&client.pathname.startsWith(SCOPE.pathname);}catch(_){}
    const urls=Array.isArray(event.data.urls)?event.data.urls.slice(0,12):[];
    // Small bounded batch: all started together, each has its own deadline.
    await Promise.all(urls.map(async value=>{
      const id=typeof value==='string'&&clientOK?dataIdentity(value):null;
      if(!id){result.rejected.push(typeof value==='string'?value:'invalid URL');return;}
      try{
        const request=new Request(id.url.href);
        // Controlled page reads are already stored. Avoid revalidating their
        // unversioned directory a second time solely to acknowledge caching.
        const stored=await cachedData(request);
        if(stored&&(id.version||stored.headers.get(BUILD_HEADER)===BUILD)){result.cached.push(id.url.href);return;}
        // The uncontrolled first visit may already have a validated HTTP-cache
        // response. Reuse it where possible; payload/version checks still run.
        const response=await dataResponse(request,id,[],id.version?'force-cache':'no-store');
        const saved=await cachedData(request);
        if(response.ok&&saved&&(id.version||saved.headers.get(BUILD_HEADER)===BUILD))result.cached.push(id.url.href);else result.failed.push(id.url.href);
      }catch(_){result.failed.push(id.url.href);}
    }));
    event.ports?.[0]?.postMessage(result);
  })());
});
