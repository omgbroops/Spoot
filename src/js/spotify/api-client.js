export const SPOTIFY_API_BASE_URL = "https://api.spotify.com/v1";
export const DEFAULT_MAX_RATE_LIMIT_RETRY_MS = 60_000;

function clockNow(clock) {
  return typeof clock?.now === "function" ? clock.now() : clock();
}

function createAbortError(signal) {
  if (signal?.reason) return signal.reason;
  if (typeof DOMException === "function") {
    return new DOMException("The operation was aborted.", "AbortError");
  }
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

export function abortableSleep(milliseconds, signal) {
  if (signal?.aborted) return Promise.reject(createAbortError(signal));

  let abort;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, milliseconds);
    abort = () => {
      clearTimeout(timeout);
      reject(createAbortError(signal));
    };
    signal?.addEventListener("abort", abort, { once: true });
  }).finally(() => {
    signal?.removeEventListener?.("abort", abort);
  });
}

function isJsonContentType(contentType) {
  return /(?:application\/json|\+json)(?:;|$)/iu.test(contentType || "");
}

export async function parseSpotifyResponse(response) {
  if (response.status === 204 || response.status === 205) return null;

  const text = await response.text();
  if (!text) return null;

  const contentType = response.headers.get("content-type") ?? "";
  if (!isJsonContentType(contentType)) return text;

  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new SpotifyApiError("Spotify returned malformed JSON.", {
      status: response.status,
      code: "invalid_json",
      cause,
    });
  }
}

function spotifyErrorReason(details) {
  return details?.error?.reason ?? details?.reason ?? null;
}

function spotifyErrorCode(details, status) {
  const code =
    spotifyErrorReason(details) ||
    details?.error?.status ||
    (typeof details?.error === "string" ? details.error : null) ||
    details?.code ||
    `http_${status}`;
  return String(code);
}

function spotifyErrorMessage(details, response) {
  if (typeof details === "string" && details.trim()) return details.trim();
  return (
    details?.error?.message ||
    details?.error_description ||
    details?.message ||
    response.statusText ||
    `Spotify request failed with HTTP ${response.status}.`
  );
}

export function parseRetryAfter(value, now = Date.now()) {
  if (typeof value !== "string" || !value.trim()) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;

  const date = Date.parse(value);
  if (!Number.isFinite(date)) return null;
  return Math.max(0, date - now);
}

function buildUrl(baseUrl, path, query) {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const normalizedPath = String(path).replace(/^\//u, "");
  const url = new URL(normalizedPath, normalizedBase);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") continue;
      if (Array.isArray(value)) {
        url.searchParams.set(key, value.join(","));
      } else {
        url.searchParams.set(key, String(value));
      }
    }
  }

  return url.toString();
}

function prepareBody(body, headers) {
  if (body === undefined || body === null) return undefined;
  if (
    typeof body === "string" ||
    body instanceof URLSearchParams ||
    (typeof Blob !== "undefined" && body instanceof Blob) ||
    (typeof FormData !== "undefined" && body instanceof FormData) ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body)
  ) {
    return body;
  }

  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return JSON.stringify(body);
}

async function tokenFromProvider(tokenProvider, forceRefresh) {
  if (typeof tokenProvider === "function") {
    return tokenProvider({ forceRefresh });
  }
  if (typeof tokenProvider?.getAccessToken === "function") {
    return tokenProvider.getAccessToken({ forceRefresh });
  }
  throw new TypeError(
    "SpotifyApiClient requires a token provider function or getAccessToken method.",
  );
}

function assertSpotifyUri(uri, allowedTypes = null) {
  if (typeof uri !== "string" || !/^spotify:[a-z]+:[^:\s]+$/u.test(uri)) {
    throw new TypeError("A valid Spotify URI is required.");
  }
  if (allowedTypes && !allowedTypes.some((type) => uri.startsWith(`spotify:${type}:`))) {
    throw new TypeError(
      `Spotify URI must refer to ${allowedTypes.join(" or ")}.`,
    );
  }
  return uri;
}

