import test from "node:test";
import assert from "node:assert/strict";

import {
  SpotifyApiClient,
  SpotifyApiError,
} from "../src/js/spotify/api-client.js";

function jsonResponse(payload, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

test("API client handles 204 responses and forwards AbortSignal", async () => {
  const controller = new AbortController();
  let observed;
  const client = new SpotifyApiClient({
    tokenProvider: async () => "access",
    fetchImpl: async (url, options) => {
      observed = { url, options };
      return new Response(null, { status: 204 });
    },
  });

  assert.equal(
    await client.pausePlayback({ deviceId: "device-1", signal: controller.signal }),
    null,
  );
  assert.equal(observed.options.signal, controller.signal);
  assert.equal(observed.options.method, "PUT");
  assert.match(observed.url, /me\/player\/pause\?device_id=device-1$/u);
});

test("API client invokes browser fetch with the global receiver", async () => {
  let observedReceiver;
  const client = new SpotifyApiClient({
    tokenProvider: async () => "access",
    fetchImpl: function () {
      observedReceiver = this;
      if (this !== globalThis) throw new TypeError("Illegal invocation");
      return Promise.resolve(jsonResponse({ is_playing: false }));
    },
  });

  assert.deepEqual(await client.getPlaybackState(), { is_playing: false });
  assert.equal(observedReceiver, globalThis);
});

test("API client retries a 401 exactly once with a forced fresh token", async () => {
  const tokenRequests = [];
  const requests = [];
  const client = new SpotifyApiClient({
    tokenProvider: async ({ forceRefresh }) => {
      tokenRequests.push(forceRefresh);
      return forceRefresh ? "fresh-token" : "stale-token";
    },
    fetchImpl: async (_url, options) => {
      requests.push(options.headers.get("Authorization"));
      return requests.length === 1
        ? jsonResponse({ error: { status: 401, message: "Expired" } }, { status: 401 })
        : jsonResponse({ is_playing: false });
    },
  });

  assert.deepEqual(await client.getPlaybackState(), { is_playing: false });
  assert.deepEqual(tokenRequests, [false, true]);
  assert.deepEqual(requests, ["Bearer stale-token", "Bearer fresh-token"]);
});

test("API client honors Retry-After once but never retries QUOTA_EXCEEDED", async () => {
  const sleeps = [];
  let requestCount = 0;
  const client = new SpotifyApiClient({
    tokenProvider: async () => "access",
    sleep: async (milliseconds) => sleeps.push(milliseconds),
    fetchImpl: async () => {
      requestCount += 1;
      return requestCount === 1
        ? jsonResponse(
            { error: { status: 429, message: "Slow down" } },
            { status: 429, headers: { "retry-after": "2" } },
          )
        : jsonResponse({ queue: [] });
    },
  });

  assert.deepEqual(await client.getQueue(), { queue: [] });
  assert.equal(requestCount, 2);
  assert.deepEqual(sleeps, [2_000]);

  let quotaCalls = 0;
  const quotaClient = new SpotifyApiClient({
    tokenProvider: async () => "access",
    sleep: async () => assert.fail("Quota exhaustion must not be retried."),
    fetchImpl: async () => {
      quotaCalls += 1;
      return jsonResponse(
        {
          error: {
            status: 429,
            message: "Too many requests",
            reason: "QUOTA_EXCEEDED",
          },
        },
        { status: 429, headers: { "retry-after": "1" } },
      );
    },
  });
  await assert.rejects(
    quotaClient.getQueue(),
    (error) =>
      error instanceof SpotifyApiError &&
      error.status === 429 &&
      error.reason === "QUOTA_EXCEEDED",
  );
  assert.equal(quotaCalls, 1);
});

test("API client default Date clock handles HTTP-date Retry-After values", async () => {
  const sleeps = [];
  let requestCount = 0;
  const retryAt = new Date(Date.now() + 5_000).toUTCString();
  const client = new SpotifyApiClient({
    tokenProvider: async () => "access",
    sleep: async (milliseconds) => sleeps.push(milliseconds),
    fetchImpl: async () => {
      requestCount += 1;
      return requestCount === 1
        ? jsonResponse(
            { error: { status: 429, message: "Slow down" } },
            { status: 429, headers: { "retry-after": retryAt } },
          )
        : jsonResponse({ queue: [] });
    },
  });

  assert.deepEqual(await client.getQueue(), { queue: [] });
  assert.equal(requestCount, 2);
  assert.equal(sleeps.length, 1);
  assert.ok(sleeps[0] >= 3_000 && sleeps[0] <= 5_000);
});

test("playback-state hydration is deduplicated while an un-signaled request is in flight", async () => {
  let release;
  let fetchCount = 0;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const client = new SpotifyApiClient({
    tokenProvider: async () => "access",
    fetchImpl: async () => {
      fetchCount += 1;
      await gate;
      return jsonResponse({ is_playing: true });
    },
  });

  const first = client.getPlaybackState();
  const second = client.getPlaybackState();
  assert.equal(first, second);
  assert.equal(fetchCount, 0);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fetchCount, 1);
  release();
  assert.deepEqual(await first, { is_playing: true });
  assert.deepEqual(await second, { is_playing: true });
});

