import { lyricsToText } from "../lyrics/lyrics-service.js";

let handlers = {};
let track = null;
let editorText = "";
let view = "choose";
let syncModel = { lines: [], selected: 0, undo: [], redo: [] };
let cleanup;

export function setupLyricsEditor(nextHandlers = {}) {
  cleanup?.();
  handlers = { ...nextHandlers };
  const modal = document.getElementById("modal-lyrics");
  if (!modal) return () => {};
  const click = (event) => handleClick(event);
  const input = (event) => handleInput(event);
  const change = (event) => handleChange(event);
  modal.addEventListener("click", click);
  modal.addEventListener("input", input);
  modal.addEventListener("change", change);
  cleanup = () => {
    modal.removeEventListener("click", click);
    modal.removeEventListener("input", input);
    modal.removeEventListener("change", change);
    handlers = {};
    cleanup = undefined;
  };
  return cleanup;
}

export function showLyricsEditor({ currentTrack, lyrics, mode } = {}) {
  track = currentTrack || null;
  editorText = lyricsToText(lyrics);
  view = mode || (editorText.trim() ? "editor" : "choose");
  syncModel = { lines: syncLinesFromText(editorText), selected: 0, undo: [], redo: [] };
  render();
}

export function showLyricsResults(results = []) {
  view = "results";
  render({ results });
}

export function deliverLyricsText(text, { sync = false } = {}) {
  editorText = String(text || "");
  if (sync) {
    syncModel = { lines: syncLinesFromText(editorText), selected: 0, undo: [], redo: [] };
    view = "sync";
  } else {
    view = "editor";
  }
  render();
}

export function isLyricsSyncOpen() {
  return view === "sync" && document.getElementById("modal-lyrics")?.classList.contains("show");
}

export function updateLyricsSyncPlayback() {
  if (!isLyricsSyncOpen()) return;
  const playback = handlers.getPlayback?.() || {};
  const seek = document.getElementById("lyrics-sync-seek");
  const current = document.getElementById("lyrics-sync-current");
  const duration = document.getElementById("lyrics-sync-duration");
  const play = document.getElementById("lyrics-sync-play");
  const position = Math.max(0, Number(playback.positionMs) || 0);
  const total = Math.max(0, Number(playback.durationMs) || 0);
  if (seek && document.activeElement !== seek) {
    seek.max = String(total);
    seek.value = String(Math.min(position, total));
  }
  if (current) current.textContent = formatTime(position);
  if (duration) duration.textContent = formatTime(total);
  if (play) play.textContent = playback.isPlaying ? "Ⅱ" : "▶";
  const active = activeSyncIndex(position);
  document.querySelectorAll(".lyrics-sync-row").forEach((row, index) => row.classList.toggle("active", index === active));
  renderSyncPreview(position);
}

export function handleLyricsSyncKey(event) {
  if (!isLyricsSyncOpen()) return false;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(event.target?.tagName)) return false;
  if (["s", "S", "Enter"].includes(event.key)) {
    event.preventDefault();
    stampSelected();
    return true;
  }
  if (event.code === "Space") {
    event.preventDefault();
    handlers.onTogglePlay?.();
    return true;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault(); selectSyncLine(syncModel.selected - 1); return true;
  }
  if (event.key === "ArrowDown") {
    event.preventDefault(); selectSyncLine(syncModel.selected + 1); return true;
  }
  if (event.key === "[") { event.preventDefault(); nudgeSelected(-1); return true; }
  if (event.key === "]") { event.preventDefault(); nudgeSelected(1); return true; }
  return false;
}

function render({ results = [] } = {}) {
  const title = document.getElementById("lyrics-title");
  const body = document.getElementById("lyrics-modal-body") || document.querySelector("#modal-lyrics .modal-body");
  const modal = document.getElementById("modal-lyrics");
  if (!body || !title) return;
  modal?.classList.toggle("sync-wide", view === "sync");
  body.replaceChildren();
  if (view === "choose") renderChoose(title, body);
  else if (view === "results") renderResults(title, body, results);
  else if (view === "sync") renderSync(title, body);
  else renderEditor(title, body);
}

