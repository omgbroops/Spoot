import { normalizePlaybackItem } from "./playback-state.js";

const SEARCH_TYPES = Object.freeze(["track", "album", "artist", "playlist"]);

function firstImage(images) {
  return Array.isArray(images)
    ? images.find((image) => typeof image?.url === "string" && image.url)?.url ?? null
    : null;
}

function artistNames(item) {
  return Array.isArray(item?.artists)
    ? item.artists.map((artist) => artist?.name).filter(Boolean).join(", ")
    : "";
}

function externalUrl(item) {
  return item?.external_urls?.spotify ?? null;
}

export function normalizeSearchResponse(payload) {
  const tracks = (payload?.tracks?.items ?? []).map((track, index) => {
    const item = normalizePlaybackItem(track);
    return item
      ? {
          id: item.id || `track-${index}`,
          type: "track",
          title: item.title,
          subtitle: item.artist || item.albumName || "Unknown artist",
          artworkUrl: item.artworkUrl,
          uri: item.uri,
          contextUri: track?.album?.uri ?? null,
          externalUrl: item.externalUrl,
          playable: Boolean(item.uri && item.isPlayable !== false && !item.isLocal),
        }
      : null;
  }).filter(Boolean);

  const albums = (payload?.albums?.items ?? []).filter(Boolean).map((album, index) => ({
    id: album.id || `album-${index}`,
    type: "album",
    title: album.name || "Untitled album",
    subtitle: [artistNames(album) || "Unknown artist", Number.isFinite(album.total_tracks)
      ? `${album.total_tracks} track${album.total_tracks === 1 ? "" : "s"}`
      : null].filter(Boolean).join(" · "),
    artworkUrl: firstImage(album.images),
    contextUri: album.uri ?? null,
    externalUrl: externalUrl(album),
    playable: Boolean(album.uri),
  }));

  const artists = (payload?.artists?.items ?? []).filter(Boolean).map((artist, index) => ({
    id: artist.id || `artist-${index}`,
    type: "artist",
    title: artist.name || "Unknown artist",
    subtitle: "Artist",
    artworkUrl: firstImage(artist.images),
    contextUri: artist.uri ?? null,
    externalUrl: externalUrl(artist),
    playable: Boolean(artist.uri),
  }));

  const playlists = (payload?.playlists?.items ?? []).map((playlist, index) => {
    if (!playlist || typeof playlist !== "object") {
      return {
        id: `playlist-unavailable-${index}`,
        type: "playlist",
        title: "Unavailable playlist",
        subtitle: "Spotify did not return metadata",
        artworkUrl: null,
        contextUri: null,
        externalUrl: null,
        playable: false,
      };
    }
    const total = playlist.items?.total ?? playlist.tracks?.total;
    return {
      id: playlist.id || `playlist-${index}`,
      type: "playlist",
      title: playlist.name || "Untitled playlist",
      subtitle: [playlist.owner?.display_name || playlist.owner?.id, Number.isFinite(total)
        ? `${total} song${total === 1 ? "" : "s"}`
        : null].filter(Boolean).join(" · ") || "Playlist",
      artworkUrl: firstImage(playlist.images),
      contextUri: playlist.uri ?? null,
      externalUrl: externalUrl(playlist),
      playable: Boolean(playlist.uri),
    };
  });

  return {
    tracks,
    artists,
    albums,
    playlists,
    total: tracks.length + artists.length + albums.length + playlists.length,
  };
}

export class SpotifySearchService {
  constructor({ apiClient } = {}) {
    if (!apiClient) throw new TypeError("SpotifySearchService requires an API client.");
    this.apiClient = apiClient;
  }

  async search(query, { signal } = {}) {
    const normalizedQuery = String(query || "").trim();
    if (!normalizedQuery) return normalizeSearchResponse(null);
    const response = await this.apiClient.search(normalizedQuery, {
      types: [...SEARCH_TYPES],
      limit: 10,
      signal,
    });
    return normalizeSearchResponse(response);
  }
}
