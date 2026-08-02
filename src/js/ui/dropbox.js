let handlers = {};
let cleanup;
let currentPath = "";
let currentMode = "audio";

export function setupDropbox(nextHandlers = {}) {
  cleanup?.();
  handlers = { ...nextHandlers };
  const content = document.getElementById("dropbox-content");
  const refresh = document.getElementById("dropbox-refresh");
  if (!content) return () => {};

  const click = (event) => {
    if (event.target.closest("[data-dropbox-connect]")) return handlers.onConnect?.();
    if (event.target.closest("[data-dropbox-finish]")) {
      const code = document.getElementById("dropbox-code")?.value.trim();
      return handlers.onFinish?.(code);
    }
    if (event.target.closest("[data-dropbox-disconnect]")) return handlers.onDisconnect?.();
    const folder = event.target.closest("[data-dropbox-folder]");
    if (folder) return handlers.onBrowse?.(folder.dataset.dropboxFolder || "", { mode: currentMode });
    const file = event.target.closest("[data-dropbox-file]");
    if (file) return handlers.onImport?.({ path: file.dataset.dropboxFile, name: file.dataset.dropboxName || (currentMode === "lyrics" ? "Lyrics" : "Dropbox song"), mode: currentMode });
  };
  const refreshClick = () => handlers.onRefresh?.(currentPath, { mode: currentMode, force: true });
  content.addEventListener("click", click);
  refresh?.addEventListener("click", refreshClick);
  cleanup = () => {
    content.removeEventListener("click", click);
    refresh?.removeEventListener("click", refreshClick);
    handlers = {};
    cleanup = undefined;
  };
  return cleanup;
}

export function renderDropbox({ connected = false, status = "ready", path = "", entries = [], message = "", mode = "audio" } = {}) {
  const content = document.getElementById("dropbox-content");
  const refresh = document.getElementById("dropbox-refresh");
  if (!content) return;
  currentPath = path;
  currentMode = mode === "lyrics" ? "lyrics" : "audio";
  if (refresh) refresh.hidden = !connected;
  content.replaceChildren();

  if (!connected) {
    const intro = document.createElement("p");
    intro.className = "dropbox-note";
    intro.textContent = currentMode === "lyrics" ? "Connect Dropbox, then choose an .lrc or .txt lyrics file." : "Connect Dropbox, paste the one-time authorization code, then choose audio files to import into Local Files.";
    const connect = document.createElement("button");
    connect.type = "button";
    connect.className = "btn primary";
    connect.dataset.dropboxConnect = "";
    connect.textContent = "Connect Dropbox";
    const codeRow = document.createElement("div");
    codeRow.className = "dropbox-code-row";
    codeRow.innerHTML = '<input id="dropbox-code" type="text" autocomplete="off" placeholder="Paste Dropbox code"><button class="btn" type="button" data-dropbox-finish>Finish</button>';
    content.append(intro, connect, codeRow);
    if (message) content.append(dropboxMessage(message, "error"));
    return;
  }

  const toolbar = document.createElement("div");
  toolbar.className = "dropbox-toolbar";
  const pathLabel = document.createElement("span");
  pathLabel.textContent = `${currentMode === "lyrics" ? "Lyrics" : "Audio"} · ${path || "/"}`;
  const disconnect = document.createElement("button");
  disconnect.type = "button";
  disconnect.className = "btn";
  disconnect.dataset.dropboxDisconnect = "";
  disconnect.textContent = "Disconnect";
  toolbar.append(pathLabel, disconnect);
  content.append(toolbar);
  if (status === "loading") return content.append(dropboxMessage("Loading Dropbox…"));
  if (status === "error") return content.append(dropboxMessage(message || "Dropbox is temporarily unavailable.", "error"));

  const list = document.createElement("div");
  list.className = "dropbox-list";
  if (path) {
    const up = document.createElement("button");
    up.type = "button";
    up.className = "dropbox-row";
    up.dataset.dropboxFolder = parentPath(path);
    up.innerHTML = '<span class="dropbox-icon">‹</span><span><strong>Up a folder</strong></span>';
    list.append(up);
  }
  for (const entry of entries) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "dropbox-row";
    if (entry?.[".tag"] === "folder") {
      row.dataset.dropboxFolder = entry.path_lower || entry.path_display || "";
      row.innerHTML = `<span class="dropbox-icon">▸</span><span><strong>${escapeHtml(entry.name || "Folder")}</strong><small>Folder</small></span>`;
    } else {
      row.dataset.dropboxFile = entry.path_lower || entry.path_display || "";
      row.dataset.dropboxName = entry.name || "Dropbox song";
      row.innerHTML = `<span class="dropbox-icon">${currentMode === "lyrics" ? "▤" : "♪"}</span><span><strong>${escapeHtml(entry.name || (currentMode === "lyrics" ? "Lyrics file" : "Audio file"))}</strong><small>${formatBytes(entry.size)}</small></span>`;
    }
    list.append(row);
  }
  content.append(list);
  if (!entries.length) content.append(dropboxMessage(currentMode === "lyrics" ? "No .lrc or .txt files are in this folder." : "No supported audio files are in this folder."));
}

export function setDropboxBusy(busy, message = "") {
  document.getElementById("modal-dropbox")?.classList.toggle("is-busy", Boolean(busy));
  if (message) {
    const content = document.getElementById("dropbox-content");
    content?.prepend(dropboxMessage(message));
  }
}

function parentPath(path) {
  const parts = String(path || "").split("/").filter(Boolean);
  parts.pop();
  return parts.length ? `/${parts.join("/")}` : "";
}

function dropboxMessage(text, kind = "") {
  const node = document.createElement("div");
  node.className = `empty dropbox-message ${kind}`.trim();
  node.textContent = text;
  return node;
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (!bytes) return "Audio file";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / (1024 ** index)).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"]/gu, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]);
}
