'use strict';
(function () {
  const finite = n => typeof n === 'number' && Number.isFinite(n);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = n => finite(n) ? n.toLocaleString('zh-CN', {maximumFractionDigits:4}) : '—';
  const FILTER_KEY='pulse:mobile-recent-signals:filters:v1';
  function normalizeFilters(value){const v=value&&typeof value==='object'?value:{};return {scope:['recent','today','archive'].includes(v.scope)?v.scope:'recent',market:['all','CN','US'].includes(v.market)?v.market:'all',side:['all','buy','sell'].includes(v.side)?v.side:'all',days:[5,10,30].includes(Number(v.days))?Number(v.days):10};}
  function readFilters(storage){try{return normalizeFilters(JSON.parse(storage?.getItem(FILTER_KEY)||'null'));}catch(_){return normalizeFilters(null);}}
  function saveFilters(storage,value){try{storage?.setItem(FILTER_KEY,JSON.stringify(normalizeFilters(value)));return !!storage;}catch(_){return false;}}
  const zones={CN:'Asia/Shanghai',US:'America/New_York'};
  const validDate=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
  function snapshotTime(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(value)&&/(Z|[+-]\d{2}:\d{2})$/.test(value)&&validDate(value.slice(0,10))&&Number.isFinite(Date.parse(value))?Date.parse(value)/1000:null;}
  function marketDate(time,market){if(!finite(time)||time<=0||!zones[market])return null;const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zones[market],year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(time*1000));return ['year','month','day'].map(k=>parts.find(p=>p.type===k)?.value).join('-');}
  function validSignal(s, maxAge = 30) {
    return s && ['CN','US'].includes(s.market) && ['buy','sell'].includes(s.side) && s.grade === 'S'
      && Number.isInteger(s.bar_age) && s.bar_age >= 0 && s.bar_age < maxAge
      && finite(s.time) && s.time>0 && finite(s.confirmed_at) && s.confirmed_at >= s.time
      && finite(s.price) && s.price > 0 && /^[A-Za-z0-9.-]+$/.test(s.code || '')
      && validDate(s.signal_date);
  }
  function validateFeed(result,catalog){
    const fail=message=>{throw new Error(message||'信号汇总未通过校验，已停止展示；可重试当前快照。');};
    const asof=snapshotTime(catalog?.snapshot_at);
    if(!asof||catalog?.schema_version!=='public-snapshot-1'||!Array.isArray(catalog.assets))fail('主图行情目录尚未通过校验，请重试或重新载入页面。');
    if(!snapshotTime(result?.snapshot_at))fail('信号汇总缺少有效快照时刻，已停止展示；可重试。');
    if(result.snapshot_at!==catalog.snapshot_at)fail('信号汇总与主图快照版本不一致，已停止展示；可重试当前快照，或重新载入页面读取新版。');
    if(result.schema_version!=='recent-signals-1'||result.historical_only!==true||result.window_bars!==30||result.grade!=='S'||result.scope!=='public-core-CN-US'||!Array.isArray(result.signals))fail();
    const assets=new Map(catalog.assets.filter(a=>['CN','US'].includes(a.market)).map(a=>[a.code,a])),seen=new Set();
    for(const s of result.signals){
      const a=assets.get(s?.code),p=s?.plan;
      if(!validSignal(s)||s.historical_only!==true||!a||s.market!==a.market||s.currency!==a.currency||s.name!==a.name||s.id!==`${s.code}:${Math.trunc(s.time)}:${s.side}`||seen.has(s.id))fail();
      seen.add(s.id);
      if(!Number.isInteger(a.bars_count)||a.bars_count<1||!finite(a.start)||!finite(a.end)||s.time<a.start||s.time>a.end||a.end>asof||s.confirmed_at>asof||marketDate(s.time,s.market)!==s.signal_date||!validDate(s.source_asof)||s.source_asof!==marketDate(a.end,s.market)||s.source_asof!==a.data_asof||s.signal_date>s.source_asof||s.bar_age>=Math.min(30,a.bars_count)||(s.bar_age===0)!==(s.time===a.end)||s.bar_age>(Date.parse(s.source_asof)-Date.parse(s.signal_date))/86400000)fail();
      if(s.side==='buy'||p&&Object.keys(p).length){
        if(!p||!finite(p.reference_price)||p.reference_price!==s.price||!finite(p.stop_pct)||p.stop_pct<=0||p.stop_pct>=100||!finite(p.take_pct)||p.take_pct<=0||!Number.isInteger(p.hold)||p.hold<1||p.hold>100||!finite(p.atr)||p.atr<0||p.confirmed_at!==s.confirmed_at)fail('历史保护计划未通过校验，已停止展示；可重试。');
      }
    }
    const integer=n=>Number.isInteger(n)&&n>=0;
    for(const market of ['CN','US']){
      const c=result.coverage?.[market],members=[...assets.values()].filter(a=>a.market===market),rows=result.signals.filter(s=>s.market===market);
      if(!c||!['asset_count','scanned_count','signal_count','buy_count','sell_count'].every(k=>integer(c[k]))||c.asset_count!==members.length||c.scanned_count>c.asset_count||c.signal_count!==rows.length||c.buy_count!==rows.filter(s=>s.side==='buy').length||c.sell_count!==rows.filter(s=>s.side==='sell').length||!Array.isArray(c.unavailable)||c.unavailable.length!==c.asset_count-c.scanned_count)fail('信号覆盖数量不一致，已停止展示；可重试。');
      const missing=new Set();
      for(const item of c.unavailable){if(!item||assets.get(item.code)?.market!==market||missing.has(item.code)||typeof item.reason!=='string'||!item.reason.trim())fail();missing.add(item.code);}
      if(rows.some(s=>missing.has(s.code)))fail();
      const dates=members.filter(a=>!missing.has(a.code)).map(a=>a.data_asof).sort();
      if(dates.length){if(!dates.every(validDate)||c.source_asof_min!==dates[0]||c.source_asof_max!==dates.at(-1)||!validDate(c.date_range?.start)||c.date_range.start>c.source_asof_min||c.date_range.end!==c.source_asof_max||c.source_asof_max>marketDate(asof,market))fail('信号统计日期不一致，已停止展示；可重试。');}
      else if(c.source_asof_min!==null||c.source_asof_max!==null||c.date_range?.start!==null||c.date_range?.end!==null||rows.length)fail();
    }
    return result;
  }
  function bounded(promise,ms,message){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),ms);})]).finally(()=>clearTimeout(timer));}
  function dateWindow(market,days,now=Date.now()/1000){const end=marketDate(now,market);return {start:new Date(Date.parse(end+'T00:00:00Z')-(days-1)*86400000).toISOString().slice(0,10),end};}
  function selectSignals(data, {market='all', side='all', days=10,scope='recent'} = {},now=Date.now()/1000) {
    const size = [5,10,30].includes(Number(days)) ? Number(days) : 10;
    return (Array.isArray(data?.signals) ? data.signals : [])
      .filter(s => {if(!validSignal(s)||(market!=='all'&&s.market!==market)||(side!=='all'&&s.side!==side))return false;if(scope==='archive')return s.bar_age<size;const day=marketDate(s.confirmed_at,s.market),w=dateWindow(s.market,size,now);return s.confirmed_at<=now&&(scope==='today'?day===w.end:day>=w.start&&day<=w.end);})
      .sort((a,b) => b.confirmed_at-a.confirmed_at || a.code.localeCompare(b.code));
  }
  function signalLink(signal) {
    if (!validSignal(signal)) return null;
    return './?' + new URLSearchParams({symbol:signal.code,date:signal.signal_date,grade:'S',side:signal.side}).toString();
  }
  function referencePlan(s) {
    const p=s.plan, ref=p?.reference_price ?? s.price;
    if (s.side!=='buy' || !p || !finite(ref) || ref<=0 || !finite(p.stop_pct) || p.stop_pct<=0 || p.stop_pct>=100 || !finite(p.take_pct) || p.take_pct<=0) return '';
    return `当时参考止损 ${fmt(ref*(1-p.stop_pct/100))} · 止盈 ${fmt(ref*(1+p.take_pct/100))} ${esc(s.currency)}`;
  }
  function rowHTML(s,now=Date.now()/1000) {
    return `<a class="radar-row ${s.side}" href="${esc(signalLink(s))}"><div><strong>${esc(s.name)} <span>${esc(s.code)}</span></strong><b>${s.side==='buy'?'S · 历史买点':'S · 历史卖点'}</b></div><p>${marketDate(s.confirmed_at,s.market)===marketDate(now,s.market)&&s.confirmed_at<=now?'今日确认':'历史确认'} ${esc(marketDate(s.confirmed_at,s.market))} · 信号 K 线 ${esc(s.signal_date)} · ${s.bar_age===0?'末根已完成日线':`距末根 ${s.bar_age} 根`} · 参考 ${fmt(s.price)} ${esc(s.currency)}</p><small>${s.side==='sell'?'退出紧迫度评级；只适用于当时已有持仓。':referencePlan(s)||'查看当时完整依据与保护计划。'}</small><small>本股行情截至 ${esc(s.source_asof)} · 查看 K 线与详情 →</small></a>`;
  }
  const api={FILTER_KEY,normalizeFilters,readFilters,saveFilters,validSignal,selectSignals,signalLink,referencePlan,rowHTML,validateFeed,marketDate,dateWindow,snapshotTime,bounded};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(typeof document==='undefined')return;
  const $=id=>document.getElementById(id);
  const side=document.querySelector('.instrument-side');
  if(!side)return;
  const button=document.createElement('button');
  button.type='button';button.className='text-button radar-open';button.textContent='近期 S 点';button.title='近期买卖点与筛选设置';button.id='recentSignalsOpen';
  side.append(button);
  const dialog=document.createElement('dialog');
  dialog.id='recentSignalsDialog';dialog.className='radar-dialog';dialog.setAttribute('aria-labelledby','recentSignalsTitle');
  dialog.innerHTML=`<div class="dialog-head"><div><span class="eyebrow">A 股 · 美股 / 历史信号</span><h2 id="recentSignalsTitle">近期 S 买卖点</h2></div><button type="button" class="close-button" id="recentSignalsClose" aria-label="关闭近期 S 点">×</button></div><p class="note">买点与卖点一起查。S 买点评估规则条件，S 卖点评估退出紧迫度，均不代表盈利概率。</p><div class="radar-update-tools"><button type="button" id="radarRefresh">检查新快照</button><span id="radarUpdateStatus" role="status"></span></div><section class="radar-settings" aria-labelledby="radarSettingsTitle"><div class="radar-settings-head"><h3 id="radarSettingsTitle">筛选设置</h3><button type="button" id="radarReset" class="text-button">恢复默认</button></div><div class="radar-controls"><label>查看模式<select id="radarScope"><option value="recent">当前日期窗口</option><option value="today">今日确认</option><option value="archive">历史档案</option></select></label><label>市场<select id="radarMarket" aria-label="S点市场"><option value="all">A 股 + 美股</option><option value="CN">A 股 / ETF</option><option value="US">美股 / ETF</option></select></label><label>方向<select id="radarSide" aria-label="S点方向"><option value="all">买点 + 卖点</option><option value="buy">只看买点</option><option value="sell">只看卖点</option></select></label><label>范围<select id="radarDays" aria-label="S点近期范围"><option value="5">5 天</option><option value="10" selected>10 天</option><option value="30">30 天</option></select></label></div><p class="note" id="radarSavedFilters">筛选会保存在此浏览器。</p><p class="radar-snapshot-scope">周期：日线 · 有效性：历史快照，未核验当前是否仍成立。分钟级与当前有效性检查请使用运行中的电脑端。</p></section><p class="note" id="radarCoverage"></p><div id="radarStatus" role="status"></div><div id="radarList"></div><p class="note">当前窗口按各市场当地今天倒推自然日（含今天），以信号确认日期筛选；未使用未经核验的交易日历。历史档案按各标的末 N 根日 K 回看。只查公开核心 A 股 / 美股目录，旧快照和新下载时间都不会把历史信号变成今日信号。</p>`;
  document.body.append(dialog);
  let storage=null,savedRaw=null;try{storage=window.localStorage;savedRaw=storage?.getItem(FILTER_KEY)||null;}catch(_){}
  const savedFilters=readFilters(storage);let preserveMarket=!!savedRaw;
  $('radarScope').value=savedFilters.scope;$('radarMarket').value=savedFilters.market;$('radarSide').value=savedFilters.side;$('radarDays').value=String(savedFilters.days);
  let data=null,pending=null,pageContainer=null,catalogUsed=null,checking=false,lastVersionCheck=0;
  function render() {
    if(!data)return;
    const market=$('radarMarket').value,selection={market,scope:$('radarScope').value,side:$('radarSide').value,days:Number($('radarDays').value)},rows=selectSignals(data,selection);
    const markets=market==='all'?['CN','US']:[market];
    const coverage=markets.map(m=>{const c=data.coverage?.[m];const w=dateWindow(m,selection.days),current=(catalogUsed?.assets||[]).filter(a=>a.market===m&&a.data_asof>=w.start&&a.data_asof<=w.end).length;return `${m==='CN'?'A 股':'美股'} 公开缓存 ${c?.asset_count??0} / 可重算 ${c?.scanned_count??0} / 窗口内有行情 ${current} 个 · 行情 ${c?.source_asof_min||'—'} 至 ${c?.source_asof_max||'—'} · ${selection.scope==='archive'?'档案：缓存末 '+selection.days+' 根日 K':(selection.scope==='today'?'今日 '+w.end:'近 '+selection.days+' 个自然日 '+w.start+' 至 '+w.end)}`;}).join('；');
    $('radarCoverage').textContent=coverage+`。信号快照 ${String(data.snapshot_at||'')}；质量：发布时校验，当前交易数据未核验。这是公开快照覆盖，不是后台实时监控数量。`;
    $('radarStatus').textContent=`${rows.length} 个历史 S 点 · ${rows.filter(s=>s.side==='buy').length} 买点 / ${rows.filter(s=>s.side==='sell').length} 卖点 · 今日确认 ${selectSignals(data,{...selection,scope:'today'}).length} 个`;
    $('radarList').innerHTML=rows.length?rows.map(s=>rowHTML(s)).join(''):'<p class="empty">当前日期内没有符合条件的 S 点；可切换历史档案查看旧记录。不会用旧缓存或较低等级补作今日信号。</p>';
  }
  async function load(retry=false) {
    if(data&&!retry){render();return;}
    if(pending)return pending;
    $('radarStatus').textContent='正在读取轻量信号汇总…'+(data?'保留上次结果 '+data.snapshot_at:'');
    const task=(async()=>{
      try {
        const catalog=await bounded(Promise.resolve().then(()=>{const api=window.PulseCoreCatalog;if(!api)throw new Error('主图目录接口尚不可用，请重新载入页面。');return retry?api.retry():api.get();}),20000,'主图行情目录读取超时，可重试；不会改用其他版本的信号。');
        const version=catalog?.snapshot_at;
        if(!snapshotTime(version))throw new Error('主图行情目录尚未就绪，请重试或重新载入页面。');
        if(data&&data.snapshot_at!==version){data=null;catalogUsed=null;$('radarList').innerHTML='';$('radarCoverage').textContent='';}
        const url='data/signals/recent.json?v='+encodeURIComponent(version),controller=new AbortController();
        let body;
        try{body=await bounded((async()=>{const response=await fetch(url,{cache:retry?'reload':'no-cache',signal:controller.signal});if(!response.ok)throw new Error('近期信号汇总暂不可用；联网后可重试。');return response.json();})(),20000,'信号汇总读取超时，可重试当前快照。');}finally{controller.abort();}
        const result=validateFeed(body,catalog);
        catalogUsed=catalog;data=result;lastVersionCheck=Date.now();window.PulseOffline?.remember(url);render();
      } catch(error) {
        if(data){render();$('radarStatus').innerHTML+=`<div class="result-error">更新失败：${esc(error.message)}；保留上次结果 ${esc(data.snapshot_at)} <button type="button" id="radarRetry">重试</button></div>`;}
        else{$('radarCoverage').textContent='';$('radarList').innerHTML='';$('radarStatus').innerHTML=`<div class="result-error">${esc(error.message)} <button type="button" id="radarRetry">重试</button> <button type="button" id="radarReload">重新载入页面</button></div>`;}
        $('radarRetry')?.addEventListener('click',()=>load(true));$('radarReload')?.addEventListener('click',()=>window.location.reload());
      }
    })();
    pending=task;try{return await task;}finally{if(pending===task)pending=null;}
  }
  async function checkUpdates(force=false){
    if(!data){return load(true);}render();
    if(checking||pending||(!force&&Date.now()-lastVersionCheck<60000))return;
    checking=true;$('radarRefresh').disabled=true;$('radarUpdateStatus').textContent='正在检查公开快照版本…';
    const controller=new AbortController();
    try{
      const fresh=await bounded((async()=>{const response=await fetch('data/catalog.json',{cache:'no-store',signal:controller.signal});if(!response.ok)throw Error('快照版本检查失败');return response.json();})(),15000,'快照版本检查超时');
      if(fresh?.schema_version!=='public-snapshot-1'||!Array.isArray(fresh.assets)||!snapshotTime(fresh.snapshot_at))throw Error('新版目录未通过校验');
      if(snapshotTime(fresh.snapshot_at)<snapshotTime(data.snapshot_at))throw Error('服务器返回较旧目录，已保留当前版本');
      lastVersionCheck=Date.now();
      if(fresh.snapshot_at!==data.snapshot_at){$('radarUpdateStatus').innerHTML='发现新的行情快照。<button type="button" id="radarApplyUpdate">载入新版</button>';$('radarApplyUpdate').addEventListener('click',()=>window.location.reload());}
      else{$('radarUpdateStatus').textContent='已检查，当前为服务器最新快照；快照日期不等于今天。';if(force)await load(true);}
    }catch(error){$('radarUpdateStatus').textContent=error.message+'；仍显示原快照，日期窗口继续按今天计算。';}
    finally{controller.abort();checking=false;$('radarRefresh').disabled=false;}
  }
  function activate(market){
    if(market&&!preserveMarket)$('radarMarket').value=['CN','US'].includes(market)?market:'all';
    void load();
  }
  function open(){
    const current=document.querySelector('#marketTabs [aria-pressed="true"]')?.dataset.market;
    activate(current);
    if(pageContainer)window.dispatchEvent(new CustomEvent('pulse:navigate',{detail:{page:'signals'}}));
    else dialog.showModal();
  }
  window.PulseRecentSignals={activate,open,mount(container){
    if(pageContainer)return;
    if(dialog.open)dialog.close();
    container.append(...Array.from(dialog.childNodes));dialog.remove();pageContainer=container;
    $('recentSignalsClose').hidden=true;
  }};
  button.addEventListener('click',open);
  $('radarRefresh').addEventListener('click',()=>checkUpdates(true));
  const visiblePage=()=>!document.hidden&&(pageContainer?!pageContainer.hidden:!!dialog.open);
  document.addEventListener?.('visibilitychange',()=>{if(visiblePage()&&data&&!pending&&!checking)void checkUpdates();});
  if(typeof setInterval==='function')setInterval(()=>{if(visiblePage()&&!pending&&!checking)void checkUpdates();},60000);
  $('recentSignalsClose').addEventListener('click',()=>{if(pageContainer)window.dispatchEvent(new CustomEvent('pulse:navigate',{detail:{page:'chart'}}));else dialog.close();});
  function rememberFilters(){preserveMarket=true;const saved=saveFilters(storage,{scope:$('radarScope').value,market:$('radarMarket').value,side:$('radarSide').value,days:Number($('radarDays').value)});$('radarSavedFilters').textContent=saved?'已保存筛选；下次打开会继续使用。':'当前筛选已应用；浏览器存储不可用，关闭后可能无法保留。';render();}
  ['radarScope','radarMarket','radarSide','radarDays'].forEach(id=>$(id).addEventListener('change',rememberFilters));
  $('radarReset').addEventListener('click',()=>{$('radarScope').value='recent';$('radarMarket').value='all';$('radarSide').value='all';$('radarDays').value='10';rememberFilters();});
}());
