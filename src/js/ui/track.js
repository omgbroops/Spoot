import { formatTrackDuration } from "./library.js";
import { DEFAULT_COVER, artistText } from "./now-playing.js";

let cleanup;

export function setupTrack({ onPlay, onOpenAlbum, onBack } = {}) {
  cleanup?.();
  const content = document.getElementById("track-content");
  const back = document.getElementById("track-back");
  if (!content) return () => {};

  const click = (event) => {
    const play = event.target.closest("[data-track-play]");
    if (play && !play.disabled) {
      onPlay?.({ uri: play.dataset.trackPlay });
      return;
    }
    const album = event.target.closest("[data-track-open-album]");
    if (album && !album.disabled) {
      onOpenAlbum?.({ id: album.dataset.trackOpenAlbum });
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

export function renderTrack({ status = "idle", result, message } = {}) {
  const content = document.getElementById("track-content");
  const label = document.getElementById("track-title-label");
  if (!content) return;
  content.replaceChildren();
  content.setAttribute("aria-busy", String(status === "loading"));

  if (status === "loading") {
    if (label) label.textContent = "Song";
    content.append(trackMessage("Loading song…"));
    return;
  }
  if (status === "error") {
    if (label) label.textContent = "Song";
    content.append(trackMessage(message || "This song is temporarily unavailable."));
    return;
  }
  if (!result?.track) {
    if (label) label.textContent = "Song";
    content.append(trackMessage("Choose a song from Search."));
    return;
  }

  const track = result.track;
  const kind = track.album?.type === "single" ? "Single" : "Song";
  if (label) label.textContent = kind;
  content.append(trackHeader(track, kind), trackTableHeader(), trackRow(track));
}

function trackHeader(track, kind) {
  const header = document.createElement("header");
  const image = document.createElement("img");
  const copy = document.createElement("div");
  const type = document.createElement("span");
  const title = document.createElement("h2");
  const artist = document.createElement("p");
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
  artist.className = "track-artist";
  artist.textContent = artistText(track) || "Unknown artist";
  meta.className = "track-meta";
  meta.textContent = [
    track.album?.releaseYear,
    track.album?.name,
    formatTrackDuration(track.durationMs),
  ].filter(Boolean).join(" · ");
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
    release.textContent = "View release";
    actions.append(release);
  }

  if (track.externalUrl) {
    const link = document.createElement("a");
    link.className = "btn track-open-spotify";
    link.href = track.externalUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Open in Spotify";
    actions.append(link);
  }

  copy.append(type, title, artist, meta, actions);
  header.append(image, copy);
  return header;
}

function trackTableHeader() {
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

function trackRow(track) {
  const row = document.createElement("button");
  const number = document.createElement("span");
  const copy = document.createElement("span");
  const title = document.createElement("strong");
  const artist = document.createElement("span");
  const duration = document.createElement("span");

  row.type = "button";
  row.className = `album-track${track.playable ? "" : " unavailable"}`;
  row.disabled = !track.playable;
  if (track.playable) row.dataset.trackPlay = track.uri;
  row.title = track.unavailableReason || `Play ${track.title}`;
  number.className = "album-track-number";
  number.textContent = track.discNumber > 1
    ? `${track.discNumber}.${track.trackNumber}`
    : String(track.trackNumber || 1);
  copy.className = "album-track-copy";
  title.textContent = track.title || "Untitled song";
  artist.textContent = artistText(track) || "Unknown artist";
  copy.append(title, artist);
  duration.className = "album-track-duration";
  duration.textContent = formatTrackDuration(track.durationMs);
  row.append(number, copy, duration);
  return row;
}

function trackMessage(text) {
  const message = document.createElement("div");
  message.className = "empty track-message";
  message.textContent = text;
  return message;
}
