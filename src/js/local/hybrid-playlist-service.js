const DB_NAME = "spool-hybrid-playlists";
const DB_VERSION = 1;
const OVERLAYS = "overlays";
const LIKED_SOURCE_ID = "liked-songs";

export class HybridPlaylistService {
  constructor({ indexedDBImpl = globalThis.indexedDB, localLibrary } = {}) {
    if (!indexedDBImpl) throw new Error("IndexedDB is unavailable in this browser.");
    if (!localLibrary) throw new TypeError("HybridPlaylistService requires LocalLibraryService.");
    this.indexedDB = indexedDBImpl;
    this.localLibrary = localLibrary;
    this.db = null;
    this.opening = null;
    this.cache = new Map();
  }

  async open() {
    if (this.db) return this.db;
    if (this.opening) return this.opening;
    this.opening = new Promise((resolve, reject) => {
      const request = this.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(OVERLAYS)) {
          db.createObjectStore(OVERLAYS, { keyPath: "playlistId" });
        }
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        this.db.onversionchange = () => {
          this.db?.close();
          this.db = null;
          this.cache.clear();
        };
        resolve(this.db);
      };
    }).finally(() => { this.opening = null; });
    return this.opening;
  }

  async getOverlay(playlistId) {
    const id = normalizePlaylistId(playlistId);
    if (this.cache.has(id)) return clone(this.cache.get(id));
    const record = await this.#get(id) || emptyOverlay(id);
    this.cache.set(id, record);
    return clone(record);
  }

  async hasLocalTrack(playlistId, localId) {
    const overlay = await this.getOverlay(playlistId);
    return overlay.placements.some((placement) => placement.localId === localId);
  }

  async setLocalTrackMembership(playlistId, localId, shouldContain, { mergedItems } = {}) {
    const id = normalizePlaylistId(playlistId);
    const trackId = String(localId || "").trim();
    if (!trackId) throw new TypeError("A local track ID is required.");
    const exists = await this.localLibrary.getTrack(trackId, { withCover: false });
    if (!exists) throw new Error("That local song is no longer stored in Spool.");

    const overlay = await this.getOverlay(id);
    const already = overlay.placements.some((placement) => placement.localId === trackId);
    if (Boolean(shouldContain) === already) return already;

    if (!shouldContain) {
      overlay.placements = overlay.placements.filter((placement) => placement.localId !== trackId);
    } else if (Array.isArray(mergedItems) && mergedItems.length) {
      const next = [...mergedItems, localReference(trackId)];
      overlay.placements = placementsFromMerged(next);
    } else {
      overlay.placements.push({
        localId: trackId,
        beforeKey: null,
        afterKey: null,
        fallbackIndex: Number.MAX_SAFE_INTEGER,
        rank: overlay.placements.length,
      });
    }
    await this.#save({ ...overlay, updatedAt: Date.now() });
    return Boolean(shouldContain);
  }

  async setLiked(localId, liked) {
    return this.setLocalTrackMembership(LIKED_SOURCE_ID, localId, liked);
  }

  async isLiked(localId) {
    return this.hasLocalTrack(LIKED_SOURCE_ID, localId);
  }

  async mergeCollection(playlistId, spotifyItems = []) {
    const id = normalizePlaylistId(playlistId);
    const overlay = await this.getOverlay(id);
    const spotify = annotateSpotifyOccurrences(spotifyItems);
    const merged = [...spotify];
    const validPlacements = [];

    const placements = [...overlay.placements].sort((a, b) => (
      (Number(a.fallbackIndex) || 0) - (Number(b.fallbackIndex) || 0)
      || (Number(a.rank) || 0) - (Number(b.rank) || 0)
    ));
    for (const placement of placements) {
      const track = await this.localLibrary.getTrack(placement.localId);
      if (!track) continue;
      const entry = localEntry(track);
      const index = insertionIndex(merged, placement);
      merged.splice(index, 0, entry);
      validPlacements.push(placement);
    }

    if (validPlacements.length !== overlay.placements.length) {
      await this.#save({ ...overlay, placements: validPlacements, updatedAt: Date.now() });
    }
    return merged;
  }

  async saveMergedOrder(playlistId, mergedItems) {
    const id = normalizePlaylistId(playlistId);
    const record = {
      playlistId: id,
      placements: placementsFromMerged(mergedItems),
      updatedAt: Date.now(),
    };
    await this.#save(record);
    return clone(record);
  }

  async removeLocalTrackEverywhere(localId) {
    const id = String(localId || "").trim();
    if (!id) return 0;
    const overlays = await this.#getAll();
    let changed = 0;
    for (const overlay of overlays) {
      const placements = (overlay.placements || []).filter((placement) => placement.localId !== id);
      if (placements.length === (overlay.placements || []).length) continue;
      changed += 1;
      await this.#save({ ...overlay, placements, updatedAt: Date.now() });
    }
    return changed;
  }

  async deletePlaylist(playlistId) {
    const id = normalizePlaylistId(playlistId);
    this.cache.delete(id);
    await this.#transaction("readwrite", (store) => store.delete(id));
  }

  async clear() {
    this.cache.clear();
    await this.#transaction("readwrite", (store) => store.clear());
  }

  async #save(record) {
    const normalized = {
      playlistId: normalizePlaylistId(record.playlistId),
      placements: Array.isArray(record.placements) ? record.placements.map(normalizePlacement).filter(Boolean) : [],
      updatedAt: Number(record.updatedAt) || Date.now(),
    };
    await this.#transaction("readwrite", (store) => store.put(normalized));
    this.cache.set(normalized.playlistId, normalized);
    return normalized;
  }

  #get(playlistId) {
    return this.#transaction("readonly", (store) => store.get(playlistId));
  }

  #getAll() {
    return this.#transaction("readonly", (store) => store.getAll());
  }

  async #transaction(mode, operation) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(OVERLAYS, mode);
      const request = operation(transaction.objectStore(OVERLAYS));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      transaction.onabort = () => reject(transaction.error || new Error("Hybrid playlist transaction aborted."));
    });
  }
}

