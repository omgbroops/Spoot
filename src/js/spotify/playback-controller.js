import { Emitter } from "../core/emitter.js";
import {
  createEmptyPlaybackState,
  normalizeApiPlaybackState,
  normalizeSdkPlaybackState,
  interpolateProgress,
} from "./playback-state.js";
import { normalizeQueueResponse } from "./queue-service.js";

const REPEAT_ORDER = Object.freeze(["off", "context", "track"]);

export class PlaybackController extends Emitter {
  #api;
  #sdk;
  #queueService;
  #clock;
  #setInterval;
  #clearInterval;
  #progressTimer = null;
  #unbindSdk = [];

  constructor({
    apiClient,
    sdk,
    queueService,
    clock = Date,
    setIntervalImpl = globalThis.setInterval,
    clearIntervalImpl = globalThis.clearInterval,
  } = {}) {
    super();
    if (!apiClient) throw new TypeError("PlaybackController requires an API client.");
    if (!sdk) throw new TypeError("PlaybackController requires the playback SDK.");
    if (!queueService) throw new TypeError("PlaybackController requires a queue service.");

    this.#api = apiClient;
    this.#sdk = sdk;
    this.#queueService = queueService;
    this.#clock = clock;
    this.#setInterval = setIntervalImpl;
    this.#clearInterval = clearIntervalImpl;

    this.connectionState = "logged-in";
    this.deviceId = null;
    this.playbackState = createEmptyPlaybackState();
    this.queue = normalizeQueueResponse(null);
    this.#bindSdk();
  }

  async connect() {
    this.#setConnection("loading-sdk");
    try {
      const connected = await this.#sdk.connect();
      this.#startProgressLoop();
      return connected;
    } catch (error) {
      this.#setConnection("error", { message: error.message });
      this.emit("error", { message: error.message, error });
      throw error;
    }
  }

  async disconnect() {
    this.#stopProgressLoop();
    this.#sdk.disconnect();
    this.deviceId = null;
    this.playbackState = createEmptyPlaybackState();
    this.queue = normalizeQueueResponse(null);
    this.emit("state", this.playbackState);
    this.emit("queue", this.queue);
    this.#setConnection("logged-in");
  }

  async transferHere() {
    if (!this.deviceId) {
      throw new Error("Wait for the Spool playback device to become ready.");
    }

    // Invoke immediately from the click handler before the first await so mobile
    // browsers can unlock encrypted audio inside the user's gesture.
    const activation = this.#sdk.activateElement();
    this.#setConnection("transferring-playback");

    try {
      await activation;
      await this.#api.transferPlayback(this.deviceId, { play: false });
      const [state] = await Promise.all([
        this.refreshState(),
        this.refreshQueue().catch(() => this.queue),
      ]);
      this.#setConnection(state?.activeDevice ? "active" : "player-ready");
      return true;
    } catch (error) {
      this.#setConnection("player-ready", { message: error.message });
      this.#emitCommandError("Playback transfer was rejected.", error);
      throw error;
    }
  }

  async togglePlay() {
    const action = this.playbackState?.paused ? "resuming" : "pausing";
    this.#assertActionAllowed(action);

    try {
      if (this.#sdk.ready) {
        await this.#sdk.togglePlay();
      } else if (this.playbackState?.paused) {
        await this.#api.startPlayback({ deviceId: this.deviceId });
        await this.refreshState();
      } else {
        await this.#api.pausePlayback({ deviceId: this.deviceId });
        await this.refreshState();
      }
    } catch (error) {
      this.#emitCommandError("Spotify rejected the play/pause command.", error);
      throw error;
    }
  }

