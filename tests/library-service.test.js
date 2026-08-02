import test from "node:test";
import assert from "node:assert/strict";

import { SpotifyApiError } from "../src/js/spotify/api-client.js";
import {
  SpotifyLibraryService,
  normalizeLibraryEntry,
  normalizeLibraryPlaylist,
} from "../src/js/spotify/library-service.js";
import {
  formatCollectionDuration,
  formatTrackDuration,
} from "../src/js/ui/library.js";

const TRACK = {
  id: "track-1",
  uri: "spotify:track:track-1",
  type: "track",
  name: "Signal Path",
  artists: [{ name: "Static Bloom" }],
  album: { name: "Transmission", images: [{ url: "cover.jpg" }] },
  duration_ms: 180_000,
};

test("library sources include Liked Songs and classify owned, collaborative, and metadata-only playlists", async () => {
  const api = {
    async getCurrentUserProfile() { return { id: "me", display_name: "Listener" }; },
    async getSavedTracks() { return { total: 12, items: [], next: null }; },
    async getCurrentUserPlaylists() {
      return {
        items: [
          { id: "owned", name: "Mine", owner: { id: "me", display_name: "Listener" }, items: { total: 3 }, uri: "spotify:playlist:owned" },
          { id: "collab", name: "Together", owner: { id: "friend", display_name: "Friend" }, collaborative: true, items: { total: 4 }, uri: "spotify:playlist:collab" },
          { id: "generated", name: "On Repeat", owner: { id: "spotify", display_name: "Spotify" }, items: { total: 30 }, uri: "spotify:playlist:generated" },
          { id: null, name: "Unavailable mix", owner: { id: "spotify", display_name: "Spotify" } },
        ],
        next: null,
      };
    },
  };
  const service = new SpotifyLibraryService({ apiClient: api });
  const sources = await service.loadSources();
  assert.deepEqual(sources.map((source) => source.id), ["liked-songs", "owned", "collab", "generated", "unavailable-playlist-3"]);
  assert.equal(sources[0].total, 12);
  assert.equal(sources[1].canBrowse, true);
  assert.equal(sources[2].canBrowse, true);
  assert.equal(sources[3].canBrowse, false);
  assert.match(sources[3].unavailableReason, /metadata/u);
  assert.equal(sources[4].canBrowse, false);
  assert.match(sources[4].unavailableReason, /usable identifier/u);
});

test("library item normalization keeps unsupported rows visible but inert", () => {
  const playable = normalizeLibraryEntry({ item: TRACK }, 0);
  const local = normalizeLibraryEntry({ item: { ...TRACK, id: null, uri: "spotify:local:a:b:c:120" }, is_local: true }, 1);
  const episode = normalizeLibraryEntry({ item: { id: "ep", uri: "spotify:episode:ep", type: "episode", name: "Episode", duration_ms: 1_000 } }, 2);
  const missing = normalizeLibraryEntry({ item: null }, 3);
  assert.equal(playable.playable, true);
  assert.equal(local.playable, false);
  assert.match(local.unavailableReason, /Local files/u);
  assert.equal(episode.playable, false);
  assert.match(episode.unavailableReason, /Only songs/u);
  assert.equal(missing.playable, false);
});

test("playlist 403 becomes a stable metadata-only result", async () => {
  const source = normalizeLibraryPlaylist({
    id: "collab",
    name: "Maybe collaborative",
    collaborative: true,
    owner: { id: "friend" },
    items: { total: 5 },
  }, "me");
  const service = new SpotifyLibraryService({
    apiClient: {
      async getPlaylistItems() {
        throw new SpotifyApiError("Forbidden", { status: 403, code: "http_403" });
      },
    },
  });
  const page = await service.loadSourcePage(source);
  assert.equal(page.items.length, 0);
  assert.equal(source.canBrowse, false);
  assert.match(page.unavailableReason, /does not allow/u);
});

test("library source pages normalize current item fields and pagination", async () => {
  const service = new SpotifyLibraryService({
    apiClient: {
      async getSavedTracks() {
        return {
          items: [{ added_at: "2026-01-01", track: TRACK }],
          total: 2,
          next: "https://api.spotify.com/v1/me/tracks?offset=1&limit=1",
        };
      },
    },
  });
  const source = { id: "liked-songs", kind: "liked", canBrowse: true, total: 2 };
  const page = await service.loadSourcePage(source);
  assert.equal(page.items[0].title, "Signal Path");
  assert.equal(page.items[0].playable, true);
  assert.equal(page.nextOffset, 1);
});

test("full library loads follow every page and calculate exact collection duration", async () => {
  const offsets = [];
  const service = new SpotifyLibraryService({
    apiClient: {
      async getPlaylistItems(_id, { offset }) {
        offsets.push(offset);
        return offset === 0
          ? {
              items: [{ item: TRACK }],
              total: 2,
              next: "https://api.spotify.com/v1/playlists/p/items?offset=1&limit=1",
            }
          : {
              items: [{ item: { ...TRACK, id: "track-2", uri: "spotify:track:track-2", duration_ms: 90_500 } }],
              total: 2,
              next: null,
            };
      },
    },
  });
  const source = { id: "p", kind: "playlist", canBrowse: true, total: 2 };
  const progress = [];
  const result = await service.loadSource(source, {
    onProgress: (page) => progress.push(page.items.length),
  });

  assert.deepEqual(offsets, [0, 1]);
  assert.deepEqual(progress, [1, 2]);
  assert.equal(result.items.length, 2);
  assert.equal(result.durationMs, 270_500);
  assert.equal(result.complete, true);
  assert.equal(source.durationMs, 270_500);
});

test("library duration labels use stable player-style whole seconds", () => {
  assert.equal(formatTrackDuration(180_999), "3:00");
  assert.equal(formatCollectionDuration(2_161_999), "36 min 1 sec");
  assert.equal(formatCollectionDuration(7_380_000), "2 hr 3 min");
});
