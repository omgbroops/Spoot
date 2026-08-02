const DB_NAME = "spool-lyrics";
const DB_VERSION = 1;
const STORE = "lyrics";

export class LyricsStore {
  constructor({ indexedDBImpl = globalThis.indexedDB } = {}) {
    this.indexedDB = indexedDBImpl;
    this.db = null;
    this.opening = null;
    this.memoryFallback = new Map();
  }

  async open() {
    if (!this.indexedDB) return null;
    if (this.db) return this.db;
    if (this.opening) return this.opening;
    this.opening = new Promise((resolve, reject) => {
      const request = this.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "key" });
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        this.db.onversionchange = () => { this.db?.close(); this.db = null; };
        resolve(this.db);
      };
    }).finally(() => { this.opening = null; });
    return this.opening;
  }

  async get(key) {
    const normalized = String(key || "");
    if (!normalized) return null;
    if (!this.indexedDB) return clone(this.memoryFallback.get(normalized) || null);
    return this.#transaction("readonly", (store) => store.get(normalized));
  }

  async put(record) {
    const normalized = normalizeRecord(record);
    if (!this.indexedDB) {
      this.memoryFallback.set(normalized.key, normalized);
      return clone(normalized);
    }
    await this.#transaction("readwrite", (store) => store.put(normalized));
    return clone(normalized);
  }

  async delete(key) {
    const normalized = String(key || "");
    if (!normalized) return;
    this.memoryFallback.delete(normalized);
    if (!this.indexedDB) return;
    await this.#transaction("readwrite", (store) => store.delete(normalized));
  }

  async clear() {
    this.memoryFallback.clear();
    if (!this.indexedDB) return;
    await this.#transaction("readwrite", (store) => store.clear());
  }

  async #transaction(mode, operation) {
    const db = await this.open();
    if (!db) return null;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = operation(transaction.objectStore(STORE));
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
      transaction.onabort = () => reject(transaction.error || new Error("Lyrics transaction aborted."));
    });
  }
}

export function lyricsRecordKey(track) {
  if (track?.isLocal || String(track?.uri || "").startsWith("spool:local:")) {
    const id = track?.localId || track?.id || String(track?.uri || "").split(":").pop();
    return id ? `local:${id}` : null;
  }
  const id = track?.id || /^spotify:track:([^:]+)$/u.exec(String(track?.uri || ""))?.[1];
  if (id) return `spotify:${id}`;
  const title = String(track?.title || track?.name || "").trim();
  const artist = String(track?.artist || track?.artistNames?.join(", ") || "").trim();
  return title ? `meta:${title}|${artist}|${Number(track?.durationMs) || 0}` : null;
}

function normalizeRecord(record) {
  const key = String(record?.key || "").trim();
  if (!key) throw new TypeError("A lyrics record key is required.");
  return {
    key,
    text: String(record?.text || ""),
    source: ["manual", "embedded", "lrclib", "none"].includes(record?.source) ? record.source : "manual",
    userModified: Boolean(record?.userModified),
    autoFetchAttempted: Boolean(record?.autoFetchAttempted),
    lrclibResultId: record?.lrclibResultId == null ? null : String(record.lrclibResultId),
    instrumental: Boolean(record?.instrumental),
    updatedAt: Number(record?.updatedAt) || Date.now(),
  };
}

function clone(value) {
  if (value == null) return value;
  return globalThis.structuredClone ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}
