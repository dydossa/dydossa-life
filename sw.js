/* dydossa life: keeps the app shell on the phone so it opens instantly.
   Pages: network first (always the latest), cached copy when offline.
   Versioned files (?v=), the library, icons, fonts: from the cache, refreshed in the background.
   Supabase (data, photos, sign-in) is never touched here. */
var CACHE = 'dydossa-life-v1';

self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function put(req, res) {
  if (res && res.ok && (res.type === 'basic' || res.type === 'cors')) {
    var copy = res.clone();
    caches.open(CACHE).then(function (c) {
      c.put(req, copy);
      // a new ?v= of a file replaces the old one
      var u = new URL(req.url);
      if (u.searchParams.has('v')) c.keys().then(function (keys) {
        keys.forEach(function (k) { var ku = new URL(k.url); if (ku.pathname === u.pathname && ku.search !== u.search) c.delete(k); });
      });
    });
  }
  return res;
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  var same = url.origin === self.location.origin;
  var font = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!same && !font) return;

  if (same && (req.mode === 'navigate' || /\/$|\.html$/.test(url.pathname))) {
    e.respondWith(fetch(req).then(function (res) { return put(req, res); }).catch(function () {
      return caches.match(req).then(function (hit) { return hit || caches.match('./'); });
    }));
    return;
  }
  // everything else: answer from the cache at once, refresh it in the background
  e.respondWith(caches.match(req).then(function (hit) {
    var net = fetch(req).then(function (res) { return put(req, res); }).catch(function () { return hit; });
    return hit || net;
  }));
});
