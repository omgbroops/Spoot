const SDK_REPEAT_MODES = ["off", "context", "track"];

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nonNegativeNumber(value, fallback = 0) {
  return Math.max(0, finiteNumber(value, fallback));
}

function firstArtworkUrl(item) {
  const images =
    item?.album?.images || item?.images || item?.show?.images || [];
  return images.find((image) => typeof image?.url === "string" && image.url)
    ?.url ?? null;
}

function normalizeArtists(item) {
  if (Array.isArray(item?.artists) && item.artists.length) {
    return item.artists
      .filter((artist) => typeof artist?.name === "string" && artist.name)
      .map((artist) => ({
        id: typeof artist.id === "string" ? artist.id : null,
        name: artist.name,
        uri: typeof artist.uri === "string" ? artist.uri : null,
      }));
  }

  if (item?.type === "episode" && item.show) {
    const name = item.show.publisher || item.show.name;
    return name
      ? [
          {
            id: typeof item.show.id === "string" ? item.show.id : null,
            name,
            uri: typeof item.show.uri === "string" ? item.show.uri : null,
          },
        ]
      : [];
  }

  return [];
}

function normalizeContentRestrictions(restrictions) {
  if (!restrictions || typeof restrictions !== "object") return null;
  const normalized = {};
  for (const [key, value] of Object.entries(restrictions)) {
    if (["string", "boolean", "number"].includes(typeof value)) {
      normalized[key] = value;
    } else if (Array.isArray(value)) {
      normalized[key] = [...value];
    }
  }
  return Object.keys(normalized).length ? normalized : null;
}

function disallowedActions(actions) {
  if (!actions || typeof actions !== "object") return [];
  return Object.entries(actions)
    .filter(([, disallowed]) => disallowed === true)
    .map(([action]) => action);
}

export function normalizeSpotifyDevice(device, fallbackId = null, active = false) {
  if (!device && !fallbackId) return null;
  return {
    id: device?.id || fallbackId || null,
    name: device?.name || null,
    type: device?.type || "computer",
    isActive: device?.is_active ?? active,
    isPrivateSession: device?.is_private_session ?? false,
    isRestricted: device?.is_restricted ?? false,
    volumePercent:
      device?.volume_percent === null || device?.volume_percent === undefined
        ? null
        : Math.min(100, Math.max(0, finiteNumber(device.volume_percent))),
    supportsVolume: device?.supports_volume ?? null,
  };
}

export function normalizePlaybackItem(item) {
  if (!item || typeof item !== "object") return null;

  const artists = normalizeArtists(item);
  const type = item.type || (item.show ? "episode" : "track");
  const albumName =
    type === "episode" ? item.show?.name ?? null : item.album?.name ?? null;

  return {
    id: typeof item.id === "string" ? item.id : null,
    uri: typeof item.uri === "string" ? item.uri : null,
    type,
    title: typeof item.name === "string" ? item.name : "",
    artists,
    artistNames: artists.map((artist) => artist.name),
    artist: artists.map((artist) => artist.name).join(", "),
    albumName,
    artworkUrl: firstArtworkUrl(item),
    durationMs: nonNegativeNumber(item.duration_ms),
    explicit: Boolean(item.explicit),
    isPlayable:
      typeof item.is_playable === "boolean" ? item.is_playable : null,
    isLocal: Boolean(item.is_local),
    externalUrl: item.external_urls?.spotify ?? null,
    restrictions: normalizeContentRestrictions(item.restrictions),
  };
}

export function createEmptyPlaybackState({
  source = "none",
  receivedAt = Date.now(),
  sdkReady = false,
  deviceId = null,
  activeDevice = false,
} = {}) {
  const device = normalizeSpotifyDevice(null, deviceId, activeDevice);
  return {
    source,
    sdkReady: Boolean(sdkReady),
    deviceReady: Boolean(deviceId),
    activeDevice: Boolean(device?.isActive),
    device,
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
    positionCapturedAt: receivedAt,
    isPlaying: false,
    paused: true,
    shuffleEnabled: false,
    repeatMode: "off",
    contentType: null,
    restrictions: {
      content: null,
      deviceRestricted: Boolean(device?.isRestricted),
      disallowedActions: [],
    },
    context: null,
    authoritativeAt: receivedAt,
    playbackChangedAt: null,
  };
}

function stateWithItem(base, item) {
  return {
    ...base,
    item,
    currentItem: item,
    itemUri: item?.uri ?? null,
    itemId: item?.id ?? null,
    title: item?.title ?? "",
    artistNames: item ? [...item.artistNames] : [],
    artist: item?.artist ?? "",
    albumName: item?.albumName ?? null,
    artworkUrl: item?.artworkUrl ?? null,
    durationMs: item?.durationMs ?? base.durationMs,
    contentType: item?.type ?? base.contentType,
  };
}

