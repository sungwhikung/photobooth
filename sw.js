'use strict';
/* 사진관 화면을 인터넷이 잠깐 끊겨도 열 수 있게 저장해 두는 서비스 워커.
   항상 인터넷에서 최신 파일을 먼저 받고, 실패할 때만 저장해 둔 파일을 씀. */
const CACHE = 'fourcut-20261101';
const CORE = ['./', './index.html', './booth.css', './booth.js', './qrcode.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('fourcut-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (/\/(download\.(html|js|css)|sw\.js)$/.test(url.pathname)) return;   // 휴대폰용 페이지는 건드리지 않음
    e.respondWith(networkFirst(req));
  } else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(cacheFirst(req));
  }
});
async function networkFirst(req){
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req, {cache: 'no-cache'});
    if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch (err) {
    const hit = await cache.match(req, {ignoreSearch: true});
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const page = await cache.match('./index.html') || await cache.match('./');
      if (page) return page;
    }
    throw err;
  }
}
async function cacheFirst(req){
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()).catch(() => {});
  return res;
}
