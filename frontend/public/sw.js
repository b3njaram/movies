// Only public application shell assets are cached. Never cache API responses,
// video, authentication, downloads, profiles, or watch history.
const NAME = 'streamhub-shell-v3';
const SHELL = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/offline.html', '/offline-store.js', '/offline-range.js'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(NAME).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/stream/')) return;
  if (url.pathname === '/offline.html' || url.pathname === '/offline-store.js' || url.pathname === '/offline-range.js') {
    event.respondWith(caches.match(request).then(cached => cached || fetch(request)));
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/')));
    return;
  }
  if (url.pathname.startsWith('/assets/') || /^\/(icon-\d+\.png|manifest\.webmanifest)$/.test(url.pathname)) {
    event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response.ok) { const copy = response.clone(); caches.open(NAME).then(cache => cache.put(request, copy)); }
      return response;
    })));
  }
});

// Push notifications contain a short, server-authored message. No API data or
// authorization secrets are cached or attached to the notification.
self.addEventListener('push',event=>{
  let data={};try{data=event.data?.json()||{};}catch{}
  event.waitUntil(self.registration.showNotification(String(data.title||'StreamHub').slice(0,120),{
    body:String(data.body||'Open StreamHub to see your updates.').slice(0,260),
    icon:'/icon-192.png',badge:'/icon-192.png',tag:'streamhub-'+String(data.kind||'update').slice(0,30),data:{url:'/'}
  }));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(clients=>{
    const existing=clients.find(c=>new URL(c.url).origin===self.location.origin);
    return existing?existing.focus():self.clients.openWindow('/');
  }));
});
