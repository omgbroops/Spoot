let handlers = {};
let cleanup;
let createContext = null;
let editPlaylist = null;
let createCoverFile = null;
let editCoverFile = null;
let createPublic = false;
let editPublic = false;
let objectUrls = [];

export function setupPlaylistEditor(nextHandlers = {}) {
  cleanup?.();
  handlers = { ...nextHandlers };
  const createForm = document.getElementById("playlist-create-editor-form");
  const editForm = document.getElementById("playlist-edit-editor-form");
  const createCover = document.getElementById("playlist-create-cover");
  const editCover = document.getElementById("playlist-edit-cover");
  const createInput = document.getElementById("playlist-create-cover-input");
  const editInput = document.getElementById("playlist-edit-cover-input");
  const createPrivacy = document.getElementById("playlist-create-privacy");
  const editPrivacy = document.getElementById("playlist-edit-privacy");

  const submitCreate = (event) => {
    event.preventDefault();
    const name = document.getElementById("playlist-create-editor-name")?.value.trim();
    if (!name) return;
    handlers.onCreate?.({
      name,
      description: document.getElementById("playlist-create-description")?.value || "",
      public: createPublic,
      coverFile: createCoverFile,
      track: createContext?.track || null,
    });
  };
  const submitEdit = (event) => {
    event.preventDefault();
    const name = document.getElementById("playlist-edit-name")?.value.trim();
    if (!name || !editPlaylist) return;
    handlers.onUpdate?.({
      playlist: editPlaylist,
      name,
      description: document.getElementById("playlist-edit-description")?.value || "",
      public: editPublic,
      coverFile: editCoverFile,
    });
  };
  const createCoverClick = () => createInput?.click();
  const editCoverClick = () => editInput?.click();
  const createImage = () => setCover("create", createInput?.files?.[0] || null);
  const editImage = () => setCover("edit", editInput?.files?.[0] || null);
  const toggleCreatePrivacy = () => { createPublic = !createPublic; reflectPrivacy(createPrivacy, createPublic); };
  const toggleEditPrivacy = () => { editPublic = !editPublic; reflectPrivacy(editPrivacy, editPublic); };

  createForm?.addEventListener("submit", submitCreate);
  editForm?.addEventListener("submit", submitEdit);
  createCover?.addEventListener("click", createCoverClick);
  editCover?.addEventListener("click", editCoverClick);
  createInput?.addEventListener("change", createImage);
  editInput?.addEventListener("change", editImage);
  createPrivacy?.addEventListener("click", toggleCreatePrivacy);
  editPrivacy?.addEventListener("click", toggleEditPrivacy);
  cleanup = () => {
    createForm?.removeEventListener("submit", submitCreate);
    editForm?.removeEventListener("submit", submitEdit);
    createCover?.removeEventListener("click", createCoverClick);
    editCover?.removeEventListener("click", editCoverClick);
    createInput?.removeEventListener("change", createImage);
    editInput?.removeEventListener("change", editImage);
    createPrivacy?.removeEventListener("click", toggleCreatePrivacy);
    editPrivacy?.removeEventListener("click", toggleEditPrivacy);
    releaseObjectUrls();
    handlers = {};
  };
  return cleanup;
}

export function prepareCreatePlaylist({ track = null } = {}) {
  createContext = { track };
  createCoverFile = null;
  createPublic = false;
  setValue("playlist-create-editor-name", "");
  setValue("playlist-create-description", "");
  reflectPrivacy(document.getElementById("playlist-create-privacy"), createPublic);
  resetCover("create");
  setPlaylistEditorBusy("create", false);
  requestAnimationFrame(() => document.getElementById("playlist-create-editor-name")?.focus());
}

export function prepareEditPlaylist(playlist) {
  editPlaylist = playlist || null;
  editCoverFile = null;
  editPublic = playlist?.public !== false;
  setValue("playlist-edit-name", playlist?.name || "");
  setValue("playlist-edit-description", playlist?.description || "");
  reflectPrivacy(document.getElementById("playlist-edit-privacy"), editPublic);
  resetCover("edit", playlist?.artworkUrl || null);
  setPlaylistEditorBusy("edit", false);
  requestAnimationFrame(() => document.getElementById("playlist-edit-name")?.focus());
}

export function setPlaylistEditorBusy(mode, busy, message = "") {
  const form = document.getElementById(`playlist-${mode}-editor-form`);
  const status = document.getElementById(`playlist-${mode}-status`);
  form?.classList.toggle("is-busy", Boolean(busy));
  form?.querySelectorAll("input, textarea, button").forEach((element) => { element.disabled = Boolean(busy); });
  if (status) {
    status.hidden = !message;
    status.textContent = message;
  }
}

function setCover(mode, file) {
  if (!file) return;
  if (mode === "create") createCoverFile = file;
  else editCoverFile = file;
  const url = URL.createObjectURL(file);
  objectUrls.push(url);
  resetCover(mode, url);
}

function resetCover(mode, url = null) {
  const button = document.getElementById(`playlist-${mode}-cover`);
  const image = button?.querySelector("img");
  const label = button?.querySelector("span");
  if (image) {
    image.hidden = !url;
    image.src = url || "";
  }
  if (label) label.textContent = url ? "Change cover" : "Choose cover";
}

function reflectPrivacy(button, isPublic) {
  if (!button) return;
  button.setAttribute("aria-pressed", String(isPublic));
  button.textContent = isPublic ? "Make private" : "Make public";
}

function setValue(id, value) {
  const element = document.getElementById(id);
  if (element) element.value = value;
}

function releaseObjectUrls() {
  objectUrls.forEach((url) => URL.revokeObjectURL(url));
  objectUrls = [];
}
