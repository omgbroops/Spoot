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

export function normalizePlaylistDetail(playlist) {
  if (!playlist || typeof playlist !== "object") return null;
  return {
    id: typeof playlist.id === "string" ? playlist.id : null,
    uri: typeof playlist.uri === "string" ? playlist.uri : null,
    name: playlist.name || "Untitled playlist",
    description: playlist.description || "",
    artworkUrl: firstImage(playlist.images),
    ownerId: playlist.owner?.id ?? null,
    ownerName: playlist.owner?.display_name || playlist.owner?.id || "Unknown owner",
    public: playlist.public ?? null,
    collaborative: Boolean(playlist.collaborative),
    total: playlist.items?.total ?? playlist.tracks?.total ?? null,
    externalUrl: playlist.external_urls?.spotify ?? null,
  };
}

export class SpotifyPlaylistService {
  constructor({ apiClient } = {}) {
    if (!apiClient?.getPlaylist || !apiClient?.getPlaylistItems) {
      throw new TypeError("SpotifyPlaylistService requires Spotify playlist API methods.");
    }
    this.apiClient = apiClient;
    this.cache = new Map();
  }

  async loadPlaylist(playlistId, { market, signal, force = false } = {}) {
    if (!force && !signal && this.cache.has(playlistId)) return this.cache.get(playlistId);
    const payload = await this.apiClient.getPlaylist(playlistId, { market, signal });
    const playlist = normalizePlaylistDetail(payload);
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
      total,
      durationMs: items.reduce((sum, item) => sum + (Number(item.durationMs) || 0), 0),
      unavailableReason,
    };
    if (!signal) this.cache.set(playlist.id, result);
    return result;
  }
}
