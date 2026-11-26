// 앱 파일을 폰에 저장해 두고 인터넷 없이도 열리게 한다.
// 코드를 고친 뒤에는 scripts/bump.py로 버전을 올린다 (CHANGELOG.md 참고).
const VERSION = 'knit-1.29.2';
const ASSETS = [
  './', 'index.html', 'app.css', 'manifest.webmanifest',
  'js/core.js', 'js/db.js', 'js/main.js', 'js/model/backup.js', 'js/model/circ.js', 'js/model/knitting.js', 'js/model/labels.js',
  'js/model/progress.js', 'js/model/sizes.js', 'js/model/videos.js', 'js/partnav.js', 'js/pdf.js', 'js/sheets/dialogs.js', 'js/sheets/legend.js',
  'js/sheets/memo.js', 'js/sheets/pins.js', 'js/sheets/reps.js', 'js/sheets/videoui.js', 'js/ui.js', 'js/version.js', 'js/views/cal.js',
  'js/views/home.js', 'js/views/info.js', 'js/views/knit/chart.js', 'js/views/knit/circ.js', 'js/views/knit/index.js', 'js/views/knit/shell.js',
  'js/views/knit/text.js', 'js/views/project.js', 'js/widgets/chartview.js', 'js/widgets/rectpicker.js', 'js/widgets/stackview.js',
  'vendor/jsQR.min.js',
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
