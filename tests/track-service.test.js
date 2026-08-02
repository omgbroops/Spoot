import test from "node:test";
import assert from "node:assert/strict";

import {
  SpotifyTrackService,
  normalizeTrackDetail,
} from "../src/js/spotify/track-service.js";

const TRACK = {
  id: "Track123",
  uri: "spotify:track:Track123",
  type: "track",
  name: "Ravepit",
  artists: [{ id: "Artist123", name: "Aster" }],
  duration_ms: 114_000,
  disc_number: 1,
  track_number: 1,
  is_playable: true,
  explicit: true,
  external_urls: { spotify: "https://open.spotify.com/track/Track123" },
  album: {
    id: "Single123",
    uri: "spotify:album:Single123",
    name: "Ravepit",
    album_type: "single",
    release_date: "2026-06-25",
    total_tracks: 1,
    images: [{ url: "https://i.scdn.co/image/single" }],
    external_urls: { spotify: "https://open.spotify.com/album/Single123" },
  },
};

test("track details preserve single-release metadata and playability", () => {
  const track = normalizeTrackDetail(TRACK);
  assert.equal(track.title, "Ravepit");
  assert.equal(track.artist, "Aster");
  assert.equal(track.playable, true);
  assert.equal(track.album.type, "single");
  assert.equal(track.album.releaseYear, "2026");
  assert.equal(track.album.artworkUrl, "https://i.scdn.co/image/single");
});

test("track service fetches one Spotify track and caches complete results", async () => {
  let calls = 0;
  const service = new SpotifyTrackService({
    apiClient: {
      async getTrack(id, options) {
        calls += 1;
        assert.equal(id, "Track123");
        assert.equal(options.market, "US");
        return TRACK;
      },
    },
  });

  const first = await service.loadTrack("Track123", { market: "US" });
  const second = await service.loadTrack("Track123", { market: "US" });
  assert.equal(first.track.album.id, "Single123");
  assert.equal(second.track.id, "Track123");
  assert.equal(calls, 1);
});
