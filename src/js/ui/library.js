import { DEFAULT_COVER, artistText, artworkUrl } from './now-playing.js';

let handlers = {};
let cleanup;
let lastSourceId = null;

export function setupLibrary(nextHandlers = {}) {
  cleanup?.();
  handlers = { ...nextHandlers };
  const content = document.getElementById('library-content');
  if (!content) return () => {};
  const onClick = (event) => {
    const source = event.target.closest('[data-library-source]');
    if (source && !source.disabled) {
      lastSourceId = source.dataset.librarySource;
      return handlers.onSelectSource?.(lastSourceId);
    }
    const track = event.target.closest('[data-library-play]');
    if (track && !track.disabled) return handlers.onPlay?.(track.dataset.libraryPlay);
    if (event.target.closest('[data-library-back]')) return handlers.onBack?.();
    if (event.target.closest('[data-library-more]')) return handlers.onLoadMore?.();
    if (event.target.closest('[data-library-refresh]')) return handlers.onRefresh?.();
  };
  content.addEventListener('click', onClick);
  cleanup = () => {
    content.removeEventListener('click', onClick);
    handlers = {};
    cleanup = undefined;
  };
  return cleanup;
}

export function renderLibrarySources({ status = 'ready', sources = [], message } = {}) {
  const content = document.getElementById('library-content');
  if (!content) return;
  content.replaceChildren();
  if (status === 'loading') return content.append(libraryMessage('Loading your Spotify library…'));
  if (status === 'error') return content.append(errorMessage(message));

  const list = document.createElement('div');
  list.className = 'library-sources';
  for (const source of sources) list.append(sourceRow(source));
  content.append(list);
  if (!sources.length) content.append(libraryMessage('No playlists were returned by Spotify.'));

  const note = document.createElement('p');
  note.className = 'library-api-note';
  note.textContent = 'Spotify returns playlists as a flat list. Playlist folders and DJ are not exposed to third-party apps.';
  content.append(note);
  if (lastSourceId) scheduleFocus(() => (
    [...content.querySelectorAll('[data-library-source]')]
      .find((row) => row.dataset.librarySource === lastSourceId)
  ));
}

export function renderLibraryDetail({
  source,
  status = 'ready',
  items = [],
  total = 0,
  nextOffset = null,
  message,
} = {}) {
  const content = document.getElementById('library-content');
  if (!content || !source) return;
  content.replaceChildren();
  content.append(detailHeader(source, total));
  scheduleFocus(() => content.querySelector('[data-library-back]'));
  if (status === 'loading') return content.append(libraryMessage('Loading songs…'));
  if (status === 'error' || message) {
    content.append(libraryMessage(message || 'This playlist could not be loaded.'));
    if (source.externalUrl) content.append(openSpotifyLink(source.externalUrl));
    return;
  }

  const list = document.createElement('div');
  list.className = 'library-tracks';
  for (const entry of items) list.append(trackRow(entry));
  content.append(list);
  if (!items.length) content.append(libraryMessage('There are no songs available here.'));
  if (nextOffset !== null) {
    const more = document.createElement('button');
    more.className = 'btn library-more';
    more.type = 'button';
    more.dataset.libraryMore = '';
    more.textContent = 'Load more';
    content.append(more);
  }
}

function sourceRow(source) {
  const row = document.createElement('button');
  const copy = document.createElement('span');
  const title = document.createElement('strong');
  const meta = document.createElement('span');
  row.type = 'button';
  row.className = `library-source${source.canBrowse ? '' : ' unavailable'}`;
  row.disabled = !source.canBrowse;
  row.dataset.librarySource = source.id;
  row.title = source.unavailableReason || `Open ${source.name}`;
  row.append(sourceCover(source, 'library-source-cover'));
  copy.className = 'library-source-copy';
  title.textContent = source.name;
  const count = Number.isFinite(source.total) ? `${source.total} item${source.total === 1 ? '' : 's'}` : null;
  meta.textContent = [source.kind === 'liked' ? 'Saved songs' : source.ownerName, count]
    .filter(Boolean)
    .join(' · ');
  copy.append(title, meta);
  row.append(copy);
  if (!source.canBrowse) {
    const locked = document.createElement('span');
    locked.className = 'library-lock';
    locked.textContent = 'Metadata only';
    row.append(locked);
  }
  return row;
}

