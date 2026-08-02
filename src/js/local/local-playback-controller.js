import { Emitter } from "../core/emitter.js";

const REPEAT_ORDER = Object.freeze(["off", "context", "track"]);

export class LocalPlaybackController extends Emitter {
  #library;
  #audio;
  #objectUrl = null;
  #contextIds = [];
  #currentIndex = -1;
  #currentTrack = null;
  #destroyed = false;
  #onBeforePlay;
  #queueGeneration = 0;
  #playbackRate = 1;
  #autoAdvance = true;

  constructor({ libraryService, audioFactory = () => new Audio(), onBeforePlay } = {}) {
    super();
    if (!libraryService) throw new TypeError("LocalPlaybackController requires a local library service.");
    this.#library = libraryService;
    this.#audio = audioFactory();
    this.#onBeforePlay = onBeforePlay;
    this.connectionState = "local-ready";
    this.deviceId = "spool-local-player";
    this.volume = 1;
    this.playbackState = emptyLocalState();
    this.queue = emptyLocalQueue();
    this.#bindAudio();
  }

  async connect() {
    this.emit("connection", { state: "local-ready", deviceId: this.deviceId });
    this.emit("state", this.playbackState);
    this.emit("queue", this.queue);
    this.emit("volume", this.volume);
    return true;
  }

