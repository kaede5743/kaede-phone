// 同じ場所のファイルを入れておき、電波がなくても開けるようにする。ページを直したら CACHE の番号を上げる
const CACHE = 'kaede-phone-v13';
const FILES = ['./', 'index.html', 'app.js', 'proto.js', 'select.js', 'style.css', 'manifest.json', 'icon.svg'];

self.addEventListener('install', (e) => {
  // ブラウザの一時保存(GitHub Pages は 10 分)を通さずに取る。通すと直したばかりのページの代わりに古いものが入る
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// 先にネットを見て、だめならキャッシュ(直したページがすぐ届くように)。
// ネットはブラウザの一時保存を確かめ直して取る(no-cache)。そのまま取ると最大 10 分古いページが出る
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