  async previous() {
    return this.#transportCommand({
      action: "skipping_prev",
      sdkCommand: () => this.#sdk.previous(),
      apiCommand: () => this.#api.skipPrevious({ deviceId: this.deviceId }),
      errorMessage: "Spotify rejected the previous-track command.",
    });
  }

  async next() {
    return this.#transportCommand({
      action: "skipping_next",
      sdkCommand: () => this.#sdk.next(),
      apiCommand: () => this.#api.skipNext({ deviceId: this.deviceId }),
      errorMessage: "Spotify rejected the next-track command.",
    });
  }

  async seek(positionMs) {
    this.#assertActionAllowed("seeking");
    const duration = this.playbackState?.durationMs ?? 0;
    const position = Math.max(0, Math.min(Math.round(positionMs), duration || Infinity));

    try {
      if (this.#sdk.ready) {
        await this.#sdk.seek(position);
        this.#applyPlaybackState({
          ...this.playbackState,
          positionMs: position,
          positionCapturedAt: this.#now(),
          authoritativeAt: this.#now(),
        });
      } else {
        await this.#api.seek(position, { deviceId: this.deviceId });
        await this.refreshState();
      }
    } catch (error) {
      this.#emitCommandError("Spotify rejected the seek command.", error);
      throw error;
    }
  }

  async setShuffle(enabled) {
    try {
      await this.#api.setShuffle(Boolean(enabled), { deviceId: this.deviceId });
      return await this.refreshState();
    } catch (error) {
      this.#emitCommandError("Spotify rejected the shuffle command.", error);
      throw error;
    }
  }

  async cycleRepeat() {
    const current = this.playbackState?.repeatMode ?? "off";
    const nextMode = REPEAT_ORDER[(REPEAT_ORDER.indexOf(current) + 1) % REPEAT_ORDER.length];
    try {
      await this.#api.setRepeat(nextMode, { deviceId: this.deviceId });
      await this.refreshState();
      return this.playbackState.repeatMode;
    } catch (error) {
      this.#emitCommandError("Spotify rejected the repeat command.", error);
      throw error;
    }
  }

  async refreshState({ signal } = {}) {
    try {
      const payload = await this.#api.getPlaybackState({ signal });
      const normalized = normalizeApiPlaybackState(payload, {
        receivedAt: this.#now(),
        sdkReady: this.#sdk.ready,
      });
      const spoolIsActive = Boolean(
        this.deviceId &&
          normalized.device?.id === this.deviceId &&
          normalized.device?.isActive,
      );
      const state = {
        ...normalized,
        sdkReady: this.#sdk.ready,
        deviceReady: this.#sdk.ready,
        activeDevice: spoolIsActive,
        spoolDeviceId: this.deviceId,
      };
      this.#applyPlaybackState(state);
      if (this.#sdk.ready) {
        this.#setConnection(spoolIsActive ? "active" : "player-ready");
      }
      return state;
    } catch (error) {
      this.emit("error", {
        message: readableStateError(error),
        error,
        operation: "refresh-state",
      });
      throw error;
    }
  }

  async refreshQueue({ signal } = {}) {
    try {
      const queue = await this.#queueService.refresh({ signal });
      this.queue = queue;
      this.emit("queue", queue);
      return queue;
    } catch (error) {
      this.emit("error", {
        message: readableQueueError(error),
        error,
        operation: "refresh-queue",
      });
      throw error;
    }
  }

  async addToQueue(uri, { signal } = {}) {
    try {
      const queue = await this.#queueService.add(uri, {
        deviceId: this.deviceId,
        signal,
      });
      this.queue = queue;
      this.emit("queue", queue);
      return queue;
    } catch (error) {
      this.#emitCommandError("Spotify could not add that item to the queue.", error);
      throw error;
    }
  }

  destroy() {
    this.#stopProgressLoop();
    for (const unbind of this.#unbindSdk) unbind();
    this.#unbindSdk = [];
    this.clear();
  }

  async #transportCommand({ action, sdkCommand, apiCommand, errorMessage }) {
    this.#assertActionAllowed(action);
    try {
      if (this.#sdk.ready) await sdkCommand();
      else {
        await apiCommand();
        await this.refreshState();
      }
      await this.refreshQueue().catch(() => this.queue);
    } catch (error) {
      this.#emitCommandError(errorMessage, error);
      throw error;
    }
  }

  #bindSdk() {
    this.#unbindSdk.push(
      this.#sdk.on("status", ({ state, ...detail }) => {
        this.#setConnection(state, detail);
      }),
      this.#sdk.on("ready", ({ deviceId }) => {
        this.deviceId = deviceId;
        this.playbackState = {
          ...this.playbackState,
          sdkReady: true,
          deviceReady: true,
          spoolDeviceId: deviceId,
        };
        this.emit("state", this.playbackState);
        this.emit("ready", { deviceId });
        Promise.allSettled([this.refreshState(), this.refreshQueue()]);
      }),
      this.#sdk.on("not-ready", ({ deviceId }) => {
        if (this.deviceId === deviceId) this.deviceId = null;
        this.playbackState = {
          ...this.playbackState,
          sdkReady: false,
          deviceReady: false,
          activeDevice: false,
          spoolDeviceId: null,
        };
        this.emit("state", this.playbackState);
      }),
      this.#sdk.on("state", (payload) => {
        if (!payload) {
          this.emit("null-state", {
            message: "Spotify returned no local player state. Rechecking playback…",
          });
          this.refreshState().catch(() => {});
          return;
        }

        const previousUri = this.playbackState?.itemUri;
        const sdkState = normalizeSdkPlaybackState(payload, {
          receivedAt: this.#now(),
          deviceId: this.deviceId,
          sdkReady: true,
          activeDevice: true,
        });
        const merged = {
          ...sdkState,
          shuffleEnabled:
            typeof payload.shuffle === "boolean"
              ? sdkState.shuffleEnabled
              : (this.playbackState?.shuffleEnabled ?? sdkState.shuffleEnabled),
          repeatMode: Number.isFinite(Number(payload.repeat_mode))
            ? sdkState.repeatMode
            : (this.playbackState?.repeatMode ?? sdkState.repeatMode),
          activeDevice: true,
          spoolDeviceId: this.deviceId,
        };
        this.#applyPlaybackState(merged);
        this.#setConnection("active");

        if (previousUri !== merged.itemUri) {
          this.refreshQueue().catch(() => {});
        }
      }),
      this.#sdk.on("autoplay-failed", (event) => {
        this.emit("notice", event);
      }),
      this.#sdk.on("error", (event) => {
        const state = event.type === "authentication_error"
          ? "authorization-expired"
          : "error";
        this.#setConnection(state, { message: event.message });
        this.emit("error", event);
      }),
    );
  }

  #applyPlaybackState(state) {
    this.playbackState = state;
    this.emit("state", state);
  }

  #assertActionAllowed(action) {
    if (this.playbackState?.restrictions?.disallowedActions?.includes(action)) {
      throw new Error(`Spotify does not allow ${action.replaceAll("_", " ")} for this item.`);
    }
  }

  #setConnection(state, detail = {}) {
    this.connectionState = state;
    this.emit("connection", { state, deviceId: this.deviceId, ...detail });
  }

  #emitCommandError(message, error) {
    this.emit("error", { message, error, operation: "playback-command" });
  }

  #startProgressLoop() {
    if (this.#progressTimer || typeof this.#setInterval !== "function") return;
    this.#progressTimer = Reflect.apply(this.#setInterval, globalThis, [
      () => {
        if (!this.playbackState?.isPlaying) return;
        this.emit("progress", interpolateProgress(this.playbackState, this.#now()));
      },
      250,
    ]);
  }

  #stopProgressLoop() {
    if (!this.#progressTimer) return;
    Reflect.apply(this.#clearInterval, globalThis, [this.#progressTimer]);
    this.#progressTimer = null;
  }

  #now() {
    return typeof this.#clock?.now === "function"
      ? this.#clock.now()
      : this.#clock();
  }
}

function readableStateError(error) {
  if (error?.status === 429) return "Spotify is rate limiting playback updates. Try again shortly.";
  if (error?.status === 403) return "Spotify denied playback access. Check Premium and the app allowlist.";
  if (globalThis.navigator && globalThis.navigator.onLine === false) {
    return "The network is offline. Playback state will refresh after reconnecting.";
  }
  return error?.message || "Spotify playback state is temporarily unavailable.";
}

function readableQueueError(error) {
  if (error?.status === 429) return "Spotify is rate limiting queue updates. Try again shortly.";
  if (error?.status === 403) return "Spotify did not allow this app to read the current queue.";
  return error?.message || "The Spotify queue is temporarily unavailable.";
}

export function createPlaybackController(options) {
  return new PlaybackController(options);
}
