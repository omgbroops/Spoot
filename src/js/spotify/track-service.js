import { normalizePlaybackItem } from "./playback-state.js";
import { directPlaybackBlockReason } from "./playability.js";

function firstImage(images) {
  return Array.isArray(images)
    ? images.find((image) => typeof image?.url === "string" && image.url)?.url ?? null
    : null;
}

export function normalizeTrackDetail(track) {
  if (!track || typeof track !== "object") return null;
  const item = normalizePlaybackItem(track);
  if (!item) return null;
  const unavailableReason = directPlaybackBlockReason(item);
  const album = track.album || {};
  return {
    ...item,
    playable: unavailableReason === null,
    unavailableReason,
    explicit: Boolean(track.explicit),
    trackNumber: Number(track.track_number) || 1,
    discNumber: Number(track.disc_number) || 1,
    album: {
      id: typeof album.id === "string" ? album.id : null,
      uri: typeof album.uri === "string" ? album.uri : null,
      name: album.name || item.albumName || "Unknown release",
      type: album.album_type || "album",
      artworkUrl: firstImage(album.images) || item.artworkUrl,
      releaseDate: album.release_date || null,
      releaseYear: String(album.release_date || "").slice(0, 4) || null,
      totalTracks: Number.isFinite(album.total_tracks) ? album.total_tracks : null,
      externalUrl: album.external_urls?.spotify ?? null,
    },
  };
}

export class SpotifyTrackService {
  constructor({ apiClient } = {}) {
    if (!apiClient?.getTrack) {
      throw new TypeError("SpotifyTrackService requires the Spotify track API method.");
    }
    this.apiClient = apiClient;
    this.cache = new Map();
  }

  async loadTrack(trackId, { market, signal, force = false } = {}) {
    if (!force && !signal && this.cache.has(trackId)) return this.cache.get(trackId);
    const payload = await this.apiClient.getTrack(trackId, { market, signal });
    const track = normalizeTrackDetail(payload);
    if (!track?.id || !track.uri) {
      throw new Error("Spotify returned an incomplete track.");
    }
    const result = { track };
    if (!signal) this.cache.set(track.id, result);
    return result;
  }
}
