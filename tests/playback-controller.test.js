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

  async getVolume() {
    this.calls.push("get-volume");
    return 0.7;
  }

  async setVolume(volume) {
    this.calls.push(["set-volume", volume]);
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
  const stateOptions = [];
  let shuffle = false;
  let repeat = "off";
  return {
    calls,
    stateOptions,
    async getPlaybackState(options = {}) {
      calls.push("get-state");
      stateOptions.push(options);
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
    async getAvailableDevices() {
      calls.push("get-devices");
      return {
        devices: [
          { id: "spool-device", name: "Spool", type: "Computer", is_active: true, is_restricted: false },
          { id: "phone-device", name: "Phone", type: "Smartphone", is_active: false, is_restricted: false },
        ],
      };
    },
    async setShuffle(value, options) {
      shuffle = value;
      calls.push(["shuffle", value, options]);
    },
    async setRepeat(value, options) {
      repeat = value;
      calls.push(["repeat", value, options]);
    },
    async startPlayback(options) { calls.push(["start", options]); },
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

test("controller invokes browser timers with the global receiver", async () => {
  const sdk = new FakeSdk();
  let intervalReceiver;
  let clearReceiver;
  let observedDelay;
  let clearedTimer;
  const controller = new PlaybackController({
    apiClient: createApi(),
    sdk,
    queueService: createQueueService(),
    setIntervalImpl: function (_callback, delay) {
      intervalReceiver = this;
      observedDelay = delay;
      if (this !== globalThis) throw new TypeError("Illegal invocation");
      return 37;
    },
    clearIntervalImpl: function (timer) {
      clearReceiver = this;
      clearedTimer = timer;
      if (this !== globalThis) throw new TypeError("Illegal invocation");
    },
  });

  await controller.connect();
  assert.equal(intervalReceiver, globalThis);
  assert.equal(observedDelay, 250);

  await controller.disconnect();
  assert.equal(clearReceiver, globalThis);
  assert.equal(clearedTimer, 37);
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

test("controller lists devices, transfers externally, plays a queue song in Spool, and controls SDK volume", async () => {
  const sdk = new FakeSdk();
  const api = createApi();
  const controller = new PlaybackController({
    apiClient: api,
    sdk,
    queueService: createQueueService(),
    setIntervalImpl: () => 1,
    clearIntervalImpl: () => {},
  });
  sdk.becomeReady();
  await new Promise((resolve) => setImmediate(resolve));

  const devices = await controller.refreshDevices();
  assert.equal(devices[1].name, "Phone");
  await controller.transferToDevice("phone-device");
  assert.ok(api.calls.some((call) => Array.isArray(call) && call[0] === "transfer" && call[1] === "phone-device"));

  controller.playbackState = { ...controller.playbackState, activeDevice: false };
  const transfersBeforePlay = api.calls.filter((call) => Array.isArray(call) && call[0] === "transfer").length;
  await controller.playNow("spotify:track:track-2");
  assert.ok(api.calls.some((call) => Array.isArray(call) && call[0] === "start" && call[1].uris[0] === "spotify:track:track-2"));
  assert.equal(
    api.calls.filter((call) => Array.isArray(call) && call[0] === "transfer").length,
    transfersBeforePlay,
  );
  assert.equal(api.stateOptions.at(-1).dedupe, false);
  assert.equal(await controller.refreshVolume(), 0.7);
  assert.equal(await controller.setVolume(0.35), 0.35);
  assert.ok(sdk.calls.some((call) => Array.isArray(call) && call[0] === "set-volume" && call[1] === 0.35));
});

test("disconnect during connect cannot restart the progress loop", async () => {
  let releaseConnect;
  const sdk = new FakeSdk();
  sdk.connect = async () => new Promise((resolve) => {
    releaseConnect = () => resolve(true);
  });
  let intervalCalls = 0;
  const controller = new PlaybackController({
    apiClient: createApi(),
    sdk,
    queueService: createQueueService(),
    setIntervalImpl: () => {
      intervalCalls += 1;
      return 1;
    },
    clearIntervalImpl: () => {},
  });

  const connection = controller.connect();
  await new Promise((resolve) => setImmediate(resolve));
  await controller.disconnect();
  releaseConnect();

  assert.equal(await connection, false);
  assert.equal(intervalCalls, 0);
  assert.equal(controller.connectionState, "logged-in");
});

test("rapid direct-play requests are serialized with the last click winning", async () => {
  const sdk = new FakeSdk();
  const api = createApi();
  let releaseFirst;
  let firstStarted;
  const firstStartedPromise = new Promise((resolve) => {
    firstStarted = resolve;
  });
  api.startPlayback = async (options) => {
    api.calls.push(["start", options]);
    if (options.uris[0] === "spotify:track:first") {
      firstStarted();
      await new Promise((resolve) => {
        releaseFirst = resolve;
      });
    }
  };
  const controller = new PlaybackController({
    apiClient: api,
    sdk,
    queueService: createQueueService(),
    setIntervalImpl: () => 1,
    clearIntervalImpl: () => {},
  });
  sdk.becomeReady();
  await new Promise((resolve) => setImmediate(resolve));

  const first = controller.playNow("spotify:track:first");
  await firstStartedPromise;
  const second = controller.playNow("spotify:track:second");
  releaseFirst();

  assert.equal(await first, false);
  assert.equal(await second, true);
  assert.deepEqual(
    api.calls.filter((call) => Array.isArray(call) && call[0] === "start").map((call) => call[1].uris[0]),
    ["spotify:track:first", "spotify:track:second"],
  );
});
