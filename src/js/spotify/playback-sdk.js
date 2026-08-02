import { Emitter } from "../core/emitter.js";

const SDK_URL = "https://sdk.scdn.co/spotify-player.js";
const SDK_SCRIPT_ID = "spotify-web-playback-sdk";
let sdkReadyPromise;

export class SpotifyPlaybackSdk extends Emitter {
  #tokenProvider;
  #name;
  #window;
  #document;
  #loadTimeoutMs;
  #player = null;
  #deviceId = null;
  #connected = false;
  #connectPromise = null;
  #connectionGeneration = 0;
  #tokenRequestTail = Promise.resolve();
  #sdkTokenRequestCount = 0;
  #lastSdkToken = null;

  constructor({
    tokenProvider,
    name = "Spoot",
    windowRef = globalThis.window,
    documentRef = globalThis.document,
    loadTimeoutMs = 15_000,
  }) {
    super();
    this.#tokenProvider = tokenProvider;
    this.#name = name;
    this.#window = windowRef;
    this.#document = documentRef;
    this.#loadTimeoutMs = loadTimeoutMs;
  }

  get player() {
    return this.#player;
  }

  get deviceId() {
    return this.#deviceId;
  }

  get ready() {
    return Boolean(this.#connected && this.#deviceId);
  }

  connect() {
    if (this.ready) return Promise.resolve(true);
    if (this.#connectPromise) return this.#connectPromise;
    const generation = this.#connectionGeneration;
    const operation = this.#connectPlayer(generation);
    const tracked = operation.finally(() => {
      if (this.#connectPromise === tracked) this.#connectPromise = null;
    });
    this.#connectPromise = tracked;
    return tracked;
  }

  async #connectPlayer(generation) {
    if (this.#player) {
      const player = this.#player;
      this.emit("status", { state: "connecting-player" });
      const connected = await player.connect();
      if (!this.#isCurrent(player, generation)) {
        player.disconnect?.();
        throw connectionCancelledError();
      }
      this.#connected = Boolean(connected);
      if (!connected) throw new Error("Spotify Web Playback SDK could not reconnect.");
      return connected;
    }

    this.emit("status", { state: "loading-sdk" });
    const Spotify = await loadSpotifySdk({
      windowRef: this.#window,
      documentRef: this.#document,
      timeoutMs: this.#loadTimeoutMs,
    });
    if (generation !== this.#connectionGeneration) throw connectionCancelledError();

    this.emit("status", { state: "connecting-player" });
    this.#tokenRequestTail = Promise.resolve();
    this.#sdkTokenRequestCount = 0;
    this.#lastSdkToken = null;
    const player = new Spotify.Player({
      name: this.#name,
      // Spoot owns the optional, user-toggleable Media Session integration.
      enableMediaSession: false,
      getOAuthToken: (callback) => {
        this.#provideSdkToken(callback, generation);
      },
    });

    this.#player = player;
    this.#registerListeners(player, generation);

    const connected = await player.connect();
    if (!this.#isCurrent(player, generation)) {
      player.disconnect?.();
      throw connectionCancelledError();
    }
    this.#connected = Boolean(connected);
    if (!connected) {
      this.#player = null;
      throw new Error("Spotify Web Playback SDK could not connect.");
    }

    return connected;
  }

  async activateElement() {
    if (!this.#player?.activateElement) return;
    await this.#player.activateElement();
  }

  async getCurrentState() {
    return this.#player?.getCurrentState?.() ?? null;
  }

  async togglePlay() {
    this.#assertReady();
    return this.#player.togglePlay();
  }

  async previous() {
    this.#assertReady();
    return this.#player.previousTrack();
  }

  async next() {
    this.#assertReady();
    return this.#player.nextTrack();
  }

  async seek(positionMs) {
    this.#assertReady();
    return this.#player.seek(Math.max(0, Math.round(positionMs)));
  }

  async getVolume() {
    this.#assertReady();
    return this.#player.getVolume();
  }

  async setVolume(volume) {
    this.#assertReady();
    if (!Number.isFinite(volume) || volume < 0 || volume > 1) {
      throw new RangeError("Player volume must be between 0 and 1.");
    }
    return this.#player.setVolume(volume);
  }

  disconnect() {
    this.#connectionGeneration += 1;
    const player = this.#player;
    this.#player = null;
    this.#connectPromise = null;
    this.#deviceId = null;
    this.#connected = false;
    this.#tokenRequestTail = Promise.resolve();
    this.#sdkTokenRequestCount = 0;
    this.#lastSdkToken = null;
    player?.disconnect?.();
    this.emit("status", { state: "logged-in" });
  }

  #assertReady() {
    if (!this.ready || !this.#player) {
      throw new Error("The Spoot playback device is not ready yet.");
    }
  }

  #registerListeners(player, generation) {
    const isCurrent = () => this.#isCurrent(player, generation);
    player.addListener("ready", ({ device_id: deviceId }) => {
      if (!isCurrent()) return;
      this.#deviceId = deviceId;
      this.#connected = true;
      this.emit("ready", { deviceId });
      this.emit("status", { state: "player-ready", deviceId });
    });

    player.addListener("not_ready", ({ device_id: deviceId }) => {
      if (!isCurrent()) return;
      if (this.#deviceId === deviceId) this.#deviceId = null;
      this.#connected = false;
      this.emit("not-ready", { deviceId });
      this.emit("status", { state: "temporarily-unavailable", deviceId });
    });

    player.addListener("player_state_changed", (state) => {
      if (!isCurrent()) return;
      this.emit("state", state);
    });

    for (const type of [
      "initialization_error",
      "authentication_error",
      "account_error",
      "playback_error",
    ]) {
      player.addListener(type, ({ message }) => {
        if (!isCurrent()) return;
        if (type === "authentication_error") {
          this.#deviceId = null;
          this.#connected = false;
        }
        this.emit("error", { type, message });
      });
    }

    player.addListener("autoplay_failed", () => {
      if (!isCurrent()) return;
      this.emit("autoplay-failed", {
        message: "Press play once to allow browser audio for Spoot.",
      });
    });
  }

  #provideSdkToken(callback, generation) {
    const forceRefresh = this.#sdkTokenRequestCount > 0;
    this.#sdkTokenRequestCount += 1;
    const operation = this.#tokenRequestTail.catch(() => {}).then(async () => {
      if (generation !== this.#connectionGeneration) return;
      let token = await this.#tokenProvider.getAccessToken({ forceRefresh });
      if (this.#lastSdkToken && token === this.#lastSdkToken) {
        token = await this.#tokenProvider.getAccessToken({ forceRefresh: true });
      }
      if (!token || (this.#lastSdkToken && token === this.#lastSdkToken)) {
        throw new Error("Spotify did not issue a fresh access token for the browser player.");
      }
      if (generation !== this.#connectionGeneration) return;
      this.#lastSdkToken = token;
      callback(token);
    });
    this.#tokenRequestTail = operation.catch(() => {});
    operation.catch((error) => {
      if (generation !== this.#connectionGeneration) return;
      this.emit("error", {
        type: "authentication_error",
        message: "Spotify authorization expired. Reconnect Spoot to continue playing.",
        error,
      });
    });
  }

  #isCurrent(player, generation) {
    return generation === this.#connectionGeneration && player === this.#player;
  }
}

function connectionCancelledError() {
  const error = new Error("Spotify player connection was cancelled.");
  error.name = "AbortError";
  return error;
}

export function loadSpotifySdk({
  windowRef = globalThis.window,
  documentRef = globalThis.document,
  timeoutMs = 15_000,
} = {}) {
  if (windowRef?.Spotify?.Player) {
    return Promise.resolve(windowRef.Spotify);
  }

  if (sdkReadyPromise) return sdkReadyPromise;

  sdkReadyPromise = new Promise((resolve, reject) => {
    if (!windowRef || !documentRef) {
      reject(new Error("The Spotify Web Playback SDK requires a browser."));
      return;
    }

    const priorCallback = windowRef.onSpotifyWebPlaybackSDKReady;
    let settled = false;
    let timeout;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback(value);
    };

    windowRef.onSpotifyWebPlaybackSDKReady = () => {
      if (typeof priorCallback === "function") {
        try {
          Reflect.apply(priorCallback, windowRef, []);
        } catch (error) {
          console.warn("Another Spotify SDK callback failed.", error);
        }
      }

      if (windowRef.Spotify?.Player) {
        finish(resolve, windowRef.Spotify);
      } else {
        finish(reject, new Error("Spotify SDK loaded without exposing Spotify.Player."));
      }
    };

    let script = documentRef.getElementById(SDK_SCRIPT_ID);
    if (!script) {
      script = documentRef.createElement("script");
      script.id = SDK_SCRIPT_ID;
      script.src = SDK_URL;
      script.async = true;
      documentRef.head.appendChild(script);
    }

    script.addEventListener(
      "error",
      () => finish(reject, new Error("Spotify Web Playback SDK failed to load.")),
      { once: true },
    );

    timeout = setTimeout(() => {
      finish(reject, new Error("Spotify Web Playback SDK timed out while loading."));
    }, timeoutMs);
  }).catch((error) => {
    sdkReadyPromise = undefined;
    throw error;
  });

  return sdkReadyPromise;
}

export function resetSdkLoaderForTests() {
  sdkReadyPromise = undefined;
}