function detailHeader(source, total) {
  const header = document.createElement('div');
  const back = document.createElement('button');
  const copy = document.createElement('div');
  const title = document.createElement('h2');
  const meta = document.createElement('p');
  header.className = 'library-detail-head';
  back.className = 'library-back';
  back.type = 'button';
  back.dataset.libraryBack = '';
  back.setAttribute('aria-label', 'Back to Library');
  back.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m15 18-6-6 6-6"/></svg>';
  header.append(back, sourceCover(source, 'library-detail-cover'));
  copy.className = 'library-detail-copy';
  title.textContent = source.name;
  meta.textContent = [source.ownerName, Number.isFinite(total) ? `${total} item${total === 1 ? '' : 's'}` : null]
    .filter(Boolean)
    .join(' · ');
  copy.append(title, meta);
  header.append(copy);
  return header;
}

function trackRow(entry) {
  const row = document.createElement('button');
  const image = document.createElement('img');
  const copy = document.createElement('span');
  const title = document.createElement('strong');
  const meta = document.createElement('span');
  row.type = 'button';
  row.className = `library-track${entry.playable ? '' : ' unavailable'}`;
  row.disabled = !entry.playable;
  if (entry.playable) row.dataset.libraryPlay = entry.uri;
  row.title = entry.unavailableReason || `Play ${entry.title}`;
  image.src = artworkUrl(entry.item || entry) || DEFAULT_COVER;
  image.alt = '';
  image.loading = 'lazy';
  copy.className = 'library-track-copy';
  title.textContent = entry.title || 'Unavailable item';
  meta.textContent = entry.item
    ? artistText(entry.item) || entry.albumName || 'Unknown artist'
    : entry.artist || 'Unavailable';
  copy.append(title, meta);
  row.append(image, copy);
  if (!entry.playable) {
    const reason = document.createElement('span');
    reason.className = 'library-item-state';
    reason.textContent = entry.item?.type === 'episode' ? 'Episode' : 'Unavailable';
    row.append(reason);
  }
  return row;
}

function sourceCover(source, className) {
  if (source.artworkUrl) {
    const image = document.createElement('img');
    image.className = className;
    image.src = source.artworkUrl;
    image.alt = '';
    image.loading = 'lazy';
    return image;
  }
  const fallback = document.createElement('span');
  fallback.className = `${className} library-cover-fallback`;
  fallback.setAttribute('aria-hidden', 'true');
  fallback.innerHTML = source.kind === 'liked'
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1.1-1a5.5 5.5 0 0 0-7.8 7.8l1.1 1L12 21l7.8-7.6a5.5 5.5 0 0 0 1-8.8Z"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/></svg>';
  return fallback;
}

function libraryMessage(message) {
  const empty = document.createElement('div');
  empty.className = 'empty library-message';
  empty.textContent = message;
  return empty;
}

function errorMessage(message) {
  const wrap = document.createElement('div');
  wrap.className = 'library-error';
  wrap.append(libraryMessage(message || 'Spotify library is temporarily unavailable.'));
  const retry = document.createElement('button');
  retry.className = 'btn';
  retry.type = 'button';
  retry.dataset.libraryRefresh = '';
  retry.textContent = 'Retry';
  wrap.append(retry);
  return wrap;
}

function openSpotifyLink(url) {
  const link = document.createElement('a');
  link.className = 'btn library-open-spotify';
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = 'Open in Spotify';
  return link;
}

function scheduleFocus(findTarget) {
  const schedule = globalThis.requestAnimationFrame || ((callback) => setTimeout(callback, 0));
  schedule(() => findTarget()?.focus({ preventScroll: true }));
}
