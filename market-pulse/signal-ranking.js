'use strict';
(function () {
  const currencies = {CN:'CNY',HK:'HKD',US:'USD'}, units = {CNY:'元',HKD:'港元',USD:'美元'};
  const zones = {CN:'Asia/Shanghai', HK:'Asia/Hong_Kong', US:'America/New_York', BTC:'UTC'};
  const marketOrder = ['CN','HK','US','BTC'];
  const formatters = new Map();
  const number = new Intl.NumberFormat('zh-CN',{maximumFractionDigits:2});
  function marketDay(stamp, market) {
    if (!Number.isFinite(stamp) || !zones[market]) return '';
    if (!formatters.has(market)) formatters.set(market,new Intl.DateTimeFormat('en-CA',{timeZone:zones[market],year:'numeric',month:'2-digit',day:'2-digit'}));
    return formatters.get(market).format(new Date(stamp*1000));
  }
  function capAmount(meta) {
    return meta?.kind==='stock' && currencies[meta.market]===meta.currency &&
      Number.isFinite(meta.market_cap) && meta.market_cap>0 && /^\d{4}-\d{2}-\d{2}$/.test(meta.cap_asof||'') ? meta.market_cap : 0;
  }
  function formatCap(meta) {
    const cap = capAmount(meta);
    if (!cap) return '';
    const unit = cap>=1e12 ? [1e12,'万亿'] : cap>=1e8 ? [1e8,'亿'] : [1e4,'万'];
    return number.format(cap/unit[0])+' '+unit[1]+units[meta.currency];
  }
  function peerKnown(meta) {
    return capAmount(meta)>0 && typeof meta.sector==='string' && !!meta.sector.trim() &&
      /^\d{4}-\d{2}-\d{2}$/.test(meta.peer_asof||'') && meta.peer_asof<=meta.cap_asof && Number.isInteger(meta.peer_count) && meta.peer_count>=2 &&
      Number.isInteger(meta.peer_rank) && meta.peer_rank>=1 && meta.peer_rank<=meta.peer_count;
  }
  function isLeader(meta,now=Date.now()/1000) {
    if(!peerKnown(meta)||meta.peer_count<3||!Number.isInteger(meta.peer_total)||meta.peer_total<meta.peer_count||
       meta.peer_count*2<meta.peer_total)return false;
    const today=marketDay(now,meta.market);
    const age=(Date.parse(today)-Date.parse(meta.peer_asof))/86400000;
    return age>=0 && age<=7 && meta.cap_asof<=today && meta.peer_rank<=Math.max(1,Math.floor(meta.peer_count/4));
  }
  function leaderLabel(meta) {
    return peerKnown(meta) ? '样本市值第 '+meta.peer_rank+' / '+meta.peer_count : '';
  }
  function metaFor(row, byCode) {
    const meta=byCode?.[row.code];
    return meta?.code===row.code && meta.market===row.market ? meta : null;
  }
  const clockFormats=new Map();
  function validDay(value) {
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
    const date=new Date(value+'T00:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10)===value;
  }
  function referenceReview(row,meta,baseState,now=Date.now()/1000) {
    if(row?.side!=='buy'||(row.period&&row.period!=='day')||!['active','unconfirmed','missed_entry'].includes(baseState))return null;
    const market=row.market;
    if(!meta||meta.code!==row.code||meta.market!==market||!currencies[market]||
       meta.currency!==currencies[market]||row.currency!==meta.currency||!Number.isFinite(now))return null;
    // A later fully observed day may retire a plan; never use this to qualify an entry.
    const signalDay=marketDay(row.confirmed_at,market),chartDay=row.data_end||row.source_asof;
    if(!signalDay||!validDay(chartDay)||!validDay(row.signal_date))return null;
    const plan=row.plan,ref=row.price;
    const verifiedPlan=plan?.reference_price===ref && Number.isFinite(plan.stop_pct)&&plan.stop_pct>0&&plan.stop_pct<100&&Number.isFinite(plan.take_pct)&&plan.take_pct>0;
    const stop=row.entry_zone?.stop_estimate ?? (verifiedPlan ? ref*(1-plan.stop_pct/100) : null);
    const take=row.entry_zone?.take_estimate ?? (verifiedPlan ? ref*(1+plan.take_pct/100) : null);
    if(![ref,stop,take].every(Number.isFinite)||!(stop>0&&stop<ref&&ref<take))return null;

    const quotes=Array.isArray(meta.reviewed_closes)?[...meta.reviewed_closes,meta.reviewed_close]:[meta.reviewed_close];
    let first=null;
    for(const q of quotes){
      if(!q||q.code!==row.code||q.currency!==meta.currency||typeof q.source!=='string'||!q.source.trim()||!validDay(q.date))continue;
      if(q.date<=row.signal_date||q.date<=signalDay||q.date<=chartDay||q.date>(first?.close.date||'9999-12-31'))continue;
      if(![q.low,q.close,q.high].every(v=>Number.isFinite(v)&&v>0)||q.low>q.close||q.close>q.high)continue;
      const state=q.low<=stop?'stop_touched':q.high>=take?'take_touched':null;
      if(!state)continue;
      const observed=typeof q.observed_at==='string'&&/(?:Z|[+-]\d{2}:\d{2})$/.test(q.observed_at)?Date.parse(q.observed_at)/1000:NaN;
      if(!Number.isFinite(observed)||observed>now||observed<=row.confirmed_at)continue;
      const observationDay=marketDay(observed,market);
      if(q.date>observationDay)continue;
      if(q.date===observationDay){
        if(!clockFormats.has(market))clockFormats.set(market,new Intl.DateTimeFormat('en-GB',{timeZone:zones[market],hour:'2-digit',minute:'2-digit',hourCycle:'h23'}));
        if(clockFormats.get(market).format(new Date(observed*1000))<(market==='CN'?'15:10':'16:10'))continue;
      }
      if(!first||q.date<first.close.date||(q.date===first.close.date&&state==='stop_touched'&&first.state!=='stop_touched'))first={state,close:q};
    }
    return first;
  }
  function referenceState(row,meta,baseState,now=Date.now()/1000) {
    return referenceReview(row,meta,baseState,now)?.state||baseState;
  }
  function stateTier(status) {
    if(status==='active') return 0;
    if(['expired','stop_touched','take_touched','missed_entry'].includes(status)) return 2;
    return 1;
  }
  function rankSignals(rows,{mode='leader',byCode={},stateFor=s=>s.status,getDay=s=>marketDay(s.confirmed_at,s.market),todayFor,now=Date.now()/1000}={}) {
    const today = {};
    const prepared = rows.map(row=>{
      const meta=metaFor(row,byCode), cap=capAmount(meta), day=getDay(row);
      const end=todayFor ? todayFor(row) : today[row.market] ||= marketDay(now,row.market);
      const age=(Date.parse(end)-Date.parse(day))/86400000;
      return {row, meta, cap, state:stateTier(stateFor(row)), recent:age>=0 && age<3,
        leader:isLeader(meta,now) ? (meta.peer_rank===1?2:1) : 0};
    });
    return prepared.sort((a,b)=>{
      const validity=a.state-b.state;
      if(validity) return validity;
      if(mode==='cap') {
        const market=marketOrder.indexOf(a.row.market)-marketOrder.indexOf(b.row.market);
        if(market) return market;
        if(a.cap!==b.cap) return b.cap-a.cap;
      } else if(mode==='leader') {
        if(a.recent!==b.recent) return Number(b.recent)-Number(a.recent);
        if(a.leader!==b.leader) return b.leader-a.leader;
      }
      return (b.row.confirmed_at||0)-(a.row.confirmed_at||0) || a.row.code.localeCompare(b.row.code) ||
        (a.row.id||'').localeCompare(b.row.id||'');
    }).map(item=>item.row);
  }
  const api={rankSignals,metaFor,formatCap,isLeader,leaderLabel,stateTier,referenceState,referenceReview};
  if(typeof module!=='undefined'&&module.exports) module.exports=api;
  if(typeof window!=='undefined') window.PulseSignalRanking=api;
})();