test("fresh playback-state reads bypass an older deduplicated request", async () => {
  const releases = [];
  let fetchCount = 0;
  const client = new SpotifyApiClient({
    tokenProvider: async () => "access",
    fetchImpl: async () => {
      fetchCount += 1;
      await new Promise((resolve) => releases.push(resolve));
      return jsonResponse({ request: fetchCount });
    },
  });

  const older = client.getPlaybackState();
  const fresh = client.getPlaybackState({ dedupe: false });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fetchCount, 2);
  releases.splice(0).forEach((release) => release());
  await Promise.all([older, fresh]);
});

test("focused playback and queue methods use documented methods, bodies, and query parameters", async () => {
  const requests = [];
  const client = new SpotifyApiClient({
    tokenProvider: async () => "access",
    fetchImpl: async (url, options) => {
      requests.push({ url: new URL(url), options });
      return new Response(null, { status: 204 });
    },
  });

  await client.transferPlayback("spoot-device", { play: false });
  await client.seek(1_234.6, { deviceId: "spoot-device" });
  await client.setShuffle(true, { deviceId: "spoot-device" });
  await client.setRepeat("track", { deviceId: "spoot-device" });
  await client.addToQueue("spotify:episode:episode-1", {
    deviceId: "spoot-device",
  });

  assert.equal(requests[0].options.method, "PUT");
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    device_ids: ["spoot-device"],
    play: false,
  });
  assert.equal(requests[1].url.searchParams.get("position_ms"), "1235");
  assert.equal(requests[2].url.searchParams.get("state"), "true");
  assert.equal(requests[3].url.searchParams.get("state"), "track");
  assert.equal(
    requests[4].url.searchParams.get("uri"),
    "spotify:episode:episode-1",
  );
});

test("library, album, and device methods use current Spotify endpoints and pagination parameters", async () => {
  const requests = [];
  const client = new SpotifyApiClient({
    tokenProvider: async () => "access",
    fetchImpl: async (url, options) => {
      requests.push({ url: new URL(url), options });
      return jsonResponse({ items: [], devices: [] });
    },
  });

  await client.getCurrentUserProfile();
  await client.getCurrentUserPlaylists({ limit: 50, offset: 100 });
  await client.getPlaylist("AbC123", { market: "US" });
  await client.getPlaylistItems("AbC123", { limit: 25, offset: 50 });
  await client.getSavedTracks({ limit: 10, offset: 20, market: "US" });
  await client.getAlbum("Album123", { market: "US" });
  await client.getAlbumTracks("Album123", { limit: 25, offset: 50, market: "US" });
  await client.getAvailableDevices();
  await client.setPlaybackVolume(34.6, { deviceId: "spoot-device" });

  assert.equal(requests[0].url.pathname, "/v1/me");
  assert.equal(requests[1].url.pathname, "/v1/me/playlists");
  assert.equal(requests[1].url.searchParams.get("limit"), "50");
  assert.equal(requests[1].url.searchParams.get("offset"), "100");
  assert.equal(requests[2].url.pathname, "/v1/playlists/AbC123");
  assert.equal(requests[2].url.searchParams.get("market"), "US");
  assert.equal(requests[3].url.pathname, "/v1/playlists/AbC123/items");
  assert.equal(requests[3].url.searchParams.get("additional_types"), "track,episode");
  assert.equal(requests[4].url.pathname, "/v1/me/tracks");
  assert.equal(requests[4].url.searchParams.get("market"), "US");
  assert.equal(requests[5].url.pathname, "/v1/albums/Album123");
  assert.equal(requests[5].url.searchParams.get("market"), "US");
  assert.equal(requests[6].url.pathname, "/v1/albums/Album123/tracks");
  assert.equal(requests[6].url.searchParams.get("limit"), "25");
  assert.equal(requests[6].url.searchParams.get("offset"), "50");
  assert.equal(requests[7].url.pathname, "/v1/me/player/devices");
  assert.equal(requests[8].options.method, "PUT");
  assert.equal(requests[8].url.searchParams.get("volume_percent"), "35");
});

