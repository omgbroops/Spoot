import { DEFAULT_COVER, artistText, artworkUrl } from "./now-playing.js";

let handlers = {};
let cleanup;
let lastSourceId = null;
let dragState = null;

export function setupLibrary(nextHandlers = {}) {
  cleanup?.();
  handlers = { ...nextHandlers };
  const content = document.getElementById("library-content");
  const back = document.getElementById("library-back");
  const refresh = document.getElementById("library-refresh");
  if (!content) return () => {};

  const onClick = (event) => {
    const edit = event.target.closest("[data-library-edit-playlist]");
    if (edit) return handlers.onEditPlaylist?.(edit.dataset.libraryEditPlaylist);

    const remove = event.target.closest("[data-library-remove-index]");
    if (remove) {
      return handlers.onRemovePlaylistItem?.({
        sourceId: remove.dataset.librarySourceId,
        index: Number(remove.dataset.libraryRemoveIndex),
      });
    }

    const deleteLocal = event.target.closest("[data-library-delete-local]");
    if (deleteLocal) return handlers.onDeleteLocal?.(deleteLocal.dataset.libraryDeleteLocal);

    const source = event.target.closest("[data-library-source]");
    if (source && !source.disabled) {
      lastSourceId = source.dataset.librarySource;
      return handlers.onSelectSource?.(lastSourceId);
    }
    const playSource = event.target.closest("[data-library-play-source]");
    if (playSource && !playSource.disabled) {
      return handlers.onPlaySource?.({
        contextUri: playSource.dataset.libraryPlaySource || null,
        localSourceId: playSource.dataset.libraryLocalSource || null,
        hybridPlaylistId: playSource.dataset.libraryHybridPlaylist || null,
        hybridPosition: optionalInteger(playSource.dataset.libraryHybridPosition),
        contextOnly: !playSource.dataset.libraryLocalSource && !playSource.dataset.libraryHybridPlaylist,
      });
    }
    const artist = event.target.closest("[data-library-open-artist]");
    if (artist && !artist.disabled) return handlers.onOpenArtist?.({ id: artist.dataset.libraryOpenArtist });
    const album = event.target.closest("[data-library-open-album]");
    if (album && !album.disabled) return handlers.onOpenAlbum?.({ id: album.dataset.libraryOpenAlbum });
    const add = event.target.closest("[data-library-add-playlist]");
    if (add && !add.disabled) {
      return handlers.onAddToPlaylist?.({
        id: add.dataset.libraryTrackId || null,
        localId: add.dataset.libraryLocalId || null,
        uri: add.dataset.libraryAddPlaylist || null,
        title: add.dataset.libraryTrackTitle || "Song",
      });
    }
    const track = event.target.closest("[data-library-play]");
    if (track && !track.disabled) {
      return handlers.onPlay?.({
        uri: track.dataset.libraryPlay,
        contextUri: track.dataset.libraryContext || null,
        contextPosition: optionalInteger(track.dataset.libraryPosition),
        hybridPlaylistId: track.dataset.libraryHybridPlaylist || null,
        hybridPosition: optionalInteger(track.dataset.libraryHybridPosition),
        sourceKind: track.dataset.librarySourceKind || null,
        localId: track.dataset.libraryLocalId || null,
      });
    }
    if (event.target.closest("[data-library-back]")) return handlers.onBack?.();
    if (event.target.closest("[data-library-more]")) return handlers.onLoadMore?.();
    if (event.target.closest("[data-library-refresh]")) return handlers.onRefresh?.();
  };

  const onDragStart = (event) => {
    const row = event.target.closest("[data-library-drag-index]");
    if (!row) return;
    dragState = {
      sourceId: row.dataset.librarySourceId,
      fromIndex: Number(row.dataset.libraryDragIndex),
    };
    row.classList.add("dragging-row");
    event.dataTransfer?.setData("text/plain", String(dragState.fromIndex));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  };
  const onDragOver = (event) => {
    if (!dragState) return;
    const row = event.target.closest("[data-library-drag-index]");
    if (!row || row.dataset.librarySourceId !== dragState.sourceId) return;
    event.preventDefault();
    content.querySelectorAll(".drag-over").forEach((node) => node.classList.remove("drag-over"));
    row.classList.add("drag-over");
  };
  const onDrop = (event) => {
    const row = event.target.closest("[data-library-drag-index]");
    if (!row || !dragState || row.dataset.librarySourceId !== dragState.sourceId) return;
    event.preventDefault();
    const payload = {
      sourceId: dragState.sourceId,
      fromIndex: dragState.fromIndex,
      toIndex: Number(row.dataset.libraryDragIndex),
    };
    dragState = null;
    content.querySelectorAll(".dragging-row,.drag-over").forEach((node) => node.classList.remove("dragging-row", "drag-over"));
    handlers.onReorderPlaylistItem?.(payload);
  };
  const onDragEnd = () => {
    dragState = null;
    content.querySelectorAll(".dragging-row,.drag-over").forEach((node) => node.classList.remove("dragging-row", "drag-over"));
  };

  const onBack = () => handlers.onBack?.();
  const onRefresh = () => handlers.onRefresh?.();
  content.addEventListener("click", onClick);
  content.addEventListener("dragstart", onDragStart);
  content.addEventListener("dragover", onDragOver);
  content.addEventListener("drop", onDrop);
  content.addEventListener("dragend", onDragEnd);
  back?.addEventListener("click", onBack);
  refresh?.addEventListener("click", onRefresh);
  cleanup = () => {
    content.removeEventListener("click", onClick);
    content.removeEventListener("dragstart", onDragStart);
    content.removeEventListener("dragover", onDragOver);
    content.removeEventListener("drop", onDrop);
    content.removeEventListener("dragend", onDragEnd);
    back?.removeEventListener("click", onBack);
    refresh?.removeEventListener("click", onRefresh);
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
  note.textContent = "Spotify playlists are loaded only when opened. Local Files and Spoot-only placements stay in this browser.";
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
  content.append(detailHeader(source, total, durationMs, complete, items));
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
  meta.textContent = [source.kind === "liked" ? "Saved songs" : source.kind === "local" ? "Stored in this browser" : source.ownerName, count].filter(Boolean).join(" · ");
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

function detailHeader(source, total, durationMs, complete, items) {
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
  if ((source.kind === "playlist" && source.uri) || source.kind === "local" || source.kind === "liked") {
    const firstPlayable = items.findIndex((item) => item?.playable && item?.uri);
    const play = document.createElement("button");
    play.type = "button";
    play.className = "btn primary";
    play.dataset.libraryPlaySource = source.uri || "";
    play.dataset.libraryHybridPlaylist = source.id;
    play.dataset.libraryHybridPosition = String(Math.max(0, firstPlayable));
    if (source.kind === "local") play.dataset.libraryLocalSource = source.id;
    play.textContent = source.kind === "local" ? "Play local files" : source.kind === "liked" ? "Play Liked Songs" : "Play playlist";
    play.disabled = firstPlayable < 0;
    actions.append(play);
  }
  if (source.kind === "playlist" && source.owned) {
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "btn";
    edit.dataset.libraryEditPlaylist = source.id;
    edit.textContent = "Edit details";
    actions.append(edit);
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
  const actions = document.createElement("span");
  const playable = Boolean(entry.playable && entry.uri);
  const local = Boolean(entry.isLocal || String(entry.uri || "").startsWith("spoot:local:"));
  const canModify = source.kind === "playlist" && (source.owned || source.collaborative);
  row.className = `library-track${playable ? "" : " unavailable"}${currentUri && entry.uri === currentUri ? " playing" : ""}`;
  row.title = entry.unavailableReason || `Play ${entry.title}`;
  image.className = "library-track-cover";
  image.src = artworkUrl(entry.item || entry) || entry.artworkUrl || DEFAULT_COVER;
  image.alt = "";
  image.loading = "lazy";
  image.draggable = false;

  copy.className = "library-track-copy";
  title.type = "button";
  title.className = "catalog-track-title";
  title.textContent = entry.title || "Unknown song";
  title.disabled = !playable;
  if (playable) {
    title.dataset.libraryPlay = entry.uri;
    if (source.uri) title.dataset.libraryContext = source.uri;
    if (Number.isInteger(entry.spotifyPosition ?? entry.position)) title.dataset.libraryPosition = String(entry.spotifyPosition ?? entry.position);
    title.dataset.librarySourceKind = source.kind;
    title.dataset.libraryHybridPlaylist = source.id;
    title.dataset.libraryHybridPosition = String(index);
    if (local) title.dataset.libraryLocalId = entry.localId || entry.id;
  }
  meta.className = "catalog-link-row";
  appendArtistLinks(meta, entry);
  copy.append(title, meta);

  album.type = "button";
  album.className = "library-track-album catalog-text-link";
  album.textContent = entry.albumName || (local ? "Local Files" : "—");
  if (entry.albumId) album.dataset.libraryOpenAlbum = entry.albumId;
  else album.disabled = true;

  duration.className = "library-track-duration";
  duration.textContent = formatTrackDuration(entry.durationMs);
  actions.className = "library-track-actions";
  if (/^(?:spotify:track|spoot:local):/u.test(entry.uri || "")) {
    const add = actionButton("Add to playlist", plusIcon());
    add.dataset.libraryAddPlaylist = entry.uri;
    add.dataset.libraryTrackId = entry.id || "";
    add.dataset.libraryLocalId = entry.localId || "";
    add.dataset.libraryTrackTitle = entry.title || "Song";
    actions.append(add);
  }
  if (source.kind === "local" && local) {
    const remove = actionButton("Delete local file", removeIcon());
    remove.dataset.libraryDeleteLocal = entry.localId || entry.id;
    actions.append(remove);
  } else if (canModify || source.kind === "liked") {
    const remove = actionButton("Remove from playlist", removeIcon());
    remove.dataset.libraryRemoveIndex = String(index);
    remove.dataset.librarySourceId = source.id;
    actions.append(remove);
  }

  if (canModify) {
    row.draggable = true;
    row.dataset.libraryDragIndex = String(index);
    row.dataset.librarySourceId = source.id;
  }
  row.append(image, copy, album, duration, actions);
  return row;
}

function appendArtistLinks(container, entry) {
  const artists = entry.artists || entry.item?.artists || [];
  if (!artists.length) {
    container.textContent = artistText(entry.item || entry) || "Unknown artist";
    return;
  }
  artists.forEach((artist, index) => {
    if (index) container.append(document.createTextNode(", "));
    const button = document.createElement("button");
    button.type = "button";
    button.className = "catalog-text-link";
    button.textContent = artist.name || "Unknown artist";
    if (artist.id) button.dataset.libraryOpenArtist = artist.id;
    else button.disabled = true;
    container.append(button);
  });
}

function trackHeader() {
  const row = document.createElement("div");
  row.className = "library-track-head";
  row.innerHTML = "<span></span><span>Title</span><span>Album</span><span>Time</span><span></span>";
  return row;
}

function actionButton(label, icon) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "track-action-button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.innerHTML = icon;
  return button;
}

function plusIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 5v14M5 12h14"/></svg>';
}

function removeIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M18 6 6 18M6 6l12 12"/></svg>';
}

