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

  constructor({
    tokenProvider,
    name = "Spool",
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

  async connect() {
    if (this.#player) return this.ready;

    this.emit("status", { state: "loading-sdk" });
    const Spotify = await loadSpotifySdk({
      windowRef: this.#window,
      documentRef: this.#document,
      timeoutMs: this.#loadTimeoutMs,
    });

    this.emit("status", { state: "connecting-player" });
    const player = new Spotify.Player({
      name: this.#name,
      getOAuthToken: (callback) => {
        Promise.resolve(this.#tokenProvider.getAccessToken())
          .then((token) => callback(token))
          .catch((error) => {
            this.emit("error", {
              type: "authentication_error",
              message: "Spotify authorization expired.",
              error,
            });
          });
      },
    });

    this.#player = player;
    this.#registerListeners(player);

    const connected = await player.connect();
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

  disconnect() {
    if (this.#player) {
      this.#player.disconnect();
    }
    this.#player = null;
    this.#deviceId = null;
    this.#connected = false;
    this.emit("status", { state: "logged-in" });
  }

  #assertReady() {
    if (!this.ready || !this.#player) {
      throw new Error("The Spool playback device is not ready yet.");
    }
  }

  #registerListeners(player) {
    player.addListener("ready", ({ device_id: deviceId }) => {
      this.#deviceId = deviceId;
      this.#connected = true;
      this.emit("ready", { deviceId });
      this.emit("status", { state: "player-ready", deviceId });
    });

    player.addListener("not_ready", ({ device_id: deviceId }) => {
      if (this.#deviceId === deviceId) this.#deviceId = null;
      this.emit("not-ready", { deviceId });
      this.emit("status", { state: "temporarily-unavailable", deviceId });
    });

    player.addListener("player_state_changed", (state) => {
      this.emit("state", state);
    });

    for (const type of [
      "initialization_error",
      "authentication_error",
      "account_error",
      "playback_error",
    ]) {
      player.addListener(type, ({ message }) => {
        this.emit("error", { type, message });
      });
    }

    player.addListener("autoplay_failed", () => {
      this.emit("autoplay-failed", {
        message: "Press play once to allow browser audio for Spool.",
      });
    });
  }
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