function optionalDeviceQuery(deviceId) {
  return deviceId ? { device_id: deviceId } : undefined;
}

function assertSpotifyId(id, label = "Spotify item") {
  if (typeof id !== "string" || !/^[A-Za-z0-9]+$/u.test(id)) {
    throw new TypeError(`${label} ID is invalid.`);
  }
  return id;
}

function assertSpotifyIds(ids, label, maximum) {
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > maximum) {
    throw new RangeError(`${label} IDs must contain between 1 and ${maximum} items.`);
  }
  return ids.map((id) => assertSpotifyId(id, label));
}

function assertSpotifyUris(uris, allowedTypes, maximum) {
  if (!Array.isArray(uris) || uris.length < 1 || uris.length > maximum) {
    throw new RangeError(`Spotify URIs must contain between 1 and ${maximum} items.`);
  }
  return uris.map((uri) => assertSpotifyUri(uri, allowedTypes));
}

export class SpotifyApiError extends Error {
  constructor(
    message,
    {
      status = null,
      code = "spotify_api_error",
      reason = null,
      details = null,
      retryAfterMs = null,
      method = null,
      url = null,
      cause,
    } = {},
  ) {
    super(message, cause ? { cause } : undefined);
    this.name = "SpotifyApiError";
    this.status = status;
    this.code = code;
    this.reason = reason;
    this.details = details;
    this.retryAfterMs = retryAfterMs;
    this.method = method;
    this.url = url;
  }
}

export class SpotifyApiClient {
  constructor({
    tokenProvider,
    fetchImpl = globalThis.fetch,
    sleep = abortableSleep,
    clock = Date,
    baseUrl = SPOTIFY_API_BASE_URL,
    maxRateLimitRetryMs = DEFAULT_MAX_RATE_LIMIT_RETRY_MS,
  } = {}) {
    if (typeof fetchImpl !== "function") {
      throw new TypeError("SpotifyApiClient requires a fetch implementation.");
    }
    if (typeof sleep !== "function") {
      throw new TypeError("SpotifyApiClient requires a sleep implementation.");
    }
    if (!tokenProvider) {
      throw new TypeError("SpotifyApiClient requires a token provider.");
    }

    this.tokenProvider = tokenProvider;
    this.fetch = fetchImpl;
    this.sleep = sleep;
    this.clock = clock;
    this.baseUrl = baseUrl;
    this.maxRateLimitRetryMs = maxRateLimitRetryMs;
    this.inflightRequests = new Map();
  }

  request(path, options = {}) {
    const dedupeKey = options.dedupeKey;
    const canDedupe = Boolean(dedupeKey) && !options.signal;
    if (canDedupe && this.inflightRequests.has(dedupeKey)) {
      return this.inflightRequests.get(dedupeKey);
    }

    const requestPromise = this.executeRequest(path, options);
    if (!canDedupe) return requestPromise;

    const trackedPromise = requestPromise.finally(() => {
      if (this.inflightRequests.get(dedupeKey) === trackedPromise) {
        this.inflightRequests.delete(dedupeKey);
      }
    });
    this.inflightRequests.set(dedupeKey, trackedPromise);
    return trackedPromise;
  }