function renderChoose(title, body) {
  title.textContent = "Add lyrics";
  const options = [
    ["lyrics-lrclib", "♫", "Import from LRCLIB", "primary"],
    ["lyrics-dropbox", "◆", "Import from Dropbox", ""],
    ["lyrics-computer", "▣", "Import from computer", ""],
    ["lyrics-custom", "", "Custom lyrics", ""],
    ["lyrics-sync", "◴", "Sync lyrics — tap to time", ""],
  ];
  options.forEach(([id, icon, label, extra]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.id = id;
    button.className = `btn btn-full lyrics-source-button ${extra}`.trim();
    button.innerHTML = `${icon ? `<span aria-hidden="true">${icon}</span>` : ""}<span>${label}</span>`;
    body.append(button);
  });
}

function renderEditor(title, body) {
  title.innerHTML = backTitle("Lyrics");
  const hint = document.createElement("p");
  hint.className = "lyrics-editor-hint";
  hint.innerHTML = "Plain text, or synced <strong>LRC</strong> lines like <code>[01:23.45] line</code>.";
  const textarea = document.createElement("textarea");
  textarea.id = "lyrics-editor-text";
  textarea.className = "lyrics-editor-text";
  textarea.value = editorText;
  textarea.spellcheck = false;
  const save = document.createElement("button");
  save.type = "button";
  save.id = "lyrics-editor-save";
  save.className = "btn primary btn-full lyrics-save";
  save.textContent = "Save";
  const actions = document.createElement("div");
  actions.className = "lyrics-editor-actions";
  [["lyrics-editor-sync", "◴ Sync"], ["lyrics-editor-lrclib", "LRCLIB"], ["lyrics-editor-dropbox", "Dropbox"], ["lyrics-editor-computer", "Computer"]]
    .forEach(([id, label]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.id = id;
      button.className = "btn";
      button.textContent = label;
      actions.append(button);
    });
  body.append(hint, textarea, save, actions);
}

function renderResults(title, body, results) {
  title.innerHTML = backTitle("LRCLIB matches");
  if (!results.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No LRCLIB matches were found.";
    body.append(empty);
    return;
  }
  const list = document.createElement("div");
  list.className = "lyrics-results";
  results.forEach((result, index) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "lyrics-result";
    row.dataset.lyricsResult = String(index);
    row._lyricsResult = result;
    const copy = document.createElement("span");
    copy.innerHTML = `<strong>${escapeHtml(result.title)}</strong><small>${escapeHtml([result.artist, result.album].filter(Boolean).join(" · "))}</small>`;
    const badges = document.createElement("span");
    badges.className = "lyrics-result-badges";
    if (result.best) badges.append(badge("BEST", "best"));
    badges.append(badge(result.synced ? "synced" : "plain"));
    row.append(copy, badges);
    list.append(row);
  });
  body.append(list);
}

