import { Emitter } from "../core/emitter.js";
import {
  MOCK_TRACKS,
  createMockPlaybackState,
  createMockQueue,
} from "./mock-fixtures.js";

const REPEAT_ORDER = ["off", "context", "track"];

export class MockPlaybackController extends Emitter {
  #scenario;
  #trackIndex = 0;
  #timer = null;

  constructor({ scenario = "default" } = {}) {
    super();
    this.#scenario = scenario;
    this.connectionState = "logged-in";
    this.deviceId = null;
    this.playbackState = null;
    this.queue = { nowPlaying: null, upcoming: [], items: [], isEmpty: true };
    this.devices = [];
    this.volume = 0.82;
  }

  async connect() {
    this.#throwScenario("auth-error", "Mock authorization failed.");
    this.#throwScenario("sdk-error", "Mock Spotify SDK failed to load.");
    this.#setConnection("connecting-player");
    await Promise.resolve();
    this.deviceId = "spool-mock-device";
    this.devices = [
      { id: this.deviceId, name: "Spool (Mock)", type: "Computer", isActive: false, isRestricted: false, supportsVolume: true, volumePercent: 82 },
      { id: "mock-living-room", name: "Living room", type: "Speaker", isActive: false, isRestricted: false, supportsVolume: true, volumePercent: 56 },
    ];
    this.#setConnection("player-ready");
    this.#applyScenarioState();
    this.emit("devices", this.devices);
    this.emit("volume", this.volume);
    this.#startProgress();
    return true;
  }

