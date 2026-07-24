import { SpotifyApiError } from "./api-client.js";
import { normalizePlaybackItem } from "./playback-state.js";
import { directPlaybackBlockReason } from "./playability.js";

const PAGE_SIZE = 50;

function sourceArtwork(images) {
  return Array.isArray(images)
    ? images.find((image) => typeof image?.url === "string" && image.url)?.url ?? null
    : null;
}

function playlistOwnerName(owner) {
  return owner?.display_name || (owner?.id === "spotify" ? "Spotify" : owner?.id) || "Unknown owner";
}

export function normalizeLibraryPlaylist(playlist, profileId, index = 0) {
  if (!playlist || typeof playlist !== "object" || typeof playlist.id !== "string" || !playlist.id) {
    const returned = playlist && typeof playlist === "object" ? playlist : {};
    return {
      id: `unavailable-playlist-${index}`,
      kind: "playlist",
      name: returned.name || "Unavailable playlist",
      description: returned.description || "",
      uri: returned.uri || null,
      externalUrl: returned.external_urls?.spotify ?? null,
      artworkUrl: sourceArtwork(returned.images),
      ownerId: returned.owner?.id ?? null,
      ownerName: playlistOwnerName(returned.owner),
      owned: false,
      collaborative: Boolean(returned.collaborative),
      public: returned.public ?? null,
      total: returned.items?.total ?? returned.tracks?.total ?? null,
      canBrowse: false,
      unavailableReason: "Spotify returned this playlist without a usable identifier.",
    };
  }
  const owned = Boolean(profileId && playlist.owner?.id === profileId);
  const collaborative = Boolean(playlist.collaborative);
  const canBrowse = owned || collaborative;
  return {
    id: playlist.id,
    kind: "playlist",
    name: playlist.name || "Untitled playlist",
    description: playlist.description || "",
    uri: playlist.uri || null,
    externalUrl: playlist.external_urls?.spotify ?? null,
    artworkUrl: sourceArtwork(playlist.images),
    ownerId: playlist.owner?.id ?? null,
    ownerName: playlistOwnerName(playlist.owner),
    owned,
    collaborative,
    public: playlist.public ?? null,
    total: playlist.items?.total ?? playlist.tracks?.total ?? null,
    canBrowse,
    unavailableReason: canBrowse
      ? null
      : "Spotify only exposes this playlist's metadata to development-mode apps.",
  };
}

export function normalizeLibraryEntry(entry, index = 0) {
  const rawItem = entry && Object.prototype.hasOwnProperty.call(entry, "item")
    ? entry.item
    : entry && Object.prototype.hasOwnProperty.call(entry, "track")
      ? entry.track
      : entry;
  const item = normalizePlaybackItem(rawItem);
  if (!item) {
    return {
      key: `missing-${index}`,
      item: null,
      title: "Unavailable item",
      artist: "Spotify no longer returns this item",
      playable: false,
      unavailableReason: "This item is no longer available.",
      addedAt: entry?.added_at ?? null,
    };
  }
  item.isLocal = Boolean(entry?.is_local || item.isLocal);
  const unavailableReason = directPlaybackBlockReason(item);
  return {
    key: item.id || item.uri || `item-${index}`,
    item,
    ...item,
    playable: unavailableReason === null,
    unavailableReason,
    addedAt: entry?.added_at ?? null,
    isLocal: item.isLocal,
  };
}

function nextOffset(page, currentOffset) {
  if (!page?.next) return null;
  const next = new URL(page.next);
  const parsed = Number(next.searchParams.get("offset"));
  return Number.isFinite(parsed)
    ? parsed
    : currentOffset + (Array.isArray(page.items) ? page.items.length : PAGE_SIZE);
}

export class SpotifyLibraryService {
  constructor({ apiClient } = {}) {
    if (!apiClient) throw new TypeError("SpotifyLibraryService requires an API client.");
    this.apiClient = apiClient;
    this.profile = null;
    this.sources = null;
  }

  async loadSources({ signal, force = false } = {}) {
    if (this.sources && !force) return this.sources;
    const [profile, likedPreview] = await Promise.all([
      this.apiClient.getCurrentUserProfile({ signal }),
      this.apiClient.getSavedTracks({ limit: 1, offset: 0, signal }),
    ]);
    this.profile = profile;

    const playlists = [];
    let offset = 0;
    do {
      const page = await this.apiClient.getCurrentUserPlaylists({
        limit: PAGE_SIZE,
        offset,
        signal,
      });
      playlists.push(...(page?.items ?? []));
      offset = nextOffset(page, offset);
    } while (offset !== null);

    this.sources = [
      {
        id: "liked-songs",
        kind: "liked",
        name: "Liked Songs",
        description: "Songs saved to your Spotify library",
        ownerName: profile?.display_name || "You",
        artworkUrl: null,
        externalUrl: "https://open.spotify.com/collection/tracks",
        total: likedPreview?.total ?? null,
        canBrowse: true,
        unavailableReason: null,
      },
      ...playlists
        .map((playlist, index) => normalizeLibraryPlaylist(playlist, profile?.id, index)),
    ];
    return this.sources;
  }

  async loadSourcePage(source, { offset = 0, signal } = {}) {
    if (!source?.canBrowse) {
      return {
        source,
        items: [],
        total: source?.total ?? 0,
        nextOffset: null,
        unavailableReason: source?.unavailableReason || "This playlist cannot be opened here.",
      };
    }

    try {
      const page = source.kind === "liked"
        ? await this.apiClient.getSavedTracks({ limit: PAGE_SIZE, offset, signal })
        : await this.apiClient.getPlaylistItems(source.id, {
            limit: PAGE_SIZE,
            offset,
            additionalTypes: ["track", "episode"],
            signal,
          });
      return {
        source,
        items: (page?.items ?? []).map((entry, index) =>
          normalizeLibraryEntry(entry, offset + index),
        ),
        total: page?.total ?? source.total ?? 0,
        nextOffset: nextOffset(page, offset),
        unavailableReason: null,
      };
    } catch (error) {
      if (error instanceof SpotifyApiError && error.status === 403) {
        source.canBrowse = false;
        source.unavailableReason = "Spotify returned this playlist's metadata but does not allow this app to read its songs.";
        return {
          source,
          items: [],
          total: source.total ?? 0,
          nextOffset: null,
          unavailableReason: source.unavailableReason,
        };
      }
      throw error;
    }
  }
}
