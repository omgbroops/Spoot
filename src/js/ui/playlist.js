import { formatCollectionDuration, formatTrackDuration } from "./library.js";
import { DEFAULT_COVER, artistText, artworkUrl } from "./now-playing.js";

let interactionCleanup;
let interactionHandlers = {};
let dragIndex = null;

export function setupPlaylistInteractions(handlers = {}) {
  interactionCleanup?.();
  interactionHandlers = { ...handlers };
  const root = document.getElementById("search-results");
  if (!root) return () => {};
  const click = (event) => {
    const edit = event.target.closest("[data-playlist-edit]");
    if (edit) return interactionHandlers.onEdit?.(edit.dataset.playlistEdit);
    const remove = event.target.closest("[data-playlist-remove-index]");
    if (remove) return interactionHandlers.onRemove?.({
      playlistId: remove.dataset.playlistId,
      index: Number(remove.dataset.playlistRemoveIndex),
    });
  };
  const dragstart = (event) => {
    const row = event.target.closest("[data-playlist-drag-index]");
    if (!row) return;
    dragIndex = Number(row.dataset.playlistDragIndex);
    row.classList.add("dragging-row");
    event.dataTransfer?.setData("text/plain", String(dragIndex));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  };
  const dragover = (event) => {
    if (dragIndex === null) return;
    const row = event.target.closest("[data-playlist-drag-index]");
    if (!row) return;
    event.preventDefault();
    row.classList.add("drag-over");
  };
  const dragleave = (event) => event.target.closest("[data-playlist-drag-index]")?.classList.remove("drag-over");
  const drop = (event) => {
    const row = event.target.closest("[data-playlist-drag-index]");
    if (!row || dragIndex === null) return;
    event.preventDefault();
    const toIndex = Number(row.dataset.playlistDragIndex);
    const playlistId = row.dataset.playlistId;
    document.querySelectorAll(".playlist-track.drag-over").forEach((entry) => entry.classList.remove("drag-over"));
    interactionHandlers.onReorder?.({ playlistId, fromIndex: dragIndex, toIndex });
    dragIndex = null;
  };
  const dragend = () => {
    dragIndex = null;
    root.querySelectorAll(".dragging-row,.drag-over").forEach((row) => row.classList.remove("dragging-row", "drag-over"));
  };
  root.addEventListener("click", click);
  root.addEventListener("dragstart", dragstart);
  root.addEventListener("dragover", dragover);
  root.addEventListener("dragleave", dragleave);
  root.addEventListener("drop", drop);
  root.addEventListener("dragend", dragend);
  interactionCleanup = () => {
    root.removeEventListener("click", click);
    root.removeEventListener("dragstart", dragstart);
    root.removeEventListener("dragover", dragover);
    root.removeEventListener("dragleave", dragleave);
    root.removeEventListener("drop", drop);
    root.removeEventListener("dragend", dragend);
  };
  return interactionCleanup;
}

export function renderPlaylist({
  container = document.getElementById("playlist-content"),
  status = "idle",
  result,
  message,
  currentUri = null,
} = {}) {
  if (!container) return;
  container.replaceChildren();
  container.setAttribute("aria-busy", String(status === "loading"));
  if (status === "loading") return container.append(playlistMessage("Loading playlist…"));
  if (status === "error") return container.append(playlistMessage(message || "This playlist is temporarily unavailable."));
  if (!result?.playlist) return container.append(playlistMessage("Choose a playlist from Search."));

  const { playlist, items = [], durationMs = 0, unavailableReason } = result;
  container.append(playlistHeader(playlist, items.length, durationMs));
  if (unavailableReason) {
    container.append(playlistMessage(unavailableReason));
    if (playlist.externalUrl) container.append(externalLink(playlist.externalUrl));
    return;
  }
  if (items.length) container.append(trackHeader());
  const list = document.createElement("div");
  list.className = "library-tracks playlist-tracks";
  items.forEach((item, index) => list.append(playlistTrackRow(item, playlist, index, currentUri)));
  container.append(list);
  if (!items.length) container.append(playlistMessage("There are no songs available in this playlist."));
}

