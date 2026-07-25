import { DEFAULT_COVER } from "./now-playing.js";

const GROUPS = Object.freeze([
  ["tracks", "Songs"],
  ["artists", "Artists"],
  ["albums", "Albums"],
  ["playlists", "Playlists"],
]);

let cleanup;

export function setupSearch({
  onQuery,
  onPlay,
  onOpenAlbum,
  onOpenArtist,
  onOpenTrack,
  onOpenPlaylist,
  onAddToPlaylist,
  onRefresh,
  onBack,
} = {}) {
  cleanup?.();
  const form = document.getElementById("search-form");
  const input = document.getElementById("search-input");
  const results = document.getElementById("search-results");
  const back = document.getElementById("search-back");
  if (!form || !input || !results) return () => {};

  const submit = (event) => {
    event.preventDefault();
    onQuery?.(input.value);
  };
  const goBack = (event) => {
    event.preventDefault();
    onBack?.();
  };
  const click = (event) => {
    if (event.target.closest("[data-catalog-refresh]")) { onRefresh?.(); return; }
    const add = event.target.closest("[data-catalog-add-playlist]");
    if (add && !add.disabled) {
      onAddToPlaylist?.({ id: add.dataset.catalogTrackId || null, uri: add.dataset.catalogAddPlaylist || null, title: add.dataset.catalogTrackTitle || "Song" });
      return;
    }
    const album = event.target.closest("[data-search-open-album], [data-catalog-open-album], [data-album-open]");
    if (album && !album.disabled) {
      onOpenAlbum?.({ id: album.dataset.searchOpenAlbum || album.dataset.catalogOpenAlbum || album.dataset.albumOpen });
      return;
    }
    const artist = event.target.closest("[data-search-open-artist], [data-catalog-open-artist], [data-album-open-artist], [data-track-open-artist], [data-playlist-open-artist]");
    if (artist && !artist.disabled) {
      onOpenArtist?.({ id: artist.dataset.searchOpenArtist || artist.dataset.catalogOpenArtist || artist.dataset.albumOpenArtist || artist.dataset.trackOpenArtist || artist.dataset.playlistOpenArtist });
      return;
    }
    const track = event.target.closest("[data-search-open-track], [data-catalog-open-track]");
    if (track && !track.disabled) {
      onOpenTrack?.({ id: track.dataset.searchOpenTrack || track.dataset.catalogOpenTrack });
      return;
    }
    const playlist = event.target.closest("[data-search-open-playlist], [data-catalog-open-playlist]");
    if (playlist && !playlist.disabled) {
      onOpenPlaylist?.({ id: playlist.dataset.searchOpenPlaylist || playlist.dataset.catalogOpenPlaylist });
      return;
    }

    const action = event.target.closest(
      "[data-search-play], [data-album-play], [data-artist-play], [data-track-play], [data-playlist-play], [data-catalog-play]",
    );
    if (!action || action.disabled) return;
    const contextOnly = [
      action.dataset.searchContextOnly,
      action.dataset.albumContextOnly,
      action.dataset.artistContextOnly,
      action.dataset.playlistContextOnly,
      action.dataset.catalogContextOnly,
    ].includes("true");
    const directUri = action.dataset.searchUri || action.dataset.albumPlay || action.dataset.artistPlay || action.dataset.trackPlay || action.dataset.playlistPlay || action.dataset.catalogPlay || null;
    const contextUri = action.dataset.searchContext || action.dataset.albumContext || action.dataset.playlistContext || action.dataset.catalogContext || (action.dataset.artistContextOnly === "true" ? action.dataset.artistPlay : null) || null;
    onPlay?.({
      uri: contextOnly ? null : directUri,
      contextUri,
      contextPosition: parseOptionalInteger(action.dataset.albumPosition || action.dataset.playlistPosition || action.dataset.catalogPosition),
      hybridPlaylistId: action.dataset.playlistHybridId || null,
      hybridPosition: parseOptionalInteger(action.dataset.playlistHybridPosition),
      contextOnly,
    });
  };

  form.addEventListener("submit", submit);
  back?.addEventListener("click", goBack);
  results.addEventListener("click", click);
  cleanup = () => {
    form.removeEventListener("submit", submit);
    back?.removeEventListener("click", goBack);
    results.removeEventListener("click", click);
    cleanup = undefined;
  };
  return cleanup;
}