export function annotateSpotifyOccurrences(items = []) {
  const counts = new Map();
  return (items || []).map((entry, index) => {
    if (entry?.hybridKind === "local" || String(entry?.uri || "").startsWith("spool:local:")) return entry;
    const uri = String(entry?.uri || entry?.item?.uri || `missing:${index}`);
    const addedAt = String(entry?.addedAt || entry?.added_at || entry?.item?.addedAt || "");
    const addedBy = String(entry?.addedBy?.id || entry?.added_by?.id || entry?.item?.addedBy?.id || "");
    const occurrenceBase = `${uri}|${addedAt}|${addedBy}`;
    const ordinal = counts.get(occurrenceBase) || 0;
    counts.set(occurrenceBase, ordinal + 1);
    return {
      ...entry,
      hybridKind: "spotify",
      // URI alone is not enough because Spotify playlists may contain the same
      // track repeatedly. added_at/added_by keep most occurrences stable after
      // edits, while the ordinal remains a deterministic fallback.
      hybridKey: `spotify:${occurrenceBase}#${ordinal}`,
      spotifyPosition: Number.isInteger(entry?.position) ? entry.position : index,
    };
  });
}

export function placementsFromMerged(items = []) {
  const placements = [];
  const list = [...(items || [])];
  list.forEach((entry, index) => {
    if (!isLocalEntry(entry)) return;
    const previous = findSpotify(list, index, -1);
    const next = findSpotify(list, index, 1);
    const sameAnchorCount = placements.filter((placement) => (
      placement.beforeKey === next?.hybridKey && placement.afterKey === previous?.hybridKey
    )).length;
    placements.push({
      localId: entry.localId || localIdFromEntry(entry),
      beforeKey: next?.hybridKey || null,
      afterKey: previous?.hybridKey || null,
      fallbackIndex: index,
      rank: sameAnchorCount,
    });
  });
  return placements.filter((placement) => placement.localId);
}

export function localEntry(track) {
  return {
    ...track,
    key: `local:${track.id}`,
    localId: track.id,
    hybridKind: "local",
    hybridKey: `local:${track.id}`,
    item: { ...track, id: track.id, uri: track.uri, type: "track", isLocal: true },
    uri: track.uri,
    playable: true,
    isLocal: true,
    unavailableReason: null,
  };
}

export function isLocalEntry(entry) {
  return Boolean(entry?.hybridKind === "local" || entry?.isLocal || String(entry?.uri || "").startsWith("spool:local:"));
}

function localReference(localId) {
  return { localId, uri: `spool:local:${localId}`, hybridKind: "local", hybridKey: `local:${localId}`, isLocal: true };
}

function localIdFromEntry(entry) {
  return entry?.id || /^spool:local:(.+)$/u.exec(String(entry?.uri || ""))?.[1] || null;
}

function findSpotify(items, start, direction) {
  for (let index = start + direction; index >= 0 && index < items.length; index += direction) {
    const entry = items[index];
    if (!isLocalEntry(entry)) return entry;
  }
  return null;
}

function insertionIndex(merged, placement) {
  if (placement.beforeKey) {
    const before = merged.findIndex((entry) => entry.hybridKey === placement.beforeKey);
    if (before >= 0) return before;
  }
  if (placement.afterKey) {
    const after = merged.findIndex((entry) => entry.hybridKey === placement.afterKey);
    if (after >= 0) return after + 1 + siblingOffset(merged, after, placement.rank);
  }
  return Math.max(0, Math.min(merged.length, Number.isFinite(placement.fallbackIndex) ? placement.fallbackIndex : merged.length));
}

function siblingOffset(merged, anchorIndex, rank = 0) {
  let localCount = 0;
  for (let index = anchorIndex + 1; index < merged.length && isLocalEntry(merged[index]); index += 1) localCount += 1;
  return Math.min(localCount, Math.max(0, Number(rank) || 0));
}

function normalizePlacement(value) {
  const localId = String(value?.localId || "").trim();
  if (!localId) return null;
  return {
    localId,
    beforeKey: typeof value.beforeKey === "string" ? value.beforeKey : null,
    afterKey: typeof value.afterKey === "string" ? value.afterKey : null,
    fallbackIndex: Number.isFinite(Number(value.fallbackIndex)) ? Math.max(0, Number(value.fallbackIndex)) : Number.MAX_SAFE_INTEGER,
    rank: Number.isFinite(Number(value.rank)) ? Math.max(0, Number(value.rank)) : 0,
  };
}

function normalizePlaylistId(value) {
  const id = String(value || "").trim();
  if (!id) throw new TypeError("A playlist ID is required.");
  return id;
}

function emptyOverlay(playlistId) {
  return { playlistId, placements: [], updatedAt: 0 };
}

function clone(value) {
  return globalThis.structuredClone ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

export { LIKED_SOURCE_ID };
