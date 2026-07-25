import { formatCollectionDuration, formatTrackDuration } from "./library.js";
import { DEFAULT_COVER, artistText } from "./now-playing.js";

let cleanup;

export function setupAlbum({ onPlay, onOpenArtist, onBack } = {}) {
  cleanup?.();
  const content = document.getElementById("album-content");
  const back = document.getElementById("album-back");
  if (!content) return () => {};
  const click = (event) => {
    const artist = event.target.closest("[data-album-open-artist]");
    if (artist && !artist.disabled) return onOpenArtist?.({ id: artist.dataset.albumOpenArtist });
    const play = event.target.closest("[data-album-play]");
    if (!play || play.disabled) return;
    onPlay?.({
      uri: play.dataset.albumPlay || null,
      contextUri: play.dataset.albumContext || null,
      contextPosition: optionalInteger(play.dataset.albumPosition),
      contextOnly: play.dataset.albumContextOnly === "true",
    });
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

export function renderAlbum(options = {}) {
  const container = options.container || document.getElementById("album-content");
  const label = options.container ? null : document.getElementById("album-title-label");
  return renderAlbumInto(container, { ...options, label });
}

export function renderAlbumInto(container, {
  status = "idle",
  result,
  message,
  currentUri = null,
  label = null,
} = {}) {
  if (!container) return;
  container.replaceChildren();
  container.setAttribute("aria-busy", String(status === "loading"));
  if (status === "loading") {
    if (label) label.textContent = "Release";
    container.append(albumMessage("Loading release…"));
    return;
  }
  if (status === "error") {
    if (label) label.textContent = "Release";
    container.append(albumMessage(message || "This release is temporarily unavailable."));
    return;
  }
  if (!result?.album) {
    if (label) label.textContent = "Release";
    container.append(albumMessage("Choose an album or single from Search."));
    return;
  }

  const { album, tracks = [], durationMs = 0 } = result;
  const kind = releaseKind(album.type);
  if (label) label.textContent = kind;
  container.append(albumHeader(album, tracks, durationMs, kind));
  if (tracks.length) container.append(trackHeader());
  const list = document.createElement("div");
  list.className = "album-tracks";
  tracks.forEach((track) => list.append(albumTrackRow(track, album, currentUri)));
  container.append(list);
  if (!tracks.length) container.append(albumMessage("Spotify did not return any songs for this release."));
}

function albumHeader(album, tracks, durationMs, kind) {
  const header = document.createElement("header");
  const image = document.createElement("img");
  const copy = document.createElement("div");
  const type = document.createElement("span");
  const title = document.createElement("h2");
  const artist = document.createElement("div");
  const meta = document.createElement("p");
  const actions = document.createElement("div");
  const play = document.createElement("button");

  header.className = "album-detail-head";
  image.className = "album-detail-cover";
  image.src = album.artworkUrl || DEFAULT_COVER;
  image.alt = "";
  image.loading = "lazy";
  image.draggable = false;
  copy.className = "album-detail-copy";
  type.className = "album-kind";
  type.textContent = kind;
  title.textContent = album.name;
  artist.className = "album-artist catalog-link-row";
  appendArtistLinks(artist, album.artists, album.artist);
  meta.className = "album-meta";
  meta.textContent = [
    album.releaseYear,
    `${tracks.length || album.totalTracks || 0} song${(tracks.length || album.totalTracks) === 1 ? "" : "s"}`,
    durationMs ? formatCollectionDuration(durationMs) : null,
  ].filter(Boolean).join(" · ");
  actions.className = "album-actions";
  play.className = "btn primary";
  play.type = "button";
  play.dataset.albumPlay = "";
  play.dataset.albumContext = album.uri || "";
  play.dataset.albumContextOnly = "true";
  play.disabled = !album.uri;
  play.textContent = `Play ${kind.toLowerCase()}`;
  actions.append(play);
  if (album.externalUrl) actions.append(externalLink(album.externalUrl, "Open in Spotify", "album-open-spotify"));
  copy.append(type, title, artist, meta, actions);
  header.append(image, copy);
  return header;
}

function trackHeader() {
  const header = document.createElement("div");
  header.className = "album-track-head";
  header.setAttribute("aria-hidden", "true");
  ["#", "Title", "Time"].forEach((label) => {
    const cell = document.createElement("span");
    cell.textContent = label;
    header.append(cell);
  });
  return header;
}

function albumTrackRow(track, album, currentUri) {
  const row = document.createElement("div");
  const number = document.createElement("span");
  const copy = document.createElement("span");
  const title = document.createElement("button");
  const artists = document.createElement("span");
  const duration = document.createElement("span");
  row.className = `album-track${track.playable ? "" : " unavailable"}${currentUri && track.uri === currentUri ? " playing" : ""}`;
  row.title = track.unavailableReason || `Play ${track.title}`;
  number.className = "album-track-number";
  number.textContent = track.discNumber > 1 ? `${track.discNumber}.${track.trackNumber}` : String(track.trackNumber);
  copy.className = "album-track-copy";
  title.type = "button";
  title.className = "catalog-track-title";
  title.disabled = !track.playable;
  if (track.playable) {
    title.dataset.albumPlay = track.uri;
    title.dataset.albumContext = album.uri || "";
    title.dataset.albumPosition = String(track.position);
  }
  title.textContent = track.title || "Untitled song";
  artists.className = "catalog-link-row";
  appendArtistLinks(artists, track.artists, artistText(track));
  copy.append(title, artists);
  duration.className = "album-track-duration";
  duration.textContent = formatTrackDuration(track.durationMs);
  row.append(number, copy, duration);
  return row;
}

function appendArtistLinks(container, artists, fallback) {
  const valid = Array.isArray(artists) ? artists.filter((item) => item?.name) : [];
  if (!valid.length) {
    container.textContent = fallback || "Unknown artist";
    return;
  }
  valid.forEach((item, index) => {
    if (index) container.append(document.createTextNode(", "));
    if (item.id) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "catalog-text-link";
      button.dataset.albumOpenArtist = item.id;
      button.dataset.catalogOpenArtist = item.id;
      button.textContent = item.name;
      container.append(button);
    } else container.append(document.createTextNode(item.name));
  });
}

function releaseKind(type) {
  if (type === "single") return "Single";
  if (type === "compilation") return "Compilation";
  return "Album";
}

function albumMessage(text) {
  const message = document.createElement("div");
  message.className = "empty album-message";
  message.textContent = text;
  return message;
}

function externalLink(url, text, className) {
  const link = document.createElement("a");
  link.className = `btn ${className}`;
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = text;
  return link;
}

function optionalInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}