export function focusSearch({ select = false } = {}) {
  requestAnimationFrame(() => {
    const input = document.getElementById("search-input");
    input?.focus({ preventScroll: true });
    if (select) input?.select();
  });
}

export function setSearchChrome({ expanded = false, canGoBack = false, query } = {}) {
  const modal = document.getElementById("modal-search");
  const back = document.getElementById("search-back");
  const input = document.getElementById("search-input");
  modal?.classList.toggle("has-results", Boolean(expanded));
  if (back) back.hidden = !canGoBack;
  if (input && query !== undefined && input.value !== query) input.value = query;
}

export function getSearchResultsContainer() {
  return document.getElementById("search-results-scroll") || document.getElementById("search-results");
}

export function animateSearchContent(container = getSearchResultsContainer()) {
  const surface = document.getElementById("search-results") || container;
  if (!surface) return;
  surface.classList.remove("content-enter");
  void surface.offsetWidth;
  surface.classList.add("content-enter");
}

export function renderSearch({ status = "idle", query = "", results, message, animate = true } = {}) {
  const container = getSearchResultsContainer();
  if (!container) return;
  container.replaceChildren();
  container.setAttribute("aria-busy", String(status === "loading"));

  if (status === "idle" || !String(query).trim()) {
    setSearchChrome({ expanded: false, canGoBack: false, query });
    return;
  }
  setSearchChrome({ expanded: true, canGoBack: false, query });
  if (status === "loading") {
    container.append(searchMessage(`Searching for “${query.trim()}”…`, "loading"));
  } else if (status === "error") {
    container.append(searchMessage(message || "Spotify search is temporarily unavailable.", "error"));
  } else if (!results?.total) {
    container.append(searchMessage(`No Spotify results for “${query.trim()}”.`));
  } else {
    for (const [key, label] of GROUPS) {
      const items = results[key] ?? [];
      if (!items.length) continue;
      const section = document.createElement("section");
      const heading = document.createElement("h2");
      const list = document.createElement("div");
      section.className = "search-group";
      heading.textContent = label;
      list.className = "search-list";
      items.forEach((item, index) => {
        const row = searchRow(item);
        row.style.setProperty("--enter-index", index);
        list.append(row);
      });
      section.append(heading, list);
      container.append(section);
    }
  }
  if (animate) animateSearchContent(container);
}

function searchRow(item) {
  const row = document.createElement("div");
  const main = document.createElement("button");
  const image = document.createElement("img");
  const copy = document.createElement("span");
  const title = document.createElement("strong");
  const subtitle = document.createElement("span");
  const badge = document.createElement("span");

  const opensAlbum = item.type === "album" && item.browseable !== false && Boolean(item.id);
  const opensArtist = item.type === "artist" && item.browseable !== false && Boolean(item.id);
  const opensTrack = item.type === "track" && item.browseable !== false && Boolean(item.id);
  const opensPlaylist = item.type === "playlist" && item.browseable !== false && Boolean(item.id);
  const opensDetail = opensAlbum || opensArtist || opensTrack || opensPlaylist;
  const interactive = opensDetail || item.playable;
  row.className = `search-result search-${item.type}${interactive ? "" : " unavailable"}`;
  main.type = "button";
  main.className = "search-result-main";
  main.disabled = !interactive;
  if (opensAlbum) main.dataset.searchOpenAlbum = item.id;
  else if (opensArtist) main.dataset.searchOpenArtist = item.id;
  else if (opensTrack) main.dataset.searchOpenTrack = item.id;
  else if (opensPlaylist) main.dataset.searchOpenPlaylist = item.id;
  else {
    main.dataset.searchPlay = "";
    if (item.uri) main.dataset.searchUri = item.uri;
    if (item.contextUri) main.dataset.searchContext = item.contextUri;
    main.dataset.searchContextOnly = String(item.type !== "track");
  }
  main.setAttribute("aria-label", interactive
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
  main.append(image, copy, badge, resultIcon(opensDetail));
  row.append(main);

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

function searchMessage(text, state = "empty") {
  const empty = document.createElement("div");
  empty.className = `empty search-message search-message-${state}`;
  empty.textContent = text;
  return empty;
}

function parseOptionalInteger(value) {
  if (value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}
