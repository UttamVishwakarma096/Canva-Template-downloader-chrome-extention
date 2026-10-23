// Downloaded files wait in IndexedDB until they are packed into a ZIP.
// Used by the service worker and by the hidden ZIP page.
const DB_NAME = 'canva-bulk';
const STORE = 'files';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'jobId' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// fn gets the object store and returns a request; resolves with its result.
async function run(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => {
      db.close();
      resolve(req ? req.result : undefined);
    };
    tx.onerror = tx.onabort = () => {
      db.close();
      reject(tx.error);
    };
  });
}

// record: { jobId, name, blob, savedAt }
export const putFile = (record) => run('readwrite', (st) => st.put(record));
export const countFiles = () => run('readonly', (st) => st.count());
export const listFiles = (limit) => run('readonly', (st) => st.getAll(null, limit));
export const deleteFiles = (keys) =>
  run('readwrite', (st) => {
    keys.forEach((k) => st.delete(k));
    return null;
  });
