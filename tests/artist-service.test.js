import test from "node:test";
import assert from "node:assert/strict";

import {
  SpotifyArtistService,
  normalizeArtist,
  normalizeArtistRelease,
} from "../src/js/spotify/artist-service.js";

const ARTIST = {
  id: "Artist123",
  uri: "spotify:artist:Artist123",
  name: "Aster",
  images: [{ url: "https://i.scdn.co/image/artist" }],
  external_urls: { spotify: "https://open.spotify.com/artist/Artist123" },
  followers: { total: 12_345 },
  genres: ["dream pop"],
  popularity: 72,
};

function release(id, type = "album", overrides = {}) {
  return {
    id,
    uri: `spotify:album:${id}`,
    name: id,
    album_type: type,
    artists: [{ id: "Artist123", name: "Aster" }],
    images: [{ url: `https://i.scdn.co/image/${id}` }],
    release_date: "2026-07-24",
    total_tracks: type === "single" ? 1 : 9,
    external_urls: { spotify: `https://open.spotify.com/album/${id}` },
    ...overrides,
  };
}

test("artist and release metadata normalize for the detail page", () => {
  const artist = normalizeArtist(ARTIST);
  const album = normalizeArtistRelease(release("Album1"), 2);
  assert.equal(artist.name, "Aster");
  assert.equal(artist.followerCount, 12_345);
  assert.equal(artist.artworkUrl, "https://i.scdn.co/image/artist");
  assert.equal(album.artist, "Aster");
  assert.equal(album.releaseYear, "2026");
  assert.equal(album.browseable, true);
  assert.equal(album.position, 2);
});

test("artist service loads metadata, paginates releases, and removes duplicate IDs", async () => {
  const calls = [];
  const service = new SpotifyArtistService({
    apiClient: {
      async getArtist(id, options) {
        calls.push(["artist", id, options]);
        return ARTIST;
      },
      async getArtistAlbums(id, options) {
        calls.push(["albums", id, options]);
        if (options.offset === 0) {
          return {
            items: [release("Album1"), release("Single1", "single")],
            total: 4,
            next: "https://api.spotify.com/v1/artists/Artist123/albums?offset=2&limit=10",
          };
        }
        return {
          items: [release("Album1"), release("Album2")],
          total: 4,
          next: null,
        };
      },
    },
  });

  const result = await service.loadArtist("Artist123");
  assert.equal(calls[0][0], "artist");
  assert.equal(calls[1][0], "albums");
  assert.deepEqual(calls[1][2].includeGroups, ["album", "single"]);
  assert.equal(calls[2][2].offset, 2);
  assert.equal(result.releases.length, 3);
  assert.equal(result.albums.length, 2);
  assert.equal(result.singles.length, 1);
  assert.equal(result.artist.uri, "spotify:artist:Artist123");
});
