import { getElements } from './elements.js';

let timer;
let defaultDuration = 2200;

export function setupToast(options = {}) {
  if (Number.isFinite(options.duration)) defaultDuration = options.duration;
  return {
    show: showToast,
    hide: hideToast,
  };
}

export function showToast(message, options = {}) {
  const { toast } = getElements();
  if (!toast || !message) return;
  const duration = Number.isFinite(options.duration) ? options.duration : defaultDuration;
  toast.textContent = String(message);
  toast.classList.add('show');
  clearTimeout(timer);
  timer = setTimeout(hideToast, duration);
}

export function hideToast() {
  const { toast } = getElements();
  clearTimeout(timer);
  timer = undefined;
  toast?.classList.remove('show');
}
