import { SessionCache } from "../core/session-cache.js";
import { SpotifyApiError } from "./api-client.js";
import { normalizeLibraryEntry } from "./library-service.js";

const PAGE_SIZE = 50;

function firstImage(images) {
  return Array.isArray(images)
    ? images.find((image) => typeof image?.url === "string" && image.url)?.url ?? null
    : null;
}

function nextOffset(page, fallbackOffset) {
  if (!page?.next) return null;
  try {
    const parsed = Number(new URL(page.next).searchParams.get("offset"));
    if (Number.isInteger(parsed) && parsed >= 0) return parsed;
  } catch {}
  const count = Array.isArray(page?.items) ? page.items.length : 0;
  return count ? fallbackOffset + count : null;
}

export function normalizePlaylistDetail(playlist, profileId = null) {
  if (!playlist || typeof playlist !== "object") return null;
  const ownerId = playlist.owner?.id ?? null;
  const owned = Boolean(profileId && ownerId === profileId);
  return {
    id: typeof playlist.id === "string" ? playlist.id : null,
    uri: typeof playlist.uri === "string" ? playlist.uri : null,
    name: playlist.name || "Untitled playlist",
    description: playlist.description || "",
    artworkUrl: firstImage(playlist.images),
    ownerId,
    ownerName: playlist.owner?.display_name || playlist.owner?.id || "Unknown owner",
    public: playlist.public ?? null,
    collaborative: Boolean(playlist.collaborative),
    owned,
    editable: owned,
    canModifyItems: owned || Boolean(playlist.collaborative),
    total: playlist.items?.total ?? playlist.tracks?.total ?? null,
    snapshotId: playlist.snapshot_id || null,
    externalUrl: playlist.external_urls?.spotify ?? null,
  };
}

export class SpotifyPlaylistService {
  constructor({ apiClient, profileProvider } = {}) {
    if (!apiClient?.getPlaylist || !apiClient?.getPlaylistItems) {
      throw new TypeError("SpotifyPlaylistService requires Spotify playlist API methods.");
    }
    this.apiClient = apiClient;
    this.profileProvider = profileProvider;
    this.cache = new SessionCache({ maxEntries: 6 });
  }

  async loadPlaylist(playlistId, { market, signal, force = false } = {}) {
    if (!force && this.cache.has(playlistId)) return this.cache.get(playlistId);
    const payload = await this.apiClient.getPlaylist(playlistId, { market, signal });
    const profileId = this.profileProvider?.()?.id || this.profileProvider?.()?.profile?.id || null;
    const playlist = normalizePlaylistDetail(payload, profileId);
    if (!playlist?.id || !playlist.uri) throw new Error("Spotify returned an incomplete playlist.");

    const rawItems = [...(payload?.items?.items ?? payload?.tracks?.items ?? [])];
    const pageRoot = payload?.items || payload?.tracks || null;
    const total = pageRoot?.total ?? playlist.total ?? rawItems.length;
    let offset = nextOffset(pageRoot, 0);
    if (offset === null && rawItems.length < total) offset = rawItems.length;
    let unavailableReason = null;

    try {
      while (offset !== null && offset < total) {
        const page = await this.apiClient.getPlaylistItems(playlist.id, {
          limit: PAGE_SIZE,
          offset,
          market,
          additionalTypes: ["track", "episode"],
          signal,
        });
        const pageItems = page?.items ?? [];
        rawItems.push(...pageItems);
        const following = nextOffset(page, offset);
        offset = following === null && rawItems.length < total && pageItems.length
          ? rawItems.length
          : following;
        if (!pageItems.length) offset = null;
      }
    } catch (error) {
      if (!(error instanceof SpotifyApiError) || error.status !== 403) throw error;
      unavailableReason = "Spotify lets Spool play this playlist, but Development Mode does not allow its song list to be read.";
    }

    const items = rawItems
      .map((entry, position) => ({ ...normalizeLibraryEntry(entry, position), position }))
      .filter(Boolean);
    const result = {
      playlist: { ...playlist, total },
      items,
      spotifyItems: items,
      total,
      durationMs: items.reduce((sum, item) => sum + (Number(item.durationMs) || 0), 0),
      unavailableReason,
    };
    this.cache.set(playlist.id, result);
    return result;
  }

  async updateDetails(playlistId, details, { signal } = {}) {
    await this.apiClient.changePlaylistDetails(playlistId, { ...details, signal });
    const cached = this.cache.get(playlistId);
    if (cached) {
      Object.assign(cached.playlist, {
        ...(details.name !== undefined ? { name: details.name } : {}),
        ...(details.description !== undefined ? { description: details.description } : {}),
        ...(details.public !== undefined ? { public: Boolean(details.public) } : {}),
      });
      this.cache.set(playlistId, cached);
    }
    return cached?.playlist || null;
  }

  async uploadCover(playlistId, base64Jpeg, { signal } = {}) {
    await this.apiClient.uploadPlaylistCover(playlistId, base64Jpeg, { signal });
    this.cache.delete(playlistId);
  }

  async reorder(playlistId, { rangeStart, insertBefore, rangeLength = 1, snapshotId, signal } = {}) {
    const response = await this.apiClient.reorderPlaylistItems(playlistId, {
      rangeStart,
      insertBefore,
      rangeLength,
      snapshotId,
      signal,
    });
    const cached = this.cache.get(playlistId);
    if (cached && response?.snapshot_id) cached.playlist.snapshotId = response.snapshot_id;
    this.cache.delete(playlistId);
    return response?.snapshot_id || null;
  }

  async removeItem(playlistId, entry, { snapshotId, signal } = {}) {
    if (!entry?.uri) throw new TypeError("A Spotify playlist item is required.");
    const response = await this.apiClient.removePlaylistItems(playlistId, [entry.uri], {
      snapshotId,
      positions: Number.isInteger(entry.spotifyPosition) ? [entry.spotifyPosition] : undefined,
      signal,
    });
    this.cache.delete(playlistId);
    return response?.snapshot_id || null;
  }

  invalidate(playlistId) {
    if (playlistId) this.cache.delete(playlistId);
  }
}
