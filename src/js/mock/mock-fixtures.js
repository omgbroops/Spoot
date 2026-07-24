export const MOCK_TRACKS = Object.freeze([
  {
    id: "mock-silver-thread",
    uri: "spotify:track:mock-silver-thread",
    type: "track",
    title: "Silver Thread",
    artists: [{ name: "Mara Vale" }],
    artistNames: ["Mara Vale"],
    artist: "Mara Vale",
    albumName: "Afterimage",
    artworkUrl: "./src/assets/mock-cover-silver.svg",
    durationMs: 221_000,
    restrictions: {},
  },
  {
    id: "mock-slow-orbit",
    uri: "spotify:track:mock-slow-orbit",
    type: "track",
    title: "Slow Orbit",
    artists: [{ name: "North Window" }],
    artistNames: ["North Window"],
    artist: "North Window",
    albumName: "Quiet Machinery",
    artworkUrl: "./src/assets/mock-cover-orbit.svg",
    durationMs: 194_000,
    restrictions: {},
  },
  {
    id: "mock-night-bus",
    uri: "spotify:episode:mock-night-bus",
    type: "episode",
    title: "The Night Bus",
    artists: [{ name: "Small Hours Radio" }],
    artistNames: ["Small Hours Radio"],
    artist: "Small Hours Radio",
    albumName: "Small Hours Radio",
    artworkUrl: "./src/assets/mock-cover-night.svg",
    durationMs: 1_482_000,
    restrictions: {},
  },
]);

export function createMockPlaybackState(item = MOCK_TRACKS[0], overrides = {}) {
  const now = Date.now();
  return {
    source: "mock",
    sdkReady: true,
    deviceReady: true,
    activeDevice: true,
    device: {
      id: "spool-mock-device",
      name: "Spool (Mock)",
      isActive: true,
      isRestricted: false,
    },
    deviceId: "spool-mock-device",
    spoolDeviceId: "spool-mock-device",
    item,
    currentItem: item,
    itemUri: item.uri,
    itemId: item.id,
    title: item.title,
    artistNames: item.artistNames,
    artist: item.artist,
    albumName: item.albumName,
    artworkUrl: item.artworkUrl,
    durationMs: item.durationMs,
    positionMs: 42_000,
    positionCapturedAt: now,
    paused: false,
    isPlaying: true,
    shuffleEnabled: false,
    repeatMode: "off",
    contentType: item.type,
    restrictions: {
      content: item.restrictions,
      deviceRestricted: false,
      disallowedActions: [],
    },
    context: null,
    authoritativeAt: now,
    playbackChangedAt: now,
    ...overrides,
  };
}

export function createMockQueue(currentIndex = 0) {
  const current = MOCK_TRACKS[currentIndex];
  return {
    nowPlaying: { ...current, nowPlaying: true, index: null },
    upcoming: MOCK_TRACKS.filter((_, index) => index !== currentIndex),
    items: MOCK_TRACKS.filter((_, index) => index !== currentIndex),
    isEmpty: false,
    receivedAt: Date.now(),
  };
}
