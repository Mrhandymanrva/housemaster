/* Service worker for the field app.
 *
 * Only the shell is cached — the HTML, the stylesheet, the script, the icons.
 * API responses are deliberately not cached here: the app already keeps its
 * own copy of the modules, choices and pick-lists in localStorage, and a
 * second stale copy behind it would be a second thing to reason about when a
 * tech says the form looks wrong.
 */
const VERSION = 'hm-field-v8';
const SHELL = [
  './', './index.html', './app.css', './app.js', './qa-guard.js',
  './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-180.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;              // submissions are the app's job, not the cache's
  if (url.pathname.startsWith('/api/')) return;        // always the network, so stale data cannot masquerade as fresh

  // Network first so a deploy reaches the phone, cache as the safety net.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match('./index.html')))
  );
});
