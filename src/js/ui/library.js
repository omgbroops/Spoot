import { DEFAULT_COVER, artistText, artworkUrl } from "./now-playing.js";

let handlers = {};
let cleanup;
let lastSourceId = null;

export function setupLibrary(nextHandlers = {}) {
  cleanup?.();
  handlers = { ...nextHandlers };
  const content = document.getElementById("library-content");
  const back = document.getElementById("library-back");
  if (!content) return () => {};
  const onClick = (event) => {
    const source = event.target.closest("[data-library-source]");
    if (source && !source.disabled) {
      lastSourceId = source.dataset.librarySource;
      return handlers.onSelectSource?.(lastSourceId);
    }
    const playSource = event.target.closest("[data-library-play-source]");
    if (playSource && !playSource.disabled) {
      return handlers.onPlaySource?.({
        contextUri: playSource.dataset.libraryPlaySource || null,
        contextOnly: true,
      });
    }
    const artist = event.target.closest("[data-library-open-artist]");
    if (artist && !artist.disabled) return handlers.onOpenArtist?.({ id: artist.dataset.libraryOpenArtist });
    const album = event.target.closest("[data-library-open-album]");
    if (album && !album.disabled) return handlers.onOpenAlbum?.({ id: album.dataset.libraryOpenAlbum });
    const track = event.target.closest("[data-library-play]");
    if (track && !track.disabled) {
      return handlers.onPlay?.({
        uri: track.dataset.libraryPlay,
        contextUri: track.dataset.libraryContext || null,
        contextPosition: optionalInteger(track.dataset.libraryPosition),
        sourceKind: track.dataset.librarySourceKind || null,
      });
    }
    if (event.target.closest("[data-library-back]")) return handlers.onBack?.();
    if (event.target.closest("[data-library-more]")) return handlers.onLoadMore?.();
    if (event.target.closest("[data-library-refresh]")) return handlers.onRefresh?.();
  };
  const onBack = () => handlers.onBack?.();
  content.addEventListener("click", onClick);
  back?.addEventListener("click", onBack);
  cleanup = () => {
    content.removeEventListener("click", onClick);
    back?.removeEventListener("click", onBack);
    handlers = {};
    cleanup = undefined;
  };
  return cleanup;
}

export function renderLibrarySources({ status = "ready", sources = [], message } = {}) {
  const content = document.getElementById("library-content");
  if (!content) return;
  setBackVisible(false);
  content.replaceChildren();
  if (status === "loading") return content.append(libraryMessage("Loading your Spotify library…"));
  if (status === "error") return content.append(errorMessage(message));

  const list = document.createElement("div");
  list.className = "library-sources";
  for (const source of sources) list.append(sourceRow(source));
  content.append(list);
  if (!sources.length) content.append(libraryMessage("No playlists were returned by Spotify."));

  const note = document.createElement("p");
  note.className = "library-api-note";
  note.textContent = "Spotify returns playlists as a flat list. Playlist folders and DJ are not exposed to third-party apps.";
  content.append(note);
  if (lastSourceId) scheduleFocus(() => (
    [...content.querySelectorAll("[data-library-source]")]
      .find((row) => row.dataset.librarySource === lastSourceId)
  ));
}

export function renderLibraryDetail({
  source,
  status = "ready",
  items = [],
  total = 0,
  nextOffset = null,
  durationMs = null,
  complete = true,
  message,
  currentUri = null,
} = {}) {
  const content = document.getElementById("library-content");
  if (!content || !source) return;
  setBackVisible(true);
  content.replaceChildren();
  content.append(detailHeader(source, total, durationMs, complete));
  if (status === "loading") scheduleFocus(() => document.getElementById("library-back"));
  if (status === "loading") return content.append(libraryMessage("Loading songs…"));
  if (status === "error" || message) {
    content.append(libraryMessage(message || "This playlist could not be loaded."));
    if (source.externalUrl) content.append(openSpotifyLink(source.externalUrl));
    return;
  }

  if (items.length) content.append(trackHeader());
  const list = document.createElement("div");
  list.className = "library-tracks";
  items.forEach((entry, index) => list.append(trackRow(entry, source, index, currentUri)));
  content.append(list);
  if (!items.length) content.append(libraryMessage("There are no songs available here."));
  if (nextOffset !== null) {
    const more = document.createElement("button");
    more.className = "btn library-more";
    more.type = "button";
    more.dataset.libraryMore = "";
    more.textContent = "Load more";
    content.append(more);
  }
}