  async executeRequest(
    path,
    {
      method = "GET",
      query,
      body,
      headers: providedHeaders,
      signal,
      retry401 = true,
      retry429 = true,
    } = {},
  ) {
    const url = buildUrl(this.baseUrl, path, query);
    const headers = new Headers(providedHeaders);
    const preparedBody = prepareBody(body, headers);
    let authRetries = 0;
    let rateLimitRetries = 0;
    let forceRefresh = false;

    while (true) {
      if (signal?.aborted) throw createAbortError(signal);
      const token = await tokenFromProvider(this.tokenProvider, forceRefresh);
      headers.set("Authorization", `Bearer ${token}`);

      let response;
      try {
        response = await Reflect.apply(this.fetch, globalThis, [
          url,
          {
            method,
            headers,
            body: preparedBody,
            signal,
          },
        ]);
      } catch (cause) {
        if (signal?.aborted || cause?.name === "AbortError") throw cause;
        throw new SpotifyApiError("Could not reach Spotify.", {
          code: "network_error",
          method,
          url,
          cause,
        });
      }

      const details = await parseSpotifyResponse(response);
      if (response.ok) return details;

      if (response.status === 401 && retry401 && authRetries === 0) {
        authRetries += 1;
        forceRefresh = true;
        continue;
      }

      const reason = spotifyErrorReason(details);
      const retryAfterMs = parseRetryAfter(
        response.headers.get("retry-after"),
        clockNow(this.clock),
      );

      if (
        response.status === 429 &&
        retry429 &&
        rateLimitRetries === 0 &&
        reason !== "QUOTA_EXCEEDED" &&
        retryAfterMs !== null &&
        retryAfterMs <= this.maxRateLimitRetryMs
      ) {
        rateLimitRetries += 1;
        await this.sleep(retryAfterMs, signal);
        forceRefresh = false;
        continue;
      }

      throw new SpotifyApiError(spotifyErrorMessage(details, response), {
        status: response.status,
        code: spotifyErrorCode(details, response.status),
        reason,
        details,
        retryAfterMs,
        method,
        url,
      });
    }
  }

  getPlaybackState({
    market,
    additionalTypes = ["track", "episode"],
    signal,
    dedupe = true,
  } = {}) {
    return this.request("me/player", {
      query: { market, additional_types: additionalTypes },
      signal,
      dedupeKey: dedupe
        ? `playback-state:${market ?? ""}:${additionalTypes.join(",")}`
        : undefined,
    });
  }

  getAvailableDevices({ signal } = {}) {
    return this.request("me/player/devices", { signal });
  }

  getCurrentUserProfile({ signal } = {}) {
    return this.request("me", { signal, dedupeKey: "current-user-profile" });
  }

  getCurrentUserPlaylists({ limit = 50, offset = 0, signal } = {}) {
    return this.request("me/playlists", {
      query: { limit, offset },
      signal,
    });
  }

  getPlaylist(playlistId, { market, signal } = {}) {
    return this.request(`playlists/${assertSpotifyId(playlistId, "Playlist")}`, {
      query: { market },
      signal,
    });
  }

  getPlaylistItems(
    playlistId,
    {
      limit = 50,
      offset = 0,
      market,
      additionalTypes = ["track", "episode"],
      signal,
    } = {},
  ) {
    return this.request(`playlists/${assertSpotifyId(playlistId, "Playlist")}/items`, {
      query: {
        limit,
        offset,
        market,
        additional_types: additionalTypes,
      },
      signal,
    });
  }

  getSavedTracks({ limit = 50, offset = 0, market, signal } = {}) {
    return this.request("me/tracks", {
      query: { limit, offset, market },
      signal,
    });
  }

  saveLibraryItems(uris, { signal } = {}) {
    const normalizedUris = assertSpotifyUris(uris, ["track"], 40);
    return this.request("me/library", {
      method: "PUT",
      query: { uris: normalizedUris },
      signal,
    });
  }

  removeLibraryItems(uris, { signal } = {}) {
    const normalizedUris = assertSpotifyUris(uris, ["track"], 40);
    return this.request("me/library", {
      method: "DELETE",
      query: { uris: normalizedUris },
      signal,
    });
  }

  checkLibraryContains(uris, { signal } = {}) {
    const normalizedUris = assertSpotifyUris(uris, ["track"], 40);
    return this.request("me/library/contains", {
      query: { uris: normalizedUris },
      signal,
    });
  }

  // Compatibility wrappers keep the rest of Spool track-oriented while using
  // Spotify's current generic library endpoints under the hood.
  saveTracks(trackIds, { signal } = {}) {
    const ids = assertSpotifyIds(trackIds, "Track", 40);
    return this.saveLibraryItems(ids.map((id) => `spotify:track:${id}`), { signal });
  }

