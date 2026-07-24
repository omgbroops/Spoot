import { normalizePlaybackItem } from "./playback-state.js";

function clockNow(clock) {
  return typeof clock === "function" ? clock() : clock.now();
}

export function assertQueueableSpotifyUri(uri) {
  if (
    typeof uri !== "string" ||
    !/^spotify:(?:track|episode):[^:\s]+$/u.test(uri)
  ) {
    throw new TypeError("Queue items must be Spotify track or episode URIs.");
  }
  return uri;
}

export function normalizeQueueItem(item, { index = null, nowPlaying = false } = {}) {
  const normalized = normalizePlaybackItem(item);
  if (!normalized) return null;

  return {
    ...normalized,
    index,
    nowPlaying: Boolean(nowPlaying),
  };
}

export function normalizeQueueResponse(
  payload,
  { receivedAt = Date.now() } = {},
) {
  const nowPlaying = normalizeQueueItem(payload?.currently_playing, {
    nowPlaying: true,
  });
  const upcoming = Array.isArray(payload?.queue)
    ? payload.queue
        .map((item, index) => normalizeQueueItem(item, { index }))
        .filter(Boolean)
    : [];

  return {
    nowPlaying,
    upcoming,
    items: upcoming,
    isEmpty: !nowPlaying && upcoming.length === 0,
    receivedAt,
  };
}

export class SpotifyQueueService {
  constructor({ apiClient, clock = Date } = {}) {
    if (!apiClient?.getQueue || !apiClient?.addToQueue) {
      throw new TypeError(
        "SpotifyQueueService requires an API client with queue methods.",
      );
    }
    this.apiClient = apiClient;
    this.clock = clock;
    this.refreshPromise = null;
  }

  refresh({ signal } = {}) {
    if (!signal && this.refreshPromise) return this.refreshPromise;

    const operation = this.apiClient
      .getQueue({ signal })
      .then((payload) =>
        normalizeQueueResponse(payload, { receivedAt: clockNow(this.clock) }),
      );
    if (signal) return operation;

    const tracked = operation.finally(() => {
      if (this.refreshPromise === tracked) this.refreshPromise = null;
    });
    this.refreshPromise = tracked;
    return tracked;
  }

  async add(uri, { deviceId, signal, refresh = true } = {}) {
    await this.apiClient.addToQueue(assertQueueableSpotifyUri(uri), {
      deviceId,
      signal,
    });
    return refresh ? this.refresh({ signal }) : null;
  }
}

export function createSpotifyQueueService(options) {
  return new SpotifyQueueService(options);
}
