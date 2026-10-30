'use strict';
(function(){
  const BUILD='46f5d76eb578bec9';
  const PAGES={chart:'行情',signals:'近期 S 点',sectors:'板块与公司',temperature:'市场温度',research:'策略研究',help:'使用说明'};
  function route(value){const key=String(value||'').replace(/^#/,'');return Object.hasOwn(PAGES,key)?key:'chart';}
  function buildState(current,remote){if(!/^[a-f0-9]{16}$/.test(remote||''))return 'unknown';return current===remote?'current':'available';}
  function snapshotResource(raw,href){
    try{const base=new URL('./',href),url=new URL(raw,base);if(url.origin!==base.origin||!url.pathname.startsWith(base.pathname))return null;const path=url.pathname.slice(base.pathname.length),resources={'data/catalog.json':{key:'core',label:'行情 / S 点'},'data/signals/recent.json':{key:'core',label:'行情 / S 点'},'data/analytics/catalog.json':{key:'analytics',label:'板块 / 市场温度'},'data/research/catalog.json':{key:'research',label:'冻结研究'},'data/archive/catalog.json':{key:'archive',label:'A 股历史档案'}};return Object.hasOwn(resources,path)?resources[path]:null;}catch(_){return null;}
  }
  function snapshotTime(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(value)&&/(Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value))?Date.parse(value):null;}
  function compareSnapshots(left,right){
    const a=snapshotTime(left),b=snapshotTime(right);if(a===null||b===null)return null;
    if(a!==b)return a>b?1:-1;
    // Export versions include microseconds; Date.parse alone truncates them.
    const tail=v=>(v.match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/)?.[1]||'').slice(3);
    const x=tail(left),y=tail(right),width=Math.max(x.length,y.length),px=x.padEnd(width,'0'),py=y.padEnd(width,'0');
    return px===py?0:px>py?1:-1;
  }
  if(typeof module!=='undefined'&&module.exports)module.exports={route,buildState,snapshotResource};
  if(typeof document==='undefined')return;
  const $=id=>document.getElementById(id),main=document.querySelector('main');
  if(!main)return;
  const chart=document.createElement('section');chart.id='mobileChartPage';chart.className='mobile-page';
  const chartNodes=['.snapshot-notice','#browseStatus','#assetPicker','.chart-card','#archivePolicy','#signalsPanel'].map(s=>document.querySelector(s)).filter(Boolean);
  main.insertBefore(chart,chartNodes[0]||main.firstChild);chartNodes.forEach(node=>chart.append(node));
  const signals=document.createElement('section');signals.id='mobileSignalsPage';signals.className='mobile-page mobile-signal-page';signals.hidden=true;main.append(signals);
  window.PulseRecentSignals?.mount(signals);
  const mapping={chart:chart,signals:signals,sectors:$('mobileSectorsPage'),temperature:$('mobileEnvironmentPage'),research:$('research'),help:$('mobileHelpPage')};
  for(const [key,node] of Object.entries(mapping))if(node){node.dataset.mobileSurface=key;node.classList.add('mobile-page');}
  const footer=document.querySelector('footer');if(footer){footer.hidden=true;main.append(footer);}
  const marketTabs=$('marketTabs');if(marketTabs)main.insertBefore(marketTabs,chart);
  const nav=document.createElement('nav');nav.id='mobileNavigation';nav.className='mobile-navigation';nav.setAttribute('aria-label','手机主要页面');
  const labels={chart:['⌁','行情'],signals:['S','S 买卖点'],sectors:['▦','板块'],temperature:['∿','温度'],research:['↗','回测'],help:['?','说明']};
  nav.innerHTML=Object.entries(labels).map(([key,[icon,label]])=>`<button type="button" data-mobile-page="${key}" aria-label="${PAGES[key]}"><span aria-hidden="true">${icon}</span><small>${label}</small></button>`).join('');document.body.append(nav);
  const update=document.createElement('div');update.id='mobileUpdateBar';update.className='mobile-update-bar';update.innerHTML='<span id="mobileVersionStatus">手机版 · 独立页面导航</span><button type="button" id="checkMobileUpdate">检查更新</button><button type="button" id="applyMobileUpdate" hidden>更新并重新打开</button><button type="button" id="refreshMobileSnapshot" hidden>载入新数据</button>';
  document.querySelector('.top').after(update);
  let selected='chart';const scrolls=new Map();
  function market(){return document.querySelector('#marketTabs [aria-pressed="true"]')?.dataset.market||'CN';}
  function show(value,{write=false,restore=false}={}){
    const next=route(value);scrolls.set(selected,window.scrollY);selected=next;
    if(next==='research'&&!$('archiveChartNotice')?.classList.contains('hidden'))$('archiveReturn')?.click();
    for(const [key,node] of Object.entries(mapping))if(node)node.hidden=key!==next;
    if(marketTabs)marketTabs.hidden=['signals','help'].includes(next);
    if(footer)footer.hidden=next!=='help';
    nav.querySelectorAll('[data-mobile-page]').forEach(b=>{const active=b.dataset.mobilePage===next;b.classList.toggle('active',active);b.setAttribute('aria-current',active?'page':'false');});
    if(next==='signals')window.PulseRecentSignals?.activate(market());
    window.dispatchEvent(new CustomEvent('pulse:page',{detail:{page:next,market:market()}}));
    if(write&&location.hash!=='#'+next)history.pushState(null,'','#'+next);
    document.title=PAGES[next]+' · 脉冲';
    if(write||restore)window.scrollTo({top:restore?(scrolls.get(next)||0):0,behavior:'instant'});
  }
  nav.addEventListener('click',e=>{const page=e.target.closest('[data-mobile-page]')?.dataset.mobilePage;if(page)show(page,{write:true});});
  window.addEventListener('pulse:navigate',e=>show(e.detail?.page,{write:true}));
  window.addEventListener('hashchange',()=>show(location.hash,{restore:true}));
  window.addEventListener('popstate',()=>show(location.hash,{restore:true}));
  window.addEventListener('pulse:market',()=>{if(selected==='research'&&!$('archiveChartNotice')?.classList.contains('hidden')){show('research');return;}if(selected==='signals')window.PulseRecentSignals?.activate(market());window.dispatchEvent(new CustomEvent('pulse:page',{detail:{page:selected,market:market()}}));});
  window.PulseMobileShell={navigate:page=>show(page,{write:true}),getPage:()=>selected};
  show(location.hash);

  let latest=null,checking=false,baseStatus='手机版 · 独立页面导航',coreNoticeRequest=0;
  const dataNotices=new Map();
  function renderStatus(){
    const notices=[...dataNotices.values()].filter(n=>n.checked),updates=notices.filter(n=>!n.fallback),fallbacks=notices.filter(n=>n.fallback);
    const message=[updates.length?updates.map(n=>n.label).join('、')+'有新快照，可重新载入查看':'',fallbacks.length?fallbacks.map(n=>n.label).join('、')+'未能在线确认，沿用已存快照':''].filter(Boolean).join('；');
    $('mobileVersionStatus').textContent=baseStatus+(message?' · '+message:'');
    $('refreshMobileSnapshot').hidden=!notices.length;$('refreshMobileSnapshot').textContent=updates.length?'载入新数据':'重试更新';
  }
  const status=text=>{baseStatus=text;renderStatus();};
  async function reconcileCoreNotice(){
    const notice=dataNotices.get('core');if(!notice)return;const own=++coreNoticeRequest;
    const pending=Promise.resolve().then(()=>{if(!window.PulseCoreCatalog?.get)throw new Error('catalog unavailable');return window.PulseCoreCatalog.get();});
    const apply=catalog=>{
      if(own!==coreNoticeRequest||dataNotices.get('core')!==notice)return;
      const loaded=snapshotTime(catalog?.snapshot_at);
      if(catalog?.snapshot_at===notice.version||loaded!==null&&compareSnapshots(catalog.snapshot_at,notice.version)>0)dataNotices.delete('core');else notice.checked=true;
      renderStatus();
    };
    try{apply(await bounded(pending,4000));}
    catch(_){if(own!==coreNoticeRequest||dataNotices.get('core')!==notice)return;notice.checked=true;renderStatus();void pending.then(apply,()=>{});}
  }
  function reconcileAnalyticsNotice(){
    const notice=dataNotices.get('analytics');if(!notice)return;
    // The getter acknowledges a validated, rendered leaf, not merely a new
    // catalog in the worker cache. Null means loading, failed, or not opened.
    let version;try{version=window.PulseMarketPages?.getSnapshot?.();}catch(_){}
    const loaded=snapshotTime(version);
    if(loaded!==null&&(version===notice.version||compareSnapshots(version,notice.version)>0))dataNotices.delete('analytics');
    renderStatus();
  }
  function snapshotMessage(message){
    if(!['PULSE_SNAPSHOT_UPDATED','PULSE_PREVIOUS_BUILD_FALLBACK'].includes(message?.type))return;
    const resource=snapshotResource(message.url,location.href);if(!resource)return;
    if(message.type==='PULSE_PREVIOUS_BUILD_FALLBACK'){dataNotices.set('fallback:'+resource.key,{...resource,checked:true,fallback:true});renderStatus();return;}
    const version=snapshotTime(message.version);if(version===null)return;
    const previous=dataNotices.get(resource.key);if(previous&&compareSnapshots(previous.version,message.version)>0)return;
    dataNotices.delete('fallback:'+resource.key);
    dataNotices.set(resource.key,{...resource,version:message.version,checked:resource.key!=='core'});
    if(resource.key==='core')void reconcileCoreNotice();else if(resource.key==='analytics')reconcileAnalyticsNotice();else renderStatus();
  }
  async function check(){
    if(checking)return;checking=true;$('checkMobileUpdate').disabled=true;
    if(BUILD.startsWith('__')){status('本地预览 · 发布后可检查手机更新');checking=false;$('checkMobileUpdate').disabled=false;return;}
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
    try{
      status('正在检查手机版更新…');
      const response=await fetch('./build-info.json?check='+Date.now(),{cache:'no-store',signal:controller.signal});
      if(!response.ok)throw new Error('unavailable');
      const info=await response.json(),state=buildState(BUILD,info.build_id);
      if(state==='unknown')throw new Error('invalid build');latest=info.build_id;
      $('applyMobileUpdate').hidden=state!=='available';
      status(state==='available'?'发现新版 · 点右侧更新，已存图表会保留':'手机版已是最新 · 行情仍按发布快照更新');
    }catch(_){status(navigator.onLine?'暂时无法检查更新，当前页面可继续使用':'当前离线 · 恢复联网后可检查更新');}
    finally{clearTimeout(timer);checking=false;$('checkMobileUpdate').disabled=false;}
  }
  function workerVersion(worker){return new Promise(resolve=>{if(!worker){resolve(null);return;}const channel=new MessageChannel();let done=false;const finish=v=>{if(done)return;done=true;clearTimeout(timer);channel.port1.close();resolve(v);};const timer=setTimeout(()=>finish(null),4000);channel.port1.onmessage=e=>{if(e.data?.type==='PULSE_VERSION')finish(e.data.build);};try{worker.postMessage({type:'PULSE_VERSION'},[channel.port2]);}catch(_){finish(null);}});}
  function bounded(promise,ms){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('update timeout')),ms);})]).finally(()=>clearTimeout(timer));}
  async function applyUpdate(){
    $('applyMobileUpdate').disabled=true;status('正在安装新版页面，保留已缓存图表…');
    try{
      if(!navigator.serviceWorker){location.reload();return;}
      const registration=await bounded(navigator.serviceWorker.getRegistration('./'),8000);
      if(!registration){location.reload();return;}
      let version=await workerVersion(navigator.serviceWorker.controller);
      if(version!==latest){
        const changed=new Promise(resolve=>{const handler=()=>{clearTimeout(timer);resolve(true);};const timer=setTimeout(()=>{navigator.serviceWorker.removeEventListener('controllerchange',handler);resolve(false);},15000);navigator.serviceWorker.addEventListener('controllerchange',handler,{once:true});});
        await bounded(registration.update(),15000);
        version=await workerVersion(navigator.serviceWorker.controller);
        if(version!==latest){await changed;version=await workerVersion(navigator.serviceWorker.controller);}
      }
      if(version===latest){location.reload();return;}
      status('新版尚未安装完成，请稍后再点更新；已有缓存保留。');
    }catch(_){status('更新暂未完成，联网后可重试；已有缓存保留。');}
    finally{$('applyMobileUpdate').disabled=false;}
  }
  $('checkMobileUpdate').addEventListener('click',check);$('applyMobileUpdate').addEventListener('click',applyUpdate);
  $('refreshMobileSnapshot').addEventListener('click',()=>location.reload());
  navigator.serviceWorker?.addEventListener('message',event=>snapshotMessage(event.data));
  window.addEventListener('pulse:market',()=>{void reconcileCoreNotice();});
  window.addEventListener('pulse:analytics-snapshot',reconcileAnalyticsNotice);
  void check();
}());
