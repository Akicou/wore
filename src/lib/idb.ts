/*
  Minimal IndexedDB key/value store for large WoRe data (document HTML,
  source file bytes for PDFs/DOCX, generated images). Falls back to an
  in-memory map if IndexedDB is unavailable.
*/

const DB_NAME = "wore-db";
const STORE = "kv";
const VERSION = 1;

let dbp: Promise<IDBDatabase> | null = null;
const mem = new Map<string, any>();

function getDB(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

export async function idbGet<T = any>(key: string): Promise<T | undefined> {
  const db = await getDB();
  if (!db) return mem.get(key) as T | undefined;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

export async function idbSet(key: string, value: any): Promise<void> {
  const db = await getDB();
  if (!db) {
    mem.set(key, value);
    return;
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbDel(key: string): Promise<void> {
  const db = await getDB();
  if (!db) {
    mem.delete(key);
    return;
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
