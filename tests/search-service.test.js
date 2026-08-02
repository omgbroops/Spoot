import test from "node:test";
import assert from "node:assert/strict";

import {
  SpotifySearchService,
  normalizeSearchResponse,
} from "../src/js/spotify/search-service.js";

test("search normalization keeps playable catalog contexts and unavailable playlist rows", () => {
  const results = normalizeSearchResponse({
    tracks: {
      items: [{
        id: "track-1",
        uri: "spotify:track:track-1",
        type: "track",
        name: "Signal Path",
        artists: [{ name: "Static Bloom" }],
        album: {
          id: "album-1",
          name: "Transmission",
          uri: "spotify:album:album-1",
          images: [{ url: "cover.jpg" }],
        },
        duration_ms: 180_000,
        is_playable: true,
      }],
    },
    artists: { items: [{ id: "artist-1", uri: "spotify:artist:artist-1", name: "Static Bloom", images: [] }] },
    albums: { items: [{ id: "album-1", uri: "spotify:album:album-1", name: "Transmission", artists: [{ name: "Static Bloom" }], total_tracks: 9 }] },
    playlists: { items: [null, { id: "playlist-1", uri: "spotify:playlist:playlist-1", name: "Signals", owner: { display_name: "Listener" }, items: { total: 12 } }] },
  });

  assert.equal(results.total, 5);
  assert.equal(results.tracks[0].contextUri, "spotify:album:album-1");
  assert.equal(results.tracks[0].playable, true);
  assert.equal(results.tracks[0].browseable, true);
  assert.equal(results.tracks[0].albumId, "album-1");
  assert.equal(results.artists[0].contextUri, "spotify:artist:artist-1");
  assert.equal(results.artists[0].browseable, true);
  assert.match(results.albums[0].subtitle, /9 tracks/u);
  assert.equal(results.albums[0].browseable, true);
  assert.equal(results.playlists[0].playable, false);
  assert.equal(results.playlists[1].playable, true);
});

test("albums without a real Spotify ID remain visible but cannot open a fake page", () => {
  const results = normalizeSearchResponse({
    albums: { items: [{ name: "Metadata only", uri: null, artists: [] }] },
  });
  assert.equal(results.albums.length, 1);
  assert.equal(results.albums[0].browseable, false);
  assert.match(results.albums[0].id, /^album-unavailable-/u);
});

test("search service requests all supported Spool result groups with the current limit", async () => {
  let observed;
  const signal = new AbortController().signal;
  const service = new SpotifySearchService({
    apiClient: {
      async search(query, options) {
        observed = { query, options };
        return {};
      },
    },
  });

  const results = await service.search("  orbit  ", { signal });
  assert.equal(observed.query, "orbit");
  assert.deepEqual(observed.options.types, ["track", "album", "artist", "playlist"]);
  assert.equal(observed.options.limit, 10);
  assert.equal(observed.options.signal, signal);
  assert.equal(results.total, 0);
});
