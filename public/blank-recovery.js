// Last resort for a blank page: if the app's own code can't load, no code is running to say so. Drop the service
// worker and its file cache (never the local data, so nothing unsynced is lost) and try again, once a minute at most.
// A separate file (not inline in index.html) so the page's security policy can refuse inline scripts.
window.addEventListener(
  'error',
  function (e) {
    var el = e.target;
    if (!el || el.tagName !== 'SCRIPT' || document.getElementById('root').childNodes.length) return;
    try {
      var last = Number(sessionStorage.getItem('theranet:blank-recovery'));
      if (last && Date.now() - last < 60000) return;
      sessionStorage.setItem('theranet:blank-recovery', String(Date.now()));
    } catch { /* storage blocked: carry on */ }
    var sw = navigator.serviceWorker ? navigator.serviceWorker.getRegistrations() : Promise.resolve([]);
    sw.then(function (regs) { return Promise.all(regs.map(function (r) { return r.unregister(); })); })
      .then(function () { return window.caches ? caches.keys() : []; })
      .then(function (names) {
        return Promise.all(names.filter(function (n) { return n.indexOf('precache') !== -1; }).map(function (n) { return caches.delete(n); }));
      })
      .then(function () { location.reload(); });
  },
  true
);