  removeSavedTracks(trackIds, { signal } = {}) {
    const ids = assertSpotifyIds(trackIds, "Track", 40);
    return this.removeLibraryItems(ids.map((id) => `spotify:track:${id}`), { signal });
  }

  checkSavedTracks(trackIds, { signal } = {}) {
    const ids = assertSpotifyIds(trackIds, "Track", 40);
    return this.checkLibraryContains(ids.map((id) => `spotify:track:${id}`), { signal });
  }

  createPlaylist({ name, public: isPublic = false, collaborative = false, description = "", signal } = {}) {
    const normalizedName = String(name || "").trim();
    if (!normalizedName) throw new TypeError("A playlist name is required.");
    return this.request("me/playlists", {
      method: "POST",
      body: {
        name: normalizedName,
        public: Boolean(isPublic),
        collaborative: Boolean(collaborative),
        description: String(description || ""),
      },
      signal,
    });
  }

  changePlaylistDetails(
    playlistId,
    { name, description, public: isPublic, collaborative, signal } = {},
  ) {
    const body = {};
    if (name !== undefined) {
      const normalized = String(name || "").trim();
      if (!normalized) throw new TypeError("A playlist name cannot be empty.");
      body.name = normalized;
    }
    if (description !== undefined) body.description = String(description || "");
    if (isPublic !== undefined) body.public = Boolean(isPublic);
    if (collaborative !== undefined) body.collaborative = Boolean(collaborative);
    if (!Object.keys(body).length) return Promise.resolve(null);
    return this.request(`playlists/${assertSpotifyId(playlistId, "Playlist")}`, {
      method: "PUT",
      body,
      signal,
    });
  }

  reorderPlaylistItems(
    playlistId,
    { rangeStart, insertBefore, rangeLength = 1, snapshotId, signal } = {},
  ) {
    if (!Number.isInteger(rangeStart) || rangeStart < 0) {
      throw new RangeError("Playlist reorder range_start must be non-negative.");
    }
    if (!Number.isInteger(insertBefore) || insertBefore < 0) {
      throw new RangeError("Playlist reorder insert_before must be non-negative.");
    }
    if (!Number.isInteger(rangeLength) || rangeLength < 1) {
      throw new RangeError("Playlist reorder range_length must be positive.");
    }
    return this.request(`playlists/${assertSpotifyId(playlistId, "Playlist")}/items`, {
      method: "PUT",
      body: {
        range_start: rangeStart,
        insert_before: insertBefore,
        range_length: rangeLength,
        ...(snapshotId ? { snapshot_id: String(snapshotId) } : {}),
      },
      signal,
    });
  }

  uploadPlaylistCover(playlistId, base64Jpeg, { signal } = {}) {
    const payload = String(base64Jpeg || "").replace(/^data:image\/jpeg;base64,/iu, "");
    if (!payload) throw new TypeError("A Base64 JPEG playlist cover is required.");
    return this.request(`playlists/${assertSpotifyId(playlistId, "Playlist")}/images`, {
      method: "PUT",
      headers: { "Content-Type": "image/jpeg" },
      body: payload,
      signal,
    });
  }

  addPlaylistItems(playlistId, uris, { position, signal } = {}) {
    const normalizedUris = assertSpotifyUris(uris, ["track", "episode"], 100);
    if (position !== undefined && (!Number.isInteger(position) || position < 0)) {
      throw new RangeError("Playlist insertion position must be a non-negative integer.");
    }
    return this.request(`playlists/${assertSpotifyId(playlistId, "Playlist")}/items`, {
      method: "POST",
      query: { position },
      body: { uris: normalizedUris },
      signal,
    });
  }

  removePlaylistItems(playlistId, uris, { snapshotId, positions, signal } = {}) {
    const normalizedUris = assertSpotifyUris(uris, ["track", "episode"], 100);
    const normalizedPositions = Array.isArray(positions)
      ? positions.map((position) => {
          if (!Number.isInteger(position) || position < 0) throw new RangeError("Playlist item positions must be non-negative integers.");
          return position;
        })
      : null;
    return this.request(`playlists/${assertSpotifyId(playlistId, "Playlist")}/items`, {
      method: "DELETE",
      body: {
        items: normalizedUris.map((uri, index) => ({
          uri,
          ...(normalizedPositions?.[index] !== undefined ? { positions: [normalizedPositions[index]] } : {}),
        })),
        ...(snapshotId ? { snapshot_id: String(snapshotId) } : {}),
      },
      signal,
    });
  }

