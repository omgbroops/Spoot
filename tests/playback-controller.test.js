import test from "node:test";
import assert from "node:assert/strict";

import { Emitter } from "../src/js/core/emitter.js";
import { PlaybackController } from "../src/js/spotify/playback-controller.js";

const API_TRACK = {
  id: "track-1",
  uri: "spotify:track:track-1",
  type: "track",
  name: "Signal Path",
  artists: [{ name: "Static Bloom" }],
  album: { name: "Transmission", images: [{ url: "cover.jpg" }] },
  duration_ms: 180_000,
};

class FakeSdk extends Emitter {
  constructor() {
    super();
    this.ready = false;
    this.calls = [];
  }

  async connect() {
    this.calls.push("connect");
    return true;
  }

  async activateElement() {
    this.calls.push("activate");
  }

  async togglePlay() {
    this.calls.push("toggle");
  }

  async previous() {
    this.calls.push("previous");
  }

  async next() {
    this.calls.push("next");
  }

  async seek(position) {
    this.calls.push(["seek", position]);
  }

  disconnect() {
    this.calls.push("disconnect");
    this.ready = false;
  }

  becomeReady(deviceId = "spool-device") {
    this.ready = true;
    this.emit("ready", { deviceId });
  }
}

function createApi() {
  const calls = [];
  let shuffle = false;
  let repeat = "off";
  return {
    calls,
    async getPlaybackState() {
      calls.push("get-state");
      return {
        device: {
          id: "spool-device",
          name: "Spool",
          is_active: true,
          is_restricted: false,
        },
        item: API_TRACK,
        is_playing: true,
        progress_ms: 12_000,
        shuffle_state: shuffle,
        repeat_state: repeat,
        currently_playing_type: "track",
        actions: { disallows: {} },
      };
    },
    async transferPlayback(deviceId, options) {
      calls.push(["transfer", deviceId, options]);
    },
    async setShuffle(value, options) {
      shuffle = value;
      calls.push(["shuffle", value, options]);
    },
    async setRepeat(value, options) {
      repeat = value;
      calls.push(["repeat", value, options]);
    },
    async startPlayback() {},
    async pausePlayback() {},
    async skipPrevious() {},
    async skipNext() {},
    async seek() {},
  };
}

function createQueueService() {
  const queue = {
    nowPlaying: { id: "track-1", title: "Signal Path" },
    upcoming: [{ id: "track-2", title: "Afterimage" }],
    isEmpty: false,
  };
  return {
    refreshCalls: 0,
    async refresh() {
      this.refreshCalls += 1;
      return queue;
    },
    async add() {
      return queue;
    },
  };
}

test("controller connects once, hydrates state, and transfers only on user action", async () => {
  const sdk = new FakeSdk();
  const api = createApi();
  const queueService = createQueueService();
  const controller = new PlaybackController({
    apiClient: api,
    sdk,
    queueService,
    setIntervalImpl: () => 1,
    clearIntervalImpl: () => {},
  });

  await controller.connect();
  assert.equal(api.calls.some((call) => Array.isArray(call) && call[0] === "transfer"), false);

  sdk.becomeReady();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.deviceId, "spool-device");
  assert.equal(controller.playbackState.title, "Signal Path");
  assert.equal(controller.playbackState.activeDevice, true);
  assert.equal(typeof controller.playbackState.authoritativeAt, "number");
  assert.ok(Number.isFinite(controller.playbackState.authoritativeAt));

  await controller.transferHere();
  assert.deepEqual(
    api.calls.find((call) => Array.isArray(call) && call[0] === "transfer"),
    ["transfer", "spool-device", { play: false }],
  );
  assert.equal(sdk.calls.filter((call) => call === "activate").length, 1);
  assert.ok(queueService.refreshCalls >= 2);
});

test("controller routes transport to SDK and confirms API shuffle/repeat state", async () => {
  const sdk = new FakeSdk();
  const api = createApi();
  const controller = new PlaybackController({
    apiClient: api,
    sdk,
    queueService: createQueueService(),
    clock: { now: () => 50_000 },
    setIntervalImpl: () => 1,
    clearIntervalImpl: () => {},
  });

  sdk.becomeReady();
  await new Promise((resolve) => setImmediate(resolve));
  await controller.togglePlay();
  await controller.next();
  await controller.previous();
  await controller.seek(999_999);
  assert.deepEqual(sdk.calls.slice(-4), [
    "toggle",
    "next",
    "previous",
    ["seek", 180_000],
  ]);

  await controller.setShuffle(true);
  assert.equal(controller.playbackState.shuffleEnabled, true);
  assert.equal(await controller.cycleRepeat(), "context");
  assert.equal(controller.playbackState.repeatMode, "context");
});

test("null SDK state falls back to one dedupable API reconciliation", async () => {
  const sdk = new FakeSdk();
  const api = createApi();
  const controller = new PlaybackController({
    apiClient: api,
    sdk,
    queueService: createQueueService(),
    setIntervalImpl: () => 1,
    clearIntervalImpl: () => {},
  });
  let nullNotice = false;
  controller.on("null-state", () => {
    nullNotice = true;
  });

  sdk.becomeReady();
  await new Promise((resolve) => setImmediate(resolve));
  const before = api.calls.filter((call) => call === "get-state").length;
  sdk.emit("state", null);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(nullNotice, true);
  assert.equal(
    api.calls.filter((call) => call === "get-state").length,
    before + 1,
  );
});
