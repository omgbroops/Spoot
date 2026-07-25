import { getElements } from "./elements.js";

const MANUAL_SCROLL_PAUSE_MS = 5_000;
const ACTIVE_LINE_LEAD_MS = 150;

let currentLyrics = null;
let currentPositionMs = 0;
let activeIndex = -1;
let manualScrollUntil = 0;
let cleanup;
let seekHandler;
let editHandler;

export function setupLyrics({ onSeek, onEdit } = {}) {
  cleanup?.();
  seekHandler = onSeek;
  editHandler = onEdit;
  const { lyricsList, immersiveLyrics } = getElements();
  const editButton = document.getElementById("lyrics-edit");
  const boxes = [lyricsList, immersiveLyrics].filter(Boolean);
  const removers = boxes.flatMap((box) => {
    const pauseFollow = () => { manualScrollUntil = Date.now() + MANUAL_SCROLL_PAUSE_MS; };
    const updateMask = () => updateLyricsMask(box);
    const onClick = (event) => {
      if (event.target.closest("[data-lyrics-edit]")) editHandler?.();
    };
    box.addEventListener("wheel", pauseFollow, { passive: true });
    box.addEventListener("touchmove", pauseFollow, { passive: true });
    box.addEventListener("scroll", updateMask, { passive: true });
    box.addEventListener("click", onClick);
    return [
      () => box.removeEventListener("wheel", pauseFollow),
      () => box.removeEventListener("touchmove", pauseFollow),
      () => box.removeEventListener("scroll", updateMask),
      () => box.removeEventListener("click", onClick),
    ];
  });
  const onEditClick = () => editHandler?.();
  editButton?.addEventListener("click", onEditClick);
  removers.push(() => editButton?.removeEventListener("click", onEditClick));
  cleanup = () => {
    removers.forEach((remove) => remove());
    cleanup = undefined;
    seekHandler = undefined;
    editHandler = undefined;
  };
  return cleanup;
}

export function renderLyrics({ status = "empty", lyrics = null, track = null, message = "" } = {}) {
  currentLyrics = lyrics;
  currentPositionMs = 0;
  activeIndex = -1;
  manualScrollUntil = 0;
  const { lyricsList, immersiveLyrics } = getElements();
  const boxes = [lyricsList, immersiveLyrics].filter(Boolean);

  boxes.forEach((box) => {
    box.replaceChildren();
    box.classList.remove("is-loading", "is-static");
    if (status === "loading") {
      box.classList.add("is-loading");
      appendEmpty(box, `Finding lyrics for ${track?.title || "this track"}…`);
    } else if (lyrics?.instrumental) {
      appendEmpty(box, "This track is instrumental.", true);
    } else if (lyrics?.lines?.length) {
      if (lyrics.synced) renderSyncedLyrics(box, lyrics.lines);
      else renderStaticLyrics(box, lyrics.lines);
    } else {
      appendEmpty(box, message || emptyMessage(status), Boolean(track && status !== "disconnected" && status !== "episode"));
    }
    updateLyricsMask(box);
  });

  const editButton = document.getElementById("lyrics-edit");
  if (editButton) {
    editButton.textContent = lyrics?.lines?.length || lyrics?.instrumental ? "Edit" : "Add";
    editButton.disabled = !track || status === "loading" || status === "episode";
  }
}

export function updateLyricsPosition(positionMs, { instant = false } = {}) {
  currentPositionMs = Math.max(0, Number(positionMs) || 0);
  const lines = currentLyrics?.synced ? currentLyrics.lines || [] : [];
  if (!lines.length) return -1;

  let nextIndex = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if ((Number(lines[index].startMs) || 0) <= currentPositionMs + ACTIVE_LINE_LEAD_MS) nextIndex = index;
    else break;
  }
  if (nextIndex === activeIndex && !instant) return activeIndex;
  activeIndex = nextIndex;

  const { lyricsList, immersiveLyrics, lyricsWidget, immersive } = getElements();
  const targets = [
    { box: lyricsList, visible: !lyricsWidget?.classList.contains("hidden") },
    { box: immersiveLyrics, visible: immersive?.classList.contains("with-lyrics") },
  ];
  const follow = Date.now() > manualScrollUntil;
  targets.forEach(({ box, visible }) => {
    if (!box) return;
    const renderedLines = [...box.querySelectorAll(".lyr-line")];
    renderedLines.forEach((line, index) => line.classList.toggle("active", index === activeIndex));
    const activeLine = renderedLines[activeIndex];
    if (visible && follow && activeLine) centerLine(box, activeLine, instant);
  });
  return activeIndex;
}

export function getActiveLyricsIndex() { return activeIndex; }

function renderSyncedLyrics(box, lines) {
  const fragment = document.createDocumentFragment();
  lines.forEach((line, index) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `lyr-line synced${line.type === "interlude" ? " interlude" : ""}${line.background ? " background" : ""}`;
    row.dataset.lyricsIndex = String(index);
    row.textContent = line.text || "♪";
    row.setAttribute("aria-label", line.text ? `Seek to ${line.text}` : "Seek to instrumental passage");
    row.addEventListener("click", () => {
      const startMs = Math.max(0, Number(line.startMs) || 0);
      manualScrollUntil = 0;
      seekHandler?.(startMs);
      updateLyricsPosition(startMs, { instant: true });
    });
    fragment.append(row);
  });
  box.append(fragment);
}

function renderStaticLyrics(box, lines) {
  box.classList.add("is-static");
  const plain = document.createElement("div");
  plain.className = "lyr-plain";
  plain.textContent = lines.map((line) => line.text).filter(Boolean).join("\n");
  box.append(plain);
}

function appendEmpty(box, message, editable = false) {
  const empty = document.createElement("div");
  empty.className = "lyr-empty";
  const text = document.createElement("p");
  text.textContent = message;
  empty.append(text);
  if (editable && box.id === "lyrics-list") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn lyr-add-button";
    button.dataset.lyricsEdit = "";
    button.textContent = "Add lyrics";
    empty.append(button);
  }
  box.append(empty);
}

function emptyMessage(status) {
  if (status === "episode") return "Lyrics are available for songs.";
  if (status === "error") return "Lyrics are unavailable right now.";
  if (status === "disconnected") return "Connect Spotify or play a local song to load lyrics.";
  if (status === "empty") return "Nothing playing.";
  return "No lyrics found for this track.";
}

function centerLine(box, line, instant) {
  if (typeof box.scrollTo !== "function") return;
  box.scrollTo({
    top: line.offsetTop - box.clientHeight / 2 + line.clientHeight / 2,
    behavior: instant ? "auto" : "smooth",
  });
}

function updateLyricsMask(box) {
  if (!box) return;
  const atTop = box.scrollTop <= 4;
  const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 4;
  box.classList.toggle("at-top", atTop);
  box.classList.toggle("at-bottom", atBottom);
  box.classList.toggle("scrolled", box.scrollTop > 6);
}