function sourceRow(source) {
  const row = document.createElement("button");
  const copy = document.createElement("span");
  const title = document.createElement("strong");
  const meta = document.createElement("span");
  row.type = "button";
  row.className = `library-source${source.canBrowse ? "" : " unavailable"}`;
  row.disabled = !source.canBrowse;
  row.dataset.librarySource = source.id;
  row.title = source.unavailableReason || `Open ${source.name}`;
  row.append(sourceCover(source, "library-source-cover"));
  copy.className = "library-source-copy";
  title.textContent = source.name;
  const count = Number.isFinite(source.total) ? `${source.total} song${source.total === 1 ? "" : "s"}` : null;
  meta.textContent = [source.kind === "liked" ? "Saved songs" : source.ownerName, count].filter(Boolean).join(" · ");
  copy.append(title, meta);
  row.append(copy);
  if (!source.canBrowse) {
    const locked = document.createElement("span");
    locked.className = "library-lock";
    locked.textContent = "Metadata only";
    row.append(locked);
  }
  return row;
}

function detailHeader(source, total, durationMs, complete) {
  const header = document.createElement("div");
  const copy = document.createElement("div");
  const title = document.createElement("h2");
  const meta = document.createElement("p");
  const actions = document.createElement("div");
  header.className = "library-detail-head";
  header.append(sourceCover(source, "library-detail-cover"));
  copy.className = "library-detail-copy";
  title.textContent = source.name;
  meta.textContent = [
    source.ownerName,
    Number.isFinite(total) ? `${total} song${total === 1 ? "" : "s"}` : null,
    Number.isFinite(durationMs) && (complete || durationMs > 0)
      ? `${formatCollectionDuration(durationMs)}${complete ? "" : " loaded"}`
      : null,
  ].filter(Boolean).join(" · ");
  actions.className = "library-detail-actions";
  if (source.kind === "playlist" && source.uri) {
    const play = document.createElement("button");
    play.type = "button";
    play.className = "btn primary";
    play.dataset.libraryPlaySource = source.uri;
    play.textContent = "Play playlist";
    actions.append(play);
  }
  copy.append(title, meta, actions);
  header.append(copy);
  return header;
}

function trackRow(entry, source, index, currentUri) {
  const row = document.createElement("div");
  const image = document.createElement("img");
  const copy = document.createElement("span");
  const title = document.createElement("button");
  const meta = document.createElement("span");
  const album = document.createElement("button");
  const duration = document.createElement("span");
  const playable = Boolean(entry.playable && entry.uri);
  row.className = `library-track${playable ? "" : " unavailable"}${currentUri && entry.uri === currentUri ? " playing" : ""}`;
  row.title = entry.unavailableReason || `Play ${entry.title}`;
  image.src = artworkUrl(entry.item || entry) || DEFAULT_COVER;
  image.alt = "";
  image.loading = "lazy";
  image.draggable = false;
  copy.className = "library-track-copy";
  title.type = "button";
  title.className = "catalog-track-title";
  title.disabled = !playable;
  if (playable) {
    title.dataset.libraryPlay = entry.uri;
    if (source?.uri && source.kind === "playlist") title.dataset.libraryContext = source.uri;
    title.dataset.librarySourceKind = source?.kind || "";
    title.dataset.libraryPosition = String(index);
  }
  title.textContent = entry.title || "Unavailable item";
  meta.className = "catalog-link-row";
  appendArtistLinks(meta, entry.item?.artists || entry.artists, entry.item ? artistText(entry.item) : entry.artist);
  copy.append(title, meta);
  album.type = "button";
  album.className = "catalog-text-link library-track-album";
  album.textContent = entry.albumName || "—";
  album.disabled = !entry.albumId;
  if (entry.albumId) album.dataset.libraryOpenAlbum = entry.albumId;
  duration.className = "library-track-duration";
  duration.textContent = formatTrackDuration(entry.durationMs);
  row.append(image, copy, album, duration);
  if (!playable) {
    const reason = document.createElement("span");
    reason.className = "library-item-state";
    reason.textContent = entry.item?.type === "episode" ? "Episode" : "Unavailable";
    row.append(reason);
  }
  return row;
}