function sourceCover(source, className) {
  const image = document.createElement("img");
  image.className = className;
  image.src = source.artworkUrl || (source.kind === "liked" ? likedCover() : DEFAULT_COVER);
  image.alt = "";
  image.loading = "lazy";
  image.draggable = false;
  return image;
}

function likedCover() {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><defs><linearGradient id="g" x1="0" y1="1" x2="1" y2="0"><stop stop-color="#5d35e8"/><stop offset="1" stop-color="#a8c7ff"/></linearGradient></defs><rect width="128" height="128" rx="22" fill="url(#g)"/><path d="M64 91 31 59c-18-18 9-43 27-25l6 6 6-6c18-18 45 7 27 25Z" fill="white"/></svg>')}`;
}

function libraryMessage(text) {
  const node = document.createElement("div");
  node.className = "empty library-message";
  node.textContent = text;
  return node;
}

function errorMessage(text) {
  return libraryMessage(text || "Your library is temporarily unavailable.");
}

function openSpotifyLink(url) {
  const link = document.createElement("a");
  link.className = "btn library-open-spotify";
  link.href = url;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = "Open in Spotify";
  return link;
}

function setBackVisible(visible) {
  const back = document.getElementById("library-back");
  if (back) back.hidden = !visible;
}

function scheduleFocus(getTarget) {
  requestAnimationFrame(() => getTarget()?.focus?.({ preventScroll: true }));
}

function optionalInteger(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

export function formatTrackDuration(durationMs) {
  const seconds = Math.max(0, Math.floor((Number(durationMs) || 0) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function formatCollectionDuration(durationMs) {
  const seconds = Math.max(0, Math.floor((Number(durationMs) || 0) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  if (hours) return `${hours} hr ${minutes} min`;
  if (minutes) return `${minutes} min ${remainder} sec`;
  return `${remainder} sec`;
}
