import { getElements } from './elements.js';

export const CONNECTION_COPY = Object.freeze({
  'not-configured': { title: 'Connect Spotify', message: 'Add your Spotify Client ID to begin.', primary: 'Set up Spool' },
  'logged-out': { title: 'Spotify is disconnected', message: 'Log in to create the Spool playback device.', primary: 'Log in' },
  authorizing: { title: 'Authorizing Spotify', message: 'Finish signing in, then return to Spool.', primary: 'Authorizing…', disabled: true },
  'logged-in': { title: 'Spotify connected', message: 'Start the browser player when you are ready.', primary: 'Connect player' },
  'loading-sdk': { title: 'Loading Spotify player', message: 'Preparing the Web Playback SDK.', primary: 'Loading…', disabled: true },
  'connecting-player': { title: 'Connecting Spool', message: 'Creating your Spotify Connect device.', primary: 'Connecting…', disabled: true },
  'player-ready': { title: 'Spool is ready', message: 'Move Spotify playback to this browser.', primary: 'Use Spool' },
  'transferring-playback': { title: 'Moving playback to Spool', message: 'Spotify is activating this device.', primary: 'Transferring…', disabled: true },
  active: { title: 'Playing through Spool', message: 'This browser is the active Spotify device.' },
  'temporarily-unavailable': { title: 'Spotify is temporarily unavailable', message: 'Check your connection and try again.', primary: 'Retry' },
  'authorization-expired': { title: 'Spotify authorization expired', message: 'Log in again to reconnect Spool.', primary: 'Log in again' },
  error: { title: 'Spool could not connect', message: 'Open Settings for details or try again.', primary: 'Retry' },
});

let handlers = {};

export function setupConnectionStatus(actionHandlers = {}) {
  handlers = { ...actionHandlers };
  return () => { handlers = {}; };
}

export function renderConnectionStatus(status = {}) {
  const elements = getElements();
  if (!elements.connection) return;
  const state = status.state || 'logged-out';
  const defaults = CONNECTION_COPY[state] || CONNECTION_COPY.error;

  elements.connection.dataset.state = state;
  elements.connectionTitle.textContent = status.title || defaults.title;
  elements.connectionMessage.textContent = status.message || defaults.message;

  configureAction(elements.connectionPrimary, status.primary, {
    label: status.primaryLabel || defaults.primary,
    onClick: status.onPrimary || handlers.onPrimary,
    disabled: status.primaryDisabled ?? defaults.disabled,
  });
  configureAction(elements.connectionSecondary, status.secondary, {
    label: status.secondaryLabel,
    onClick: status.onSecondary || handlers.onSecondary,
    disabled: status.secondaryDisabled,
  });
}

export function renderSpotifySettings(settings = {}) {
  const elements = getElements();
  if (elements.settingsAccountStatus) {
    elements.settingsAccountStatus.textContent = settings.accountText || (settings.loggedIn ? 'Spotify connected' : 'Not connected');
  }
  if (elements.settingsDeviceStatus) {
    elements.settingsDeviceStatus.textContent = settings.deviceText || (settings.deviceReady ? 'Spool device ready' : 'Spool device unavailable');
  }

  configureAction(elements.settingsConnect, settings.connect, {
    label: settings.connectLabel || 'Log in',
    onClick: settings.onConnect || handlers.onConnect,
    hidden: settings.loggedIn,
  });
  configureAction(elements.settingsTransfer, settings.transfer, {
    label: settings.transferLabel || 'Use Spool',
    onClick: settings.onTransfer || handlers.onTransfer,
    hidden: !settings.loggedIn || !settings.deviceReady,
    disabled: settings.transferring,
  });
  configureAction(elements.settingsDisconnect, settings.disconnect, {
    label: settings.disconnectLabel || 'Log out',
    onClick: settings.onDisconnect || handlers.onDisconnect,
    hidden: !settings.loggedIn,
  });
}

function configureAction(button, descriptor, fallback = {}) {
  if (!button) return;
  const options = typeof descriptor === 'string'
    ? { ...fallback, label: descriptor }
    : { ...fallback, ...(descriptor || {}) };
  const hidden = options.hidden ?? !options.label;
  button.hidden = Boolean(hidden);
  button.disabled = Boolean(options.disabled);
  button.textContent = options.label || '';
  button.onclick = typeof options.onClick === 'function' && !options.disabled
    ? options.onClick
    : null;
}