  async disconnect() {
    clearInterval(this.#timer);
    this.#timer = null;
    this.deviceId = null;
    this.playbackState = null;
    this.queue = { nowPlaying: null, upcoming: [], items: [], isEmpty: true };
    this.devices = [];
    this.emit("state", this.playbackState);
    this.emit("queue", this.queue);
    this.emit("devices", this.devices);
    this.#setConnection("logged-out");
  }

  async transferHere() {
    this.#setConnection("transferring-playback");
    await Promise.resolve();
    this.#setConnection("active");
    this.playbackState = {
      ...(this.playbackState ?? createMockPlaybackState()),
      activeDevice: true,
      device: { ...(this.playbackState?.device ?? {}), id: this.deviceId, name: "Spool (Mock)", isActive: true },
      authoritativeAt: Date.now(),
    };
    this.devices = this.devices.map((device) => ({ ...device, isActive: device.id === this.deviceId }));
    this.emit("state", this.playbackState);
    this.emit("devices", this.devices);
    return true;
  }

  async transferToDevice(deviceId) {
    if (deviceId === this.deviceId) return this.transferHere();
    const device = this.devices.find((candidate) => candidate.id === deviceId);
    if (!device || device.isRestricted) throw new Error("Mock device is unavailable.");
    this.devices = this.devices.map((candidate) => ({ ...candidate, isActive: candidate.id === deviceId }));
    this.playbackState = {
      ...this.playbackState,
      activeDevice: false,
      device: { ...device, isActive: true },
      authoritativeAt: Date.now(),
    };
    this.emit("devices", this.devices);
    this.emit("state", this.playbackState);
    this.#setConnection("player-ready");
    return true;
  }

  async playNow(uri) {
    const index = MOCK_TRACKS.findIndex((track) => track.uri === uri && track.type === "track");
    if (index < 0) throw new Error("Only mock songs can be played directly.");
    this.#trackIndex = index;
    await this.transferHere();
    this.#changeTrack();
    return true;
  }

  async playQueueItem({ index = 0 } = {}) {
    if (!this.playbackState?.activeDevice) {
      throw new Error("Use Spool as the active Spotify device first.");
    }
    const queueIndex = Number(index);
    if (!Number.isInteger(queueIndex) || queueIndex < 0) {
      throw new RangeError("The selected mock queue position is invalid.");
    }
    for (let step = 0; step <= queueIndex; step += 1) await this.next();
    return true;
  }

  async togglePlay() {
    if (!this.playbackState) return;
    this.playbackState = {
      ...this.playbackState,
      paused: !this.playbackState.paused,
      isPlaying: this.playbackState.paused,
      positionCapturedAt: Date.now(),
      authoritativeAt: Date.now(),
    };
    this.emit("state", this.playbackState);
  }

  async previous() {
    this.#trackIndex = (this.#trackIndex - 1 + MOCK_TRACKS.length) % MOCK_TRACKS.length;
    this.#changeTrack();
  }

  async next() {
    this.#trackIndex = (this.#trackIndex + 1) % MOCK_TRACKS.length;
    this.#changeTrack();
  }

  async seek(positionMs) {
    if (!this.playbackState) return;
    this.playbackState = {
      ...this.playbackState,
      positionMs: Math.max(
        0,
        Math.min(Math.round(positionMs), this.playbackState.durationMs),
      ),
      authoritativeAt: Date.now(),
    };
    this.emit("state", this.playbackState);
  }

  async setShuffle(enabled) {
    if (!this.playbackState) return;
    this.playbackState = {
      ...this.playbackState,
      shuffleEnabled: Boolean(enabled),
      authoritativeAt: Date.now(),
    };
    this.emit("state", this.playbackState);
  }

  async setRepeat(repeatMode) {
    if (!REPEAT_ORDER.includes(repeatMode)) throw new TypeError("Mock repeat mode is invalid.");
    if (!this.playbackState) return "off";
    this.playbackState = {
      ...this.playbackState,
      repeatMode,
      authoritativeAt: Date.now(),
    };
    this.emit("state", this.playbackState);
    return repeatMode;
  }

  async cycleRepeat() {
    if (!this.playbackState) return "off";
    const index = REPEAT_ORDER.indexOf(this.playbackState.repeatMode);
    return this.setRepeat(REPEAT_ORDER[(index + 1) % REPEAT_ORDER.length]);
  }

  async refreshState() {
    this.#throwScenario("rate-limit", "Mock Spotify rate limit (Retry-After: 1).");
    if (this.#scenario === "null") {
      this.playbackState = null;
      this.emit("state", null);
      return null;
    }
    this.emit("state", this.playbackState);
    return this.playbackState;
  }

  async refreshQueue() {
    this.#throwScenario("rate-limit", "Mock Spotify queue rate limit.");
    this.emit("queue", this.queue);
    return this.queue;
  }

  async refreshDevices() {
    this.emit("devices", this.devices);
    return this.devices;
  }

  async refreshVolume() {
    this.emit("volume", this.volume);
    return this.volume;
  }

  async setVolume(volume) {
    const normalized = Number(volume);
    if (!Number.isFinite(normalized) || normalized < 0 || normalized > 1) {
      throw new RangeError("Mock volume must be between 0 and 1.");
    }
    this.volume = normalized;
    this.emit("volume", normalized);
    return normalized;
  }

  async addToQueue(uri) {
    if (!uri) throw new Error("A Spotify URI is required.");
    return this.refreshQueue();
  }

  #applyScenarioState() {
    if (this.#scenario === "null") {
      this.playbackState = null;
      this.queue = { nowPlaying: null, upcoming: [], items: [], isEmpty: true };
    } else {
      this.playbackState = createMockPlaybackState(MOCK_TRACKS[this.#trackIndex], {
        paused: this.#scenario === "paused",
        isPlaying: this.#scenario !== "paused",
      });
      this.queue = this.#scenario === "empty-queue"
        ? {
            nowPlaying: { ...MOCK_TRACKS[this.#trackIndex], nowPlaying: true },
            upcoming: [],
            items: [],
            isEmpty: false,
            receivedAt: Date.now(),
          }
        : createMockQueue(this.#trackIndex);
    }
    this.emit("state", this.playbackState);
    this.emit("queue", this.queue);
  }

  #changeTrack() {
    this.playbackState = createMockPlaybackState(MOCK_TRACKS[this.#trackIndex], {
      shuffleEnabled: this.playbackState?.shuffleEnabled ?? false,
      repeatMode: this.playbackState?.repeatMode ?? "off",
    });
    this.queue = createMockQueue(this.#trackIndex);
    this.emit("state", this.playbackState);
    this.emit("queue", this.queue);
  }

  #startProgress() {
    clearInterval(this.#timer);
    this.#timer = setInterval(() => {
      if (!this.playbackState || this.playbackState.paused) return;
      const positionMs = Math.min(
        this.playbackState.durationMs,
        this.playbackState.positionMs + 250,
      );
      this.playbackState = {
        ...this.playbackState,
        positionMs,
        positionCapturedAt: Date.now(),
      };
      this.emit("progress", positionMs);
    }, 250);
  }

  #setConnection(state) {
    this.connectionState = state;
    this.emit("connection", { state, deviceId: this.deviceId });
  }

  #throwScenario(scenario, message) {
    if (this.#scenario !== scenario) return;
    const error = new Error(message);
    this.emit("error", { message, error });
    throw error;
  }
}
