export interface IndexedDbStateStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix?: string): Promise<Array<{ key: string; value: string }>>;
  clear(prefix?: string): Promise<void>;
}

const DB_NAME = "secure-messenger-web";
const STORE_NAME = "state";
const DB_VERSION = 1;

export function createIndexedDbStateStore(): IndexedDbStateStore {
  const api: IndexedDbStateStore = {
    async get(key: string): Promise<string | null> {
      const db = await openDb();
      return requestToPromise(db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key)).then((value) =>
        typeof value === "string" ? value : null,
      );
    },
    async set(key: string, value: string): Promise<void> {
      const db = await openDb();
      await requestToPromise(db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(value, key));
    },
    async delete(key: string): Promise<void> {
      const db = await openDb();
      await requestToPromise(db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).delete(key));
    },
    async list(prefix?: string): Promise<Array<{ key: string; value: string }>> {
      const db = await openDb();
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const cursorRequest = store.openCursor();

      return new Promise((resolve, reject) => {
        const items: Array<{ key: string; value: string }> = [];
        cursorRequest.onerror = () => reject(cursorRequest.error ?? new Error("indexeddb cursor failed"));
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) {
            resolve(items);
            return;
          }
          const key = String(cursor.key);
          const value = cursor.value;
          if (typeof value === "string" && (!prefix || key.startsWith(prefix))) {
            items.push({ key, value });
          }
          cursor.continue();
        };
      });
    },
    async clear(prefix?: string): Promise<void> {
      if (!prefix) {
        const db = await openDb();
        await requestToPromise(db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).clear());
        return;
      }
      const items = await api.list(prefix);
      for (const item of items) {
        await api.delete(item.key);
      }
    },
  };
  return api;
}

let openPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (openPromise) {
    return openPromise;
  }
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("indexeddb is unavailable"));
  }

  openPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error("failed to open indexeddb"));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
  });

  return openPromise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error ?? new Error("indexeddb request failed"));
    request.onsuccess = () => resolve(request.result);
  });
}
