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
  const ranking = typeof module !== 'undefined' && module.exports
    ? require('./signal-ranking.js') : window.PulseSignalRanking;
  const VIEW_KEY = 'pulse:mobile-recent-signals:view:v1';
  function readView(storage) {
    let raw = {};
    try { raw = JSON.parse(storage?.getItem(VIEW_KEY) || '{}') || {}; } catch (_) {}
    return {mode:['leader','time','cap'].includes(raw.mode) ? raw.mode : 'leader', motion:raw.motion!==false};
  }
  const stateLabels = {
    active:'快照条件仍成立', unconfirmed:'待复核', expired:'已失效', missed_entry:'已偏离',
    stop_touched:'已触及参考止损', take_touched:'已触及参考止盈'
  };
  function expectedDay(market, now) {
    const day = marketDate(now,market);
    const clock = new Intl.DateTimeFormat('en-GB', {timeZone:zones[market],hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(now*1000);
    let date = new Date(day+'T00:00:00Z');
    if (clock < (market==='CN'?'15:10':'16:10')) date.setUTCDate(date.getUTCDate()-1);
    while (date.getUTCDay()===0 || date.getUTCDay()===6) date.setUTCDate(date.getUTCDate()-1);
    return date.toISOString().slice(0,10);
  }
  function asOfState(s, expected) {
    const state = Object.hasOwn(stateLabels,s.status) ? s.status : 'unconfirmed';
    if (state==='active' && (!s.data_end || s.data_end<expected[s.market])) return 'unconfirmed';
    return state;
  }
  function validatePriority(value,catalog) {
    if (value?.schema_version!=='signal-priority-1' || value.catalog_snapshot_at!==catalog.snapshot_at ||
        !value.by_code || typeof value.by_code!=='object' || Array.isArray(value.by_code)) throw Error('市值资料版本不匹配');
    const byCode = Object.create(null);
    for (const a of catalog.assets) {
      const m=value.by_code[a.code];
      if (!m || m.code!==a.code || m.market!==a.market || m.currency!==a.currency || m.kind!==a.kind) continue;
      if (m.market_cap!=null && (!finite(m.market_cap) || m.market_cap<=0 || !validDate(m.cap_asof))) continue;
      if (m.peer_rank!=null && (!Number.isInteger(m.peer_rank) || !Number.isInteger(m.peer_count) ||
          m.peer_rank<1 || m.peer_count<2 || m.peer_rank>m.peer_count || !validDate(m.peer_asof) )) continue;
      byCode[a.code]=m;
    }
    return byCode;
  }
  const marketNames={CN:'A 股',US:'美股'};
  function rowHTML(s,now=Date.now()/1000,opts={}) {
    const {index=1,meta=null,state='unconfirmed',asset=null,review=null}=opts;
    const confirmed=marketDate(s.confirmed_at,s.market),today=marketDate(now,s.market);
    const isFund=asset?.kind==='etf'||meta?.kind==='etf';
    const cap=meta&&!isFund?ranking?.formatCap(meta):'';
    const rank=cap?ranking?.leaderLabel(meta):'';
    const notch=rank?Math.round(100*(meta.peer_count-meta.peer_rank)/(meta.peer_count-1)):0;
    const sector=meta?.sector||asset?.sector_name||'';
    const code=s.code.replace(/^(sh|sz|us)/,'');
    const closeNote=review?`${review.date.slice(5).replace('-','/')} 收盘数据 · 日内触及原参考${state==='stop_touched'?'止损':'止盈'}`:'';
    const stateLabel = state==='active' && s.side==='sell'?'快照仍转弱':stateLabels[state]||stateLabels.unconfirmed;
    const capLabel=cap?'市值 '+cap:isFund?'ETF · 不参与公司市值排名':'市值暂无';
    const rawRankDate=rank&&validDate(meta.peer_asof)?meta.peer_asof.slice(5).replace('-','/'):'';
    const capDate=cap?meta.cap_asof.slice(5).replace('-','/'):'';
    const tip=cap?[meta.source, '行情日 '+meta.cap_asof,meta.peer_scope].filter(Boolean).join(' · '):'';
    return `<a class="radar-row ${s.side}" data-radar-key="${esc(s.id||s.code)}" href="${esc(signalLink(s))}">
      <span class="radar-number" aria-label="组内排序 ${index}">${String(index).padStart(2,'0')}</span>
      <div class="radar-row-content"><div class="radar-row-heading"><strong>${esc(s.name)}</strong><span class="radar-state" data-state="${esc(state)}" title="${esc(closeNote||s.status_reason||'当前条件待核验')}">${esc(stateLabel)}</span></div>
      <div class="radar-identity">${esc(marketNames[s.market])} · ${esc(code)}${sector?' · '+esc(sector):''}</div>
      <div class="radar-scales" title="${esc(tip)}"><span>${esc(capLabel)}${capDate?` <small>${capDate}</small>`:''}</span>${rank?`<span class="radar-peer" data-leader="${!!ranking?.isLeader(meta,now)}">${esc(rank)}${rawRankDate?` · ${rawRankDate}`:''}<i class="radar-peer-track" style="--peer-position:${notch}%" aria-hidden="true"><i></i></i></span>`:''}</div>
      ${review?`<div class="radar-review-close" title="${esc(review.source)}">${esc(closeNote)}</div>`:''}<div class="radar-row-foot"><span>${confirmed===today&&s.confirmed_at<=now?'今日确认':'历史确认'} ${esc(confirmed)}${s.source_asof?' · 行情至 '+esc(s.source_asof.slice(5).replace('-','/')):''}</span><span>查看详情 <i aria-hidden="true">↗</i></span></div>
      <span class="sr-only">当时参考价 ${fmt(s.price)} ${esc(s.currency)}。${s.side==='sell'?'退出紧迫度仅用于当时已有持仓。':referencePlan(s)}。本股行情截至 ${esc(s.source_asof)}。${esc(tip)}</span></div></a>`;
  }
  function groupedRows(rows,{mode,byCode,assets,now}) {
    const expected={CN:expectedDay('CN',now),US:expectedDay('US',now)};
    const states=new Map(rows.map(s=>{
      const base=asOfState(s,expected);
      const check=ranking?.referenceReview?.(s,byCode[s.code],base,now);
      return [s,{state:check?.state??base,review:check?.close??null}];
    }));
    const options={mode,byCode,stateFor:s=>states.get(s).state,getDay:s=>marketDate(s.confirmed_at,s.market),todayFor:s=>marketDate(now,s.market)};
    const sorted=(list)=>ranking?ranking.rankSignals(list,{...options,now}):list;
    function section(subset,archived){
      return ['buy','sell'].map(side=>{
        const ordered=sorted(subset.filter(s=>s.side===side));
        if (!ordered.length) return '';
        const caption=side==='buy'?'历史买点':'历史卖点';
        const sub=archived?'计划仅供复盘':side==='buy'?'查看原入场条件':'持仓退出复盘';
        const groups=mode==='cap'?['CN','US'].map(m=>[m,ordered.filter(s=>s.market===m)]).filter(pair=>pair[1].length):[[null,ordered]];
        const lists=groups.map(([m,items])=>`${m?`<div class="radar-market-head">${marketNames[m]}<span>${m==='CN'?'人民币':'美元'}</span></div>`:''}<div class="radar-items">${items.map((s,i)=>rowHTML(s,now,{index:i+1,meta:byCode[s.code],...states.get(s),asset:assets.get(s.code)})).join('')}</div>`).join('');
        return `<section class="radar-group ${side}"><div class="radar-group-head"><h3>${caption} <span>${ordered.length}</span></h3><small>${sub}</small></div>${lists}</section>`;
      }).join('');
    }
    const ended=[],watch=[];
    for(const s of rows)(['expired','stop_touched','take_touched','missed_entry'].includes(states.get(s).state)?ended:watch).push(s);
    return section(watch,false)+(ended.length?`<div class="radar-ended"><div class="radar-archive-heading">失效与偏离 <span>${ended.length} 条历史记录</span></div>${section(ended,true)}</div>`:'');
  }
  const api={FILTER_KEY,normalizeFilters,readFilters,saveFilters,validSignal,selectSignals,signalLink,referencePlan,rowHTML,validateFeed,marketDate,dateWindow,snapshotTime,bounded,readView,expectedDay,asOfState,validatePriority,groupedRows};
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
  dialog.innerHTML=`<header class="radar-heading dialog-head"><div><span class="radar-kicker"><i aria-hidden="true"></i> 收盘观察 · A 股 / 美股</span><h2 id="recentSignalsTitle">近期 S 买卖点</h2></div><button type="button" class="close-button" id="recentSignalsClose" aria-label="关闭近期 S 点">×</button></header>
<div class="radar-direction" role="group" aria-label="切换观察方向">
<button type="button" id="radarAll" data-direction="all"><span>全部</span><strong id="radarAllCount">—</strong></button>
<button type="button" id="radarBuy" data-direction="buy"><span><i></i>买点</span><strong id="radarBuyCount">—</strong></button>
<button type="button" id="radarSell" data-direction="sell"><span><i></i>卖点</span><strong id="radarSellCount">—</strong></button>
</div>
<div class="radar-toolbar"><div class="radar-mode-switch" role="group" aria-label="列表排序">
<button type="button" id="radarLeader" aria-pressed="true">龙头优先</button><button type="button" id="radarCap" aria-pressed="false">按市值</button><button type="button" id="radarTime" aria-pressed="false">按时间</button></div>
<button id="radarMotion" class="radar-motion" type="button" aria-pressed="true" title="切换排序动效">动效 开</button></div>
<div class="radar-order-note" id="radarOrderNote">优先看近期、尚可复核的同行规模靠前标的。</div>
<details class="radar-settings"><summary><strong>筛选与口径</strong><span id="radarFilterLine">近期 10 天 · A 股与美股</span></summary>
<div class="radar-controls"><label>查看模式<select id="radarScope"><option value="recent">当前日期窗口</option><option value="today">今日确认</option><option value="archive">历史档案</option></select></label><label>市场<select id="radarMarket" aria-label="S点市场"><option value="all">A 股 + 美股</option><option value="CN">A 股 / ETF</option><option value="US">美股 / ETF</option></select></label><label>方向<select id="radarSide" aria-label="S点方向"><option value="all">买点 + 卖点</option><option value="buy">只看买点</option><option value="sell">只看卖点</option></select></label><label>范围<select id="radarDays" aria-label="S点近期范围"><option value="5">5 天</option><option value="10" selected>10 天</option><option value="30">30 天</option></select></label></div>
<div class="radar-update-tools"><button type="button" id="radarReset" class="text-button">恢复默认</button><button type="button" id="radarRefresh">检查新快照</button></div>
<p class="note" id="radarSavedFilters">筛选会保存在此浏览器。</p><p class="note" id="radarUpdateStatus" role="status"></p><p class="note" id="radarCoverage"></p>
<p class="radar-snapshot-scope" id="radarScaleScope"></p><p class="radar-snapshot-scope">买点为技术 S，胜率未经独立验证。卖点 S 表示当时已有持仓的退出紧迫度。确认时间按市场当地自然日筛选；历史档案按各标的最后 N 根日线回看。所有状态截至已发布收盘。</p></details>
<div class="radar-health"><i aria-hidden="true"></i><p id="radarTodayCoverage" role="status"></p></div>
<div id="radarStatus" role="status"></div><div id="radarList"></div>`;
  document.body.append(dialog);
  let storage=null,savedRaw=null;try{storage=window.localStorage;savedRaw=storage?.getItem(FILTER_KEY)||null;}catch(_){}
  const savedFilters=readFilters(storage);let preserveMarket=!!savedRaw;
  $('radarScope').value=savedFilters.scope;$('radarMarket').value=savedFilters.market;$('radarSide').value=savedFilters.side;$('radarDays').value=String(savedFilters.days);
  let data=null,pending=null,pageContainer=null,catalogUsed=null,checking=false,lastVersionCheck=0;
  const view=readView(storage);
  let priorityVersion=null,priorityRows=Object.create(null),priorityState='unavailable',priorityRequest=0,prioritySnapshot=null;
  const motionQuery=window.matchMedia?.('(prefers-reduced-motion: reduce)');
  function saveView() {try{storage?.setItem(VIEW_KEY,JSON.stringify(view));}catch(_){}}
  function controls() {
    for(const [id,mode] of [['radarLeader','leader'],['radarCap','cap'],['radarTime','time']])$(id).setAttribute('aria-pressed',String(view.mode===mode));
    const motion=$('radarMotion');motion.setAttribute('aria-pressed',String(view.motion&&!motionQuery?.matches));motion.textContent=motionQuery?.matches?'动效 关':view.motion?'动效 开':'动效 关';
    motion.disabled=!!motionQuery?.matches;
    motion.title=motion.disabled?'已遵循系统减少动态效果偏好':'切换排序动效';
    for(const [id,value] of [['radarAll','all'],['radarBuy','buy'],['radarSell','sell']])$(id).setAttribute('aria-pressed',String($('radarSide').value===value));
  }
  function render(animate=false) {
    controls();
    if(!data)return;
    const now=Date.now()/1000,market=$('radarMarket').value;
    const selection={market,scope:$('radarScope').value,side:$('radarSide').value,days:Number($('radarDays').value)};
    const rows=selectSignals(data,selection,now),allRows=selection.side==='all'?rows:selectSignals(data,{...selection,side:'all'},now),markets=market==='all'?['CN','US']:[market];
    let todayCovered=0,total=0;
    const coverage=markets.map(m=>{
      const c=data.coverage[m],w=dateWindow(m,selection.scope==='today'?1:selection.days,now);
      const missing=new Set(c.unavailable.map(a=>a.code));
      const scanned=catalogUsed.assets.filter(a=>a.market===m&&!missing.has(a.code));
      const current=scanned.filter(a=>a.data_asof>=w.start&&a.data_asof<=w.end).length;
      todayCovered+=scanned.filter(a=>a.data_asof===w.end).length;
      total+=c.asset_count;
      const latest=c.source_asof_min===c.source_asof_max?c.source_asof_max:`${c.source_asof_min} 至 ${c.source_asof_max}`;
      const range=selection.scope==='archive'?`档案末 ${selection.days} 根日线`:`窗口 ${w.start} 至 ${w.end}，有行情 ${current} 个`;
      return `${m==='CN'?'A 股':'美股'} · 已扫描 ${scanned.length}/${c.asset_count} 个 · 日线截至 ${latest||'未知'} · ${range}`;
    });
    const todayCount=selectSignals(data,{...selection,scope:'today'},now).length;
    let todayStatus;
    if(!total)todayStatus='所选市场暂无公开标的。';
    else if(todayCovered===total)todayStatus=`今日已收盘日线覆盖 ${total}/${total} 个标的，按所选方向确认 ${todayCount} 个 S 点。`;
    else{
      const observed=todayCount?`快照已记录 ${todayCount} 个今日确认的 S 点。`:'';
      todayStatus=(todayCovered?`今日已收盘日线仅覆盖 ${todayCovered}/${total} 个标的。`:'快照尚无所选市场今天的已收盘日线。')+observed+'今日信号总数未知。';
    }
    $('radarTodayCoverage').textContent=todayStatus;
    $('radarCoverage').textContent=coverage.join('。')+`。公开快照生成于 ${data.snapshot_at}。仅在发布新快照后更新行情与信号。`;
    const showCount=selection.scope!=='today'||(total>0&&todayCovered===total)||rows.length>0;
    $('radarStatus').textContent=showCount?`本快照中 ${rows.length} 个历史 S 点 · ${rows.filter(s=>s.side==='buy').length} 买点 / ${rows.filter(s=>s.side==='sell').length} 卖点`:'等待今日行情覆盖';
    const countsKnown=selection.scope!=='today'||todayCovered===total;
    function counter(matches){return matches.length||countsKnown?String(matches.length):'—';}
    $('radarAllCount').textContent=counter(allRows);$('radarBuyCount').textContent=counter(allRows.filter(s=>s.side==='buy'));$('radarSellCount').textContent=counter(allRows.filter(s=>s.side==='sell'));
    const scopeLabel=selection.scope==='archive'?'档案 '+selection.days+' 根':selection.scope==='today'?'今日确认':'近 '+selection.days+' 天';
    $('radarFilterLine').textContent=scopeLabel+' · '+(marketNames[market]||'A 股与美股');
    const available=priorityVersion===data.snapshot_at&&priorityState==='ready';
    const modeNote={leader:'先看状态和近期确认，再看同市场、同行业样本市值位次。',time:'按状态分层，层内从最近确认开始。',cap:'分市场比较公司市值，优先展示可复核的信号。'};
    $('radarOrderNote').textContent=view.mode==='time'||available?modeNote[view.mode]:priorityState==='loading'?'市值资料加载中，先按状态和确认时间展示。':'本快照暂无可用市值，先按状态和确认时间展示。';
    const stamp=prioritySnapshot?.observed_at,scopeLabels=[...new Set(Object.values(priorityRows).map(x=>x.peer_scope).filter(Boolean))];
    const observed=snapshotTime(stamp);
    $('radarScaleScope').textContent='龙头按同市场行业样本的公司市值衡量。样本至少 3 家、覆盖至少一半同行、位次在前 1/4 且近 7 天有观察，才提高排序。先分状态，再看近 3 天确认与同行位次。位次刻度越靠右，表示在该同行样本内排名越靠前。市值按本币展示，与行业位次可有不同观察日；ETF 不参与公司排名。'+(scopeLabels.length?'覆盖口径：'+scopeLabels.join('、')+'。':'')+(observed?'资料采集于 '+marketDate(observed,'CN')+'。':'');
    const list=$('radarList');
    const old=new Map();
    if(animate&&view.motion&&!motionQuery?.matches)for(const el of list.querySelectorAll?.('[data-radar-key]')||[])old.set(el.dataset.radarKey,el.getBoundingClientRect().top);
    const byCode=available?priorityRows:{};
    const uiMode=available?view.mode:'time';
    list.innerHTML=rows.length?groupedRows(rows,{mode:uiMode,byCode,assets:new Map(catalogUsed.assets.map(a=>[a.code,a])),now}):selection.scope==='today'&&(!total||todayCovered<total)?'<p class="empty">等所选市场的已收盘日线发布后，再查看今日 S 点。</p>':'<p class="empty">此快照在所选范围内没有匹配记录。可调整筛选或查看历史档案。</p>';
    if(animate&&view.motion&&!motionQuery?.matches)for(const el of list.querySelectorAll?.('[data-radar-key]')||[]){
      const previous=old.get(el.dataset.radarKey),offset=previous==null?6:Math.max(-32,Math.min(32,previous-el.getBoundingClientRect().top));
      el.animate?.([{transform:'translateY('+offset+'px)',opacity:.55},{transform:'translateY(0)',opacity:1}],{duration:190,easing:'ease-out'});
    }
  }
  const pins=document.querySelector('meta[name="pulse-signal-hashes"]')?.dataset||{};
  function urlFor(path,version,digest){
    const base=path+'?v='+encodeURIComponent(version);
    return /^[a-f0-9]{64}$/.test(digest||'')?base+'&r='+digest:base;
  }
  async function readPinned(response,digest){
    if(!/^[a-f0-9]{64}$/.test(digest||''))return response.json();
    const bytes=await response.arrayBuffer();
    const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
    if(actual!==digest)throw Error('文件校验与当前页面不一致，请重新载入新版。');
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  function loadPriority(catalog,retry) {
    const version=catalog.snapshot_at;
    if(priorityVersion===version&&!retry)return;
    const request=++priorityRequest;
    priorityVersion=version;priorityRows=Object.create(null);prioritySnapshot=null;
    if(!catalog.assets.some(a=>a.kind==='stock')){priorityState='unavailable';return;}
    priorityState='loading';
    const url=urlFor('data/signal-priority.json',version,pins.priority),controller=new AbortController();
    void bounded((async()=>{
      const response=await fetch(url,{cache:retry?'reload':'no-cache',signal:controller.signal});if(!response.ok)throw Error('市值暂不可用');
      const value=await readPinned(response,pins.priority),index=validatePriority(value,catalog);
      if(request!==priorityRequest)return;
      priorityRows=index;priorityState=Object.keys(index).length?'ready':'unavailable';prioritySnapshot=value;window.PulseOffline?.remember(url);
    })(),16000,'市值读取超时').catch(()=>{if(request===priorityRequest)priorityState='unavailable';}).finally(()=>{
      controller.abort();if(request===priorityRequest&&data?.snapshot_at===version)render();
    });
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
        if(data&&data.snapshot_at!==version){data=null;catalogUsed=null;$('radarTodayCoverage').textContent='';$('radarList').innerHTML='';$('radarCoverage').textContent='';}
        loadPriority(catalog,retry);
        const url=urlFor('data/signals/recent.json',version,pins.feed),controller=new AbortController();
        let body;
        try{body=await bounded((async()=>{const response=await fetch(url,{cache:retry?'reload':'no-cache',signal:controller.signal});if(!response.ok)throw new Error('近期信号汇总暂不可用；联网后可重试。');return readPinned(response,pins.feed);})(),20000,'信号汇总读取超时，可重试当前快照。');}finally{controller.abort();}
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
      const fresh=await bounded((async()=>{const response=await fetch('data/catalog.json',{cache:'reload',signal:controller.signal});if(!response.ok)throw Error('快照版本检查失败');return response.json();})(),15000,'快照版本检查超时');
      if(fresh?.schema_version!=='public-snapshot-1'||!Array.isArray(fresh.assets)||!snapshotTime(fresh.snapshot_at))throw Error('新版目录未通过校验');
      if(snapshotTime(fresh.snapshot_at)<snapshotTime(data.snapshot_at))throw Error('服务器返回较旧目录，已保留当前版本');
      lastVersionCheck=Date.now();
      if(fresh.snapshot_at!==data.snapshot_at){$('radarUpdateStatus').innerHTML='发现新的行情快照。<button type="button" id="radarApplyUpdate">载入新版</button>';$('radarApplyUpdate').addEventListener('click',()=>window.location.reload());}
      else{$('radarUpdateStatus').textContent='服务器最新快照与当前版本相同，暂无新发布的行情。';if(force)await load(true);}
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
  function rememberFilters(animate){preserveMarket=true;const saved=saveFilters(storage,{scope:$('radarScope').value,market:$('radarMarket').value,side:$('radarSide').value,days:Number($('radarDays').value)});$('radarSavedFilters').textContent=saved?'已保存筛选；下次打开会继续使用。':'当前筛选已应用；浏览器存储不可用，关闭后可能无法保留。';render(!!animate);}
  ['radarScope','radarMarket','radarSide','radarDays'].forEach(id=>$(id).addEventListener('change',rememberFilters));
  for(const [id,mode] of [['radarLeader','leader'],['radarCap','cap'],['radarTime','time']])$(id).addEventListener('click',()=>{if(view.mode!==mode){view.mode=mode;saveView();render(true);}});
  $('radarMotion').addEventListener('click',()=>{if(motionQuery?.matches)return;view.motion=!view.motion;saveView();controls();});
  motionQuery?.addEventListener?.('change',controls);
  for(const [id,value] of [['radarAll','all'],['radarBuy','buy'],['radarSell','sell']])$(id).addEventListener('click',()=>{$('radarSide').value=value;rememberFilters(true);});
  controls();
  $('radarReset').addEventListener('click',()=>{view.mode='leader';view.motion=true;saveView();$('radarScope').value='recent';$('radarMarket').value='all';$('radarSide').value='all';$('radarDays').value='10';rememberFilters();});
}());
