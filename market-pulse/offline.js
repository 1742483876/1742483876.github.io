'use strict';
(function () {
  const MAX_VISITED = 96;
  const BATCH_SIZE = 12;

  function snapshotURL(path, base) {
    if (typeof path !== 'string') return null;
    try {
      const scope = new URL('./', base), url = new URL(path, scope);
      if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname + 'data/') || url.hash || url.username || url.password) return null;
      const relative = url.pathname.slice(scope.pathname.length);
      if (!/^data\/(?:catalog\.json|research\/catalog\.json|archive\/catalog\.json|signals\/recent\.json|archive\/charts\/(?:sh|sz|bj)[0-9]{6}\.json|charts\/[A-Za-z0-9_.-]+\/day\.json|research\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_-]+\.json)$/.test(relative)) return null;
      if ([...url.searchParams.keys()].some(k => k !== 'v') || url.searchParams.getAll('v').length > 1) return null;
      return url.href;
    } catch (_) { return null; }
  }

  // Track successful reads only. This bridges the first page load, whose fetches
  // may finish before a newly installed Service Worker can control the page.
  function createClient(env) {
    const visited = new Set(), confirmed = new Set(), attempted = new Set();
    let worker = null, started = false, flushing = false, unavailable = false;
    let onStatus = () => {}, failed = false;
    const online = () => env.navigator.onLine !== false;
    function status() {
      let text;
      if (!online()) text = '当前离线 · 仅能查看本机已保存的快照。';
      else if (unavailable) text = '此浏览器未启用离线缓存；联网时仍可正常查看。';
      else if (!worker) text = '正在准备本机快照缓存…';
      else if (failed) text = '页面可用；部分快照暂未保存，离线时可能无法打开。';
      else if (confirmed.size) text = '已启用快照缓存 · 同版本图表优先本机读取。';
      else text = '快照按需缓存 · 同版本图表优先本机读取。';
      onStatus(text);
    }
    function ask(target, urls) {
      return new Promise(resolve => {
        const channel = new env.MessageChannel();
        let done = false;
        const finish = value => {
          if (done) return;
          done = true;
          env.clearTimeout(timer);
          channel.port1.close();
          resolve(value);
        };
        const timer = env.setTimeout(() => finish(null), 10000);
        channel.port1.onmessage = event => {
          if (event.data?.type === 'PULSE_CACHE_VISITED_RESULT') finish(event.data);
        };
        try { target.postMessage({type: 'PULSE_CACHE_VISITED', urls}, [channel.port2]); }
        catch (_) { finish(null); }
      });
    }
    async function flush() {
      if (!worker || flushing || !online()) return;
      flushing = true;
      try {
        while (worker && online()) {
          const urls = [...visited].filter(url => !confirmed.has(url) && !attempted.has(url)).slice(0, BATCH_SIZE);
          if (!urls.length) break;
          urls.forEach(url => attempted.add(url));
          const reply = await ask(worker, urls);
          const cached = new Set(Array.isArray(reply?.cached) ? reply.cached : []);
          for (const url of urls) if (cached.has(url)) confirmed.add(url);
          failed = [...attempted].some(url => visited.has(url) && !confirmed.has(url));
          status();
        }
      } finally { flushing = false; }
    }
    function remember(path) {
      const url = snapshotURL(path, env.location.href);
      if (!url) return false;
      visited.delete(url);
      visited.add(url);
      while (visited.size > MAX_VISITED) {
        const oldest = visited.values().next().value;
        visited.delete(oldest); confirmed.delete(oldest); attempted.delete(oldest);
      }
      void flush();
      return true;
    }
    function useWorker(next) {
      if (!next || next === worker) return;
      worker = next;
      attempted.clear();
      status();
      void flush();
    }
    function start(options = {}) {
      onStatus = typeof options.onStatus === 'function' ? options.onStatus : onStatus;
      if (started) { status(); return; }
      started = true;
      const serviceWorker = env.navigator.serviceWorker;
      if (!serviceWorker || env.location.protocol !== 'https:' || !env.MessageChannel) {
        unavailable = true; status(); return;
      }
      env.addEventListener('offline', status);
      env.addEventListener('online', () => { attempted.clear(); failed = false; status(); void flush(); });
      serviceWorker.addEventListener('controllerchange', () => useWorker(serviceWorker.controller));
      status();
      serviceWorker.register('./sw.js', {scope: './'}).then(async registration => {
        // An active worker is sufficient for explicit caching even before it
        // has claimed this document. Readiness is not on the chart load path.
        useWorker(serviceWorker.controller || registration.active);
        const ready = await serviceWorker.ready;
        useWorker(serviceWorker.controller || ready.active);
      }).catch(() => { if (!worker) unavailable = true; status(); });
    }
    return {remember, start};
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = {snapshotURL, createClient};
  if (typeof window !== 'undefined') window.PulseOffline = createClient(window);
}());
