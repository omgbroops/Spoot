import test from "node:test";
import assert from "node:assert/strict";

import {
  SpotifyAlbumService,
  normalizeAlbum,
  normalizeAlbumTrack,
} from "../src/js/spotify/album-service.js";

const ALBUM = {
  id: "Album123",
  uri: "spotify:album:Album123",
  name: "Quiet Machines",
  album_type: "album",
  artists: [{ id: "artist-1", name: "Aster" }],
  images: [{ url: "https://i.scdn.co/image/album" }],
  release_date: "2026-07-24",
  total_tracks: 3,
  external_urls: { spotify: "https://open.spotify.com/album/Album123" },
};

function track(id, number, overrides = {}) {
  return {
    id,
    uri: `spotify:track:${id}`,
    type: "track",
    name: `Track ${number}`,
    artists: [{ name: "Aster" }],
    disc_number: 1,
    track_number: number,
    duration_ms: number * 60_000,
    is_playable: true,
    ...overrides,
  };
}

test("album metadata and simplified tracks normalize into contextual playback rows", () => {
  const album = normalizeAlbum(ALBUM);
  const normalizedTrack = normalizeAlbumTrack(track("Track1", 1), ALBUM, 0);
  assert.equal(album.artist, "Aster");
  assert.equal(album.releaseYear, "2026");
  assert.equal(normalizedTrack.albumName, "Quiet Machines");
  assert.equal(normalizedTrack.artworkUrl, "https://i.scdn.co/image/album");
  assert.equal(normalizedTrack.position, 0);
  assert.equal(normalizedTrack.playable, true);

  const unavailable = normalizeAlbumTrack(
    track("Track2", 2, { is_playable: false }),
    ALBUM,
    1,
  );
  assert.equal(unavailable.playable, false);
  assert.match(unavailable.unavailableReason, /unavailable/u);
});

test("album service consumes embedded tracks then paginates the full album", async () => {
  const calls = [];
  const service = new SpotifyAlbumService({
    apiClient: {
      async getAlbum(id, options) {
        calls.push(["album", id, options]);
        return {
          ...ALBUM,
          tracks: {
            items: [track("Track1", 1), track("Track2", 2)],
            total: 3,
            next: "https://api.spotify.com/v1/albums/Album123/tracks?offset=2&limit=50",
          },
        };
      },
      async getAlbumTracks(id, options) {
        calls.push(["tracks", id, options]);
        return { items: [track("Track3", 3)], total: 3, next: null };
      },
    },
  });

  const result = await service.loadAlbum("Album123");
  assert.deepEqual(calls.map((call) => call[0]), ["album", "tracks"]);
  assert.equal(calls[1][2].offset, 2);
  assert.equal(result.tracks.length, 3);
  assert.equal(result.durationMs, 360_000);
  assert.equal(result.album.totalTracks, 3);
});
