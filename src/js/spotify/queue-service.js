import { normalizePlaybackItem } from "./playback-state.js";

function clockNow(clock) {
  return typeof clock?.now === "function" ? clock.now() : clock();
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

function queueIdentity(item) {
  return item?.uri || (item?.id ? `${item?.type || "item"}:${item.id}` : null);
}

function isRepeatedContextTail(keys, boundary, currentKey) {
  const cycleLength = boundary + 1;
  const tailLength = keys.length - boundary - 1;
  if (boundary < 1 || tailLength < 1) return false;

  for (let offset = 0; offset < tailLength; offset += 1) {
    const cycleOffset = offset % cycleLength;
    const expected = cycleOffset === boundary ? currentKey : keys[cycleOffset];
    if (!expected || keys[boundary + 1 + offset] !== expected) return false;
  }
  return true;
}

export function trimRepeatedQueueCycles(items, currentUri = null) {
  if (!Array.isArray(items) || items.length < 2) return Array.isArray(items) ? [...items] : [];
  const keys = items.map(queueIdentity);
  const currentKey = currentUri || null;

  // With context repeat enabled Spotify may expose the next loop as
  //   remaining items -> current item -> the same remaining items.
  // Stop at that confirmed boundary, but only when the tail also matches the
  // beginning of the visible queue. A later duplicate song by itself remains.
  if (currentKey) {
    for (let boundary = 1; boundary < keys.length - 1; boundary += 1) {
      if (
        keys[boundary] === currentKey &&
        isRepeatedContextTail(keys, boundary, currentKey)
      ) {
        return items.slice(0, boundary);
      }
    }
  }

  // Also collapse a complete repeated block when Spotify returns two or more
  // full copies. Period 1 is deliberately excluded so intentional adjacent
  // duplicates remain visible and selectable.
  for (let period = 2; period <= Math.floor(keys.length / 2); period += 1) {
    let repeats = true;
    for (let index = period; index < keys.length; index += 1) {
      if (!keys[index] || keys[index] !== keys[index % period]) {
        repeats = false;
        break;
      }
    }
    if (repeats) return items.slice(0, period);
  }
  return [...items];
}

export function normalizeQueueResponse(
  payload,
  { receivedAt = Date.now() } = {},
) {
  const nowPlaying = normalizeQueueItem(payload?.currently_playing, {
    nowPlaying: true,
  });
  const normalizedUpcoming = Array.isArray(payload?.queue)
    ? payload.queue
        .map((item, index) => normalizeQueueItem(item, { index }))
        .filter(Boolean)
    : [];
  const upcoming = trimRepeatedQueueCycles(normalizedUpcoming, nowPlaying?.uri)
    .map((item, index) => ({ ...item, index }));

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
