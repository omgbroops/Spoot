import { parseId3 } from "./id3.js";

const DB_NAME = "spool-local-media";
const DB_VERSION = 1;
const TRACKS = "tracks";
const AUDIO = "audio";
const COVERS = "covers";
const COVER_URL_LIMIT = 32;
const AUDIO_PATTERN = /(?:^audio\/|\.(?:mp3|m4a|flac|ogg|wav|aac|opus)$)/iu;

export class LocalLibraryService {
  constructor({ indexedDBImpl = globalThis.indexedDB } = {}) {
    if (!indexedDBImpl) throw new Error("IndexedDB is unavailable in this browser.");
    this.indexedDB = indexedDBImpl;
    this.db = null;
    this.opening = null;
    this.coverUrls = new Map();
  }

  async open() {
    if (this.db) return this.db;
    if (this.opening) return this.opening;
    this.opening = new Promise((resolve, reject) => {
      const request = this.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(TRACKS)) {
          const tracks = db.createObjectStore(TRACKS, { keyPath: "id" });
          tracks.createIndex("addedAt", "addedAt");
        }
        if (!db.objectStoreNames.contains(AUDIO)) db.createObjectStore(AUDIO);
        if (!db.objectStoreNames.contains(COVERS)) db.createObjectStore(COVERS);
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        this.db.onversionchange = () => {
          this.db?.close();
          this.db = null;
        };
        resolve(this.db);
      };
    }).finally(() => { this.opening = null; });
    return this.opening;
  }

  async importFiles(files, { source = "computer", onProgress } = {}) {
    const accepted = [...(files || [])].filter((file) => AUDIO_PATTERN.test(`${file.type || ""}${file.name || ""}`));
    const imported = [];
    for (let index = 0; index < accepted.length; index += 1) {
      const file = accepted[index];
      onProgress?.({ current: index + 1, total: accepted.length, name: file.name });
      imported.push(await this.importBlob(file, file.name, { source }));
    }
    return imported;
  }

  async importBlob(blob, filename, { source = "local" } = {}) {
    const buffer = await blob.arrayBuffer();
    let tags = {};
    try { tags = parseId3(buffer); } catch {}
    const id = globalThis.crypto?.randomUUID?.() || `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const baseName = String(filename || "Local song").replace(/\.[^.]+$/u, "");
    const durationMs = await readDuration(blob).catch(() => 0);
    const hasCover = Boolean(tags.picture?.bytes?.length > 100);
    const record = {
      id,
      uri: `spool:local:${id}`,
      type: "track",
      title: tags.title || baseName,
      artist: tags.artist || "Unknown artist",
      artistNames: [tags.artist || "Unknown artist"],
      artists: [{ id: null, name: tags.artist || "Unknown artist", uri: null }],
      albumName: tags.album || "Local Files",
      albumId: null,
      artworkUrl: null,
      durationMs,
      lyrics: tags.lyrics || "",
      isLocal: true,
      isPlayable: true,
      playable: true,
      source,
      filename: filename || baseName,
      mimeType: blob.type || "audio/mpeg",
      size: Number(blob.size) || 0,
      hasCover,
      addedAt: Date.now(),
    };
    await Promise.all([
      this.#put(TRACKS, record),
      this.#put(AUDIO, blob, id),
      hasCover
        ? this.#put(COVERS, new Blob([tags.picture.bytes], { type: tags.picture.mime || "image/jpeg" }), id)
        : Promise.resolve(),
    ]);
    return { ...record };
  }

  async listTracks({ coverLimit = 32 } = {}) {
    const records = await this.#getAll(TRACKS);
    records.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    let covers = 0;
    for (const track of records) {
      const existing = this.coverUrls.get(track.id);
      if (existing) {
        this.coverUrls.delete(track.id);
        this.coverUrls.set(track.id, existing);
        track.artworkUrl = existing;
        covers += 1;
        continue;
      }
      if (!track.hasCover || covers >= coverLimit || this.coverUrls.size >= coverLimit) continue;
      const blob = await this.getCoverBlob(track.id);
      if (!blob) continue;
      const url = URL.createObjectURL(blob);
      this.#rememberCoverUrl(track.id, url);
      track.artworkUrl = url;
      covers += 1;
    }
    return records;
  }

  async getTrack(id, { withCover = true } = {}) {
    const record = await this.#get(TRACKS, id);
    if (!record) return null;
    if (withCover && record.hasCover) {
      let url = this.coverUrls.get(id);
      if (url) {
        this.coverUrls.delete(id);
        this.coverUrls.set(id, url);
      } else {
        const cover = await this.getCoverBlob(id);
        if (cover) {
          url = URL.createObjectURL(cover);
          this.#rememberCoverUrl(id, url);
        }
      }
      record.artworkUrl = url || null;
    }
    return record;
  }

  getAudioBlob(id) {
    return this.#get(AUDIO, id);
  }

  getCoverBlob(id) {
    return this.#get(COVERS, id);
  }

  async updateDuration(id, durationMs) {
    const record = await this.#get(TRACKS, id);
    if (!record) return;
    record.durationMs = Math.max(0, Number(durationMs) || 0);
    await this.#put(TRACKS, record);
  }

  async deleteTrack(id) {
    const url = this.coverUrls.get(id);
    if (url) URL.revokeObjectURL(url);
    this.coverUrls.delete(id);
    await Promise.all([
      this.#delete(TRACKS, id),
      this.#delete(AUDIO, id),
      this.#delete(COVERS, id),
    ]);
  }

  async clear() {
    this.#releaseCoverUrls();
    await Promise.all([this.#clear(TRACKS), this.#clear(AUDIO), this.#clear(COVERS)]);
  }

  close() {
    this.#releaseCoverUrls();
    this.db?.close();
    this.db = null;
  }

  async #transaction(store, mode, operation) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(store, mode);
      const request = operation(transaction.objectStore(store));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted."));
    });
  }

  #put(store, value, key) { return this.#transaction(store, "readwrite", (objectStore) => key === undefined ? objectStore.put(value) : objectStore.put(value, key)); }
  #get(store, key) { return this.#transaction(store, "readonly", (objectStore) => objectStore.get(key)); }
  #getAll(store) { return this.#transaction(store, "readonly", (objectStore) => objectStore.getAll()); }
  #delete(store, key) { return this.#transaction(store, "readwrite", (objectStore) => objectStore.delete(key)); }
  #clear(store) { return this.#transaction(store, "readwrite", (objectStore) => objectStore.clear()); }

  #rememberCoverUrl(id, url) {
    const existing = this.coverUrls.get(id);
    if (existing && existing !== url) URL.revokeObjectURL(existing);
    this.coverUrls.delete(id);
    this.coverUrls.set(id, url);
    while (this.coverUrls.size > COVER_URL_LIMIT) {
      const oldestId = this.coverUrls.keys().next().value;
      const oldestUrl = this.coverUrls.get(oldestId);
      if (oldestUrl) URL.revokeObjectURL(oldestUrl);
      this.coverUrls.delete(oldestId);
    }
  }

  #releaseCoverUrls() {
    for (const url of this.coverUrls.values()) URL.revokeObjectURL(url);
    this.coverUrls.clear();
  }
}

export function localSource(tracks = []) {
  return {
    id: "local-files",
    kind: "local",
    name: "Local Files",
    description: "Music stored in this browser",
    ownerName: "Spool",
    artworkUrl: tracks.find((track) => track.artworkUrl)?.artworkUrl || null,
    externalUrl: null,
    uri: null,
    total: tracks.length,
    canBrowse: true,
    owned: true,
    collaborative: false,
    public: false,
    local: true,
  };
}

function readDuration(blob) {
  if (typeof Audio !== "function" || typeof URL?.createObjectURL !== "function") return Promise.resolve(0);
  const url = URL.createObjectURL(blob);
  const audio = new Audio();
  audio.preload = "metadata";
  return new Promise((resolve) => {
    const done = (value) => {
      clearTimeout(timeout);
      audio.removeAttribute("src");
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(value) ? Math.round(value * 1000) : 0);
    };
    const timeout = setTimeout(() => done(0), 8000);
    audio.onloadedmetadata = () => done(audio.duration);
    audio.onerror = () => done(0);
    audio.src = url;
  });
}
