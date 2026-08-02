import { getElements } from './elements.js';
import {
  DEFAULT_COVER,
  artistText,
  artworkUrl,
  formatTime,
  playbackItem,
  renderPlaybackControls,
} from './now-playing.js';

let cleanup;

export function setupImmersive(options = {}) {
  cleanup?.();
  const elements = getElements();

  const onOpen = () => {
    const open = openImmersive();
    if (open) options.onOpen?.();
  };
  const onClose = () => {
    closeImmersive();
    options.onClose?.();
  };
  const onLyrics = () => {
    const visible = !elements.immersive?.classList.contains('with-lyrics');
    setImmersiveLyricsVisible(visible);
    options.onLyricsToggle?.(visible);
  };

  elements.immersiveButton?.addEventListener('click', onOpen);
  elements.immersiveCollapse?.addEventListener('click', onClose);
  elements.immersiveLyricsButton?.addEventListener('click', onLyrics);

  cleanup = () => {
    elements.immersiveButton?.removeEventListener('click', onOpen);
    elements.immersiveCollapse?.removeEventListener('click', onClose);
    elements.immersiveLyricsButton?.removeEventListener('click', onLyrics);
    cleanup = undefined;
  };
  return cleanup;
}

export function renderImmersive(playback = {}) {
  const elements = getElements();
  const item = playbackItem(playback);
  const title = item?.title || item?.name || 'Nothing playing';
  const artist = item ? artistText(item) || 'Unknown artist' : playback.emptyMessage || 'Connect Spotify to start';
  const cover = item ? artworkUrl(item) : DEFAULT_COVER;
  const duration = Math.max(0, Number(playback.durationMs || item?.durationMs || item?.duration_ms) || 0);
  const position = Math.min(duration, Math.max(0, Number(playback.positionMs) || 0));
  const percent = duration ? `${(position / duration) * 100}%` : '0%';

  if (elements.immersiveTitle) elements.immersiveTitle.textContent = title;
  if (elements.immersiveArtist) elements.immersiveArtist.textContent = artist;
  if (elements.immersiveArtwork) {
    elements.immersiveArtwork.src = cover;
    elements.immersiveArtwork.alt = item ? `${title} artwork` : '';
  }
  if (elements.immersiveBackground) {
    elements.immersiveBackground.style.backgroundImage = item ? `url("${cssUrl(cover)}")` : 'none';
  }
  if (elements.immersiveSeekFill) elements.immersiveSeekFill.style.width = percent;
  if (elements.immersiveSeekKnob) elements.immersiveSeekKnob.style.left = percent;
  if (elements.immersiveCurrentTime) elements.immersiveCurrentTime.textContent = formatTime(position);
  if (elements.immersiveDuration) elements.immersiveDuration.textContent = `-${formatTime(Math.max(0, duration - position))}`;
  if (elements.immersiveSeek) {
    elements.immersiveSeek.setAttribute('aria-valuemax', String(Math.round(duration)));
    elements.immersiveSeek.setAttribute('aria-valuenow', String(Math.round(position)));
    elements.immersiveSeek.setAttribute('aria-valuetext', `${formatTime(position)} of ${formatTime(duration)}`);
  }
  renderPlaybackControls(playback);
}

export function openImmersive() {
  const elements = getElements();
  if (!elements.immersive || elements.body?.classList.contains('hidden-mode')) return false;
  elements.immersive.classList.add('show');
  elements.immersive.setAttribute('aria-hidden', 'false');
  elements.immersiveButton?.classList.add('active');
  elements.immersiveButton?.setAttribute('aria-pressed', 'true');
  if (elements.background) elements.background.style.opacity = '0';
  document.dispatchEvent(new CustomEvent('spoot:immersive-change', { detail: { open: true } }));
  return true;
}

export function closeImmersive() {
  const elements = getElements();
  if (!elements.immersive) return;
  elements.immersive.classList.remove('show');
  elements.immersive.setAttribute('aria-hidden', 'true');
  elements.immersiveButton?.classList.remove('active');
  elements.immersiveButton?.setAttribute('aria-pressed', 'false');
  if (elements.background) elements.background.style.opacity = '';
  document.dispatchEvent(new CustomEvent('spoot:immersive-change', { detail: { open: false } }));
}

export function toggleImmersive() {
  const { immersive } = getElements();
  return immersive?.classList.contains('show') ? (closeImmersive(), false) : openImmersive();
}

export function setImmersiveLyricsVisible(visible) {
  const elements = getElements();
  elements.immersive?.classList.toggle('with-lyrics', visible);
  elements.immersiveLyricsButton?.classList.toggle('active', visible);
  elements.immersiveLyricsButton?.setAttribute('aria-pressed', String(visible));
}

export function isImmersiveOpen() {
  return Boolean(getElements().immersive?.classList.contains('show'));
}

function cssUrl(url) {
  return String(url).replace(/["\\\n\r]/g, '\\$&');
}
