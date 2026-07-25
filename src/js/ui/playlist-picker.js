import { DEFAULT_COVER } from "./now-playing.js";

let handlers = {};
let cleanup;
let observer;
let sourcesById = new Map();

export function setupPlaylistPicker(nextHandlers = {}) {
  cleanup?.();
  handlers = { ...nextHandlers };
  const body = document.getElementById("playlist-picker-body");
  const search = document.getElementById("playlist-picker-search");
  const createButton = document.getElementById("playlist-picker-new");
  if (!body) return () => {};

  const onClick = (event) => {
    const row = event.target.closest("[data-picker-source]");
    if (row && !row.disabled) {
      const source = sourcesById.get(row.dataset.pickerSource);
      if (source) handlers.onToggle?.(source);
      return;
    }
    if (event.target.closest("#playlist-picker-new")) {
      handlers.onNew?.();
    }
  };
  const onSearch = () => filterRows(search?.value || "");
  body.addEventListener("click", onClick);
  search?.addEventListener("input", onSearch);

  cleanup = () => {
    observer?.disconnect();
    body.removeEventListener("click", onClick);
    search?.removeEventListener("input", onSearch);
    handlers = {};
    cleanup = undefined;
  };
  return cleanup;
}

export function renderPlaylistPicker({
  track,
  sources = [],
  memberships = new Map(),
  status = "ready",
  message,
  createOnly = false,
} = {}) {
  const title = document.getElementById("playlist-picker-track");
  const list = document.getElementById("playlist-picker-list");
  const statusNode = document.getElementById("playlist-picker-status");
  const search = document.getElementById("playlist-picker-search");
  if (!list || !statusNode) return;

  if (title) {
    title.textContent = track?.title
      ? `Add “${track.title}”`
      : createOnly ? "Create playlist" : "Add to playlist";
  }
  statusNode.textContent = message || "";
  statusNode.hidden = !message;
  list.replaceChildren();
  sourcesById = new Map(sources.map((source) => [source.id, source]));

  if (status === "loading") {
    list.append(pickerMessage("Loading your playlists…"));
    return;
  }
  if (status === "error") {
    list.append(pickerMessage(message || "Your playlists are temporarily unavailable."));
    return;
  }

  for (const source of sources) {
    const membership = memberships.get(source.id) || { status: "unknown", value: false };
    list.append(destinationRow(source, membership));
  }
  if (!sources.length && !createOnly) {
    list.append(pickerMessage("No writable playlists were returned by Spotify."));
  }

  filterRows(search?.value || "");
  observeUnknownRows();
}

export function updatePlaylistPickerMembership(sourceId, membership) {
  const row = document.querySelector(`[data-picker-source="${CSS.escape(sourceId)}"]`);
  if (!row) return;
  reflectMembership(row, membership);
}

export function addPlaylistPickerSource(source, membership = { status: "ready", value: true }) {
  const list = document.getElementById("playlist-picker-list");
  if (!list || !source?.id) return;
  sourcesById.set(source.id, source);
  const row = destinationRow(source, membership);
  const liked = list.querySelector('[data-picker-source="liked-songs"]');
  if (liked?.nextSibling) list.insertBefore(row, liked.nextSibling);
  else list.append(row);
  filterRows(document.getElementById("playlist-picker-search")?.value || "");
}

export function setPlaylistPickerBusy(busy, message = "") {
  const status = document.getElementById("playlist-picker-status");
  if (status) {
    status.hidden = !message;
    status.textContent = message;
  }
  document.getElementById("playlist-picker-body")?.classList.toggle("is-busy", Boolean(busy));
}

export function resetPlaylistCreateForm() {
  const search = document.getElementById("playlist-picker-search");
  if (search) search.value = "";
  filterRows("");
}

export function focusPlaylistPicker() {
  requestAnimationFrame(() => document.getElementById("playlist-picker-search")?.focus({ preventScroll: true }));
}

function destinationRow(source, membership) {
  const row = document.createElement("button");
  const image = document.createElement("img");
  const copy = document.createElement("span");
  const name = document.createElement("strong");
  const meta = document.createElement("span");
  const state = document.createElement("span");
  row.type = "button";
  row.className = "playlist-picker-row";
  row.dataset.pickerSource = source.id;
  row.dataset.searchText = `${source.name || ""} ${source.ownerName || ""}`.toLocaleLowerCase();
  row.setAttribute("aria-label", `Toggle ${source.name}`);
  image.src = source.artworkUrl || (source.kind === "liked" ? likedCover() : DEFAULT_COVER);
  image.alt = "";
  image.loading = "lazy";
  image.draggable = false;
  copy.className = "playlist-picker-copy";
  name.textContent = source.name || "Untitled playlist";
  meta.textContent = [source.ownerName, Number.isFinite(source.total) ? `${source.total} songs` : null]
    .filter(Boolean).join(" · ");
  copy.append(name, meta);
  state.className = "playlist-picker-state";
  state.setAttribute("aria-hidden", "true");
  row.append(image, copy, state);
  reflectMembership(row, membership);
  return row;
}

function reflectMembership(row, membership = {}) {
  const state = row.querySelector(".playlist-picker-state");
  const status = membership.status || "unknown";
  const included = Boolean(membership.value);
  row.dataset.membershipStatus = status;
  row.dataset.included = String(included);
  row.disabled = status === "saving";
  row.classList.toggle("included", included);
  row.classList.toggle("checking", status === "checking" || status === "unknown");
  row.classList.toggle("failed", status === "error");
  if (!state) return;
  if (status === "checking" || status === "saving") {
    state.innerHTML = '<span class="picker-spinner"></span>';
  } else if (status === "error") {
    state.textContent = "!";
  } else if (included) {
    state.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m5 12 4 4L19 6"/></svg>';
  } else {
    state.replaceChildren();
  }
}

function observeUnknownRows() {
  observer?.disconnect();
  if (typeof IntersectionObserver !== "function") {
    document.querySelectorAll('.playlist-picker-row[data-membership-status="unknown"]')
      .forEach((row) => handlers.onCheck?.(sourcesById.get(row.dataset.pickerSource)));
    return;
  }
  const list = document.getElementById("playlist-picker-list");
  observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const row = entry.target;
      observer.unobserve(row);
      const source = sourcesById.get(row.dataset.pickerSource);
      if (source) handlers.onCheck?.(source);
    }
  }, { root: list, rootMargin: "80px" });
  document.querySelectorAll('.playlist-picker-row[data-membership-status="unknown"]')
    .forEach((row) => observer.observe(row));
}

function filterRows(query) {
  const normalized = String(query || "").trim().toLocaleLowerCase();
  document.querySelectorAll(".playlist-picker-row").forEach((row) => {
    row.hidden = Boolean(normalized && !row.dataset.searchText.includes(normalized));
  });
}

function pickerMessage(text) {
  const node = document.createElement("div");
  node.className = "empty playlist-picker-message";
  node.textContent = text;
  return node;
}

function likedCover() {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><defs><linearGradient id="g" x1="0" y1="1" x2="1" y2="0"><stop stop-color="#5d35e8"/><stop offset="1" stop-color="#a8c7ff"/></linearGradient></defs><rect width="128" height="128" rx="22" fill="url(#g)"/><path d="M64 91 31 59c-18-18 9-43 27-25l6 6 6-6c18-18 45 7 27 25Z" fill="white"/></svg>')}`;
}
