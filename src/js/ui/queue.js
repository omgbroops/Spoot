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

export function setupQueue({ onPlay, onAddToPlaylist } = {}) {
  queueCleanup?.();
  const { queueList } = getElements();
  if (!queueList) return () => {};
  const handleClick = (event) => {
    const add = event.target.closest('[data-queue-add-playlist]');
    if (add && !add.disabled) {
      event.stopPropagation();
      return onAddToPlaylist?.({
        id: add.dataset.queueTrackId || null,
        localId: add.dataset.queueLocalId || null,
        uri: add.dataset.queueAddPlaylist,
        title: add.dataset.queueTrackTitle || 'Song',
      });
    }
    const play = event.target.closest('[data-queue-play]');
    if (!play || play.disabled) return;
    onPlay?.({
      uri: play.dataset.queuePlay,
      index: Number(play.dataset.queueIndex),
    });
  };
  queueList.addEventListener('click', handleClick);
  queueCleanup = () => {
    queueList.removeEventListener('click', handleClick);
    queueCleanup = undefined;
  };
  return queueCleanup;
}

export function renderQueue(queueState = {}) {
  const { queueList } = getElements();
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
    fragment.append(createQueueRow(current, { playing: true }));
  }
  if (items.length) {
    fragment.append(sectionLabel('Up next'));
    items.forEach((item, index) => fragment.append(createQueueRow(item, { queueIndex: index })));
  }

  queueList.replaceChildren();
  if (fragment.childNodes.length) queueList.append(fragment);
  else {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = queueState.message || EMPTY_MESSAGES[status] || EMPTY_MESSAGES.empty;
    queueList.append(empty);
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
  const local = Boolean(item?.isLocal || String(item?.uri || '').startsWith('spoot:local:'));
  const unavailableReason = options.playing || local ? null : directPlaybackBlockReason(item);
  const row = document.createElement('div');
  const type = item.contentType || item.type || 'track';
  const title = item.title || item.name || (type === 'episode' ? 'Untitled episode' : 'Untitled track');
  const subtitle = artistText(item) || item.albumName || item.album?.name || (type === 'episode' ? 'Podcast episode' : 'Unknown artist');
  const image = document.createElement('img');
  const info = document.createElement('div');
  const titleElement = document.createElement('div');
  const subtitleElement = document.createElement('div');

  row.className = `row queue-row${options.playing ? ' playing' : ''}`;
  row.dataset.itemType = type;
  if (item.uri) row.dataset.uri = item.uri;

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

  if (/^(?:spotify:track|spoot:local):/u.test(item.uri || '')) row.append(queueAddButton(item));
  if (!options.playing) row.append(playButton(item, options.queueIndex, unavailableReason));
  if (options.playing) row.append(equalizerBars());
  return row;
}

function playButton(item, queueIndex, unavailableReason) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'mini-btn row-play-now';
  button.disabled = Boolean(unavailableReason);
  button.title = unavailableReason || `Play ${item.title || item.name || 'song'} now`;
  button.setAttribute('aria-label', button.title);
  if (!unavailableReason) {
    button.dataset.queuePlay = item.uri || '';
    button.dataset.queueIndex = String(queueIndex ?? 0);
  }
  button.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>';
  return button;
}

function queueAddButton(item) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'mini-btn queue-add-playlist';
  button.dataset.queueAddPlaylist = item.uri;
  button.dataset.queueTrackId = item.id || item.itemId || item.localId || '';
  button.dataset.queueLocalId = item.localId || '';
  button.dataset.queueTrackTitle = item.title || item.name || 'Song';
  button.title = 'Add to playlist';
  button.setAttribute('aria-label', `Add ${button.dataset.queueTrackTitle} to playlist`);
  button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 5v14M5 12h14"/></svg>';
  return button;
}

function sectionLabel(text) {
  const label = document.createElement('div');
  label.className = 'q-sec';
  label.textContent = text;
  return label;
}

function equalizerBars() {
  const bars = document.createElement('div');
  bars.className = 'row-eq';
  bars.setAttribute('aria-hidden', 'true');
  bars.append(document.createElement('span'), document.createElement('span'), document.createElement('span'));
  return bars;
}
