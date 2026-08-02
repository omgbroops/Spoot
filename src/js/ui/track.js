import { formatTrackDuration } from "./library.js";
import { DEFAULT_COVER } from "./now-playing.js";

let cleanup;

export function setupTrack({ onPlay, onOpenAlbum, onOpenArtist, onAddToPlaylist, onBack } = {}) {
  cleanup?.();
  const content = document.getElementById("track-content");
  const back = document.getElementById("track-back");
  if (!content) return () => {};
  const click = (event) => {
    const add = event.target.closest("[data-catalog-add-playlist]");
    if (add && !add.disabled) return onAddToPlaylist?.({ id: add.dataset.catalogTrackId || null, uri: add.dataset.catalogAddPlaylist, title: add.dataset.catalogTrackTitle || "Song" });
    const artist = event.target.closest("[data-track-open-artist]");
    if (artist && !artist.disabled) return onOpenArtist?.({ id: artist.dataset.trackOpenArtist });
    const album = event.target.closest("[data-track-open-album]");
    if (album && !album.disabled) return onOpenAlbum?.({ id: album.dataset.trackOpenAlbum });
    const play = event.target.closest("[data-track-play]");
    if (play && !play.disabled) onPlay?.({ uri: play.dataset.trackPlay });
  };
  const goBack = () => onBack?.();
  content.addEventListener("click", click);
  back?.addEventListener("click", goBack);
  cleanup = () => {
    content.removeEventListener("click", click);
    back?.removeEventListener("click", goBack);
    cleanup = undefined;
  };
  return cleanup;
}

export function renderTrack(options = {}) {
  const container = options.container || document.getElementById("track-content");
  const label = options.container ? null : document.getElementById("track-title-label");
  return renderTrackInto(container, { ...options, label });
}

export function renderTrackInto(container, { status = "idle", result, message, currentUri = null, label = null } = {}) {
  if (!container) return;
  container.replaceChildren();
  container.setAttribute("aria-busy", String(status === "loading"));
  if (status === "loading") {
    if (label) label.textContent = "Song";
    return container.append(trackMessage("Loading song…"));
  }
  if (status === "error") {
    if (label) label.textContent = "Song";
    return container.append(trackMessage(message || "This song is temporarily unavailable."));
  }
  if (!result?.track) {
    if (label) label.textContent = "Song";
    return container.append(trackMessage("Choose a song from Search."));
  }
  const track = result.track;
  const kind = track.album?.type === "single" ? "Single" : "Song";
  if (label) label.textContent = kind;
  container.append(trackHeader(track, kind), trackTableHeader(), trackRow(track, currentUri));
}

function trackHeader(track, kind) {
  const header = document.createElement("header");
  const image = document.createElement("img");
  const copy = document.createElement("div");
  const type = document.createElement("span");
  const title = document.createElement("h2");
  const artists = document.createElement("div");
  const meta = document.createElement("p");
  const actions = document.createElement("div");
  const play = document.createElement("button");
  header.className = "track-detail-head";
  image.className = "track-detail-cover";
  image.src = track.album?.artworkUrl || track.artworkUrl || DEFAULT_COVER;
  image.alt = "";
  image.loading = "lazy";
  image.draggable = false;
  copy.className = "track-detail-copy";
  type.className = "track-kind";
  type.textContent = kind;
  title.textContent = track.title || "Untitled song";
  artists.className = "track-artist catalog-link-row";
  appendArtistLinks(artists, track.artists);
  meta.className = "track-meta";
  appendTrackMeta(meta, track);
  actions.className = "track-actions";
  play.className = "btn primary";
  play.type = "button";
  play.dataset.trackPlay = track.uri || "";
  play.disabled = !track.playable || !track.uri;
  play.textContent = "Play song";
  actions.append(play);
  if (track.album?.id) {
    const release = document.createElement("button");
    release.className = "btn";
    release.type = "button";
    release.dataset.trackOpenAlbum = track.album.id;
    release.dataset.catalogOpenAlbum = track.album.id;
    release.textContent = "View release";
    actions.append(release);
  }
  if (track.externalUrl) actions.append(externalLink(track.externalUrl));
  if (/^spotify:track:/u.test(track.uri || "")) actions.append(addToPlaylistButton(track));
  copy.append(type, title, artists, meta, actions);
  header.append(image, copy);
  return header;
}