  getArtist(artistId, { signal } = {}) {
    return this.request(`artists/${assertSpotifyId(artistId, "Artist")}`, {
      signal,
    });
  }

  getArtistAlbums(
    artistId,
    {
      includeGroups = ["album", "single"],
      limit = 10,
      offset = 0,
      market,
      signal,
    } = {},
  ) {
    const allowedGroups = new Set(["album", "single", "appears_on", "compilation"]);
    if (!Array.isArray(includeGroups) || !includeGroups.length || includeGroups.some((group) => !allowedGroups.has(group))) {
      throw new TypeError("Spotify artist album groups are invalid.");
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 10) {
      throw new RangeError("Spotify artist album limit must be between 1 and 10.");
    }
    if (!Number.isInteger(offset) || offset < 0) {
      throw new RangeError("Spotify artist album offset must be non-negative.");
    }
    return this.request(`artists/${assertSpotifyId(artistId, "Artist")}/albums`, {
      query: {
        include_groups: includeGroups,
        limit,
        offset,
        market,
      },
      signal,
    });
  }

  getTrack(trackId, { market, signal } = {}) {
    return this.request(`tracks/${assertSpotifyId(trackId, "Track")}`, {
      query: { market },
      signal,
    });
  }

  getAlbum(albumId, { market, signal } = {}) {
    return this.request(`albums/${assertSpotifyId(albumId, "Album")}`, {
      query: { market },
      signal,
    });
  }

