'use strict';
(function () {
  const MARKETS = {CN: ['A 股', 'CNY'], HK: ['港股', 'HKD'], US: ['美股', 'USD'], BTC: ['比特币', 'USD']};
  const PAGE_IDS = {sectors: 'mobileSectorsPage', temperature: 'mobileEnvironmentPage', help: 'mobileHelpPage'};
  const COLORS = ['#c4ef7b', '#79b7ec', '#c7a4e5', '#72ccc0'];
  const GOLD = '#edc879';
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const num = (value, digits = 2) => finite(value) ? value.toLocaleString('zh-CN', {maximumFractionDigits: digits, minimumFractionDigits: digits}) : '缺失';
  const percent = value => finite(value) ? `${value > 0 ? '+' : ''}${num(value)}%` : '缺失';
  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const t = Date.parse(value + 'T00:00:00Z');
    return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === value ? t : null;
  }
  function safePath(path) {
    if (typeof path !== 'string' || !/^data\/[A-Za-z0-9_./-]+\.json$/.test(path) || path.split('/').includes('..')) throw new Error('公开快照路径无效。');
    return path;
  }
  function validateCatalog(data) {
    const stamp = data?.snapshot_at;
    const validStamp = typeof stamp === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(stamp) && /(?:Z|[+-]\d{2}:\d{2})$/.test(stamp) && validDate(stamp.slice(0,10)) !== null && Number.isFinite(Date.parse(stamp));
    if (data?.schema_version !== 'mobile-analytics-1' || data.historical_only !== true || !validStamp ||
        !Array.isArray(data.core_chart_codes) || !data.core_chart_codes.every(code => typeof code === 'string' && /^[A-Za-z0-9._-]{1,32}$/.test(code)) ||
        !Array.isArray(data.markets) || !data.markets.length || data.markets.some(item => !item || !Object.prototype.hasOwnProperty.call(MARKETS, item.id)) ||
        new Set(data.markets.map(item => item.id)).size !== data.markets.length) throw new Error('分析目录格式或版本无效，请重新读取。');
    for (const item of data.markets) for (const key of ['environment_url', 'sectors_url']) {
      if (item[key] != null) { try { safePath(item[key]); } catch (_) { throw new Error('分析目录包含无效快照路径，请重新读取。'); } }
    }
    return data;
  }
  function validateLeaf(data, kind) {
    const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    const records = value => Array.isArray(value) && value.every(object);
    const dates = value => records(value) && value.every(row => validDate(row.date) !== null);
    const notes = value => value == null || Array.isArray(value) && value.every(item => typeof item === 'string');
    let valid = notes(data.notes) && notes(data.limitations);
    if (kind === 'environment') {
      valid = valid && ['index_series', 'breadth_series', 'trin_series'].every(key => dates(data[key])) &&
        ['index', 'breadth', 'trin', 'pcr'].every(key => data[key] == null || object(data[key]) && notes(data[key].notes)) &&
        records(data.pcr_series) && data.pcr_series.every(series => typeof series.id === 'string' && series.id.length > 0 && ['volume', 'oi'].includes(series.measure) && dates(series.rows)) &&
        new Set(data.pcr_series.map(series => series.id)).size === data.pcr_series.length;
    } else if (kind === 'sectors') {
      valid = valid && records(data.sectors) && data.sectors.every(sector => typeof sector.id === 'string' && (sector.companies == null || records(sector.companies))) &&
        ['companies', 'funds'].every(key => data[key] == null || records(data[key]));
    }
    if (!valid) throw new Error('分析快照数据结构无效，请重新读取。');
    return data;
  }
  function cap(value, currency) {
    if (!finite(value) || value <= 0) return '市值待补';
    const base = value >= 1e12 ? 1e12 : value >= 1e8 ? 1e8 : value >= 1e4 ? 1e4 : 1;
    return `${num(value / base)} ${base === 1e12 ? '万亿' : base === 1e8 ? '亿' : base === 1e4 ? '万' : ''}${{CNY: '元', HKD: '港元', USD: '美元'}[currency] || currency}`;
  }
  function datedRows(input, keys, cutoff = null) {
    const rows = new Map();
    for (const item of input || []) {
      if (!item || validDate(item.date) === null || item.complete === false || (validDate(cutoff) !== null && item.date > cutoff)) continue;
      const row = {date: item.date};
      for (const key of keys) row[key] = finite(item[key]) ? item[key] : null;
      rows.set(row.date, row);
    }
    return [...rows.values()].sort((a, b) => a.date.localeCompare(b.date));
  }
  function alignSeries(input, series, index, cutoff = null) {
    const metric = datedRows(input, series.map(s => s.key), cutoff), prices = datedRows(index, ['value'], cutoff).filter(r => r.value > 0);
    const metricMap = new Map(metric.map(r => [r.date, r])), priceMap = new Map(prices.map(r => [r.date, r.value]));
    const first = metric[0]?.date, last = metric.at(-1)?.date;
    const dates = [...new Set([...metricMap.keys(), ...prices.filter(r => first && r.date >= first && r.date <= last).map(r => r.date)])].sort();
    const common = metric.filter(r => series.some(s => finite(r[s.key])) && priceMap.has(r.date)).map(r => r.date);
    const baseDate = common[0] || null, base = baseDate ? priceMap.get(baseDate) : null;
    return {baseDate, commonCount: common.length, rows: dates.map(date => ({date,
      ...Object.fromEntries(series.map(s => [s.key, metricMap.get(date)?.[s.key] ?? null])),
      index_value: priceMap.get(date) ?? null,
      index_pct: baseDate && date >= baseDate && priceMap.has(date) ? (priceMap.get(date) / base - 1) * 100 : null,
    }))};
  }
  function viewRange(total, size = 60, end = total) {
    if (!Number.isInteger(total) || total <= 0) return {start: 0, end: 0, size: 0};
    size = Math.max(Math.min(8, total), Math.min(total, Math.round(Number(size) || 60)));
    end = Math.max(size, Math.min(total, Math.round(Number(end) || total)));
    return {start: end - size, end, size};
  }
  function zoomRange(total, view, factor, anchor = .5) {
    if (!total) return viewRange(0);
    anchor = Math.max(0, Math.min(1, Number(anchor) || 0));
    const size = viewRange(total, view.size * factor).size;
    const focus = view.start + anchor * Math.max(0, view.size - 1);
    return viewRange(total, size, Math.round(focus - anchor * (size - 1)) + size);
  }
  function panRange(total, view, pixels, width) {
    if (!finite(width) || width <= 0 || !finite(pixels)) return {...view};
    return viewRange(total, view.size, view.end - Math.round(pixels / width * view.size));
  }
  function pointerIndex(view, x, left, right, rows = null) {
    if (!view.size || !finite(x) || right <= left) return null;
    const ratio = Math.max(0, Math.min(1, (x - left) / (right - left)));
    if (rows) { const first = validDate(rows[view.start]?.date), last = validDate(rows[view.end - 1]?.date); if (first !== null && last !== null) { const target = first + ratio * (last - first); let nearest = view.start; for (let i = view.start + 1; i < view.end; i++) if (Math.abs(validDate(rows[i].date) - target) < Math.abs(validDate(rows[nearest].date) - target)) nearest = i; return nearest; } }
    return view.start + Math.round(ratio * (view.size - 1));
  }
  function lineSegments(rows, key) {
    const segments = []; let run = [];
    for (let index = 0; index < rows.length; index++) {
      if (finite(rows[index][key])) run.push({index, value: rows[index][key]});
      else if (run.length) { segments.push(run); run = []; }
    }
    if (run.length) segments.push(run);
    return segments;
  }
  function normalizeDirectory(data) {
    const byCode = new Map();
    for (const item of data.companies || []) if (item?.code) byCode.set(item.code, {...item});
    for (const sector of data.sectors || []) for (const item of sector.companies || []) {
      if (!item?.code) continue;
      const previous = byCode.get(item.code);
      byCode.set(item.code, {...item, sector_id: previous?.sector_id || item.sector_id || sector.id, sector_name: previous?.sector_name || item.sector_name || sector.name, sectors: [...new Set([...(previous?.sectors || []), sector.id])]});
    }
    return {...data, companies: [...byCode.values()]};
  }
  function directoryRows(data, query = '', sector = 'all', sort = 'code', page = 1, limit = 24) {
    const q = String(query).trim().toLowerCase();
    let rows = (data.companies || []).filter(item => (!item.market || item.market === data.market) && (!item.currency || item.currency === data.currency));
    if (sector !== 'all') rows = rows.filter(item => item.sector_id === sector || item.sectors?.includes(sector));
    if (q) rows = rows.filter(item => `${item.name || ''} ${item.code || ''} ${item.sector_name || ''}`.toLowerCase().includes(q));
    rows = rows.slice().sort((a, b) => sort === 'cap' ? (finite(b.market_cap) ? b.market_cap : -1) - (finite(a.market_cap) ? a.market_cap : -1) || String(a.code).localeCompare(String(b.code)) : String(a.code).localeCompare(String(b.code)));
    const pages = Math.max(1, Math.ceil(rows.length / limit)); page = Math.min(pages, Math.max(1, Math.floor(page) || 1));
    return {rows: rows.slice((page - 1) * limit, page * limit), all: rows, total: rows.length, pages, page};
  }
  function coreLink(code, coreCodes) {
    return typeof code === 'string' && /^[A-Za-z0-9._-]{1,32}$/.test(code) && new Set(coreCodes || []).has(code) ? `./?symbol=${encodeURIComponent(code)}` : null;
  }
  function archiveDirectory(data) {
    if (data?.schema_version !== 'cn-archive-1' || data.archive_only !== true || !Array.isArray(data.assets) || typeof data.generated_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(data.generated_at) || !/(?:Z|[+-]\d{2}:\d{2})$/.test(data.generated_at) || !Number.isFinite(Date.parse(data.generated_at))) throw new Error('历史档案目录格式或版本无效。');
    const assets = new Map();
    for (const item of data.assets) {
      if (!item || !/^(?:sh|sz|bj)\d{6}$/.test(item.code || '') || assets.has(item.code) || item.market !== 'CN' || item.currency !== 'CNY' || item.archive_only !== true || item.chart_url !== `data/archive/charts/${item.code}.json` || typeof item.name !== 'string' || !item.name.trim() || !Number.isInteger(item.bars_count) || item.bars_count <= 0 || validDate(item.start) === null || validDate(item.end) === null || item.start > item.end) throw new Error('历史档案目录标的、身份或路径未通过校验。');
      assets.set(item.code, {code:item.code, name:item.name, market:'CN', currency:'CNY', end:item.end});
    }
    return {version:data.generated_at, assets};
  }
  function archiveLink(item, directory) {
    const found = directory?.assets.get(item?.code);
    return item?.market === 'CN' && item.currency === 'CNY' && found && typeof item.name === 'string' && item.name.trim() === found.name.trim() ? `./?archive=${encodeURIComponent(found.code)}` : null;
  }
  const BROWSE_KEY = 'pulse-mobile-sector-browse-v1';
  function sectorPreferences(input) {
    const markets = {}, text = value => typeof value === 'string' ? value.slice(0, 160) : '';
    for (const market of ['CN', 'HK', 'US']) {
      const row = input?.markets?.[market]; if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
      markets[market] = {sector:typeof row.sector === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(row.sector) ? row.sector : 'all', query:text(row.query), sort:row.sort === 'cap' ? 'cap' : 'code', listPage:Number.isInteger(row.listPage) ? Math.max(1, Math.min(1000, row.listPage)) : 1, fundQuery:text(row.fundQuery)};
    }
    return {version:1, markets, archiveRequested:input?.archiveRequested === true};
  }
  function readSectorPreferences(storage) {
    try { const raw = storage?.getItem(BROWSE_KEY); if (typeof raw !== 'string' || raw.length > 8192) return sectorPreferences(null); const data = JSON.parse(raw); return sectorPreferences(data?.version === 1 ? data : null); }
    catch (_) { return sectorPreferences(null); }
  }
  function writeSectorPreferences(storage, markets, archiveRequested) {
    try { storage?.setItem(BROWSE_KEY, JSON.stringify(sectorPreferences({markets:Object.fromEntries(markets), archiveRequested}))); } catch (_) {}
  }
  function validCaps(rows, currency, unit) {
    return unit === 'base_currency' ? (rows || []).filter(r => finite(r.market_cap) && r.market_cap > 0 && (!r.currency || r.currency === currency) && !['etf', 'fund'].includes(r.kind)) : [];
  }
  function companyCapHTML(item, data) {
    if (validCaps([item], data.currency, data.market_cap_unit).length) return cap(item.market_cap, data.currency);
    const warning = typeof item.market_cap_warning === 'string' ? item.market_cap_warning.trim() : '';
    return warning ? `市值暂不展示<small>来源校验未通过：${esc(warning)}</small>` : '市值待补';
  }
  function validTrinRows(data) { return data.trin?.status === 'available' ? datedRows(data.trin_series, ['value']) : []; }
  function fundGroups(data, query = '') {
    const groups = new Map(), q = String(query).trim().toLowerCase();
    const priority = {
      gold: {name:'黄金', order:0, note:'这里展示 ETF 份额价格，不是即时黄金现货报价；实物、期货或矿业股票类产品的跟踪对象可能不同。'},
      oil: {name:'原油', order:1, note:'这里是原油相关 ETF，不是直接交易现货原油。期货类产品受移仓及期限结构影响，涨跌可能不同于现货油价。'},
      treasury: {name:'美债', order:2, note:'这里是美国国债 ETF 的份额价格，不是国债收益率曲线；不同久期对利率变化的敏感度不同。'},
    };
    for (const f of data.funds || []) {
      if ((f.market && f.market !== data.market) || (f.currency && f.currency !== data.currency)) continue;
      const text = `${f.name || ''} ${f.sector_name || ''}`, code = String(f.code || '').toUpperCase();
      const category = /黄金|黃金/i.test(text) || ['USGLD','USIAU','USGLDM','USSGOL','SH518880','SZ159934'].includes(code) ? 'gold'
        : /原油/.test(text) || ['USUSO','USBNO','USDBO'].includes(code) ? 'oil'
        : /美债|美国国债|美國國債|Treasury/i.test(text) || ['USTLT','USIEF','USSHY','USBIL','USSGOV','USGOVT'].includes(code) ? 'treasury' : null;
      const id = category || f.sector_id || f.sector_name || 'funds', meta = priority[category];
      const name = meta?.name || f.sector_name || '其他 ETF';
      if (q && !`${text} ${f.code || ''} ${name}`.toLowerCase().includes(q)) continue;
      if (!groups.has(id)) groups.set(id, {id, name, priority:!!meta, order:meta?.order ?? 10, note:meta?.note || '', funds:[]});
      groups.get(id).funds.push(f);
    }
    return [...groups.values()].sort((a,b)=>a.order-b.order||a.name.localeCompare(b.name,'zh-CN'));
  }
  function fundGroupsHTML(data, coreCodes, query = '') {
    const groups = fundGroups(data, query);
    if (!groups.length) return '<p class="mp-note">没有匹配的 ETF。可按名称、代码或板块名称搜索。</p>';
    return groups.map(group => `<details class="mp-fund-group" ${group.priority || String(query).trim() ? 'open' : ''}><summary><span>${esc(group.priority ? '重点资产 · ' : '')}${esc(group.name)}</span><small>${group.funds.length} 只 ETF</small></summary>${group.note ? `<p class="mp-note">${esc(group.note)}</p>` : ''}<div class="mp-funds">${group.funds.map(f => { const link = coreLink(f.code, coreCodes); const body = `${esc(f.name || f.code)}<small>${esc(f.code)} · ${link ? '查看已发布 K 线' : '日 K 待补'}</small>`; return link ? `<a href="${esc(link)}">${body}</a>` : `<span>${body}</span>`; }).join('')}</div></details>`).join('');
  }
  function fundsHTML(data, coreCodes, query = '') {
    const funds = (data.funds || []).filter(f=>(!f.market||f.market===data.market)&&(!f.currency||f.currency===data.currency));
    if (!funds.length) return '';
    return `<section class="mp-card" id="mpFundsPanel"><div class="mp-card-head"><h2>板块 / 宽基 ETF 入口</h2><span>与公司市值分开</span></div><p class="mp-note">ETF 是基金份额，不计入公司的数量和行业市值。黄金、原油、美债是资产分类入口，不是投资评级。</p><label class="mp-fund-search">搜索 ETF<input id="mpFundSearch" type="search" placeholder="ETF 名称、代码或板块" autocomplete="off" value="${esc(query)}"></label><div id="mpFundGroups">${fundGroupsHTML(data, coreCodes, query)}</div></section>`;
  }
  function pcrRows(data, id) {
    const selected = (data.pcr_series || []).find(s => s.id === id);
    return selected ? {series: selected, rows: datedRows(selected.rows, ['value'])} : {series: null, rows: []};
  }
  const exported = {esc, num, validDate, safePath, cap, datedRows, alignSeries, viewRange, zoomRange, panRange, pointerIndex, lineSegments, normalizeDirectory, directoryRows, coreLink, archiveDirectory, archiveLink, sectorPreferences, readSectorPreferences, writeSectorPreferences, validCaps, pcrRows, validTrinRows, fundGroups, fundGroupsHTML, fundsHTML};
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  if (typeof document === 'undefined') return;

  const state = {page: 'help', active: false, market: 'CN', serial: 0, catalog: null, sectors: null, environment: null, sector: 'all', query: '', sort: 'code', listPage: 1, fundQuery: '', curves: new Set(['price', 'breadth', 'pcr']), overlay: true, breadthMa: true, pcr: null};
  let browseStorage = null; try { browseStorage = window.sessionStorage; } catch (_) {}
  const savedSectorPreferences = readSectorPreferences(browseStorage);
  const sectorBrowse = new Map(Object.entries(savedSectorPreferences.markets)), archive = {status:'idle', directory:null, pending:null, error:'', requested:savedSectorPreferences.archiveRequested};
  const loaded = new Map(), pending = new Map(), plots = new Map();
  let readGeneration = 0;
  const byId = id => document.getElementById(id);
  for (const [page, id] of Object.entries(PAGE_IDS)) {
    if (byId(id)) continue;
    const section = document.createElement('section'); section.id = id; section.className = 'mp-page'; section.hidden = true; section.dataset.mobilePage = page;
    const main = document.querySelector('main') || document.body; main.insertBefore(section, main.querySelector('footer'));
  }
  function pageRoot(page = state.page) { return byId(PAGE_IDS[page]); }
  function marketTabs() { return `<nav class="mp-markets" aria-label="本页市场">${Object.entries(MARKETS).map(([code, info]) => `<button type="button" data-mp-market="${code}" aria-pressed="${code === state.market}">${info[0]}</button>`).join('')}</nav>`; }
  function heading(title, subtitle) { return `<div class="mp-heading"><span class="eyebrow">HISTORICAL SNAPSHOT</span><h1>${title}</h1><p>${subtitle}</p></div>`; }
  function notesHTML(notes, title = '数据口径与限制') { return Array.isArray(notes) && notes.length ? `<details class="mp-notes"><summary>${esc(title)}</summary>${notes.filter(n => typeof n === 'string').map(n => `<p>${esc(n)}</p>`).join('')}</details>` : ''; }
  async function fetchBody(url, reload, timeout = 25000) {
    const controller = new AbortController(); let timer;
    const body = (async () => {
      const response = await fetch(url, {cache: reload ? 'reload' : 'no-cache', signal: controller.signal});
      if (!response.ok) throw new Error('这份页面快照尚未发布，或本机离线时没有缓存。');
      return response.json();
    })();
    // Leave the worker's 20-second cold-read deadline time to settle first.
    // The same bound also protects an uncontrolled first visit and slow bodies.
    try { return await Promise.race([body, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('分析快照读取超时，请重新读取。')), timeout);
    })]); } finally { clearTimeout(timer); controller.abort(); }
  }
  async function read(path, version, market, reload = false, kind = null) {
    let url = safePath(path); if (version) url += '?v=' + encodeURIComponent(version);
    const generation = readGeneration, validate = data => {
      if (path === 'data/analytics/catalog.json') return validateCatalog(data);
      if (version && (data?.schema_version !== 'mobile-analytics-1' || data.historical_only !== true || data.snapshot_at !== version)) throw new Error('分析快照版本不一致，请检查更新后重试。');
      if (market && data?.market !== market) throw new Error('返回市场与当前选择不一致，停止展示。');
      if (market && data?.currency && data.currency !== MARKETS[market][1]) throw new Error('目录币种不一致，停止比较市值。');
      return validateLeaf(data, kind);
    };
    if (reload) { loaded.delete(url); pending.delete(url); }
    if (loaded.has(url)) return validate(loaded.get(url));
    if (pending.has(url)) return validate(await pending.get(url));
    const promise = (async () => { const data = validate(await fetchBody(url, reload)); if (generation === readGeneration) { loaded.set(url, data); window.PulseOffline?.remember(url); } return data; })();
    pending.set(url, promise); try { return await promise; } finally { if (pending.get(url) === promise) pending.delete(url); }
  }
  async function catalog(reload = false) {
    if (state.catalog && !reload) return state.catalog;
    const generation = readGeneration, data = await read('data/analytics/catalog.json', undefined, undefined, reload);
    if (generation === readGeneration) state.catalog = data;
    return data;
  }
  function retryPage() {
    // Refresh this page's catalog and selected leaf only. Other validated
    // snapshots remain intact; older requests cannot repopulate their entries.
    readGeneration++; state.catalog = null;
    open(state.page, state.market, true);
  }
  function resourceFor(c, kind, market) {
    const item = Array.isArray(c.markets) ? c.markets.find(x => x.id === market) : c.markets?.[market];
    return item?.[kind + '_url'] || c[kind + '_urls']?.[market] || `data/analytics/${kind}-${market}.json`;
  }
  async function open(pageId, market, reload = false) {
    if (!PAGE_IDS[pageId]) return;
    state.page = pageId; state.active = true; if (MARKETS[market]) state.market = market;
    const own = ++state.serial, selectedMarket = state.market;
    if (pageId === 'help') { renderHelp(); return; }
    pageRoot().innerHTML = heading(pageId === 'sectors' ? '板块里有哪些公司？' : '指数背后，有多少人在涨？', '按需读取已发布的公共快照。') + '<p class="mp-note" role="status">正在读取本市场历史数据…</p><div class="mp-skeleton" aria-hidden="true"></div><div class="mp-skeleton large" aria-hidden="true"></div>';
    try {
      const c = await catalog(reload); if(own!==state.serial)return; const kind = pageId === 'sectors' ? 'sectors' : 'environment';
      if (pageId === 'sectors' && selectedMarket === 'BTC') { if (own !== state.serial) return; pageRoot('sectors').innerHTML = heading('比特币是单一资产。', '公司行业市值分类不适用于 BTC。这里保留现货历史入口，不与股票公司市值混算。') + `<section class="mp-card"><h2>BTC-USD</h2><p class="mp-note">美元计价的现货历史，不含杠杆合约。</p>${assetAction({code:'BTC-USD'})}</section>`; return; }
      const data = await read(resourceFor(c, kind, selectedMarket), c.snapshot_at, selectedMarket, reload, kind);
      if (own !== state.serial) return;
      if(data.schema_version!=='mobile-analytics-1'||data.historical_only!==true||data.snapshot_at!==c.snapshot_at)throw new Error('分析快照版本不一致，请检查更新后重试。');
      if (data.market !== selectedMarket) throw new Error('返回市场与当前选择不一致，停止展示。');
      if (pageId === 'sectors') {
        if (data.currency && data.currency !== MARKETS[selectedMarket][1]) throw new Error('目录币种不一致，停止比较市值。');
        state.sectors = normalizeDirectory(data);
        const saved = sectorBrowse.get(selectedMarket) || {};
        state.sector = data.sectors.some(s => s.id === saved.sector) ? saved.sector : 'all';
        state.query = saved.query || ''; state.sort = saved.sort || 'code'; state.listPage = saved.listPage || 1; state.fundQuery = saved.fundQuery || '';
        renderSectors();
      } else { state.environment = data; if (!(data.pcr_series || []).some(p => p.id === state.pcr)) state.pcr = data.pcr_series?.[0]?.id || null; renderEnvironment(); }
    } catch (error) {
      if (own !== state.serial) return;
      pageRoot().innerHTML = heading(pageId === 'sectors' ? '板块与公司' : '市场温度', '历史快照，不提供当前实时买卖提示。') + `<div class="mp-empty">${esc(error.message)}<p><button type="button" data-mp-retry>重新读取</button></p></div>`;
    }
  }
  function publicCoreCodes() { return state.catalog?.core_chart_codes || []; }
  function assetAction(item) {
    const link = coreLink(item.code, publicCoreCodes());
    if (link) return `<a class="mp-open" href="${esc(link)}">打开已发布 K 线 →</a>`;
    if (item.market === 'CN') {
      const historical = archiveLink(item, archive.directory);
      if (historical) return `<a class="mp-open" href="${esc(historical)}">查看历史档案（无信号/回测） →</a><small>档案截至 ${esc(archive.directory.assets.get(item.code).end)}</small>`;
      const message = archive.status === 'ready' ? archive.directory.assets.has(item.code) ? '历史档案名称待核验，未生成入口' : '暂无已发布核心行情或历史档案' : archive.status === 'loading' ? '正在核验历史档案目录…' : archive.status === 'failed' ? '档案目录读取失败，尚未确认可用' : '核心行情未收录 · 可查询历史档案';
      return `<span class="mp-unavailable">${message}</span>`;
    }
    return '<span class="mp-unavailable">日 K 待补 · 目录不等于已有行情</span>';
  }
  function saveSectorBrowse() {
    if (state.sectors) sectorBrowse.set(state.sectors.market, {sector:state.sector, query:state.query, sort:state.sort, listPage:state.listPage, fundQuery:state.fundQuery});
    writeSectorPreferences(browseStorage, sectorBrowse, archive.requested);
  }
  function renderArchiveLookup() {
    const target = byId('mpArchiveLookup'); if (!target || state.sectors?.market !== 'CN') return;
    const message = archive.status === 'ready' ? `已核验 ${archive.directory.assets.size.toLocaleString('zh-CN')} 个档案标的 · 目录版本 ${archive.directory.version}` : archive.status === 'loading' ? '正在读取历史档案目录，板块与公司列表仍可使用…' : archive.status === 'failed' ? `历史档案目录尚未核验：${archive.error}` : '部分公司已有独立历史价格档案。按需读取一次目录后，才为核验通过的公司显示入口。';
    target.innerHTML = `<p class="mp-note" role="status">${esc(message)}</p>${archive.status === 'ready' ? '' : `<button type="button" data-mp-archive ${archive.status === 'loading' ? 'disabled' : ''}>${archive.status === 'failed' ? '重试历史档案目录' : '查找已有历史档案'}</button>`}<p class="mp-note">历史档案的复权口径和成交量单位尚未核验，仅查看历史价格，不提供信号或回测。</p>`;
  }
  function loadArchiveLinks() {
    // Store only the user's lookup intent in this tab, never the directory.
    archive.requested = true; writeSectorPreferences(browseStorage, sectorBrowse, true);
    if (archive.pending || archive.status === 'ready') return archive.pending;
    const reload = archive.status === 'failed'; archive.status = 'loading'; archive.error = '';
    renderArchiveLookup(); renderCompanies();
    const pending = (async () => {
      try {
        // This optional 1.46 MB directory never blocks the initial sector page.
        // The completed directory is shared across subsequent page visits.
        const directory = archiveDirectory(await fetchBody('data/archive/catalog.json', reload, 45000));
        archive.directory = directory; archive.status = 'ready'; window.PulseOffline?.remember('data/archive/catalog.json');
      } catch (error) { archive.status = 'failed'; archive.error = error.message; }
      finally {
        archive.pending = null;
        // The same market may currently be showing a fresh loading skeleton.
        // Keep the verified directory ready, then let that render use it.
        if (state.active && state.page === 'sectors' && state.market === 'CN' && state.sectors?.market === 'CN' && byId('mpCompanyStatus')) { renderArchiveLookup(); renderCompanies(); }
      }
    })();
    archive.pending = pending; return pending;
  }
  function sectorScale(data) {
    const good = validCaps(data.sectors, data.currency, data.market_cap_unit).sort((a, b) => b.market_cap - a.market_cap);
    if (!good.length) return '<p class="mp-empty">尚无可比较的板块市值。下面保留真实目录，不用公司数量替代市值。</p>';
    const max = good[0].market_cap;
    return `<div class="mp-bars">${good.map(s => `<button type="button" class="mp-bar-row" data-mp-sector="${esc(s.id)}"><span>${esc(s.name)}</span><span class="mp-bar-track"><i style="width:${(s.market_cap / max * 100).toFixed(3)}%"></i></span><strong>${cap(s.market_cap, data.currency)}</strong></button>`).join('')}</div><p class="mp-note">金额只按 ${esc(data.currency)} 比较；缺失市值不按零绘图。点板块查看其中公司。</p>`;
  }
  function renderSectors() {
    const d = state.sectors, sectors = d.sectors || [], companies = d.companies || [], sample = d.scope === 'research_sample' || ['HK', 'US'].includes(state.market);
    pageRoot('sectors').innerHTML = heading('先看板块，再看公司。', sample ? '这是已收录的研究目录，未覆盖全市场；板块数量和公司数量都只代表本次样本。' : '行业目录与历史行情分开展示，市值表示规模，不表示未来收益。') +
      `<div class="mp-snapshot">来源日期 ${esc(d.source_asof || d.data_asof || d.data_date || '未返回')} · ${esc(MARKETS[state.market][0])} · ${esc(d.currency || MARKETS[state.market][1])}<small>${esc(d.source || '来源未返回')} · ${esc(d.scope_label || d.scope || '')}</small></div>` +
      `<div class="mp-stats"><div><strong>${sectors.length}</strong><span>已收录板块</span></div><div><strong>${companies.length.toLocaleString('zh-CN')}</strong><span>目录中的标的</span></div><div><strong>${companies.filter(x => coreLink(x.code, publicCoreCodes())).length}</strong><span>核心行情 K 线</span></div></div>` +
      `<section class="mp-card"><div class="mp-card-head"><h2>板块规模</h2><span>${sample ? '样本口径' : '来源行业口径'}</span></div>${sectorScale(d)}</section>` + fundsHTML(d, publicCoreCodes(), state.fundQuery) +
      `<section class="mp-card"><div class="mp-card-head"><h2>公司目录</h2><span>按需打开单个标的</span></div><div class="mp-directory-tools"><label>板块<select id="mpSectorFilter"><option value="all">全部已收录板块</option>${sectors.map(s => `<option value="${esc(s.id)}" ${state.sector === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label><label>搜索<input id="mpCompanySearch" type="search" placeholder="公司名称或代码" value="${esc(state.query)}"></label><label>排序<select id="mpCompanySort"><option value="code">按代码</option><option value="cap" ${state.sort === 'cap' ? 'selected' : ''}>已知市值优先</option></select></label></div>${state.market === 'CN' ? '<div id="mpArchiveLookup"></div>' : ''}<div id="mpCompanyDistribution"></div><div id="mpCompanyStatus" class="mp-note" role="status"></div><div id="mpCompanyRows" class="mp-company-grid"></div><div id="mpCompanyPages" class="mp-pagination"></div></section>` + notesHTML([...(d.limitations || []), ...(d.notes || [])]);
    renderCompanies(); renderArchiveLookup();
    if (state.market === 'CN' && archive.requested && archive.status === 'idle') {
      const own = state.serial;
      // A hard navigation/back rebuilds this document. Restore the list first,
      // then revalidate an earlier user-requested directory in the background.
      setTimeout(() => { if (own === state.serial && state.active && state.page === 'sectors' && state.market === 'CN') void loadArchiveLinks(); }, 0);
    }
  }
  function renderCompanies() {
    const d = state.sectors, selection = directoryRows(d, state.query, state.sector, state.sort, state.listPage), rows = selection.rows;
    state.listPage = selection.page; saveSectorBrowse();
    const priced = validCaps(selection.all, d.currency, d.market_cap_unit).sort((a,b) => b.market_cap - a.market_cap), max = priced[0]?.market_cap;
    byId('mpCompanyDistribution').innerHTML = priced.length ? `<details class="mp-explain"><summary>查看当前结果中的公司市值分布</summary><p class="mp-note">${priced.length} / ${selection.total} 家有市值；以下列出已知市值前 8 名，未取得的公司不按零值计算。</p><div class="mp-bars">${priced.slice(0,8).map(c=>`<div class="mp-bar-row"><span title="${esc(c.name)}">${esc(c.name)}</span><span class="mp-bar-track"><i style="width:${(c.market_cap/max*100).toFixed(3)}%"></i></span><strong>${cap(c.market_cap,d.currency)}</strong></div>`).join('')}</div></details>` : '';

    byId('mpCompanyStatus').textContent = `${selection.total.toLocaleString('zh-CN')} 个匹配标的 · 可用市值 ${priced.length} / ${selection.total} 家 · 第 ${selection.page} / ${selection.pages} 页；核心行情与独立历史档案分开标示。`;
    byId('mpCompanyRows').innerHTML = rows.length ? rows.map(item => `<article class="mp-company"><div><h3>${esc(item.name || item.code)}</h3><span>${esc(item.code)} · ${esc(item.kind === 'etf' ? 'ETF' : item.sector_name || '公司')}</span></div><p>${companyCapHTML(item, d)}<small>${esc(item.source_time || item.data_date || item.source_asof || '')}</small></p>${assetAction(item)}</article>`).join('') : '<p class="mp-empty">当前板块或搜索没有匹配标的。可清空搜索或选择全部板块。</p>';
    byId('mpCompanyPages').innerHTML = `<button type="button" data-mp-list-page="${selection.page - 1}" ${selection.page <= 1 ? 'disabled' : ''}>上一页</button><span>${selection.page} / ${selection.pages}</span><button type="button" data-mp-list-page="${selection.page + 1}" ${selection.page >= selection.pages ? 'disabled' : ''}>下一页</button>`;
  }
  function panelSpecs(d) {
    const benchmark = d.index || {}, cutoff=typeof d.snapshot_at==='string'?d.snapshot_at.slice(0,10):null, priceRows = datedRows(d.index_series, ['value'],cutoff).map(r => ({...r, value: r.value > 0 ? r.value : null}));
    const breadthRows = datedRows(d.breadth_series, ['up_pct', 'ma20_pct', 'ad'],cutoff);
    const pcr = pcrRows(d, state.pcr);pcr.rows=datedRows(pcr.rows,['value'],cutoff);
    return [
      {id: 'price', title: benchmark.name || '市场价格走势', tag: state.market === 'BTC' ? 'USD / 现货' : '指数点位', rows: priceRows, series: [{key: 'value', label: benchmark.name || '指数', color: GOLD}], unit: state.market === 'BTC' ? 'USD' : '点', reason: benchmark.reason || '未取得可验证的完整指数日线。', explanation: '价格线显示该市场指数或 BTC 现货的历史收盘。它不会自动更新为当前报价。'},
      {id: 'breadth', title: '上涨覆盖面', tag: '样本占比', rows: breadthRows, series: [{key: 'up_pct', label: '上涨占比', color: COLORS[0]}, ...(state.breadthMa ? [{key: 'ma20_pct', label: 'MA20 上方占比', color: COLORS[1]}] : [])], unit: '%', bounds: [0, 100], reference: 50, reason: d.breadth?.reason || '该市场没有已发布的涨跌家数统计。', explanation: '上涨占比 = 当日上涨家数 ÷ 有效样本家数。MA20 上方占比看多少只股票高于各自最近 20 根均价。它们说明参与面，不能单独给出买卖结论。'},
      {id: 'trin', title: '阿姆士 TRIN', tag: '量能分布', rows: validTrinRows(d), series: [{key: 'value', label: 'TRIN', color: COLORS[2]}], unit: '倍', reference: 1, reason: d.trin?.reason || '没有同时具备可靠涨跌家数与两组成交量，暂不绘图。', explanation: 'TRIN =（上涨家数 / 下跌家数）÷（上涨股成交量 / 下跌股成交量）。只有样本与成交量单位一致时，低于 1 才可解释为相对量能偏向上涨侧；高于 1 偏向下跌侧。分母为零或来源不可靠时不计算。'},
      {id: 'ad', title: '累计净上涨家数', tag: 'A / D', rows: breadthRows, series: [{key: 'ad', label: '累计 A/D', color: COLORS[3]}], unit: '家', reference: 0, reason: d.breadth?.reason || '缺少连续可验证的涨跌家数，无法展示累计线。', explanation: '每日净上涨家数 = 上涨家数 − 下跌家数，再按源快照累计。缺口不补零、不补涨跌家数；样本变化和统计区间会影响绝对值，不宜跨市场直接比较。'},
      {id: 'pcr', title: '期权认沽 / 认购比', tag: 'PCR', rows: pcr.rows, series: [{key: 'value', label: pcr.series?.label || 'PCR', color: COLORS[1]}], unit: '倍', reference: 1, reason: d.pcr?.reason || '该市场对应期权范围与统计口径尚未接入。', explanation: `PCR = 认沽期权${pcr.series?.measure === 'oi' ? '持仓量' : '成交量'} ÷ 认购期权${pcr.series?.measure === 'oi' ? '持仓量' : '成交量'}。认沽较多可能是防守，也可能是对冲；成交量与持仓量口径不能混用。期权产品范围未必等于叠加的股票指数。`},
    ];
  }
  function hasPanelData(panel) { return panel.rows.some(r => panel.series.some(s => finite(r[s.key]))); }
  const savedViews = new Map();
  function renderEnvironment() {
    const d = state.environment, specs = panelSpecs(d), supported = specs.filter(hasPanelData), unsupported = specs.filter(s => !hasPanelData(s));
    const latestPrice = datedRows(d.index_series, ['value']).filter(r => r.value > 0).at(-1), latestBreadth = datedRows(d.breadth_series, ['up_pct', 'adv', 'dec', 'eligible']).filter(r => finite(r.up_pct)).at(-1);
    for (const plot of plots.values()) plot.resize?.disconnect(); plots.clear();
    pageRoot('temperature').innerHTML = heading('看走势，也看参与面。', '曲线取自已保存的日终数据。可添加已有曲线、缩放时间区间，或横向拖动复盘。') +
      `<div class="mp-snapshot">${esc(MARKETS[state.market][0])} · 指数截至 ${esc(latestPrice?.date || '未返回')} · 广度截至 ${esc(latestBreadth?.date || '未返回')}<small>${esc(d.index?.name || '指数')} 与 ${esc(d.breadth?.scope || '该市场统计范围尚未接入')}，成分范围可能不同。</small></div>` +
      `<div class="mp-environment-top"><div><span>最后保存的价格</span><strong>${num(latestPrice?.value)}</strong><small>${esc(state.market === 'BTC' ? 'USD' : '指数点')} · ${esc(latestPrice?.date || '无数据')}</small></div><div><span>最后有效上涨占比</span><strong>${finite(latestBreadth?.up_pct) ? num(latestBreadth.up_pct, 1) + '%' : '—'}</strong><small>${finite(latestBreadth?.eligible) ? num(latestBreadth.eligible, 0) + ' 个有效样本' : '样本待取得'}</small></div></div>` +
      `<section class="mp-curve-picker"><div class="mp-card-head"><h2>添加 / 移除曲线</h2><span>不同单位分图显示</span></div><div class="mp-curve-options">${specs.map(s => `<label class="${hasPanelData(s) ? '' : 'mp-disabled'}"><input type="checkbox" data-mp-curve="${s.id}" ${state.curves.has(s.id) && hasPanelData(s) ? 'checked' : ''} ${hasPanelData(s) ? '' : 'disabled'}><span>${esc(s.title)}${hasPanelData(s) ? '' : '<small>暂不可用</small>'}</span></label>`).join('')}</div><label class="mp-overlay-check"><input type="checkbox" id="mpIndexOverlay" ${state.overlay ? 'checked' : ''}>在指标图叠加大盘走势（右轴，归一涨跌幅）</label><p class="mp-note">左轴读指标，右轴读金线涨跌幅；两条线相交没有买卖含义。每图可独立缩放、横拖；点图查看对应日期数值。</p></section>` +
      `<div class="mp-plot-grid">${supported.filter(s => state.curves.has(s.id)).map(s => `<article class="mp-chart-card" data-mp-chart="${s.id}"><div class="mp-card-head"><h2>${esc(s.title)}</h2><span>${esc(s.tag)}</span></div><p class="mp-source">来源截至 ${esc((s.id==='price'?d.index:s.id==='pcr'?d.pcr:d.breadth)?.source_asof||'未返回')} · ${s.rows.filter(r=>s.series.some(k=>finite(r[k.key]))).length} 个有效观测日</p>${s.id === 'breadth' ? `<label class="mp-chart-extra"><input type="checkbox" id="mpBreadthMa" ${state.breadthMa ? 'checked' : ''}>同时显示 MA20 上方占比</label>` : ''}${s.id === 'pcr' ? `<label class="mp-chart-extra">统计范围与口径<select id="mpPcrSeries">${(d.pcr_series || []).map(p => `<option value="${esc(p.id)}" ${p.id === state.pcr ? 'selected' : ''}>${esc(p.label)} · ${p.measure === 'oi' ? '持仓量' : '成交量'}</option>`).join('')}</select></label>` : ''}<div class="mp-chart-tools"><span id="mpRange-${s.id}"></span><div><button type="button" data-mp-zoom="${s.id}" data-mp-scale="0.65" aria-label="放大${esc(s.title)}时间区间">＋</button><button type="button" data-mp-zoom="${s.id}" data-mp-scale="1.5" aria-label="缩小${esc(s.title)}时间区间">−</button><button type="button" data-mp-reset="${s.id}">重置</button></div></div><div class="mp-plot-legend" id="mpLegend-${s.id}"></div><canvas id="mpPlot-${s.id}" tabindex="0" aria-label="${esc(s.title)}历史时间曲线；左右方向键查看数值，横向拖动查看日期"></canvas><div id="mpReadout-${s.id}" class="mp-plot-readout" aria-live="polite"></div><p id="mpCompare-${s.id}" class="mp-note"></p><details class="mp-explain"><summary>这条线怎么看？</summary><p>${esc(s.explanation)}</p><p>统计范围：${esc((s.id==='price'?d.index:s.id==='pcr'?d.pcr:d.breadth)?.scope||'详见数据口径')}</p></details></article>`).join('') || '<p class="mp-empty">还没有选择可用曲线。勾选上方曲线即可添加。</p>'}</div>` +
      (unsupported.length ? `<details class="mp-notes mp-gaps" open><summary>尚未绘制的指标 · 缺口说明</summary>${unsupported.map(s => `<p><strong>${esc(s.title)}</strong>：${esc(s.reason)}</p>`).join('')}</details>` : '') +
      notesHTML([...(d.limitations || []), ...(d.notes || []), ...(d.breadth?.notes||[]), ...(d.pcr?.notes||[]), `来源：指数 ${d.index?.source || '未返回'}；广度 ${d.breadth?.source || '未返回'}；期权 ${d.pcr?.source || '未返回'}。`, '各曲线只按同一个交易日期对齐，不填补缺值，也不把之后的指数价格移动到之前。', '以上都是历史环境观察，未加入当前买卖信号和等级计算。']);
    for (const panel of supported.filter(s => state.curves.has(s.id))) mountPlot(panel, d);
  }
  function plotPalette() {
    const p = window.PulseTheme?.palette?.() || {}, css = getComputedStyle(document.documentElement), color = (key, fallback) => css.getPropertyValue(key).trim() || fallback;
    const bg = /^#[0-9a-f]{6}$/i.test(p.background||'') ? p.background : '#f3f6fb', dark = parseInt(bg.slice(1,3),16)*.299+parseInt(bg.slice(3,5),16)*.587+parseInt(bg.slice(5,7),16)*.114<128;
    return {grid: p.line || p.grid || color('--line','#293b40'), muted: p.muted || color('--muted','#8fa9a8'), text:p.crosshair || p.text || color('--text','#c5d5cc'), gold:p.gold || color('--chart-gold',dark?'#e8b85a':'#b78120'), series:p.series || [p.accent || p.blue || color('--accent',color('--lime','#246bfd')),p.cyan || (dark?'#40c9d0':'#187d9c'),p.ma || p.purple || '#9a74cd',p.teal || (dark?'#58d4b0':'#288b6c')]};
  }
  function scheduleDraw(plot) { if(plot.queued)return; plot.queued=true; requestAnimationFrame(()=>{plot.queued=false;if(plot.canvas.isConnected)drawPlot(plot);}); }
  function mountPlot(panel, data) {
    const index = panel.id === 'price' || !state.overlay ? [] : data.index_series;
    const aligned = alignSeries(panel.rows, panel.series, index,typeof data.snapshot_at==='string'?data.snapshot_at.slice(0,10):null);
    const key = `${state.market}:${panel.id}:${panel.id === 'pcr' ? state.pcr : ''}`;
    const old = savedViews.get(key), canvas = byId('mpPlot-' + panel.id);
    const plot = {panel, canvas, rows: aligned.rows, key, view: old ? viewRange(aligned.rows.length, old.size, old.end) : viewRange(aligned.rows.length), hover: null, drag: null, geometry: null};
    plots.set(panel.id, plot);
    canvas.addEventListener('pointerdown', event => {
      if (plot.drag || event.isPrimary === false || (event.button != null && event.button !== 0)) return;
      plot.drag = {id: event.pointerId, x: event.clientX, y: event.clientY, view: {...plot.view}, axis: null};
      canvas.setPointerCapture?.(event.pointerId);
    });
    canvas.addEventListener('pointermove', event => {
      if (!plot.geometry || event.isPrimary === false || (plot.drag && plot.drag.id !== event.pointerId)) return;
      const dx = plot.drag ? event.clientX - plot.drag.x : 0, dy = plot.drag ? event.clientY - plot.drag.y : 0;
      if (plot.drag && !plot.drag.axis && Math.max(Math.abs(dx), Math.abs(dy)) > 10) plot.drag.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      // Once horizontal movement is established, keep following the same finger
      // through the origin; the threshold applies only when choosing an axis.
      if (plot.drag?.axis === 'x') {
        plot.view = panRange(plot.rows.length, plot.drag.view, dx, plot.geometry.right - plot.geometry.left); plot.hover = null; savedViews.set(key, plot.view);
      } else if (plot.drag?.axis === 'y') plot.hover = null;
      else plot.hover = pointerIndex(plot.view, event.clientX - canvas.getBoundingClientRect().left, plot.geometry.left, plot.geometry.right, plot.rows);
      scheduleDraw(plot);
    });
    canvas.addEventListener('pointerup', event => { if (!plot.drag || plot.drag.id !== event.pointerId) return; if (!plot.drag.axis && plot.geometry) plot.hover = pointerIndex(plot.view, event.clientX - canvas.getBoundingClientRect().left, plot.geometry.left, plot.geometry.right, plot.rows); plot.drag = null; scheduleDraw(plot); });
    canvas.addEventListener('pointercancel', event => { if (plot.drag?.id === event.pointerId) { plot.drag = null; plot.hover = null; scheduleDraw(plot); } });
    canvas.addEventListener('pointerleave', () => { if (!plot.drag) { plot.hover = null; scheduleDraw(plot); } });
    canvas.addEventListener('keydown', event => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); plot.hover = event.key === 'Home' ? plot.view.start : event.key === 'End' ? plot.view.end - 1 : Math.max(plot.view.start, Math.min(plot.view.end - 1, (plot.hover ?? plot.view.end - 1) + (event.key === 'ArrowRight' ? 1 : -1))); drawPlot(plot); });
    if ('ResizeObserver' in window) { plot.resize = new ResizeObserver(() => scheduleDraw(plot)); plot.resize.observe(canvas); }
    drawPlot(plot);
  }
  function domain(values, reference) {
    let lo = Math.min(...values), hi = Math.max(...values);
    if (finite(reference)) {lo = Math.min(lo, reference); hi = Math.max(hi, reference);}
    const padding = (hi - lo) * .12 || Math.max(Math.abs(hi) * .02, .1);
    return {lo: lo - padding, hi: hi + padding};
  }
  function drawPlot(plot) {
    const {panel, canvas, view} = plot, width = canvas.clientWidth, height = 265, colors = plotPalette();
    const seriesColor = s => panel.id==='price'?colors.gold:colors.series[s.key==='ma20_pct'||panel.id==='pcr'?1:panel.id==='trin'?2:panel.id==='ad'?3:0];
    if (!width || !view.size) return;
    const rows = plot.rows.slice(view.start, view.end).map(r => ({...r}));
    const common = rows.filter(r => panel.series.some(s => finite(r[s.key])) && finite(r.index_value));
    const base = common[0];
    for (const row of rows) row.index_pct = base && row.date >= base.date && finite(row.index_value) ? (row.index_value / base.index_value - 1) * 100 : null;
    const values = rows.flatMap(r => panel.series.map(s => r[s.key])).filter(finite), indexValues = rows.map(r => r.index_pct).filter(finite);
    const ratio = window.devicePixelRatio || 1; canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    const c = canvas.getContext('2d'); c.scale(ratio, ratio); c.clearRect(0, 0, width, height);
    const left = 47, right = width - (indexValues.length ? 52 : 18), top = 23, bottom = height - 28;
    plot.geometry = {left, right};
    const timeStart = validDate(rows[0].date), timeEnd = Math.max(timeStart + 86400000, validDate(rows.at(-1).date));
    const x = date => left + (validDate(date) - timeStart) / (timeEnd - timeStart) * (right - left);
    byId('mpRange-' + panel.id).textContent = `${rows[0].date} — ${rows.at(-1).date} · ${rows.length} 日`;
    if (!values.length) { c.fillStyle = colors.muted; c.font = '12px sans-serif'; c.fillText('这段日期没有有效观测值', 14, height / 2); c.fillText('可缩小或横拖查看其他日期', 14, height / 2 + 24); byId('mpReadout-' + panel.id).textContent = '当前窗口缺失，不按零值展示。'; byId('mpCompare-' + panel.id).textContent = '缺口保留为空，不用相邻日期回填。'; return; }
    const range = domain(values, panel.reference); if (panel.bounds) [range.lo, range.hi] = panel.bounds; else if (panel.unit === '倍') range.lo = Math.max(0, range.lo);
    const indexRange = indexValues.length ? domain(indexValues, 0) : null;
    const y = value => bottom - (value - range.lo) / (range.hi - range.lo) * (bottom - top);
    const iy = value => bottom - (value - indexRange.lo) / (indexRange.hi - indexRange.lo) * (bottom - top);
    c.font = '10px -apple-system,sans-serif'; c.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      const value = range.lo + (range.hi - range.lo) * i / 4, at = y(value);
      c.strokeStyle = colors.grid; c.beginPath(); c.moveTo(left, at); c.lineTo(right, at); c.stroke();
      c.fillStyle = colors.muted; c.textAlign = 'right'; c.fillText(num(value, Math.abs(value) >= 1000 ? 0 : 1), left - 6, at + 3);
      if (indexRange) { c.fillStyle = colors.gold; c.textAlign = 'left'; c.fillText(num(indexRange.lo + (indexRange.hi - indexRange.lo) * i / 4, 1) + '%', right + 6, at + 3); }
    }
    c.textAlign = 'left'; c.fillStyle = colors.muted; c.fillText(panel.unit + ' / 左轴', left, 12);
    if (indexRange) { c.fillStyle = colors.gold; c.textAlign = 'right'; c.fillText('走势 % / 右轴', right, 12); }
    if (finite(panel.reference)) { c.strokeStyle = colors.muted; c.setLineDash([3, 4]); c.beginPath(); c.moveTo(left, y(panel.reference)); c.lineTo(right, y(panel.reference)); c.stroke(); c.setLineDash([]); }
    function trace(key, color, project) {
      c.strokeStyle = color; c.fillStyle = color; c.lineWidth = key === 'index_pct' ? 1.8 : 2.1;
      for (const segment of lineSegments(rows, key)) { c.beginPath(); for (let i = 0; i < segment.length; i++) { const p = segment[i], px = x(rows[p.index].date), py = project(p.value); if (i) c.lineTo(px, py); else c.moveTo(px, py); } c.stroke(); if (segment.length === 1) { const p = segment[0]; c.beginPath(); c.arc(x(rows[p.index].date), project(p.value), 2.3, 0, Math.PI * 2); c.fill(); } }
    }
    panel.series.forEach(s => trace(s.key, seriesColor(s), y)); if (indexRange) trace('index_pct', colors.gold, iy);
    c.fillStyle = colors.muted; c.textAlign = 'center';
    for (const index of [...new Set([0, Math.floor((rows.length - 1) / 2), rows.length - 1])]) c.fillText(rows[index].date.slice(5), x(rows[index].date), height - 8);
    const selected = plot.hover === null ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, plot.hover - view.start)), row = rows[selected];
    if (plot.hover !== null) {
      c.strokeStyle = colors.text; c.setLineDash([3, 4]); c.beginPath(); c.moveTo(x(row.date), top); c.lineTo(x(row.date), bottom); c.stroke(); c.setLineDash([]);
      for (const s of panel.series) if (finite(row[s.key])) { c.fillStyle = seriesColor(s); c.beginPath(); c.arc(x(row.date), y(row[s.key]), 3, 0, Math.PI * 2); c.fill(); }
    }
    byId('mpLegend-' + panel.id).innerHTML = panel.series.map(s => `<span><i style="background:${seriesColor(s)}"></i>${esc(s.label)} · 左轴</span>`).join('') + (indexRange ? `<span><i style="background:${colors.gold}"></i>${esc(state.environment.index?.name || '大盘')} · 右轴</span>` : '');
    byId('mpReadout-' + panel.id).textContent = row.date + ' ｜ ' + panel.series.map(s => s.label + ' ' + num(row[s.key]) + (finite(row[s.key]) ? panel.unit : '')).join(' ｜ ') + (indexRange ? ' ｜ 大盘 ' + percent(row.index_pct) : '');
    byId('mpCompare-' + panel.id).textContent = panel.id === 'price' ? '实际日期之间按历史收盘连线；点图查看原始数值。' : indexRange ? `金线从本窗口共同起点 ${base.date} 归零，对齐 ${common.length} 日。缺失日期断线，不填入后续数据。` : '本窗口无可对齐的大盘数据，或已关闭叠加；仅展示原指标。';
  }
  function renderHelp() {
    const topics = [
      ['先分清三类数据', '主图与买卖点是已发布的历史快照；策略页是已经完成的冻结回测；A 股扩展档案是独立的历史价格备份。它们的覆盖范围和截止日期不同。档案不自动产生信号或回测成绩。'],
      ['买点、卖点和 S 级是什么意思？', '买点表示当时规则条件满足，卖点表示当时已有持仓应关注的退出条件。买入等级是条件质量，卖出等级是退出紧迫程度；S 不等于 95% 能盈利。每条信号要看确认时间、当时依据与保护计划。'],
      ['为什么确认后才执行？', '收盘才能确定的条件，最早在下一根开盘尝试执行。主图详情用当时参考价说明止盈止损；下一根实际开盘、滑点、手续费和成交限制只能在回测成交记录中体现，不能提前放进历史计划。'],
      ['止盈、止损和分批卖出', '参考保护计划按信号确认时的波动与规则固定。1R 是入场价到止损的风险距离；止盈和分批卖出的实际价格、数量以该方案逐笔记录为准。跳空、停牌、涨跌停与交易制度可能使止损无法按计划价执行。'],
      ['回测里的收益、回撤和胜率', '收益是模型账户净值变化；最大回撤是从阶段高点跌落的最大幅度；胜率只统计完整平仓交易。分批卖出仍按一次开仓计算一笔，未平仓不算盈利交易。检查费用、滑点、交易数量和样本量，不能只看一项。'],
      ['开发、验证和近期研究', '开发段用于探索，验证段和近期段用于对比规则；当前已知历史的回顾研究不等于真正未知未来的验证。近期段可能与原验证区间重叠，不能当作额外独立样本。不同币种账户也不能直接相加。'],
      ['MA：最近一段的均价', 'MA20 是最近 20 根收盘价的平均数，MA60 看更长一段。价格在均线上方只说明高于近期均价；它会滞后，在震荡中也可能反复穿越。'],
      ['MACD：趋势变化的速度', 'DIF 反映快慢指数均价的差，DEA 是 DIF 的平滑值。快线上穿慢线常称金叉，下穿常称死叉。交叉并不保证趋势延续，需结合价格结构、成交量与风险距离。'],
      ['KDJ、RSI 与布林带', 'KDJ 观察收盘在近期高低区间的位置；RSI 比较近期上涨和下跌幅度；布林带围绕均线观察波动范围。高位可能继续高、低位可能继续低，触及参考线不等于立即反转。'],
      ['ATR 与成交量', 'ATR 衡量包含跳空在内的典型波动幅度，不预测方向。成交量比较必须确保单位与价格口径一致；股、手或不同来源混用会产生假的“放量”。扩展 A 股档案的历史量单位尚未逐段核验。'],
      ['市场宽广度与 A/D', '上涨占比看有效样本里有多少股票上涨；MA20 上方占比看多少只高于各自近期均价；A/D 累计每日上涨与下跌家数之差。样本覆盖、缺失日期及是否包含 ETF 等证券，都影响曲线含义。'],
      ['阿姆士 TRIN', 'TRIN =（上涨家数 ÷ 下跌家数）÷（上涨股成交量 ÷ 下跌股成交量）。必须使用同市场、同范围、同单位的两组成交量；任一分母为零或来源不可靠时不计算。当前 A 股历史量单位未核验，因此不展示该曲线。'],
      ['期权 PCR', 'PCR = 认沽期权张数 ÷ 认购期权张数。成交量反映当日交易，持仓量反映尚未平仓的合约，不能混用。高 PCR 可能是避险或对冲；低 PCR 可能是方向押注，也可能来自其他策略。它不直接预测次日涨跌。'],
      ['叠加图怎么读？', '左轴是原指标，右轴金线是大盘从当前窗口共同起点以来的涨跌幅。比较同日是否同步变化，而不是看两线交点。缺失观测会断线；缩放或横拖改变窗口后，金线的归一起点也会更新。'],
      ['手机缓存与日期', '手机按需保存浏览过的快照。检查更新会读取新发布版本，不会把历史变成实时行情。离线只可看已保存内容；浏览器可能清理缓存。行情截止日期、来源统计日期与页面发布时刻必须分别理解。'],
    ];
    pageRoot('help').innerHTML = `<div class="mp-heading"><span class="eyebrow">READ BEFORE YOU ACT</span><h1>看懂曲线，再看结论。</h1><p>先看数据日期与范围，再读信号解释、风险距离和回测样本。手机版用于复盘。</p></div><div class="mp-help-intro"><strong>最先检查的三件事</strong><ol><li>这是哪个市场、什么币种、截至哪一天？</li><li>当前是价格、条件信号，还是回测实际成交？</li><li>缺失数据和样本限制是否影响这条结论？</li></ol></div><div class="mp-help-list">${topics.map(([title, body], index) => `<details ${index < 2 ? 'open' : ''}><summary><span>${String(index + 1).padStart(2, '0')}</span>${esc(title)}</summary><p>${esc(body)}</p></details>`).join('')}</div>`;
  }
  document.addEventListener('click', event => {
    if (!event.target.closest('.mp-page')) return;
    const market = event.target.closest('[data-mp-market]')?.dataset.mpMarket;
    if (market) { open(state.page, market); return; }
    if (event.target.closest('[data-mp-retry]')) { retryPage(); return; }
    if (event.target.closest('[data-mp-archive]') && state.page === 'sectors' && state.market === 'CN') { void loadArchiveLinks(); return; }
    const sector = event.target.closest('[data-mp-sector]')?.dataset.mpSector;
    if (sector) { state.sector = sector; state.listPage = 1; byId('mpSectorFilter').value = sector; renderCompanies(); byId('mpSectorFilter').scrollIntoView({behavior: 'smooth', block: 'center'}); return; }
    const page = event.target.closest('[data-mp-list-page]');
    if (page) { state.listPage = Number(page.dataset.mpListPage); renderCompanies(); return; }
    const zoom = event.target.closest('[data-mp-zoom]'), reset = event.target.closest('[data-mp-reset]');
    const plot = plots.get(zoom?.dataset.mpZoom || reset?.dataset.mpReset);
    if (plot) { plot.view = zoom ? zoomRange(plot.rows.length, plot.view, Number(zoom.dataset.mpScale), plot.hover === null ? .5 : (plot.hover - plot.view.start) / Math.max(1, plot.view.size - 1)) : viewRange(plot.rows.length); plot.hover = null; savedViews.set(plot.key, plot.view); drawPlot(plot); }
  });
  document.addEventListener('input', event => { if (event.target.id === 'mpCompanySearch') { state.query = event.target.value; state.listPage = 1; renderCompanies(); } if(event.target.id==='mpFundSearch'){ state.fundQuery = event.target.value; saveSectorBrowse(); byId('mpFundGroups').innerHTML=fundGroupsHTML(state.sectors,publicCoreCodes(),state.fundQuery); } });
  document.addEventListener('change', event => {
    const t = event.target;
    if (t.id === 'mpSectorFilter') { state.sector = t.value; state.listPage = 1; renderCompanies(); }
    if (t.id === 'mpCompanySort') { state.sort = t.value; state.listPage = 1; renderCompanies(); }
    if (t.dataset.mpCurve) { if (t.checked) state.curves.add(t.dataset.mpCurve); else state.curves.delete(t.dataset.mpCurve); renderEnvironment(); }
    if (t.id === 'mpIndexOverlay') { state.overlay = t.checked; renderEnvironment(); }
    if (t.id === 'mpBreadthMa') { state.breadthMa = t.checked; renderEnvironment(); }
    if (t.id === 'mpPcrSeries') { state.pcr = t.value; renderEnvironment(); }
  });
  window.addEventListener('pulse:page', event => { if (PAGE_IDS[event.detail?.page]) open(event.detail.page, event.detail.market); else { state.active = false; state.serial++; } });
  window.addEventListener('pulse:theme',()=>{for(const plot of plots.values())scheduleDraw(plot);});
  window.PulseMarketPages = {open};
}());
