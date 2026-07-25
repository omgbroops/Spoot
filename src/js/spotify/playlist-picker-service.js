import { SessionCache } from "../core/session-cache.js";
import { normalizeLibraryPlaylist } from "./library-service.js";

const PAGE_SIZE = 50;

export class SpotifyPlaylistPickerService {
  constructor({ apiClient, libraryService, hybridService, maxMembershipEntries = 800 } = {}) {
    if (!apiClient || !libraryService) {
      throw new TypeError("SpotifyPlaylistPickerService requires API and library services.");
    }
    this.apiClient = apiClient;
    this.libraryService = libraryService;
    this.hybridService = hybridService;
    this.memberships = new SessionCache({ maxEntries: maxMembershipEntries });
    this.pending = new Map();
    this.activeChecks = 0;
    this.waiters = [];
  }

  async loadDestinations({ force = false, signal } = {}) {
    const sources = await this.libraryService.loadSources({ force, signal });
    return sources.filter((source) => (
      source.kind === "liked" ||
      (source.kind === "playlist" && (source.owned || source.collaborative))
    ));
  }

  async membership(source, track, { force = false, signal } = {}) {
    const uri = assertPlayableTrackUri(track?.uri);
    const key = membershipKey(source, uri);
    if (!force) {
      const cached = this.memberships.get(key);
      if (typeof cached === "boolean") return cached;
      if (this.pending.has(key)) return this.pending.get(key);
    }

    const operation = this.#withPermit(async () => {
      if (isLocalUri(uri)) {
        if (!this.hybridService) return false;
        return this.hybridService.hasLocalTrack(source?.id || "liked-songs", localId(uri));
      }
      const trackId = track?.id || uri.split(":").pop();
      if (source?.kind === "liked") {
        const cachedLiked = this.libraryService.getCachedSource("liked-songs");
        if (cachedLiked?.complete) return cachedLiked.items.some((item) => item?.uri === uri);
        const response = await this.apiClient.checkSavedTracks([trackId], { signal });
        return Boolean(response?.[0]);
      }

      const cachedCollection = this.libraryService.getCachedSource(source?.id);
      if (cachedCollection?.complete) return cachedCollection.items.some((item) => item?.uri === uri);
      let offset = 0;
      while (offset !== null) {
        const page = await this.apiClient.getPlaylistItems(source.id, {
          limit: PAGE_SIZE,
          offset,
          additionalTypes: ["track", "episode"],
          signal,
        });
        const entries = page?.items ?? [];
        if (entries.some((entry) => (entry?.item || entry?.track || entry)?.uri === uri)) return true;
        offset = nextOffset(page, offset);
      }
      return false;
    }).then((value) => this.memberships.set(key, value));

    this.pending.set(key, operation);
    return operation.finally(() => {
      if (this.pending.get(key) === operation) this.pending.delete(key);
    });
  }

  async setMembership(source, track, shouldContain, { signal, mergedItems } = {}) {
    const uri = assertPlayableTrackUri(track?.uri);
    const desired = Boolean(shouldContain);
    if (isLocalUri(uri)) {
      if (!this.hybridService) throw new Error("Local playlist overlays are unavailable.");
      await this.hybridService.setLocalTrackMembership(
        source?.id || "liked-songs",
        localId(uri),
        desired,
        { mergedItems },
      );
      this.memberships.set(membershipKey(source, uri), desired);
      return desired;
    }

    const trackId = track?.id || uri.split(":").pop();
    if (source?.kind === "liked") {
      if (desired) await this.apiClient.saveTracks([trackId], { signal });
      else await this.apiClient.removeSavedTracks([trackId], { signal });
      this.libraryService.invalidateSource("liked-songs");
      updateCount(this.libraryService, source, desired ? 1 : -1);
    } else {
      if (!source?.id) throw new TypeError("A writable playlist is required.");
      if (desired) await this.apiClient.addPlaylistItems(source.id, [uri], { signal });
      else await this.apiClient.removePlaylistItems(source.id, [uri], { signal });
      this.libraryService.invalidateSource(source.id);
      updateCount(this.libraryService, source, desired ? 1 : -1);
    }
    this.memberships.set(membershipKey(source, uri), desired);
    return desired;
  }

  async createPlaylist(
    nameOrOptions,
    { isPublic = false, description = "Created in Spool", signal } = {},
  ) {
    const options = typeof nameOrOptions === "object"
      ? nameOrOptions
      : { name: nameOrOptions, public: isPublic, description };
    const payload = await this.apiClient.createPlaylist({
      name: options.name,
      public: Boolean(options.public),
      collaborative: false,
      description: options.description || "",
      signal: options.signal || signal,
    });
    const profileId = this.libraryService.profile?.id || payload?.owner?.id || null;
    const source = normalizeLibraryPlaylist(payload, profileId);
    if (!source?.id) throw new Error("Spotify returned an incomplete playlist.");
    source.canBrowse = true;
    source.owned = true;
    this.libraryService.addSource(source);
    return source;
  }

  invalidate(source, trackUri) {
    if (source && trackUri) this.memberships.delete(membershipKey(source, trackUri));
  }

  clear() {
    this.memberships.clear();
    this.pending.clear();
  }

  async #withPermit(operation) {
    if (this.activeChecks >= 2) await new Promise((resolve) => this.waiters.push(resolve));
    this.activeChecks += 1;
    try { return await operation(); }
    finally {
      this.activeChecks -= 1;
      this.waiters.shift()?.();
    }
  }
}

function updateCount(libraryService, source, delta) {
  if (Number.isFinite(source.total)) {
    libraryService.updateSource(source.id, { total: Math.max(0, source.total + delta) });
  }
}

function membershipKey(source, uri) {
  return `${source?.kind || "playlist"}:${source?.id || "liked-songs"}:${uri}`;
}

function assertPlayableTrackUri(uri) {
  if (typeof uri !== "string" || !/^(?:spotify:track|spool:local):[^:\s]+$/u.test(uri)) {
    throw new TypeError("Only Spotify or Spool local songs can be added to playlists.");
  }
  return uri;
}

function isLocalUri(uri) {
  return String(uri || "").startsWith("spool:local:");
}

function localId(uri) {
  return /^spool:local:(.+)$/u.exec(String(uri || ""))?.[1] || null;
}

function nextOffset(page, currentOffset) {
  if (!page?.next) return null;
  try {
    const parsed = Number(new URL(page.next).searchParams.get("offset"));
    if (Number.isInteger(parsed) && parsed >= 0) return parsed;
  } catch {}
  const count = Array.isArray(page?.items) ? page.items.length : 0;
  return count ? currentOffset + count : null;
}
