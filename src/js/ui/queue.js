import { getElements } from './elements.js';
import { DEFAULT_COVER, artistText, artworkUrl } from './now-playing.js';
import { directPlaybackBlockReason } from '../spotify/playability.js';

const EMPTY_MESSAGES = {
  loading: 'Loading your Spotify queue…',
  empty: 'Nothing is queued after this item.',
  unavailable: 'The Spotify queue is temporarily unavailable.',
  disconnected: 'Connect Spotify to see your queue.',
  error: 'The Spotify queue could not be loaded.',
};

let queueCleanup;

export function setupQueue({ onPlay } = {}) {
  queueCleanup?.();
  const { queueList } = getElements();
  if (!queueList) return () => {};
  const handleClick = (event) => {
    const row = event.target.closest('[data-play-uri]');
    if (!row || row.disabled) return;
    onPlay?.(row.dataset.playUri);
  };
  queueList.addEventListener('click', handleClick);
  queueCleanup = () => {
    queueList.removeEventListener('click', handleClick);
    queueCleanup = undefined;
  };
  return queueCleanup;
}

export function renderQueue(queueState = {}) {
  const { queueList, queueClear } = getElements();
  if (!queueList) return;

  const current = queueState.currentItem || queueState.current || queueState.nowPlaying || null;
  const items = Array.isArray(queueState.items)
    ? queueState.items
    : Array.isArray(queueState.upcoming)
      ? queueState.upcoming
      : Array.isArray(queueState.queue) ? queueState.queue : [];
  const status = queueState.status || (current || items.length ? 'ready' : 'empty');
  const fragment = document.createDocumentFragment();

  queueList.setAttribute('aria-busy', String(status === 'loading'));

  if (current) {
    fragment.append(sectionLabel('Now playing'));
    fragment.append(createQueueRow(current, { playing: true, removable: false }));
  }

  if (items.length) {
    fragment.append(sectionLabel('Up next'));
    items.forEach((item) => fragment.append(createQueueRow(item, { removable: true })));
  }

  queueList.replaceChildren();
  if (fragment.childNodes.length) {
    queueList.append(fragment);
  } else {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = queueState.message || EMPTY_MESSAGES[status] || EMPTY_MESSAGES.empty;
    queueList.append(empty);
  }

  if (queueClear) {
    const unavailable = !items.length;
    queueClear.classList.toggle('is-muted', unavailable);
    queueClear.setAttribute('aria-disabled', 'true');
  }
}

export function renderQueueUnavailable(message = EMPTY_MESSAGES.unavailable) {
  renderQueue({ status: 'unavailable', message });
}

export function setQueueVisible(visible) {
  const { queueWidget, dockQueue } = getElements();
  queueWidget?.classList.toggle('hidden', !visible);
  dockQueue?.classList.toggle('active', visible);
  dockQueue?.setAttribute('aria-pressed', String(visible));
}

export function createQueueRow(item, options = {}) {
  const unavailableReason = options.playing ? null : directPlaybackBlockReason(item);
  const row = document.createElement(options.playing ? 'div' : 'button');
  const type = item.contentType || item.type || 'track';
  const title = item.title || item.name || (type === 'episode' ? 'Untitled episode' : 'Untitled track');
  const subtitle = artistText(item) || item.albumName || item.album?.name || (type === 'episode' ? 'Podcast episode' : 'Unknown artist');
  const image = document.createElement('img');
  const info = document.createElement('div');
  const titleElement = document.createElement('div');
  const subtitleElement = document.createElement('div');

  row.className = `row${options.playing ? ' playing' : ''}`;
  if (!options.playing) {
    row.type = 'button';
    row.classList.add('queue-track');
    row.disabled = Boolean(unavailableReason);
    row.title = unavailableReason || `Play ${title} now`;
    row.setAttribute('aria-label', unavailableReason || `Play ${title} now`);
    if (!unavailableReason) row.dataset.playUri = item.uri;
  }
  row.dataset.itemType = type;
  if (item.uri) row.dataset.uri = item.uri;
  row.draggable = false;

  image.className = 'row-thumb';
  image.src = artworkUrl(item) || DEFAULT_COVER;
  image.alt = '';
  image.loading = 'lazy';
  image.draggable = false;

  info.className = 'row-info';
  titleElement.className = 'row-title';
  titleElement.textContent = title;
  subtitleElement.className = 'row-sub';
  subtitleElement.textContent = subtitle;
  info.append(titleElement, subtitleElement);
  row.append(image, info);

  if (!options.playing && !unavailableReason) row.append(playNowIcon());
  if (options.playing) row.append(equalizerBars());
  return row;
}

function sectionLabel(text) {
  const label = document.createElement('div');
  label.className = 'q-sec';
  label.textContent = text;
  return label;
}

function playNowIcon() {
  const icon = document.createElement('span');
  icon.className = 'row-play-now';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>';
  return icon;
}

function equalizerBars() {
  const bars = document.createElement('div');
  bars.className = 'row-eq';
  bars.setAttribute('aria-hidden', 'true');
  bars.append(document.createElement('span'), document.createElement('span'), document.createElement('span'));
  return bars;
}
