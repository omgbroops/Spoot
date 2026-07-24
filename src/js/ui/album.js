import { formatCollectionDuration, formatTrackDuration } from "./library.js";
import { DEFAULT_COVER, artistText } from "./now-playing.js";

let cleanup;

export function setupAlbum({ onPlay, onBack } = {}) {
  cleanup?.();
  const content = document.getElementById("album-content");
  const back = document.getElementById("album-back");
  if (!content) return () => {};

  const click = (event) => {
    const playAll = event.target.closest("[data-album-play-all]");
    if (playAll && !playAll.disabled) {
      return onPlay?.({ contextOnly: true, contextUri: playAll.dataset.albumContext });
    }
    const track = event.target.closest("[data-album-play]");
    if (track && !track.disabled) {
      return onPlay?.({
        uri: track.dataset.albumPlay,
        contextUri: track.dataset.albumContext,
        contextPosition: Number(track.dataset.albumPosition),
      });
    }
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

export function renderAlbum({ status = "idle", result, message } = {}) {
  const content = document.getElementById("album-content");
  if (!content) return;
  content.replaceChildren();
  content.setAttribute("aria-busy", String(status === "loading"));

  if (status === "loading") {
    content.append(albumMessage("Loading album…"));
    return;
  }
  if (status === "error") {
    content.append(albumMessage(message || "This album is temporarily unavailable."));
    return;
  }
  if (!result?.album) {
    content.append(albumMessage("Choose an album from Search."));
    return;
  }

  const { album, tracks = [], durationMs = 0 } = result;
  content.append(albumHeader(
    album,
    Number.isFinite(result.total) ? result.total : tracks.length,
    durationMs,
    tracks.some((track) => track.playable),
  ));
  if (!tracks.length) {
    content.append(albumMessage("Spotify did not return any tracks for this album."));
    return;
  }
  content.append(trackHeader());
  const list = document.createElement("div");
  list.className = "album-tracks";
  tracks.forEach((track) => list.append(trackRow(track, album)));
  content.append(list);
}

function albumHeader(album, trackCount, durationMs, hasPlayableTrack) {
  const header = document.createElement("header");
  const image = document.createElement("img");
  const copy = document.createElement("div");
  const kind = document.createElement("span");
  const title = document.createElement("h2");
  const artist = document.createElement("p");
  const meta = document.createElement("p");
  const actions = document.createElement("div");
  const play = document.createElement("button");

  header.className = "album-detail-head";
  image.className = "album-detail-cover";
  image.src = album.artworkUrl || DEFAULT_COVER;
  image.alt = "";
  image.loading = "lazy";
  copy.className = "album-detail-copy";
  kind.className = "album-kind";
  kind.textContent = album.type === "single" ? "Single" : album.type === "compilation" ? "Compilation" : "Album";
  title.textContent = album.name;
  artist.className = "album-artist";
  artist.textContent = album.artist;
  meta.className = "album-meta";
  meta.textContent = [
    album.releaseYear,
    `${trackCount} song${trackCount === 1 ? "" : "s"}`,
    formatCollectionDuration(durationMs),
  ].filter(Boolean).join(" · ");
  actions.className = "album-actions";
  play.className = "btn primary album-play-all";
  play.type = "button";
  play.dataset.albumPlayAll = "";
  play.dataset.albumContext = album.uri;
  play.disabled = !album.uri || !hasPlayableTrack;
  play.textContent = "Play album";
  actions.append(play);
  if (album.externalUrl) {
    const link = document.createElement("a");
    link.className = "btn album-open-spotify";
    link.href = album.externalUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Open in Spotify";
    actions.append(link);
  }
  copy.append(kind, title, artist, meta, actions);
  header.append(image, copy);
  return header;
}

function trackRow(track, album) {
  const row = document.createElement("button");
  const number = document.createElement("span");
  const copy = document.createElement("span");
  const title = document.createElement("strong");
  const artist = document.createElement("span");
  const duration = document.createElement("span");

  row.type = "button";
  row.className = `album-track${track.playable ? "" : " unavailable"}`;
  row.disabled = !track.playable;
  if (track.playable) {
    row.dataset.albumPlay = track.uri;
    row.dataset.albumContext = album.uri;
    row.dataset.albumPosition = String(track.position);
  }
  row.title = track.unavailableReason || `Play ${track.title}`;
  number.className = "album-track-number";
  number.textContent = track.discNumber > 1
    ? `${track.discNumber}.${track.trackNumber}`
    : String(track.trackNumber);
  copy.className = "album-track-copy";
  title.textContent = track.title || "Untitled track";
  artist.textContent = artistText(track) || album.artist;
  copy.append(title, artist);
  duration.className = "album-track-duration";
  duration.textContent = formatTrackDuration(track.durationMs);
  row.append(number, copy, duration);
  return row;
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

function albumMessage(text) {
  const message = document.createElement("div");
  message.className = "empty album-message";
  message.textContent = text;
  return message;
}
