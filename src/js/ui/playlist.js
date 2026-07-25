import { formatCollectionDuration, formatTrackDuration } from "./library.js";
import { DEFAULT_COVER, artistText, artworkUrl } from "./now-playing.js";

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
  meta.textContent = [
    playlist.ownerName,
    Number.isFinite(playlist.total) ? `${playlist.total} song${playlist.total === 1 ? "" : "s"}` : `${loadedCount} songs`,
    durationMs ? formatCollectionDuration(durationMs) : null,
  ].filter(Boolean).join(" · ");
  actions.className = "playlist-actions";
  play.className = "btn primary";
  play.type = "button";
  play.dataset.playlistPlay = "";
  play.dataset.playlistContext = playlist.uri || "";
  play.dataset.playlistContextOnly = "true";
  play.disabled = !playlist.uri;
  play.textContent = "Play playlist";
  actions.append(play);
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
    title.dataset.playlistPlay = entry.uri;
    title.dataset.playlistContext = playlist.uri || "";
    title.dataset.playlistPosition = String(index);
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