export function normalizeApiPlaybackState(
  payload,
  { receivedAt = Date.now(), sdkReady = false } = {},
) {
  if (!payload || typeof payload !== "object") {
    return createEmptyPlaybackState({
      source: "api",
      receivedAt,
      sdkReady,
    });
  }

  const item = normalizePlaybackItem(payload.item);
  const device = normalizeSpotifyDevice(payload.device);
  const positionMs = nonNegativeNumber(payload.progress_ms);
  const durationMs = item?.durationMs ?? 0;
  const isPlaying = Boolean(payload.is_playing);
  const actions = disallowedActions(payload.actions);
  const base = createEmptyPlaybackState({
    source: "api",
    receivedAt,
    sdkReady,
    deviceId: device?.id,
    activeDevice: Boolean(device?.isActive),
  });

  return stateWithItem(
    {
      ...base,
      deviceReady: Boolean(device),
      activeDevice: Boolean(device?.isActive),
      device,
      durationMs,
      positionMs: durationMs ? Math.min(positionMs, durationMs) : positionMs,
      positionCapturedAt: receivedAt,
      isPlaying,
      paused: !isPlaying,
      shuffleEnabled: Boolean(payload.shuffle_state),
      repeatMode: ["off", "context", "track"].includes(payload.repeat_state)
        ? payload.repeat_state
        : "off",
      contentType: payload.currently_playing_type ?? item?.type ?? null,
      restrictions: {
        content: item?.restrictions ?? null,
        deviceRestricted: Boolean(device?.isRestricted),
        disallowedActions: actions,
      },
      context: payload.context
        ? {
            type: payload.context.type ?? null,
            uri: payload.context.uri ?? null,
            href: payload.context.href ?? null,
          }
        : null,
      authoritativeAt: receivedAt,
      playbackChangedAt: Number.isFinite(Number(payload.timestamp))
        ? Number(payload.timestamp)
        : null,
    },
    item,
  );
}

export function normalizeSdkPlaybackState(
  payload,
  {
    receivedAt = Date.now(),
    deviceId = null,
    sdkReady = true,
    activeDevice = true,
  } = {},
) {
  if (!payload || typeof payload !== "object") {
    return createEmptyPlaybackState({
      source: "sdk",
      receivedAt,
      sdkReady,
      deviceId,
      activeDevice,
    });
  }

  const item = normalizePlaybackItem(payload.track_window?.current_track);
  const durationMs = Math.max(
    item?.durationMs ?? 0,
    nonNegativeNumber(payload.duration),
  );
  const positionMs = nonNegativeNumber(payload.position);
  const paused = payload.paused !== false;
  const sdkRestrictions = normalizeContentRestrictions(payload.restrictions);
  const base = createEmptyPlaybackState({
    source: "sdk",
    receivedAt,
    sdkReady,
    deviceId,
    activeDevice,
  });

  return stateWithItem(
    {
      ...base,
      durationMs,
      positionMs: durationMs ? Math.min(positionMs, durationMs) : positionMs,
      positionCapturedAt: receivedAt,
      isPlaying: !paused,
      paused,
      shuffleEnabled: Boolean(payload.shuffle),
      repeatMode:
        SDK_REPEAT_MODES[finiteNumber(payload.repeat_mode, 0)] ?? "off",
      contentType: item?.type ?? null,
      restrictions: {
        content: item?.restrictions ?? sdkRestrictions,
        deviceRestricted: false,
        disallowedActions: disallowedActions(payload.disallows),
      },
      context: payload.context
        ? {
            uri: payload.context.uri ?? null,
            metadata: payload.context.metadata ?? null,
          }
        : null,
      authoritativeAt: receivedAt,
      playbackChangedAt: null,
    },
    item,
  );
}

export function interpolateProgress(state, now = Date.now()) {
  if (!state) return 0;

  const basePosition = nonNegativeNumber(state.positionMs);
  const duration = nonNegativeNumber(state.durationMs);
  const capturedAt = finiteNumber(
    state.positionCapturedAt,
    finiteNumber(state.authoritativeAt, now),
  );
  const elapsed = state.isPlaying ? Math.max(0, now - capturedAt) : 0;
  const position = basePosition + elapsed;
  return duration > 0 ? Math.min(position, duration) : position;
}

export function withInterpolatedProgress(state, now = Date.now()) {
  if (!state) return state;
  return { ...state, positionMs: interpolateProgress(state, now) };
}
