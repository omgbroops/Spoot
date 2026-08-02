import { getElements } from './elements.js';

let cleanup;
let handlers = {};

export function setupDevicePicker(nextHandlers = {}) {
  cleanup?.();
  handlers = { ...nextHandlers };
  const { devicePicker, deviceTrigger, deviceList } = getElements();
  if (!devicePicker || !deviceTrigger || !deviceList) return () => {};

  const close = () => {
    deviceList.hidden = true;
    deviceTrigger.setAttribute('aria-expanded', 'false');
  };
  const open = () => {
    deviceList.hidden = false;
    deviceTrigger.setAttribute('aria-expanded', 'true');
    let refresh;
    try {
      refresh = handlers.onOpen?.();
    } finally {
      Promise.resolve(refresh).finally(() => scheduleFocusPreferred(deviceList));
    }
  };
  const onTrigger = () => (deviceList.hidden ? open() : close());
  const onListClick = (event) => {
    const option = event.target.closest('[data-device-id]');
    if (!option || option.disabled) return;
    close();
    deviceTrigger.focus({ preventScroll: true });
    handlers.onSelect?.(option.dataset.deviceId);
  };
  const onDocumentClick = (event) => {
    if (!devicePicker.contains(event.target)) close();
  };
  const onKeyDown = (event) => {
    const options = [...deviceList.querySelectorAll('[role="option"]:not(:disabled)')];
    if (event.key === 'Tab') {
      event.preventDefault();
      close();
      deviceTrigger.focus({ preventScroll: true });
      return;
    }
    if (event.key === 'Escape') {
      close();
      deviceTrigger.focus();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (deviceList.hidden) open();
    const current = options.indexOf(document.activeElement);
    const index = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? options.length - 1
        : event.key === 'ArrowDown'
          ? (current + 1 + options.length) % options.length
          : (current < 0 ? options.length - 1 : current - 1 + options.length) % options.length;
    const next = options[index];
    if (next) {
      setRovingOption(deviceList, next);
      next.focus({ preventScroll: true });
    }
  };
  const onFocusOut = (event) => {
    if (event.relatedTarget && !devicePicker.contains(event.relatedTarget)) close();
  };

  deviceTrigger.addEventListener('click', onTrigger);
  deviceList.addEventListener('click', onListClick);
  devicePicker.addEventListener('keydown', onKeyDown);
  devicePicker.addEventListener('focusout', onFocusOut);
  document.addEventListener('click', onDocumentClick);
  cleanup = () => {
    deviceTrigger.removeEventListener('click', onTrigger);
    deviceList.removeEventListener('click', onListClick);
    devicePicker.removeEventListener('keydown', onKeyDown);
    devicePicker.removeEventListener('focusout', onFocusOut);
    document.removeEventListener('click', onDocumentClick);
    handlers = {};
    cleanup = undefined;
  };
  return cleanup;
}

export function renderDevicePicker({
  devices = [],
  activeDeviceId = null,
  activeDeviceName = null,
  spootDeviceId = null,
  loading = false,
  loggedIn = false,
} = {}) {
  const { devicePicker, deviceTrigger, deviceTriggerName, deviceList } = getElements();
  if (!devicePicker || !deviceTrigger || !deviceList) return;
  devicePicker.hidden = !loggedIn;
  if (!loggedIn) return;

  const active = devices.find((device) => device.id === activeDeviceId);
  deviceTriggerName.textContent = loading
    ? 'Checking devices…'
    : active?.name || activeDeviceName || (activeDeviceId === spootDeviceId ? 'Spoot' : 'Choose a listening device');
  deviceTrigger.disabled = loading;
  deviceList.replaceChildren();

  if (!devices.length) {
    const empty = document.createElement('div');
    empty.className = 'device-empty';
    empty.textContent = loading ? 'Loading Spotify devices…' : 'No Spotify devices are currently available.';
    deviceList.append(empty);
    return;
  }

  for (const device of devices) {
    const option = document.createElement('button');
    const copy = document.createElement('span');
    const name = document.createElement('strong');
    const meta = document.createElement('span');
    const activeNow = device.id && device.id === activeDeviceId;
    const unavailable = !device.id || device.isRestricted;
    option.type = 'button';
    option.className = `device-option${activeNow ? ' active' : ''}`;
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', String(activeNow));
    option.tabIndex = -1;
    option.disabled = unavailable;
    option.title = unavailable ? 'Spotify does not allow playback commands on this device.' : '';
    if (device.id) option.dataset.deviceId = device.id;
    option.append(deviceIcon(device.type));
    copy.className = 'device-option-copy';
    name.textContent = device.name || 'Unnamed Spotify device';
    meta.textContent = device.id === spootDeviceId
      ? 'This browser'
      : unavailable
        ? 'Unavailable to Spotify Connect'
        : device.type || 'Spotify Connect';
    copy.append(name, meta);
    option.append(copy);
    if (activeNow) option.append(activeMark());
    deviceList.append(option);
  }
  setRovingOption(
    deviceList,
    deviceList.querySelector('[role="option"][aria-selected="true"]:not(:disabled)') ||
      deviceList.querySelector('[role="option"]:not(:disabled)'),
  );
}

function deviceIcon(type = '') {
  const icon = document.createElement('span');
  icon.className = 'device-icon';
  icon.setAttribute('aria-hidden', 'true');
  const normalized = String(type).toLowerCase();
  icon.innerHTML = normalized.includes('phone')
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="6.5" y="2.5" width="11" height="19" rx="2"/><path d="M10 18.5h4"/></svg>'
    : normalized.includes('speaker')
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="5" y="2.5" width="14" height="19" rx="2"/><circle cx="12" cy="15" r="3.5"/><path d="M9.5 7h5"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>';
  return icon;
}

function activeMark() {
  const mark = document.createElement('span');
  mark.className = 'device-active-mark';
  mark.setAttribute('aria-label', 'Active device');
  mark.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m5 12 4 4L19 6"/></svg>';
  return mark;
}

function setRovingOption(list, activeOption) {
  for (const option of list.querySelectorAll('[role="option"]')) option.tabIndex = -1;
  if (activeOption) activeOption.tabIndex = 0;
}

function scheduleFocusPreferred(list) {
  const schedule = globalThis.requestAnimationFrame || ((callback) => setTimeout(callback, 0));
  schedule(() => {
    if (list.hidden) return;
    const preferred = list.querySelector('[role="option"][aria-selected="true"]:not(:disabled)') ||
      list.querySelector('[role="option"]:not(:disabled)');
    setRovingOption(list, preferred);
    preferred?.focus({ preventScroll: true });
  });
}
