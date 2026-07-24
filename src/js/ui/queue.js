import { getElements } from './elements.js';
import { DEFAULT_COVER, artistText, artworkUrl } from './now-playing.js';

const EMPTY_MESSAGES = {
  loading: 'Loading your Spotify queue…',
  empty: 'Nothing is queued after this item.',
  unavailable: 'The Spotify queue is temporarily unavailable.',
  disconnected: 'Connect Spotify to see your queue.',
  error: 'The Spotify queue could not be loaded.',
};

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
  const row = document.createElement('div');
  const type = item.contentType || item.type || 'track';
  const title = item.title || item.name || (type === 'episode' ? 'Untitled episode' : 'Untitled track');
  const subtitle = artistText(item) || item.albumName || item.album?.name || (type === 'episode' ? 'Podcast episode' : 'Unknown artist');
  const image = document.createElement('img');
  const info = document.createElement('div');
  const titleElement = document.createElement('div');
  const subtitleElement = document.createElement('div');

  row.className = `row${options.playing ? ' playing' : ''}`;
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

  if (options.removable) row.append(inactiveRemoveButton());
  if (options.playing) row.append(equalizerBars());
  return row;
}

function sectionLabel(text) {
  const label = document.createElement('div');
  label.className = 'q-sec';
  label.textContent = text;
  return label;
}

function inactiveRemoveButton() {
  const buttons = document.createElement('div');
  const button = document.createElement('button');
  buttons.className = 'row-btns';
  button.className = 'mini-btn inactive-control';
  button.type = 'button';
  button.dataset.inactiveFeature = 'Removing Spotify queue items';
  button.setAttribute('aria-disabled', 'true');
  button.setAttribute('aria-label', 'Removing Spotify queue items is not connected in this pass');
  button.title = 'Removing Spotify queue items is not connected in this pass';
  button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  buttons.append(button);
  return buttons;
}

function equalizerBars() {
  const bars = document.createElement('div');
  bars.className = 'row-eq';
  bars.setAttribute('aria-hidden', 'true');
  bars.append(document.createElement('span'), document.createElement('span'), document.createElement('span'));
  return bars;
}