  async playTrack(id, { contextIds, autoAdvance = true } = {}) {
    if (this.#destroyed) throw new Error("The local player has been closed.");
    const track = await this.#library.getTrack(id);
    if (!track) throw new Error("That local song is no longer stored in Spool.");
    const ids = Array.isArray(contextIds) && contextIds.length ? contextIds : [id];
    this.#contextIds = ids.filter((value, index, all) => typeof value === "string" && all.indexOf(value) === index);
    if (!this.#contextIds.includes(id)) this.#contextIds.unshift(id);
    this.#currentIndex = this.#contextIds.indexOf(id);
    this.#autoAdvance = Boolean(autoAdvance);
    await this.#loadAndPlay(track);
    return true;
  }

  async playNow(uri, { contextIds } = {}) {
    const id = localIdFromUri(uri);
    if (!id) throw new Error("That is not a Spool local-file URI.");
    return this.playTrack(id, { contextIds });
  }

  async togglePlay() {
    if (!this.#currentTrack) throw new Error("Choose a song from Local Files first.");
    if (this.#audio.paused) {
      await this.#onBeforePlay?.();
      await this.#audio.play();
    } else {
      this.#audio.pause();
    }
  }

  async pause() {
    this.#audio.pause();
  }

  async previous() {
    if (!this.#currentTrack) return false;
    if (this.#audio.currentTime > 3) {
      this.#audio.currentTime = 0;
      this.#emitState();
      return true;
    }
    const nextIndex = this.#previousIndex();
    if (nextIndex === null) {
      this.#audio.currentTime = 0;
      this.#emitState();
      return true;
    }
    return this.#playIndex(nextIndex);
  }

  async next() {
    const nextIndex = this.#nextIndex();
    if (nextIndex === null) {
      this.#audio.pause();
      return false;
    }
    return this.#playIndex(nextIndex);
  }

  async playQueueItem({ index = 0 } = {}) {
    const queueIndex = Number(index);
    if (!Number.isInteger(queueIndex) || queueIndex < 0 || queueIndex >= this.queue.upcoming.length) {
      throw new RangeError("That local queue item is no longer available.");
    }
    const id = this.queue.upcoming[queueIndex]?.localId;
    const targetIndex = this.#contextIds.indexOf(id);
    if (targetIndex < 0) throw new Error("That local queue item is unavailable.");
    return this.#playIndex(targetIndex);
  }

  async seek(positionMs) {
    const durationMs = Number.isFinite(this.#audio.duration) ? this.#audio.duration * 1000 : this.playbackState.durationMs;
    this.#audio.currentTime = Math.max(0, Math.min(Number(positionMs) || 0, durationMs || Infinity)) / 1000;
    this.#emitState();
  }

  async setVolume(volume) {
    const normalized = Number(volume);
    if (!Number.isFinite(normalized) || normalized < 0 || normalized > 1) {
      throw new RangeError("Player volume must be between 0 and 1.");
    }
    this.#audio.volume = normalized;
    this.volume = normalized;
    this.emit("volume", normalized);
    return normalized;
  }

  async refreshVolume() {
    this.volume = Number(this.#audio.volume) || 0;
    this.emit("volume", this.volume);
    return this.volume;
  }


  async setSpeed(rate) {
    const normalized = Math.min(2.5, Math.max(0.25, Number(rate) || 1));
    this.#playbackRate = normalized;
    this.#audio.playbackRate = normalized;
    if ("preservesPitch" in this.#audio) this.#audio.preservesPitch = false;
    if ("mozPreservesPitch" in this.#audio) this.#audio.mozPreservesPitch = false;
    if ("webkitPreservesPitch" in this.#audio) this.#audio.webkitPreservesPitch = false;
    return normalized;
  }

  async setShuffle(enabled) {
    this.playbackState = { ...this.playbackState, shuffleEnabled: Boolean(enabled) };
    this.emit("state", this.playbackState);
    this.#emitQueue();
    return this.playbackState;
  }

  async setRepeat(mode) {
    if (!REPEAT_ORDER.includes(mode)) throw new TypeError("Repeat mode must be off, context, or track.");
    this.playbackState = { ...this.playbackState, repeatMode: mode };
    this.emit("state", this.playbackState);
    return mode;
  }

  async cycleRepeat() {
    const current = this.playbackState.repeatMode || "off";
    return this.setRepeat(REPEAT_ORDER[(REPEAT_ORDER.indexOf(current) + 1) % REPEAT_ORDER.length]);
  }

  async refreshState() {
    this.#emitState();
    return this.playbackState;
  }

  async refreshQueue() {
    this.#emitQueue();
    return this.queue;
  }

  async addToQueue(uri) {
    const id = localIdFromUri(uri);
    if (!id) throw new Error("Only local songs can be added to the local queue.");
    if (!this.#contextIds.includes(id)) this.#contextIds.push(id);
    this.#emitQueue();
    return this.queue;
  }

  destroy() {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#audio.pause();
    this.#audio.removeAttribute?.("src");
    if (this.#objectUrl) URL.revokeObjectURL(this.#objectUrl);
    this.#objectUrl = null;
    this.clear();
  }

  async #loadAndPlay(track) {
    await this.#onBeforePlay?.();
    this.#audio.pause();
    if (this.#objectUrl) URL.revokeObjectURL(this.#objectUrl);
    const blob = await this.#library.getAudioBlob(track.id);
    if (!blob) throw new Error("The audio data for that local song is missing.");
    this.#objectUrl = URL.createObjectURL(blob);
    this.#currentTrack = track;
    this.#audio.src = this.#objectUrl;
    this.#audio.currentTime = 0;
    this.#audio.playbackRate = this.#playbackRate;
    if ("preservesPitch" in this.#audio) this.#audio.preservesPitch = false;
    if ("mozPreservesPitch" in this.#audio) this.#audio.mozPreservesPitch = false;
    if ("webkitPreservesPitch" in this.#audio) this.#audio.webkitPreservesPitch = false;
    this.#emitState({ positionMs: 0, paused: true, isPlaying: false });
    this.#emitQueue();
    await this.#audio.play();
  }

  async #playIndex(index) {
    const id = this.#contextIds[index];
    if (!id) return false;
    const track = await this.#library.getTrack(id);
    if (!track) return false;
    this.#currentIndex = index;
    await this.#loadAndPlay(track);
    return true;
  }

  #nextIndex() {
    if (!this.#contextIds.length || this.#currentIndex < 0) return null;
    if (this.playbackState.repeatMode === "track") return this.#currentIndex;
    if (this.playbackState.shuffleEnabled && this.#contextIds.length > 1) {
      let candidate = this.#currentIndex;
      while (candidate === this.#currentIndex) candidate = Math.floor(Math.random() * this.#contextIds.length);
      return candidate;
    }
    const candidate = this.#currentIndex + 1;
    if (candidate < this.#contextIds.length) return candidate;
    return this.playbackState.repeatMode === "context" ? 0 : null;
  }

  #previousIndex() {
    if (!this.#contextIds.length || this.#currentIndex < 0) return null;
    const candidate = this.#currentIndex - 1;
    if (candidate >= 0) return candidate;
    return this.playbackState.repeatMode === "context" ? this.#contextIds.length - 1 : null;
  }

  #bindAudio() {
    this.#audio.preload = "metadata";
    this.#audio.addEventListener("play", () => this.#emitState({ paused: false, isPlaying: true }));
    this.#audio.addEventListener("pause", () => this.#emitState({ paused: true, isPlaying: false }));
    this.#audio.addEventListener("loadedmetadata", () => {
      const durationMs = Number.isFinite(this.#audio.duration) ? Math.round(this.#audio.duration * 1000) : 0;
      if (this.#currentTrack && durationMs && durationMs !== this.#currentTrack.durationMs) {
        this.#currentTrack.durationMs = durationMs;
        this.#library.updateDuration(this.#currentTrack.id, durationMs).catch(() => {});
      }
      this.#emitState({ durationMs });
      this.#emitQueue();
    });
    this.#audio.addEventListener("timeupdate", () => {
      const positionMs = Math.max(0, Math.round((this.#audio.currentTime || 0) * 1000));
      this.playbackState = { ...this.playbackState, positionMs, positionCapturedAt: Date.now() };
      this.emit("progress", positionMs);
    });
    this.#audio.addEventListener("ended", () => {
      if (!this.#autoAdvance) {
        this.emit("ended", { track: this.#currentTrack, index: this.#currentIndex });
        return;
      }
      this.next().catch((error) => this.emit("error", { message: error.message, error, operation: "local-next" }));
    });
    this.#audio.addEventListener("error", () => {
      const error = new Error("The browser could not decode that local audio file.");
      this.emit("error", { message: error.message, error, operation: "local-playback" });
    });
  }

  #emitState(overrides = {}) {
    const now = Date.now();
    const track = this.#currentTrack;
    const durationMs = overrides.durationMs ?? (Number.isFinite(this.#audio.duration) ? Math.round(this.#audio.duration * 1000) : track?.durationMs || 0);
    const positionMs = overrides.positionMs ?? Math.round((this.#audio.currentTime || 0) * 1000);
    const item = track ? {
      ...track,
      id: track.id,
      uri: track.uri,
      type: "track",
      title: track.title,
      artist: track.artist,
      artistNames: track.artistNames || [track.artist],
      artists: track.artists || [{ id: null, name: track.artist }],
      albumName: track.albumName || "Local Files",
      artworkUrl: track.artworkUrl || null,
      durationMs,
      isLocal: true,
      isPlayable: true,
    } : null;
    this.playbackState = {
      source: "local",
      sdkReady: false,
      deviceReady: true,
      activeDevice: true,
      device: { id: this.deviceId, name: "Spool Local Files", type: "Computer", isActive: true, isRestricted: false, supportsVolume: true, volumePercent: Math.round(this.volume * 100) },
      item,
      currentItem: item,
      itemUri: item?.uri || null,
      itemId: item?.id || null,
      title: item?.title || "",
      artistNames: item?.artistNames || [],
      artist: item?.artist || "",
      albumName: item?.albumName || null,
      artworkUrl: item?.artworkUrl || null,
      durationMs,
      positionMs,
      positionCapturedAt: now,
      isPlaying: overrides.isPlaying ?? !this.#audio.paused,
      paused: overrides.paused ?? this.#audio.paused,
      shuffleEnabled: this.playbackState?.shuffleEnabled || false,
      repeatMode: this.playbackState?.repeatMode || "off",
      contentType: "track",
      restrictions: { content: null, deviceRestricted: false, disallowedActions: [] },
      context: { type: "local", uri: "spool:local-files", href: null },
      authoritativeAt: now,
      playbackChangedAt: now,
    };
    this.emit("state", this.playbackState);
  }

  #emitQueue() {
    const generation = ++this.#queueGeneration;
    const upcomingIds = this.#currentIndex >= 0 ? this.#contextIds.slice(this.#currentIndex + 1) : [];
    Promise.all(upcomingIds.slice(0, 100).map((id) => this.#library.getTrack(id, { withCover: false }))).then((tracks) => {
      if (generation !== this.#queueGeneration || this.#destroyed) return;
      const upcoming = tracks.filter(Boolean).map((track) => ({ ...track, localId: track.id, uri: track.uri, type: "track", isLocal: true }));
      const nowPlaying = this.#currentTrack ? { ...this.#currentTrack, localId: this.#currentTrack.id, nowPlaying: true } : null;
      this.queue = { source: "local", nowPlaying, upcoming, items: upcoming, isEmpty: !nowPlaying && !upcoming.length, receivedAt: Date.now() };
      this.emit("queue", this.queue);
    }).catch((error) => {
      if (generation !== this.#queueGeneration || this.#destroyed) return;
      this.emit("error", { message: error.message, error, operation: "local-queue" });
    });
  }
}

export function localIdFromUri(uri) {
  const match = /^spool:local:(.+)$/u.exec(String(uri || ""));
  return match?.[1] || null;
}

function emptyLocalState() {
  return {
    source: "local",
    sdkReady: false,
    deviceReady: true,
    activeDevice: true,
    device: { id: "spool-local-player", name: "Spool Local Files", type: "Computer", isActive: true, isRestricted: false, supportsVolume: true, volumePercent: 100 },
    item: null,
    currentItem: null,
    itemUri: null,
    itemId: null,
    title: "",
    artistNames: [],
    artist: "",
    albumName: null,
    artworkUrl: null,
    durationMs: 0,
    positionMs: 0,
    positionCapturedAt: Date.now(),
    isPlaying: false,
    paused: true,
    shuffleEnabled: false,
    repeatMode: "off",
    contentType: null,
    restrictions: { content: null, deviceRestricted: false, disallowedActions: [] },
    context: { type: "local", uri: "spool:local-files", href: null },
    authoritativeAt: Date.now(),
    playbackChangedAt: null,
  };
}

function emptyLocalQueue() {
  return { source: "local", nowPlaying: null, upcoming: [], items: [], isEmpty: true, receivedAt: Date.now() };
}
