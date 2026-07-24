let callbacks = {};
let enabled = true;
let headphoneSkip = false;

export function setupMediaSession(nextCallbacks = {}) {
  callbacks = { ...nextCallbacks };
  installHandlers();
}

export function setMediaSessionPreferences(preferences = {}) {
  enabled = preferences.enabled !== false;
  headphoneSkip = Boolean(preferences.headphoneSkip);
  installHandlers();
  if (!enabled && typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
    navigator.mediaSession.metadata = null;
    navigator.mediaSession.playbackState = 'none';
  }
}

export function renderMediaSession(playback) {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
  const active = Boolean(enabled && playback?.activeDevice && playback?.item);
  if (!active) {
    navigator.mediaSession.metadata = null;
    navigator.mediaSession.playbackState = 'none';
    return;
  }
  const artwork = playback.artworkUrl
    ? [{ src: playback.artworkUrl }]
    : [];
  if (typeof MediaMetadata !== 'function') return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: playback.title || 'Unknown title',
    artist: playback.artist || '',
    album: playback.albumName || '',
    artwork,
  });
  navigator.mediaSession.playbackState = playback.isPlaying ? 'playing' : 'paused';
  updateMediaSessionPosition(playback.positionMs, playback.durationMs);
}

export function updateMediaSessionPosition(positionMs, durationMs) {
  if (!enabled || typeof navigator === 'undefined' || !('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
  const duration = Number(durationMs) / 1000;
  if (!Number.isFinite(duration) || duration <= 0) return;
  const position = Math.min(duration, Math.max(0, (Number(positionMs) || 0) / 1000));
  try {
    navigator.mediaSession.setPositionState({ duration, position, playbackRate: 1 });
  } catch {}
}

function installHandlers() {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
  setHandler('play', enabled ? () => callbacks.onPlay?.() : null);
  setHandler('pause', enabled ? () => callbacks.onPause?.() : null);
  setHandler('seekto', enabled ? (event) => callbacks.onSeek?.(event.seekTime) : null);
  setHandler('previoustrack', enabled && headphoneSkip ? () => callbacks.onPrevious?.() : null);
  setHandler('nexttrack', enabled && headphoneSkip ? () => callbacks.onNext?.() : null);
}

function setHandler(action, handler) {
  try {
    navigator.mediaSession.setActionHandler(action, handler);
  } catch {}
}
