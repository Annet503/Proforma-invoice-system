var CACHE = 'theomax-web-v2';
var FILES = ['./', './index.html', './styles.css', './app.js', './manifest.webmanifest', './icon.svg', './theomax-logo.bmp'];
self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(CACHE).then(function (cache) { return cache.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (keys) { return Promise.all(keys.filter(function (key) { return key !== CACHE; }).map(function (key) { return caches.delete(key); })); }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(request).then(function (response) {
    if (response.ok) { var copy = response.clone(); caches.open(CACHE).then(function (cache) { cache.put(request, copy); }); }
    return response;
  }).catch(function () { return caches.match(request).then(function (cached) { return cached || (request.mode === 'navigate' ? caches.match('./index.html') : Response.error()); }); }));
});