function renderSync(title, body) {
  title.innerHTML = backTitle("Sync lyrics");
  const playback = handlers.getPlayback?.() || {};
  const transport = document.createElement("div");
  transport.className = "lyrics-sync-transport";
  transport.innerHTML = `<button class="btn" id="lyrics-sync-back5" type="button">−5</button><button class="btn primary lyrics-sync-play" id="lyrics-sync-play" type="button">${playback.isPlaying ? "Ⅱ" : "▶"}</button><button class="btn" id="lyrics-sync-forward5" type="button">+5</button><span id="lyrics-sync-current">${formatTime(playback.positionMs)}</span><input id="lyrics-sync-seek" type="range" min="0" max="${Math.max(0, playback.durationMs || 0)}" value="${Math.max(0, playback.positionMs || 0)}" step="10"><span id="lyrics-sync-duration">${formatTime(playback.durationMs)}</span><select id="lyrics-sync-speed" aria-label="Sync playback speed">${[0.5,0.65,0.75,0.85,1,1.1,1.25].map((speed) => `<option value="${speed}"${Math.abs((Number(playback.speed) || 1) - speed) < 0.001 ? " selected" : ""}>${speed.toFixed(2)}×</option>`).join("")}</select>`;
  const preview = document.createElement("div");
  preview.className = "lyrics-sync-preview";
  preview.innerHTML = `<div id="lyrics-sync-preview"><strong>—</strong><small>playing: —</small></div><button class="btn primary" id="lyrics-sync-stamp" type="button">Set time · S</button>`;
  const list = document.createElement("div");
  list.className = "lyrics-sync-list";
  list.id = "lyrics-sync-list";
  syncModel.lines.forEach((line, index) => list.append(syncRow(line, index)));
  if (!syncModel.lines.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "Load or paste lyrics before syncing.";
    list.append(empty);
  }
  const foot = document.createElement("div");
  foot.className = "lyrics-sync-foot";
  foot.innerHTML = `<span id="lyrics-sync-progress">${syncModel.lines.filter((line) => line.time !== null).length} / ${syncModel.lines.length} timed</span><span class="lyrics-sync-spacer"></span><label>offset <input id="lyrics-sync-offset" type="number" value="0" step="0.01"></label><label>step <select id="lyrics-sync-step"><option value="0.01">0.01</option><option value="0.05" selected>0.05</option><option value="0.1">0.10</option><option value="0.25">0.25</option></select></label><button class="btn" id="lyrics-sync-earlier" type="button">−</button><button class="btn" id="lyrics-sync-later" type="button">+</button><button class="btn" id="lyrics-sync-undo" type="button" ${syncModel.undo.length ? "" : "disabled"}>Undo</button><button class="btn" id="lyrics-sync-redo" type="button" ${syncModel.redo.length ? "" : "disabled"}>Redo</button><button class="btn" id="lyrics-sync-clear" type="button">Clear</button><button class="btn primary" id="lyrics-sync-save" type="button">Save</button>`;
  const source = document.createElement("details");
  source.className = "lyrics-sync-source";
  source.innerHTML = `<summary>Load / replace lyrics</summary><div class="lyrics-editor-actions"><button class="btn" id="lyrics-sync-computer" type="button">Computer</button><button class="btn" id="lyrics-sync-dropbox" type="button">Dropbox</button><button class="btn" id="lyrics-sync-lrclib" type="button">LRCLIB</button></div><textarea id="lyrics-sync-paste" class="lyrics-editor-text" placeholder="Paste plain or LRC lyrics">${escapeHtml(syncExport())}</textarea><button class="btn primary btn-full" id="lyrics-sync-load" type="button">Load these lines</button>`;
  body.append(transport, preview, list, foot, source);
  updateLyricsSyncPlayback();
}

function syncRow(line, index) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = `lyrics-sync-row${index === syncModel.selected ? " selected" : ""}${line.time !== null ? " timed" : ""}`;
  row.dataset.syncIndex = String(index);
  row.innerHTML = `<span>${String(index + 1).padStart(2, "0")}</span><input class="lyrics-sync-time" value="${line.time === null ? "" : formatStamp(line.time)}" placeholder="--:--.--" aria-label="Timestamp"><strong>${escapeHtml(line.text || " ")}</strong><small>${line.time === null ? "open" : "timed"}</small>`;
  return row;
}

