'use strict';
(function () {
  const finite = n => typeof n === 'number' && Number.isFinite(n);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = n => finite(n) ? n.toLocaleString('zh-CN', {maximumFractionDigits:4}) : '—';
  function validSignal(s, maxAge = 30) {
    return s && ['CN','US'].includes(s.market) && ['buy','sell'].includes(s.side) && s.grade === 'S'
      && Number.isInteger(s.bar_age) && s.bar_age >= 0 && s.bar_age < maxAge
      && finite(s.time) && finite(s.confirmed_at) && s.confirmed_at >= s.time
      && finite(s.price) && s.price > 0 && /^[A-Za-z0-9.-]+$/.test(s.code || '')
      && /^\d{4}-\d{2}-\d{2}$/.test(s.signal_date || '');
  }
  function selectSignals(data, {market='all', side='all', days=10} = {}) {
    const size = [10,30].includes(Number(days)) ? Number(days) : 10;
    return (Array.isArray(data?.signals) ? data.signals : [])
      .filter(s => validSignal(s) && s.bar_age < size && (market==='all' || s.market===market) && (side==='all' || s.side===side))
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
  function rowHTML(s) {
    return `<a class="radar-row ${s.side}" href="${esc(signalLink(s))}"><div><strong>${esc(s.name)} <span>${esc(s.code)}</span></strong><b>${s.side==='buy'?'S · 历史买点':'S · 历史卖点'}</b></div><p>${esc(s.signal_date)} · ${s.bar_age===0?'末根已完成日线':`距末根 ${s.bar_age} 根`} · 参考 ${fmt(s.price)} ${esc(s.currency)}</p><small>${s.side==='sell'?'退出紧迫度评级；只适用于当时已有持仓。':referencePlan(s)||'查看当时完整依据与保护计划。'}</small><small>本股行情截至 ${esc(s.source_asof)} · 查看 K 线与详情 →</small></a>`;
  }
  const api={validSignal,selectSignals,signalLink,referencePlan,rowHTML};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(typeof document==='undefined')return;
  const $=id=>document.getElementById(id);
  const side=document.querySelector('.instrument-side');
  if(!side)return;
  const button=document.createElement('button');
  button.type='button';button.className='text-button radar-open';button.textContent='一键看近期 S 点';button.id='recentSignalsOpen';
  side.append(button);
  const dialog=document.createElement('dialog');
  dialog.id='recentSignalsDialog';dialog.className='radar-dialog';dialog.setAttribute('aria-labelledby','recentSignalsTitle');
  dialog.innerHTML=`<div class="dialog-head"><div><span class="eyebrow">A 股 · 美股 / 历史信号</span><h2 id="recentSignalsTitle">近期 S 点</h2></div><button type="button" class="close-button" id="recentSignalsClose" aria-label="关闭近期 S 点">×</button></div><p class="note">买点与卖点一起查。S 买点评估规则条件，S 卖点评估退出紧迫度，均不代表盈利概率。</p><div class="radar-controls"><label>市场<select id="radarMarket" aria-label="S点市场"><option value="all">A 股 + 美股</option><option value="CN">A 股 / ETF</option><option value="US">美股 / ETF</option></select></label><label>方向<select id="radarSide" aria-label="S点方向"><option value="all">买点 + 卖点</option><option value="buy">只看买点</option><option value="sell">只看卖点</option></select></label><label>范围<select id="radarDays" aria-label="S点近期范围"><option value="10">近 10 根日 K</option><option value="30">近 30 根日 K</option></select></label></div><p class="note" id="radarCoverage"></p><div id="radarStatus" role="status"></div><div id="radarList"></div><p class="note">“近期”以各标的最后一根已完成日 K 为基准，包含当根，按交易日根数计算。这里只查已验证的研究池，扩展历史档案不参与评级；旧快照信号不等于现在仍可以买卖。</p>`;
  document.body.append(dialog);
  let data=null,pending=null;
  function render() {
    if(!data)return;
    const market=$('radarMarket').value,selection={market,side:$('radarSide').value,days:Number($('radarDays').value)},rows=selectSignals(data,selection);
    const markets=market==='all'?['CN','US']:[market];
    const coverage=markets.map(m=>{const c=data.coverage?.[m];return `${m==='CN'?'A 股':'美股'} ${c?.scanned_count??0}/${c?.asset_count??0} 个标的 · 行情 ${c?.source_asof_min||'—'} 至 ${c?.source_asof_max||'—'}`;}).join('；');
    $('radarCoverage').textContent=coverage+`。信号快照：${String(data.snapshot_at||'').replace('T',' ').slice(0,16)}。`;
    $('radarStatus').textContent=`${rows.length} 个历史 S 点 · ${rows.filter(s=>s.side==='buy').length} 买点 / ${rows.filter(s=>s.side==='sell').length} 卖点`;
    $('radarList').innerHTML=rows.length?rows.map(rowHTML).join(''):'<p class="empty">此范围没有符合条件的历史 S 点。可以切换“近 30 根日 K”或其他市场；不会用 A 级或档案数据补足。</p>';
  }
  async function load() {
    if(data){render();return;}
    if(pending)return pending;
    $('radarStatus').textContent='正在读取轻量信号汇总…';
    pending=(async()=>{
      try {
        const response=await fetch('data/signals/recent.json',{cache:'no-cache'});
        if(!response.ok)throw new Error('近期信号汇总暂不可用；联网后可重试。');
        const result=await response.json();
        if(result.schema_version!=='recent-signals-1'||result.historical_only!==true||result.window_bars!==30||!Array.isArray(result.signals))throw new Error('信号汇总未通过校验，已停止展示。');
        data=result;window.PulseOffline?.remember('data/signals/recent.json');render();
      } catch(error) {
        $('radarStatus').innerHTML=`<div class="result-error">${esc(error.message)} <button type="button" id="radarRetry">重试</button></div>`;
        $('radarRetry')?.addEventListener('click',load);
      } finally {pending=null;}
    })();
    return pending;
  }
  button.addEventListener('click',()=>{
    const current=document.querySelector('#marketTabs [aria-pressed="true"]')?.dataset.market;
    $('radarMarket').value=['CN','US'].includes(current)?current:'all';
    dialog.showModal();void load();
  });
  $('recentSignalsClose').addEventListener('click',()=>dialog.close());
  ['radarMarket','radarSide','radarDays'].forEach(id=>$(id).addEventListener('change',render));
}());
