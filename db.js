const DB_NAME = 'worktime-pwa-db';
const DB_VERSION = 1;

const STORE_WORKDAYS = 'workdays';
const STORE_SETTINGS = 'settings';

function openDb(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if(!db.objectStoreNames.contains(STORE_WORKDAYS)){
        const ws = db.createObjectStore(STORE_WORKDAYS, { keyPath: 'date' });
        ws.createIndex('updatedAtMs', 'updatedAtMs', { unique: false });
        ws.createIndex('checkOutMs', 'checkOutMs', { unique: false });
      }
      if(!db.objectStoreNames.contains(STORE_SETTINGS)){
        db.createObjectStore(STORE_SETTINGS, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(storeName, mode, fn){
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const result = fn(store);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function getSettings(){
  return withStore(STORE_SETTINGS, 'readonly', (store) => new Promise((resolve, reject) => {
    const req = store.get('main');
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  }));
}

export async function putSettings(settings){
  return withStore(STORE_SETTINGS, 'readwrite', (store) => new Promise((resolve, reject) => {
    const req = store.put({ ...settings, id: 'main' });
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  }));
}

export async function getWorkDay(dateKey){
  return withStore(STORE_WORKDAYS, 'readonly', (store) => new Promise((resolve, reject) => {
    const req = store.get(dateKey);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  }));
}

export async function putWorkDay(record){
  return withStore(STORE_WORKDAYS, 'readwrite', (store) => new Promise((resolve, reject) => {
    const req = store.put(record);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  }));
}

export async function deleteWorkDay(dateKey){
  return withStore(STORE_WORKDAYS, 'readwrite', (store) => new Promise((resolve, reject) => {
    const req = store.delete(dateKey);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  }));
}

export async function listWorkDays(){
  return withStore(STORE_WORKDAYS, 'readonly', (store) => new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => {
      const rows = (req.result || []).slice();
      rows.sort((a,b) => (b.date || '').localeCompare(a.date || ''));
      resolve(rows);
    };
    req.onerror = () => reject(req.error);
  }));
}

export async function findOpenWorkDay(openDateKey){
  if(!openDateKey) return null;
  return getWorkDay(openDateKey);
}
