import { getElements } from './elements.js';

export const WIDGET_POSITION_STORAGE_KEY = 'spoot.ui.widget-positions';
const EDGE_MARGIN = 10;
const EXCLUDED_TARGETS = 'button,input,textarea,select,a,.seek,.list,.lyr-list,.row,[data-nodrag]';

let positions;
let activeDrag;
let cleanup;
let storage = globalThis.localStorage;

export function setupWidgets(options = {}) {
  cleanup?.();
  storage = options.storage || globalThis.localStorage;
  positions = readPositions();
  const elements = getElements();
  const removeListeners = [
    makeDraggable(elements.nowPlayingWidget, { handle: '#player', key: 'np' }),
    makeDraggable(elements.queueWidget, { handle: '#queue-head', key: 'queue' }),
    makeDraggable(elements.lyricsWidget, { handle: '#lyrics-head', key: 'lyrics' }),
  ];

  const onMove = (event) => moveDrag(event);
  const onUp = () => finishDrag(options.onPositionChange);
  const onResize = () => reclampWidgets(true);
  const onKeyDown = (event) => {
    if (!activeDrag || event.code !== 'KeyC' || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    centerWidget(activeDrag.element);
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  window.addEventListener('resize', onResize);
  window.addEventListener('keydown', onKeyDown);

  requestAnimationFrame(() => layoutWidgets());
  cleanup = () => {
    removeListeners.forEach((remove) => remove?.());
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('keydown', onKeyDown);
    cleanup = undefined;
  };
  return cleanup;
}

export function makeDraggable(element, options = {}) {
  if (!element) return () => {};
  const handle = typeof options.handle === 'string' ? element.querySelector(options.handle) : options.handle || element;
  if (!handle) return () => {};

  const onPointerDown = (event) => {
    if (event.button !== 0 || event.target.closest(EXCLUDED_TARGETS)) return;
    const rect = element.getBoundingClientRect();
    bringToFront(element);
    element.style.transform = 'none';
    element.style.left = `${rect.left}px`;
    element.style.top = `${rect.top}px`;
    element.style.margin = '0';
    element.classList.add('dragging');
    handle.classList.add('dragging');
    document.body.style.cursor = 'grabbing';
    activeDrag = {
      element,
      handle,
      key: options.key,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    try { handle.setPointerCapture(event.pointerId); } catch {}
    event.preventDefault();
  };

  handle.addEventListener('pointerdown', onPointerDown);
  return () => handle.removeEventListener('pointerdown', onPointerDown);
}

export function layoutWidgets() {
  const { nowPlayingWidget: player, queueWidget: queue, lyricsWidget: lyrics } = getElements();
  if (!player || !queue) return;
  positions ||= readPositions();

  const playerSize = elementSize(player, 536, 220);
  const queueSize = elementSize(queue, 420, 340);
  const sideBySide = innerWidth >= 980 && !queue.classList.contains('hidden');
  const savedPlayer = positions.np;
  const savedQueue = positions.queue;

  if (savedPlayer) {
    applyPosition(player, savedPlayer.x, savedPlayer.y);
  } else if (sideBySide) {
    const total = queueSize.width + 24 + playerSize.width;
    const start = Math.max(12, (innerWidth - total) / 2);
    applyPosition(player, start + queueSize.width + 24, clamp((innerHeight - playerSize.height) / 2, 40, innerHeight - playerSize.height - 20));
  } else {
    applyPosition(player, (innerWidth - playerSize.width) / 2, Math.max(96, innerHeight * 0.16));
  }

  if (savedQueue) {
    applyPosition(queue, savedQueue.x, savedQueue.y);
  } else if (sideBySide) {
    const total = queueSize.width + 24 + playerSize.width;
    const start = Math.max(12, (innerWidth - total) / 2);
    applyPosition(queue, start, clamp((innerHeight - queueSize.height) / 2, 40, innerHeight - queueSize.height - 80));
  } else {
    const playerTop = Number.parseFloat(player.style.top) || innerHeight * 0.16;
    applyPosition(queue, (innerWidth - queueSize.width) / 2, Math.min(playerTop + playerSize.height + 16, innerHeight - queueSize.height - 80));
  }

  if (lyrics && !lyrics.classList.contains('hidden')) layoutLyrics();
  reclampWidgets(false);
}

export function layoutLyrics() {
  const { lyricsWidget } = getElements();
  if (!lyricsWidget) return;
  positions ||= readPositions();
  const saved = positions.lyrics;
  const size = elementSize(lyricsWidget, 400, 340);
  if (saved) applyPosition(lyricsWidget, saved.x, saved.y);
  else applyPosition(lyricsWidget, innerWidth - size.width - 40, Math.max(96, innerHeight * 0.18));
  clampElementToViewport(lyricsWidget);
}

export function bringToFront(element) {
  document.querySelectorAll('.widget').forEach((widget) => { widget.style.zIndex = '3'; });
  if (element) element.style.zIndex = '9';
}

export function centerWidget(element) {
  if (!element) return;
  const size = elementSize(element, element.offsetWidth, element.offsetHeight);
  applyPosition(element, (innerWidth - size.width) / 2, (innerHeight - size.height) / 2);
}

export function reclampWidgets(persist = false) {
  const elements = getElements();
  const widgets = [
    ['np', elements.nowPlayingWidget],
    ['queue', elements.queueWidget],
    ['lyrics', elements.lyricsWidget],
  ];
  let changed = false;
  positions ||= readPositions();

  widgets.forEach(([key, element]) => {
    if (!element || element.classList.contains('hidden')) return;
    const before = { x: Number.parseFloat(element.style.left), y: Number.parseFloat(element.style.top) };
    const next = clampElementToViewport(element);
    if (positions[key] && (next.x !== before.x || next.y !== before.y)) {
      positions[key] = next;
      changed = true;
    }
  });
  if (persist && changed) writePositions();
}

export function getWidgetPositions() {
  positions ||= readPositions();
  return structuredCloneSafe(positions);
}

export function resetWidgetPositions() {
  positions = {};
  try { storage?.removeItem(WIDGET_POSITION_STORAGE_KEY); } catch {}
  layoutWidgets();
}

export function setQueueVisible(visible) {
  const { queueWidget, dockQueue } = getElements();
  queueWidget?.classList.toggle('hidden', !visible);
  dockQueue?.classList.toggle('active', visible);
  dockQueue?.setAttribute('aria-pressed', String(visible));
  if (visible) requestAnimationFrame(layoutWidgets);
}

export function setLyricsVisible(visible) {
  const { lyricsWidget } = getElements();
  lyricsWidget?.classList.toggle('hidden', !visible);
  if (visible) {
    bringToFront(lyricsWidget);
    requestAnimationFrame(layoutLyrics);
  }
}

export function setDockVisible(visible) {
  getElements().dock?.classList.toggle('hidden', !visible);
}

export function setHiddenMode(hidden, options = {}) {
  if (hidden && options.userInitiated !== true) return false;
  const elements = getElements();
  elements.body?.classList.toggle('hidden-mode', hidden);
  elements.blank?.classList.toggle('show', hidden);
  elements.blank?.setAttribute('aria-hidden', String(!hidden));
  document.dispatchEvent(new CustomEvent('spoot:hidden-change', { detail: { hidden } }));
  return true;
}

export function toggleHiddenMode(options = {}) {
  const hidden = !getElements().body?.classList.contains('hidden-mode');
  return setHiddenMode(hidden, { ...options, userInitiated: true });
}

function moveDrag(event) {
  if (!activeDrag) return;
  const { element, offsetX, offsetY } = activeDrag;
  applyPosition(element, event.clientX - offsetX, event.clientY - offsetY);
}

function finishDrag(onPositionChange) {
  if (!activeDrag) return;
  const { element, handle, key } = activeDrag;
  activeDrag = undefined;
  element.classList.remove('dragging');
  handle.classList.remove('dragging');
  document.body.style.cursor = '';
  const point = clampElementToViewport(element);
  if (key) {
    positions ||= readPositions();
    positions[key] = point;
    writePositions();
    onPositionChange?.(key, { ...point });
  }
}

function applyPosition(element, x, y) {
  const size = elementSize(element, element.offsetWidth, element.offsetHeight);
  const left = clamp(Number(x) || 0, EDGE_MARGIN, Math.max(EDGE_MARGIN, innerWidth - size.width - EDGE_MARGIN));
  const top = clamp(Number(y) || 0, EDGE_MARGIN, Math.max(EDGE_MARGIN, innerHeight - size.height - EDGE_MARGIN));
  element.style.transform = 'none';
  element.style.left = `${Math.round(left)}px`;
  element.style.top = `${Math.round(top)}px`;
  return { x: Math.round(left), y: Math.round(top) };
}

function clampElementToViewport(element) {
  const rect = element.getBoundingClientRect();
  return applyPosition(element, rect.left, rect.top);
}

function elementSize(element, fallbackWidth, fallbackHeight) {
  return {
    width: element.offsetWidth || fallbackWidth || 0,
    height: element.offsetHeight || fallbackHeight || 0,
  };
}

function readPositions() {
  try {
    const value = JSON.parse(storage?.getItem(WIDGET_POSITION_STORAGE_KEY) || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([, point]) => Number.isFinite(point?.x) && Number.isFinite(point?.y)));
  } catch {
    return {};
  }
}

function writePositions() {
  try { storage?.setItem(WIDGET_POSITION_STORAGE_KEY, JSON.stringify(positions)); } catch {}
}

function structuredCloneSafe(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