  getAlbumTracks(albumId, { limit = 50, offset = 0, market, signal } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new RangeError("Spotify album track limit must be between 1 and 50.");
    }
    if (!Number.isInteger(offset) || offset < 0) {
      throw new RangeError("Spotify album track offset must be non-negative.");
    }
    return this.request(`albums/${assertSpotifyId(albumId, "Album")}/tracks`, {
      query: { limit, offset, market },
      signal,
    });
  }

  search(
    query,
    {
      types = ["track", "album", "artist", "playlist"],
      limit = 10,
      offset = 0,
      market,
      signal,
    } = {},
  ) {
    const normalizedQuery = String(query || "").trim();
    const allowedTypes = new Set([
      "album",
      "artist",
      "playlist",
      "track",
      "show",
      "episode",
      "audiobook",
    ]);
    if (!normalizedQuery) throw new TypeError("A Spotify search query is required.");
    if (!Array.isArray(types) || !types.length || types.some((type) => !allowedTypes.has(type))) {
      throw new TypeError("Spotify search types are invalid.");
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 10) {
      throw new RangeError("Spotify search limit must be between 1 and 10.");
    }
    if (!Number.isInteger(offset) || offset < 0 || offset > 1000) {
      throw new RangeError("Spotify search offset must be between 0 and 1000.");
    }

    return this.request("search", {
      query: {
        q: normalizedQuery,
        type: types,
        limit,
        offset,
        market,
      },
      signal,
    });
  }

  transferPlayback(deviceId, { play = false, signal } = {}) {
    if (typeof deviceId !== "string" || !deviceId) {
      throw new TypeError("A Spotify device ID is required for transfer.");
    }
    return this.request("me/player", {
      method: "PUT",
      body: { device_ids: [deviceId], play: Boolean(play) },
      signal,
    });
  }

  setPlaybackVolume(volumePercent, { deviceId, signal } = {}) {
    if (!Number.isFinite(volumePercent) || volumePercent < 0 || volumePercent > 100) {
      throw new RangeError("Spotify volume must be between 0 and 100.");
    }
    return this.request("me/player/volume", {
      method: "PUT",
      query: {
        volume_percent: Math.round(volumePercent),
        ...optionalDeviceQuery(deviceId),
      },
      signal,
    });
  }

  startPlayback({
    deviceId,
    contextUri,
    uris,
    offset,
    positionMs,
    signal,
  } = {}) {
    const payload = {};
    if (contextUri && uris) {
      throw new TypeError("Playback accepts either a context or a URI list, not both.");
    }
    if (contextUri) {
      payload.context_uri = assertSpotifyUri(contextUri, [
        "album",
        "artist",
        "playlist",
      ]);
    }
    if (uris) {
      if (!Array.isArray(uris) || uris.length === 0) {
        throw new TypeError("Playback URIs must be a non-empty array.");
      }
      payload.uris = uris.map((uri) => assertSpotifyUri(uri, ["track"]));
    }
    if (offset !== undefined) {
      if (!contextUri || !offset || typeof offset !== "object" || Array.isArray(offset)) {
        throw new TypeError("A playback offset requires an album or playlist context.");
      }
      if (!/^spotify:(?:album|playlist):/u.test(contextUri)) {
        throw new TypeError("Playback offsets are only supported for album and playlist contexts.");
      }
      if (Object.hasOwn(offset, "uri")) {
        payload.offset = { uri: assertSpotifyUri(offset.uri, ["track"]) };
      } else if (Object.hasOwn(offset, "position")) {
        if (!Number.isInteger(offset.position) || offset.position < 0) {
          throw new RangeError("Playback offset position must be a non-negative integer.");
        }
        payload.offset = { position: offset.position };
      } else {
        throw new TypeError("Playback offset must contain a track URI or position.");
      }
    }
    if (positionMs !== undefined) {
      if (!Number.isFinite(positionMs) || positionMs < 0) {
        throw new RangeError("Playback position must be non-negative.");
      }
      payload.position_ms = Math.round(positionMs);
    }

    return this.request("me/player/play", {
      method: "PUT",
      query: optionalDeviceQuery(deviceId),
      body: Object.keys(payload).length ? payload : undefined,
      signal,
    });
  }

  pausePlayback({ deviceId, signal } = {}) {
    return this.request("me/player/pause", {
      method: "PUT",
      query: optionalDeviceQuery(deviceId),
      signal,
    });
  }

  skipNext({ deviceId, signal } = {}) {
    return this.request("me/player/next", {
      method: "POST",
      query: optionalDeviceQuery(deviceId),
      signal,
    });
  }

  skipPrevious({ deviceId, signal } = {}) {
    return this.request("me/player/previous", {
      method: "POST",
      query: optionalDeviceQuery(deviceId),
      signal,
    });
  }

  seek(positionMs, { deviceId, signal } = {}) {
    if (!Number.isFinite(positionMs) || positionMs < 0) {
      throw new RangeError("Seek position must be non-negative.");
    }
    return this.request("me/player/seek", {
      method: "PUT",
      query: {
        position_ms: Math.round(positionMs),
        ...optionalDeviceQuery(deviceId),
      },
      signal,
    });
  }

  setShuffle(enabled, { deviceId, signal } = {}) {
    return this.request("me/player/shuffle", {
      method: "PUT",
      query: { state: Boolean(enabled), ...optionalDeviceQuery(deviceId) },
      signal,
    });
  }

  setRepeat(mode, { deviceId, signal } = {}) {
    if (!["off", "context", "track"].includes(mode)) {
      throw new TypeError("Repeat mode must be off, context, or track.");
    }
    return this.request("me/player/repeat", {
      method: "PUT",
      query: { state: mode, ...optionalDeviceQuery(deviceId) },
      signal,
    });
  }

  getQueue({ signal } = {}) {
    return this.request("me/player/queue", { signal });
  }

  addToQueue(uri, { deviceId, signal } = {}) {
    return this.request("me/player/queue", {
      method: "POST",
      query: {
        uri: assertSpotifyUri(uri, ["track", "episode"]),
        ...optionalDeviceQuery(deviceId),
      },
      signal,
    });
  }
}

export function createSpotifyApiClient(options) {
  return new SpotifyApiClient(options);
}
