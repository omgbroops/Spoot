import { DEFAULT_COVER } from "./now-playing.js";

const GROUPS = Object.freeze([
  ["tracks", "Songs"],
  ["artists", "Artists"],
  ["albums", "Albums"],
  ["playlists", "Playlists"],
]);

let cleanup;

export function setupSearch({ onQuery, onPlay, onOpenAlbum, onOpenArtist, onOpenTrack } = {}) {
  cleanup?.();
  const form = document.getElementById("search-form");
  const input = document.getElementById("search-input");
  const results = document.getElementById("search-results");
  if (!form || !input || !results) return () => {};
  let timer;

  const submit = (event) => {
    event?.preventDefault();
    clearTimeout(timer);
    onQuery?.(input.value);
  };
  const change = () => {
    clearTimeout(timer);
    timer = setTimeout(() => onQuery?.(input.value), 280);
  };
  const click = (event) => {
    const album = event.target.closest("[data-search-open-album]");
    if (album && !album.disabled) {
      onOpenAlbum?.({ id: album.dataset.searchOpenAlbum });
      return;
    }
    const artist = event.target.closest("[data-search-open-artist]");
    if (artist && !artist.disabled) {
      onOpenArtist?.({ id: artist.dataset.searchOpenArtist });
      return;
    }
    const track = event.target.closest("[data-search-open-track]");
    if (track && !track.disabled) {
      onOpenTrack?.({ id: track.dataset.searchOpenTrack });
      return;
    }
    const action = event.target.closest("[data-search-play]");
    if (!action || action.disabled) return;
    onPlay?.({
      uri: action.dataset.searchUri || null,
      contextUri: action.dataset.searchContext || null,
      contextOnly: action.dataset.searchContextOnly === "true",
    });
  };
  form.addEventListener("submit", submit);
  input.addEventListener("input", change);
  results.addEventListener("click", click);
  cleanup = () => {
    clearTimeout(timer);
    form.removeEventListener("submit", submit);
    input.removeEventListener("input", change);
    results.removeEventListener("click", click);
    cleanup = undefined;
  };
  return cleanup;
}

export function focusSearch() {
  requestAnimationFrame(() => document.getElementById("search-input")?.focus({ preventScroll: true }));
}

export function renderSearch({ status = "idle", query = "", results, message } = {}) {
  const container = document.getElementById("search-results");
  if (!container) return;
  container.replaceChildren();
  container.setAttribute("aria-busy", String(status === "loading"));

  if (status === "idle" || !String(query).trim()) {
    container.append(searchMessage("Search Spotify for songs, artists, albums, and playlists."));
    return;
  }
  if (status === "loading") {
    container.append(searchMessage(`Searching for “${query.trim()}”…`));
    return;
  }
  if (status === "error") {
    container.append(searchMessage(message || "Spotify search is temporarily unavailable."));
    return;
  }
  if (!results?.total) {
    container.append(searchMessage(`No Spotify results for “${query.trim()}”.`));
    return;
  }

  for (const [key, label] of GROUPS) {
    const items = results[key] ?? [];
    if (!items.length) continue;
    const section = document.createElement("section");
    const heading = document.createElement("h2");
    const list = document.createElement("div");
    section.className = "search-group";
    heading.textContent = label;
    list.className = "search-list";
    items.forEach((item) => list.append(searchRow(item)));
    section.append(heading, list);
    container.append(section);
  }
}

function searchRow(item) {
  const row = document.createElement("div");
  const play = document.createElement("button");
  const image = document.createElement("img");
  const copy = document.createElement("span");
  const title = document.createElement("strong");
  const subtitle = document.createElement("span");
  const badge = document.createElement("span");

  const opensAlbum = item.type === "album" && item.browseable !== false && Boolean(item.id);
  const opensArtist = item.type === "artist" && item.browseable !== false && Boolean(item.id);
  const opensTrack = item.type === "track" && item.browseable !== false && Boolean(item.id);
  const opensDetail = opensAlbum || opensArtist || opensTrack;
  const interactive = opensDetail || item.playable;
  row.className = `search-result search-${item.type}${interactive ? "" : " unavailable"}`;
  play.type = "button";
  play.className = "search-result-main";
  play.disabled = !interactive;
  if (opensAlbum) {
    play.dataset.searchOpenAlbum = item.id;
  } else if (opensArtist) {
    play.dataset.searchOpenArtist = item.id;
  } else if (opensTrack) {
    play.dataset.searchOpenTrack = item.id;
  } else {
    play.dataset.searchPlay = "";
    if (item.uri) play.dataset.searchUri = item.uri;
    if (item.contextUri) play.dataset.searchContext = item.contextUri;
    play.dataset.searchContextOnly = String(item.type !== "track");
  }
  play.setAttribute("aria-label", interactive
    ? `${opensDetail ? "Open" : "Play"} ${item.title}`
    : `${item.title} is unavailable`);

  image.src = item.artworkUrl || DEFAULT_COVER;
  image.alt = "";
  image.loading = "lazy";
  image.draggable = false;
  copy.className = "search-result-copy";
  title.textContent = item.title;
  subtitle.textContent = item.subtitle;
  badge.className = "search-type";
  badge.textContent = item.type === "track" ? "Song" : item.type[0].toUpperCase() + item.type.slice(1);
  copy.append(title, subtitle);
  play.append(image, copy, badge, resultIcon(opensDetail));
  row.append(play);

  if (item.externalUrl) {
    const link = document.createElement("a");
    link.className = "search-spotify-link";
    link.href = item.externalUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Spotify";
    link.setAttribute("aria-label", `Open ${item.title} in Spotify`);
    row.append(link);
  }
  return row;
}

function resultIcon(opensDetail = false) {
  const icon = document.createElement("span");
  icon.className = "search-play-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML = opensDetail
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m9 18 6-6-6-6"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>';
  return icon;
}

function searchMessage(text) {
  const empty = document.createElement("div");
  empty.className = "empty search-message";
  empty.textContent = text;
  return empty;
}
