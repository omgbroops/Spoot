import test from "node:test";
import assert from "node:assert/strict";

import { SpotifyApiError } from "../src/js/spotify/api-client.js";
import {
  normalizePlaylistDetail,
  SpotifyPlaylistService,
} from "../src/js/spotify/playlist-service.js";

const TRACK = {
  id: "track-1",
  uri: "spotify:track:track-1",
  type: "track",
  name: "Signal Path",
  artists: [{ id: "artist-1", name: "Static Bloom" }],
  album: {
    id: "album-1",
    uri: "spotify:album:album-1",
    name: "Transmission",
    images: [{ url: "cover.jpg" }],
  },
  duration_ms: 180_000,
  is_playable: true,
};

const PLAYLIST = {
  id: "playlist-1",
  uri: "spotify:playlist:playlist-1",
  name: "Glass Signals",
  description: "A playlist",
  images: [{ url: "playlist.jpg" }],
  owner: { id: "owner-1", display_name: "Spoot User" },
  public: true,
  collaborative: false,
  external_urls: { spotify: "https://open.spotify.com/playlist/playlist-1" },
  items: {
    items: [{ added_at: "2026-07-24T00:00:00Z", item: TRACK }],
    total: 2,
    next: "https://api.spotify.com/v1/playlists/playlist-1/items?offset=1&limit=50",
  },
};

test("playlist metadata normalizes for the shared catalog detail page", () => {
  assert.deepEqual(normalizePlaylistDetail(PLAYLIST), {
    id: "playlist-1",
    uri: "spotify:playlist:playlist-1",
    name: "Glass Signals",
    description: "A playlist",
    artworkUrl: "playlist.jpg",
    ownerId: "owner-1",
    ownerName: "Spoot User",
    public: true,
    collaborative: false,
    owned: false,
    editable: false,
    canModifyItems: false,
    total: 2,
    snapshotId: null,
    externalUrl: "https://open.spotify.com/playlist/playlist-1",
  });
});

test("playlist service consumes embedded items and paginates remaining songs", async () => {
  const calls = [];
  const service = new SpotifyPlaylistService({
    apiClient: {
      async getPlaylist(id) {
        calls.push(["playlist", id]);
        return PLAYLIST;
      },
      async getPlaylistItems(id, options) {
        calls.push(["items", id, options.offset]);
        return {
          items: [{ item: { ...TRACK, id: "track-2", uri: "spotify:track:track-2", name: "Afterimage" } }],
          total: 2,
          next: null,
        };
      },
    },
  });

  const result = await service.loadPlaylist("playlist-1");
  assert.deepEqual(calls, [["playlist", "playlist-1"], ["items", "playlist-1", 1]]);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].albumId, "album-1");
  assert.equal(result.durationMs, 360_000);
  assert.equal(result.unavailableReason, null);
});

test("development-mode 403 keeps a public playlist playable as metadata-only", async () => {
  const service = new SpotifyPlaylistService({
    apiClient: {
      async getPlaylist() {
        return {
          ...PLAYLIST,
          items: { items: [], total: 20, next: "https://api.spotify.com/v1/playlists/playlist-1/items?offset=0" },
        };
      },
      async getPlaylistItems() {
        throw new SpotifyApiError("Forbidden", { status: 403 });
      },
    },
  });

  const result = await service.loadPlaylist("playlist-1");
  assert.equal(result.playlist.uri, "spotify:playlist:playlist-1");
  assert.equal(result.items.length, 0);
  assert.match(result.unavailableReason, /Development Mode/u);
});
