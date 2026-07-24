import test from "node:test";
import assert from "node:assert/strict";

import {
  interpolateProgress,
  normalizeApiPlaybackState,
  normalizeSdkPlaybackState,
  withInterpolatedProgress,
} from "../src/js/spotify/playback-state.js";
import {
  SpotifyQueueService,
  normalizeQueueResponse,
  trimRepeatedQueueCycles,
} from "../src/js/spotify/queue-service.js";

const track = {
  id: "track-1",
  uri: "spotify:track:track-1",
  type: "track",
  name: "Glass Signal",
  duration_ms: 200_000,
  explicit: false,
  artists: [{ id: "artist-1", name: "Aster", uri: "spotify:artist:artist-1" }],
  album: {
    id: "album-1",
    uri: "spotify:album:album-1",
    name: "Quiet Machines",
    images: [{ url: "https://i.scdn.co/image/cover-track" }],
  },
  restrictions: { reason: "market" },
};

const episode = {
  id: "episode-1",
  uri: "spotify:episode:episode-1",
  type: "episode",
  name: "How the Queue Works",
  duration_ms: 1_800_000,
  images: [{ url: "https://i.scdn.co/image/cover-episode" }],
  show: {
    id: "show-1",
    uri: "spotify:show:show-1",
    name: "Playback Notes",
    publisher: "Spool Radio",
  },
};

test("API playback normalization preserves metadata, device state, and restrictions", () => {
  const state = normalizeApiPlaybackState(
    {
      device: {
        id: "device-1",
        name: "Spool",
        type: "computer",
        is_active: true,
        is_restricted: true,
        volume_percent: 55,
        supports_volume: true,
      },
      item: track,
      progress_ms: 10_000,
      is_playing: true,
      shuffle_state: true,
      repeat_state: "context",
      currently_playing_type: "track",
      timestamp: 900,
      actions: { skipping_next: true, seeking: false },
      context: { type: "playlist", uri: "spotify:playlist:list-1" },
    },
    { receivedAt: 1_000, sdkReady: true },
  );

  assert.equal(state.source, "api");
  assert.equal(state.sdkReady, true);
  assert.equal(state.activeDevice, true);
  assert.equal(state.device.isRestricted, true);
  assert.equal(state.itemUri, track.uri);
  assert.equal(state.title, "Glass Signal");
  assert.deepEqual(state.artistNames, ["Aster"]);
  assert.equal(state.albumName, "Quiet Machines");
  assert.equal(state.item.albumUri, "spotify:album:album-1");
  assert.equal(state.artworkUrl, "https://i.scdn.co/image/cover-track");
  assert.equal(state.isPlaying, true);
  assert.equal(state.paused, false);
  assert.equal(state.shuffleEnabled, true);
  assert.equal(state.repeatMode, "context");
  assert.equal(state.restrictions.content.reason, "market");
  assert.deepEqual(state.restrictions.disallowedActions, ["skipping_next"]);
  assert.equal(state.playbackChangedAt, 900);
  assert.equal(interpolateProgress(state, 1_500), 10_500);
  assert.equal(withInterpolatedProgress(state, 1_500).positionMs, 10_500);
});

test("SDK playback normalization handles episodes, repeat mode, and paused interpolation", () => {
  const state = normalizeSdkPlaybackState(
    {
      paused: true,
      position: 44_000,
      duration: 1_800_000,
      repeat_mode: 2,
      shuffle: false,
      disallows: { seeking: true, skipping_next: false },
      track_window: { current_track: episode },
      context: { uri: "spotify:show:show-1", metadata: { source: "show" } },
    },
    { receivedAt: 5_000, deviceId: "device-sdk", sdkReady: true },
  );

  assert.equal(state.source, "sdk");
  assert.equal(state.device.id, "device-sdk");
  assert.equal(state.contentType, "episode");
  assert.equal(state.title, "How the Queue Works");
  assert.deepEqual(state.artistNames, ["Spool Radio"]);
  assert.equal(state.albumName, "Playback Notes");
  assert.equal(state.repeatMode, "track");
  assert.equal(state.paused, true);
  assert.deepEqual(state.restrictions.disallowedActions, ["seeking"]);
  assert.equal(interpolateProgress(state, 15_000), 44_000);
});

test("queue normalization handles a null current item plus track and episode rows", () => {
  const empty = normalizeQueueResponse(null, { receivedAt: 1 });
  assert.equal(empty.isEmpty, true);
  assert.deepEqual(empty.upcoming, []);

  const queue = normalizeQueueResponse(
    { currently_playing: track, queue: [track, episode, null] },
    { receivedAt: 20 },
  );
  assert.equal(queue.isEmpty, false);
  assert.equal(queue.nowPlaying.nowPlaying, true);
  assert.equal(queue.nowPlaying.uri, track.uri);
  assert.equal(queue.upcoming.length, 2);
  assert.equal(queue.upcoming[0].index, 0);
  assert.equal(queue.upcoming[1].type, "episode");
  assert.equal(queue.upcoming[1].artist, "Spool Radio");
  assert.equal(queue.receivedAt, 20);
});

test("queue display trims confirmed repeated context cycles but preserves ordinary duplicates", () => {
  const item = (id) => ({ id, uri: `spotify:track:${id}`, type: "track" });
  const remainingThenLoop = [item("b"), item("c"), item("a"), item("b"), item("c")];
  assert.deepEqual(
    trimRepeatedQueueCycles(remainingThenLoop, "spotify:track:a").map((entry) => entry.id),
    ["b", "c"],
  );
  assert.deepEqual(
    trimRepeatedQueueCycles([
      item("a"), item("b"), item("c"), item("a"), item("b"), item("c"),
    ]).map((entry) => entry.id),
    ["a", "b", "c"],
  );
  assert.deepEqual(
    trimRepeatedQueueCycles([item("a"), item("a"), item("b")]).map((entry) => entry.id),
    ["a", "a", "b"],
  );
});

test("queue service deduplicates refresh and refreshes after a successful add", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let getCalls = 0;
  const additions = [];
  const apiClient = {
    async getQueue() {
      getCalls += 1;
      if (getCalls === 1) await gate;
      return { currently_playing: track, queue: [episode] };
    },
    async addToQueue(uri, options) {
      additions.push({ uri, options });
      return null;
    },
  };
  const service = new SpotifyQueueService({ apiClient, clock: () => 123 });

  const first = service.refresh();
  const second = service.refresh();
  assert.equal(first, second);
  release();
  assert.equal((await first).receivedAt, 123);
  assert.equal(getCalls, 1);

  const refreshed = await service.add(episode.uri, { deviceId: "device-1" });
  assert.deepEqual(additions, [
    {
      uri: episode.uri,
      options: { deviceId: "device-1", signal: undefined },
    },
  ]);
  assert.equal(refreshed.upcoming[0].type, "episode");
  assert.equal(getCalls, 2);
});

test("queue service default Date clock records a numeric timestamp", async () => {
  const service = new SpotifyQueueService({
    apiClient: {
      async getQueue() {
        return { currently_playing: null, queue: [] };
      },
      async addToQueue() {},
    },
  });

  const before = Date.now();
  const queue = await service.refresh();
  assert.equal(typeof queue.receivedAt, "number");
  assert.ok(queue.receivedAt >= before && queue.receivedAt <= Date.now());
});