function handleClick(event) {
  const id = event.target.closest("button")?.id;
  if (event.target.closest("[data-lyrics-result]")) {
    const row = event.target.closest("[data-lyrics-result]");
    editorText = row._lyricsResult?.text || "";
    view = "editor";
    render();
    return;
  }
  if (event.target.closest("[data-sync-index]")) {
    selectSyncLine(Number(event.target.closest("[data-sync-index]").dataset.syncIndex));
    return;
  }
  if (id === "lyrics-modal-back") { view = view === "results" ? "choose" : "editor"; render(); return; }
  if (["lyrics-lrclib", "lyrics-editor-lrclib", "lyrics-sync-lrclib"].includes(id)) return handlers.onSearch?.(track, { target: id === "lyrics-sync-lrclib" ? "sync" : "editor" });
  if (["lyrics-dropbox", "lyrics-editor-dropbox", "lyrics-sync-dropbox"].includes(id)) return handlers.onDropbox?.({ target: id === "lyrics-sync-dropbox" ? "sync" : "editor" });
  if (["lyrics-computer", "lyrics-editor-computer", "lyrics-sync-computer"].includes(id)) return handlers.onComputer?.({ target: id === "lyrics-sync-computer" ? "sync" : "editor" });
  if (id === "lyrics-custom") { editorText = ""; view = "editor"; render(); return; }
  if (["lyrics-sync", "lyrics-editor-sync"].includes(id)) { syncModel = { lines: syncLinesFromText(editorText), selected: 0, undo: [], redo: [] }; view = "sync"; render(); return; }
  if (id === "lyrics-editor-save") return handlers.onSave?.(track, editorText);
  if (id === "lyrics-sync-save") return handlers.onSave?.(track, syncExport());
  if (id === "lyrics-sync-play") return handlers.onTogglePlay?.();
  if (id === "lyrics-sync-back5") return seekBy(-5000);
  if (id === "lyrics-sync-forward5") return seekBy(5000);
  if (id === "lyrics-sync-stamp") return stampSelected();
  if (id === "lyrics-sync-earlier") return nudgeSelected(-1);
  if (id === "lyrics-sync-later") return nudgeSelected(1);
  if (id === "lyrics-sync-undo") return undoSync();
  if (id === "lyrics-sync-redo") return redoSync();
  if (id === "lyrics-sync-clear") return clearSync();
  if (id === "lyrics-sync-load") {
    syncModel = { lines: syncLinesFromText(document.getElementById("lyrics-sync-paste")?.value || ""), selected: 0, undo: [], redo: [] };
    render();
  }
}

function handleInput(event) {
  if (event.target.id === "lyrics-editor-text") editorText = event.target.value;
  if (event.target.id === "lyrics-sync-seek") handlers.onSeek?.(Number(event.target.value) || 0);
}

function handleChange(event) {
  if (event.target.id === "lyrics-sync-speed") {
    handlers.onSpeed?.(Number(event.target.value) || 1);
    return;
  }
  if (!event.target.classList.contains("lyrics-sync-time")) return;
  const row = event.target.closest("[data-sync-index]");
  const index = Number(row?.dataset.syncIndex);
  const parsed = parseStamp(event.target.value);
  if (!Number.isFinite(parsed) && parsed !== null) return render();
  setSyncTime(index, parsed, false);
}

function stampSelected() {
  if (!syncModel.lines.length) return;
  const playback = handlers.getPlayback?.() || {};
  const offset = (Number(document.getElementById("lyrics-sync-offset")?.value) || 0) * 1000;
  setSyncTime(syncModel.selected, Math.max(0, (Number(playback.positionMs) || 0) + offset), true);
}

function nudgeSelected(direction) {
  const line = syncModel.lines[syncModel.selected];
  if (!line || line.time === null) return;
  const step = (Number(document.getElementById("lyrics-sync-step")?.value) || 0.05) * 1000;
  setSyncTime(syncModel.selected, Math.max(0, line.time + direction * step), false);
}

function setSyncTime(index, next, advance) {
  const line = syncModel.lines[index];
  if (!line) return;
  syncModel.undo.push({ index, previous: line.time, next, selected: syncModel.selected });
  syncModel.redo = [];
  line.time = next;
  if (advance) syncModel.selected = Math.min(syncModel.lines.length - 1, index + 1);
  render();
}

