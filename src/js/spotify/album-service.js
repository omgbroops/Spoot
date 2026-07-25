import { normalizePlaybackItem } from "./playback-state.js";
import { directPlaybackBlockReason } from "./playability.js";

const PAGE_SIZE = 50;

function firstImage(images) {
  return Array.isArray(images)
    ? images.find((image) => typeof image?.url === "string" && image.url)?.url ?? null
    : null;
}

function names(artists) {
  return Array.isArray(artists) ? artists.map((artist) => artist?.name).filter(Boolean) : [];
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

export function normalizeAlbum(album) {
  if (!album || typeof album !== "object") return null;
  const artistNames = names(album.artists);
  const artists = Array.isArray(album.artists)
    ? album.artists.filter((artist) => artist?.name).map((artist) => ({
        id: typeof artist.id === "string" ? artist.id : null,
        name: artist.name,
        uri: typeof artist.uri === "string" ? artist.uri : null,
      }))
    : [];
  return {
    id: typeof album.id === "string" ? album.id : null,
    uri: typeof album.uri === "string" ? album.uri : null,
    name: album.name || "Untitled album",
    type: album.album_type || "album",
    artists,
    artistNames,
    artist: artistNames.join(", ") || "Unknown artist",
    artworkUrl: firstImage(album.images),
    releaseDate: album.release_date || null,
    releaseYear: String(album.release_date || "").slice(0, 4) || null,
    totalTracks: Number.isFinite(album.total_tracks) ? album.total_tracks : null,
    externalUrl: album.external_urls?.spotify ?? null,
    label: album.label || null,
  };
}

export function normalizeAlbumTrack(track, album, position = 0) {
  if (!track || typeof track !== "object") return null;
  const hydrated = {
    ...track,
    album: {
      name: album?.name || "",
      images: album?.images || [],
    },
  };
  const item = normalizePlaybackItem(hydrated);
  if (!item) return null;
  const unavailableReason = directPlaybackBlockReason(item);
  return {
    ...item,
    position,
    discNumber: Number(track.disc_number) || 1,
    trackNumber: Number(track.track_number) || position + 1,
    playable: unavailableReason === null,
    unavailableReason,
  };
}

export class SpotifyAlbumService {
  constructor({ apiClient } = {}) {
    if (!apiClient?.getAlbum || !apiClient?.getAlbumTracks) {
      throw new TypeError("SpotifyAlbumService requires Spotify album API methods.");
    }
    this.apiClient = apiClient;
    this.cache = new Map();
  }

  async loadAlbum(albumId, { market, signal, force = false } = {}) {
    if (!force && !signal && this.cache.has(albumId)) return this.cache.get(albumId);
    const payload = await this.apiClient.getAlbum(albumId, { market, signal });
    const album = normalizeAlbum(payload);
    if (!album?.id || !album.uri) {
      throw new Error("Spotify returned an incomplete album.");
    }

    const rawTracks = [...(payload?.tracks?.items ?? [])];
    const total = payload?.tracks?.total ?? album.totalTracks ?? rawTracks.length;
    let offset = nextOffset(payload?.tracks, 0);
    if (offset === null && rawTracks.length < total) offset = rawTracks.length;

    while (offset !== null && offset < total) {
      const page = await this.apiClient.getAlbumTracks(album.id, {
        limit: PAGE_SIZE,
        offset,
        market,
        signal,
      });
      const pageItems = page?.items ?? [];
      rawTracks.push(...pageItems);
      const following = nextOffset(page, offset);
      offset = following === null && rawTracks.length < total && pageItems.length
        ? rawTracks.length
        : following;
      if (!pageItems.length) offset = null;
    }

    const tracks = rawTracks
      .map((track, position) => normalizeAlbumTrack(track, payload, position))
      .filter(Boolean);
    const result = {
      album: { ...album, totalTracks: total },
      tracks,
      total,
      durationMs: tracks.reduce((sum, track) => sum + (track.durationMs || 0), 0),
    };
    if (!signal) this.cache.set(album.id, result);
    return result;
  }
}