function appendTrackMeta(container, track) {
  const parts = [];
  if (track.album?.releaseYear) parts.push(document.createTextNode(track.album.releaseYear));
  if (track.album?.id) {
    const album = document.createElement("button");
    album.type = "button";
    album.className = "catalog-text-link";
    album.dataset.trackOpenAlbum = track.album.id;
    album.dataset.catalogOpenAlbum = track.album.id;
    album.textContent = track.album.name;
    parts.push(album);
  } else if (track.album?.name) parts.push(document.createTextNode(track.album.name));
  parts.push(document.createTextNode(formatTrackDuration(track.durationMs)));
  parts.forEach((part, index) => {
    if (index) container.append(document.createTextNode(" · "));
    container.append(part);
  });
}

function trackTableHeader() {
  const header = document.createElement("div");
  header.className = "album-track-head";
  header.setAttribute("aria-hidden", "true");
  ["#", "Title", "Time", ""].forEach((text) => {
    const cell = document.createElement("span");
    cell.textContent = text;
    header.append(cell);
  });
  return header;
}

function trackRow(track, currentUri) {
  const row = document.createElement("div");
  const number = document.createElement("span");
  const copy = document.createElement("span");
  const title = document.createElement("button");
  const artists = document.createElement("span");
  const duration = document.createElement("span");
  const actions = document.createElement("span");
  row.className = `album-track${track.playable ? "" : " unavailable"}${currentUri && currentUri === track.uri ? " playing" : ""}`;
  number.className = "album-track-number";
  number.textContent = track.discNumber > 1 ? `${track.discNumber}.${track.trackNumber}` : String(track.trackNumber || 1);
  copy.className = "album-track-copy";
  title.type = "button";
  title.className = "catalog-track-title";
  title.disabled = !track.playable;
  if (track.playable) title.dataset.trackPlay = track.uri;
  title.textContent = track.title || "Untitled song";
  artists.className = "catalog-link-row";
  appendArtistLinks(artists, track.artists);
  copy.append(title, artists);
  duration.className = "album-track-duration";
  duration.textContent = formatTrackDuration(track.durationMs);
  actions.className = "album-track-actions";
  if (/^spotify:track:/u.test(track.uri || "")) actions.append(addToPlaylistButton(track));
  row.append(number, copy, duration, actions);
  return row;
}

function addToPlaylistButton(track) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "track-action-button";
  button.dataset.catalogAddPlaylist = track.uri;
  button.dataset.catalogTrackId = track.id || "";
  button.dataset.catalogTrackTitle = track.title || "Song";
  button.title = "Add to playlist";
  button.setAttribute("aria-label", `Add ${track.title || "song"} to playlist`);
  button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 5v14M5 12h14"/></svg>';
  return button;
}

function appendArtistLinks(container, artists) {
  const valid = Array.isArray(artists) ? artists.filter((artist) => artist?.name) : [];
  if (!valid.length) return container.append(document.createTextNode("Unknown artist"));
  valid.forEach((artist, index) => {
    if (index) container.append(document.createTextNode(", "));
    if (!artist.id) return container.append(document.createTextNode(artist.name));
    const link = document.createElement("button");
    link.type = "button";
    link.className = "catalog-text-link";
    link.dataset.trackOpenArtist = artist.id;
    link.dataset.catalogOpenArtist = artist.id;
    link.textContent = artist.name;
    container.append(link);
  });
}

function externalLink(url) {
  const link = document.createElement("a");
  link.className = "btn track-open-spotify";
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "Open in Spotify";
  return link;
}

function trackMessage(text) {
  const message = document.createElement("div");
  message.className = "empty track-message";
  message.textContent = text;
  return message;
}