test("search and contextual playback use Spotify's documented request shapes", async () => {
  const requests = [];
  const client = new SpotifyApiClient({
    tokenProvider: async () => "access",
    fetchImpl: async (url, options) => {
      const parsed = new URL(url);
      requests.push({ url: parsed, options });
      return parsed.pathname.endsWith("/search")
        ? jsonResponse({ tracks: { items: [] } })
        : new Response(null, { status: 204 });
    },
  });

  await client.search("signal path", {
    types: ["track", "artist", "album", "playlist"],
    limit: 10,
    market: "US",
  });
  await client.startPlayback({
    deviceId: "spoot-device",
    contextUri: "spotify:playlist:playlist-1",
    offset: { position: 4 },
    positionMs: 0,
  });

  assert.equal(requests[0].url.pathname, "/v1/search");
  assert.equal(requests[0].url.searchParams.get("q"), "signal path");
  assert.equal(requests[0].url.searchParams.get("type"), "track,artist,album,playlist");
  assert.equal(requests[0].url.searchParams.get("limit"), "10");
  assert.equal(requests[0].url.searchParams.get("market"), "US");
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    context_uri: "spotify:playlist:playlist-1",
    offset: { position: 4 },
    position_ms: 0,
  });
  assert.throws(
    () => client.startPlayback({
      contextUri: "spotify:artist:artist-1",
      offset: { position: 0 },
    }),
    /only supported for album and playlist/u,
  );
  assert.throws(
    () => client.startPlayback({
      contextUri: "spotify:album:album-1",
      uris: ["spotify:track:track-1"],
    }),
    /either a context or a URI list/u,
  );
});

test("artist and track detail methods use current Spotify metadata endpoints", async () => {
  const requests = [];
  const client = new SpotifyApiClient({
    tokenProvider: async () => "access",
    fetchImpl: async (url, options) => {
      requests.push({ url: new URL(url), options });
      return jsonResponse({ items: [] });
    },
  });

  await client.getArtist("Artist123");
  await client.getArtistAlbums("Artist123", {
    includeGroups: ["album", "single"],
    limit: 10,
    offset: 20,
    market: "US",
  });
  await client.getTrack("Track123", { market: "US" });

  assert.equal(requests[0].url.pathname, "/v1/artists/Artist123");
  assert.equal(requests[1].url.pathname, "/v1/artists/Artist123/albums");
  assert.equal(requests[1].url.searchParams.get("include_groups"), "album,single");
  assert.equal(requests[1].url.searchParams.get("limit"), "10");
  assert.equal(requests[1].url.searchParams.get("offset"), "20");
  assert.equal(requests[2].url.pathname, "/v1/tracks/Track123");
  assert.equal(requests[2].url.searchParams.get("market"), "US");
});

test("library mutations use generic URI-based Spotify endpoints", async () => {
  const requests = [];
  const client = new SpotifyApiClient({
    tokenProvider: async () => "access",
    fetchImpl: async (url, options) => {
      requests.push({ url: new URL(url), options });
      return options.method === "GET"
        ? jsonResponse([true])
        : new Response(null, { status: 204 });
    },
  });

  await client.saveTracks(["Track123"]);
  await client.removeSavedTracks(["Track123"]);
  assert.deepEqual(await client.checkSavedTracks(["Track123"]), [true]);

  assert.equal(requests[0].url.pathname, "/v1/me/library");
  assert.equal(requests[0].options.method, "PUT");
  assert.equal(requests[0].url.searchParams.get("uris"), "spotify:track:Track123");
  assert.equal(requests[0].options.body, undefined);
  assert.equal(requests[1].url.pathname, "/v1/me/library");
  assert.equal(requests[1].options.method, "DELETE");
  assert.equal(requests[2].url.pathname, "/v1/me/library/contains");
  assert.equal(requests[2].options.method, "GET");
});

test("playlist editing methods use Spotify details, reorder, remove, and raw JPEG cover requests", async () => {
  const requests = [];
  const client = new SpotifyApiClient({
    tokenProvider: async () => "access",
    fetchImpl: async (url, options) => {
      requests.push({ url: new URL(url), options });
      if (options.method === "PUT" && url.endsWith("/items")) {
        return jsonResponse({ snapshot_id: "snapshot-next" });
      }
      return new Response(null, { status: 204 });
    },
  });

  await client.changePlaylistDetails("playlist1", {
    name: "Night drive",
    description: "after midnight",
    public: false,
  });
  await client.reorderPlaylistItems("playlist1", {
    rangeStart: 4,
    insertBefore: 1,
    snapshotId: "snapshot-old",
  });
  await client.removePlaylistItems("playlist1", ["spotify:track:track1"], {
    positions: [3],
    snapshotId: "snapshot-next",
  });
  await client.uploadPlaylistCover("playlist1", "data:image/jpeg;base64,abc123");

  assert.deepEqual(JSON.parse(requests[0].options.body), {
    name: "Night drive",
    description: "after midnight",
    public: false,
  });
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    range_start: 4,
    insert_before: 1,
    range_length: 1,
    snapshot_id: "snapshot-old",
  });
  assert.deepEqual(JSON.parse(requests[2].options.body), {
    items: [{ uri: "spotify:track:track1", positions: [3] }],
    snapshot_id: "snapshot-next",
  });
  assert.equal(requests[3].options.headers.get("Content-Type"), "image/jpeg");
  assert.equal(requests[3].options.body, "abc123");
});