function appendArtistLinks(container, artists, fallback) {
  const valid = Array.isArray(artists) ? artists.filter((artist) => artist?.name) : [];
  if (!valid.length) {
    container.textContent = fallback || "Unknown artist";
    return;
  }
  valid.forEach((artist, index) => {
    if (index) container.append(document.createTextNode(", "));
    if (!artist.id) return container.append(document.createTextNode(artist.name));
    const link = document.createElement("button");
    link.type = "button";
    link.className = "catalog-text-link";
    link.dataset.libraryOpenArtist = artist.id;
    link.textContent = artist.name;
    container.append(link);
  });
}

function trackHeader() {
  const header = document.createElement("div");
  header.className = "library-track-head";
  header.setAttribute("aria-hidden", "true");
  ["", "Title", "Album", "Time", ""].forEach((label) => {
    const cell = document.createElement("span");
    cell.textContent = label;
    header.append(cell);
  });
  return header;
}

export function formatCollectionDuration(durationMs) {
  const totalSeconds = Math.max(0, Math.floor((Number(durationMs) || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) return `${hours} hr ${minutes} min`;
  if (minutes) return `${minutes} min ${seconds} sec`;
  return `${seconds} sec`;
}

export function formatTrackDuration(durationMs) {
  const totalSeconds = Math.max(0, Math.floor((Number(durationMs) || 0) / 1000));
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

function sourceCover(source, className) {
  if (source.artworkUrl) {
    const image = document.createElement("img");
    image.className = className;
    image.src = source.artworkUrl;
    image.alt = "";
    image.loading = "lazy";
    return image;
  }
  const fallback = document.createElement("span");
  fallback.className = `${className} library-cover-fallback`;
  fallback.setAttribute("aria-hidden", "true");
  fallback.innerHTML = source.kind === "liked"
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1.1-1a5.5 5.5 0 0 0-7.8 7.8l1.1 1L12 21l7.8-7.6a5.5 5.5 0 0 0 1-8.8Z"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/></svg>';
  return fallback;
}

function libraryMessage(message) {
  const empty = document.createElement("div");
  empty.className = "empty library-message";
  empty.textContent = message;
  return empty;
}

function errorMessage(message) {
  const wrap = document.createElement("div");
  wrap.className = "library-error";
  wrap.append(libraryMessage(message || "Spotify library is temporarily unavailable."));
  const retry = document.createElement("button");
  retry.className = "btn";
  retry.type = "button";
  retry.dataset.libraryRefresh = "";
  retry.textContent = "Retry";
  wrap.append(retry);
  return wrap;
}

function openSpotifyLink(url) {
  const link = document.createElement("a");
  link.className = "btn library-open-spotify";
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "Open in Spotify";
  return link;
}

function scheduleFocus(findTarget) {
  const schedule = globalThis.requestAnimationFrame || ((callback) => setTimeout(callback, 0));
  schedule(() => findTarget()?.focus({ preventScroll: true }));
}

function setBackVisible(visible) {
  const back = document.getElementById("library-back");
  if (back) back.hidden = !visible;
}

function optionalInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}