function playlistHeader(playlist, loadedCount, durationMs) {
  const header = document.createElement("header");
  const image = document.createElement("img");
  const copy = document.createElement("div");
  const kind = document.createElement("span");
  const title = document.createElement("h2");
  const description = document.createElement("p");
  const meta = document.createElement("p");
  const actions = document.createElement("div");
  const play = document.createElement("button");
  header.className = "playlist-detail-head";
  image.className = "playlist-detail-cover";
  image.src = playlist.artworkUrl || DEFAULT_COVER;
  image.alt = "";
  image.loading = "lazy";
  image.draggable = false;
  copy.className = "playlist-detail-copy";
  kind.className = "playlist-kind";
  kind.textContent = playlist.public === false ? "Private Playlist" : "Playlist";
  title.textContent = playlist.name;
  description.className = "playlist-description";
  description.textContent = stripHtml(playlist.description);
  meta.className = "playlist-meta";
  meta.textContent = [playlist.ownerName, Number.isFinite(playlist.total) ? `${playlist.total} song${playlist.total === 1 ? "" : "s"}` : `${loadedCount} songs`, durationMs ? formatCollectionDuration(durationMs) : null].filter(Boolean).join(" · ");
  actions.className = "playlist-actions";
  play.className = "btn primary";
  play.type = "button";
  play.dataset.playlistPlay = "";
  play.dataset.playlistContext = playlist.uri || "";
  play.dataset.playlistContextOnly = "true";
  play.dataset.playlistHybridId = playlist.id || "";
  play.dataset.playlistHybridPosition = "0";
  play.disabled = !playlist.uri;
  play.textContent = "Play playlist";
  actions.append(play);
  if (playlist.owned) {
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "btn";
    edit.dataset.playlistEdit = playlist.id;
    edit.textContent = "Edit details";
    actions.append(edit);
  }
  const refresh = document.createElement("button");
  refresh.type = "button";
  refresh.className = "btn";
  refresh.dataset.catalogRefresh = "";
  refresh.textContent = "Refresh";
  actions.append(refresh);
  if (playlist.externalUrl) actions.append(externalLink(playlist.externalUrl));
  copy.append(kind, title);
  if (description.textContent) copy.append(description);
  copy.append(meta, actions);
  header.append(image, copy);
  return header;
}

function playlistTrackRow(entry, playlist, index, currentUri) {
  const row = document.createElement("div");
  const image = document.createElement("img");
  const copy = document.createElement("span");
  const title = document.createElement("button");
  const artists = document.createElement("span");
  const album = document.createElement("button");
  const duration = document.createElement("span");
  const actions = document.createElement("span");
  const playable = Boolean(entry.playable && entry.uri);
  row.className = `library-track playlist-track${playable ? "" : " unavailable"}${currentUri && entry.uri === currentUri ? " playing" : ""}`;
  row.title = entry.unavailableReason || `Play ${entry.title}`;
  row.dataset.playlistId = playlist.id || "";
  row.dataset.playlistDragIndex = String(index);
  row.draggable = Boolean(playlist.canModifyItems);
  image.src = artworkUrl(entry.item || entry) || DEFAULT_COVER;
  image.alt = "";
  image.loading = "lazy";
  image.draggable = false;
  copy.className = "library-track-copy";
  title.type = "button";
  title.className = "catalog-track-title";
  title.disabled = !playable;
  if (playable) {
    title.dataset.playlistPlay = entry.uri;
    title.dataset.playlistContext = playlist.uri || "";
    title.dataset.playlistPosition = String(Number.isInteger(entry.spotifyPosition) ? entry.spotifyPosition : index);
    title.dataset.playlistHybridId = playlist.id || "";
    title.dataset.playlistHybridPosition = String(index);
  }
  title.textContent = entry.title || "Unavailable item";
  artists.className = "catalog-link-row";
  appendArtistLinks(artists, entry.item?.artists || entry.artists, artistText(entry.item || entry));
  copy.append(title, artists);
  album.type = "button";
  album.className = "catalog-text-link library-track-album";
  album.textContent = entry.albumName || "—";
  album.disabled = !entry.albumId;
  if (entry.albumId) {
    album.dataset.catalogOpenAlbum = entry.albumId;
    album.dataset.albumOpen = entry.albumId;
  }
  duration.className = "library-track-duration";
  duration.textContent = formatTrackDuration(entry.durationMs);
  actions.className = "library-track-actions";
  if (/^(?:spotify:track|spool:local):/u.test(entry.uri || "")) {
    const add = document.createElement("button");
    add.type = "button";
    add.className = "track-action-button";
    add.dataset.catalogAddPlaylist = entry.uri;
    add.dataset.catalogTrackId = entry.id || entry.localId || entry.item?.id || "";
    add.dataset.catalogTrackTitle = entry.title || "Song";
    add.title = "Add to playlist";
    add.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 5v14M5 12h14"/></svg>';
    actions.append(add);
  }
  if (playlist.canModifyItems) {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "track-action-button";
    remove.dataset.playlistRemoveIndex = String(index);
    remove.dataset.playlistId = playlist.id || "";
    remove.title = "Remove from playlist";
    remove.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M18 6 6 18M6 6l12 12"/></svg>';
    actions.append(remove);
  }
  row.append(image, copy, album, duration, actions);
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
  if (!valid.length) return container.append(document.createTextNode(fallback || "Unknown artist"));
  valid.forEach((artist, index) => {
    if (index) container.append(document.createTextNode(", "));
    if (!artist.id) return container.append(document.createTextNode(artist.name));
    const link = document.createElement("button");
    link.type = "button";
    link.className = "catalog-text-link";
    link.dataset.playlistOpenArtist = artist.id;
    link.dataset.catalogOpenArtist = artist.id;
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

function externalLink(url) {
  const link = document.createElement("a");
  link.className = "btn playlist-open-spotify";
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "Open in Spotify";
  return link;
}

function playlistMessage(text) {
  const message = document.createElement("div");
  message.className = "empty playlist-message";
  message.textContent = text;
  return message;
}

function stripHtml(value) {
  const temp = document.createElement("div");
  temp.innerHTML = String(value || "");
  return temp.textContent || "";
}
