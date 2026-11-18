// IndexedDB 저장소: 작품(projects), 파트(parts), 도안 파일(files)
const DB_NAME = 'knit';
const DB_VERSION = 1;
let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('projects')) d.createObjectStore('projects', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('parts')) {
        d.createObjectStore('parts', { keyPath: 'id' }).createIndex('project', 'projectId');
      }
      if (!d.objectStoreNames.contains('files')) d.createObjectStore('files');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(store, mode, fn) {
  const d = await open();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    let out;
    if (req) req.onsuccess = () => { out = req.result; };
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const get = (store, key) => run(store, 'readonly', (s) => s.get(key));
export const put = (store, value, key) =>
  run(store, 'readwrite', (s) => (key === undefined ? s.put(value) : s.put(value, key)));
export const del = (store, key) => run(store, 'readwrite', (s) => s.delete(key));
export const all = (store) => run(store, 'readonly', (s) => s.getAll());
export const partsOf = async (projectId) => {
  const list = await run('parts', 'readonly', (s) => s.index('project').getAll(projectId));
  return (list || []).sort((a, b) => a.order - b.order);
};
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
