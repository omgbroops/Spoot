import { getElements } from './elements.js';

const NOTE_PATH = "<path d='M9 18V5l12-2v13'/><circle cx='6' cy='18' r='3'/><circle cx='18' cy='16' r='3'/>";
export const DEFAULT_COVER = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'><rect width='300' height='300' fill='#1b1b1f'/><g transform='translate(53,52) scale(8.1)' fill='none' stroke='rgba(247,247,248,0.34)' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'>${NOTE_PATH}</g></svg>`)}`;

export function formatTime(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor((Number(milliseconds) || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

export function artistText(item = {}) {
  if (Array.isArray(item.artistNames)) return item.artistNames.filter(Boolean).join(', ');
  if (Array.isArray(item.artists)) {
    return item.artists.map((artist) => typeof artist === 'string' ? artist : artist?.name).filter(Boolean).join(', ');
  }
  return item.artist || item.publisher || item.showName || '';
}

export function playbackItem(playback = {}) {
  return playback.currentItem || playback.item || playback.track || playback.current || null;
}

export function artworkUrl(item = {}) {
  if (item.artworkUrl) return item.artworkUrl;
  if (item.imageUrl) return item.imageUrl;
  if (Array.isArray(item.images) && item.images[0]?.url) return item.images[0].url;
  if (Array.isArray(item.album?.images) && item.album.images[0]?.url) return item.album.images[0].url;
  return DEFAULT_COVER;
}

export function renderNowPlaying(playback = {}) {
  const elements = getElements();
  const item = playbackItem(playback);
  const title = item?.title || item?.name || 'Nothing playing';
  const artist = item ? artistText(item) || 'Unknown artist' : playback.emptyMessage || 'Connect Spotify to start';
  const cover = item ? artworkUrl(item) : DEFAULT_COVER;

  if (elements.title) elements.title.textContent = title;
  if (elements.artist) elements.artist.textContent = artist;
  setImage(elements.artwork, cover, item ? `${title} artwork` : '');
  if (elements.backgroundArt) {
    elements.backgroundArt.style.backgroundImage = item ? `url("${cssUrl(cover)}")` : 'none';
    elements.backgroundArt.style.opacity = item ? '1' : '0';
  }

  renderProgress(playback.positionMs, playback.durationMs || item?.durationMs || item?.duration_ms);
  renderPlaybackControls(playback);
}

export function renderProgress(positionMs = 0, durationMs = 0) {
  const elements = getElements();
  const duration = Math.max(0, Number(durationMs) || 0);
  const position = Math.min(duration, Math.max(0, Number(positionMs) || 0));
  const percent = duration ? (position / duration) * 100 : 0;
  const width = `${percent}%`;

  if (elements.seekFill) elements.seekFill.style.width = width;
  if (elements.seekKnob) elements.seekKnob.style.left = width;
  if (elements.currentTime) elements.currentTime.textContent = formatTime(position);
  if (elements.duration) elements.duration.textContent = formatTime(duration);
  updateSlider(elements.seek, position, duration);
}

export function renderPlaybackControls(playback = {}) {
  const elements = getElements();
  const paused = playback.paused ?? !playback.isPlaying;
  elements.body?.classList.toggle('is-playing', !paused);
  setButtonLabel(elements.play, paused ? 'Play' : 'Pause');
  setButtonLabel(elements.immersivePlay, paused ? 'Play' : 'Pause');

  const shuffle = Boolean(playback.shuffleEnabled ?? playback.shuffle ?? playback.shuffleState);
  reflectToggle(elements.shuffle, shuffle, shuffle ? 'Shuffle on' : 'Shuffle');
  reflectToggle(elements.immersiveShuffle, shuffle, shuffle ? 'Shuffle on' : 'Shuffle');

  const repeatMode = normalizeRepeat(playback.repeatMode || playback.repeat || playback.repeatState);
  reflectRepeat(elements.repeat, repeatMode);
  reflectRepeat(elements.immersiveRepeat, repeatMode);
}

export function setPlaybackControlsEnabled(enabled, reason = 'Player not ready') {
  const elements = getElements();
  const controls = [
    elements.play,
    elements.previous,
    elements.next,
    elements.shuffle,
    elements.repeat,
    elements.seek,
    elements.immersivePlay,
    elements.immersivePrevious,
    elements.immersiveNext,
    elements.immersiveShuffle,
    elements.immersiveRepeat,
    elements.immersiveSeek,
  ].filter(Boolean);

  controls.forEach((control) => {
    control.toggleAttribute('disabled', !enabled && control.tagName === 'BUTTON');
    control.setAttribute('aria-disabled', String(!enabled));
    if (!enabled) control.title = reason;
  });
}

function normalizeRepeat(mode) {
  if (mode === 'track' || mode === 'one') return 'track';
  if (mode === 'context' || mode === 'all') return 'context';
  return 'off';
}

function reflectToggle(button, active, label) {
  if (!button) return;
  button.classList.toggle('active', active);
  button.setAttribute('aria-pressed', String(active));
  button.setAttribute('aria-label', label);
  button.title = label;
}

function reflectRepeat(button, mode) {
  if (!button) return;
  const active = mode !== 'off';
  const label = mode === 'track' ? 'Repeat track' : mode === 'context' ? 'Repeat context' : 'Repeat off';
  button.classList.toggle('active', active);
  button.setAttribute('aria-pressed', String(active));
  button.setAttribute('aria-label', label);
  button.title = label;
  let badge = button.querySelector('.loop1');
  if (mode === 'track') {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'loop1';
      badge.textContent = '1';
      button.append(badge);
    }
  } else {
    badge?.remove();
  }
}

function setButtonLabel(button, label) {
  if (!button) return;
  button.setAttribute('aria-label', label);
  button.title = label;
}

function setImage(image, source, alt) {
  if (!image) return;
  image.src = source || DEFAULT_COVER;
  image.alt = alt;
}

function updateSlider(slider, position, duration) {
  if (!slider) return;
  slider.setAttribute('aria-valuemax', String(Math.round(duration)));
  slider.setAttribute('aria-valuenow', String(Math.round(position)));
  slider.setAttribute('aria-valuetext', `${formatTime(position)} of ${formatTime(duration)}`);
}

function cssUrl(url) {
  return String(url).replace(/["\\\n\r]/g, '\\$&');
}
