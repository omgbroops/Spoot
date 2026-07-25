import test from "node:test";
import assert from "node:assert/strict";

import { LocalPlaybackController } from "../src/js/local/local-playback-controller.js";

class FakeAudio {
  constructor() {
    this.listeners = new Map();
    this.paused = true;
    this.currentTime = 0;
    this.duration = 120;
    this.volume = 1;
    this.playbackRate = 1;
    this.src = "";
  }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  emit(type) { for (const listener of this.listeners.get(type) || []) listener(); }
  async play() { this.paused = false; this.emit("play"); }
  pause() { if (!this.paused) { this.paused = true; this.emit("pause"); } }
  removeAttribute(name) { if (name === "src") this.src = ""; }
}

const TRACKS = ["one", "two", "three"].map((id, index) => ({
  id,
  uri: `spool:local:${id}`,
  title: id,
  artist: "Local Artist",
  artistNames: ["Local Artist"],
  artists: [{ id: null, name: "Local Artist" }],
  albumName: "Local Files",
  durationMs: (index + 1) * 60_000,
  isLocal: true,
  isPlayable: true,
}));

function createLibrary() {
  return {
    async getTrack(id) { return TRACKS.find((track) => track.id === id) || null; },
    async getAudioBlob() { return new Blob(["audio"], { type: "audio/mpeg" }); },
    async updateDuration() {},
  };
}

test("local playback uses one audio element, supports speed, and keeps local context", async () => {
  const audio = new FakeAudio();
  const controller = new LocalPlaybackController({
    libraryService: createLibrary(),
    audioFactory: () => audio,
  });
  const states = [];
  const queues = [];
  controller.on("state", (state) => states.push(state));
  controller.on("queue", (queue) => queues.push(queue));

  await controller.connect();
  await controller.setSpeed(1.25);
  await controller.playTrack("one", { contextIds: TRACKS.map((track) => track.id) });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(audio.playbackRate, 1.25);
  assert.equal(states.at(-1).itemUri, "spool:local:one");
  assert.equal(states.at(-1).isPlaying, true);
  assert.deepEqual(queues.at(-1).upcoming.map((item) => item.localId), ["two", "three"]);

  await controller.next();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(states.at(-1).itemUri, "spool:local:two");
  await controller.previous();
  assert.equal(states.at(-1).positionMs, 0);
  controller.destroy();
});
