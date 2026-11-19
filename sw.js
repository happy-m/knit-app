// 앱 파일을 폰에 저장해 두고 인터넷 없이도 열리게 한다.
// 코드를 고친 뒤에는 scripts/bump.py로 버전을 올린다 (CHANGELOG.md 참고).
const VERSION = 'knit-1.9.0';
const ASSETS = [
  './', 'index.html', 'app.css', 'manifest.webmanifest',
  'js/main.js', 'js/db.js', 'js/pdf.js', 'js/chartview.js', 'js/ui.js', 'js/knitting.js', 'js/backup.js',
  'vendor/pdf.min.mjs', 'vendor/pdf.worker.min.mjs',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 저장된 파일을 먼저 쓰고, 인터넷이 되면 뒤에서 새 파일로 바꿔 둔다
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const key = req.mode === 'navigate' ? 'index.html' : req;
      const hit = await cache.match(key, { ignoreSearch: true });
      const net = fetch(req).then((res) => {
        if (res.ok) cache.put(key, res.clone());
        return res;
      }).catch(() => null);
      return hit || (await net) || new Response('오프라인입니다', { status: 503 });
    })
  );
});
