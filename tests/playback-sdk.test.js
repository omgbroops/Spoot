import test from "node:test";
import assert from "node:assert/strict";

import { SpotifyPlaybackSdk } from "../src/js/spotify/playback-sdk.js";

class FakePlayer {
  static latest;

  constructor(options) {
    this.options = options;
    this.listeners = new Map();
    this.calls = [];
    FakePlayer.latest = this;
  }

  addListener(type, listener) {
    this.listeners.set(type, listener);
  }

  emit(type, value = {}) {
    this.listeners.get(type)?.(value);
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

  async previousTrack() {
    this.calls.push("previous");
  }

  async nextTrack() {
    this.calls.push("next");
  }

  async seek(position) {
    this.calls.push(["seek", position]);
  }

  disconnect() {
    this.calls.push("disconnect");
  }
}

test("SDK wrapper shares the token provider and exposes one ready device", async () => {
  const wrapper = new SpotifyPlaybackSdk({
    tokenProvider: { getAccessToken: async () => "test-access-token" },
    windowRef: { Spotify: { Player: FakePlayer } },
    documentRef: {},
  });

  const readyEvents = [];
  wrapper.on("ready", (event) => readyEvents.push(event));

  assert.equal(await wrapper.connect(), true);
  const player = FakePlayer.latest;

  let deliveredToken;
  player.options.getOAuthToken((token) => {
    deliveredToken = token;
  });
  await Promise.resolve();
  assert.equal(deliveredToken, "test-access-token");

  player.emit("ready", { device_id: "device-123" });
  assert.equal(wrapper.ready, true);
  assert.equal(wrapper.deviceId, "device-123");
  assert.deepEqual(readyEvents, [{ deviceId: "device-123" }]);

  await wrapper.activateElement();
  await wrapper.togglePlay();
  await wrapper.previous();
  await wrapper.next();
  await wrapper.seek(1234.6);
  assert.deepEqual(player.calls, [
    "connect",
    "activate",
    "toggle",
    "previous",
    "next",
    ["seek", 1235],
  ]);

  wrapper.disconnect();
  assert.equal(wrapper.ready, false);
});

test("SDK wrapper surfaces Spotify account and autoplay failures", async () => {
  const wrapper = new SpotifyPlaybackSdk({
    tokenProvider: { getAccessToken: async () => "token" },
    windowRef: { Spotify: { Player: FakePlayer } },
    documentRef: {},
  });
  const errors = [];
  const autoplay = [];
  wrapper.on("error", (event) => errors.push(event));
  wrapper.on("autoplay-failed", (event) => autoplay.push(event));

  await wrapper.connect();
  FakePlayer.latest.emit("account_error", { message: "Premium required" });
  FakePlayer.latest.emit("autoplay_failed");

  assert.equal(errors[0].type, "account_error");
  assert.match(errors[0].message, /Premium/);
  assert.match(autoplay[0].message, /Press play once/);
  wrapper.disconnect();
});