function undoSync() {
  const action = syncModel.undo.pop();
  if (!action) return;
  if (action.bulk) {
    syncModel.lines.forEach((line, index) => { line.time = action.previous[index] ?? null; });
  } else if (syncModel.lines[action.index]) {
    syncModel.lines[action.index].time = action.previous;
  }
  syncModel.selected = action.selected;
  syncModel.redo.push(action);
  render();
}

function redoSync() {
  const action = syncModel.redo.pop();
  if (!action) return;
  if (action.bulk) {
    syncModel.lines.forEach((line) => { line.time = null; });
  } else if (syncModel.lines[action.index]) {
    syncModel.lines[action.index].time = action.next;
  }
  syncModel.selected = action.selected;
  syncModel.undo.push(action);
  render();
}

function clearSync() {
  const previous = syncModel.lines.map((line) => line.time);
  syncModel.undo.push({ bulk: true, previous, selected: syncModel.selected });
  syncModel.lines.forEach((line) => { line.time = null; });
  syncModel.redo = [];
  render();
}

function selectSyncLine(index) {
  syncModel.selected = Math.max(0, Math.min(syncModel.lines.length - 1, Number(index) || 0));
  render();
  document.querySelector(`[data-sync-index="${syncModel.selected}"]`)?.scrollIntoView({ block: "nearest" });
}

function seekBy(delta) {
  const playback = handlers.getPlayback?.() || {};
  handlers.onSeek?.(Math.max(0, Math.min(Number(playback.durationMs) || Infinity, (Number(playback.positionMs) || 0) + delta)));
}

function activeSyncIndex(positionMs) {
  let active = -1;
  syncModel.lines.forEach((line, index) => { if (line.time !== null && line.time <= positionMs) active = index; });
  return active;
}

function renderSyncPreview(positionMs) {
  const preview = document.getElementById("lyrics-sync-preview");
  if (!preview) return;
  const selected = syncModel.lines[syncModel.selected]?.text || "—";
  const active = syncModel.lines[activeSyncIndex(positionMs)]?.text || "—";
  preview.innerHTML = `<strong>${escapeHtml(selected)}</strong><small>playing: ${escapeHtml(active)}</small>`;
}

function syncLinesFromText(text) {
  return String(text || "").replace(/\r\n?/gu, "\n").split("\n").filter((line, index, all) => line || index < all.length - 1).map((line) => {
    const match = /^\s*\[((?:\d+:)?\d{1,2}(?:[.:]\d{1,3})?)\]\s*/u.exec(line);
    return { text: match ? line.slice(match[0].length) : line, time: match ? parseStamp(match[1]) : null };
  });
}

function syncExport() {
  return syncModel.lines.map((line) => line.time === null ? line.text : `[${formatStamp(line.time)}] ${line.text}`).join("\n");
}

function parseStamp(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const match = /^(?:(\d+):)?([0-5]?\d)(?:[.:](\d{1,3}))?$/u.exec(text);
  if (!match) return NaN;
  return Number(match[1] || 0) * 60_000 + Number(match[2]) * 1000 + Number((match[3] || "0").padEnd(3, "0").slice(0, 3));
}

function formatStamp(ms) {
  const value = Math.max(0, Number(ms) || 0);
  return `${String(Math.floor(value / 60_000)).padStart(2, "0")}:${String(Math.floor((value % 60_000) / 1000)).padStart(2, "0")}.${String(Math.floor((value % 1000) / 10)).padStart(2, "0")}`;
}

function formatTime(ms) {
  const seconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function backTitle(label) {
  return `<button class="library-back" id="lyrics-modal-back" type="button" aria-label="Back"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m15 18-6-6 6-6"/></svg></button><span>${escapeHtml(label)}</span>`;
}

function badge(text, type = "") {
  const span = document.createElement("span");
  span.className = `lyrics-result-badge ${type}`.trim();
  span.textContent = text;
  return span;
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/gu, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
}
